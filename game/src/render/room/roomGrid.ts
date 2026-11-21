/**
 * Pure grid math for the isometric server room (no PixiJS): tile <-> world,
 * footprints, occupancy, depth sorting and A* path finding.
 *
 * Coordinates: tile (gx, gy) covers [gx, gx+1) x [gy, gy+1). The back walls run
 * along gy = 0 (right wall) and gx = 0 (left wall); +gx goes front-right,
 * +gy goes front-left on screen (same projection as ../iso.ts).
 */
import { isoToScreen, TILE_H, TILE_W } from '../iso';

export interface Tile {
  readonly gx: number;
  readonly gy: number;
}

export interface Footprint extends Tile {
  /** Size along +gx (tiles). */
  readonly w: number;
  /** Size along +gy (tiles). */
  readonly d: number;
}

export interface RoomSize {
  readonly cols: number;
  readonly rows: number;
}

/** World position of the tile's centre on the floor. */
export function tileCenter(gx: number, gy: number): { x: number; y: number } {
  return isoToScreen(gx + 0.5, gy + 0.5);
}

/** Inverse projection: world point on the floor -> continuous grid coords. */
export function worldToGrid(x: number, y: number): { gx: number; gy: number } {
  const a = x / (TILE_W / 2);
  const b = y / (TILE_H / 2);
  return { gx: (a + b) / 2, gy: (b - a) / 2 };
}

/** World point on the floor -> tile, or null outside the room. */
export function worldToTile(room: RoomSize, x: number, y: number): Tile | null {
  const g = worldToGrid(x, y);
  const gx = Math.floor(g.gx);
  const gy = Math.floor(g.gy);
  return inRoom(room, gx, gy) ? { gx, gy } : null;
}

export function inRoom(room: RoomSize, gx: number, gy: number): boolean {
  return gx >= 0 && gy >= 0 && gx < room.cols && gy < room.rows;
}

/** All tiles covered by a footprint. */
export function footprintTiles(f: Footprint): Tile[] {
  const out: Tile[] = [];
  for (let y = f.gy; y < f.gy + f.d; y++) for (let x = f.gx; x < f.gx + f.w; x++) out.push({ gx: x, gy: y });
  return out;
}

export function footprintFits(room: RoomSize, f: Footprint): boolean {
  return f.w > 0 && f.d > 0 && inRoom(room, f.gx, f.gy) && inRoom(room, f.gx + f.w - 1, f.gy + f.d - 1);
}

/**
 * Painter's-order key: larger = drawn later (in front). Uses the footprint
 * centre so that 1x1 objects and the walking avatar sort consistently.
 */
export function depthOf(gx: number, gy: number, w = 1, d = 1): number {
  return gx + w / 2 + (gy + d / 2);
}

/** Boolean occupancy grid (true = blocked). */
export class Occupancy {
  private readonly cells: Uint8Array;

  constructor(readonly room: RoomSize) {
    this.cells = new Uint8Array(room.cols * room.rows);
  }

  blocked(gx: number, gy: number): boolean {
    return !inRoom(this.room, gx, gy) || this.cells[gy * this.room.cols + gx] !== 0;
  }

  /** True if every tile of the footprint is inside the room and free. */
  canPlace(f: Footprint): boolean {
    if (!footprintFits(this.room, f)) return false;
    return footprintTiles(f).every((t) => !this.blocked(t.gx, t.gy));
  }

  set(f: Footprint, value: boolean): void {
    for (const t of footprintTiles(f)) {
      if (inRoom(this.room, t.gx, t.gy)) this.cells[t.gy * this.room.cols + t.gx] = value ? 1 : 0;
    }
  }
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 4-connected A* (tile-by-tile walking). Returns the tiles from `from`
 * (exclusive) to `to` (inclusive); [] if already there; null if unreachable.
 * The start tile may be blocked (avatar standing next to a freshly placed object).
 */
export function findPath(grid: Occupancy, from: Tile, to: Tile): Tile[] | null {
  const { cols, rows } = grid.room;
  if (from.gx === to.gx && from.gy === to.gy) return [];
  if (!inRoom(grid.room, to.gx, to.gy) || grid.blocked(to.gx, to.gy)) return null;
  const n = cols * rows;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const idx = (x: number, y: number): number => y * cols + x;
  const hScore = (i: number): number => Math.abs((i % cols) - to.gx) + Math.abs(Math.floor(i / cols) - to.gy);
  const start = idx(from.gx, from.gy);
  const goal = idx(to.gx, to.gy);
  g[start] = 0;
  // Small grids (a room): a linear-scan open list is simpler and fast enough.
  const open: number[] = [start];
  while (open.length > 0) {
    let bi = 0;
    let bf = Infinity;
    for (let k = 0; k < open.length; k++) {
      const i = open[k]!;
      const f = g[i]! + hScore(i);
      if (f < bf) {
        bf = f;
        bi = k;
      }
    }
    const cur = open[bi]!;
    open[bi] = open[open.length - 1]!;
    open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (grid.blocked(nx, ny)) continue;
      const ni = idx(nx, ny);
      const ng = g[cur]! + 1;
      if (ng < g[ni]!) {
        g[ni] = ng;
        came[ni] = cur;
        open.push(ni);
      }
    }
  }
  if (came[goal] === -1) return null;
  const path: Tile[] = [];
  for (let i = goal; i !== start; i = came[i]!) path.push({ gx: i % cols, gy: Math.floor(i / cols) });
  return path.reverse();
}

/**
 * Nearest free tile to `target` (grid distance; ties prefer the front side)
 * that is reachable from `from`. Used when the player clicks an occupied tile:
 * the avatar walks next to the object instead. One BFS + one A*.
 */
export function nearestReachable(grid: Occupancy, from: Tile, target: Tile): { tile: Tile; path: Tile[] } | null {
  const direct = findPath(grid, from, target);
  if (direct) return { tile: target, path: direct };
  const { cols } = grid.room;
  const seen = new Set<number>([from.gy * cols + from.gx]);
  const queue: Tile[] = [from];
  let best: Tile | null = null;
  let bestKey = Infinity;
  for (let q = 0; q < queue.length; q++) {
    const t = queue[q]!;
    const key = (Math.abs(t.gx - target.gx) + Math.abs(t.gy - target.gy)) * 1000 - (t.gx + t.gy);
    if (key < bestKey) {
      bestKey = key;
      best = t;
    }
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = t.gx + dx;
      const ny = t.gy + dy;
      const i = ny * cols + nx;
      if (grid.blocked(nx, ny) || seen.has(i)) continue;
      seen.add(i);
      queue.push({ gx: nx, gy: ny });
    }
  }
  if (!best) return null;
  const path = findPath(grid, from, best);
  return path ? { tile: best, path } : null;
}
