/**
 * Floor overlays of rack placement (render only – what is valid comes from the engine snapshot / hints):
 *  - cold / hot aisles of the standing racks (subtle tints + a texture so colour is not the only carrier),
 *  - front indicators of the racks (chevron on the floor in front of the rack front),
 *  - placement hints: valid tiles with the allowed facings, invalid tiles hatched,
 *  - the pre-installed wall-mounted OOB switch at the back corner (model/roomFixtures OOB_SWITCH_SPOT).
 * All drawn into plain Graphics, redrawn only when the input changes (no per-frame work, no filters).
 */
import type { Graphics } from 'pixi.js';
import { isoToScreen } from '../iso';
import { diamond, poly, prism, up, type P } from './draw';
import type { CabinetFacing } from './furniture';
import { AISLE, BLOCKED_TILE, OUTLINE, TARGET_TILE } from './palette';
import type { RoomSize, Tile } from './roomGrid';

const STEP: Readonly<Record<CabinetFacing, Tile>> = { N: { gx: 0, gy: -1 }, S: { gx: 0, gy: 1 }, E: { gx: 1, gy: 0 }, W: { gx: -1, gy: 0 } };
export const FACING_ORDER: readonly CabinetFacing[] = ['S', 'W', 'N', 'E'];
/** Clockwise next facing (same order as the engine rotation 0/90/180/270 = S/W/N/E). */
export const nextFacing = (f: CabinetFacing): CabinetFacing => FACING_ORDER[(FACING_ORDER.indexOf(f) + 1) % 4]!;
export const FACING_LABEL: Readonly<Record<CabinetFacing, string>> = { S: 'čelem dopředu (jih)', W: 'čelem doleva (západ)', N: 'čelem dozadu (sever)', E: 'čelem doprava (východ)' };

const flat = (pts: readonly P[]): number[] => pts.flatMap((p) => [p.x, p.y]);

/** Point on the floor inside tile (gx, gy): fx, fy 0..1. */
const floorAt = (t: Tile, fx: number, fy: number): P => isoToScreen(t.gx + fx, t.gy + fy);

/** Chevron on the floor of `tile` pointing towards `facing` (at the tile edge on that side). */
export function facingChevron(g: Graphics, tile: Tile, facing: CabinetFacing, color: number, size = 0.22, edge = 0.78): void {
  const s = STEP[facing];
  // Local frame: forward = s, side = perpendicular.
  const fwd = { x: s.gx, y: s.gy };
  const side = { x: -s.gy, y: s.gx };
  const c = { x: 0.5 + fwd.x * (edge - 0.5), y: 0.5 + fwd.y * (edge - 0.5) };
  const tip = floorAt(tile, c.x + fwd.x * size * 0.6, c.y + fwd.y * size * 0.6);
  const l = floorAt(tile, c.x - fwd.x * size * 0.4 + side.x * size, c.y - fwd.y * size * 0.4 + side.y * size);
  const r = floorAt(tile, c.x - fwd.x * size * 0.4 - side.x * size, c.y - fwd.y * size * 0.4 - side.y * size);
  g.poly(flat([l, tip, r])).stroke({ color: OUTLINE, width: 3.2, cap: 'round', join: 'round', alpha: 0.85 });
  g.poly(flat([l, tip, r])).stroke({ color, width: 1.8, cap: 'round', join: 'round' });
}

export interface AisleSet {
  readonly cold: readonly Tile[];
  readonly hot: readonly Tile[];
}

/** Cold (blue-ish, short straight dashes = cool air in) / hot (warm, wavy line = warm air out) aisles. */
export function drawAisles(g: Graphics, a: AisleSet): void {
  for (const t of a.cold) {
    g.poly(flat(diamond(t.gx, t.gy, 1, 1, -0.06))).fill({ color: AISLE.cold, alpha: 0.16 }).stroke({ color: AISLE.cold, width: 1, alpha: 0.55 });
    for (const f of [0.3, 0.5, 0.7]) {
      const p0 = floorAt(t, f - 0.08, f + 0.08);
      const p1 = floorAt(t, f + 0.08, f - 0.08);
      g.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y);
    }
    g.stroke({ color: 0x1d4f9a, width: 1.2, alpha: 0.55, cap: 'round' });
  }
  for (const t of a.hot) {
    g.poly(flat(diamond(t.gx, t.gy, 1, 1, -0.06))).fill({ color: AISLE.hot, alpha: 0.18 }).stroke({ color: AISLE.hot, width: 1, alpha: 0.6 });
    const pts: P[] = [];
    for (let i = 0; i <= 8; i++) {
      const u = 0.2 + (i / 8) * 0.6;
      const w = Math.sin(i * Math.PI * 0.5) * 0.06;
      pts.push(floorAt(t, u + w, u - w));
    }
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    g.stroke({ color: 0x9a4f0a, width: 1.2, alpha: 0.6, cap: 'round', join: 'round' });
  }
}

export interface PlacementHintTile {
  readonly tile: Tile;
  readonly facings: readonly CabinetFacing[];
}

/**
 * Valid tiles (blue soft fill, chevrons for every allowed facing, the current facing stronger) and hatched invalid
 * tiles (every other tile of the room). `occupied` tiles (racks standing) are left alone.
 */
export function drawPlacementHints(g: Graphics, room: RoomSize, hints: readonly PlacementHintTile[], facing: CabinetFacing, occupied: ReadonlySet<string>): void {
  const valid = new Map(hints.map((h) => [`${h.tile.gx},${h.tile.gy}`, h]));
  for (let gy = 0; gy < room.rows; gy++) {
    for (let gx = 0; gx < room.cols; gx++) {
      const key = `${gx},${gy}`;
      if (occupied.has(key)) continue;
      const h = valid.get(key);
      const d = diamond(gx, gy, 1, 1, -0.05);
      if (h && h.facings.includes(facing)) {
        g.poly(flat(d)).fill({ color: TARGET_TILE, alpha: 0.13 }).stroke({ color: TARGET_TILE, width: 1.4, alpha: 0.8 });
      } else if (h) {
        // Valid only with another facing: dashed-looking thin outline, still not hatched.
        g.poly(flat(d)).fill({ color: TARGET_TILE, alpha: 0.05 }).stroke({ color: TARGET_TILE, width: 1, alpha: 0.45 });
      } else {
        g.poly(flat(d)).fill({ color: BLOCKED_TILE, alpha: 0.05 });
        // Hatching (colour is never the only carrier, GRAPHICS.md T6 BLOCKED_TILE).
        for (const f of [0.25, 0.5, 0.75]) {
          const a = floorAt({ gx, gy }, f, 0.1);
          const b = floorAt({ gx, gy }, f, 0.9);
          g.moveTo(a.x, a.y).lineTo(b.x, b.y);
        }
        g.stroke({ color: BLOCKED_TILE, width: 1, alpha: 0.32 });
      }
    }
  }
  // Only the current facing per tile (keeps the floor readable); all allowed facings of the hovered tile are shown
  // by drawGhostFootprint.
  for (const h of hints) if (h.facings.includes(facing)) facingChevron(g, h.tile, facing, TARGET_TILE, 0.13, 0.8);
}

/** Footprint of the ghost: blue = valid, red + hatch = invalid; chevron = where the front will point. */
export function drawGhostFootprint(g: Graphics, tile: Tile, facing: CabinetFacing, valid: boolean, allowed: readonly CabinetFacing[] = []): void {
  const d = flat(diamond(tile.gx, tile.gy, 1, 1));
  if (valid) {
    g.poly(d).fill({ color: TARGET_TILE, alpha: 0.32 }).stroke({ color: TARGET_TILE, width: 2.2 });
  } else {
    g.poly(d).fill({ color: BLOCKED_TILE, alpha: 0.28 }).stroke({ color: BLOCKED_TILE, width: 2.2 });
    for (const f of [0.2, 0.4, 0.6, 0.8]) {
      const a = floorAt(tile, f, 0.05);
      const b = floorAt(tile, f, 0.95);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    g.stroke({ color: OUTLINE, width: 1, alpha: 0.5 });
  }
  // Other facings the engine allows on this tile (small white chevrons at the tile edges; R cycles through them).
  for (const f of allowed) if (f !== facing) facingChevron(g, tile, f, 0xffffff, 0.12, 0.84);
  // Front indicator on the tile in front of the ghost.
  const s = STEP[facing];
  facingChevron(g, { gx: tile.gx + s.gx, gy: tile.gy + s.gy }, facing, valid ? TARGET_TILE : BLOCKED_TILE, 0.22, 0.25);
}

/** Front indicator of a standing rack: small chevron on the floor right in front of its front. */
export function drawRackFront(g: Graphics, tile: Tile, facing: CabinetFacing): void {
  const s = STEP[facing];
  facingChevron(g, { gx: tile.gx + s.gx, gy: tile.gy + s.gy }, facing, 0xffffff, 0.16, 0.2);
}

/** Wall-mounted pre-installed OOB switch at the back corner (0, 0): small navy box under the cable trays. */
export function drawOobSwitch(g: Graphics, tile: Tile): { label: P } {
  const z = 84;
  // Mounting bracket on the right wall + the box itself (game art; out of VCF scope).
  poly(g, [up(isoToScreen(tile.gx + 0.1, tile.gy), z - 4), up(isoToScreen(tile.gx + 0.62, tile.gy), z - 4), up(isoToScreen(tile.gx + 0.62, tile.gy), z + 20), up(isoToScreen(tile.gx + 0.1, tile.gy), z + 20)], 0x8592a3);
  prism(g, tile.gx + 0.12, tile.gy + 0.02, 0.48, 0.22, 14, { top: 0x4a6a96, front: 0x2b4a78, side: 0x213a60 }, z);
  for (let i = 0; i < 6; i++) {
    const p = up(isoToScreen(tile.gx + 0.18 + i * 0.065, tile.gy + 0.24), z + 6);
    g.rect(p.x - 0.8, p.y - 1, 1.6, 2);
  }
  g.fill({ color: 0xe6edf6 });
  const led = up(isoToScreen(tile.gx + 0.56, tile.gy + 0.24), z + 10);
  g.circle(led.x, led.y, 1.2).fill({ color: 0x3ccf7a });
  return { label: up(isoToScreen(tile.gx + 0.4, tile.gy + 0.1), z - 8) };
}
