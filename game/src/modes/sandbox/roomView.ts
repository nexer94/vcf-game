/**
 * Snapshot views of the server room: physical layer (racks with U map, devices, ports, cables, inventory, catalog
 * with game prices), hardware findings, traffic flows and the hardware context of the design phase.
 *
 * Everything VCF-related is computed by the model (physical.ts, hardware.ts, hardwareDesign.ts) and passed through
 * unchanged; this file only assembles data for the UI. Prices come from the economy layer (fictional).
 */
import {
  type BmcState,
  type CatalogItem,
  type DerivedEsaProfile,
  type DesignChoices,
  type DesignDecisionId,
  type DrivePart,
  type EsaProfileId,
  type EsxHost,
  type FlowNodeRef,
  type FlowTrafficClass,
  type HardwareCatalog,
  type HardwareContext,
  type HostNetworking,
  type HwClass,
  type HwFinding,
  type HwVendor,
  type LinkStatus,
  type Mount,
  type NetworkActivity,
  type NicPart,
  type OptionAvailabilityWithHardware,
  type PhysicalServer,
  type PhysicalState,
  type PlannedHostNetworks,
  type PortRef,
  type RackModel,
  type ServerConfig,
  type ServerNicPort,
  type ServiceEndpoint,
  type StarterStatus,
  type StorageType,
  type SwitchModel,
  type SwitchPortConfig,
  type TrafficFlow,
  type TrafficView,
  bmcReachable,
  cableAt,
  computeTrafficFlows,
  configMetrics,
  emptyConfigFor,
  hardwareContext,
  isCertifiedFor,
  linkStatus,
  optionAvailabilityWithHardware,
  peerOf,
  portLabel,
  rackOccupancy,
  resolveServerConfig,
  serverNicPorts,
  testManagementNetwork,
  validateClusterHardware,
  validatePhysicalNetworkForBringup,
  validateServerConfig,
} from '../../model';
import { CABLE_ITEM_ID, GAME_CURRENCY, type PriceTable, itemPrice, serverConfigPrice } from '../economy';
import { type IssueGroups, groupIssues } from './design';
import { physicalBringupIssues } from './reducer';
import { BMC_REMOTE_INSTALL_REF, BMC_REMOTE_INSTALL_VENDORS, serverInDeployedDomain, serverTask } from './room';
import { derivedEndpoints, flowContextOf, netContextOf, plannedHostNetworks, specServerIds } from './roomNet';
import type { SandboxContext } from './tx';
import type { CableEndInput, CableMeta, CompanyNetworkLink, LedgerEntry, MgmtTestResult, RoomTile, SandboxState } from './types';

// ===========================================================================
// Types
// ===========================================================================

export interface PortView {
  readonly ref: PortRef;
  /** Same port as a command input (connectCable from / to). */
  readonly end: CableEndInput;
  readonly label: string;
  readonly speedsGbE: readonly number[];
  readonly cableId?: string;
  readonly peer?: PortRef;
  readonly peerLabel?: string;
  /** Link state of the cable (model linkStatus); undefined = no cable. */
  readonly link?: LinkStatus;
}

export interface NicPortView extends PortView {
  readonly vmnic: number;
  readonly partId: string;
  /** Uplink of vSwitch0 (before bring-up the management NIC, 25 §3.5 / §6.3 [U32]). */
  readonly onStandardSwitch: boolean;
}

export interface HwFindingsView {
  readonly findings: readonly HwFinding[];
  readonly byClass: Readonly<Record<HwClass, readonly HwFinding[]>>;
  /** No REQ finding for the intended use. */
  readonly eligible: boolean;
  /** Principal storage the findings were computed for (design choice; undefined = generic host checks). */
  readonly storage?: StorageType;
  readonly esaProfile?: DerivedEsaProfile;
}

export type ServerStatus = 'unmounted' | 'no-os' | 'installing' | 'esx-dhcp' | 'esx-static';

export interface ServerView {
  readonly kind: 'server';
  readonly id: string;
  readonly catalogItemId?: string;
  readonly vendor?: HwVendor;
  readonly modelId: string;
  readonly modelName: string;
  readonly bcgUrl?: string;
  /** BCG lists the model for "ESXi 9.1 (vSAN 9.1)" (15 B.1). */
  readonly certified91: boolean;
  readonly rackUnits: number;
  readonly mount?: Mount;
  readonly config: ServerConfig;
  readonly metrics?: ReturnType<typeof configMetrics>;
  readonly status: ServerStatus;
  /** Running ESX install / DCUI test task id (progress: snapshot.tasks). */
  readonly taskId?: string;
  readonly esx: EsxHost;
  readonly hostNet?: HostNetworking;
  readonly nicPorts: readonly NicPortView[];
  readonly bmcPort: PortView;
  readonly bmc: BmcState & {
    readonly cabled: boolean;
    /** Remote ESX install via this BMC is documented (25 §10.6 [U68]). */
    readonly remoteInstallDocumented: boolean;
    readonly remoteInstallRef: string;
    /** Game rule: BMC has an IP and is reachable from the admin workstation. */
    readonly reachableFromAdmin: boolean;
    readonly outOfVcfScope: true;
  };
  readonly mgmt: {
    readonly configured: boolean;
    readonly staticIp: boolean;
    readonly vlan?: number;
    readonly ipv4?: string;
    /** Live reachability over the cabling (model testManagementNetwork); undefined while ESX is not online. */
    readonly gatewayReachable?: boolean;
    readonly dnsReachable?: Readonly<Record<string, boolean>>;
    /** Result of the last DCUI "Test Management Network". */
    readonly lastTest?: MgmtTestResult;
  };
  readonly hw: HwFindingsView;
  /** Per-host physical network findings (10 §3.3, 25 §5.3); only for mounted servers. */
  readonly topology: IssueGroups;
  readonly inDeployedDomain: boolean;
  /** Current configuration price (game currency). */
  readonly price: number;
}

export interface SwitchPortView extends PortView {
  readonly index: number;
  readonly config: SwitchPortConfig;
  /** Uplink to the company network (game abstraction). */
  readonly companyUplink: boolean;
}

export interface SwitchView {
  readonly kind: 'switch';
  readonly id: string;
  readonly modelId: string;
  readonly label: string;
  readonly rackUnits: number;
  readonly mount?: Mount;
  readonly speedsGbE: readonly number[];
  readonly maxMtu: number;
  readonly oobOnly: boolean;
  readonly ports: readonly SwitchPortView[];
  readonly gameGeneric: true;
  readonly price: number;
}

export interface RackView {
  readonly id: string;
  readonly modelId: string;
  readonly label: string;
  readonly heightU: number;
  readonly placed: boolean;
  readonly tile?: RoomTile;
  /** Index 0 = U1 … device id occupying the U, or null. */
  readonly uMap: readonly (string | null)[];
  readonly devices: readonly { readonly deviceId: string; readonly kind: 'server' | 'switch'; readonly fromU: number; readonly toU: number }[];
  readonly freeU: number;
}

export interface CableView {
  readonly id: string;
  readonly a: PortRef;
  readonly b: PortRef;
  readonly aEnd: CableEndInput;
  readonly bEnd: CableEndInput;
  readonly aLabel: string;
  readonly bLabel: string;
  readonly link: LinkStatus;
  /** One end is a BMC port (out of VCF scope – game). */
  readonly bmc: boolean;
  readonly color?: string;
  readonly label?: string;
}

export interface InventoryItemView {
  /** Instance id: device / rack id, or spare part id. Use as `inventoryId` / `removeItem.id`. */
  readonly id: string;
  readonly kind: 'server' | 'switch' | 'rack' | 'drive' | 'nic';
  readonly itemId: string;
  readonly label: string;
  readonly price: number;
}

interface PricedBase {
  readonly id: string;
  readonly label: string;
  readonly price: number;
  readonly gameCurrency: true;
}

export type CatalogItemView =
  | (PricedBase & {
      readonly kind: 'server';
      readonly vendor: HwVendor;
      readonly model: string;
      readonly modelId: string;
      readonly bcgUrl: string;
      readonly certified91: boolean;
      readonly rackUnits: number;
      readonly config: ServerConfig;
      readonly metrics?: ReturnType<typeof configMetrics>;
      /** Model-derived vSAN ESA HCI profile (15 §6.1). */
      readonly esaProfile?: DerivedEsaProfile;
      readonly expectedStatus: StarterStatus;
      readonly note: string;
    })
  | (PricedBase & { readonly kind: 'drive'; readonly part: DrivePart })
  | (PricedBase & { readonly kind: 'nic'; readonly part: NicPart })
  | (PricedBase & { readonly kind: 'switch'; readonly model: SwitchModel })
  | (PricedBase & { readonly kind: 'rack'; readonly model: RackModel })
  | (PricedBase & { readonly kind: 'cable'; readonly freeInSandbox: true });

export interface ServerModelView {
  readonly id: string;
  readonly vendor: HwVendor;
  readonly model: string;
  readonly cpuGeneration: string;
  readonly profiles: readonly EsaProfileId[];
  readonly certified91: boolean;
  readonly maxSockets: number;
  readonly maxCoresPerSocket: number;
  readonly maxMemoryGB: number;
  readonly maxDrives: number;
  readonly bcgUrl: string;
  /** Price of the bare configuration (emptyConfigFor) – game currency. */
  readonly basePrice: number;
}

export interface CatalogView {
  readonly datasetFetchedAt: string;
  readonly datasetRelease: string;
  readonly currency: typeof GAME_CURRENCY;
  /** Purchasable items (starter servers 15 B.3, parts 15 B.2, generic switches / racks, cable). */
  readonly items: readonly CatalogItemView[];
  /** Every BCG ReadyNode model (custom builds: buyItem with the model id, then configureServer). */
  readonly serverModels: readonly ServerModelView[];
  readonly cableItemId: string;
}

export interface EconomyView {
  readonly currency: typeof GAME_CURRENCY;
  /** Sandbox: money is unlimited (∞); only the spent game currency is recorded. */
  readonly moneyUnlimited: true;
  readonly spent: number;
  readonly recent: readonly LedgerEntry[];
}

export interface PhysicalView {
  /** Raw model PhysicalState (with the derived endpoints) – for adapters that reuse model helpers. */
  readonly state: PhysicalState;
  /** Rack id -> floor tile (placed racks only). Same data as racks[].tile. */
  readonly placements: Readonly<Record<string, RoomTile>>;
  /** Spent game currency (= economy.spent). */
  readonly spent: number;
  /** Cable id -> cosmetic colour / label. Same data as cables[].color / label. */
  readonly cableMeta: Readonly<Record<string, CableMeta>>;
  readonly racks: readonly RackView[];
  readonly servers: readonly ServerView[];
  readonly switches: readonly SwitchView[];
  readonly cables: readonly CableView[];
  /** Bought and not placed / mounted ("V batohu"), plus spare parts. */
  readonly inventory: readonly InventoryItemView[];
  readonly catalog: CatalogView;
  readonly companyNetwork?: CompanyNetworkLink;
  /** Derived service endpoints (company network, installer, vCenter). */
  readonly endpoints: readonly ServiceEndpoint[];
  /** Cluster-level hardware findings over all servers (initial management cluster rules, 10 §3.4, 20 §3.2). */
  readonly clusterIssues: { readonly findings: readonly HwFinding[]; readonly groups: IssueGroups };
  /** Physical network + HW validation of the wizard's physical hosts (preview of Review validation). */
  readonly bringupNetwork?: IssueGroups;
  readonly plan?: PlannedHostNetworks;
  readonly economy: EconomyView;
  readonly undo: { readonly canUndo: boolean; readonly canRedo: boolean };
  readonly bmcRemoteInstallVendors: readonly HwVendor[];
}

/** Device pair × traffic class aggregate (room dots, UX §12.2). */
export interface FlowPairView {
  readonly key: string;
  readonly a: FlowNodeRef;
  readonly b: FlowNodeRef;
  readonly trafficClass: FlowTrafficClass;
  readonly loadGbps: number;
  readonly flowIds: readonly string[];
  readonly gameScope: boolean;
}

export interface FlowsView extends TrafficView {
  readonly pairs: readonly FlowPairView[];
  readonly activities: readonly NetworkActivity[];
  readonly activeClasses: readonly FlowTrafficClass[];
  /** Loads are an illustrative model (UX label "ilustrativní model"). */
  readonly illustrative: true;
  readonly note: string;
}

export interface HwDesignView {
  readonly context: HardwareContext;
  /** optionAvailabilityWithHardware for every option of the applicable decisions. */
  readonly options: Readonly<Partial<Record<DesignDecisionId, Readonly<Record<string, OptionAvailabilityWithHardware>>>>>;
}

// ===========================================================================
// Builders
// ===========================================================================

const INSTALLER_STORAGES: readonly string[] = ['vsan-esa', 'vsan-osa', 'vmfs-fc', 'nfs-v3'];
export const storageOfChoices = (c: DesignChoices): StorageType | undefined => {
  const v = c['principal-storage'];
  return v !== undefined && INSTALLER_STORAGES.includes(v) ? (v as StorageType) : undefined;
};

/** Plan used to get only the per-host topology checks of validatePhysicalNetworkForBringup (single host = no pairs). */
const TOPOLOGY_ONLY_PLAN: PlannedHostNetworks = { esxManagement: { vlanId: 1 }, vmotion: { vlanId: 1, mtu: 9000 } };

const EMPTY_CLASSES: Record<HwClass, HwFinding[]> = { REQ: [], DEV: [], RCMD: [] };
function hwView(findings: readonly HwFinding[], eligible: boolean, storage: StorageType | undefined, esaProfile: DerivedEsaProfile | undefined): HwFindingsView {
  const byClass: Record<HwClass, HwFinding[]> = { REQ: [], DEV: [], RCMD: [] };
  for (const f of findings) byClass[f.hwClass].push(f);
  return { findings, byClass: findings.length ? byClass : EMPTY_CLASSES, eligible, ...(storage ? { storage } : {}), ...(esaProfile ? { esaProfile } : {}) };
}

const catalogMemo = new WeakMap<HardwareCatalog, WeakMap<PriceTable, CatalogView>>();

export function catalogView(catalog: HardwareCatalog, prices: PriceTable): CatalogView {
  const hit = catalogMemo.get(catalog)?.get(prices);
  if (hit) return hit;
  const pr = (id: string): number => itemPrice(catalog, id, prices) ?? 0;
  const items: CatalogItemView[] = [];
  for (const it of catalog.items.values()) items.push(itemView(catalog, it, pr(it.id), prices));
  items.push({ kind: 'cable', id: CABLE_ITEM_ID, label: 'Kabel (generický)', price: prices.cable, gameCurrency: true, freeInSandbox: true });
  const serverModels = [...catalog.models.values()].map(
    (m): ServerModelView => ({
      id: m.id,
      vendor: m.vendor,
      model: m.model,
      cpuGeneration: m.cpuGeneration,
      profiles: m.profiles,
      certified91: isCertifiedFor(m, '9.1'),
      maxSockets: m.maxSockets,
      maxCoresPerSocket: m.maxCoresPerSocket,
      maxMemoryGB: m.maxMemoryGB,
      maxDrives: m.maxDrives,
      bcgUrl: m.bcgUrl,
      basePrice: serverConfigPrice(catalog, emptyConfigFor(m), prices),
    }),
  );
  const view: CatalogView = { datasetFetchedAt: catalog.datasetFetchedAt, datasetRelease: catalog.datasetRelease, currency: GAME_CURRENCY, items, serverModels, cableItemId: CABLE_ITEM_ID };
  const inner = catalogMemo.get(catalog) ?? new WeakMap<PriceTable, CatalogView>();
  inner.set(prices, view);
  catalogMemo.set(catalog, inner);
  return view;
}

function itemView(catalog: HardwareCatalog, it: CatalogItem, price: number, prices: PriceTable): CatalogItemView {
  const base = { id: it.id, price, gameCurrency: true as const };
  switch (it.kind) {
    case 'server': {
      const v = validateServerConfig(catalog, it.config, { storage: 'vsan-esa', subject: it.id });
      return {
        ...base,
        kind: 'server',
        label: `${it.model.vendor} ${it.model.model}`,
        vendor: it.model.vendor,
        model: it.model.model,
        modelId: it.model.id,
        bcgUrl: it.model.bcgUrl,
        certified91: isCertifiedFor(it.model, '9.1'),
        rackUnits: it.model.rackUnits,
        config: it.config,
        ...(v.metrics ? { metrics: v.metrics } : {}),
        ...(v.esaProfile ? { esaProfile: v.esaProfile } : {}),
        expectedStatus: it.def.expectedStatus,
        note: it.def.note,
        price: serverConfigPrice(catalog, it.config, prices),
      };
    }
    case 'drive':
      return { ...base, kind: 'drive', label: `${it.family} ${it.capacityTB} TB`, part: it };
    case 'nic':
      return { ...base, kind: 'nic', label: it.bomName, part: it };
    case 'switch':
      return { ...base, kind: 'switch', label: it.label, model: it };
    case 'rack':
      return { ...base, kind: 'rack', label: it.label, model: it };
  }
}

const endOf = (p: PortRef): CableEndInput =>
  p.kind === 'switch' ? { deviceId: p.switchId, port: p.port } : p.kind === 'server-nic' ? { deviceId: p.serverId, port: p.vmnic } : { deviceId: p.serverId, port: 'bmc' };

function portView(s: SandboxState, catalog: HardwareCatalog, ref: PortRef, label: string, speedsGbE: readonly number[]): PortView {
  const p = s.room.physical;
  const c = cableAt(p, ref);
  if (!c) return { ref, end: endOf(ref), label, speedsGbE };
  const peer = peerOf(c, ref);
  return { ref, end: endOf(ref), label, speedsGbE, cableId: c.id, peer, peerLabel: portLabel(peer), link: linkStatus(p, catalog, c) };
}

export function physicalView(s: SandboxState, ctx: SandboxContext): PhysicalView {
  const { catalog, prices } = ctx;
  const room = s.room;
  const p = room.physical;
  const storage = storageOfChoices(s.choices);
  const net = netContextOf(s, catalog);
  const plan = plannedHostNetworks(s);

  const racks = p.racks.map((r): RackView => {
    const occ = rackOccupancy(p, catalog, r.id);
    const uMap: (string | null)[] = Array.from({ length: r.heightU }, () => null);
    for (const o of occ) for (let u = o.from; u <= o.to && u <= r.heightU; u++) uMap[u - 1] = o.deviceId;
    const tile = room.rackTiles[r.id];
    return {
      id: r.id,
      modelId: r.modelId,
      label: catalog.racks.get(r.modelId)?.label ?? r.modelId,
      heightU: r.heightU,
      placed: tile !== undefined,
      ...(tile ? { tile } : {}),
      uMap,
      devices: occ.map((o) => ({ deviceId: o.deviceId, kind: p.servers.some((x) => x.id === o.deviceId) ? ('server' as const) : ('switch' as const), fromU: o.from, toU: o.to })),
      freeU: uMap.filter((x) => x === null).length,
    };
  });

  const servers = p.servers.map((srv) => serverView(s, ctx, srv, storage, net, plan));

  const switches = p.switches.map((sw): SwitchView => {
    const m = catalog.switches.get(sw.modelId);
    const speeds = m?.speedsGbE ?? [];
    return {
      kind: 'switch',
      id: sw.id,
      modelId: sw.modelId,
      label: m?.label ?? sw.modelId,
      rackUnits: m?.rackUnits ?? 1,
      ...(sw.mount ? { mount: sw.mount } : {}),
      speedsGbE: speeds,
      maxMtu: m?.maxMtu ?? 1500,
      oobOnly: m?.oobOnly ?? false,
      ports: sw.ports.map((config, index): SwitchPortView => ({
        ...portView(s, catalog, { kind: 'switch', switchId: sw.id, port: index }, `p${index + 1}`, speeds),
        index,
        config,
        companyUplink: room.companyNetwork?.switchId === sw.id && room.companyNetwork.port === index,
      })),
      gameGeneric: true,
      price: itemPrice(catalog, sw.modelId, prices) ?? 0,
    };
  });

  const cables = p.cables.map((c): CableView => {
    const meta: CableMeta = room.cableMeta[c.id] ?? {};
    return {
      id: c.id,
      a: c.a,
      b: c.b,
      aEnd: endOf(c.a),
      bEnd: endOf(c.b),
      aLabel: portLabel(c.a),
      bLabel: portLabel(c.b),
      link: linkStatus(p, catalog, c),
      bmc: c.a.kind === 'server-bmc' || c.b.kind === 'server-bmc',
      ...(meta.color !== undefined ? { color: meta.color } : {}),
      ...(meta.label !== undefined ? { label: meta.label } : {}),
    };
  });

  const inventory: InventoryItemView[] = [
    ...p.racks.filter((r) => !room.rackTiles[r.id]).map((r): InventoryItemView => ({ id: r.id, kind: 'rack', itemId: r.modelId, label: catalog.racks.get(r.modelId)?.label ?? r.modelId, price: itemPrice(catalog, r.modelId, prices) ?? 0 })),
    ...p.servers.filter((x) => !x.mount).map((x): InventoryItemView => ({ id: x.id, kind: 'server', itemId: x.catalogItemId ?? x.config.modelId, label: `${x.id} · ${catalog.models.get(x.config.modelId)?.model ?? x.config.modelId}`, price: serverConfigPrice(catalog, x.config, prices) })),
    ...p.switches.filter((x) => !x.mount).map((x): InventoryItemView => ({ id: x.id, kind: 'switch', itemId: x.modelId, label: `${x.id} · ${catalog.switches.get(x.modelId)?.label ?? x.modelId}`, price: itemPrice(catalog, x.modelId, prices) ?? 0 })),
    ...room.parts.map((q): InventoryItemView => {
      const it = catalog.items.get(q.itemId);
      const label = it?.kind === 'drive' ? `${it.family} ${it.capacityTB} TB` : it?.kind === 'nic' ? it.bomName : q.itemId;
      return { id: q.id, kind: it?.kind === 'nic' ? 'nic' : 'drive', itemId: q.itemId, label, price: itemPrice(catalog, q.itemId, prices) ?? 0 };
    }),
  ];

  const clusterFindings = validateClusterHardware(catalog, p.servers.map((x) => ({ hostId: x.id, config: x.config })), { initialManagementCluster: true, ...(storage ? { storage } : {}) });
  const bringup = specServerIds(s).length ? physicalBringupIssues(s, ctx) : undefined;

  return {
    state: net.state,
    placements: room.rackTiles,
    spent: room.economy.spent,
    cableMeta: room.cableMeta,
    racks,
    servers,
    switches,
    cables,
    inventory,
    catalog: catalogView(catalog, prices),
    ...(room.companyNetwork ? { companyNetwork: room.companyNetwork } : {}),
    endpoints: derivedEndpoints(s),
    clusterIssues: { findings: clusterFindings, groups: groupIssues(clusterFindings) },
    ...(bringup ? { bringupNetwork: groupIssues(bringup) } : {}),
    ...(plan ? { plan } : {}),
    economy: { currency: GAME_CURRENCY, moneyUnlimited: true, spent: room.economy.spent, recent: room.economy.ledger.slice(-20) },
    undo: { canUndo: s.roomHistory.undo.length > 0, canRedo: s.roomHistory.redo.length > 0 },
    bmcRemoteInstallVendors: BMC_REMOTE_INSTALL_VENDORS,
  };
}

function serverView(
  s: SandboxState,
  ctx: SandboxContext,
  srv: PhysicalServer,
  storage: StorageType | undefined,
  net: ReturnType<typeof netContextOf>,
  plan: PlannedHostNetworks | undefined,
): ServerView {
  const { catalog, prices } = ctx;
  const model = catalog.models.get(srv.config.modelId);
  const v = validateServerConfig(catalog, srv.config, { ...(storage ? { storage } : {}), subject: srv.id });
  const resolved = resolveServerConfig(catalog, srv.config);
  const task = serverTask(s, srv.id);
  const online = srv.esx.esxVersion !== undefined && srv.hostNet !== undefined;
  const vmk0 = srv.hostNet?.vmks.find((x) => x.name === 'vmk0');
  const vss0 = srv.hostNet?.switches.find((x) => x.name === 'vSwitch0');
  const status: ServerStatus =
    task?.payload.kind === 'esx-install' ? 'installing' : !srv.mount ? 'unmounted' : !online ? 'no-os' : vmk0?.addressing === 'static' ? 'esx-static' : 'esx-dhcp';
  const nics: ServerNicPort[] = serverNicPorts(catalog, srv);
  const nicPorts = nics.map((n): NicPortView => ({
    ...portView(s, catalog, { kind: 'server-nic', serverId: srv.id, vmnic: n.vmnic }, srv.esx.esxVersion !== undefined ? `vmnic${n.vmnic}` : `NIC ${n.vmnic + 1}`, n.speedsGbE),
    vmnic: n.vmnic,
    partId: n.partId,
    onStandardSwitch: vss0?.uplinks.includes(n.vmnic) === true,
  }));
  const bmcPort = portView(s, catalog, { kind: 'server-bmc', serverId: srv.id }, srv.bmc.label, [1]);
  const test = online && vmk0 ? testManagementNetwork(net, srv.id) : undefined;
  const bmcReach = srv.bmc.ipv4 !== undefined && bmcPort.link?.up === true && derivedEndpoints(s).some((e) => e.kind === 'admin-workstation') ? bmcReachable(net, srv.id) : false;
  const topology = srv.mount
    ? validatePhysicalNetworkForBringup(net, { serverIds: [srv.id], plan: plan ?? TOPOLOGY_ONLY_PLAN, storage: storage ?? 'vsan-esa' }).filter((i) => i.subject === srv.id)
    : [];
  const lastTest = s.room.mgmtTests[srv.id];
  return {
    kind: 'server',
    id: srv.id,
    ...(srv.catalogItemId !== undefined ? { catalogItemId: srv.catalogItemId } : {}),
    ...(model ? { vendor: model.vendor, bcgUrl: model.bcgUrl } : {}),
    modelId: srv.config.modelId,
    modelName: model?.model ?? srv.config.modelId,
    certified91: model ? isCertifiedFor(model, '9.1') : false,
    rackUnits: srv.rackUnits,
    ...(srv.mount ? { mount: srv.mount } : {}),
    config: srv.config,
    ...(resolved.ok ? { metrics: configMetrics(resolved.resolved) } : {}),
    status,
    ...(task ? { taskId: task.id } : {}),
    esx: srv.esx,
    ...(srv.hostNet ? { hostNet: srv.hostNet } : {}),
    nicPorts,
    bmcPort,
    bmc: {
      ...srv.bmc,
      cabled: bmcPort.cableId !== undefined,
      remoteInstallDocumented: model !== undefined && BMC_REMOTE_INSTALL_VENDORS.includes(model.vendor),
      remoteInstallRef: BMC_REMOTE_INSTALL_REF,
      reachableFromAdmin: bmcReach,
      outOfVcfScope: true,
    },
    mgmt: {
      configured: srv.esx.network !== undefined,
      staticIp: vmk0?.addressing === 'static',
      ...(srv.esx.network?.vlanId !== undefined ? { vlan: srv.esx.network.vlanId } : {}),
      ...(vmk0?.ipv4 !== undefined ? { ipv4: vmk0.ipv4 } : {}),
      ...(test ? { gatewayReachable: test.gateway, dnsReachable: test.dns } : {}),
      ...(lastTest ? { lastTest } : {}),
    },
    hw: hwView(v.findings, v.eligible, storage, v.esaProfile),
    topology: groupIssues(topology),
    inDeployedDomain: serverInDeployedDomain(s, srv),
    price: serverConfigPrice(catalog, srv.config, prices),
  };
}


// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

export const FLOWS_ILLUSTRATIVE_NOTE = 'Objemy a rychlosti provozu jsou ilustrativní model (herní hodnoty), toky a protokoly jsou ze specu (Síťový provoz).';

export function flowsView(s: SandboxState, catalog: HardwareCatalog): FlowsView {
  const fctx = flowContextOf(s);
  const tv = computeTrafficFlows(netContextOf(s, catalog), fctx);
  return { ...tv, pairs: flowPairs(tv.flows), activities: fctx.activities ?? [], activeClasses: [...new Set(tv.flows.map((f) => f.trafficClass))], illustrative: true, note: FLOWS_ILLUSTRATIVE_NOTE };
}

const nodeKey = (n: FlowNodeRef): string => `${n.kind}:${n.id}`;

export function flowPairs(flows: readonly TrafficFlow[]): FlowPairView[] {
  const m = new Map<string, { a: FlowNodeRef; b: FlowNodeRef; trafficClass: FlowTrafficClass; loadGbps: number; flowIds: string[]; gameScope: boolean }>();
  for (const f of flows) {
    const [a, b] = nodeKey(f.from) <= nodeKey(f.to) ? [f.from, f.to] : [f.to, f.from];
    const key = `${nodeKey(a)}|${nodeKey(b)}|${f.trafficClass}`;
    const cur = m.get(key) ?? { a, b, trafficClass: f.trafficClass, loadGbps: 0, flowIds: [], gameScope: false };
    cur.loadGbps += f.illustrativeLoadGbps;
    cur.flowIds.push(f.id);
    cur.gameScope = cur.gameScope || f.gameScope === true;
    m.set(key, cur);
  }
  return [...m.entries()].map(([key, v]) => ({ key, ...v }));
}

// ---------------------------------------------------------------------------
// Design hardware context
// ---------------------------------------------------------------------------

export function hwDesignView(s: SandboxState, catalog: HardwareCatalog, decisions: readonly { readonly id: DesignDecisionId; readonly options: readonly { readonly id: string }[] }[]): HwDesignView {
  const context = hardwareContext(s.room.physical, catalog);
  const options: Partial<Record<DesignDecisionId, Record<string, OptionAvailabilityWithHardware>>> = {};
  for (const d of decisions) {
    const per: Record<string, OptionAvailabilityWithHardware> = {};
    for (const o of d.options) per[o.id] = optionAvailabilityWithHardware(d.id, o.id, s.choices, context, s.designContext);
    options[d.id] = per;
  }
  return { context, options };
}
