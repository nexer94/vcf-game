/**
 * RoomState (sessionPort) -> what the renderers draw. Pure mapping, unit-tested.
 *  - room: cabinets (placed racks) with mounted devices, cables (BMC = port -1)
 *  - traffic: per-cable LinkTraffic for the packet dots (model flows, illustrative loads), BMC transfers separately
 *  - rack elevation input
 */
import type { FlowTrafficClass } from '../../model';
import { FlowVolumeSampler, type LinkVolumeSampler, type LinkVolumeView } from '../../modes/sandbox/trafficV3';
import type { ElevRack } from '../../render/rack/rackLayout';
import type { BmcLinkSpec, RoomContents } from '../../render/room/roomScene';
import type { RoomCableSpec } from '../../render/room/roomCables';
import { VENDOR_TAG } from '../../render/room/palette';
import { deriveLinkTraffic, type LinkTraffic, type TrafficSource } from '../../render/traffic/trafficModel';
import type { TrafficType } from '../../render/traffic/trafficTypes';
import type { PortSide, RoomDevice, RoomState } from './sessionPort';

export const roomPortIndex = (p: PortSide): number => (p === 'bmc' ? -1 : p);

export function deviceTagColor(d: RoomDevice): number | undefined {
  return d.vendor ? VENDOR_TAG[d.vendor] : undefined;
}

/** Room contents for RoomScene.syncContents. Devices are mounted only in placed racks. */
export function roomContentsOf(s: RoomState): RoomContents {
  const cabinets = s.racks
    .filter((r) => r.tile)
    .map((r) => ({
      spec: { id: r.id, kind: 'rack' as const, gx: r.tile!.gx, gy: r.tile!.gy, label: r.label, units: r.heightU, facing: r.facing ?? 'S' },
      devices: s.devices
        .filter((d) => d.mount?.rackId === r.id)
        .map((d) => {
          const tag = deviceTagColor(d);
          return { id: d.id, kind: d.kind, u: d.mount!.positionU, heightU: d.heightU, label: d.label, ...(tag !== undefined ? { tagColor: tag } : {}) };
        }),
    }));
  const placed = new Set(cabinets.flatMap((c) => c.devices.map((d) => d.id)));
  // Traffic v3 (UX §28.7): BMC cables are never data cables in the room – they get their own grey dashed wire to the
  // room's wall OOB switch (or to the peer port when that is mounted here, e.g. the demo).
  const bmcLinks: BmcLinkSpec[] = [];
  for (const c of s.cables) {
    const bmcEnd = c.a.port === 'bmc' ? c.a : c.b.port === 'bmc' ? c.b : null;
    if (!bmcEnd || !placed.has(bmcEnd.deviceId)) continue;
    const other = bmcEnd === c.a ? c.b : c.a;
    bmcLinks.push({
      id: c.id,
      server: { deviceId: bmcEnd.deviceId, port: -1 },
      ...(placed.has(other.deviceId) ? { peer: { deviceId: other.deviceId, port: roomPortIndex(other.port) } } : {}),
    });
  }
  const cables: RoomCableSpec[] = s.cables
    .filter((c) => c.a.port !== 'bmc' && c.b.port !== 'bmc' && placed.has(c.a.deviceId) && placed.has(c.b.deviceId))
    .map((c) => ({
      id: c.id,
      from: { deviceId: c.a.deviceId, port: roomPortIndex(c.a.port) },
      to: { deviceId: c.b.deviceId, port: roomPortIndex(c.b.port) },
      type: 'management' as const,
      ...(c.label ? { label: c.label } : {}),
    }));
  return { cabinets, cables, bmcLinks };
}

/** Model flow classes -> render traffic types ('oob' is not VCF traffic: handled as BMC transfer). */
const CLASS_TO_TYPE: Readonly<Record<Exclude<FlowTrafficClass, 'oob'>, TrafficType>> = {
  management: 'management',
  vmotion: 'vmotion',
  vsan: 'vsan',
  nfs: 'nfs',
  overlay: 'overlay',
};

/** Per-cable traffic from the session (model flows; loads are illustrative). */
export function linkTrafficOf(s: RoomState): Map<string, LinkTraffic> {
  const out = new Map<string, LinkTraffic>();
  for (const t of s.traffic) {
    const mix = (Object.keys(t.byClass) as FlowTrafficClass[])
      .filter((k): k is Exclude<FlowTrafficClass, 'oob'> => k !== 'oob' && (t.byClass[k] ?? 0) > 0)
      .map((k) => ({ type: CLASS_TO_TYPE[k], gbps: t.byClass[k]! }));
    if (mix.length) out.set(t.cableId, deriveLinkTraffic(t.cableId, t.speedGbE ?? 1, mix));
  }
  return out;
}

/** Cables with game-scope BMC traffic (grey dashed, never VCF dots). */
export function bmcTransfersOf(s: RoomState): string[] {
  return s.traffic.filter((t) => (t.byClass.oob ?? 0) > 0).map((t) => t.cableId);
}

/**
 * Remote ESX install ISO transfers over BMC (game scope, UX §28.7) from the engine's traffic activities (E-T3):
 * BMC cable id -> progress 0..1. Structural input so it works with any snapshot that carries `trafficActivities`.
 */
export function bmcIsoOf(snapshot: unknown): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const acts = (snapshot as { trafficActivities?: readonly { kind: string; cableIds: readonly string[]; progress?: number }[] } | undefined)?.trafficActivities;
  for (const a of acts ?? []) {
    if (a.kind !== 'iso-transfer') continue;
    for (const id of a.cableIds) out.set(id, typeof a.progress === 'number' ? Math.min(1, Math.max(0, a.progress)) : null);
  }
  return out;
}

/**
 * Traffic v3 adapter (engine E-T1 / E-T6): a LinkVolumeSampler (FlowVolumeSampler / DemoVolumeSampler) as the render's
 * TrafficSource. Only VCF classes become dots / ribbons; 'oob' (BMC) never does (UX §28.7). The SAME instance can
 * feed the room and the rack view, so both show the same picture (also in the demo).
 */
export class VolumeTrafficSource implements TrafficSource {
  private last: ReadonlyMap<string, LinkVolumeView> | null = null;
  private cache: ReadonlyMap<string, LinkTraffic> = new Map();

  constructor(readonly sampler: LinkVolumeSampler) {}

  sample(gameTimeMs: number): ReadonlyMap<string, LinkTraffic> {
    const vols = this.sampler.sample(gameTimeMs);
    if (vols === this.last) return this.cache;
    this.last = vols;
    this.cache = linkTrafficOfVolumes(vols.values());
    return this.cache;
  }

  /** BMC cables with game-scope traffic (grey squares). */
  bmcActive(gameTimeMs = 0): string[] {
    return bmcActiveOfVolumes(this.sampler.sample(gameTimeMs).values());
  }
}

/** Link volumes -> per-cable LinkTraffic (VCF classes only, capacity = link speed). Pure. */
export function linkTrafficOfVolumes(vols: Iterable<LinkVolumeView>): Map<string, LinkTraffic> {
  const out = new Map<string, LinkTraffic>();
  for (const l of vols) {
    if (l.vcfGbps <= 0 || l.gameScopeOnly) continue;
    const mix = (Object.keys(CLASS_TO_TYPE) as Exclude<FlowTrafficClass, 'oob'>[])
      .filter((k) => (l.byClass[k]?.total ?? 0) > 0)
      .map((k) => ({ type: CLASS_TO_TYPE[k], gbps: l.byClass[k]!.total }));
    if (mix.length) out.set(l.cableId, deriveLinkTraffic(l.cableId, l.speedGbE ?? 1, mix));
  }
  return out;
}

export function bmcActiveOfVolumes(vols: Iterable<LinkVolumeView>): string[] {
  const out: string[] = [];
  for (const l of vols) if ((l.byClass.oob?.total ?? 0) > 0) out.push(l.cableId);
  return out;
}

/**
 * The room / rack traffic source of a state: engine link volumes (breathing ±10 %, E-T7) when the backend provides
 * them, else the older per-cable loads.
 */
export function trafficSourceOf(s: RoomState): TrafficSource {
  return s.linkVolumes ? new VolumeTrafficSource(new FlowVolumeSampler(s.linkVolumes, { breathing: true })) : new StaticTrafficSource(linkTrafficOf(s));
}

/** Static traffic source over a precomputed map (the session recomputes flows on change). */
export class StaticTrafficSource implements TrafficSource {
  constructor(private readonly map: ReadonlyMap<string, LinkTraffic>) {}
  sample(): ReadonlyMap<string, LinkTraffic> {
    return this.map;
  }
}

/**
 * Elevation columns (v3, UX 19.3): the selected rack first, then only the other placed racks that share a cable with
 * it (max `maxColumns`). Cables to anything else leave the view upwards (to the ceiling tray).
 */
export function elevationRacks(s: RoomState, rackId: string, maxColumns = 3): ElevRack[] {
  const placed = s.racks.filter((r) => r.tile);
  const sel = placed.find((r) => r.id === rackId);
  if (!sel) return [];
  const rackOf = new Map(s.devices.filter((d) => d.mount).map((d) => [d.id, d.mount!.rackId]));
  const linked = new Set<string>();
  for (const c of s.cables) {
    const ra = rackOf.get(c.a.deviceId);
    const rb = rackOf.get(c.b.deviceId);
    if (ra === rackId && rb && rb !== rackId) linked.add(rb);
    if (rb === rackId && ra && ra !== rackId) linked.add(ra);
  }
  const order = [sel, ...placed.filter((r) => linked.has(r.id))].slice(0, maxColumns);
  return order.map((r) => ({
    id: r.id,
    label: r.label,
    heightU: r.heightU,
    ...(s.torReservations?.[r.id] !== undefined ? { reservedU: s.torReservations[r.id]! } : {}),
    devices: s.devices
      .filter((d) => d.mount?.rackId === r.id)
      .map((d) => {
        const tag = deviceTagColor(d);
        return {
          id: d.id,
          kind: d.kind,
          u: d.mount!.positionU,
          heightU: d.heightU,
          label: d.label,
          sublabel: d.modelLabel,
          ...(tag !== undefined ? { tagColor: tag } : {}),
          nicPorts: d.nicPorts.length,
          bmc: !!d.bmc,
          switchPorts: d.switchPorts,
          ...(d.nicSlots ? { nicSlots: d.nicSlots.map((x) => ({ slot: x.slot, free: !x.nic })) } : {}),
          ...(d.preinstalled ? { preinstalled: true } : {}),
        };
      }),
  }));
}
