/**
 * Career scoring and level evaluation – pure functions over the Sandbox snapshot (UX 25.3, 25.4).
 * Points, penalties, stars and budgets are GAME MECHANICS; the success criteria read only model results exposed by
 * the snapshot (deployment state, wizard spec, cluster hardware findings) – no VCF rule is decided here.
 */
import type { ObjectiveSet, SandboxSnapshot } from '../sandbox';
import type { CareerLevelDef } from './level';

/** Model codes of the initial management cluster homogeneity rules (same as the serversHomogeneous selector). */
const HOMOGENEITY_CODES: readonly string[] = ['ESX_MULTIPLE_VENDORS', 'HW_CLUSTER_HETEROGENEOUS'];

export interface CriterionResult {
  readonly id: 'deployment-completed' | 'hosts' | 'storage' | 'deployment-model' | 'size' | 'homogeneous' | 'validation-passed';
  readonly ok: boolean;
  /** Czech label (VCF terms in English). */
  readonly label: string;
  readonly specRef: string;
}

export interface LevelEvaluation {
  readonly passed: boolean;
  readonly criteria: readonly CriterionResult[];
}

/** Success criteria of UX 25.4 (all must hold). */
export function evaluateLevel(snap: SandboxSnapshot, level: CareerLevelDef): LevelEvaluation {
  const sc = level.success;
  const spec = snap.deploy.spec;
  const status = snap.deploy.deployment.status;
  const hosts = spec.esxHosts.filter((h) => h.fqdn.trim() !== '').length;
  const homogeneous = snap.physical.servers.length > 0 && !snap.physical.clusterIssues.findings.some((f) => HOMOGENEITY_CODES.includes(f.code));
  const criteria: CriterionResult[] = [
    { id: 'deployment-completed', ok: snap.fleet !== undefined && status === 'completed', label: 'Bring-up nové VCF fleet je dokončený', specRef: '20-deployment §4.2 krok 20 [S14]' },
    { id: 'hosts', ok: hosts === sc.hosts, label: `Management domain má ${sc.hosts} ESX hosty`, specRef: sc.specRef },
    { id: 'storage', ok: spec.storage.type === sc.storage, label: `Principal storage ${sc.storage}`, specRef: sc.specRef },
    { id: 'deployment-model', ok: spec.model === sc.deploymentModel, label: `Deployment model ${sc.deploymentModel}`, specRef: sc.specRef },
    { id: 'size', ok: spec.size === sc.size, label: `Velikost ${sc.size}`, specRef: sc.specRef },
    ...(sc.homogeneous ? [{ id: 'homogeneous' as const, ok: homogeneous, label: 'Hosty: jeden vendor, stejná sestava', specRef: '20-deployment §3.2 [S7]; 10-planning §3.4 [P28]' }] : []),
    { id: 'validation-passed', ok: ['ready-to-deploy', 'deploying', 'completed'].includes(status), label: 'Validace bez nepotvrzených chyb', specRef: '20-deployment §4.2 krok 19 [S14]' },
  ];
  return { passed: criteria.every((c) => c.ok), criteria };
}

// ===========================================================================
// Score
// ===========================================================================

/** Career progress kept outside the Sandbox state (game layer). */
export interface CareerProgress {
  /** Objective ids completed after the level start (first completion only). */
  readonly completed: readonly string[];
  /** Objectives already satisfied by the prepared initial state – no points (not the player's work). */
  readonly preCompleted: readonly string[];
  /** Hints used per objective id. */
  readonly hints: Readonly<Record<string, { readonly show: number; readonly solution: number }>>;
  /** Review validation rounds that ended with errors. */
  readonly failedValidations: number;
}

export interface ScoreLine {
  readonly objectiveId: string;
  readonly title: string;
  readonly points: number;
  readonly penalty: number;
  /** max(0, points − penalty) when completed, else 0 (UX 25.3: never below 0 per step). */
  readonly earned: number;
  readonly bonus: boolean;
  readonly completed: boolean;
}

export interface CareerScore {
  readonly lines: readonly ScoreLine[];
  /** Earned points incl. bonuses. */
  readonly points: number;
  /** Max points without bonuses (objectives not pre-completed). */
  readonly maxPoints: number;
  readonly bonusPoints: number;
  readonly penalties: { readonly hints: number; readonly validation: number };
  /** 0–3; ≥ 1 once the level is passed (thresholds over points without bonuses). */
  readonly stars: 0 | 1 | 2 | 3;
  readonly gameMechanic: true;
}

/** Id of the objective that books validation penalties (selector validationPassed). */
export const validationObjectiveId = (set: ObjectiveSet): string | undefined => set.objectives.find((o) => o.selector === 'validationPassed')?.id;

export function computeScore(level: CareerLevelDef, set: ObjectiveSet, progress: CareerProgress, passed: boolean): CareerScore {
  const sc = level.scoring;
  const valId = validationObjectiveId(set);
  const done = new Set(progress.completed);
  const pre = new Set(progress.preCompleted);
  let hintPen = 0;
  const lines: ScoreLine[] = set.objectives
    .filter((o) => o.points !== undefined && !pre.has(o.id))
    .map((o) => {
      const h = progress.hints[o.id] ?? { show: 0, solution: 0 };
      const hp = h.show * sc.hintPenalty + h.solution * sc.solutionPenalty;
      hintPen += hp;
      const penalty = hp + (o.id === valId ? progress.failedValidations * sc.validationErrorPenalty : 0);
      const points = o.points ?? 0;
      const completed = done.has(o.id);
      return { objectiveId: o.id, title: o.title, points, penalty, earned: completed ? Math.max(0, points - penalty) : 0, bonus: o.bonus === true, completed };
    });
  const base = lines.filter((l) => !l.bonus);
  const maxPoints = base.reduce((a, l) => a + l.points, 0);
  const basePts = base.reduce((a, l) => a + l.earned, 0);
  const bonusPoints = lines.filter((l) => l.bonus).reduce((a, l) => a + l.earned, 0);
  const ratio = maxPoints > 0 ? basePts / maxPoints : 1;
  const [t1, t2, t3] = sc.starThresholds;
  const stars: 0 | 1 | 2 | 3 = !passed ? 0 : ratio >= t3 ? 3 : ratio >= t2 ? 2 : ratio >= t1 ? 1 : 1;
  return {
    lines,
    points: basePts + bonusPoints,
    maxPoints,
    bonusPoints,
    penalties: { hints: hintPen, validation: valId ? progress.failedValidations * sc.validationErrorPenalty : 0 },
    stars,
    gameMechanic: true,
  };
}
