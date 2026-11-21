/**
 * Transaction helper shared by the Sandbox reducers (local mutable builder; reducers stay pure) and the
 * context the reducers / snapshot need besides the state (catalog, prices, objectives definitions).
 */
import { createTimedTask } from '../../engine';
import { type DeploymentEvent, type HardwareCatalog, type TransitionResult, type ValidationIssue, buildHardwareCatalog, transitionDeployment } from '../../model';
import { DEFAULT_PRICE_TABLE, type PriceTable } from '../economy';
import { type ObjectiveSet, defaultObjectiveSet } from './objectives';
import type {
  CommandResult,
  FlowReason,
  SandboxEvent,
  SandboxLogEntry,
  SandboxRejection,
  SandboxState,
  SandboxTask,
  SandboxTaskKind,
  SandboxTaskPayload,
} from './types';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** Non-state inputs of the reducers and the snapshot. Immutable; not part of saves. */
export interface SandboxContext {
  /** Hardware catalog built from the BCG dataset (model/hardwareCatalog). */
  readonly catalog: HardwareCatalog;
  /** Game prices (economy layer, fictional). */
  readonly prices: PriceTable;
  /** Objective definitions of the tracker (scenarios/objectives/sandbox.json). */
  readonly objectives: ObjectiveSet;
}

let catalogMemo: HardwareCatalog | undefined;
/** The repository catalog, built once (pure, deterministic). */
export function defaultCatalog(): HardwareCatalog {
  catalogMemo ??= buildHardwareCatalog();
  return catalogMemo;
}

export function sandboxContext(parts: Partial<SandboxContext> = {}): SandboxContext {
  return {
    catalog: parts.catalog ?? defaultCatalog(),
    prices: parts.prices ?? DEFAULT_PRICE_TABLE,
    objectives: parts.objectives ?? defaultObjectiveSet(),
  };
}

let ctxMemo: SandboxContext | undefined;
export function defaultSandboxContext(): SandboxContext {
  ctxMemo ??= sandboxContext();
  return ctxMemo;
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

export const LOG_LIMIT = 500;

export class Tx {
  readonly events: SandboxEvent[] = [];
  constructor(public s: SandboxState) {}

  log(entry: Omit<SandboxLogEntry, 'seq' | 'atMs'>): void {
    const seq = this.s.seq.log + 1;
    const log = [...this.s.log, { ...entry, seq, atMs: this.s.timeMs }];
    this.s = { ...this.s, log: log.length > LOG_LIMIT ? log.slice(log.length - LOG_LIMIT) : log, seq: { ...this.s.seq, log: seq } };
  }

  emit(e: SandboxEvent): void {
    this.events.push(e);
  }

  notify(level: 'info' | 'warning' | 'error', message: string): void {
    this.emit({ type: 'notification', atMs: this.s.timeMs, level, message });
  }

  /** Applies a deployment state machine event. */
  deployment(event: DeploymentEvent): TransitionResult<SandboxState['deployment']> {
    const from = this.s.deployment.status;
    const r = transitionDeployment(this.s.deployment, event);
    if (r.ok) {
      this.s = { ...this.s, deployment: r.state };
      this.emit({ type: 'sandbox/deploymentStatusChanged', atMs: this.s.timeMs, from, to: r.state.status, event: event.type });
    }
    return r;
  }

  startTask(kind: SandboxTaskKind, label: string, payload: SandboxTaskPayload): SandboxTask {
    const n = this.s.seq.task + 1;
    const task = createTimedTask({
      id: `task-${n}`,
      kind,
      label,
      durationMs: this.s.taskDurationsMs[kind],
      startedAtMs: this.s.timeMs,
      illustrativeDuration: true,
      payload,
    });
    this.s = { ...this.s, tasks: [...this.s.tasks, task], seq: { ...this.s.seq, task: n } };
    this.emit({ type: 'sandbox/taskStarted', atMs: this.s.timeMs, taskId: task.id, kind, label });
    return task;
  }

  /** Environment / spec changed after validation: the validation result is stale -> back to the draft. */
  invalidateValidation(): void {
    const st = this.s.deployment.status;
    if (st === 'ready-to-deploy' || st === 'awaiting-acknowledgement') {
      this.deployment({ type: 'edit' });
      this.log({ kind: 'system', ok: true, message: 'Prostředí nebo zadání se změnilo – výsledek validace už neplatí, průvodce je zpět v režimu úprav.' });
    }
  }
}

export const flow = (reason: FlowReason, message: string): SandboxRejection => ({ kind: 'flow', reason, message });
export const invalid = (issues: readonly ValidationIssue[]): SandboxRejection => ({ kind: 'validation', issues });
export const ok = (warnings: readonly ValidationIssue[] = []): CommandResult => ({ ok: true, warnings });
export const no = (rejection: SandboxRejection): CommandResult => ({ ok: false, rejection });
