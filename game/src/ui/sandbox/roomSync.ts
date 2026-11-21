/**
 * RoomState (sessionPort) -> what the renderers draw. Pure mapping, unit-tested.
 *  - room: cabinets (placed racks) with mounted devices, cables (BMC = port -1)
 *  - traffic: per-cable LinkTraffic for the packet dots (model flows, illustrative loads), BMC transfers separately
 *  - rack elevation input
 */
import type { FlowTrafficClass } from '../../model';
import type { ElevRack } from '../../render/rack/rackLayout';
import type { RoomContents } from '../../render/room/roomScene';
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
  const cables: RoomCableSpec[] = s.cables
    .filter((c) => placed.has(c.a.deviceId) && placed.has(c.b.deviceId))
    .map((c) => ({
      id: c.id,
      from: { deviceId: c.a.deviceId, port: roomPortIndex(c.a.port) },
      to: { deviceId: c.b.deviceId, port: roomPortIndex(c.b.port) },
      type: 'management' as const,
      ...(c.label ? { label: c.label } : {}),
    }));
  return { cabinets, cables };
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

/** Static traffic source over a precomputed map (the session recomputes flows on change). */
export class StaticTrafficSource implements TrafficSource {
  constructor(private readonly map: ReadonlyMap<string, LinkTraffic>) {}
  sample(): ReadonlyMap<string, LinkTraffic> {
    return this.map;
  }
}

/**
 * Elevation columns: the selected rack first, then the other placed racks that share a cable with it, then the rest
 * (max `maxColumns`).
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
  const order = [sel, ...placed.filter((r) => linked.has(r.id)), ...placed.filter((r) => r.id !== rackId && !linked.has(r.id))].slice(0, maxColumns);
  return order.map((r) => ({
    id: r.id,
    label: r.label,
    heightU: r.heightU,
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
        };
      }),
  }));
}
