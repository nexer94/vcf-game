/**
 * SandboxSession – stateful facade over the pure reducer.
 *
 * - `dispatch(command)` applies a command and returns the result (also emitted as events).
 * - `snapshot()` returns a deep-frozen, cached SandboxSnapshot for the UI. The same object is returned
 *   until something changes; idle ticks change nothing. While a task runs, only the light overlay
 *   (time, task views, binary progress) is rebuilt – the heavy, validation-based parts are reused.
 * - State is deep-frozen on every commit, so neither `state` nor a snapshot can be mutated from outside.
 * - `subscribe(listener)` – event stream (EventBus from the engine).
 * - Objectives (UX §8): after every structural change the tracker is evaluated; objectives satisfied for the first
 *   time are remembered in `state.objectives.everDone` (so a later loss shows as 'regressed') and announced with
 *   `sandbox/objectiveCompleted`; a doc-required objective that stops being satisfied emits `sandbox/objectiveRegressed`.
 * - Provoz v3 (UX 28.17): `snapshot().trafficRevision` bumps only when the traffic picture changes (E-T2); after
 *   every change of the room the session emits `sandbox/linkUp` / `sandbox/linkDown` for cables whose link state
 *   changed (E-T5).
 * - Time: the session is a `GameSystem`; `attachTo(engine)` makes its timed tasks progress with the
 *   shared GameEngine clock (pause / 1x / 4x / 16x). Pausing the engine stops all tasks.
 */
import { type GameEngine, type GameSystem, type Listener, type Unsubscribe, EventBus, deepFreeze } from '../../engine';
import { type DesignDecisionId, type Facing, type PhysicalState, type RackTileSuggestion, linkStatus } from '../../model';
import { deviceOfPort, trafficSignature, upLinkIds } from './trafficV3';
import { rackPlacementHints } from './rackLayout';
import { type SandboxOptions, advanceSandbox, initialSandboxState, reduceSandbox } from './reducer';
import { type SandboxSnapshot, type SandboxSnapshotBase, buildSnapshotBase, withProgress } from './snapshot';
import { type SandboxContext, sandboxContext } from './tx';
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
  readonly context: SandboxContext;
  private regressed = new Set<string>();
  private trafficRevision = 0;
  private trafficSig: string | undefined;
  private upLinks: Set<string>;
  private linksOf: PhysicalState;

  constructor(options: SandboxOptions = {}) {
    this.context = sandboxContext(options.context, options.objectives ?? false);
    this.current = deepFreeze(initialSandboxState(options));
    this.clockMs = this.current.timeMs;
    this.linksOf = this.current.room.physical;
    this.upLinks = upLinkIds(this.linksOf, this.context.catalog);
    this.trackObjectives();
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
      if (!this.base) {
        this.base = buildSnapshotBase(this.current, this.revision, this.context);
        const sig = trafficSignature(this.base.flows.flows, this.base.flows.linkVolumes);
        if (this.trafficSig !== undefined && sig !== this.trafficSig) this.trafficRevision += 1;
        this.trafficSig = sig;
      }
      this.cached = withProgress(this.base, this.current, this.progressRevision, this.trafficRevision);
    }
    return this.cached;
  }

  subscribe(listener: Listener<SandboxEvent>): Unsubscribe {
    return this.bus.subscribe(listener);
  }

  dispatch(command: SandboxCommand): CommandResult {
    const synced = this.current.timeMs === this.clockMs ? this.current : { ...this.current, timeMs: this.clockMs };
    const out = reduceSandbox(synced, command, this.context);
    if (out.state !== synced) this.commit(out.state, false);
    for (const e of out.events) this.bus.emit(e);
    this.trackLinks();
    this.trackObjectives();
    return out.result;
  }

  /**
   * GameSystem: called by GameEngine.tick with the game-time delta (never while paused).
   * Idle ticks (no running task) only move the session clock – no new state, no revision, no events.
   */
  advance(gameDeltaMs: number, gameTimeMs?: number): void {
    this.clockMs = gameTimeMs ?? this.clockMs + Math.max(0, gameDeltaMs);
    if (this.current.tasks.length === 0) return;
    const out = advanceSandbox(this.current, gameDeltaMs, this.clockMs, this.context);
    if (out.state !== this.current) this.commit(out.state, out.progressOnly);
    for (const e of out.events) this.bus.emit(e);
    if (!out.progressOnly) {
      this.trackLinks();
      this.trackObjectives();
    }
  }

  /** Drive timed tasks from the shared engine clock. Returns a detach function. */
  attachTo(engine: Pick<GameEngine, 'attach'>): Unsubscribe {
    return engine.attach(this);
  }

  /**
   * [GAME] ghost hints for placing / moving one rack in `roomId` (model suggestRackTiles): `rackId` = a placed rack
   * being moved (its own tile counts as free), `facing` restricts the hints to one facing. New racks: use
   * `snapshot().site.layout.rooms[].placement.placement`. Undefined for an unknown room.
   */
  rackPlacementHints(roomId: string, opts: { readonly rackId?: string; readonly facing?: Facing } = {}): RackTileSuggestion[] | undefined {
    return rackPlacementHints(this.current.room, roomId, opts);
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

  /**
   * Records newly satisfied objectives in `state.objectives.everDone` (no revision bump: the snapshot does not
   * change – a satisfied objective is shown 'done' either way) and emits completion / regression events.
   */
  private trackObjectives(): void {
    if (this.context.objectives.objectives.length === 0) return;
    const view = this.snapshot().objectives;
    const prefs = this.current.objectives;
    const known = new Set(prefs.everDone);
    const fresh = view.doneIds.filter((id) => !known.has(id));
    const at = this.clockMs;
    if (fresh.length) {
      this.current = deepFreeze({ ...this.current, objectives: { ...prefs, everDone: [...prefs.everDone, ...fresh] } });
      for (const id of fresh) {
        const g = view.groups.find((x) => x.objectives.some((o) => o.id === id));
        const groupCompleted = g && g.total > 0 && g.done === g.total && g.objectives.some((o) => o.id === id && o.counted) ? g.id : undefined;
        this.bus.emit({ type: 'sandbox/objectiveCompleted', atMs: at, id, ...(groupCompleted ? { groupCompleted } : {}) });
      }
    }
    const nowRegressed = new Set(view.regressedIds);
    for (const id of nowRegressed) if (!this.regressed.has(id)) this.bus.emit({ type: 'sandbox/objectiveRegressed', atMs: at, id });
    this.regressed = nowRegressed;
  }

  /** E-T5: link up / down events for cables whose link state changed since the last check. */
  private trackLinks(): void {
    const phys = this.current.room.physical;
    if (phys === this.linksOf) return;
    const now = upLinkIds(phys, this.context.catalog);
    const at = this.clockMs;
    const cables = new Map(phys.cables.map((c) => [c.id, c]));
    for (const id of this.upLinks) {
      if (now.has(id)) continue;
      const c = cables.get(id);
      this.bus.emit({ type: 'sandbox/linkDown', atMs: at, cableId: id, ...(c ? { a: c.a, b: c.b } : {}) });
    }
    for (const id of now) {
      if (this.upLinks.has(id)) continue;
      const c = cables.get(id);
      if (!c) continue;
      const speed = linkStatus(phys, this.context.catalog, c).speedGbE;
      this.bus.emit({ type: 'sandbox/linkUp', atMs: at, cableId: id, a: c.a, b: c.b, aDeviceId: deviceOfPort(c.a), bDeviceId: deviceOfPort(c.b), ...(speed !== undefined ? { speedGbE: speed } : {}) });
    }
    this.upLinks = now;
    this.linksOf = phys;
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
