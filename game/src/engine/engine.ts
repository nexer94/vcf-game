import { GameClock, type GameSpeed } from './clock';
import { EventBus, type GameEvent, type Listener, type Unsubscribe } from './events';
import type { GameSnapshot } from './snapshot';

/**
 * A simulation subsystem driven by the engine clock (e.g. a Sandbox session with timed tasks).
 * `advance` is called only when game time actually moved (never while paused).
 */
export interface GameSystem {
  advance(gameDeltaMs: number, gameTimeMs: number): void;
}

/**
 * Interface the render/UI layers depend on. Render only reads snapshots and
 * subscribes to events; it sends player intent via commands (e.g. setSpeed).
 */
export interface GameEngineView {
  snapshot(): GameSnapshot;
  subscribe(listener: Listener<GameEvent>): Unsubscribe;
  setSpeed(speed: GameSpeed): void;
  togglePause(): void;
}

export class GameEngine implements GameEngineView {
  private readonly clock: GameClock;
  private readonly bus = new EventBus<GameEvent>();
  private readonly systems = new Set<GameSystem>();
  private tickCount = 0;

  constructor(initialSpeed: GameSpeed = 0) {
    this.clock = new GameClock(initialSpeed);
  }

  /** Advance the simulation by a real-time delta (ms). */
  tick(realDeltaMs: number): void {
    const gameDelta = this.clock.advance(realDeltaMs);
    this.tickCount += 1;
    if (gameDelta > 0) for (const s of [...this.systems]) s.advance(gameDelta, this.clock.timeMs);
  }

  /** Attach a subsystem that progresses with game time; pausing the clock stops it. */
  attach(system: GameSystem): Unsubscribe {
    this.systems.add(system);
    return () => {
      this.systems.delete(system);
    };
  }

  snapshot(): GameSnapshot {
    return Object.freeze({ tick: this.tickCount, clock: Object.freeze(this.clock.state()) });
  }

  subscribe(listener: Listener<GameEvent>): Unsubscribe {
    return this.bus.subscribe(listener);
  }

  setSpeed(speed: GameSpeed): void {
    if (speed === this.clock.speed) return;
    this.clock.setSpeed(speed);
    this.emitSpeed();
  }

  togglePause(): void {
    this.clock.togglePause();
    this.emitSpeed();
  }

  private emitSpeed(): void {
    this.bus.emit({ type: 'speedChanged', atMs: this.clock.timeMs, speed: this.clock.speed });
  }
}
