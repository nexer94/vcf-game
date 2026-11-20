import { Graphics } from 'pixi.js';
import { isoToScreen } from '../iso';
import type { BoxSpec, FloorSpec } from './topology';

const TILE_A = 0x18202a;
const TILE_B = 0x161d26;
const AISLE = 0x16263a;
const GRID = 0x232e3b;
const SHADOW = 0x0c1117;

/** Static datacenter floor (one Graphics = one batch). Tile corners sit on integer grid coords. */
export function createFloor(floor: FloorSpec, boxes: readonly BoxSpec[]): Graphics {
  const g = new Graphics();
  const aisle = new Set(floor.aisleRows);
  for (let gy = 0; gy < floor.rows; gy++) {
    for (let gx = 0; gx < floor.cols; gx++) {
      const a = isoToScreen(gx, gy);
      const b = isoToScreen(gx + 1, gy);
      const c = isoToScreen(gx + 1, gy + 1);
      const d = isoToScreen(gx, gy + 1);
      const color = aisle.has(gy) ? AISLE : (gx + gy) % 2 === 0 ? TILE_A : TILE_B;
      g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill({ color });
    }
  }
  // Grid lines in one stroke pass.
  for (let gx = 0; gx <= floor.cols; gx++) {
    const a = isoToScreen(gx, 0);
    const b = isoToScreen(gx, floor.rows);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  for (let gy = 0; gy <= floor.rows; gy++) {
    const a = isoToScreen(0, gy);
    const b = isoToScreen(floor.cols, gy);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  g.stroke({ color: GRID, width: 1, alpha: 0.9 });
  // Soft contact shadows under boxes.
  for (const box of boxes) {
    const pad = 0.15;
    const a = isoToScreen(box.gx - pad, box.gy - pad);
    const b = isoToScreen(box.gx + box.w + pad, box.gy - pad);
    const c = isoToScreen(box.gx + box.w + pad, box.gy + box.d + pad);
    const d = isoToScreen(box.gx - pad, box.gy + box.d + pad);
    g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill({ color: SHADOW, alpha: 0.6 });
  }
  return g;
}
