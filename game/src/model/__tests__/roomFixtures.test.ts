import { describe, expect, it } from 'vitest';
import { buildRoomGrid, doorSpan, roomFixtures, wallJackSpan } from '../roomFixtures';
import { suggestRackTiles } from '../roomLayout';

describe('room fixtures ([GAME] shared engine / render data)', () => {
  it('door tile and wall patch panel follow the room size', () => {
    expect(doorSpan({ cols: 8, rows: 8 }).tile).toEqual({ gx: 0, gy: 5 });
    expect(doorSpan({ cols: 14, rows: 11 }).tile).toEqual({ gx: 0, gy: 8 });
    expect(wallJackSpan({ cols: 7, rows: 8 }).u1).toBeLessThanOrEqual(7);
    expect(wallJackSpan({ cols: 14, rows: 11 })).toEqual({ u0: 9.55, u1: 10.55 });
  });

  it('fixture tiles stay inside every room size and leave room for racks', () => {
    for (const f of [{ cols: 7, rows: 8 }, { cols: 8, rows: 8 }, { cols: 10, rows: 8 }, { cols: 11, rows: 9 }, { cols: 14, rows: 11 }]) {
      for (const x of roomFixtures(f)) for (const t of x.tiles) expect(t.gx >= 0 && t.gy >= 0 && t.gx < f.cols && t.gy < f.rows).toBe(true);
      expect(suggestRackTiles(buildRoomGrid('r', f, 4), []).length).toBeGreaterThan(10);
    }
  });
});
