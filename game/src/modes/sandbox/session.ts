/**
 * SandboxSession – stateful facade over the pure reducer.
 *
 * - `dispatch(command)` applies a command and returns the result (also emitted as events).
 * - `snapshot()` returns an immutable, cached SandboxSnapshot for the UI.
 * - `subscribe(listener)` – event stream (EventBus from the engine).
 * - Time: the session is a `GameSystem`; `attachTo(engine)` makes its timed tasks progress with the
 *   shared GameEngine clock (pause / 1x / 4x / 16x). Pausing the engine stops all tasks.
 */
import { type GameEngine, type GameSystem, type Listener, type Unsubscribe, EventBus } from '../../engine';
import type { DesignDecisionId } from '../../model';
import { type SandboxOptions, advanceSandbox, initialSandboxState, reduceSandbox } from './reducer';
import { type SandboxSnapshot, buildSandboxSnapshot } from './snapshot';
import type { CommandResult, SandboxCommand, SandboxEvent, SandboxState } from './types';

export class SandboxSession implements GameSystem {
  private current: SandboxState;
  private revision = 0;
  private cached: SandboxSnapshot | undefined;
  private readonly bus = new EventBus<SandboxEvent>();

  constructor(options: SandboxOptions = {}) {
    this.current = initialSandboxState(options);
  }

  /** Raw immutable state (for saves / debugging). Prefer `snapshot()` in the UI. */
  get state(): SandboxState {
    return this.current;
  }

  snapshot(): SandboxSnapshot {
    if (!this.cached) this.cached = buildSandboxSnapshot(this.current, this.revision);
    return this.cached;
  }

  subscribe(listener: Listener<SandboxEvent>): Unsubscribe {
    return this.bus.subscribe(listener);
  }

  dispatch(command: SandboxCommand): CommandResult {
    const out = reduceSandbox(this.current, command);
    this.commit(out.state);
    for (const e of out.events) this.bus.emit(e);
    return out.result;
  }

  /** GameSystem: called by GameEngine.tick with the game-time delta (never while paused). */
  advance(gameDeltaMs: number, gameTimeMs?: number): void {
    const out = advanceSandbox(this.current, gameDeltaMs, gameTimeMs);
    this.commit(out.state);
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

  private commit(next: SandboxState): void {
    if (next === this.current) return;
    this.current = next;
    this.revision += 1;
    this.cached = undefined;
  }
}
