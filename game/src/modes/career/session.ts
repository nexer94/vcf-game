/**
 * CareerSession – a Career level on top of a SandboxSession (UX 25.6): same model, engine and reducer; this layer adds
 * only game mechanics (CLAUDE.md "Ekonomika ani skóre nesmí měnit pravidla VCF v modelu"):
 *  - finite budget in game currency: a command whose (dry-run) cost exceeds the remaining budget is rejected with
 *    flow 'over-budget' – the dry run uses the pure Sandbox reducer, so the price is exactly what the Sandbox would charge;
 *  - design decisions fixed by the level (blueprint) cannot be changed (flow 'locked-by-level'); the blueprint itself is fixed;
 *  - objectives = the level's set (checklist + bubbles); points per first completion, hint / solution / failed
 *    validation penalties; stars and success criteria (evaluate.ts).
 *
 * Pure TypeScript: no DOM, no PixiJS.
 */
import { type GameEngine, type Listener, type Unsubscribe, EventBus, deepFreeze } from '../../engine';
import { type CommandResult, type ObjectiveSet, type SandboxCommand, type SandboxEvent, type SandboxSnapshot, SandboxSession, loadObjectiveSet, reduceSandbox } from '../sandbox';
import { type CareerProgress, type CareerScore, type LevelEvaluation, computeScore, evaluateLevel } from './evaluate';
import type { CareerLevelDef } from './level';
import { replayCommands } from './replay';

export interface CareerView {
  readonly levelId: string;
  readonly title: string;
  readonly budget: { readonly total: number; readonly spent: number; readonly remaining: number; readonly gameCurrency: true };
  readonly lockedDecisions: readonly string[];
  readonly score: CareerScore;
  readonly evaluation: LevelEvaluation;
  /** Level passed (all criteria) – stays true once reached. */
  readonly completed: boolean;
}

export interface CareerSnapshot {
  readonly sandbox: SandboxSnapshot;
  readonly career: CareerView;
}

export type CareerEvent =
  | SandboxEvent
  | { readonly type: 'career/pointsAwarded'; readonly atMs: number; readonly objectiveId: string; readonly points: number }
  | { readonly type: 'career/levelCompleted'; readonly atMs: number; readonly levelId: string; readonly stars: number; readonly points: number };

export type HintKind = 'show' | 'solution';

const COST_COMMANDS: ReadonlySet<SandboxCommand['type']> = new Set(['buyItem', 'placeRack', 'addTor', 'addNic', 'configureServer']);

export class CareerSession {
  readonly sandbox: SandboxSession;
  readonly objectiveSet: ObjectiveSet;
  private readonly bus = new EventBus<CareerEvent>();
  private progress: CareerProgress;
  private readonly spentAtStart: number;
  private completed = false;
  private cache: { sandbox: SandboxSnapshot; rev: number; snap: CareerSnapshot } | undefined;
  private rev = 0;

  constructor(readonly level: CareerLevelDef) {
    this.objectiveSet = loadObjectiveSet(level.objectives);
    if (this.objectiveSet.loadErrors.length) throw new Error(`career level ${level.id}: objectives invalid: ${this.objectiveSet.loadErrors.join('; ')}`);
    this.sandbox = new SandboxSession({ autoBmc: level.session.autoBmc, preinstalledTor: level.session.preinstalledTor, objectives: this.objectiveSet });
    replayCommands(this.sandbox, level.initialCommands);
    this.spentAtStart = this.sandbox.state.room.economy.spent;
    this.progress = { completed: [], preCompleted: [...this.sandbox.snapshot().objectives.doneIds], hints: {}, failedValidations: 0 };
    this.sandbox.subscribe((e) => this.onSandboxEvent(e));
  }

  get spent(): number {
    return this.sandbox.state.room.economy.spent - this.spentAtStart;
  }

  get remainingBudget(): number {
    return this.level.budget - this.spent;
  }

  subscribe(listener: Listener<CareerEvent>): Unsubscribe {
    return this.bus.subscribe(listener);
  }

  attachTo(engine: Pick<GameEngine, 'attach'>): Unsubscribe {
    return this.sandbox.attachTo(engine);
  }

  dispatch(cmd: SandboxCommand): CommandResult {
    const locked = this.lockReason(cmd);
    if (locked) return { ok: false, rejection: { kind: 'flow', reason: 'locked-by-level', message: locked } };
    if (COST_COMMANDS.has(cmd.type)) {
      // dry run through the pure reducer: exact game price of the command
      const trial = reduceSandbox(this.sandbox.state, cmd, this.sandbox.context);
      const cost = trial.state.room.economy.spent - this.sandbox.state.room.economy.spent;
      if (trial.result.ok && cost > 0 && cost > this.remainingBudget)
        return { ok: false, rejection: { kind: 'flow', reason: 'over-budget', message: `Nákup za ¤ ${cost} (herní měna) se nevejde do rozpočtu – zbývá ¤ ${this.remainingBudget}.` } };
    }
    return this.sandbox.dispatch(cmd);
  }

  /** Player used a hint ("Ukaž" = show, "otevřít řešení" = solution) on an objective – game penalty (UX 25.3). */
  useHint(objectiveId: string, kind: HintKind): void {
    if (!this.objectiveSet.byId.has(objectiveId)) throw new Error(`unknown objective ${objectiveId}`);
    const cur = this.progress.hints[objectiveId] ?? { show: 0, solution: 0 };
    this.progress = { ...this.progress, hints: { ...this.progress.hints, [objectiveId]: { ...cur, [kind]: cur[kind] + 1 } } };
    this.bump();
  }

  snapshot(): CareerSnapshot {
    const sandbox = this.sandbox.snapshot();
    if (this.cache && this.cache.sandbox === sandbox && this.cache.rev === this.rev) return this.cache.snap;
    const evaluation = evaluateLevel(sandbox, this.level);
    const score = computeScore(this.level, this.objectiveSet, this.progress, evaluation.passed);
    const snap = deepFreeze({
      sandbox,
      career: {
        levelId: this.level.id,
        title: this.level.title,
        budget: { total: this.level.budget, spent: this.spent, remaining: this.remainingBudget, gameCurrency: true as const },
        lockedDecisions: this.level.lockedDecisions,
        score,
        evaluation,
        completed: this.completed || evaluation.passed,
      },
    });
    this.cache = { sandbox, rev: this.rev, snap };
    return snap;
  }

  /** Career progress (for saves / tests). */
  get careerProgress(): CareerProgress {
    return this.progress;
  }

  private lockReason(cmd: SandboxCommand): string | undefined {
    if (cmd.type === 'chooseBlueprint') return 'Level má pevně daný design blueprint.';
    if ((cmd.type === 'selectDesignOption' || cmd.type === 'clearDesignOption') && this.level.lockedDecisions.includes(cmd.decision))
      return `Volba ${cmd.decision} je daná blueprintem levelu (podle blueprintu).`;
    return undefined;
  }

  private bump(): void {
    this.rev += 1;
  }

  private onSandboxEvent(e: SandboxEvent): void {
    this.bus.emit(e);
    if (e.type === 'sandbox/objectiveCompleted' && !this.progress.completed.includes(e.id) && !this.progress.preCompleted.includes(e.id)) {
      this.progress = { ...this.progress, completed: [...this.progress.completed, e.id] };
      this.bump();
      const pts = this.objectiveSet.byId.get(e.id)?.points;
      if (pts !== undefined) this.bus.emit({ type: 'career/pointsAwarded', atMs: e.atMs, objectiveId: e.id, points: pts });
    }
    if (e.type === 'sandbox/deploymentStatusChanged' && e.to === 'validation-failed') {
      this.progress = { ...this.progress, failedValidations: this.progress.failedValidations + 1 };
      this.bump();
    }
    if (!this.completed && (e.type === 'sandbox/fleetCreated' || e.type === 'sandbox/stateChanged')) {
      const s = this.snapshot();
      if (s.career.evaluation.passed) {
        this.completed = true;
        this.bump();
        const after = this.snapshot().career.score;
        this.bus.emit({ type: 'career/levelCompleted', atMs: e.atMs, levelId: this.level.id, stars: after.stars, points: after.points });
      }
    }
  }
}
