/**
 * Packet "dot" shapes per traffic type (UX.md §12.5, GRAPHICS.md "Provoz v2"): Management ◆, vMotion ▲,
 * vSAN ■, NFS ●, NSX overlay ⬟, VM ○ (hollow) + BMC ✚ (out of VCF scope – game, grey).
 * One atlas texture (white shapes with a dark OUTLINE rim, tinted per type) -> one batched ParticleContainer.
 */
import { Graphics, Rectangle, Texture, type Renderer } from 'pixi.js';
import type { TrafficType } from '../traffic/trafficTypes';
import { OUTLINE } from './palette';

export type DotShape = TrafficType | 'bmc';
export const DOT_SHAPES: readonly DotShape[] = ['management', 'vmotion', 'vsan', 'nfs', 'overlay', 'vm', 'bmc'];

/** Text glyphs of the shapes (legend / tooltips). */
export const DOT_GLYPH: Readonly<Record<DotShape, string>> = {
  management: '◆',
  vmotion: '▲',
  vsan: '■',
  nfs: '●',
  overlay: '⬟',
  vm: '○',
  bmc: '✚',
};

const CELL = 16;
const R = 5;

function drawShape(g: Graphics, shape: DotShape, cx: number, cy: number): void {
  const stroke = { color: OUTLINE, width: 1.6, join: 'round' as const };
  switch (shape) {
    case 'management':
      g.poly([cx, cy - R - 1, cx + R + 1, cy, cx, cy + R + 1, cx - R - 1, cy]).fill(0xffffff).stroke(stroke);
      break;
    case 'vmotion':
      g.poly([cx, cy - R - 1, cx + R + 1, cy + R, cx - R - 1, cy + R]).fill(0xffffff).stroke(stroke);
      break;
    case 'vsan':
      g.rect(cx - R + 0.5, cy - R + 0.5, 2 * R - 1, 2 * R - 1).fill(0xffffff).stroke(stroke);
      break;
    case 'nfs':
      g.circle(cx, cy, R).fill(0xffffff).stroke(stroke);
      break;
    case 'overlay': {
      const pts: number[] = [];
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        pts.push(cx + Math.cos(a) * (R + 0.8), cy + Math.sin(a) * (R + 0.8));
      }
      g.poly(pts).fill(0xffffff).stroke(stroke);
      break;
    }
    case 'vm':
      // Hollow ring: tinted ring between two dark rims.
      g.circle(cx, cy, R).stroke({ color: OUTLINE, width: 4.2 });
      g.circle(cx, cy, R).stroke({ color: 0xffffff, width: 1.8 });
      break;
    case 'bmc':
      g.rect(cx - 1.6, cy - R, 3.2, 2 * R).rect(cx - R, cy - 1.6, 2 * R, 3.2).fill(0xffffff).stroke({ color: OUTLINE, width: 1.2 });
      break;
  }
}

export function createDotAtlas(renderer: Renderer): { readonly base: Texture; readonly shapes: Readonly<Record<DotShape, Texture>> } {
  const g = new Graphics();
  DOT_SHAPES.forEach((s, i) => drawShape(g, s, i * CELL + CELL / 2, CELL / 2));
  const base = renderer.generateTexture({ target: g, frame: new Rectangle(0, 0, CELL * DOT_SHAPES.length, CELL), resolution: 3, antialias: true });
  g.destroy();
  const shapes = {} as Record<DotShape, Texture>;
  DOT_SHAPES.forEach((s, i) => {
    shapes[s] = new Texture({ source: base.source, frame: new Rectangle(i * CELL, 0, CELL, CELL) });
  });
  return { base, shapes };
}
