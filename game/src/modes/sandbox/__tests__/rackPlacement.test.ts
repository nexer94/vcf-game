/**
 * [GAME] rack placement rules through the session (model roomLayout.ts + roomFixtures.ts via rackLayout.ts).
 * Default layout 'small-room': room-a1, 4 rack slots, floor 8 × 8; door (0,5) inward E (approach (1,5));
 * desk (0,2)+(0,3); whiteboard (1..4,0); wall patch panel (6..7,0); OOB switch spot (0,0).
 */
import { describe, expect, it } from 'vitest';
import { SandboxSession } from '../session';
import type { CommandResult, SandboxCommand } from '../types';
import { must } from './workbook';

const created = (r: CommandResult): string[] => (r.ok ? [...(r.created ?? [])] : []);
const codes = (r: ReturnType<typeof reject>) => (r.kind === 'validation' ? r.issues.map((i) => i.code) : r.kind === 'flow' ? [`flow:${r.reason}`] : [`${r.kind}`]);

function reject(s: SandboxSession, cmd: SandboxCommand) {
  const r = s.dispatch(cmd);
  if (r.ok) throw new Error(`${cmd.type} unexpectedly accepted`);
  return r.rejection;
}

const session = () => new SandboxSession({ autoBmc: false });
const ROOM = 'room-a1';

const place = (s: SandboxSession, gx: number, gy: number, facing?: 'N' | 'E' | 'S' | 'W', itemId = 'rack-generic-42u'): string =>
  created(must(s, { type: 'placeRack', itemId, tile: { gx, gy }, ...(facing ? { facing } : {}) }))[0]!;

const tryPlace = (s: SandboxSession, gx: number, gy: number, facing?: 'N' | 'E' | 'S' | 'W') =>
  reject(s, { type: 'placeRack', itemId: 'rack-generic-42u', tile: { gx, gy }, ...(facing ? { facing } : {}) });

const roomView = (s: SandboxSession, id = ROOM) => s.snapshot().site.layout.rooms.find((r) => r.id === id)!;
const rackView = (s: SandboxSession, id: string) => s.snapshot().physical.racks.find((r) => r.id === id)!;

describe('rack placement – aisles and rows ([GAME] room layout rules)', () => {
  it('one rack directly in front of another is blocked; a shared cold aisle (front-to-front, one tile gap) is ok', () => {
    const s = session();
    place(s, 3, 2); // default facing S: front (3,3)
    const r = tryPlace(s, 3, 3, 'N');
    expect(codes(r)).toEqual(expect.arrayContaining(['ROOM_RACK_AISLE_BLOCKED', 'ROOM_RACK_BLOCKS_AISLE']));
    expect(r.kind === 'validation' && r.issues.every((i) => i.scope === 'game-scope' && i.specRef === 'game: room layout rules')).toBe(true);
    // the bought rack of the rejected command is not kept
    expect(s.snapshot().physical.racks).toHaveLength(1);
    place(s, 3, 4, 'N'); // front (3,3) = shared cold aisle
    expect(roomView(s).placement.racks.map((x) => x.facing)).toEqual(['S', 'N']);
  });

  it('hot / cold mix on one aisle tile is blocked', () => {
    const s = session();
    place(s, 3, 2); // front (3,3)
    expect(codes(tryPlace(s, 3, 4, 'S'))).toEqual(['ROOM_RACK_AISLE_HOT_COLD_MIX']); // its back (3,3) = cold aisle of the first
  });

  it('side by side with the same facing is ok; a row neighbour facing elsewhere is blocked', () => {
    const s = session();
    place(s, 3, 2);
    place(s, 4, 2);
    expect(codes(tryPlace(s, 5, 2, 'N'))).toEqual(['ROOM_RACK_ROW_ORIENTATION_MISMATCH']);
    place(s, 5, 2, 'S');
    expect(roomView(s).placement.racks).toHaveLength(3);
  });

  it('rotateRack: validated, undoable, stored as rotation and shown as facing', () => {
    const s = session();
    const a = place(s, 3, 2);
    must(s, { type: 'rotateRack', rackId: a, facing: 'N' });
    expect(rackView(s, a).facing).toBe('N');
    expect(rackView(s, a).tile).toEqual({ gx: 3, gy: 2, rotation: 180 });
    expect(codes(reject(s, { type: 'rotateRack', rackId: a, facing: 'N' }))).toEqual(['flow:nothing-to-do']);
    const b = place(s, 4, 2, 'N');
    // row neighbour b faces N -> a cannot turn to S; facing E would put b into a's cold aisle
    expect(codes(reject(s, { type: 'rotateRack', rackId: a, facing: 'S' }))).toEqual(['ROOM_RACK_ROW_ORIENTATION_MISMATCH']);
    expect(codes(reject(s, { type: 'rotateRack', rackId: a, facing: 'E' }))).toEqual(expect.arrayContaining(['ROOM_RACK_AISLE_BLOCKED']));
    must(s, { type: 'removeItem', id: b }); // back to the inventory
    must(s, { type: 'rotateRack', rackId: a, facing: 'S' });
    must(s, { type: 'undoRoom' });
    expect(rackView(s, a).facing).toBe('N');
    expect(codes(reject(s, { type: 'rotateRack', rackId: b, facing: 'S' }))).toEqual(['flow:rack-not-placed']);
    expect(codes(reject(s, { type: 'rotateRack', rackId: a, facing: 'X' as never }))).toEqual(['flow:invalid-input']);
  });

  it('moving a placed rack keeps its facing; its own old tile does not block it', () => {
    const s = session();
    const a = place(s, 3, 2, 'E');
    must(s, { type: 'placeRack', rackId: a, tile: { gx: 3, gy: 3 } });
    expect(rackView(s, a).facing).toBe('E');
    must(s, { type: 'placeRack', rackId: a, tile: { gx: 3, gy: 3 }, facing: 'W' });
    expect(rackView(s, a).facing).toBe('W');
    must(s, { type: 'placeRack', rackId: a, tile: { gx: 4, gy: 4, rotation: 0 } });
    expect(rackView(s, a).facing).toBe('S');
  });
});

describe('rack placement – door and fixtures', () => {
  it('door, door approach and fixtures block the tile; fixtures cannot be a rack aisle', () => {
    const s = session();
    expect(codes(tryPlace(s, 0, 5, 'E'))).toContain('ROOM_TILE_BLOCKED'); // door
    expect(codes(tryPlace(s, 1, 5))).toEqual(['ROOM_TILE_BLOCKED']); // door approach
    expect(codes(tryPlace(s, 0, 2))).toContain('ROOM_TILE_BLOCKED'); // desk
    expect(codes(tryPlace(s, 0, 0))).toContain('ROOM_TILE_BLOCKED'); // OOB switch spot
    expect(codes(tryPlace(s, 6, 0, 'E'))).toContain('ROOM_TILE_BLOCKED'); // wall patch panel
    expect(codes(tryPlace(s, 2, 1))).toEqual(['ROOM_RACK_NO_CLEARANCE']); // back (2,0) = whiteboard
    expect(codes(tryPlace(s, 1, 3, 'W'))).toEqual(['ROOM_RACK_NO_CLEARANCE']); // front (0,3) = desk
    place(s, 2, 5, 'W'); // front (1,5) = door approach: walkable floor, allowed as aisle
    expect(codes(tryPlace(s, 8, 2))).toEqual(['ROOM_OUT_OF_BOUNDS']);
  });

  it('snapshot exposes the grid with door + fixtures from the shared fixture data', () => {
    const g = roomView(session()).placement.grid;
    expect({ cols: g.cols, rows: g.rows, rackSlots: g.rackSlots }).toEqual({ cols: 8, rows: 8, rackSlots: 4 });
    expect(g.door).toEqual({ tile: { gx: 0, gy: 5 }, inward: 'E' });
    expect(Object.fromEntries(g.fixtures.map((f) => [f.kind, f.tiles.length]))).toEqual({ desk: 2, whiteboard: 4, 'patch-panel': 2, 'oob-switch': 1 });
  });
});

describe('rack placement – room capacity counts placed racks only', () => {
  it('buying more racks than the room holds works; the slot limit applies when placing', () => {
    const s = session();
    const racks = created(must(s, { type: 'buyItem', itemId: 'rack-generic-42u', qty: 6 }));
    expect(racks).toHaveLength(6);
    expect(roomView(s).rackIds).toHaveLength(6); // assigned to the room, waiting in the inventory
    const tiles = [[2, 2], [3, 2], [4, 2], [5, 2], [6, 4]] as const;
    for (let i = 0; i < 4; i++) must(s, { type: 'placeRack', inventoryId: racks[i]!, tile: { gx: tiles[i]![0], gy: tiles[i]![1] } });
    expect(roomView(s).placement.freeSlots).toBe(0);
    const full = reject(s, { type: 'placeRack', inventoryId: racks[4]!, tile: { gx: 6, gy: 4 } });
    expect(codes(full)).toEqual(['SITE_ROOM_FULL']);
    expect(Object.values(roomView(s).placement.placement).every((h) => h.length === 0)).toBe(true);
    // a placed rack back to the inventory frees its slot
    must(s, { type: 'removeItem', id: racks[0]! });
    must(s, { type: 'placeRack', inventoryId: racks[4]!, tile: { gx: 6, gy: 4 } });
  });

  it('multi-room: inventory racks move freely; a placed rack needs a free slot in the target room', () => {
    const s = new SandboxSession({ autoBmc: false });
    must(s, { type: 'chooseBlueprint', blueprintId: 'vcf-fleet-multiple-sites-single-region', layoutId: 'two-buildings' });
    const [r1, r2, r3] = created(must(s, { type: 'buyItem', itemId: 'rack-generic-42u', qty: 3 }));
    must(s, { type: 'placeRack', inventoryId: r1!, tile: { gx: 3, gy: 3 }, roomId: 'room-c1' }); // 1 slot
    must(s, { type: 'moveRackToRoom', rackId: r2!, roomId: 'room-c1' }); // inventory rack: takes no slot
    must(s, { type: 'placeRack', inventoryId: r3!, tile: { gx: 3, gy: 3 }, roomId: 'room-a1' });
    expect(codes(reject(s, { type: 'moveRackToRoom', rackId: r3!, roomId: 'room-c1' }))).toEqual(['SITE_ROOM_FULL']);
    expect(codes(reject(s, { type: 'placeRack', inventoryId: r2!, tile: { gx: 5, gy: 6 } }))).toEqual(['SITE_ROOM_FULL']);
    must(s, { type: 'placeRack', inventoryId: r2!, tile: { gx: 4, gy: 5 }, roomId: 'room-b1' });
    expect(s.snapshot().site.layout.rackRooms[r2!]).toBe('room-b1');
  });
});

describe('rack placement – snapshot hints and aisles', () => {
  it('placement hints per rack model, aisles of standing racks, per-rack hints for moving', () => {
    const s = session();
    const before = roomView(s).placement;
    expect(Object.keys(before.placement).sort()).toEqual(['rack-generic-24u', 'rack-generic-42u', 'rack-generic-48u']);
    const hints = before.placement['rack-generic-42u']!;
    const at = (gx: number, gy: number) => hints.find((h) => h.tile.gx === gx && h.tile.gy === gy);
    expect(at(0, 5)).toBeUndefined(); // door
    expect(at(2, 1)?.facings).toEqual(['E', 'W']); // N/S would put an aisle on the whiteboard
    expect(at(3, 3)?.facings).toEqual(['N', 'E', 'S', 'W']);

    const a = place(s, 3, 2);
    const v = roomView(s).placement;
    expect(v.aisles).toEqual({ cold: [{ gx: 3, gy: 3 }], hot: [{ gx: 3, gy: 1 }] });
    const after = v.placement['rack-generic-42u']!;
    expect(after.some((h) => h.tile.gx === 3 && h.tile.gy === 3)).toBe(false); // its cold aisle
    expect(after.find((h) => h.tile.gx === 4 && h.tile.gy === 2)?.facings).toEqual(['S']); // row neighbour: same facing only

    expect(s.rackPlacementHints(ROOM, { rackId: a })?.some((h) => h.tile.gx === 3 && h.tile.gy === 2)).toBe(true);
    expect(s.rackPlacementHints(ROOM)?.some((h) => h.tile.gx === 3 && h.tile.gy === 2)).toBe(false);
    expect(s.rackPlacementHints(ROOM, { facing: 'N' })?.every((h) => h.facings.length === 1 && h.facings[0] === 'N')).toBe(true);
    expect(s.rackPlacementHints('room-zz')).toBeUndefined();
  });
});

describe('rack shop – three rack sizes', () => {
  it('catalog offers 24U / 42U / 48U with game prices; each can be bought and placed', () => {
    const s = session();
    const items = s.snapshot().physical.catalog.items.filter((i) => i.kind === 'rack');
    expect(items.map((i) => i.id).sort()).toEqual(['rack-generic-24u', 'rack-generic-42u', 'rack-generic-48u']);
    expect(items.every((i) => i.price > 0)).toBe(true);
    const r24 = place(s, 2, 2, 'S', 'rack-generic-24u');
    const r48 = place(s, 3, 2, 'S', 'rack-generic-48u');
    expect(rackView(s, r24).heightU).toBe(24);
    expect(rackView(s, r48).heightU).toBe(48);
    expect(s.snapshot().physical.economy.recent.map((e) => e.itemId)).toEqual(['rack-generic-24u', 'rack-generic-48u']);
  });
});
