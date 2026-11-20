/** Cubic bezier + polyline helpers for cables. Pure math, no PixiJS. */

export interface Vec2 {
  x: number;
  y: number;
}

export interface CubicBezier {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3: Vec2;
}

/** Point on a cubic bezier at t in [0, 1]. Writes into `out` to avoid allocations in hot loops. */
export function bezierPoint(c: CubicBezier, t: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  out.x = a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x;
  out.y = a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y;
  return out;
}

/** Sample a bezier into a flat [x0, y0, x1, y1, ...] polyline with `segments` + 1 points. */
export function sampleBezier(c: CubicBezier, segments: number): Float32Array {
  const n = Math.max(1, Math.floor(segments));
  const out = new Float32Array((n + 1) * 2);
  const p = { x: 0, y: 0 };
  for (let i = 0; i <= n; i++) {
    bezierPoint(c, i / n, p);
    out[i * 2] = p.x;
    out[i * 2 + 1] = p.y;
  }
  return out;
}

export function polylineLength(pts: Float32Array): number {
  let len = 0;
  for (let i = 2; i + 1 < pts.length; i += 2) {
    len += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  }
  return len;
}

/** Distance from point (px, py) to segment (ax, ay)-(bx, by). */
export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Minimum distance from a point to a flat polyline. Infinity for an empty polyline. */
export function distanceToPolyline(pts: Float32Array, px: number, py: number): number {
  if (pts.length < 2) return Number.POSITIVE_INFINITY;
  if (pts.length < 4) return Math.hypot(px - pts[0]!, py - pts[1]!);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const d = distanceToSegment(px, py, pts[i - 2]!, pts[i - 1]!, pts[i]!, pts[i + 1]!);
    if (d < best) best = d;
  }
  return best;
}
