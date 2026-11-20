import { describe, expect, it } from 'vitest';
import { formatGameTime, formatGbps, formatLatency, formatPercent } from './format';

// Intl may use a narrow no-break space as group separator; normalise whitespace.
const n = (s: string): string => s.replace(/\s/g, ' ');

describe('format', () => {
  it('formats game time', () => {
    expect(formatGameTime(0)).toBe('0:00:00');
    expect(formatGameTime(61_500)).toBe('0:01:01');
    expect(formatGameTime(3_726_000)).toBe('1:02:06');
    expect(formatGameTime(-5)).toBe('0:00:00');
  });

  it('formats units with Czech decimal comma', () => {
    expect(n(formatGbps(2.25))).toMatch(/^2,[23] Gb\/s$/);
    expect(n(formatPercent(0.876))).toBe('88 %');
    expect(n(formatLatency(0.05))).toBe('0,05 ms');
  });
});
