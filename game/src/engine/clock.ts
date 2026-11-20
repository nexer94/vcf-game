/**
 * Game clock: converts real (wall-clock) time into simulated game time.
 * Speeds follow docs/design/GRAPHICS.md: pause / 1x / 4x / 16x.
 * Pure logic - no DOM, no timers. The host (render loop, tests) calls `advance`.
 */

export const GAME_SPEEDS = [0, 1, 4, 16] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];

export function isGameSpeed(value: number): value is GameSpeed {
  return (GAME_SPEEDS as readonly number[]).includes(value);
}

export interface ClockState {
  /** Simulated time since scenario start, in milliseconds. */
  readonly gameTimeMs: number;
  /** Current speed multiplier; 0 = paused. */
  readonly speed: GameSpeed;
}

export class GameClock {
  private gameTimeMs = 0;
  private currentSpeed: GameSpeed;
  /** Speed to restore when resuming from pause. */
  private lastRunningSpeed: Exclude<GameSpeed, 0> = 1;

  constructor(initialSpeed: GameSpeed = 0) {
    this.currentSpeed = initialSpeed;
    if (initialSpeed !== 0) this.lastRunningSpeed = initialSpeed;
  }

  get speed(): GameSpeed {
    return this.currentSpeed;
  }

  get paused(): boolean {
    return this.currentSpeed === 0;
  }

  get timeMs(): number {
    return this.gameTimeMs;
  }

  setSpeed(speed: GameSpeed): void {
    if (!isGameSpeed(speed)) {
      throw new RangeError(`Invalid game speed: ${String(speed)}`);
    }
    this.currentSpeed = speed;
    if (speed !== 0) this.lastRunningSpeed = speed;
  }

  pause(): void {
    this.setSpeed(0);
  }

  resume(): void {
    this.setSpeed(this.lastRunningSpeed);
  }

  togglePause(): void {
    if (this.paused) this.resume();
    else this.pause();
  }

  /**
   * Advance by a real-time delta. Returns the game-time delta that elapsed
   * (0 when paused). Negative or non-finite deltas are rejected.
   */
  advance(realDeltaMs: number): number {
    if (!Number.isFinite(realDeltaMs) || realDeltaMs < 0) {
      throw new RangeError(`Invalid real delta: ${String(realDeltaMs)}`);
    }
    const gameDelta = realDeltaMs * this.currentSpeed;
    this.gameTimeMs += gameDelta;
    return gameDelta;
  }

  state(): ClockState {
    return { gameTimeMs: this.gameTimeMs, speed: this.currentSpeed };
  }
}
