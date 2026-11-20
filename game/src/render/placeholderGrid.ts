import { Container, Graphics } from 'pixi.js';
import { isoToScreen, TILE_H, TILE_W } from './iso';

/** Placeholder isometric floor - only proves the rendering pipeline works. */
export function createPlaceholderGrid(size: number): Container {
  const root = new Container();
  const g = new Graphics();
  for (let gx = 0; gx < size; gx++) {
    for (let gy = 0; gy < size; gy++) {
      const { x, y } = isoToScreen(gx, gy);
      g.poly([x, y - TILE_H / 2, x + TILE_W / 2, y, x, y + TILE_H / 2, x - TILE_W / 2, y])
        .fill({ color: (gx + gy) % 2 === 0 ? 0x1b2430 : 0x18202a })
        .stroke({ color: 0x2a3644, width: 1 });
    }
  }
  root.addChild(g);
  return root;
}
