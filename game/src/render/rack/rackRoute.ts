/**
 * Orthogonal auto-route of cables in the rack front elevation (UX.md §9.4). Pure, unit-tested.
 *
 *   port -> short stub (to the device edge) -> horizontal to the column's cable channel (own lane)
 *        -> vertical in the channel
 *        -> same column: horizontal back to the other port's stub -> port
 *        -> other column: up to the overhead tray (own lane) -> across -> down the target channel -> port
 *
 * Every cable gets its own lane (3 px apart) in each channel it uses and in the tray, so parallel cables do
 * not overlap. Lanes are assigned deterministically (sorted by cable id). Recompute only when cabling changes.
 */
import type { ElevationLayout, PortGeom } from './rackLayout';

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface RouteCable {
  readonly id: string;
  /** Port ids (`deviceId:port`). */
  readonly a: string;
  readonly b: string;
}

export const LANE_PX = 3;
const STUB_LANES = 3;

/** Lane x inside a column channel (wraps when the channel is full). */
export function laneX(channelX: number, channelW: number, lane: number): number {
  const lanes = Math.max(1, Math.floor((channelW - 6) / LANE_PX));
  return channelX + 4 + (lane % lanes) * LANE_PX;
}

/** Remove consecutive duplicates and collinear middle points. */
export function simplify(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1]!;
    const b = out[i]!;
    const c = out[i + 1]!;
    if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01)) out.splice(i, 1);
  }
  return out;
}

/** True when every segment is horizontal or vertical. */
export function isOrthogonal(pts: readonly Pt[]): boolean {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01) return false;
  }
  return true;
}

function stub(p: PortGeom, lane: number): number {
  const dir = p.stubY >= p.y ? 1 : -1;
  return p.stubY + dir * (lane % STUB_LANES) * 1.5;
}

/** Route one cable given its lanes. */
export function routeCable(layout: ElevationLayout, a: PortGeom, b: PortGeom, laneA: number, laneB: number, trayLane: number): Pt[] {
  const ca = layout.columns[a.column]!;
  const cb = layout.columns[b.column]!;
  const ax = laneX(ca.channelX, ca.channelW, laneA);
  const sa = stub(a, laneA);
  if (a.column === b.column) {
    const sb = stub(b, laneA);
    return simplify([{ x: a.x, y: a.y }, { x: a.x, y: sa }, { x: ax, y: sa }, { x: ax, y: sb }, { x: b.x, y: sb }, { x: b.x, y: b.y }]);
  }
  const bx = laneX(cb.channelX, cb.channelW, laneB);
  const sb = stub(b, laneB);
  const ty = layout.trayY - 10 + (trayLane % 7) * LANE_PX;
  return simplify([
    { x: a.x, y: a.y },
    { x: a.x, y: sa },
    { x: ax, y: sa },
    { x: ax, y: ty },
    { x: bx, y: ty },
    { x: bx, y: sb },
    { x: b.x, y: sb },
    { x: b.x, y: b.y },
  ]);
}

/** Route all cables with deterministic lanes. Cables whose ports are not in the layout are skipped. */
export function routeAll(layout: ElevationLayout, cables: readonly RouteCable[]): Map<string, Pt[]> {
  const out = new Map<string, Pt[]>();
  const laneCount = new Map<number, number>();
  let tray = 0;
  const next = (col: number): number => {
    const n = laneCount.get(col) ?? 0;
    laneCount.set(col, n + 1);
    return n;
  };
  for (const c of [...cables].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    const a = layout.ports.get(c.a);
    const b = layout.ports.get(c.b);
    if (!a || !b) continue;
    const la = next(a.column);
    const lb = a.column === b.column ? la : next(b.column);
    const tl = a.column === b.column ? 0 : tray++;
    out.set(c.id, routeCable(layout, a, b, la, lb, tl));
  }
  return out;
}

/** Polyline length. */
export function pathLength(pts: readonly Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return l;
}

/** Flat [x0, y0, x1, y1, …] for PacketPath polylines / hit tests. */
export function toFloat32(pts: readonly Pt[]): Float32Array {
  const f = new Float32Array(pts.length * 2);
  pts.forEach((p, i) => {
    f[i * 2] = p.x;
    f[i * 2 + 1] = p.y;
  });
  return f;
}
