/**
 * DEMO content for the server-room art prototype: 1 rack, 2 generic servers,
 * 1 generic switch and four cables, plus a deterministic traffic source.
 *
 * ILLUSTRATIVE ONLY ("ilustrativní"): positions, unit sizes, capacities, rates and
 * cable types are arbitrary and do NOT encode any VCF requirement or cabling rule.
 * The real Sandbox builds the room from the engine snapshot.
 */
import { deriveLinkTraffic, type LinkTraffic, type TrafficSource } from '../traffic/trafficModel';
import type { TrafficType } from '../traffic/trafficTypes';
import { TAG_COLORS } from './palette';
import type { RoomCableSpec } from './roomCables';
import type { RoomScene } from './roomScene';

export const ROOM_DEMO_CAPACITY_GBPS = 10;
const TAU = Math.PI * 2;

interface DemoLink {
  readonly id: string;
  readonly type: TrafficType;
  readonly mean: number;
  readonly amp: number;
  readonly periodS: number;
  /** Periodic burst that overloads the link (shows red + dropped packets). */
  readonly burst?: { readonly cycleS: number; readonly from: number; readonly to: number; readonly gbps: number };
}

export const ROOM_DEMO_CABLES: readonly (RoomCableSpec & { readonly demo: DemoLink })[] = [
  { id: 'demo-s1-a', from: { deviceId: 'demo-srv-1', port: 0 }, to: { deviceId: 'demo-sw', port: 2 }, type: 'management', label: 'Server 1 · port 1', demo: { id: 'demo-s1-a', type: 'management', mean: 1.2, amp: 0.4, periodS: 9 } },
  { id: 'demo-s1-b', from: { deviceId: 'demo-srv-1', port: 1 }, to: { deviceId: 'demo-sw', port: 3 }, type: 'vsan', label: 'Server 1 · port 2', demo: { id: 'demo-s1-b', type: 'vsan', mean: 5, amp: 2.5, periodS: 13 } },
  { id: 'demo-s2-a', from: { deviceId: 'demo-srv-2', port: 0 }, to: { deviceId: 'demo-sw', port: 6 }, type: 'vmotion', label: 'Server 2 · port 1', demo: { id: 'demo-s2-a', type: 'vmotion', mean: 1, amp: 0.5, periodS: 11, burst: { cycleS: 24, from: 8, to: 16, gbps: 11.5 } } },
  { id: 'demo-s2-b', from: { deviceId: 'demo-srv-2', port: 1 }, to: { deviceId: 'demo-sw', port: 7 }, type: 'overlay', label: 'Server 2 · port 2', demo: { id: 'demo-s2-b', type: 'overlay', mean: 3, amp: 1.5, periodS: 17 } },
];

/** Deterministic per-cable traffic for the demo (pure function of game time). */
export class RoomDemoTraffic implements TrafficSource {
  private t = Number.NaN;
  private cache: ReadonlyMap<string, LinkTraffic> = new Map();

  constructor(private readonly links: readonly DemoLink[] = ROOM_DEMO_CABLES.map((c) => c.demo)) {}

  sample(gameTimeMs: number): ReadonlyMap<string, LinkTraffic> {
    if (gameTimeMs === this.t) return this.cache;
    const s = gameTimeMs / 1000;
    const out = new Map<string, LinkTraffic>();
    this.links.forEach((l, i) => {
      let g = l.mean + l.amp * Math.sin((TAU * s) / l.periodS + i);
      if (l.burst) {
        const x = s % l.burst.cycleS;
        if (x >= l.burst.from && x < l.burst.to) g += l.burst.gbps * Math.min(1, 3 * Math.sin((Math.PI * (x - l.burst.from)) / (l.burst.to - l.burst.from)));
      }
      out.set(l.id, deriveLinkTraffic(l.id, ROOM_DEMO_CAPACITY_GBPS, [{ type: l.type, gbps: Math.max(0, g) }]));
    });
    this.t = gameTimeMs;
    this.cache = out;
    return out;
  }
}

/** Place the illustrative demo set into the room (keeps the avatar). */
export function loadRoomDemo(room: RoomScene): void {
  room.clear();
  const cx = Math.floor(room.size.cols / 2);
  const cy = Math.floor(room.size.rows / 2) - 2;
  room.placeRack('demo-rack', { gx: cx - 2, gy: cy }, 'Rack (ilustrativní)');
  room.addServer('demo-rack', { id: 'demo-srv-1', heightU: 2, u: 12, tagColor: TAG_COLORS[0]!, label: 'Server 1' });
  room.addServer('demo-rack', { id: 'demo-srv-2', heightU: 2, u: 16, tagColor: TAG_COLORS[1]!, label: 'Server 2' });
  room.placeSwitch('demo-sw', { gx: cx + 1, gy: cy }, { label: 'Switch' });
  for (const c of ROOM_DEMO_CABLES) {
    const { demo: _demo, ...spec } = c;
    room.connect(spec);
  }
  room.setTrafficSource(new RoomDemoTraffic());
}
