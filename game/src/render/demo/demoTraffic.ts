/**
 * DEMO traffic source for the render prototype.
 *
 * Deterministic function of game time that produces per-link traffic for the demo
 * topology (demoTopology.ts): steady background flows + periodic vMotion bursts
 * (one per cycle, sometimes overloading a link; cross-rack bursts also load
 * the inter-rack ToR links) + a periodic vSAN resync on rack 2.
 *
 * ILLUSTRATIVE ONLY ("ilustrativní model"): capacities, rates and timings are
 * arbitrary and are NOT VCF facts. The real traffic simulation belongs to the
 * engine; once it exists, the engine snapshot replaces this source.
 */
import { deriveLinkTraffic, type LinkTraffic, type TrafficComponent, type TrafficSource } from '../traffic/trafficModel';
import { DEMO_HOSTS_PER_RACK, DEMO_RACKS } from './demoTopology';

/** Illustrative link capacities (Gb/s). */
export const DEMO_ACCESS_CAPACITY = 10;
export const DEMO_UPLINK_CAPACITY = 20;

export const VMOTION_CYCLE_S = 40;
export const VMOTION_WINDOW_S: readonly [number, number] = [3, 21];
/** Burst size per cycle (Gb/s) - cycles through: overload, warning, normal. */
export const VMOTION_AMPLITUDES: readonly number[] = [6.8, 4.2, 2];
export const RESYNC_CYCLE_S = 70;
export const RESYNC_WINDOW_S: readonly [number, number] = [28, 50];

const TAU = Math.PI * 2;
const HOSTS = DEMO_HOSTS_PER_RACK * DEMO_RACKS;

function wave(tS: number, mean: number, amp: number, periodS: number, phase: number): number {
  return mean + amp * Math.sin((TAU * tS) / periodS + phase);
}

/** Smooth trapezoid 0..1 inside [start, end) of a cycle. */
export function burstEnvelope(tS: number, cycleS: number, window: readonly [number, number]): number {
  const x = ((tS % cycleS) + cycleS) % cycleS;
  const [a, b] = window;
  if (x < a || x >= b) return 0;
  return Math.min(1, 3 * Math.sin((Math.PI * (x - a)) / (b - a)));
}

export interface VMotionBurst {
  readonly sourceHost: number;
  readonly targetHost: number;
  readonly gbps: number;
}

export function vMotionBurstAt(tS: number): VMotionBurst | null {
  const env = burstEnvelope(tS, VMOTION_CYCLE_S, VMOTION_WINDOW_S);
  if (env <= 0) return null;
  const cycle = Math.floor(tS / VMOTION_CYCLE_S);
  const sourceHost = (cycle * 3) % HOSTS;
  const targetHost = (sourceHost + 5) % HOSTS;
  const amp = VMOTION_AMPLITUDES[cycle % VMOTION_AMPLITUDES.length] ?? 0;
  return { sourceHost, targetHost, gbps: amp * env };
}

const hostId = (i: number): string => `host-${String(i + 1).padStart(2, '0')}`;
const rackOf = (i: number): number => Math.floor(i / DEMO_HOSTS_PER_RACK) + 1;

export class DemoTrafficSource implements TrafficSource {
  private cacheTime = Number.NaN;
  private cache: ReadonlyMap<string, LinkTraffic> = new Map();

  sample(gameTimeMs: number): ReadonlyMap<string, LinkTraffic> {
    if (gameTimeMs === this.cacheTime) return this.cache;
    const tS = gameTimeMs / 1000;
    const out = new Map<string, LinkTraffic>();
    const burst = vMotionBurstAt(tS);
    const resync = burstEnvelope(tS, RESYNC_CYCLE_S, RESYNC_WINDOW_S);

    for (let h = 0; h < HOSTS; h++) {
      const rack = rackOf(h);
      for (const side of ['a', 'b'] as const) {
        const ph = h * 1.7 + (side === 'b' ? 0.9 : 0);
        const mix: TrafficComponent[] = [
          { type: 'management', gbps: wave(tS, 0.15, 0.05, 11, ph) },
          { type: 'vsan', gbps: wave(tS, 2.5, 1.2, 17, ph) + (rack === 2 ? 3.4 * resync : 0) },
          { type: 'overlay', gbps: wave(tS, 1.2, 0.6, 23, ph * 0.7) },
          { type: 'vm', gbps: wave(tS, 0.6, 0.3, 9, ph * 1.3) },
        ];
        if (rack === 2) mix.push({ type: 'nfs', gbps: wave(tS, 1, 0.5, 13, ph) });
        if (burst && side === 'a' && (burst.sourceHost === h || burst.targetHost === h)) {
          mix.push({ type: 'vmotion', gbps: burst.gbps });
        }
        const id = `${hostId(h)}-${side}`;
        out.set(id, deriveLinkTraffic(id, DEMO_ACCESS_CAPACITY, mix));
      }
    }

    const crossRack = burst !== null && rackOf(burst.sourceHost) !== rackOf(burst.targetHost);
    for (const side of ['a', 'b'] as const) {
      const ph = side === 'b' ? 1.3 : 0;
      const mix: TrafficComponent[] = [
        { type: 'management', gbps: wave(tS, 0.4, 0.1, 15, ph) },
        { type: 'overlay', gbps: wave(tS, 4, 2, 29, ph) },
        { type: 'vm', gbps: wave(tS, 3, 1.5, 19, ph) },
        { type: 'vsan', gbps: wave(tS, 1.5, 0.8, 21, ph) },
      ];
      if (crossRack && side === 'a') mix.push({ type: 'vmotion', gbps: burst.gbps });
      const id = `tor-${side}-link`;
      out.set(id, deriveLinkTraffic(id, DEMO_UPLINK_CAPACITY, mix));
    }

    this.cacheTime = gameTimeMs;
    this.cache = out;
    return out;
  }
}
