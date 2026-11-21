import { describe, expect, it } from 'vitest';
import { isoToScreen } from '../iso';
import { depthOf, findPath, footprintTiles, nearestReachable, Occupancy, tileCenter, worldToTile } from './roomGrid';

const ROOM = { cols: 8, rows: 6 };

describe('roomGrid', () => {
  it('round-trips tile centre -> world -> tile', () => {
    for (let gy = 0; gy < ROOM.rows; gy++) {
      for (let gx = 0; gx < ROOM.cols; gx++) {
        const p = tileCenter(gx, gy);
        expect(worldToTile(ROOM, p.x, p.y)).toEqual({ gx, gy });
      }
    }
  });

  it('returns null outside the room', () => {
    const p = isoToScreen(-0.5, 2);
    expect(worldToTile(ROOM, p.x, p.y)).toBeNull();
    const q = isoToScreen(3, ROOM.rows + 0.2);
    expect(worldToTile(ROOM, q.x, q.y)).toBeNull();
  });

  it('lists footprint tiles and blocks them', () => {
    expect(footprintTiles({ gx: 1, gy: 2, w: 2, d: 1 })).toEqual([{ gx: 1, gy: 2 }, { gx: 2, gy: 2 }]);
    const occ = new Occupancy(ROOM);
    expect(occ.canPlace({ gx: 7, gy: 5, w: 1, d: 1 })).toBe(true);
    expect(occ.canPlace({ gx: 7, gy: 5, w: 2, d: 1 })).toBe(false);
    occ.set({ gx: 1, gy: 1, w: 2, d: 1 }, true);
    expect(occ.blocked(2, 1)).toBe(true);
    expect(occ.canPlace({ gx: 2, gy: 0, w: 1, d: 2 })).toBe(false);
    occ.set({ gx: 1, gy: 1, w: 2, d: 1 }, false);
    expect(occ.blocked(2, 1)).toBe(false);
  });

  it('sorts objects further front later', () => {
    expect(depthOf(2, 2)).toBeLessThan(depthOf(3, 2));
    expect(depthOf(2, 2)).toBeLessThan(depthOf(2, 3));
    // Avatar standing on a tile sorts like a 1x1 object on that tile.
    expect(2.5 + 3.5).toBe(depthOf(2, 3));
  });

  it('finds a shortest 4-connected path around obstacles', () => {
    const occ = new Occupancy(ROOM);
    // Wall at gx = 3 except the last row.
    for (let gy = 0; gy < ROOM.rows - 1; gy++) occ.set({ gx: 3, gy, w: 1, d: 1 }, true);
    const path = findPath(occ, { gx: 0, gy: 0 }, { gx: 6, gy: 0 });
    expect(path).not.toBeNull();
    expect(path!.at(-1)).toEqual({ gx: 6, gy: 0 });
    expect(path!.length).toBe(6 + 2 * (ROOM.rows - 1));
    for (let i = 1; i < path!.length; i++) {
      const a = path![i - 1]!;
      const b = path![i]!;
      expect(Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy)).toBe(1);
      expect(occ.blocked(b.gx, b.gy)).toBe(false);
    }
    expect(findPath(occ, { gx: 1, gy: 1 }, { gx: 1, gy: 1 })).toEqual([]);
  });

  it('reports unreachable targets and walks next to occupied tiles', () => {
    const occ = new Occupancy(ROOM);
    for (let gy = 0; gy < ROOM.rows; gy++) occ.set({ gx: 3, gy, w: 1, d: 1 }, true);
    expect(findPath(occ, { gx: 0, gy: 0 }, { gx: 6, gy: 0 })).toBeNull();
    const r = nearestReachable(occ, { gx: 0, gy: 2 }, { gx: 3, gy: 2 });
    expect(r?.tile).toEqual({ gx: 2, gy: 2 });
    expect(r?.path.at(-1)).toEqual({ gx: 2, gy: 2 });
  });
});
