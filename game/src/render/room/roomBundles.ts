/**
 * Room traffic v2 geometry (UX.md §12.2): cables between cabinets run as BUNDLES through an overhead tray.
 * Pure (no PixiJS), unit-tested.
 *
 * - Device path (packets fly along it): port -> along the front face to the cabinet's front-right edge ->
 *   up the edge to the cabinet top -> up to the tray height above the cabinet -> orthogonally (grid axes) to the
 *   other cabinet -> down its edge -> to the port. Inside one cabinet: port -> edge -> edge at the other height -> port.
 * - Bundle (drawn): only the tray part between two cabinets, one per cabinet pair, thickness by cable count.
 */
import { isoToScreen } from '../iso';
import { up, type P } from './draw';
import type { CabinetSpec } from './furniture';
import { cabinetFace, cabinetGeometry } from './furniture';

/** Tray height above the floor for bundles between cabinets (just above a 42U rack). */
export const BUNDLE_Z = 140;
/** Front-face fraction of the cable riser (front-right edge of the cabinet). */
export const RISER_U = 0.96;

export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Top of the riser of a cabinet (front-right edge at the cabinet top). */
export function riserTop(cab: CabinetSpec, u = RISER_U): P {
  const geo = cabinetGeometry(cab);
  return cabinetFace(cab, cab.gx, cab.gy, geo, u, geo.heightPx);
}

/** Point above the cabinet centre at tray height. */
export function trayPoint(cab: CabinetSpec): P {
  const geo = cabinetGeometry(cab);
  return up(isoToScreen(cab.gx + geo.w / 2, cab.gy + geo.d), BUNDLE_Z);
}

/** Tray route between two cabinets: along +gx first, then +gy (grid-orthogonal). */
export function trayRoute(a: CabinetSpec, b: CabinetSpec): P[] {
  const ga = cabinetGeometry(a);
  const gb = cabinetGeometry(b);
  const pa = trayPoint(a);
  const pb = trayPoint(b);
  const corner = up(isoToScreen(b.gx + gb.w / 2, a.gy + ga.d), BUNDLE_Z);
  const pts = [pa];
  if (Math.abs(corner.x - pa.x) > 0.5 || Math.abs(corner.y - pa.y) > 0.5) pts.push(corner);
  pts.push(pb);
  return pts;
}

/** Packet path between two device ports (world px). `pa` / `pb` are the port points on the front faces. */
export function devicePath(ca: CabinetSpec, pa: P, cb: CabinetSpec, pb: P): P[] {
  const ea = faceEdgePoint(ca, pa);
  const eb = faceEdgePoint(cb, pb);
  if (ca.id === cb.id) return [pa, ea, eb, pb];
  return [pa, ea, riserTop(ca), ...trayRoute(ca, cb), riserTop(cb), eb, pb];
}

/**
 * Point on the riser (right edge of the visible face of the facing axis) at the same height above the floor as the port: walk along the face
 * from the port towards u = RISER_U (iso face lines slope by the same amount per u).
 */
export function faceEdgePoint(cab: CabinetSpec, port: P, riserU = RISER_U): P {
  const geo = cabinetGeometry(cab);
  const left = cabinetFace(cab, cab.gx, cab.gy, geo, 0, 0);
  const right = cabinetFace(cab, cab.gx, cab.gy, geo, 1, 0);
  // Fraction of the port along the face, from its x.
  const u = (port.x - left.x) / (right.x - left.x);
  const du = riserU - u;
  return { x: port.x + (right.x - left.x) * du, y: port.y + (right.y - left.y) * du };
}

/**
 * Physical bundle (wire) thickness by cable count – calm and thin (Traffic v3, UX §28.2: max 3 px). The volume is
 * shown by the separate flow ribbon (flowScale.flowWidth), the cable count by the "×N" badge.
 */
export const MAX_WIRE_PX = 3;
export function bundleWidth(count: number): number {
  return Math.min(MAX_WIRE_PX, 1.4 + Math.log2(Math.max(1, count)) * 0.6);
}

/**
 * Polyline offset sideways by `d` px (left normal of the travel direction; mitred joins, miter clamped to 3·d).
 * Used for the 1 px outline edges of the translucent flow ribbon (no overlapping translucent strokes).
 */
export function offsetPolyline(pts: readonly P[], d: number): P[] {
  const n = pts.length;
  if (n < 2) return pts.map((p) => ({ ...p }));
  const normals: P[] = [];
  for (let i = 1; i < n; i++) {
    const dx = pts[i]!.x - pts[i - 1]!.x;
    const dy = pts[i]!.y - pts[i - 1]!.y;
    const l = Math.hypot(dx, dy) || 1;
    normals.push({ x: -dy / l, y: dx / l });
  }
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = normals[Math.max(0, i - 1)]!;
    const b = normals[Math.min(normals.length - 1, i)]!;
    let mx = a.x + b.x;
    let my = a.y + b.y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) {
      mx = b.x;
      my = b.y;
    } else {
      mx /= ml;
      my /= ml;
    }
    const cos = mx * b.x + my * b.y;
    const k = Math.min(3, 1 / Math.max(1e-3, cos));
    out.push({ x: pts[i]!.x + mx * d * k, y: pts[i]!.y + my * d * k });
  }
  return out;
}

/** Face fraction of the thin BMC riser (left of the data riser, UX §28.7 – game scope). */
export const BMC_RISER_U = 0.9;
/** Height of the BMC run under the ceiling (below the data tray, so the two never overlap). */
export const BMC_Z = BUNDLE_Z - 12;

/** Inverse of isoToScreen (ground plane). */
export function screenToGrid(p: P): { gx: number; gy: number } {
  const a = p.x / 32;
  const b = p.y / 16;
  return { gx: (a + b) / 2, gy: (b - a) / 2 };
}

/**
 * BMC path (game scope, UX §28.7): BMC port -> thin riser at BMC_RISER_U -> cabinet top -> up to BMC_Z ->
 * grid-orthogonally to a target point at BMC_Z -> down to `target` (the wall OOB switch top).
 * `target` / `targetGrid`: end point on screen and its grid position.
 */
export function bmcWallPath(cab: CabinetSpec, port: P, target: P, targetGrid: { gx: number; gy: number }): P[] {
  const geo = cabinetGeometry(cab);
  const edge = faceEdgePoint(cab, port, BMC_RISER_U);
  const top = riserTop(cab, BMC_RISER_U);
  const ground = cabinetFace(cab, cab.gx, cab.gy, geo, BMC_RISER_U, 0);
  const g0 = screenToGrid(ground);
  const rise = up(ground, BMC_Z);
  // Towards the back wall first (gy), then along it (gx) – the run hugs the wall instead of crossing the room.
  const corner = up(isoToScreen(g0.gx, targetGrid.gy), BMC_Z);
  const above = up(isoToScreen(targetGrid.gx, targetGrid.gy), BMC_Z);
  return [port, edge, top, rise, corner, above, target];
}

export function flatten(pts: readonly P[]): Float32Array {
  const f = new Float32Array(pts.length * 2);
  pts.forEach((p, i) => {
    f[i * 2] = p.x;
    f[i * 2 + 1] = p.y;
  });
  return f;
}

export function polyLength(pts: readonly P[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return l;
}
