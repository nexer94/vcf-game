/**
 * SandboxSession – stateful facade over the pure reducer.
 *
 * - `dispatch(command)` applies a command and returns the result (also emitted as events).
 * - `snapshot()` returns a deep-frozen, cached SandboxSnapshot for the UI. The same object is returned
 *   until something changes; idle ticks change nothing. While a task runs, only the light overlay
 *   (time, task views, binary progress) is rebuilt – the heavy, validation-based parts are reused.
 * - State is deep-frozen on every commit, so neither `state` nor a snapshot can be mutated from outside.
 * - `subscribe(listener)` – event stream (EventBus from the engine).
 * - Time: the session is a `GameSystem`; `attachTo(engine)` makes its timed tasks progress with the
 *   shared GameEngine clock (pause / 1x / 4x / 16x). Pausing the engine stops all tasks.
 */
import { type GameEngine, type GameSystem, type Listener, type Unsubscribe, EventBus, deepFreeze } from '../../engine';
import type { DesignDecisionId } from '../../model';
import { type SandboxOptions, advanceSandbox, initialSandboxState, reduceSandbox } from './reducer';
import { type SandboxSnapshot, type SandboxSnapshotBase, buildSnapshotBase, withProgress } from './snapshot';
import type { CommandResult, SandboxCommand, SandboxEvent, SandboxState } from './types';

export class SandboxSession implements GameSystem {
  private current: SandboxState;
  /** Live game time of the session (engine clock); `current.timeMs` is synced lazily before commands. */
  private clockMs: number;
  /** Structural revision (anything but pure task progress). */
  private revision = 0;
  private progressRevision = 0;
  private base: SandboxSnapshotBase | undefined;
  private cached: SandboxSnapshot | undefined;
  private readonly bus = new EventBus<SandboxEvent>();

  constructor(options: SandboxOptions = {}) {
    this.current = deepFreeze(initialSandboxState(options));
    this.clockMs = this.current.timeMs;
  }

  /** Raw deep-frozen state (for saves / debugging). Prefer `snapshot()` in the UI. */
  get state(): SandboxState {
    return this.current;
  }

  /** Current game time as seen by the session (advances even when the state does not change). */
  get timeMs(): number {
    return this.clockMs;
  }

  snapshot(): SandboxSnapshot {
    if (!this.cached) {
      this.base ??= buildSnapshotBase(this.current, this.revision);
      this.cached = withProgress(this.base, this.current, this.progressRevision);
    }
    return this.cached;
  }

  subscribe(listener: Listener<SandboxEvent>): Unsubscribe {
    return this.bus.subscribe(listener);
  }

  dispatch(command: SandboxCommand): CommandResult {
    const synced = this.current.timeMs === this.clockMs ? this.current : { ...this.current, timeMs: this.clockMs };
    const out = reduceSandbox(synced, command);
    if (out.state !== synced) this.commit(out.state, false);
    for (const e of out.events) this.bus.emit(e);
    return out.result;
  }

  /**
   * GameSystem: called by GameEngine.tick with the game-time delta (never while paused).
   * Idle ticks (no running task) only move the session clock – no new state, no revision, no events.
   */
  advance(gameDeltaMs: number, gameTimeMs?: number): void {
    this.clockMs = gameTimeMs ?? this.clockMs + Math.max(0, gameDeltaMs);
    if (this.current.tasks.length === 0) return;
    const out = advanceSandbox(this.current, gameDeltaMs, this.clockMs);
    if (out.state !== this.current) this.commit(out.state, out.progressOnly);
    for (const e of out.events) this.bus.emit(e);
  }

  /** Drive timed tasks from the shared engine clock. Returns a detach function. */
  attachTo(engine: Pick<GameEngine, 'attach'>): Unsubscribe {
    return engine.attach(this);
  }

  // --- convenience wrappers --------------------------------------------------
  selectDesignOption(decision: DesignDecisionId, option: string): CommandResult {
    return this.dispatch({ type: 'selectDesignOption', decision, option });
  }

  acknowledgeDesignWarnings(keys?: readonly string[]): CommandResult {
    return this.dispatch(keys ? { type: 'acknowledgeDesignWarnings', keys } : { type: 'acknowledgeDesignWarnings' });
  }

  advancePhase(): CommandResult {
    return this.dispatch({ type: 'advancePhase' });
  }

  goBack(): CommandResult {
    return this.dispatch({ type: 'goBack' });
  }

  private commit(next: SandboxState, progressOnly: boolean): void {
    if (next === this.current) return;
    this.current = deepFreeze(next);
    this.cached = undefined;
    if (progressOnly) {
      this.progressRevision += 1;
    } else {
      this.revision += 1;
      this.base = undefined;
    }
  }
}
