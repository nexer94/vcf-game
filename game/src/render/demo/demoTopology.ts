/**
 * DEMO topology for the render prototype: two generic racks with a few hosts and a
 * top-of-rack switch pair each; the ToR switches of both racks are interconnected
 * by an overhead link (A<->A, B<->B).
 *
 * ILLUSTRATIVE ONLY ("ilustrativní model"): host counts, names and cabling are
 * arbitrary and do NOT encode any VCF requirement. Replace with snapshot data
 * once the engine models the physical topology.
 */
import type { BoxSpec, CableSpec, DeviceSpec, Topology } from '../scene/topology';

export const DEMO_HOSTS_PER_RACK = 4;
export const DEMO_RACKS = 2;

export function createDemoTopology(): Topology {
  const boxes: BoxSpec[] = [
    { id: 'rack-1', label: 'Rack 1', kind: 'rack', gx: 3, gy: 6, w: 2, d: 1.2, heightPx: 200 },
    { id: 'rack-2', label: 'Rack 2', kind: 'rack', gx: 8, gy: 6, w: 2, d: 1.2, heightPx: 200 },
  ];
  const devices: DeviceSpec[] = [];
  const cables: CableSpec[] = [];

  let hostNo = 0;
  for (let r = 1; r <= DEMO_RACKS; r++) {
    const boxId = `rack-${r}`;
    const torA = `r${r}-tor-a`;
    const torB = `r${r}-tor-b`;
    devices.push({ id: torA, label: `ToR-A (R${r})`, kind: 'switch', boxId, v0: 0.89, v1: 0.95 });
    devices.push({ id: torB, label: `ToR-B (R${r})`, kind: 'switch', boxId, v0: 0.81, v1: 0.87 });
    for (let i = 0; i < DEMO_HOSTS_PER_RACK; i++) {
      hostNo++;
      const id = `host-${String(hostNo).padStart(2, '0')}`;
      const v1 = 0.7 - i * 0.12;
      devices.push({ id, label: id, kind: 'host', boxId, v0: v1 - 0.09, v1 });
      const bulge = 0.6 + i * 0.25;
      cables.push({
        id: `${id}-a`,
        label: `${id} ↔ ToR-A (R${r})`,
        from: { deviceId: id, u: 0.14 },
        to: { deviceId: torA, u: 0.1 + i * 0.07 },
        route: 'loopLeft',
        bulge,
      });
      cables.push({
        id: `${id}-b`,
        label: `${id} ↔ ToR-B (R${r})`,
        from: { deviceId: id, u: 0.86 },
        to: { deviceId: torB, u: 0.9 - i * 0.07 },
        route: 'loopRight',
        bulge,
      });
    }
  }

  // Overhead inter-rack links between the ToR pairs.
  for (const side of ['a', 'b'] as const) {
    const S = side.toUpperCase();
    cables.push({
      id: `tor-${side}-link`,
      label: `ToR-${S} (R1) ↔ ToR-${S} (R2)`,
      from: { deviceId: `r1-tor-${side}`, u: side === 'a' ? 0.6 : 0.5 },
      to: { deviceId: `r2-tor-${side}`, u: side === 'a' ? 0.45 : 0.55 },
      route: 'uplink',
      bulge: side === 'a' ? 1.3 : 0.9,
    });
  }

  return { floor: { cols: 12, rows: 11, aisleRows: [8, 9] }, boxes, devices, cables };
}
