/**
 * Rack placement in the rooms of the Sandbox – glue between the engine state (`room.rackTiles`, model racks with
 * their `roomId`) and the model's [GAME] room layout rules (model/roomLayout.ts, model/roomFixtures.ts).
 *
 * Nothing here is a VCF fact: floor sizes, fixtures, door, aisles and rack slots are game rules (scope 'game-scope').
 * Rotation convention of `RoomTile.rotation` (stored, saves): model `rotationToFacing` – 0 = S (front towards +gy,
 * the face the render layer draws as the rack front), clockwise 90 = W, 180 = N, 270 = E.
 */
import {
  type AisleTiles,
  type Facing,
  type HardwareCatalog,
  type PhysicalState,
  type PlacedRack,
  type RackPlacementResult,
  type RackTileSuggestion,
  type RoomGrid,
  aisleTiles,
  buildRoomGrid,
  facingToRotation,
  roomById,
  roomOfRack,
  rotationToFacing,
  sitesOf,
  suggestRackTiles,
  validateRackPlacement,
} from '../../model';
import type { RoomTile, SandboxRoomState } from './types';

export interface RoomFloor {
  readonly cols: number;
  readonly rows: number;
}

/** [GAME] floor size (tiles) of a room from the model's [GAME] rack slots – illustrative, drawing + tile bounds. */
export function roomFloorSize(rackSlots: number): RoomFloor {
  if (rackSlots <= 1) return { cols: 7, rows: 8 };
  if (rackSlots <= 4) return { cols: 8, rows: 8 };
  if (rackSlots <= 6) return { cols: 10, rows: 8 };
  if (rackSlots <= 8) return { cols: 11, rows: 9 };
  return { cols: 14, rows: 11 };
}

export const isFacing = (x: unknown): x is Facing => x === 'N' || x === 'E' || x === 'S' || x === 'W';

/** Facing of a stored tile (rotation omitted = 0 = S). */
export const facingOfTile = (t: RoomTile): Facing => rotationToFacing(t.rotation ?? 0);

/** Stored tile for a facing. */
export const tileWithFacing = (gx: number, gy: number, facing: Facing): RoomTile => ({ gx, gy, rotation: facingToRotation(facing) });

/** [GAME] racks take a room slot only once placed on the floor; inventory racks take none (model RoomCapacityOptions). */
export const occupiesSlot =
  (room: SandboxRoomState) =>
  (rackId: string): boolean =>
    room.rackTiles[rackId] !== undefined;

/** Floor grid of a room (engine floor size + door + fixtures), undefined for an unknown room. */
export function roomGridOf(p: PhysicalState, roomId: string): RoomGrid | undefined {
  const def = roomById(sitesOf(p), roomId);
  return def ? buildRoomGrid(def.id, roomFloorSize(def.rackSlots), def.rackSlots) : undefined;
}

/** Racks standing in a room (placed + assigned to it). */
export function placedRacksInRoom(room: SandboxRoomState, roomId: string): PlacedRack[] {
  const out: PlacedRack[] = [];
  for (const r of room.physical.racks) {
    const t = room.rackTiles[r.id];
    if (t && roomOfRack(room.physical, r.id) === roomId) out.push({ rackId: r.id, tile: { gx: t.gx, gy: t.gy }, facing: facingOfTile(t) });
  }
  return out;
}

/** Validates `rackId` standing at `tile` / `facing` in `roomId` (model validateRackPlacement). */
export function checkRackPlacement(room: SandboxRoomState, roomId: string, rackId: string, tile: { readonly gx: number; readonly gy: number }, facing: Facing): RackPlacementResult | undefined {
  const grid = roomGridOf(room.physical, roomId);
  if (!grid) return undefined;
  return validateRackPlacement(grid, placedRacksInRoom(room, roomId), { rackId, tile: { gx: tile.gx, gy: tile.gy }, facing });
}

// ---------------------------------------------------------------------------
// Snapshot view
// ---------------------------------------------------------------------------

export interface RoomPlacementView {
  readonly roomId: string;
  /** [GAME] floor grid: size, rack slots, door, fixtures (tiles a rack cannot use). */
  readonly grid: RoomGrid;
  /** Racks standing in the room with their facing. */
  readonly racks: readonly PlacedRack[];
  /** Free rack slots ([GAME] capacity minus placed racks). */
  readonly freeSlots: number;
  /**
   * Ghost hints for placing a NEW rack (from the inventory or the shop): rack model id -> valid tiles with the facings
   * that pass the rules (model suggestRackTiles). All generic racks are 1×1, so every model has the same list today;
   * keyed by model so that larger footprints can differ later. Empty when the room is full.
   * Moving an already placed rack: SandboxSession.rackPlacementHints(roomId, { rackId }).
   */
  readonly placement: Readonly<Record<string, readonly RackTileSuggestion[]>>;
  /** Cold (front) / hot (back) aisle tiles of the standing racks (for drawing). */
  readonly aisles: AisleTiles;
  readonly gameDefault: true;
}

export function roomPlacementView(room: SandboxRoomState, catalog: HardwareCatalog, roomId: string): RoomPlacementView | undefined {
  const grid = roomGridOf(room.physical, roomId);
  if (!grid) return undefined;
  const racks = placedRacksInRoom(room, roomId);
  const hints = suggestRackTiles(grid, racks);
  const placement: Record<string, readonly RackTileSuggestion[]> = {};
  for (const id of catalog.racks.keys()) placement[id] = hints;
  return { roomId, grid, racks, freeSlots: Math.max(0, grid.rackSlots - racks.length), placement, aisles: aisleTiles(grid, racks), gameDefault: true };
}

/**
 * Ghost hints for one rack: `rackId` = a rack being moved (its own tile is free for itself), `facing` restricts the
 * check to one facing. Undefined for an unknown room.
 */
export function rackPlacementHints(room: SandboxRoomState, roomId: string, opts: { readonly rackId?: string; readonly facing?: Facing } = {}): RackTileSuggestion[] | undefined {
  const grid = roomGridOf(room.physical, roomId);
  if (!grid) return undefined;
  return suggestRackTiles(grid, placedRacksInRoom(room, roomId), { ...(opts.rackId !== undefined ? { rackId: opts.rackId } : {}), ...(opts.facing ? { facing: opts.facing } : {}) });
}
