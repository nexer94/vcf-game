/**
 * Traffic v3 calibration (UX.md §28.4, GRAPHICS.md "Provoz v3"): illustrative volume (Gb/s) -> visual.
 * Pure functions, unit-tested. Volumes are the game's ILLUSTRATIVE model (never VCF facts) – the "≈" sign in every
 * number says so (legend: "≈ = ilustrativní model").
 *
 *   t      = clamp(log10(g · 1000) / 5, 0, 1)          1 Mb/s -> 0, 100 Gb/s -> 1
 *   width  = 1.5 + 8.5 · (g / 100)^0.35  px            ribbon ("proud") width, room scale 1
 *   rate   = 0.4 + 2.6 · t  dots / s                    minimum 0.4 / s = every flow is visible
 *   scale  = 0.55 + 0.35 · t                           dot size (big flows = bigger "drops")
 *   speed  = base · (1 − 0.6 · q)                      constant, slowed only by congestion (queue fill q)
 *   LED    = 0.5 + 3.5 · t  Hz                          port activity blink (max 4 Hz)
 */
import { TRAFFIC_TYPES, type TrafficType } from './trafficTypes';

const finite = (g: number): number => (Number.isFinite(g) && g > 0 ? g : 0);

/** Log level 0..1 of a volume in Gb/s (1 Mb/s -> 0, 100 Gb/s -> 1). */
export function levelT(gbps: number): number {
  const g = finite(gbps);
  if (g <= 0) return 0;
  return Math.min(1, Math.max(0, Math.log10(g * 1000) / 5));
}

/** Ribbon width in world px at scale 1 (room); rack × 0.7, lens × 1.2. 0 Gb/s -> 0 (no ribbon). */
export function flowWidth(gbps: number, factor = 1): number {
  const g = finite(gbps);
  if (g <= 0) return 0;
  return (1.5 + 8.5 * Math.pow(g / 100, 0.35)) * factor;
}

/** Quantise a width to `step` px (redraw a ribbon only when the quantised width changes). */
export function quantize(w: number, step = 0.5): number {
  return Math.round(w / step) * step;
}

export const MIN_EMIT_RATE = 0.4;
/** Lower bound of the per-flow rate after budget scaling (UX §28.4). */
export const MIN_BUDGET_RATE = 0.25;

/** Dots per (game) second for one flow (cable × type); 0 Gb/s -> 0. */
export function emitRate(gbps: number): number {
  if (finite(gbps) <= 0) return 0;
  return MIN_EMIT_RATE + 2.6 * levelT(gbps);
}

/** Dot scale factor (multiplied by the view's base dot scale). */
export function dotScale(gbps: number): number {
  return 0.55 + 0.35 * levelT(gbps);
}

/** Port LED blink frequency (Hz); 0 Gb/s -> 0 (steady link light). */
export function ledHz(gbps: number): number {
  if (finite(gbps) <= 0) return 0;
  return 0.5 + 3.5 * levelT(gbps);
}

/** Dot speed factor for queue fill q (0..1): only congestion slows dots down. */
export function congestionSpeed(q: number): number {
  const c = Number.isFinite(q) ? Math.min(1, Math.max(0, q)) : 0;
  return 1 - 0.6 * c;
}

const cs = (n: number, digits: number): string => n.toFixed(digits).replace('.', ',');

/**
 * "≈ 840 Mb/s", "≈ 4,2 Gb/s", "≈ 120 Gb/s"; under 1 Mb/s "≈ < 1 Mb/s" (Czech decimal comma, `≈` = illustrative).
 */
export function formatGbps(gbps: number): string {
  const g = finite(gbps);
  if (g < 0.001) return '≈ < 1 Mb/s';
  if (g < 1) {
    const mb = g * 1000;
    return `≈ ${mb < 10 ? cs(mb, 1).replace(/,0$/, '') : Math.round(mb)} Mb/s`;
  }
  if (g < 100) return `≈ ${cs(g, 1)} Gb/s`;
  return `≈ ${Math.round(g)} Gb/s`;
}

/** Share of the total a type must have to colour a ribbon (UX §28.5). */
export const DOMINANT_SHARE = 0.6;

/**
 * Traffic type carrying ≥ 60 % of the volume, or null (neutral ribbon – the dots inside carry the types).
 * `mix` may contain several entries of the same type (summed).
 */
export function dominantType(mix: Iterable<{ readonly type: TrafficType; readonly gbps: number }>): TrafficType | null {
  const sums = new Map<TrafficType, number>();
  let total = 0;
  for (const m of mix) {
    const g = finite(m.gbps);
    if (g <= 0) continue;
    sums.set(m.type, (sums.get(m.type) ?? 0) + g);
    total += g;
  }
  if (total <= 0) return null;
  for (const t of TRAFFIC_TYPES) if ((sums.get(t) ?? 0) / total >= DOMINANT_SHARE) return t;
  return null;
}
