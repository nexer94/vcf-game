/**
 * Provoz v3 – engine data for the traffic visualisation (UX.md ch. 28, §28.17 E-T1 … E-T7).
 *
 * FACTS vs GAME VALUES:
 *  - WHICH flows exist and between whom stays exclusively the model's `computeTrafficFlows` (specs 25 §7, 20 §7,
 *    10 §7). Nothing here creates a flow.
 *  - HOW MUCH flows is the illustrative model (`ILLUSTRATIVE_LOAD_GBPS`, game values). Everything in this file only
 *    re-aggregates those numbers (per link × direction × class, per rack, per device) or animates them
 *    deterministically (breathing ±10 %, demo waves) – always flagged `illustrative: true`, UI label
 *    "ilustrativní model".
 *  - Activity durations are the illustrative task durations (durations.ts, game values, UI label "herní").
 *
 * Direction convention (E-T1): every cable has ends `a` and `b` (model Cable). `ab` = volume travelling from the
 * `a` end to the `b` end, `ba` the opposite. A one-way flow (`bidirectional: false`, e.g. NTP, heartbeat) puts its
 * whole load into the direction it travels; a two-way flow is split half / half. Hence `ab + ba = total`, and
 * `total` equals the model aggregate `LinkTraffic.totalLoadGbps` (also `utilization = total / speed` is the same).
 *
 * Pure TypeScript – no DOM, no PixiJS.
 */
import {
  type Cable,
  type FlowNodeRef,
  type FlowTrafficClass,
  type HardwareCatalog,
  type NetContext,
  type NetworkActivity,
  type PhysicalState,
  type PortRef,
  type TrafficFlow,
  linkStatus,
} from '../../model';
import type { CompanyNetworkLink, SandboxState, SandboxTask, SandboxTaskKind } from './types';
import { taskProgress, taskRemainingMs } from '../../engine';

// ===========================================================================
// Types (stable contract for render / ui – UX 28.17)
// ===========================================================================

/** Fixed class order of lanes / stripes (UX 28.5): Management → vMotion → vSAN → NFS → overlay; BMC ('oob') last. */
export const TRAFFIC_CLASS_ORDER: readonly FlowTrafficClass[] = ['management', 'vmotion', 'vsan', 'nfs', 'overlay', 'oob'];

/** Gb/s in each direction of a cable (illustrative). `total = ab + ba`. */
export interface DirectionalVolume {
  readonly ab: number;
  readonly ba: number;
  readonly total: number;
}

/** What the cable connects (for cable colours, UX 28.8). */
export type LinkKind = 'host-data' | 'bmc' | 'switch-switch' | 'other';

/** E-T1: per cable, per direction, per traffic class volume. One entry per cable (also idle / down ones). */
export interface LinkVolumeView {
  readonly cableId: string;
  readonly a: PortRef;
  readonly b: PortRef;
  /** Server / switch id at each end (render device ids). */
  readonly aDeviceId: string;
  readonly bDeviceId: string;
  readonly kind: LinkKind;
  readonly up: boolean;
  readonly speedGbE?: number;
  /** Only classes with traffic are present. 'oob' = BMC (game scope: never a ribbon / Gb/s number, UX 28.7). */
  readonly byClass: Readonly<Partial<Record<FlowTrafficClass, DirectionalVolume>>>;
  /** Sums over VCF classes AND 'oob' (same as the model's LinkTraffic.totalLoadGbps). */
  readonly abGbps: number;
  readonly baGbps: number;
  readonly totalGbps: number;
  /** Sum over VCF classes only (without 'oob') – use this for ribbon width / numbers. */
  readonly vcfGbps: number;
  /** total / speed (same as LinkTraffic.utilization; 0 without speed). */
  readonly utilization: number;
  /** max(ab, ba) / speed – a full-duplex link fills per direction. */
  readonly peakDirectionUtilization: number;
  readonly flowIds: readonly string[];
  /** Only BMC ('oob') traffic on the cable. */
  readonly gameScopeOnly: boolean;
  /** Volumes are the illustrative model (always true). */
  readonly illustrative: true;
  /** Set on sampled copies: 'breathing' (E-T7) or 'demo' (E-T6 Ukázka). Absent = the model's static value. */
  readonly variation?: 'breathing' | 'demo';
}

/**
 * Volume at a switch port with service endpoints plugged in (no cable in the model): "Síť firmy" uplink, the OOB
 * switch's admin port. `ab` = switch → endpoints (out of the room), `ba` = endpoints → switch.
 */
export interface AttachmentVolumeView {
  readonly key: string;
  readonly switchId: string;
  readonly port: number;
  readonly endpointIds: readonly string[];
  /** The company network link ("Síť firmy", herní). */
  readonly companyNetwork: boolean;
  readonly byClass: Readonly<Partial<Record<FlowTrafficClass, DirectionalVolume>>>;
  readonly abGbps: number;
  readonly baGbps: number;
  readonly totalGbps: number;
  readonly vcfGbps: number;
  readonly flowIds: readonly string[];
  readonly gameScopeOnly: boolean;
  readonly illustrative: true;
}

/** E-T4: one end of a flow resolved to a device in the room. */
export interface FlowEndView {
  readonly node: FlowNodeRef;
  /** Server id (server, host-vm endpoint) or switch id (endpoint plugged into a switch port). */
  readonly deviceId?: string;
  readonly rackId?: string;
  readonly via: 'device' | 'switch-port' | 'host-vm' | 'unknown';
  readonly switchPort?: { readonly switchId: string; readonly port: number };
  /** Endpoint behind the "Síť firmy" link (herní). */
  readonly companyNetwork: boolean;
}

/** E-T4: flow → endpoints, switches on the path and racks (lens "rozevřený rack": host ↔ ToR ↔ host). */
export interface FlowEndsView {
  readonly flowId: string;
  readonly trafficClass: FlowTrafficClass;
  readonly from: FlowEndView;
  readonly to: FlowEndView;
  /** Switches in path order (from → to), duplicates of consecutive hops removed. */
  readonly switchIds: readonly string[];
  /** Distinct racks touched (ends + switches) in path order. */
  readonly rackIds: readonly string[];
  /** Every device of the flow sits in one rack (incl. its switches). */
  readonly sameRack: boolean;
  readonly cableIds: readonly string[];
  readonly bidirectional: boolean;
  readonly loadGbps: number;
  readonly gameScope: boolean;
}

/** Per rack: VCF traffic inside the rack (both cable ends in the rack) and leaving it (UX 28.6 riser / ⇅ badge). */
export interface RackVolumeView {
  readonly rackId: string;
  readonly internalByClass: Readonly<Partial<Record<FlowTrafficClass, number>>>;
  readonly internalGbps: number;
  readonly externalByClass: Readonly<Partial<Record<FlowTrafficClass, number>>>;
  readonly externalGbps: number;
  /** Cables with BMC traffic in the rack (count only – never Gb/s, UX 28.7). */
  readonly bmcCables: number;
}

/** Per device: VCF traffic on all its cables (LED blink rate, UX 28.4 / 28.6). Never includes 'oob'. */
export interface DeviceVolumeView {
  readonly deviceId: string;
  readonly byClass: Readonly<Partial<Record<FlowTrafficClass, number>>>;
  readonly totalGbps: number;
}

/** The v3 additions of the flows view (sandbox `FlowsView` and scenario `ScenarioFlowsView`). */
export interface TrafficV3View {
  readonly linkVolumes: readonly LinkVolumeView[];
  readonly attachmentVolumes: readonly AttachmentVolumeView[];
  /** E-T4: mounted device (server / switch) id → rack id. */
  readonly deviceRacks: Readonly<Record<string, string>>;
  readonly flowEnds: readonly FlowEndsView[];
  readonly rackVolumes: readonly RackVolumeView[];
  readonly deviceVolumes: readonly DeviceVolumeView[];
}

// ===========================================================================
// Helpers
// ===========================================================================

export const deviceOfPort = (p: PortRef): string => (p.kind === 'switch' ? p.switchId : p.serverId);

function linkKind(c: Cable): LinkKind {
  if (c.a.kind === 'server-bmc' || c.b.kind === 'server-bmc') return 'bmc';
  if (c.a.kind === 'switch' && c.b.kind === 'switch') return 'switch-switch';
  if ((c.a.kind === 'server-nic' && c.b.kind === 'switch') || (c.b.kind === 'server-nic' && c.a.kind === 'switch')) return 'host-data';
  return 'other';
}

const endsOnSwitch = (p: PortRef, sw: string): boolean => p.kind === 'switch' && p.switchId === sw;

/**
 * Direction(s) in which a flow crosses each of its cables, from the ordered hops (`from` → `to`).
 * A cable after switch S is crossed from its S end; the first cable (no switch before it) towards the next switch.
 */
export function cableDirections(cables: ReadonlyMap<string, Cable>, flow: Pick<TrafficFlow, 'hops'>): Map<string, Set<'ab' | 'ba'>> {
  const out = new Map<string, Set<'ab' | 'ba'>>();
  const hops = flow.hops;
  let prevSwitch: string | undefined;
  hops.forEach((h, i) => {
    if (h.kind === 'switch') {
      prevSwitch = h.switchId;
      return;
    }
    if (h.kind !== 'cable') return;
    const c = cables.get(h.cableId);
    if (!c) return;
    let dir: 'ab' | 'ba' = 'ab';
    if (prevSwitch !== undefined && (endsOnSwitch(c.a, prevSwitch) || endsOnSwitch(c.b, prevSwitch))) dir = endsOnSwitch(c.a, prevSwitch) ? 'ab' : 'ba';
    else {
      const next = hops[i + 1];
      if (next?.kind === 'switch') dir = endsOnSwitch(c.b, next.switchId) ? 'ab' : endsOnSwitch(c.a, next.switchId) ? 'ba' : 'ab';
    }
    const set = out.get(c.id) ?? new Set<'ab' | 'ba'>();
    set.add(dir);
    out.set(c.id, set);
    prevSwitch = undefined;
  });
  return out;
}

type MutVol = { ab: number; ba: number };
type Acc = { byClass: Partial<Record<FlowTrafficClass, MutVol>>; flowIds: string[] };

function addVol(acc: Acc, tc: FlowTrafficClass, ab: number, ba: number, flowId: string): void {
  const v = acc.byClass[tc] ?? { ab: 0, ba: 0 };
  v.ab += ab;
  v.ba += ba;
  acc.byClass[tc] = v;
  if (!acc.flowIds.includes(flowId)) acc.flowIds.push(flowId);
}

/** Splits a flow load over the crossing directions (see header: one-way = whole load, two-way = half / half). */
function split(load: number, bidirectional: boolean, dirs: ReadonlySet<'ab' | 'ba'>): MutVol {
  if (bidirectional || dirs.size === 2) return { ab: load / 2, ba: load / 2 };
  return dirs.has('ba') ? { ab: 0, ba: load } : { ab: load, ba: 0 };
}

function finishClasses(byClass: Partial<Record<FlowTrafficClass, MutVol>>): { byClass: Partial<Record<FlowTrafficClass, DirectionalVolume>>; ab: number; ba: number; vcf: number } {
  const out: Partial<Record<FlowTrafficClass, DirectionalVolume>> = {};
  let ab = 0;
  let ba = 0;
  let vcf = 0;
  for (const tc of TRAFFIC_CLASS_ORDER) {
    const v = byClass[tc];
    if (!v || v.ab + v.ba <= 0) continue;
    out[tc] = { ab: v.ab, ba: v.ba, total: v.ab + v.ba };
    ab += v.ab;
    ba += v.ba;
    if (tc !== 'oob') vcf += v.ab + v.ba;
  }
  return { byClass: out, ab, ba, vcf };
}

const onlyOob = (byClass: Partial<Record<FlowTrafficClass, unknown>>): boolean => {
  const keys = Object.keys(byClass);
  return keys.length > 0 && keys.every((k) => k === 'oob');
};

// ===========================================================================
// E-T1: link volumes
// ===========================================================================

/** Per-cable, per-direction, per-class volumes of a flow list (one entry per cable of `ctx.state`). */
export function linkVolumes(ctx: NetContext, flows: readonly TrafficFlow[]): LinkVolumeView[] {
  const { state, catalog } = ctx;
  const cables = new Map(state.cables.map((c) => [c.id, c]));
  const acc = new Map<string, Acc>();
  for (const f of flows) {
    for (const [cid, dirs] of cableDirections(cables, f)) {
      const a = acc.get(cid) ?? { byClass: {}, flowIds: [] };
      const v = split(f.illustrativeLoadGbps, f.bidirectional, dirs);
      addVol(a, f.trafficClass, v.ab, v.ba, f.id);
      acc.set(cid, a);
    }
  }
  return state.cables.map((c) => linkVolumeOf(c, linkStatus(state, catalog, c), acc.get(c.id)));
}

function linkVolumeOf(c: Cable, ls: { readonly up: boolean; readonly speedGbE?: number }, a: Acc | undefined): LinkVolumeView {
  const fin = finishClasses(a?.byClass ?? {});
  const total = fin.ab + fin.ba;
  const speed = ls.speedGbE;
  return {
    cableId: c.id,
    a: c.a,
    b: c.b,
    aDeviceId: deviceOfPort(c.a),
    bDeviceId: deviceOfPort(c.b),
    kind: linkKind(c),
    up: ls.up,
    ...(speed !== undefined ? { speedGbE: speed } : {}),
    byClass: fin.byClass,
    abGbps: fin.ab,
    baGbps: fin.ba,
    totalGbps: total,
    vcfGbps: fin.vcf,
    utilization: speed ? total / speed : 0,
    peakDirectionUtilization: speed ? Math.max(fin.ab, fin.ba) / speed : 0,
    flowIds: a?.flowIds ?? [],
    gameScopeOnly: onlyOob(fin.byClass),
    illustrative: true,
  };
}

/** Volumes at switch ports with endpoints plugged in (Síť firmy, OOB admin port). Only ports that carry a flow. */
export function attachmentVolumes(state: PhysicalState, flows: readonly TrafficFlow[], companyNetwork?: CompanyNetworkLink): AttachmentVolumeView[] {
  const ports = new Map<string, { switchId: string; port: number; endpointIds: string[] }>();
  const epPort = new Map<string, string>();
  for (const e of state.endpoints) {
    if (e.attachment.kind !== 'switch-port') continue;
    const key = `${e.attachment.switchId}:${e.attachment.port}`;
    const p = ports.get(key) ?? { switchId: e.attachment.switchId, port: e.attachment.port, endpointIds: [] };
    p.endpointIds.push(e.id);
    ports.set(key, p);
    epPort.set(e.id, key);
  }
  const acc = new Map<string, Acc>();
  for (const f of flows) {
    // The model has no cable for the endpoint side: from an endpoint = into the room (ba), to an endpoint = out (ab).
    const fromKey = f.from.kind === 'endpoint' ? epPort.get(f.from.id) : undefined;
    const toKey = f.to.kind === 'endpoint' ? epPort.get(f.to.id) : undefined;
    if (fromKey !== undefined && fromKey === toKey) continue; // two services behind the same port: never enters the room
    for (const [key, outward] of [[fromKey, false], [toKey, true]] as const) {
      if (key === undefined) continue;
      const a = acc.get(key) ?? { byClass: {}, flowIds: [] };
      const v = split(f.illustrativeLoadGbps, f.bidirectional, new Set([outward ? 'ab' : 'ba'] as const));
      addVol(a, f.trafficClass, v.ab, v.ba, f.id);
      acc.set(key, a);
    }
  }
  const out: AttachmentVolumeView[] = [];
  for (const [key, a] of acc) {
    const p = ports.get(key);
    if (!p) continue;
    const fin = finishClasses(a.byClass);
    out.push({
      key,
      switchId: p.switchId,
      port: p.port,
      endpointIds: p.endpointIds,
      companyNetwork: companyNetwork !== undefined && companyNetwork.switchId === p.switchId && companyNetwork.port === p.port,
      byClass: fin.byClass,
      abGbps: fin.ab,
      baGbps: fin.ba,
      totalGbps: fin.ab + fin.ba,
      vcfGbps: fin.vcf,
      flowIds: a.flowIds,
      gameScopeOnly: onlyOob(fin.byClass),
      illustrative: true,
    });
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

// ===========================================================================
// E-T4: device → rack, flow → endpoints
// ===========================================================================

export function deviceRacksOf(state: PhysicalState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of [...state.servers, ...state.switches]) if (d.mount) out[d.id] = d.mount.rackId;
  return out;
}

function flowEnd(state: PhysicalState, racks: Readonly<Record<string, string>>, node: FlowNodeRef, companyNetwork?: CompanyNetworkLink): FlowEndView {
  const withRack = (deviceId: string): { deviceId: string; rackId?: string } => {
    const rackId = racks[deviceId];
    return rackId !== undefined ? { deviceId, rackId } : { deviceId };
  };
  if (node.kind === 'server') return { node, ...withRack(node.id), via: 'device', companyNetwork: false };
  const ep = state.endpoints.find((e) => e.id === node.id);
  if (!ep) return { node, via: 'unknown', companyNetwork: false };
  const at = ep.attachment;
  if (at.kind === 'host-vm') return { node, ...withRack(at.serverId), via: 'host-vm', companyNetwork: false };
  return {
    node,
    ...withRack(at.switchId),
    via: 'switch-port',
    switchPort: { switchId: at.switchId, port: at.port },
    companyNetwork: companyNetwork !== undefined && companyNetwork.switchId === at.switchId && companyNetwork.port === at.port,
  };
}

export function flowEndsOf(state: PhysicalState, flows: readonly TrafficFlow[], companyNetwork?: CompanyNetworkLink, racks: Readonly<Record<string, string>> = deviceRacksOf(state)): FlowEndsView[] {
  return flows.map((f) => {
    const from = flowEnd(state, racks, f.from, companyNetwork);
    const to = flowEnd(state, racks, f.to, companyNetwork);
    const switchIds: string[] = [];
    for (const h of f.hops) if (h.kind === 'switch' && switchIds[switchIds.length - 1] !== h.switchId) switchIds.push(h.switchId);
    const rackIds: string[] = [];
    const pushRack = (r: string | undefined): void => {
      if (r !== undefined && !rackIds.includes(r)) rackIds.push(r);
    };
    pushRack(from.rackId);
    for (const s of switchIds) pushRack(racks[s]);
    pushRack(to.rackId);
    const unracked = [from.deviceId, to.deviceId, ...switchIds].some((d) => d === undefined || racks[d] === undefined);
    return {
      flowId: f.id,
      trafficClass: f.trafficClass,
      from,
      to,
      switchIds,
      rackIds,
      sameRack: rackIds.length === 1 && !unracked,
      cableIds: f.cableIds,
      bidirectional: f.bidirectional,
      loadGbps: f.illustrativeLoadGbps,
      gameScope: f.gameScope === true,
    };
  });
}

// ===========================================================================
// Rack / device aggregates (pure: also usable on sampled volumes, E-T6 / E-T7)
// ===========================================================================

export function rackVolumesOf(links: readonly LinkVolumeView[], racks: Readonly<Record<string, string>>): RackVolumeView[] {
  type R = { internal: Partial<Record<FlowTrafficClass, number>>; external: Partial<Record<FlowTrafficClass, number>>; bmc: number };
  const m = new Map<string, R>();
  const get = (id: string): R => {
    const r = m.get(id) ?? { internal: {}, external: {}, bmc: 0 };
    m.set(id, r);
    return r;
  };
  for (const id of new Set(Object.values(racks))) get(id);
  for (const l of links) {
    const ra = racks[l.aDeviceId];
    const rb = racks[l.bDeviceId];
    if (l.byClass.oob) for (const r of new Set([ra, rb])) if (r !== undefined) get(r).bmc++;
    for (const tc of TRAFFIC_CLASS_ORDER) {
      const v = l.byClass[tc];
      if (tc === 'oob' || !v) continue;
      if (ra !== undefined && ra === rb) get(ra).internal[tc] = (get(ra).internal[tc] ?? 0) + v.total;
      else
        for (const r of [ra, rb])
          if (r !== undefined) get(r).external[tc] = (get(r).external[tc] ?? 0) + v.total;
    }
  }
  const sum = (x: Partial<Record<FlowTrafficClass, number>>): number => Object.values(x).reduce((s, v) => s + (v ?? 0), 0);
  return [...m.entries()]
    .map(([rackId, r]) => ({ rackId, internalByClass: r.internal, internalGbps: sum(r.internal), externalByClass: r.external, externalGbps: sum(r.external), bmcCables: r.bmc }))
    .sort((x, y) => x.rackId.localeCompare(y.rackId));
}

export function deviceVolumesOf(links: readonly LinkVolumeView[]): DeviceVolumeView[] {
  const m = new Map<string, Partial<Record<FlowTrafficClass, number>>>();
  for (const l of links)
    for (const d of new Set([l.aDeviceId, l.bDeviceId])) {
      const cur = m.get(d) ?? {};
      for (const tc of TRAFFIC_CLASS_ORDER) {
        const v = l.byClass[tc];
        if (tc !== 'oob' && v) cur[tc] = (cur[tc] ?? 0) + v.total;
      }
      m.set(d, cur);
    }
  return [...m.entries()]
    .map(([deviceId, byClass]) => ({ deviceId, byClass, totalGbps: Object.values(byClass).reduce((s, v) => s + (v ?? 0), 0) }))
    .sort((x, y) => x.deviceId.localeCompare(y.deviceId));
}

/** All v3 additions for a flow list in a room. `ctx.state.endpoints` must contain the flows' endpoints. */
export function trafficV3View(ctx: NetContext, flows: readonly TrafficFlow[], companyNetwork?: CompanyNetworkLink): TrafficV3View {
  const deviceRacks = deviceRacksOf(ctx.state);
  const links = linkVolumes(ctx, flows);
  return {
    linkVolumes: links,
    attachmentVolumes: attachmentVolumes(ctx.state, flows, companyNetwork),
    deviceRacks,
    flowEnds: flowEndsOf(ctx.state, flows, companyNetwork, deviceRacks),
    rackVolumes: rackVolumesOf(links, deviceRacks),
    deviceVolumes: deviceVolumesOf(links),
  };
}

// ===========================================================================
// E-T2: traffic revision
// ===========================================================================

/**
 * Signature of the traffic picture (flows + their cables + volumes + link state). The session bumps
 * `trafficRevision` only when it changes, so render can detect flow start / end without diffing the whole map.
 */
export function trafficSignature(flows: readonly TrafficFlow[], links: readonly Pick<LinkVolumeView, 'cableId' | 'up' | 'speedGbE'>[]): string {
  const f = flows.map((x) => `${x.id}@${x.illustrativeLoadGbps}:${x.cableIds.join(',')}`).sort();
  const l = links.map((x) => `${x.cableId}${x.up ? '+' : '-'}${x.speedGbE ?? ''}`).sort();
  return `${f.join('|')}#${l.join('|')}`;
}

// ===========================================================================
// E-T3: activities with timing
// ===========================================================================

export type TrafficActivityKind = NetworkActivity['kind'] | 'iso-transfer';

/** A running activity that drives activity flows (or the game-scope ISO transfer over the BMC cable). */
export interface TrafficActivityView {
  /** = task id. */
  readonly id: string;
  readonly kind: TrafficActivityKind;
  readonly taskKind: SandboxTaskKind;
  readonly label: string;
  readonly serverId?: string;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly elapsedMs: number;
  readonly remainingMs: number;
  /** 0..1 */
  readonly progress: number;
  /** Durations are game values (durations.ts) – UI label "herní". */
  readonly illustrativeDuration: boolean;
  /** Flows of the model that exist because of this activity (trigger 'activity'). Empty for 'iso-transfer'. */
  readonly flowIds: readonly string[];
  /** Cables used by those flows; for 'iso-transfer' the BMC cable of the server (game scope, UX 28.7). */
  readonly cableIds: readonly string[];
  /** 'iso-transfer' is out of VCF scope (BMC virtual media, game animation only). */
  readonly gameScope: boolean;
}

/** Activity flow ids by the model's id scheme (computeTrafficFlows). */
function activityFlowFilter(kind: NetworkActivity['kind'], serverId?: string): (f: TrafficFlow) => boolean {
  switch (kind) {
    case 'dcui-test-management-network':
      return (f) => f.trigger === 'activity' && (f.id.startsWith(`dcui-gw:${serverId}:`) || f.id.startsWith(`dcui-dns:${serverId}:`));
    case 'installer-validation':
      return (f) => f.trigger === 'activity' && (f.id.startsWith('inst:') || f.id.startsWith('inst-dns:') || f.id.startsWith('vmkping-'));
    case 'bringup':
      return (f) => f.trigger === 'activity' && (f.id.startsWith('inst:') || f.id.startsWith('inst-dns:') || f.id.startsWith('inst-vc:'));
    case 'vmotion':
      return (f) => f.trigger === 'activity' && f.trafficClass === 'vmotion' && f.id.startsWith('vmotion:');
    case 'overlay':
      return (f) => f.trigger === 'activity' && f.trafficClass === 'overlay' && f.id.startsWith('host-tep:');
  }
}

function taskActivity(t: SandboxTask): { kind: TrafficActivityKind; serverId?: string } | undefined {
  const p = t.payload;
  switch (p.kind) {
    case 'mgmt-network-test':
      return { kind: 'dcui-test-management-network', serverId: p.serverId };
    case 'bringup-validation':
      return { kind: 'installer-validation' };
    case 'bringup-deployment':
      return { kind: 'bringup' };
    case 'esx-install':
      return p.method === 'bmc' ? { kind: 'iso-transfer', serverId: p.serverId } : undefined;
    default:
      return undefined;
  }
}

/** E-T3: running tasks that produce traffic, with start time, duration and progress (cheap: per progress tick). */
export function trafficActivitiesOf(s: SandboxState, flows: readonly TrafficFlow[]): TrafficActivityView[] {
  const out: TrafficActivityView[] = [];
  for (const t of s.tasks) {
    const act = taskActivity(t);
    if (!act) continue;
    let flowIds: string[] = [];
    let cableIds: string[] = [];
    if (act.kind === 'iso-transfer') {
      const c = s.room.physical.cables.find((x) => (x.a.kind === 'server-bmc' && x.a.serverId === act.serverId) || (x.b.kind === 'server-bmc' && x.b.serverId === act.serverId));
      if (c) cableIds = [c.id];
    } else {
      const mine = flows.filter(activityFlowFilter(act.kind, act.serverId));
      flowIds = mine.map((f) => f.id);
      cableIds = [...new Set(mine.flatMap((f) => f.cableIds))];
    }
    out.push({
      id: t.id,
      kind: act.kind,
      taskKind: t.kind,
      label: t.label,
      ...(act.serverId !== undefined ? { serverId: act.serverId } : {}),
      startedAtMs: t.startedAtMs,
      durationMs: t.durationMs,
      elapsedMs: t.elapsedMs,
      remainingMs: taskRemainingMs(t),
      progress: taskProgress(t),
      illustrativeDuration: t.illustrativeDuration,
      flowIds,
      cableIds,
      gameScope: act.kind === 'iso-transfer',
    });
  }
  return out;
}

// ===========================================================================
// E-T5: link up / down
// ===========================================================================

/** Cable ids whose link is up (linkStatus: cable present + both ends with a common speed). */
export function upLinkIds(state: PhysicalState, catalog: HardwareCatalog): Set<string> {
  return new Set(state.cables.filter((c) => linkStatus(state, catalog, c).up).map((c) => c.id));
}

// ===========================================================================
// E-T7: breathing, E-T6: one sampler contract for room + rack (also the demo)
// ===========================================================================

/** [GAME] breathing amplitude (±10 %, UX 28.17 E-T7) – illustrative animation, not a VCF value. */
export const ILLUSTRATIVE_BREATHING_AMPLITUDE = 0.1;
const TAU = Math.PI * 2;

/** Deterministic 32-bit FNV-1a hash → [0, 1). */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x1_0000_0000;
}

/** Breathing factor for a (cable, class) at game time: 1 ± amplitude, period 8–20 s, phase from the ids. */
export function breathingFactor(cableId: string, tc: FlowTrafficClass, timeMs: number, amplitude = ILLUSTRATIVE_BREATHING_AMPLITUDE): number {
  const h = hash01(`${cableId}|${tc}`);
  const periodS = 8 + 12 * hash01(`${tc}|${cableId}|p`);
  const amp = Math.max(0, Math.min(ILLUSTRATIVE_BREATHING_AMPLITUDE, amplitude));
  return 1 + amp * Math.sin((TAU * timeMs) / 1000 / periodS + TAU * h);
}

function withClasses(l: LinkVolumeView, byClass: Partial<Record<FlowTrafficClass, DirectionalVolume>>, variation: 'breathing' | 'demo', speedGbE = l.speedGbE): LinkVolumeView {
  const fin = finishClasses(byClass);
  const total = fin.ab + fin.ba;
  const { speedGbE: _old, ...rest } = l;
  void _old;
  return {
    ...rest,
    ...(speedGbE !== undefined ? { speedGbE } : {}),
    byClass: fin.byClass,
    abGbps: fin.ab,
    baGbps: fin.ba,
    totalGbps: total,
    vcfGbps: fin.vcf,
    utilization: speedGbE ? total / speedGbE : 0,
    peakDirectionUtilization: speedGbE ? Math.max(fin.ab, fin.ba) / speedGbE : 0,
    gameScopeOnly: onlyOob(fin.byClass),
    variation,
  };
}

/** E-T7: ±10 % deterministic breathing of VCF classes ('oob' / BMC stays constant). Idle links stay idle. */
export function breatheLinkVolume(l: LinkVolumeView, timeMs: number, amplitude = ILLUSTRATIVE_BREATHING_AMPLITUDE): LinkVolumeView {
  if (l.vcfGbps <= 0) return l;
  const byClass: Partial<Record<FlowTrafficClass, DirectionalVolume>> = {};
  for (const tc of TRAFFIC_CLASS_ORDER) {
    const v = l.byClass[tc];
    if (!v) continue;
    const k = tc === 'oob' ? 1 : breathingFactor(l.cableId, tc, timeMs, amplitude);
    byClass[tc] = { ab: v.ab * k, ba: v.ba * k, total: v.total * k };
  }
  return withClasses(l, byClass, 'breathing');
}

/** E-T6 contract: what room AND rack views read each frame (cable id → volumes at game time). */
export interface LinkVolumeSampler {
  /** Volumes are the illustrative model / demo values. */
  readonly illustrative: true;
  /** True when the values come from the illustrative demo (Ukázka), not from model flows. */
  readonly demo: boolean;
  sample(gameTimeMs: number): ReadonlyMap<string, LinkVolumeView>;
}

/** Model volumes (flows view `linkVolumes`), optionally breathing (E-T7). Cached per game time. */
export class FlowVolumeSampler implements LinkVolumeSampler {
  readonly illustrative = true as const;
  readonly demo = false;
  private readonly base: ReadonlyMap<string, LinkVolumeView>;
  private t = Number.NaN;
  private cache: ReadonlyMap<string, LinkVolumeView>;

  constructor(
    links: readonly LinkVolumeView[],
    private readonly opts: { readonly breathing?: boolean; readonly amplitude?: number } = {},
  ) {
    this.base = new Map(links.map((l) => [l.cableId, l]));
    this.cache = this.base;
  }

  sample(gameTimeMs: number): ReadonlyMap<string, LinkVolumeView> {
    if (!this.opts.breathing) return this.base;
    if (gameTimeMs === this.t) return this.cache;
    const out = new Map<string, LinkVolumeView>();
    for (const [id, l] of this.base) out.set(id, breatheLinkVolume(l, gameTimeMs, this.opts.amplitude));
    this.t = gameTimeMs;
    this.cache = out;
    return out;
  }
}

/**
 * ILLUSTRATIVE demo link (Ukázka `/ukazka`, scenario fallback): arbitrary animation values, NOT VCF facts.
 * Same shape as the ui demo definitions (mean ± amp sine, optional periodic burst).
 */
export interface DemoLinkVolumeDef {
  readonly cableId: string;
  readonly trafficClass: Exclude<FlowTrafficClass, 'oob'>;
  readonly mean: number;
  readonly amp: number;
  readonly periodS: number;
  readonly burst?: { readonly cycleS: number; readonly from: number; readonly to: number; readonly gbps: number };
  /** Default 'both' (half / half). */
  readonly direction?: 'ab' | 'ba' | 'both';
  /** Used when the base link has no speed (default 10). */
  readonly speedGbE?: number;
}

/** [GAME] demo link speed when the cable has none (illustrative). */
export const DEMO_DEFAULT_SPEED_GBE = 10;

export function demoGbps(d: DemoLinkVolumeDef, index: number, gameTimeMs: number): number {
  const s = gameTimeMs / 1000;
  let g = d.mean + d.amp * Math.sin((TAU * s) / d.periodS + index);
  const b = d.burst;
  if (b) {
    const x = s % b.cycleS;
    if (x >= b.from && x < b.to) g += b.gbps * Math.min(1, 3 * Math.sin((Math.PI * (x - b.from)) / (b.to - b.from)));
  }
  return Math.max(0, g);
}

/**
 * E-T6: illustrative demo through the same contract. `base` = the room's link volumes (e.g. the BMC cables keep
 * their 'oob' entry); cables listed in `defs` get the demo volumes (VCF classes replaced, 'oob' kept).
 * Cables with a def but no base entry are synthesised (ends unknown → device ids '').
 */
export class DemoVolumeSampler implements LinkVolumeSampler {
  readonly illustrative = true as const;
  readonly demo = true;
  private readonly base: ReadonlyMap<string, LinkVolumeView>;
  private t = Number.NaN;
  private cache: ReadonlyMap<string, LinkVolumeView> = new Map();

  constructor(
    private readonly defs: readonly DemoLinkVolumeDef[],
    base: readonly LinkVolumeView[] = [],
  ) {
    this.base = new Map(base.map((l) => [l.cableId, l]));
  }

  sample(gameTimeMs: number): ReadonlyMap<string, LinkVolumeView> {
    if (gameTimeMs === this.t) return this.cache;
    const out = new Map(this.base);
    const perCable = new Map<string, Partial<Record<FlowTrafficClass, DirectionalVolume>>>();
    this.defs.forEach((d, i) => {
      const g = demoGbps(d, i, gameTimeMs);
      const dir = d.direction ?? 'both';
      const cur = perCable.get(d.cableId) ?? {};
      const prev = cur[d.trafficClass] ?? { ab: 0, ba: 0, total: 0 };
      const ab = dir === 'both' ? g / 2 : dir === 'ab' ? g : 0;
      const ba = g - ab;
      cur[d.trafficClass] = { ab: prev.ab + ab, ba: prev.ba + ba, total: prev.total + g };
      perCable.set(d.cableId, cur);
    });
    for (const [cableId, cls] of perCable) {
      const b = this.base.get(cableId) ?? syntheticLink(cableId);
      const speed = b.speedGbE ?? this.defs.find((d) => d.cableId === cableId && d.speedGbE !== undefined)?.speedGbE ?? DEMO_DEFAULT_SPEED_GBE;
      const byClass: Partial<Record<FlowTrafficClass, DirectionalVolume>> = { ...cls, ...(b.byClass.oob ? { oob: b.byClass.oob } : {}) };
      out.set(cableId, { ...withClasses(b, byClass, 'demo', speed), flowIds: [] });
    }
    this.t = gameTimeMs;
    this.cache = out;
    return out;
  }
}

function syntheticLink(cableId: string): LinkVolumeView {
  const port: PortRef = { kind: 'switch', switchId: '', port: -1 };
  return { cableId, a: port, b: port, aDeviceId: '', bDeviceId: '', kind: 'other', up: true, byClass: {}, abGbps: 0, baGbps: 0, totalGbps: 0, vcfGbps: 0, utilization: 0, peakDirectionUtilization: 0, flowIds: [], gameScopeOnly: false, illustrative: true };
}
