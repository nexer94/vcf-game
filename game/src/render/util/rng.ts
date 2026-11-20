/** Small seeded PRNG (mulberry32) for deterministic visual effects. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick an index with probability proportional to weights[i]; -1 if all weights are <= 0. */
export function weightedIndex(weights: readonly number[], r: number): number {
  let total = 0;
  for (const w of weights) if (w > 0) total += w;
  if (total <= 0) return -1;
  let x = r * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]!;
    if (w <= 0) continue;
    if (x < w) return i;
    x -= w;
  }
  // Floating point edge (r ~ 1): return last positive weight.
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i]! > 0) return i;
  return -1;
}
