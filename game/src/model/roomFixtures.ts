/**
 * Fixed fixtures of a Sandbox server room (desk, whiteboard, "Síť firmy" wall patch panel, pre-installed OOB switch,
 * door) – PURE GAME DATA, NOT VCF facts. Single source of the tiles for the engine (rack placement rules, roomLayout.ts)
 * and the render layer (render/room/fixtures.ts, render/room/roomStatic.ts draw them from these numbers).
 *
 * Grid conventions as in roomLayout.ts / render/room/roomGrid.ts: tile (gx, gy); the back walls run along gy = 0
 * (right wall, u along +gx) and gx = 0 (left wall, v along +gy).
 *
 * Wall-mounted fixtures (whiteboard, wall patch panel, OOB switch) block the floor tiles right below / in front of
 * them ([GAME]: the player needs access to them), so no rack and no rack aisle may use those tiles.
 *
 * Pure TypeScript: no DOM, no PixiJS.
 */
import { type RoomDoor, type RoomFixture, type RoomGrid, type Tile } from './roomLayout';

export interface RoomFloorSize {
  readonly cols: number;
  readonly rows: number;
}

/** [GAME] desk with the admin workstation: left wall, between the corner and the door. Size along +gx (w) / +gy (d). */
export const DESK_FOOTPRINT = { gx: 0, gy: 2, w: 1, d: 2 } as const;

/** [GAME] whiteboard on the right wall (gy = 0): u = tiles along +gx, h = px above the floor (drawing). */
export const BOARD_WALL = { u0: 1.0, u1: 4.05, h0: 54, h1: 114 } as const;

/** [GAME] "Síť firmy" wall patch panel on the right wall, near the far corner (u along +gx, h px – drawing). */
export const WALL_JACK = { u0: 9.55, u1: 10.55, h0: 40, h1: 74 } as const;

/**
 * [GAME] spot of the pre-installed, wall-mounted OOB switch (modes/sandbox/oob.ts): the back corner, where the cable
 * trays of both walls meet. The render layer draws it there.
 */
export const OOB_SWITCH_SPOT: Tile = { gx: 0, gy: 0 };

/** Wall patch panel span for a room (shifted left in small rooms so it stays on the wall). */
export function wallJackSpan(room: RoomFloorSize): { readonly u0: number; readonly u1: number } {
  const shift = Math.min(0, room.cols - 0.45 - WALL_JACK.u1);
  return { u0: WALL_JACK.u0 + shift, u1: WALL_JACK.u1 + shift };
}

/** [GAME] door on the left wall (gx = 0): wall span v0..v1 and the floor tile in front of it. Points inward = +gx (E). */
export function doorSpan(room: RoomFloorSize): { readonly v0: number; readonly v1: number; readonly tile: Tile } {
  const v0 = Math.max(1, room.rows - 3.4);
  return { v0, v1: v0 + 1.5, tile: { gx: 0, gy: Math.min(room.rows - 1, Math.floor(v0 + 0.75)) } };
}

/** Floor tiles under a wall span on the right wall (gy = 0), clamped to the room. */
function rightWallTiles(room: RoomFloorSize, u0: number, u1: number): Tile[] {
  const out: Tile[] = [];
  for (let gx = Math.max(0, Math.floor(u0)); gx <= Math.min(room.cols - 1, Math.ceil(u1) - 1); gx++) out.push({ gx, gy: 0 });
  return out;
}

/** [GAME] fixtures of a room with their floor tiles. */
export function roomFixtures(room: RoomFloorSize): RoomFixture[] {
  const desk: Tile[] = [];
  for (let gy = DESK_FOOTPRINT.gy; gy < DESK_FOOTPRINT.gy + DESK_FOOTPRINT.d; gy++)
    for (let gx = DESK_FOOTPRINT.gx; gx < DESK_FOOTPRINT.gx + DESK_FOOTPRINT.w; gx++) if (gx < room.cols && gy < room.rows) desk.push({ gx, gy });
  const jack = wallJackSpan(room);
  return [
    { id: '@pc', kind: 'desk', tiles: desk },
    { id: '@board', kind: 'whiteboard', tiles: rightWallTiles(room, BOARD_WALL.u0, BOARD_WALL.u1) },
    { id: '@wall-jack', kind: 'patch-panel', tiles: rightWallTiles(room, jack.u0, jack.u1) },
    { id: '@oob-switch', kind: 'oob-switch', tiles: [OOB_SWITCH_SPOT] },
  ];
}

export function roomDoorOf(room: RoomFloorSize): RoomDoor {
  return { tile: doorSpan(room).tile, inward: 'E' };
}

/** [GAME] floor grid of a room for the rack placement rules (roomLayout.validateRackPlacement). */
export function buildRoomGrid(roomId: string, floor: RoomFloorSize, rackSlots: number): RoomGrid {
  return { roomId, cols: floor.cols, rows: floor.rows, rackSlots, door: roomDoorOf(floor), fixtures: roomFixtures(floor), gameDefault: true };
}
