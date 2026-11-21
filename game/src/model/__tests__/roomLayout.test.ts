import { describe, expect, it } from 'vitest';
import { RACK_MODELS, DEFAULT_RACK_MODEL_ID } from '../hardwareCatalogCore';
import {
  type PlacedRack,
  type RoomGrid,
  aisleTiles,
  backTile,
  facingToRotation,
  frontTile,
  rotationToFacing,
  suggestRackTiles,
  validateRackPlacement,
} from '../roomLayout';

// 8 × 8 room, door on the bottom wall at (0,7) pointing north into the room; desk at (7,0).
const grid = (over: Partial<RoomGrid> = {}): RoomGrid => ({
  roomId: 'room-a1',
  cols: 8,
  rows: 8,
  rackSlots: 6,
  door: { tile: { gx: 0, gy: 7 }, inward: 'N' },
  fixtures: [
    { id: 'desk', kind: 'desk', tiles: [{ gx: 7, gy: 0 }] },
    { id: 'wb', kind: 'whiteboard', tiles: [{ gx: 7, gy: 4 }] },
  ],
  gameDefault: true,
  ...over,
});
const rack = (rackId: string, gx: number, gy: number, facing: PlacedRack['facing'] = 'S'): PlacedRack => ({ rackId, tile: { gx, gy }, facing });
const codes = (g: RoomGrid, ex: PlacedRack[], c: PlacedRack) => [...new Set(validateRackPlacement(g, ex, c).issues.map((i) => i.code))];

describe('rack catalog – three game sizes', () => {
  it('24U / 42U / 48U with stable ids, 1×1 footprint, game defaults', () => {
    expect(RACK_MODELS.map((r) => [r.id, r.heightU, r.size])).toEqual([
      ['rack-generic-24u', 24, 'half'],
      ['rack-generic-42u', 42, 'standard'],
      ['rack-generic-48u', 48, 'tall'],
    ]);
    expect(DEFAULT_RACK_MODEL_ID).toBe('rack-generic-42u');
    for (const r of RACK_MODELS) expect(r).toMatchObject({ footprint: { widthTiles: 1, depthTiles: 1 }, gameGeneric: true, gameDefault: true });
  });
});

describe('room layout – geometry helpers', () => {
  it('front / back tiles follow the facing', () => {
    expect(frontTile(rack('r', 2, 2, 'S'))).toEqual({ gx: 2, gy: 3 });
    expect(backTile(rack('r', 2, 2, 'S'))).toEqual({ gx: 2, gy: 1 });
    expect(frontTile(rack('r', 2, 2, 'E'))).toEqual({ gx: 3, gy: 2 });
  });
  it('rotation <-> facing round-trips', () => {
    for (const r of [0, 90, 180, 270] as const) expect(facingToRotation(rotationToFacing(r))).toBe(r);
  });
});

describe('validateRackPlacement – game rules', () => {
  it('a lone rack with free front and back is fine; all issues are game-scope', () => {
    expect(validateRackPlacement(grid(), [], rack('r1', 2, 2)).ok).toBe(true);
    const bad = validateRackPlacement(grid(), [], rack('r1', 99, 2));
    expect(bad.issues.every((i) => i.scope === 'game-scope' && i.specRef.startsWith('game:'))).toBe(true);
  });

  it('out of bounds', () => {
    expect(codes(grid(), [], rack('r1', 8, 0))).toEqual(['ROOM_OUT_OF_BOUNDS']);
    expect(codes(grid(), [], rack('r1', -1, 3))).toEqual(['ROOM_OUT_OF_BOUNDS']);
  });

  it('needs clearance inside the room: no rack with its back against the wall', () => {
    expect(codes(grid(), [], rack('r1', 2, 0, 'S'))).toEqual(['ROOM_RACK_NO_CLEARANCE']);
    // fixture in front
    const r = validateRackPlacement(grid(), [], rack('r1', 7, 5, 'N'));
    expect(r.issues.map((i) => i.code)).toEqual(['ROOM_RACK_NO_CLEARANCE']);
    expect(r.problems[0]).toMatchObject({ fixtureId: 'wb', tile: { gx: 7, gy: 4 } });
  });

  it('door tile, door approach and fixtures are blocked', () => {
    expect(codes(grid(), [], rack('r1', 0, 7, 'E'))).toContain('ROOM_TILE_BLOCKED');
    expect(codes(grid(), [], rack('r1', 0, 6, 'E'))).toContain('ROOM_TILE_BLOCKED');
    const desk = validateRackPlacement(grid(), [], rack('r1', 7, 0, 'W'));
    expect(desk.problems.find((p) => p.issue.code === 'ROOM_TILE_BLOCKED')).toMatchObject({ fixtureId: 'desk' });
  });

  it('door approach may serve as an aisle', () => {
    // rack at (1,6) facing W: front = (0,6) = door approach -> allowed
    expect(validateRackPlacement(grid(), [], rack('r1', 1, 6, 'W')).ok).toBe(true);
  });

  it('occupied tile', () => {
    expect(codes(grid(), [rack('a', 2, 2)], rack('b', 2, 2))).toContain('ROOM_TILE_OCCUPIED');
  });

  it('one rack directly in front of another is rejected', () => {
    const a = rack('a', 2, 2, 'S');
    // b in front of a (tile (2,3)), same facing: b blocks a's cold aisle, a blocks b's hot aisle
    const c = codes(grid(), [a], rack('b', 2, 3, 'S'));
    expect(c).toContain('ROOM_RACK_BLOCKS_AISLE');
    expect(c).toContain('ROOM_RACK_AISLE_BLOCKED');
    // facing each other directly (front to front, no gap)
    expect(codes(grid(), [a], rack('b', 2, 3, 'N'))).toEqual(expect.arrayContaining(['ROOM_RACK_BLOCKS_AISLE', 'ROOM_RACK_AISLE_BLOCKED']));
  });

  it('back-to-back without a gap is rejected (hot aisle blocked)', () => {
    expect(codes(grid(), [rack('a', 2, 2, 'N')], rack('b', 2, 3, 'S'))).toEqual(expect.arrayContaining(['ROOM_RACK_BLOCKS_AISLE', 'ROOM_RACK_AISLE_BLOCKED']));
  });

  it('front-to-front with one free tile = shared cold aisle: OK', () => {
    expect(validateRackPlacement(grid(), [rack('a', 2, 2, 'S')], rack('b', 2, 4, 'N')).ok).toBe(true);
  });

  it('back-to-back with one free tile = shared hot aisle: OK', () => {
    expect(validateRackPlacement(grid(), [rack('a', 2, 2, 'N')], rack('b', 2, 4, 'S')).ok).toBe(true);
  });

  it('cold aisle facing a hot aisle on the same tile is rejected', () => {
    // a at (2,2) facing S -> front (2,3); b at (2,4) facing S -> back (2,3)
    expect(codes(grid(), [rack('a', 2, 2, 'S')], rack('b', 2, 4, 'S'))).toEqual(['ROOM_RACK_AISLE_HOT_COLD_MIX']);
  });

  it('side by side in a row with the same facing: OK', () => {
    const row = [rack('a', 2, 2, 'S'), rack('b', 3, 2, 'S')];
    expect(validateRackPlacement(grid(), row, rack('c', 4, 2, 'S')).ok).toBe(true);
    expect(validateRackPlacement(grid(), row, rack('c', 1, 2, 'S')).ok).toBe(true);
  });

  it('row neighbours with a different facing are rejected', () => {
    expect(codes(grid(), [rack('a', 2, 2, 'S')], rack('b', 3, 2, 'N'))).toEqual(['ROOM_RACK_ROW_ORIENTATION_MISMATCH']);
    const r = validateRackPlacement(grid(), [rack('a', 2, 2, 'S')], rack('b', 3, 2, 'N'));
    expect(r.problems[0]).toMatchObject({ otherRackId: 'a' });
  });

  it('perpendicular neighbour that stands in an aisle is caught as aisle blocking', () => {
    // a faces S at (2,2); b at (3,2) facing E: b's back is (2,2) = a
    expect(codes(grid(), [rack('a', 2, 2, 'S')], rack('b', 3, 2, 'E'))).toEqual(
      expect.arrayContaining(['ROOM_RACK_AISLE_BLOCKED', 'ROOM_RACK_ROW_ORIENTATION_MISMATCH']),
    );
  });

  it('room capacity (rackSlots)', () => {
    const g = grid({ rackSlots: 2 });
    const ex = [rack('a', 2, 2), rack('b', 3, 2)];
    expect(codes(g, ex, rack('c', 4, 2))).toEqual(['SITE_ROOM_FULL']);
    // moving an existing rack inside a full room is fine
    expect(validateRackPlacement(g, ex, rack('b', 4, 2)).ok).toBe(true);
  });

  it('moving / rotating a rack ignores its own old position', () => {
    expect(validateRackPlacement(grid(), [rack('a', 2, 2, 'S')], rack('a', 2, 3, 'N')).ok).toBe(true);
  });
});

describe('suggestRackTiles / aisleTiles', () => {
  it('suggests only valid tiles, each validated', () => {
    const g = grid();
    const ex = [rack('a', 2, 2, 'S')];
    const s = suggestRackTiles(g, ex);
    expect(s.length).toBeGreaterThan(0);
    for (const { tile, facings } of s) for (const f of facings) expect(validateRackPlacement(g, ex, { rackId: 'x', tile, facing: f }).ok).toBe(true);
    const keys = s.map((x) => `${x.tile.gx},${x.tile.gy}`);
    expect(keys).not.toContain('2,3'); // a's cold aisle
    expect(keys).not.toContain('0,6'); // door approach
    expect(s.find((x) => x.tile.gx === 3 && x.tile.gy === 2)?.facings).toEqual(['S']); // row with a
  });

  it('respects a fixed facing and a full room', () => {
    const onlyN = suggestRackTiles(grid(), [], { facing: 'N' });
    expect(onlyN.every((x) => x.facings.length === 1 && x.facings[0] === 'N')).toBe(true);
    expect(suggestRackTiles(grid({ rackSlots: 1 }), [rack('a', 2, 2)])).toEqual([]);
    expect(suggestRackTiles(grid({ rackSlots: 1 }), [rack('a', 2, 2)], { rackId: 'a' }).length).toBeGreaterThan(0);
  });

  it('aisle tiles for drawing', () => {
    expect(aisleTiles(grid(), [rack('a', 2, 2, 'S'), rack('b', 2, 4, 'N')])).toEqual({ cold: [{ gx: 2, gy: 3 }], hot: [{ gx: 2, gy: 1 }, { gx: 2, gy: 5 }] });
  });
});
