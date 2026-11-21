/**
 * SandboxSession snapshot -> RoomState (sessionPort.ts). THE ONLY PLACE that reads engine snapshot names:
 *   snapshot.physical (PhysicalView), snapshot.flows (FlowsView), snapshot.objectives (ObjectivesView).
 * Pure mapping, no rules.
 */
import type { FlowsView, PhysicalView } from '../../modes/sandbox/roomView';
import type { ObjectivesView, ObjectiveView as EngineObjective } from '../../modes/sandbox/objectives';
import type { ValidationIssue } from '../../model';
import {
  isCableColorId,
  type CableTraffic,
  type ObjectiveStatus,
  type ObjectiveView,
  type RoomCable,
  type RoomDevice,
  type RoomState,
  type ShopCatalog,
  type ShopPartItem,
  type ShopServerItem,
} from './sessionPort';

interface SnapshotLike {
  readonly revision?: number;
  readonly physical?: PhysicalView;
  readonly flows?: FlowsView;
  readonly objectives?: ObjectivesView;
  /** Career layer (CareerSession snapshot merged by sessionPort). */
  readonly career?: { readonly budget: { readonly total: number; readonly spent: number }; readonly score: { readonly points: number } };
}

const STATUS: Readonly<Record<EngineObjective['state'], ObjectiveStatus | null>> = {
  pending: 'todo',
  'in-progress': 'progress',
  done: 'done',
  regressed: 'problem',
  skipped: 'skipped',
  'blocked-spec': null,
};

export function objectivesOf(v: ObjectivesView | undefined): { items: ObjectiveView[]; hidden: boolean; nextId?: string } {
  if (!v || !v.available) return { items: [], hidden: v?.hidden ?? false };
  const items: ObjectiveView[] = [];
  for (const g of v.groups)
    for (const o of g.objectives) {
      const st = STATUS[o.state];
      if (!st) continue;
      items.push({
        id: o.id,
        title: o.title,
        kind: o.kind,
        status: st,
        group: g.title,
        ...(o.progress ? { progress: { done: o.progress.current, total: o.progress.target } } : {}),
        ...(o.why ? { specRef: o.why.specRef, docUrl: o.why.url } : {}),
        ...(o.showMe ? { showMe: o.showMe } : {}),
        ...v3Objective(o),
      });
    }
  return { items, hidden: v.hidden, ...(v.next ? { nextId: v.next.id } : {}) };
}

/** v3 fields of an engine objective (UX 26.1): bubble (anchor resolved by the engine), points, bonus. */
function v3Objective(o: EngineObjective): Pick<ObjectiveView, 'bubble' | 'points' | 'bonus'> {
  const b = o.bubble;
  let anchor = 'avatar';
  if (b) {
    const a = b.anchor;
    anchor = a.kind === 'avatar' ? 'avatar' : a.kind === 'ui' ? `ui:${a.id}` : a.id !== undefined ? `object:${a.objectKind}:${a.id}` : a.raw;
  }
  return {
    ...(b ? { bubble: { text: b.text, anchor, sourceKeys: b.sources.map((x) => x.key) } } : {}),
    ...(o.points !== undefined ? { points: o.points } : {}),
    ...(o.bonus === true ? { bonus: true } : {}),
  };
}

/** Server NIC slots (engine nicSlots.ts, UX 19.4). */
function nicSlotsOf(v: PhysicalView['servers'][number]): RoomDevice['nicSlots'] {
  if (!Array.isArray(v.nicSlots)) return undefined;
  return v.nicSlots.map((x) => ({
    slot: x.slot,
    ...(x.partId ? { nic: { partId: x.partId, label: x.label ?? x.partId, ports: x.ports ?? 0, speedsGbE: x.speedsGbE ?? [] } } : {}),
  }));
}

export function catalogOf(p: PhysicalView): ShopCatalog {
  const servers: ShopServerItem[] = [];
  const drives: ShopPartItem[] = [];
  const nics: ShopPartItem[] = [];
  const switches: ShopCatalog['switches'][number][] = [];
  const racks: ShopCatalog['racks'][number][] = [];
  for (const it of p.catalog.items) {
    switch (it.kind) {
      case 'server': {
        const c = it.config;
        const m = it.metrics;
        servers.push({
          kind: 'server', id: it.id, vendor: it.vendor, model: it.model, rackUnits: it.rackUnits,
          sockets: c.sockets, coresPerSocket: c.coresPerSocket, ramGB: c.ramGB,
          drives: c.drives.map((d) => {
            const part = p.catalog.items.find((x) => x.kind === 'drive' && x.id === d.partId);
            const dp = part && part.kind === 'drive' ? part.part : undefined;
            return { label: dp?.family ?? d.partId, count: d.count, capacityTB: dp?.capacityTB ?? 0, iface: dp?.interface ?? '?' };
          }),
          capacityTB: m?.nodeCapacityTB ?? 0,
          nics: c.nics.map((n) => {
            const part = p.catalog.items.find((x) => x.kind === 'nic' && x.id === n.partId);
            const np = part && part.kind === 'nic' ? part.part : undefined;
            return { label: np?.bomName ?? n.partId, count: n.count, ports: np?.ports ?? 0, speedsGbE: np?.speedsGbE ?? [] };
          }),
          nicPorts: m?.nicPorts ?? 0,
          maxNicGbE: m?.nodeNetworkGbE ?? 0,
          boot: c.boot.description,
          ...(it.esaProfile?.profile ? { profile: it.esaProfile.profile } : {}),
          profileNetworkLimited: it.esaProfile?.networkLimited ?? false,
          certified91: it.certified91,
          bcgUrl: it.bcgUrl,
          price: it.price,
          starterStatus: it.expectedStatus,
          ...(it.note ? { note: it.note } : {}),
          rackUnitsGameDefault: it.rackUnitsGameDefault,
          ...(it.rackUnitsUrl ? { rackUnitsUrl: it.rackUnitsUrl } : {}),
        });
        break;
      }
      case 'drive':
        drives.push({ kind: 'drive', id: it.id, label: it.part.family, detail: `${it.part.interface} · ${it.part.capacityTB} TB`, oem: it.part.oem, ...(it.part.bcgDataUrl ? { bcgUrl: it.part.bcgDataUrl } : {}), price: it.price });
        break;
      case 'nic':
        nics.push({ kind: 'nic', id: it.id, label: it.part.bomName, detail: `${it.part.ports}× ${it.part.speedsGbE.join('/')} GbE`, ...(it.part.bcgDataUrl ? { bcgUrl: it.part.bcgDataUrl } : {}), price: it.price });
        break;
      case 'switch':
        switches.push({ kind: 'switch', id: it.id, label: it.model.label, ports: it.model.ports, speedsGbE: it.model.speedsGbE, maxMtu: it.model.maxMtu, defaultPortMtu: it.model.defaultPortMtu, rackUnits: it.model.rackUnits, price: it.price });
        break;
      case 'rack':
        racks.push({ kind: 'rack', id: it.id, label: it.model.label, heightU: it.model.heightU, price: it.price });
        break;
      default:
        break;
    }
  }
  const shelves = p.catalog.serversByVendor?.map((sh) => ({ vendor: sh.vendor, items: sh.items.map((x) => x.id), traps: sh.traps.map((x) => x.id) }));
  return { servers, switches, racks, drives, nics, datasetFetchedAt: p.catalog.datasetFetchedAt, datasetRelease: p.catalog.datasetRelease, ...(shelves ? { shelves } : {}) };
}

/** Pre-installed ToR of a rack (engine tor.ts: SwitchView.preinstalledTor.position 'a' | 'b'). */
function torLabel(w: PhysicalView['switches'][number]): string | undefined {
  const t = w.preinstalledTor;
  return t ? (t.position === 'b' ? 'ToR-B' : 'ToR-A') : undefined;
}

export function roomStateFromSnapshot(raw: unknown): RoomState | null {
  const s = raw as SnapshotLike;
  const p = s.physical;
  if (!p) return null;
  const devices: RoomDevice[] = [
    ...p.servers.map((v): RoomDevice => ({
      id: v.id,
      kind: 'server',
      label: v.esx.network?.hostnameFqdn?.split('.')[0] ?? v.id,
      catalogItemId: v.catalogItemId ?? '',
      ...(v.vendor ? { vendor: v.vendor } : {}),
      modelLabel: v.modelName,
      heightU: v.rackUnits,
      ...(v.mount ? { mount: { rackId: v.mount.rackId, positionU: v.mount.positionU } } : {}),
      nicPorts: v.nicPorts.map((n) => ({ index: n.vmnic, label: n.label, speedsGbE: n.speedsGbE })),
      bmc: { label: v.bmc.label },
      switchPorts: 0,
      esxInstalled: v.status === 'esx-dhcp' || v.status === 'esx-static',
      status: v.status,
      ...(nicSlotsOf(v) ? { nicSlots: nicSlotsOf(v)! } : {}),
    })),
    ...p.switches.map((w): RoomDevice => ({
      id: w.id,
      kind: 'switch',
      // pre-installed wall-mounted OOB switch of the Sandbox (game scope, modes/sandbox/oob.ts)
      label: w.preinstalledOob ? `${w.id} (OOB, předinstalovaný)` : torLabel(w) ?? w.id,
      ...(w.preinstalledOob ? { role: 'oob' as const, preinstalled: true } : torLabel(w) ? { role: 'tor' as const, preinstalled: true } : {}),
      catalogItemId: w.modelId,
      modelLabel: w.label,
      heightU: w.rackUnits,
      ...(w.mount ? { mount: { rackId: w.mount.rackId, positionU: w.mount.positionU } } : {}),
      nicPorts: [],
      switchPorts: w.ports.length,
      switchSpeedsGbE: w.speedsGbE,
      esxInstalled: false,
    })),
  ];
  const cables: RoomCable[] = p.cables.map((c) => ({
    id: c.id,
    a: { deviceId: c.aEnd.deviceId, port: c.aEnd.port },
    b: { deviceId: c.bEnd.deviceId, port: c.bEnd.port },
    linkUp: c.link.up,
    ...(c.link.speedGbE !== undefined ? { speedGbE: c.link.speedGbE } : {}),
    bmc: c.bmc,
    color: isCableColorId(c.color) ? c.color : 'neutral',
    label: c.label ?? '',
  }));
  const issues: ValidationIssue[] = p.servers.flatMap((v) => {
    const t = v.topology;
    return [...t.errors, ...t.warnings, ...t.recommendations].map((i) => ({ ...i, subject: v.id }));
  });
  const traffic: CableTraffic[] = (s.flows?.links ?? [])
    .filter((l) => l.totalLoadGbps > 0)
    .map((l) => ({ cableId: l.cableId, ...(l.speedGbE !== undefined ? { speedGbE: l.speedGbE } : {}), byClass: l.loadGbpsByClass, utilization: l.utilization }));
  const obj = objectivesOf(s.objectives);
  return {
    revision: s.revision ?? 0,
    source: 'session',
    catalog: catalogOf(p),
    racks: p.racks.map((r) => ({ id: r.id, label: r.id, heightU: r.heightU, tile: r.placed && r.tile ? { gx: r.tile.gx, gy: r.tile.gy } : null, ...(r.facing ? { facing: r.facing } : {}) })),
    devices,
    cables,
    inventory: p.inventory
      .filter((i): i is typeof i & { kind: 'rack' | 'server' | 'switch' } => i.kind === 'rack' || i.kind === 'server' || i.kind === 'switch')
      .map((i) => ({ id: i.id, kind: i.kind, label: i.label, catalogItemId: i.itemId })),
    issues,
    traffic,
    objectives: obj.items,
    ...(obj.nextId ? { nextObjectiveId: obj.nextId } : {}),
    objectivesHidden: obj.hidden,
    spent: s.career ? s.career.budget.spent : p.economy.spent,
    ...(s.career ? { budget: s.career.budget.total, points: s.career.score.points } : {}),
    undo: p.undo,
    ...torReservationsOf(p),
    ...(p.companyNetwork ? { companyNetwork: { switchId: p.companyNetwork.switchId, port: p.companyNetwork.port } } : {}),
  };
}

/** Reserved U for ToR-B per rack (engine E1, read defensively: rack view `reservedU` / `torReservedU`). */
function torReservationsOf(p: PhysicalView): Pick<RoomState, 'torReservations'> {
  const out: Record<string, number> = {};
  for (const r of p.racks) if (r.tor?.reservedU !== undefined && !r.tor.b) out[r.id] = r.tor.reservedU;
  return Object.keys(out).length ? { torReservations: out } : {};
}
