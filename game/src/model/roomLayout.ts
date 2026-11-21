/**
 * Room layout rules for racks – PURE GAME RULES (physical / game scope), NOT VCF facts.
 *
 * Nothing in this module comes from docs/spec/: the VCF documentation does not prescribe how racks stand in a
 * server room. These are game defaults (`gameDefault`, issues with scope 'game-scope') so that the Sandbox room
 * looks and behaves like a tidy data hall with hot / cold aisles. Every issue has specRef 'game: room layout rules'.
 *
 * Grid: tiles `{ gx, gy }`, gx = column (0..cols-1), gy = row (0..rows-1).
 * Facing = the direction the rack FRONT points to:  N = -gy, S = +gy, E = +gx, W = -gx.
 *
 * Rules ([GAME]):
 *  R1 bounds        – the rack tile lies inside the room floor                      -> ROOM_OUT_OF_BOUNDS
 *  R2 fixtures      – not on a fixture (desk, whiteboard, wall patch panel, OOB switch spot…), not on the door tile
 *                     and not on the door approach (DOOR_APPROACH_DEPTH tiles inward) -> ROOM_TILE_BLOCKED
 *  R3 occupied      – not on a tile where another rack stands                         -> ROOM_TILE_OCCUPIED
 *  R4 own clearance – the tile in front (cold aisle / servicing) and the tile behind (hot aisle / cabling) must be
 *                     inside the room and not a fixture / door tile                   -> ROOM_RACK_NO_CLEARANCE
 *                     (door approach tiles ARE allowed as aisle – they are walkable floor)
 *  R5 aisle blocked – no other rack may stand on the candidate's front / back tile    -> ROOM_RACK_AISLE_BLOCKED
 *  R6 blocks aisle  – the candidate may not stand on another rack's front / back tile -> ROOM_RACK_BLOCKS_AISLE
 *                     (=> "one rack directly in front of another" is impossible)
 *  R7 hot/cold mix  – one aisle tile cannot be the front (cold) clearance of one rack and the back (hot) clearance
 *                     of another; shared cold aisle (front-to-front) and shared hot aisle (back-to-back) with one
 *                     free tile between the racks are allowed                         -> ROOM_RACK_AISLE_HOT_COLD_MIX
 *  R8 row           – racks standing side by side (neighbour across the side wall) form a row and must share the
 *                     same facing                                                     -> ROOM_RACK_ROW_ORIENTATION_MISMATCH
 *  R9 capacity      – at most `rackSlots` racks in the room (RoomDef.rackSlots, sites.ts) -> SITE_ROOM_FULL
 *
 * Footprint: all generic racks are 1×1 tile (RackModel.footprint, hardwareCatalogCore.ts), so rules work per tile.
 * Not modelled (open for the orchestrator): walkable path from the door to every aisle, wider aisles, side clearance
 * at row ends, weight / power per tile.
 *
 * Pure TypeScript: no DOM, no PixiJS.
 */
import { type ValidationIssue, issue } from './validation';

export type Facing = 'N' | 'E' | 'S' | 'W';
export const FACINGS: readonly Facing[] = ['N', 'E', 'S', 'W'];

export interface Tile {
  readonly gx: number;
  readonly gy: number;
}

export type FixtureKind = 'desk' | 'whiteboard' | 'patch-panel' | 'oob-switch' | 'other';

/** [GAME] fixed furniture / equipment of a room that racks cannot stand on. */
export interface RoomFixture {
  readonly id: string;
  readonly kind: FixtureKind;
  readonly tiles: readonly Tile[];
}

/** [GAME] door of a room: its tile (inside the floor grid) and the direction pointing into the room. */
export interface RoomDoor {
  readonly tile: Tile;
  readonly inward: Facing;
}

/** [GAME] floor grid of one room. Fill `rackSlots` from RoomDef.rackSlots (sites.ts). */
export interface RoomGrid {
  readonly roomId: string;
  readonly cols: number;
  readonly rows: number;
  readonly rackSlots: number;
  readonly door?: RoomDoor;
  readonly fixtures: readonly RoomFixture[];
  readonly gameDefault: true;
}

/** A rack standing (or about to stand) in the room. */
export interface PlacedRack {
  readonly rackId: string;
  readonly tile: Tile;
  readonly facing: Facing;
}

/** [GAME] how many tiles inward from the door must stay free of racks. */
export const DOOR_APPROACH_DEPTH = 1;

const ROOM_REF = 'game: room layout rules';

const STEP: Readonly<Record<Facing, Tile>> = { N: { gx: 0, gy: -1 }, S: { gx: 0, gy: 1 }, E: { gx: 1, gy: 0 }, W: { gx: -1, gy: 0 } };
const OPPOSITE: Readonly<Record<Facing, Facing>> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export const tileKey = (t: Tile): string => `${t.gx},${t.gy}`;
export const sameTile = (a: Tile, b: Tile): boolean => a.gx === b.gx && a.gy === b.gy;
export const stepTile = (t: Tile, f: Facing, n = 1): Tile => ({ gx: t.gx + STEP[f].gx * n, gy: t.gy + STEP[f].gy * n });
export const oppositeFacing = (f: Facing): Facing => OPPOSITE[f];

/**
 * [GAME] mapping of the sandbox `rotation` (0/90/180/270, clockwise) to a facing: 0 = front towards +gy (S),
 * then clockwise S -> W -> N -> E. The UI may use its own mapping; the model only needs a Facing.
 */
export function rotationToFacing(rotation: 0 | 90 | 180 | 270 = 0): Facing {
  return (['S', 'W', 'N', 'E'] as const)[rotation / 90] ?? 'S';
}
export function facingToRotation(f: Facing): 0 | 90 | 180 | 270 {
  return ({ S: 0, W: 90, N: 180, E: 270 } as const)[f];
}

/** Tile in front of the rack (cold aisle / access for servicing). */
export const frontTile = (r: Pick<PlacedRack, 'tile' | 'facing'>): Tile => stepTile(r.tile, r.facing);
/** Tile behind the rack (hot aisle / cabling). */
export const backTile = (r: Pick<PlacedRack, 'tile' | 'facing'>): Tile => stepTile(r.tile, OPPOSITE[r.facing]);
/** The two side neighbours (row direction). */
export function sideTiles(r: Pick<PlacedRack, 'tile' | 'facing'>): readonly [Tile, Tile] {
  const axis: Facing = r.facing === 'N' || r.facing === 'S' ? 'E' : 'N';
  return [stepTile(r.tile, axis), stepTile(r.tile, OPPOSITE[axis])];
}

export const inBounds = (grid: Pick<RoomGrid, 'cols' | 'rows'>, t: Tile): boolean =>
  Number.isInteger(t.gx) && Number.isInteger(t.gy) && t.gx >= 0 && t.gy >= 0 && t.gx < grid.cols && t.gy < grid.rows;

/** Door tile + approach tiles (DOOR_APPROACH_DEPTH inward). */
export function doorTiles(grid: RoomGrid): Tile[] {
  if (!grid.door) return [];
  const out: Tile[] = [grid.door.tile];
  for (let i = 1; i <= DOOR_APPROACH_DEPTH; i++) out.push(stepTile(grid.door.tile, grid.door.inward, i));
  return out;
}

type Blocker = { readonly kind: 'fixture'; readonly id: string; readonly fixtureKind: FixtureKind } | { readonly kind: 'door' } | { readonly kind: 'door-approach' };

function blockerAt(grid: RoomGrid, t: Tile): Blocker | undefined {
  for (const f of grid.fixtures) if (f.tiles.some((x) => sameTile(x, t))) return { kind: 'fixture', id: f.id, fixtureKind: f.kind };
  if (grid.door) {
    if (sameTile(grid.door.tile, t)) return { kind: 'door' };
    if (doorTiles(grid).slice(1).some((x) => sameTile(x, t))) return { kind: 'door-approach' };
  }
  return undefined;
}

const blockerText = (b: Blocker): string => (b.kind === 'fixture' ? `${b.fixtureKind} ${b.id}` : b.kind === 'door' ? 'the door' : 'the door approach');

/** Structured problem for the UI (tile to highlight, other rack / fixture involved). */
export interface RackPlacementProblem {
  readonly issue: ValidationIssue;
  /** Tile the problem is about (rack tile or aisle tile). */
  readonly tile: Tile;
  readonly otherRackId?: string;
  readonly fixtureId?: string;
}

export interface RackPlacementResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly problems: readonly RackPlacementProblem[];
}

/**
 * [GAME] validates placing (or moving, same `rackId`) `candidate` into the room. `existing` = racks already standing
 * in this room; an entry with the candidate's rackId is ignored (move / rotate). Reports all broken rules (R1–R9).
 */
export function validateRackPlacement(grid: RoomGrid, existing: readonly PlacedRack[], candidate: PlacedRack): RackPlacementResult {
  const problems: RackPlacementProblem[] = [];
  const add = (p: RackPlacementProblem) => problems.push(p);
  const others = existing.filter((r) => r.rackId !== candidate.rackId);
  const c = candidate;
  const where = tileKey(c.tile);

  // R9 capacity
  if (others.length >= grid.rackSlots)
    add({ tile: c.tile, issue: issue('SITE_ROOM_FULL', 'error', `Room ${grid.roomId} has room for ${grid.rackSlots} rack(s) only.`, ROOM_REF, grid.roomId, 'game-scope') });

  // R1 bounds
  if (!inBounds(grid, c.tile)) {
    add({ tile: c.tile, issue: issue('ROOM_OUT_OF_BOUNDS', 'error', `Tile ${where} is outside room ${grid.roomId} (${grid.cols} × ${grid.rows}).`, ROOM_REF, c.rackId, 'game-scope') });
    return result(problems);
  }

  // R2 fixtures / door
  const b = blockerAt(grid, c.tile);
  if (b)
    add({
      tile: c.tile,
      ...(b.kind === 'fixture' ? { fixtureId: b.id } : {}),
      issue: issue('ROOM_TILE_BLOCKED', 'error', `Tile ${where} is taken by ${blockerText(b)}; a rack cannot stand there.`, ROOM_REF, c.rackId, 'game-scope'),
    });

  // R3 occupied
  const occupant = others.find((r) => sameTile(r.tile, c.tile));
  if (occupant)
    add({ tile: c.tile, otherRackId: occupant.rackId, issue: issue('ROOM_TILE_OCCUPIED', 'error', `Rack ${occupant.rackId} already stands on tile ${where}.`, ROOM_REF, c.rackId, 'game-scope') });

  // R4 / R5 own clearance (front = cold aisle, back = hot aisle)
  const cFront = frontTile(c);
  const cBack = backTile(c);
  for (const [t, side] of [[cFront, 'front (cold aisle / servicing)'], [cBack, 'back (hot aisle / cabling)']] as const) {
    if (!inBounds(grid, t)) {
      add({ tile: t, issue: issue('ROOM_RACK_NO_CLEARANCE', 'error', `Rack ${c.rackId} at ${where} needs a free tile at its ${side}, but ${tileKey(t)} is outside the room.`, ROOM_REF, c.rackId, 'game-scope') });
      continue;
    }
    const tb = blockerAt(grid, t);
    if (tb && tb.kind !== 'door-approach')
      add({
        tile: t,
        ...(tb.kind === 'fixture' ? { fixtureId: tb.id } : {}),
        issue: issue('ROOM_RACK_NO_CLEARANCE', 'error', `Rack ${c.rackId} at ${where} needs a free tile at its ${side}, but ${tileKey(t)} is taken by ${blockerText(tb)}.`, ROOM_REF, c.rackId, 'game-scope'),
      });
    const r = others.find((o) => sameTile(o.tile, t));
    if (r)
      add({ tile: t, otherRackId: r.rackId, issue: issue('ROOM_RACK_AISLE_BLOCKED', 'error', `Rack ${r.rackId} stands at the ${side} of ${c.rackId} (tile ${tileKey(t)}); that tile must stay free.`, ROOM_REF, c.rackId, 'game-scope') });
  }

  for (const o of others) {
    const oFront = frontTile(o);
    const oBack = backTile(o);
    // R6 candidate on another rack's aisle
    if (sameTile(oFront, c.tile) || sameTile(oBack, c.tile))
      add({
        tile: c.tile,
        otherRackId: o.rackId,
        issue: issue('ROOM_RACK_BLOCKS_AISLE', 'error', `Tile ${where} is the ${sameTile(oFront, c.tile) ? 'front (cold aisle)' : 'back (hot aisle)'} clearance of rack ${o.rackId}; a rack cannot stand there.`, ROOM_REF, c.rackId, 'game-scope'),
      });
    // R7 hot / cold mixing on a shared aisle tile
    if (sameTile(cFront, oBack) || sameTile(cBack, oFront)) {
      const t = sameTile(cFront, oBack) ? cFront : cBack;
      add({ tile: t, otherRackId: o.rackId, issue: issue('ROOM_RACK_AISLE_HOT_COLD_MIX', 'error', `Aisle tile ${tileKey(t)} would be the cold aisle of one rack and the hot aisle of the other (${c.rackId} / ${o.rackId}).`, ROOM_REF, c.rackId, 'game-scope') });
    }
    // R8 rows: side neighbours share the facing (checked from both racks' row axis)
    const sideNeighbour = sideTiles(c).some((t) => sameTile(t, o.tile)) || sideTiles(o).some((t) => sameTile(t, c.tile));
    if (sideNeighbour && o.facing !== c.facing)
      add({ tile: o.tile, otherRackId: o.rackId, issue: issue('ROOM_RACK_ROW_ORIENTATION_MISMATCH', 'error', `Rack ${c.rackId} faces ${c.facing} but its row neighbour ${o.rackId} faces ${o.facing}; racks in a row must face the same way.`, ROOM_REF, c.rackId, 'game-scope') });
  }
  return result(problems);
}

function result(problems: RackPlacementProblem[]): RackPlacementResult {
  return { ok: problems.length === 0, issues: problems.map((p) => p.issue), problems };
}

export interface RackTileSuggestion {
  readonly tile: Tile;
  /** Facings for which the tile is a valid placement (non-empty). */
  readonly facings: readonly Facing[];
}

/**
 * [GAME] valid tiles for the ghost preview: every tile of the grid where `rackId` may stand, with the facings that
 * pass `validateRackPlacement`. `facing` restricts the check to one facing. Empty when the room is full.
 */
export function suggestRackTiles(grid: RoomGrid, existing: readonly PlacedRack[], opts: { readonly rackId?: string; readonly facing?: Facing } = {}): RackTileSuggestion[] {
  const rackId = opts.rackId ?? '__candidate__';
  const facings = opts.facing ? [opts.facing] : FACINGS;
  const out: RackTileSuggestion[] = [];
  for (let gy = 0; gy < grid.rows; gy++)
    for (let gx = 0; gx < grid.cols; gx++) {
      const ok = facings.filter((facing) => validateRackPlacement(grid, existing, { rackId, tile: { gx, gy }, facing }).ok);
      if (ok.length) out.push({ tile: { gx, gy }, facings: ok });
    }
  return out;
}

export interface AisleTiles {
  /** Front clearance tiles (cold aisle). */
  readonly cold: readonly Tile[];
  /** Back clearance tiles (hot aisle). */
  readonly hot: readonly Tile[];
}

/** [GAME] aisle tiles of the standing racks (for drawing hot / cold aisles), de-duplicated, inside the room only. */
export function aisleTiles(grid: Pick<RoomGrid, 'cols' | 'rows'>, racks: readonly PlacedRack[]): AisleTiles {
  const uniq = (ts: Tile[]) => [...new Map(ts.filter((t) => inBounds(grid, t)).map((t) => [tileKey(t), t])).values()];
  return { cold: uniq(racks.map(frontTile)), hot: uniq(racks.map(backTile)) };
}
