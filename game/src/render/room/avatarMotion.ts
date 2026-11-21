/**
 * Tile-by-tile walking of the avatar (pure, no PixiJS, unit-tested).
 * Position is continuous in grid units (tile centre = gx + 0.5).
 */
import type { Tile } from './roomGrid';

export type Facing = 'front-right' | 'front-left' | 'back-right' | 'back-left';

/** Walking speed in tiles per real second. */
export const WALK_TILES_PER_S = 3.2;

export class AvatarMotion {
  /** Continuous grid position of the feet (tile centre = integer + 0.5). */
  x: number;
  y: number;
  facing: Facing = 'front-right';
  /** Walking time accumulator (ms), drives the step animation. */
  walkMs = 0;
  private path: Tile[] = [];

  constructor(start: Tile) {
    this.x = start.gx + 0.5;
    this.y = start.gy + 0.5;
  }

  /** Tile the avatar currently stands on (or is leaving). */
  get tile(): Tile {
    return { gx: Math.floor(this.x), gy: Math.floor(this.y) };
  }

  get walking(): boolean {
    return this.path.length > 0;
  }

  /** Final tile of the current walk, or null when idle. */
  get destination(): Tile | null {
    return this.path[this.path.length - 1] ?? null;
  }

  /** Replace the current path (tiles to visit, start excluded). */
  setPath(path: readonly Tile[]): void {
    this.path = [...path];
  }

  stop(): void {
    this.path = [];
  }

  /** Advance by real time; returns true when the walk finished in this step. */
  step(realMs: number, tilesPerS = WALK_TILES_PER_S): boolean {
    if (this.path.length === 0) {
      this.walkMs = 0;
      return false;
    }
    this.walkMs += realMs;
    let budget = (tilesPerS * realMs) / 1000;
    while (budget > 0 && this.path.length > 0) {
      const next = this.path[0]!;
      const tx = next.gx + 0.5;
      const ty = next.gy + 0.5;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist > 1e-9) this.facing = facingFor(dx, dy);
      if (dist <= budget) {
        this.x = tx;
        this.y = ty;
        budget -= dist;
        this.path.shift();
      } else {
        this.x += (dx / dist) * budget;
        this.y += (dy / dist) * budget;
        budget = 0;
      }
    }
    return this.path.length === 0;
  }
}

/**
 * Grid direction -> on-screen facing. +gx goes down-right, +gy down-left,
 * -gx up-left, -gy up-right.
 */
export function facingFor(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'front-right' : 'back-left';
  return dy > 0 ? 'front-left' : 'back-right';
}
