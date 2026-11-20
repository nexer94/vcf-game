/**
 * Link load -> visual style (docs/design/GRAPHICS.md): thickness = utilisation,
 * above 80 % yellow, above 95 % red. Pure functions, unit-tested.
 */
export const LOAD_WARN = 0.8;
export const LOAD_CRIT = 0.95;

export type LoadBand = 'normal' | 'warn' | 'crit';

export const LOAD_COLORS: Readonly<Record<LoadBand, number>> = {
  normal: 0x5b6b80,
  warn: 0xf2c94c,
  crit: 0xe5484d,
};

export const LOAD_CSS: Readonly<Record<LoadBand, string>> = {
  normal: '#5b6b80',
  warn: '#f2c94c',
  crit: '#e5484d',
};

/** "nad 80 %" / "nad 95 %" -> strictly greater than the threshold. */
export function loadBand(utilization: number): LoadBand {
  if (utilization > LOAD_CRIT) return 'crit';
  if (utilization > LOAD_WARN) return 'warn';
  return 'normal';
}

export function loadColor(utilization: number): number {
  return LOAD_COLORS[loadBand(utilization)];
}

export const MIN_CABLE_WIDTH = 1.5;
export const MAX_CABLE_WIDTH = 6;

/** Cable stroke width in world px; linear in utilisation, clamped to [0, 1]. */
export function loadWidth(utilization: number, min = MIN_CABLE_WIDTH, max = MAX_CABLE_WIDTH): number {
  const u = Number.isFinite(utilization) ? Math.min(1, Math.max(0, utilization)) : 0;
  return min + (max - min) * u;
}
