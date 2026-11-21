/**
 * Visual packet simulation (pure, no PixiJS): spawns glowing "packets" along cables
 * with density proportional to offered load, coloured by traffic type; on overloaded
 * links some packets are dropped and fall off the cable.
 *
 * This is purely visual - it does not decide what traffic exists (that comes from
 * the TrafficSource / engine snapshot). Packet pool is preallocated (no GC churn).
 */
import { bezierPoint, type CubicBezier, type Vec2 } from '../geom/bezier';
import { createRng, weightedIndex } from '../util/rng';
import type { LinkTraffic } from './trafficModel';
import { TRAFFIC_STYLE } from './trafficTypes';

export const DROP_COLOR = 0xe5484d;

/**
 * What the simulation needs from a cable: link id (key into TrafficSource data),
 * curve and length. Datacenter CableGeometry and room cables both satisfy it.
 */
export interface PacketPath {
  readonly spec: { readonly id: string };
  readonly curve: CubicBezier;
  readonly length: number;
}

export interface SimPacket {
  cable: number;
  /** Progress along the cable in travel direction, 0..1. */
  progress: number;
  /** Progress per game ms. */
  speed: number;
  /** +1 = from -> to, -1 = to -> from. */
  dir: 1 | -1;
  /** Progress at which the packet is dropped; > 1 = never. */
  dropAt: number;
  falling: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining fade time for falling packets (real ms). */
  life: number;
  color: number;
  alpha: number;
}

export interface PacketSimOptions {
  readonly maxPackets: number;
  /** Packets spawned per game second per Gb/s of offered load. */
  readonly packetsPerGbps: number;
  /** Travel speed in world px per game ms. */
  readonly speedPxPerMs: number;
  /** Visual exaggeration of the drop fraction so drops are noticeable. */
  readonly dropVisualBoost: number;
  /** Fade-out time of dropped packets (real ms, so it is visible at 16x too). */
  readonly fallMs: number;
  readonly seed: number;
}

export const DEFAULT_PACKET_SIM: PacketSimOptions = {
  maxPackets: 1500,
  packetsPerGbps: 1.6,
  speedPxPerMs: 0.09,
  dropVisualBoost: 4,
  fallMs: 900,
  seed: 1337,
};

const GRAVITY = 0.00025; // px / ms^2 (real time)

export class PacketSim {
  readonly packets: SimPacket[];
  /** Number of live packets; packets[0..count) are active. */
  count = 0;
  /** Spawns refused because the pool was full (perf diagnostics). */
  refused = 0;
  private readonly spawnAcc: Float64Array;
  private readonly rng: () => number;
  private readonly tmp: Vec2 = { x: 0, y: 0 };
  private readonly weights: number[] = [];

  constructor(
    private readonly cables: readonly PacketPath[],
    private readonly opts: PacketSimOptions = DEFAULT_PACKET_SIM,
  ) {
    this.rng = createRng(opts.seed);
    this.spawnAcc = new Float64Array(cables.length);
    this.packets = Array.from({ length: opts.maxPackets }, () => ({
      cable: 0,
      progress: 0,
      speed: 0,
      dir: 1 as const,
      dropAt: 2,
      falling: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      color: 0xffffff,
      alpha: 1,
    }));
  }

  /**
   * Advance by game delta (packet travel, spawning) and real delta (falling
   * animation). Paused game (gameDeltaMs = 0) freezes everything.
   *
   * `gameSpeed` keeps fast-forward readable: on screen, packets move only
   * sqrt(speed) times faster (not speed times) and are spawned correspondingly
   * sparser, so the on-screen density still reflects the load.
   */
  step(gameDeltaMs: number, realDeltaMs: number, traffic: ReadonlyMap<string, LinkTraffic>, gameSpeed = 1): void {
    if (gameDeltaMs <= 0) return;
    const k = 1 / Math.sqrt(Math.max(1, gameSpeed));
    this.spawn(gameDeltaMs, traffic, k);
    this.advance(gameDeltaMs, realDeltaMs);
  }

  private spawn(gameDeltaMs: number, traffic: ReadonlyMap<string, LinkTraffic>, k: number): void {
    const { maxPackets, dropVisualBoost } = this.opts;
    const packetsPerGbps = this.opts.packetsPerGbps * k;
    const speedPxPerMs = this.opts.speedPxPerMs * k;
    for (let ci = 0; ci < this.cables.length; ci++) {
      const cable = this.cables[ci]!;
      const t = traffic.get(cable.spec.id);
      if (!t || t.demandGbps <= 0) continue;
      this.spawnAcc[ci]! += t.demandGbps * packetsPerGbps * (gameDeltaMs / 1000);
      const dropP = Math.min(0.85, t.dropFraction * dropVisualBoost);
      while (this.spawnAcc[ci]! >= 1) {
        this.spawnAcc[ci]! -= 1;
        if (this.count >= maxPackets) {
          this.refused++;
          continue;
        }
        const mixIdx = this.pickType(t);
        if (mixIdx < 0) continue;
        const p = this.packets[this.count++]!;
        p.cable = ci;
        p.speed = speedPxPerMs / Math.max(1, cable.length);
        // Spread spawns across the frame so they don't clump at high speed.
        p.progress = this.rng() * p.speed * gameDeltaMs;
        p.dir = this.rng() < 0.5 ? 1 : -1;
        p.dropAt = this.rng() < dropP ? 0.3 + this.rng() * 0.5 : 2;
        p.falling = false;
        p.color = TRAFFIC_STYLE[t.mix[mixIdx]!.type].color;
        p.alpha = 1;
        p.life = 0;
        this.place(p);
      }
    }
  }

  private pickType(t: LinkTraffic): number {
    this.weights.length = 0;
    for (const c of t.mix) this.weights.push(c.gbps);
    return weightedIndex(this.weights, this.rng());
  }

  private place(p: SimPacket): void {
    const cable = this.cables[p.cable]!;
    const tt = p.dir === 1 ? p.progress : 1 - p.progress;
    bezierPoint(cable.curve, tt, this.tmp);
    p.x = this.tmp.x;
    p.y = this.tmp.y;
  }

  private advance(gameDeltaMs: number, realDeltaMs: number): void {
    const { fallMs } = this.opts;
    let i = 0;
    while (i < this.count) {
      const p = this.packets[i]!;
      let alive = true;
      if (p.falling) {
        p.vy += GRAVITY * realDeltaMs;
        p.x += p.vx * realDeltaMs;
        p.y += p.vy * realDeltaMs;
        p.life -= realDeltaMs;
        p.alpha = Math.max(0, p.life / fallMs);
        alive = p.life > 0;
      } else {
        p.progress += p.speed * gameDeltaMs;
        if (p.dropAt < 1 && p.progress >= p.dropAt) {
          p.progress = p.dropAt;
          this.place(p);
          p.falling = true;
          p.color = DROP_COLOR;
          p.vx = (this.rng() - 0.5) * 0.08;
          p.vy = -0.04 - this.rng() * 0.03;
          p.life = fallMs;
        } else if (p.progress >= 1) {
          alive = false;
        } else {
          this.place(p);
        }
      }
      if (alive) {
        i++;
      } else {
        // Swap-remove: move last live packet into this slot.
        const last = this.count - 1;
        if (i !== last) {
          this.packets[i] = this.packets[last]!;
          this.packets[last] = p;
        }
        this.count--;
      }
    }
  }
}
