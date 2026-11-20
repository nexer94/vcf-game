/**
 * Render-side contract for per-link traffic. Today it is fed by the demo source
 * (src/render/demo/demoTraffic.ts); later the engine snapshot will provide the
 * same shape from the real traffic simulation. All values are an
 * ILLUSTRATIVE model ("ilustrativní model"), not VCF facts.
 */
import type { TrafficType } from './trafficTypes';

export interface TrafficComponent {
  readonly type: TrafficType;
  /** Offered load of this traffic type, Gb/s (illustrative). */
  readonly gbps: number;
}

export interface LinkTraffic {
  readonly linkId: string;
  readonly capacityGbps: number;
  /** Total offered load (may exceed capacity). */
  readonly demandGbps: number;
  /** Delivered throughput (<= capacity). */
  readonly throughputGbps: number;
  /** throughput / capacity, 0..1. */
  readonly utilization: number;
  readonly latencyMs: number;
  /** Queued packets (illustrative). */
  readonly queueDepth: number;
  /** Fraction of offered packets dropped, 0..1. */
  readonly dropFraction: number;
  /** Dropped packets per second (illustrative). */
  readonly dropsPerSec: number;
  readonly mix: readonly TrafficComponent[];
}

export interface TrafficSource {
  /** Traffic for every link at the given game time. Must be pure / deterministic. */
  sample(gameTimeMs: number): ReadonlyMap<string, LinkTraffic>;
}

/** Illustrative queueing model constants (NOT from documentation). */
export const ILLUSTRATIVE = {
  baseLatencyMs: 0.05,
  /** Extra latency when the queue is full. */
  maxQueueLatencyMs: 4,
  maxQueueDepth: 512,
  /** Average packet size used to convert Gb/s to packets/s. */
  packetBits: 9000 * 8,
} as const;

/** Derive utilisation, queue, latency and drops from offered load. Pure. */
export function deriveLinkTraffic(
  linkId: string,
  capacityGbps: number,
  mix: readonly TrafficComponent[],
): LinkTraffic {
  const demandGbps = mix.reduce((s, c) => s + Math.max(0, c.gbps), 0);
  const cap = capacityGbps > 0 ? capacityGbps : 1;
  const demandRatio = demandGbps / cap;
  const throughputGbps = Math.min(demandGbps, cap);
  const utilization = throughputGbps / cap;
  // Queue builds up above 80 % and saturates at 100 %+.
  const q = Math.min(1, Math.max(0, (demandRatio - 0.8) / 0.2));
  const queueDepth = Math.round(q * q * ILLUSTRATIVE.maxQueueDepth);
  const latencyMs = ILLUSTRATIVE.baseLatencyMs + q * q * ILLUSTRATIVE.maxQueueLatencyMs;
  const dropFraction = demandGbps > 0 ? Math.max(0, demandGbps - cap * 0.97) / demandGbps : 0;
  const dropsPerSec = Math.round((dropFraction * demandGbps * 1e9) / ILLUSTRATIVE.packetBits);
  return {
    linkId,
    capacityGbps: cap,
    demandGbps,
    throughputGbps,
    utilization,
    latencyMs,
    queueDepth,
    dropFraction,
    dropsPerSec,
    mix,
  };
}
