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
export function riserTop(cab: CabinetSpec): P {
  const geo = cabinetGeometry(cab);
  return cabinetFace(cab, cab.gx, cab.gy, geo, RISER_U, geo.heightPx);
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
export function faceEdgePoint(cab: CabinetSpec, port: P): P {
  const geo = cabinetGeometry(cab);
  const left = cabinetFace(cab, cab.gx, cab.gy, geo, 0, 0);
  const right = cabinetFace(cab, cab.gx, cab.gy, geo, 1, 0);
  // Fraction of the port along the face, from its x.
  const u = (port.x - left.x) / (right.x - left.x);
  const du = RISER_U - u;
  return { x: port.x + (right.x - left.x) * du, y: port.y + (right.y - left.y) * du };
}

/** Bundle thickness by cable count (log scale, max 6 px). */
export function bundleWidth(count: number): number {
  return Math.min(6, 1.6 + Math.log2(Math.max(1, count)) * 1.2);
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
