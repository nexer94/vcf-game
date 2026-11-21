/**
 * TEMPORARY local backend of the room port (sessionPort.ts) until SandboxSession exposes the physical layer.
 *
 * Thin: every state change is a model transition from game/src/model/physical.ts (addRack, addServer, addSwitch,
 * mountDevice, connectCable, disconnectCable…); issues come from model validations, flows from
 * computeTrafficFlows, profiles / certification from model/hardware.ts. Nothing here encodes a VCF rule.
 *
 * Game-only parts (no documentation behind them, labelled in the UI):
 *  - prices (`gamePrice`, "herní cena"), the backpack, floor tiles of racks, device ids / labels,
 *  - fallback objectives: four game steps only (no VCF facts, no spec references).
 *
 * DEMO-ONLY since the session exposes the physical layer: used for the illustrative demo room and as a stand-in
 * when the session fails to load. It does NOT implement the [GAME] rack placement rules (facing, aisles, room
 * capacity – modes/sandbox/rackLayout.ts): no roomPlacement / rackHints / checkRackTile / rotateRack, so the room
 * UI falls back to the drawing's occupancy check and every rack faces S.
 */
import {
  type PhysicalServer,
  type PhysicalState,
  type PortRef,
  type ValidationIssue,
  addRack,
  addServer,
  addSwitch,
  computeTrafficFlows,
  configMetrics,
  connectCable,
  deriveEsaProfile,
  disconnectCable,
  emptyPhysicalState,
  firstFreeU,
  hostFacingPorts,
  isCertifiedFor,
  linkStatus,
  mountDevice,
  resolveServerConfig,
  serverNicPorts,
  validatePhysicalNetworkForBringup,
} from '../../model';
import { buildHardwareCatalog, type HardwareCatalog, type StarterServer } from '../../model/hardwareCatalog';
import { itemPrice } from '../../modes/economy';
import type { Tile } from '../../render/room/roomGrid';
import { isCableColorId, type CableColorId } from './sessionPort';
import type {
  CableTraffic,
  InventoryEntry,
  ObjectiveView,
  PortKey,
  PortResult,
  RoomCable,
  RoomDevice,
  RoomPort,
  RoomRack,
  RoomState,
  ShopCatalog,
  ShopServerItem,
} from './sessionPort';

// ---------------------------------------------------------------------------
// Game prices (game mechanic, fictional currency – NOT documentation)
// ---------------------------------------------------------------------------

const round100 = (n: number): number => Math.max(100, Math.round(n / 100) * 100);

export function gameServerPrice(s: Pick<ShopServerItem, 'sockets' | 'coresPerSocket' | 'ramGB' | 'capacityTB' | 'nicPorts' | 'maxNicGbE'>): number {
  return round100(2000 + s.sockets * s.coresPerSocket * 150 + s.ramGB * 8 + s.capacityTB * 300 + s.nicPorts * s.maxNicGbE * 6);
}

// ---------------------------------------------------------------------------
// Catalog view
// ---------------------------------------------------------------------------

function serverItem(catalog: HardwareCatalog, s: StarterServer): ShopServerItem {
  const res = resolveServerConfig(catalog, s.config);
  const drives = s.config.drives.map((d) => {
    const p = catalog.drives.get(d.partId);
    return { label: p?.family ?? d.partId, count: d.count, capacityTB: p?.capacityTB ?? 0, iface: p?.interface ?? '?' };
  });
  const nics = s.config.nics.map((n) => {
    const p = catalog.nics.get(n.partId);
    return { label: p?.bomName ?? n.partId, count: n.count, ports: p?.ports ?? 0, speedsGbE: p?.speedsGbE ?? [] };
  });
  const metrics = res.ok ? configMetrics(res.resolved) : undefined;
  const derived = metrics ? deriveEsaProfile(s.model, metrics) : undefined;
  const base = {
    sockets: s.config.sockets,
    coresPerSocket: s.config.coresPerSocket,
    ramGB: s.config.ramGB,
    capacityTB: metrics?.nodeCapacityTB ?? 0,
    nicPorts: metrics?.nicPorts ?? 0,
    maxNicGbE: metrics?.nodeNetworkGbE ?? 0,
  };
  return {
    kind: 'server',
    id: s.id,
    vendor: s.model.vendor,
    model: s.model.model,
    rackUnits: s.model.rackUnits,
    ...base,
    drives,
    nics,
    boot: s.config.boot.description,
    ...(derived?.profile ? { profile: derived.profile } : {}),
    profileNetworkLimited: derived?.networkLimited ?? false,
    certified91: isCertifiedFor(s.model, '9.1'),
    bcgUrl: s.model.bcgUrl,
    price: gameServerPrice(base),
  };
}

export function shopCatalogOf(catalog: HardwareCatalog): ShopCatalog {
  // Game prices from the economy layer (modes/economy); local formula only if the item has no price there.
  const priced = <T extends { id: string; price: number }>(x: T): T => ({ ...x, price: itemPrice(catalog, x.id) ?? x.price });
  const c = shopCatalogOfRaw(catalog);
  return { ...c, servers: c.servers.map(priced), switches: c.switches.map(priced), racks: c.racks.map(priced), drives: c.drives.map(priced), nics: c.nics.map(priced) };
}

function shopCatalogOfRaw(catalog: HardwareCatalog): ShopCatalog {
  return {
    servers: catalog.starterServers.map((s) => serverItem(catalog, s)),
    switches: [...catalog.switches.values()].map((m) => ({
      kind: 'switch', id: m.id, label: m.label, ports: m.ports, speedsGbE: m.speedsGbE, maxMtu: m.maxMtu,
      defaultPortMtu: m.defaultPortMtu, rackUnits: m.rackUnits, price: round100(2500 + m.ports * Math.max(...m.speedsGbE) * 5),
    })),
    racks: [...catalog.racks.values()].map((r) => ({ kind: 'rack', id: r.id, label: r.label, heightU: r.heightU, price: 1200 })),
    drives: [...catalog.drives.values()].map((d) => ({
      kind: 'drive', id: d.id, label: d.family, detail: `${d.interface} · ${d.capacityTB} TB${d.dwpd !== undefined ? ` · ${d.dwpd} DWPD` : ''}`,
      oem: d.oem, ...(d.bcgDataUrl ? { bcgUrl: d.bcgDataUrl } : {}), price: round100(d.capacityTB * 350),
    })),
    nics: [...catalog.nics.values()].map((n) => ({
      kind: 'nic', id: n.id, label: n.bomName, detail: `${n.ports}× ${n.speedsGbE.join('/')} GbE`,
      ...(n.bcgDataUrl ? { bcgUrl: n.bcgDataUrl } : {}), price: round100(n.ports * Math.max(...n.speedsGbE) * 12),
    })),
    datasetFetchedAt: catalog.datasetFetchedAt,
    datasetRelease: catalog.datasetRelease,
  };
}

// ---------------------------------------------------------------------------
// PortKey <-> model PortRef
// ---------------------------------------------------------------------------

export function toPortRef(state: PhysicalState, p: PortKey): PortRef | null {
  if (state.switches.some((s) => s.id === p.deviceId)) return typeof p.port === 'number' ? { kind: 'switch', switchId: p.deviceId, port: p.port } : null;
  if (state.servers.some((s) => s.id === p.deviceId)) return p.port === 'bmc' ? { kind: 'server-bmc', serverId: p.deviceId } : { kind: 'server-nic', serverId: p.deviceId, vmnic: p.port };
  return null;
}

export function fromPortRef(p: PortRef): PortKey {
  return p.kind === 'switch' ? { deviceId: p.switchId, port: p.port } : p.kind === 'server-nic' ? { deviceId: p.serverId, port: p.vmnic } : { deviceId: p.serverId, port: 'bmc' };
}

// ---------------------------------------------------------------------------
// PhysicalState -> RoomState (shared by both backends)
// ---------------------------------------------------------------------------

/** Issue codes the room shows as cabling badges (presentation filter over model issues, UX §9.5). */
const TOPOLOGY_CODES = new Set(['PHYS_HOST_NOT_CONNECTED', 'PHYS_SINGLE_TOR', 'PHYS_HOST_PORT_IN_LAG', 'PHYS_LINK_DOWN']);

export interface RoomExtras {
  readonly tiles: ReadonlyMap<string, Tile>;
  readonly itemOf: ReadonlyMap<string, string>;
  readonly labels: ReadonlyMap<string, string>;
  readonly skipped: ReadonlySet<string>;
  readonly cableMeta: ReadonlyMap<string, { readonly color?: string; readonly label?: string }>;
  readonly objectivesHidden: boolean;
  readonly spent: number;
  readonly revision: number;
  readonly source: RoomState['source'];
}

const serverLabel = (s: PhysicalServer, labels: ReadonlyMap<string, string>): string =>
  s.esx.network?.hostnameFqdn?.split('.')[0] ?? labels.get(s.id) ?? s.id;

export function roomStateFromPhysical(state: PhysicalState, catalog: HardwareCatalog, shop: ShopCatalog, x: RoomExtras): RoomState {
  const racks: RoomRack[] = state.racks.map((r) => ({ id: r.id, label: x.labels.get(r.id) ?? r.id, heightU: r.heightU, tile: x.tiles.get(r.id) ?? null }));
  const devices: RoomDevice[] = [];
  for (const s of state.servers) {
    const model = catalog.models.get(s.config.modelId);
    const esx = s.esx.esxVersion !== undefined;
    devices.push({
      id: s.id,
      kind: 'server',
      label: serverLabel(s, x.labels),
      catalogItemId: s.catalogItemId ?? x.itemOf.get(s.id) ?? '',
      ...(model ? { vendor: model.vendor } : {}),
      modelLabel: model ? `${model.vendor} ${model.model}` : s.config.modelId,
      heightU: s.rackUnits,
      ...(s.mount ? { mount: { rackId: s.mount.rackId, positionU: s.mount.positionU } } : {}),
      nicPorts: serverNicPorts(catalog, s).map((p) => ({ index: p.vmnic, label: esx ? `vmnic${p.vmnic}` : `NIC ${p.vmnic + 1}`, speedsGbE: p.speedsGbE })),
      bmc: { label: s.bmc.label },
      switchPorts: 0,
      esxInstalled: esx,
    });
  }
  for (const sw of state.switches) {
    const m = catalog.switches.get(sw.modelId);
    devices.push({
      id: sw.id,
      kind: 'switch',
      label: x.labels.get(sw.id) ?? sw.id,
      catalogItemId: sw.modelId,
      modelLabel: m?.label ?? sw.modelId,
      heightU: m?.rackUnits ?? 1,
      ...(sw.mount ? { mount: { rackId: sw.mount.rackId, positionU: sw.mount.positionU } } : {}),
      nicPorts: [],
      switchPorts: sw.ports.length,
      ...(m ? { switchSpeedsGbE: m.speedsGbE } : {}),
      esxInstalled: false,
    });
  }
  const cables: RoomCable[] = state.cables.map((c) => {
    const ls = linkStatus(state, catalog, c);
    return {
      id: c.id,
      a: fromPortRef(c.a),
      b: fromPortRef(c.b),
      linkUp: ls.up,
      ...(ls.speedGbE !== undefined ? { speedGbE: ls.speedGbE } : {}),
      bmc: c.a.kind === 'server-bmc' || c.b.kind === 'server-bmc',
      color: isCableColorId(x.cableMeta.get(c.id)?.color) ? (x.cableMeta.get(c.id)!.color as CableColorId) : 'neutral',
      label: x.cableMeta.get(c.id)?.label ?? '',
    };
  });
  const inventory: InventoryEntry[] = [
    ...racks.filter((r) => !r.tile).map((r) => ({ id: r.id, kind: 'rack' as const, label: r.label, catalogItemId: x.itemOf.get(r.id) ?? '' })),
    ...devices.filter((d) => !d.mount).map((d) => ({ id: d.id, kind: d.kind, label: d.label, catalogItemId: d.catalogItemId })),
  ];

  // Issues: model validation of the cabled hosts; shown only for mounted servers once a switch exists.
  const mounted = state.servers.filter((s) => s.mount).map((s) => s.id);
  const anySwitch = state.switches.some((s) => s.mount);
  let issues: ValidationIssue[] = [];
  if (mounted.length && anySwitch) {
    issues = validatePhysicalNetworkForBringup(
      { state, catalog },
      { serverIds: mounted, plan: { esxManagement: { vlanId: 1 }, vmotion: { vlanId: 1, mtu: 1500 } }, storage: 'vsan-esa' },
    ).filter((i) => TOPOLOGY_CODES.has(i.code));
  }

  const flows = computeTrafficFlows({ state, catalog });
  const traffic: CableTraffic[] = flows.links
    .filter((l) => l.totalLoadGbps > 0)
    .map((l) => ({ cableId: l.cableId, ...(l.speedGbE !== undefined ? { speedGbE: l.speedGbE } : {}), byClass: l.loadGbpsByClass, utilization: l.utilization }));

  return {
    revision: x.revision,
    source: x.source,
    catalog: shop,
    racks,
    devices,
    cables,
    inventory,
    issues,
    traffic,
    objectives: fallbackObjectives(state, racks, x.skipped),
    objectivesHidden: x.objectivesHidden,
    spent: x.spent,
  };
}

/** Game-step objectives only (fallback until the engine tracker lands). No VCF facts. */
function fallbackObjectives(state: PhysicalState, racks: readonly RoomRack[], skipped: ReadonlySet<string>): ObjectiveView[] {
  const servers = state.servers.filter((s) => s.mount);
  const cabled = servers.filter((s) => hostFacingPorts(state, s.id).length > 0).length;
  const defs: { id: string; title: string; done: boolean; progress?: { done: number; total: number } }[] = [
    { id: 'room.rack', title: 'Postav rack', done: racks.some((r) => r.tile) },
    { id: 'room.server', title: 'Kup server a zarackuj ho', done: servers.length > 0 },
    { id: 'room.switch', title: 'Kup switch a zarackuj ho', done: state.switches.some((s) => s.mount) },
    {
      id: 'room.cable',
      title: 'Zapoj servery do switche',
      done: servers.length > 0 && cabled === servers.length,
      ...(servers.length > 0 ? { progress: { done: cabled, total: servers.length } } : {}),
    },
  ];
  return defs.map((d) => ({
    id: d.id,
    title: d.title,
    kind: 'game-step',
    status: d.done ? 'done' : skipped.has(d.id) ? 'skipped' : d.progress && d.progress.done > 0 ? 'progress' : 'todo',
    ...(d.progress ? { progress: d.progress } : {}),
  }));
}

let catalogCache: HardwareCatalog | null = null;
function sharedCatalog(): HardwareCatalog {
  catalogCache ??= buildHardwareCatalog();
  return catalogCache;
}

// ---------------------------------------------------------------------------
// Local port
// ---------------------------------------------------------------------------

const pad2 = (n: number): string => String(n).padStart(2, '0');
const SWITCH_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

export class LocalRoomPort implements RoomPort {
  readonly source = 'local-fallback' as const;
  private phys: PhysicalState = emptyPhysicalState();
  private readonly tiles = new Map<string, Tile>();
  private readonly itemOf = new Map<string, string>();
  private readonly labels = new Map<string, string>();
  private readonly skipped = new Set<string>();
  private readonly cableMeta = new Map<string, { color?: string; label?: string }>();
  private hidden = false;
  private spent = 0;
  private revision = 0;
  private seq = { rack: 0, server: 0, switch: 0, cable: 0 };
  private cached: RoomState | null = null;
  private readonly subs = new Set<() => void>();
  private readonly shop: ShopCatalog;

  constructor(private readonly catalog: HardwareCatalog = sharedCatalog()) {
    this.shop = shopCatalogOf(catalog);
  }

  state(): RoomState {
    this.cached ??= roomStateFromPhysical(this.phys, this.catalog, this.shop, {
      tiles: this.tiles, itemOf: this.itemOf, labels: this.labels, skipped: this.skipped, cableMeta: this.cableMeta,
      objectivesHidden: this.hidden, spent: this.spent, revision: this.revision, source: this.source,
    });
    return this.cached;
  }

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  private changed(): void {
    this.revision += 1;
    this.cached = null;
    for (const f of this.subs) f();
  }

  private commit(r: { ok: true; state: PhysicalState } | { ok: false; error: ValidationIssue }, id?: string): PortResult {
    if (!r.ok) return { ok: false, message: r.error.message, issues: [r.error] };
    this.phys = r.state;
    this.changed();
    return id !== undefined ? { ok: true, id } : { ok: true };
  }

  private priceOf(itemId: string): number {
    const s = this.shop;
    return [...s.servers, ...s.switches, ...s.racks].find((i) => i.id === itemId)?.price ?? 0;
  }

  buyItem(itemId: string): PortResult {
    const item = this.catalog.items.get(itemId);
    if (!item) return { ok: false, message: `Položka ${itemId} není v katalogu.` };
    let r: ReturnType<typeof addRack>;
    let id: string;
    if (item.kind === 'rack') {
      id = `R${++this.seq.rack}`;
      r = addRack(this.phys, this.catalog, id, item.id);
    } else if (item.kind === 'server') {
      id = `srv-${pad2(++this.seq.server)}`;
      r = addServer(this.phys, this.catalog, id, item.config, item.id);
    } else if (item.kind === 'switch') {
      const n = this.seq.switch++;
      id = `sw-${SWITCH_LETTERS[n % 26]}${n >= 26 ? Math.floor(n / 26) : ''}`;
      r = addSwitch(this.phys, this.catalog, id, item.id);
    } else {
      return { ok: false, message: 'Výměna disků a NIC v serveru zatím ve hře není.' };
    }
    if (r.ok) {
      this.itemOf.set(id, itemId);
      this.spent += this.priceOf(itemId);
    }
    return this.commit(r, id);
  }

  /** Demo only: facing is ignored (always S), no room layout rules (see the header). */
  placeRack(rackId: string, tile: Tile): PortResult {
    if (!this.phys.racks.some((r) => r.id === rackId)) return { ok: false, message: `Rack ${rackId} neexistuje.` };
    this.tiles.set(rackId, { gx: tile.gx, gy: tile.gy });
    this.changed();
    return { ok: true, id: rackId };
  }

  mountDevice(deviceId: string, rackId: string, positionU?: number): PortResult {
    const free = this.phys;
    // Moving inside / between racks: validate against the state without the device mounted.
    const pos = positionU ?? firstFreeU(free, this.catalog, deviceId, rackId);
    if (pos === undefined) return { ok: false, message: 'V racku už není místo.' };
    return this.commit(mountDevice(free, this.catalog, deviceId, rackId, pos), deviceId);
  }

  unmountDevice(deviceId: string): PortResult {
    const p = this.phys;
    const touches = (ref: PortRef): boolean => (ref.kind === 'switch' ? ref.switchId : ref.serverId) === deviceId;
    const cables = p.cables.filter((c) => !touches(c.a) && !touches(c.b));
    const servers = p.servers.map((s) => (s.id === deviceId ? stripMount(s) : s));
    const switches = p.switches.map((s) => (s.id === deviceId ? stripMount(s) : s));
    this.phys = { ...p, cables, servers, switches };
    this.changed();
    return { ok: true };
  }

  removeItem(id: string): PortResult {
    const p = this.phys;
    const touches = (ref: PortRef): boolean => (ref.kind === 'switch' ? ref.switchId : ref.serverId) === id;
    const inRack = [...p.servers, ...p.switches].filter((d) => d.mount?.rackId === id);
    if (inRack.length) return { ok: false, message: `V racku ${id} jsou zařízení – nejdřív je vyndej.` };
    const item = this.itemOf.get(id);
    this.phys = {
      ...p,
      racks: p.racks.filter((r) => r.id !== id),
      servers: p.servers.filter((s) => s.id !== id),
      switches: p.switches.filter((s) => s.id !== id),
      cables: p.cables.filter((c) => !touches(c.a) && !touches(c.b)),
    };
    this.tiles.delete(id);
    if (item) this.spent = Math.max(0, this.spent - this.priceOf(item));
    this.changed();
    return { ok: true };
  }

  connectCable(from: PortKey, to: PortKey): PortResult {
    const a = toPortRef(this.phys, from);
    const b = toPortRef(this.phys, to);
    if (!a || !b) return { ok: false, message: 'Port neexistuje.' };
    const id = `cab-${++this.seq.cable}`;
    return this.commit(connectCable(this.phys, this.catalog, { id, a, b }), id);
  }

  disconnectCable(cableId: string): PortResult {
    this.phys = disconnectCable(this.phys, cableId);
    this.changed();
    return { ok: true };
  }

  setCableMeta(cableId: string, meta: { readonly color?: CableColorId; readonly label?: string }): PortResult {
    if (!this.phys.cables.some((c) => c.id === cableId)) return { ok: false, message: `Kabel ${cableId} neexistuje.` };
    const cur = this.cableMeta.get(cableId) ?? {};
    this.cableMeta.set(cableId, { ...cur, ...(meta.color ? { color: meta.color } : {}), ...(meta.label !== undefined ? { label: meta.label.slice(0, 24) } : {}) });
    this.changed();
    return { ok: true };
  }

  skipObjective(id: string): PortResult {
    this.skipped.add(id);
    this.changed();
    return { ok: true };
  }

  setObjectivesHidden(hidden: boolean): PortResult {
    this.hidden = hidden;
    this.changed();
    return { ok: true };
  }
}

function stripMount<T extends { readonly mount?: unknown }>(d: T): T {
  const { mount: _m, ...rest } = d;
  return rest as T;
}

export function createLocalRoomPort(): RoomPort {
  return new LocalRoomPort();
}
