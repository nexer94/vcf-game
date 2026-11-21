/**
 * "Ukázka (ilustrativní)" – fills an ISOLATED room port with a sample build through the normal port commands
 * (so the rack view, cabling and bundles work in the demo too) and returns an illustrative traffic source.
 * Loads / mixes are ILLUSTRATIVE (no VCF fact): they only show how traffic looks; real flows come from the model.
 */
import type { FlowTrafficClass } from '../../model';
import { DemoVolumeSampler, type DemoLinkVolumeDef } from '../../modes/sandbox/trafficV3';
import { VolumeTrafficSource } from './roomSync';
import type { PortResult, RoomPort } from './sessionPort';

type TrafficType = Exclude<FlowTrafficClass, 'oob'>;

export interface DemoBuild {
  /** Illustrative demo volumes through the engine contract (E-T6) – one source for the room AND the rack view. */
  readonly traffic: VolumeTrafficSource;
  /** BMC cable shown with the game-scope "ISO transfer" animation. */
  readonly bmcCables: readonly string[];
}

const idOf = (r: PortResult): string => {
  if (!r.ok || !r.id) throw new Error(`demo build failed: ${r.ok ? 'no id' : r.message}`);
  return r.id;
};

export function buildDemoRoom(port: RoomPort): DemoBuild {
  const r1 = idOf(port.buyItem('rack-generic-42u'));
  const r2 = idOf(port.buyItem('rack-generic-42u'));
  idOf(port.placeRack(r1, { gx: 3, gy: 2 }));
  idOf(port.placeRack(r2, { gx: 6, gy: 2 }));
  const swA = idOf(port.buyItem('sw-generic-48x25g'));
  const swB = idOf(port.buyItem('sw-generic-48x25g'));
  idOf(port.mountDevice(swA, r1, 42));
  idOf(port.mountDevice(swB, r1, 41));
  const s1 = idOf(port.buyItem('dell-r670-med'));
  const s2 = idOf(port.buyItem('dell-r670-med'));
  const s3 = idOf(port.buyItem('dell-r670-med'));
  idOf(port.mountDevice(s1, r1, 20));
  idOf(port.mountDevice(s2, r1, 22));
  idOf(port.mountDevice(s3, r2, 20));
  const links: { id: string; type: TrafficType; mean: number; amp: number; periodS: number; burst?: { cycleS: number; from: number; to: number; gbps: number } }[] = [];
  const cable = (a: string, ap: number | 'bmc', b: string, bp: number, type: TrafficType | null, mean = 1, amp = 0.5, periodS = 11, burst?: (typeof links)[number]['burst']): string => {
    const id = idOf(port.connectCable({ deviceId: a, port: ap }, { deviceId: b, port: bp }));
    if (type) links.push({ id, type, mean, amp, periodS, ...(burst ? { burst } : {}) });
    return id;
  };
  cable(s1, 0, swA, 0, 'management', 1.2, 0.4, 9);
  cable(s1, 1, swB, 0, 'vsan', 5, 2.5, 13);
  cable(s2, 0, swA, 1, 'vmotion', 1, 0.5, 11, { cycleS: 24, from: 8, to: 16, gbps: 11.5 });
  cable(s2, 1, swB, 1, 'overlay', 3, 1.5, 17);
  cable(s3, 0, swA, 2, 'management', 1, 0.4, 10);
  cable(s3, 1, swB, 2, 'vsan', 4, 2, 15);
  const bmc = cable(s3, 'bmc', swA, 40, null);
  const defs: DemoLinkVolumeDef[] = links.map((l) => ({ cableId: l.id, trafficClass: l.type, mean: l.mean, amp: l.amp, periodS: l.periodS, ...(l.burst ? { burst: l.burst } : {}) }));
  return { traffic: new VolumeTrafficSource(new DemoVolumeSampler(defs, port.state().linkVolumes ?? [])), bmcCables: [bmc] };
}
