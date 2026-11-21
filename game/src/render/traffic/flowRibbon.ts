/**
 * Traffic v3 flow ribbon ("proud", UX.md §28.2–28.5): a translucent band along a route whose WIDTH = volume
 * (flowScale.flowWidth), colour = dominant traffic type (≥ 60 %) or neutral. Two thin opaque OUTLINE edges keep it
 * readable on the light floor without overlapping translucent strokes. One Graphics per ribbon, redrawn by the
 * caller only when its key (quantised width, colour, band, dim) changes. No filters.
 */
import type { Graphics } from 'pixi.js';
import { offsetPolyline } from '../room/roomBundles';
import { OUTLINE } from '../room/palette';
import { LOAD_COLORS, type LoadBand } from './loadStyle';

export interface Pt2 {
  readonly x: number;
  readonly y: number;
}

export interface RibbonStyle {
  /** Ribbon width in px (already quantised); <= 0 clears. */
  readonly width: number;
  readonly color: number;
  /** Fill alpha (0.45 room / 0.5 rack). */
  readonly alpha: number;
  /** Load band of the busiest link inside: warn / crit edges get the band colour (shape + icon come with P12). */
  readonly band?: LoadBand;
  /** Legend filter: ribbons of other types fade out. */
  readonly dim?: boolean;
}

export function ribbonKey(s: RibbonStyle): string {
  return `${s.width}|${s.color}|${s.alpha}|${s.band ?? 'normal'}|${s.dim ? 1 : 0}`;
}

function line(g: Graphics, pts: readonly Pt2[]): Graphics {
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
  return g;
}

export function drawRibbon(g: Graphics, pts: readonly Pt2[], s: RibbonStyle): void {
  g.clear();
  if (s.width <= 0 || pts.length < 2) return;
  const band = s.band ?? 'normal';
  const edge = band === 'normal' ? OUTLINE : LOAD_COLORS[band];
  const edgeW = band === 'normal' ? 1 : 1.5;
  line(g, pts).stroke({ color: s.color, width: s.width, alpha: s.alpha, cap: 'butt', join: 'miter' });
  const off = s.width / 2 + edgeW / 2;
  for (const d of [off, -off]) line(g, offsetPolyline(pts, d)).stroke({ color: edge, width: edgeW, alpha: band === 'normal' ? 0.55 : 0.95, cap: 'butt', join: 'miter' });
  g.alpha = s.dim ? 0.15 : 1;
}
