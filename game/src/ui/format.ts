/** Number/time formatting for the Czech UI. Pure helpers (unit-tested). */

const cs1 = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const cs2 = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const csInt = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });

export function formatGbps(v: number): string {
  return `${cs1.format(v)} Gb/s`;
}

export function formatPercent(ratio: number): string {
  return `${csInt.format(Math.round(ratio * 100))} %`;
}

export function formatLatency(ms: number): string {
  return `${cs2.format(ms)} ms`;
}

export function formatCount(n: number): string {
  return csInt.format(Math.round(n));
}

/** Game time as H:MM:SS. */
export function formatGameTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
