/** Isometric projection helpers (2:1 diamond tiles, ~30 deg). Pure math. */
export const TILE_W = 64;
export const TILE_H = 32;

export function isoToScreen(gx: number, gy: number): { x: number; y: number } {
  return { x: (gx - gy) * (TILE_W / 2), y: (gx + gy) * (TILE_H / 2) };
}
