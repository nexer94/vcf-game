import { describe, expect, it } from 'vitest';
import { createRng, weightedIndex } from './rng';

describe('rng', () => {
  it('is deterministic for a seed and stays in [0, 1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('picks weighted indices', () => {
    expect(weightedIndex([0, 1, 0], 0.5)).toBe(1);
    expect(weightedIndex([1, 1], 0.25)).toBe(0);
    expect(weightedIndex([1, 1], 0.75)).toBe(1);
    expect(weightedIndex([1, 0, 0], 0.9999999)).toBe(0);
    expect(weightedIndex([0, 0], 0.5)).toBe(-1);
    expect(weightedIndex([], 0.5)).toBe(-1);
  });
});
