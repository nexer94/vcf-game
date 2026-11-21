/** Small vector-drawing helpers shared by the room art (PixiJS Graphics). */
import type { Graphics } from 'pixi.js';
import { isoToScreen } from '../iso';
import { OUTLINE } from './palette';

export interface P {
  x: number;
  y: number;
}

export const OUTLINE_W = 1.5;

/** Filled polygon with a cartoon outline. */
export function poly(g: Graphics, pts: readonly P[], color: number, outline = true, alpha = 1): void {
  g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color, alpha });
  if (outline) g.stroke({ color: OUTLINE, width: OUTLINE_W, join: 'round', alpha: 0.95 });
}

export const up = (p: P, h: number): P => ({ x: p.x, y: p.y - h });

/** Point on the +gy (front) face of an axis-aligned prism. u: 0..1 left->right, h: px above floor. */
export function frontFace(gx: number, gy: number, w: number, d: number, u: number, h: number): P {
  const a = isoToScreen(gx, gy + d);
  const b = isoToScreen(gx + w, gy + d);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u - h };
}

/** Point on the +gx (side) face. u: 0..1 back->front, h: px above floor. */
export function sideFace(gx: number, gy: number, w: number, d: number, u: number, h: number): P {
  const a = isoToScreen(gx + w, gy);
  const b = isoToScreen(gx + w, gy + d);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u - h };
}

/** Quad on the front face between u0..u1 and h0..h1. */
export function frontQuad(gx: number, gy: number, w: number, d: number, u0: number, u1: number, h0: number, h1: number): P[] {
  return [frontFace(gx, gy, w, d, u0, h1), frontFace(gx, gy, w, d, u1, h1), frontFace(gx, gy, w, d, u1, h0), frontFace(gx, gy, w, d, u0, h0)];
}

export function sideQuad(gx: number, gy: number, w: number, d: number, u0: number, u1: number, h0: number, h1: number): P[] {
  return [sideFace(gx, gy, w, d, u0, h1), sideFace(gx, gy, w, d, u1, h1), sideFace(gx, gy, w, d, u1, h0), sideFace(gx, gy, w, d, u0, h0)];
}

export interface PrismColors {
  readonly top: number;
  readonly front: number;
  readonly side: number;
}

/** Axis-aligned box standing on the floor (or lifted by `z`), three visible faces + outline. */
export function prism(g: Graphics, gx: number, gy: number, w: number, d: number, h: number, c: PrismColors, z = 0): void {
  const c00 = up(isoToScreen(gx, gy), z);
  const c10 = up(isoToScreen(gx + w, gy), z);
  const c11 = up(isoToScreen(gx + w, gy + d), z);
  const c01 = up(isoToScreen(gx, gy + d), z);
  poly(g, [c10, c11, up(c11, h), up(c10, h)], c.side);
  poly(g, [c01, c11, up(c11, h), up(c01, h)], c.front);
  poly(g, [up(c00, h), up(c10, h), up(c11, h), up(c01, h)], c.top);
}

/** Floor diamond for a footprint (optionally inflated by `pad` tiles). */
export function diamond(gx: number, gy: number, w: number, d: number, pad = 0): P[] {
  return [
    isoToScreen(gx - pad, gy - pad),
    isoToScreen(gx + w + pad, gy - pad),
    isoToScreen(gx + w + pad, gy + d + pad),
    isoToScreen(gx - pad, gy + d + pad),
  ];
}
