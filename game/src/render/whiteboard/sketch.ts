/**
 * Hand-drawn ("fixa na tabuli") primitives – UX.md §10.3.
 *
 * Pure geometry (no PixiJS): deterministic jitter seeded by a hash of the element id, so a redraw never moves a
 * line. The Pixi side (boardRenderer.ts) strokes the returned polylines twice (main + faint offset pass) – no
 * filters, no blur.
 */

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** FNV-1a 32-bit hash of a string (seed for the jitter). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 – tiny deterministic PRNG in [0, 1). */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Segment length of the jitter subdivision (board units). */
export const JITTER_STEP = 24;
const J_MIN = 0.8;
const J_MAX = 1.5;

/**
 * Wobbly polyline between two points: split every ~24 units, interior points pushed perpendicular by ±0.8–1.5.
 * End points get a small overshoot (`overshoot` units along the line) like a real marker stroke.
 */
export function jitterLine(a: Pt, b: Pt, rnd: () => number, overshoot = 0): Pt[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [a, b];
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const n = Math.max(1, Math.round(len / JITTER_STEP));
  const out: Pt[] = [];
  const o0 = overshoot ? overshoot * (0.4 + rnd() * 0.6) : 0;
  const o1 = overshoot ? overshoot * (0.4 + rnd() * 0.6) : 0;
  out.push({ x: a.x - ux * o0, y: a.y - uy * o0 });
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const mag = (J_MIN + rnd() * (J_MAX - J_MIN)) * (rnd() < 0.5 ? -1 : 1);
    out.push({ x: a.x + dx * t + nx * mag, y: a.y + dy * t + ny * mag });
  }
  out.push({ x: b.x + ux * o1, y: b.y + uy * o1 });
  return out;
}

/** Four separate jittered sides with 2–3 unit corner overshoot (a box drawn by hand). */
export function sketchRect(x: number, y: number, w: number, h: number, seed: number): Pt[][] {
  const r = seededRng(seed);
  const over = 2 + r();
  const p00 = { x, y };
  const p10 = { x: x + w, y };
  const p11 = { x: x + w, y: y + h };
  const p01 = { x, y: y + h };
  return [jitterLine(p00, p10, r, over), jitterLine(p10, p11, r, over), jitterLine(p11, p01, r, over), jitterLine(p01, p00, r, over)];
}

/** Hand-drawn line (single polyline). */
export function sketchLine(a: Pt, b: Pt, seed: number): Pt[] {
  return jitterLine(a, b, seededRng(seed), 1.5);
}

/** Split a polyline into dash pieces (dash / gap in board units). */
export function dashPolyline(pts: readonly Pt[], dash = 10, gap = 7): Pt[][] {
  const out: Pt[][] = [];
  let on = true;
  let left = dash;
  let cur: Pt[] = pts.length ? [pts[0]!] : [];
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]!;
    const b = pts[i]!;
    let seg = Math.hypot(b.x - a.x, b.y - a.y);
    while (seg > 1e-6) {
      const step = Math.min(seg, left);
      const t = step / seg;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (on) cur.push(p);
      seg -= step;
      left -= step;
      a = p;
      if (left <= 1e-6) {
        if (on && cur.length > 1) out.push(cur);
        on = !on;
        left = on ? dash : gap;
        cur = on ? [p] : [];
      }
    }
  }
  if (on && cur.length > 1) out.push(cur);
  return out;
}

/** Arrow head at `tip` pointing from `from`: two short strokes. */
export function arrowHead(from: Pt, tip: Pt, size = 9): Pt[][] {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const s1 = { x: tip.x - Math.cos(a - 0.45) * size, y: tip.y - Math.sin(a - 0.45) * size };
  const s2 = { x: tip.x - Math.cos(a + 0.45) * size, y: tip.y - Math.sin(a + 0.45) * size };
  return [[s1, tip], [s2, tip]];
}

/** Wobbly closed ellipse (problem marker circle, cloud bumps). */
export function sketchEllipse(cx: number, cy: number, rx: number, ry: number, seed: number, segments = 28): Pt[] {
  const r = seededRng(seed);
  const out: Pt[] = [];
  const start = r() * Math.PI * 2;
  // A little more than a full turn: a marker circle overlaps where it started.
  for (let i = 0; i <= segments + 2; i++) {
    const t = start + (i / segments) * Math.PI * 2;
    const k = 1 + (r() - 0.5) * 0.05;
    out.push({ x: cx + Math.cos(t) * rx * k, y: cy + Math.sin(t) * ry * k });
  }
  return out;
}

/** Cloud outline ("síť firmy"): bumps along an ellipse. */
export function sketchCloud(cx: number, cy: number, w: number, h: number, seed: number): Pt[] {
  const r = seededRng(seed);
  const bumps = 9;
  const out: Pt[] = [];
  for (let i = 0; i < bumps; i++) {
    const t0 = (i / bumps) * Math.PI * 2;
    const t1 = ((i + 1) / bumps) * Math.PI * 2;
    const bulge = 0.16 + r() * 0.08;
    for (let k = 0; k <= 6; k++) {
      const t = t0 + ((t1 - t0) * k) / 6;
      const lift = Math.sin((k / 6) * Math.PI) * bulge;
      out.push({ x: cx + Math.cos(t) * (w / 2) * (1 + lift), y: cy + Math.sin(t) * (h / 2) * (1 + lift) });
    }
  }
  out.push(out[0]!);
  return out;
}

/**
 * Ramer–Douglas–Peucker simplification (player strokes, UX §10.5: ε ≈ 0.75 board units).
 * Iterative (no recursion depth issues on long strokes).
 */
export function simplifyRdp(pts: readonly Pt[], eps = 0.75): Pt[] {
  if (pts.length < 3) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const a = pts[i0]!;
    const b = pts[i1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-9;
    let best = -1;
    let bestD = eps;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i]!;
      const d = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Distance from a point to a polyline (eraser hit test). */
export function distToPolyline(p: Pt, pts: readonly Pt[]): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < best) best = d;
  }
  return best;
}
