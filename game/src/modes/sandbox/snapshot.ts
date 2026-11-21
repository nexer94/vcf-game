/**
 * Read-only snapshot of a Sandbox session for the UI. Everything needed to render the three phases;
 * the UI never calls model validations itself.
 */
import { deepFreeze, taskProgress, taskRemainingMs } from '../../engine';
import {
  type BringupSpec,
  type DeploymentEvent,
  type DeploymentState,
  type DesignBringupParams,
  type DesignChoices,
  type DesignDecisionId,
  type DesignSummary,
  type Fleet,
  type ValidationIssue,
  type WorkflowType,
  DEPLOYMENT_TRANSITIONS,
  summarizeDesign,
  validateBringupSpec,
  warningsOf,
  workflowTypeOf,
} from '../../model';
import { type DesignDecisionView, type DesignStepDataShape, type IssueGroups, EMPTY_ISSUE_GROUPS, decisionViews, designGate, designStepDataOf, groupIssues } from './design';
import { ILLUSTRATIVE_DURATION_NOTE } from './durations';
import { type PlanningView, planningView, withBinaryProgress } from './planning';
import { bringupEnvOf, phaseGate } from './reducer';
import { type SandboxLogEntry, type SandboxPhase, type SandboxState, type SandboxTask, type SandboxTaskKind, SANDBOX_PHASES } from './types';
import { type DesignLockedField, type WizardStepReport, DESIGN_LOCKED_FIELDS, WIZARD_SECTION_STEP, issueKey, wizardStepReports } from './wizard';

export interface PhaseView {
  readonly id: SandboxPhase;
  readonly current: boolean;
  /** Reached at least once. */
  readonly visited: boolean;
  /** Gate from the previous phase passes now (model validation). */
  readonly enterable: boolean;
  readonly blockers: IssueGroups;
}

export interface TaskView {
  readonly id: string;
  readonly kind: SandboxTaskKind;
  readonly label: string;
  readonly progress: number;
  readonly elapsedMs: number;
  readonly remainingMs: number;
  readonly durationMs: number;
  /** Always true in the Sandbox: durations are not documented. UI label "ilustrativní". */
  readonly illustrativeDuration: boolean;
}

export interface DesignWarningView {
  readonly key: string;
  readonly issue: ValidationIssue;
  readonly acknowledged: boolean;
}

export interface DesignPhaseView {
  readonly choices: DesignChoices;
  /** Applicable decisions in 05 §4.10 order with option availability, reasons and sources. */
  readonly decisions: readonly DesignDecisionView[];
  /** Same data mapped to the UI's DesignStepData shape. */
  readonly stepData: DesignStepDataShape;
  readonly issues: IssueGroups;
  readonly warnings: readonly DesignWarningView[];
  /** Acknowledged warning keys (`code|subject`, same as ui IssueView.key). */
  readonly acknowledgedWarningKeys: readonly string[];
  readonly gate: { readonly ok: boolean; readonly errors: readonly ValidationIssue[]; readonly unacknowledgedWarnings: readonly ValidationIssue[] };
  readonly derived?: DesignBringupParams;
  readonly summary: DesignSummary;
  /** Choices at bring-up; principal storage is then immutable (validateRedesign). */
  readonly deployedChoices?: DesignChoices;
  /** Decisions changed since the bring-up (the deployed fleet does not follow them). */
  readonly divergedFromDeployment: readonly DesignDecisionId[];
}

export interface DeployPhaseView {
  readonly spec: BringupSpec;
  readonly workflowType: WorkflowType;
  /** Fields set by the design (read-only in the wizard). */
  readonly lockedFields: readonly DesignLockedField[];
  readonly sectionStep: typeof WIZARD_SECTION_STEP;
  /** Live per-page pre-check (preview). */
  readonly steps: readonly WizardStepReport[];
  readonly liveIssues: IssueGroups;
  readonly deployment: DeploymentState;
  /** Deployment state machine events allowed now (DEPLOYMENT_TRANSITIONS). */
  readonly allowedEvents: readonly DeploymentEvent['type'][];
  /** Result of the last "Review validation" run. */
  readonly validationResult: IssueGroups;
  readonly validationTask?: TaskView;
  readonly deploymentTask?: TaskView;
}

export interface SandboxSnapshot {
  /** Structural revision: bumps on every state change except pure task progress. */
  readonly revision: number;
  /** Bumps when only running task progress changed (heavy parts like `design` keep their identity). */
  readonly progressRevision: number;
  /** Game time of the last state change (the live clock is GameEngine.snapshot().clock). */
  readonly timeMs: number;
  readonly phase: SandboxPhase;
  readonly phases: readonly PhaseView[];
  readonly design: DesignPhaseView;
  readonly planning: PlanningView;
  readonly deploy: DeployPhaseView;
  readonly fleet?: Fleet;
  readonly tasks: readonly TaskView[];
  readonly log: readonly SandboxLogEntry[];
  readonly illustrative: { readonly taskDurationsMs: Readonly<Record<SandboxTaskKind, number>>; readonly note: string };
}

export function taskView(t: SandboxTask): TaskView {
  return {
    id: t.id,
    kind: t.kind,
    label: t.label,
    progress: taskProgress(t),
    elapsedMs: t.elapsedMs,
    remainingMs: taskRemainingMs(t),
    durationMs: t.durationMs,
    illustrativeDuration: t.illustrativeDuration,
  };
}

/** Snapshot parts that do not depend on task progress (expensive: runs model validations). */
export type SandboxSnapshotBase = Omit<SandboxSnapshot, 'progressRevision' | 'timeMs' | 'tasks'>;

/**
 * Full snapshot (deep-frozen). Equivalent to `withProgress(buildSnapshotBase(s, revision), s, progressRevision)`.
 */
export function buildSandboxSnapshot(s: SandboxState, revision: number, progressRevision = 0): SandboxSnapshot {
  return withProgress(buildSnapshotBase(s, revision), s, progressRevision);
}

/**
 * Cheap overlay of the light, per-tick data (time, task views, binary progress) onto a cached base.
 * Returns a deep-frozen snapshot; base parts unaffected by running tasks keep their identity.
 */
export function withProgress(base: SandboxSnapshotBase, s: SandboxState, progressRevision: number): SandboxSnapshot {
  const tasks = s.tasks.map(taskView);
  const vTask = tasks.find((t) => t.kind === 'bringup-validation');
  const dTask = tasks.find((t) => t.kind === 'bringup-deployment');
  const deploy: DeployPhaseView = vTask || dTask ? { ...base.deploy, ...(vTask ? { validationTask: vTask } : {}), ...(dTask ? { deploymentTask: dTask } : {}) } : base.deploy;
  return deepFreeze({
    ...base,
    progressRevision,
    timeMs: s.timeMs,
    planning: withBinaryProgress(base.planning, s.tasks),
    deploy,
    tasks,
  });
}

/** Builds the progress-independent snapshot base (deep-frozen). */
export function buildSnapshotBase(s: SandboxState, revision: number): SandboxSnapshotBase {
  const gate = designGate(s.choices, s.acknowledgedDesignWarnings, s.designContext);
  const ack = new Set(s.acknowledgedDesignWarnings);
  const decisions = decisionViews(s.choices, gate.issues, s.designContext, s.deployedChoices);
  const env = bringupEnvOf(s);
  const live = validateBringupSpec(s.spec, env);
  const deployedHosts = s.deployment.status === 'completed' || s.deployment.status === 'deploying' ? new Set(s.spec.esxHosts.map((h) => h.fqdn)) : new Set<string>();
  const dc = s.deployedChoices;
  const diverged = dc ? [...new Set([...Object.keys(dc), ...Object.keys(s.choices)])].filter((k) => dc[k as DesignDecisionId] !== s.choices[k as DesignDecisionId]) : [];

  const furthest = SANDBOX_PHASES.indexOf(s.furthestPhase);
  const phases = SANDBOX_PHASES.map((id, i): PhaseView => {
    const g = phaseGate(s, id);
    return {
      id,
      current: s.phase === id,
      visited: i <= furthest,
      enterable: g.ok,
      blockers: { ...EMPTY_ISSUE_GROUPS, errors: g.errors, warnings: g.unacknowledgedWarnings },
    };
  });

  return deepFreeze({
    revision,
    phase: s.phase,
    phases,
    design: {
      choices: s.choices,
      decisions,
      stepData: designStepDataOf(decisions),
      issues: groupIssues(gate.issues),
      warnings: warningsOf(gate.issues).map((issue) => ({ key: issueKey(issue), issue, acknowledged: ack.has(issueKey(issue)) })),
      acknowledgedWarningKeys: s.acknowledgedDesignWarnings,
      gate: { ok: gate.ok, errors: gate.errors, unacknowledgedWarnings: gate.unacknowledgedWarnings },
      ...(s.derived ? { derived: s.derived } : {}),
      summary: summarizeDesign(s.choices),
      ...(dc ? { deployedChoices: dc } : {}),
      divergedFromDeployment: diverged as DesignDecisionId[],
    },
    planning: planningView(s.env, env, s.derived, [], deployedHosts),
    deploy: {
      spec: s.spec,
      workflowType: workflowTypeOf(s.spec),
      lockedFields: DESIGN_LOCKED_FIELDS,
      sectionStep: WIZARD_SECTION_STEP,
      steps: wizardStepReports(s.spec, env),
      liveIssues: groupIssues(live),
      deployment: s.deployment,
      allowedEvents: DEPLOYMENT_TRANSITIONS[s.deployment.status],
      validationResult: groupIssues(s.deployment.issues),
    },
    ...(s.fleet ? { fleet: s.fleet } : {}),
    log: s.log,
    illustrative: { taskDurationsMs: s.taskDurationsMs, note: ILLUSTRATIVE_DURATION_NOTE },
  });
}
