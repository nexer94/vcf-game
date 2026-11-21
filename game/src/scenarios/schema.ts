/**
 * Mission (scenario) JSON format for Career mode – campaigns -> missions -> tasks.
 *
 * Authored by scenario-designer from real VCF workflows in docs/spec/. Every task, trap and hint
 * references a spec section (SpecRef) and – where it is a VCF rule – a validation code produced by
 * the domain model (game/src/model). Scenarios never add VCF rules of their own: the model + engine
 * decide what is valid; the mission only describes the starting world, the goal and the scoring.
 *
 * Points, penalties and budgets are GAME MECHANICS (fictional), not facts from documentation.
 *
 * Pure TypeScript: no DOM, no PixiJS (checked by tsconfig.core.json).
 */
import type { ClusterModel, FleetDesign } from '../model/architecture';
import {
  type BinaryStatus,
  type BringupRules,
  type BringupSpec,
  type DeploymentEvent,
  type DeploymentModel,
  type DeploymentState,
  type DeploymentStatus,
  type DepotState,
  type EsxHost,
  type InstallerMode,
  type InstallerOvfInput,
  type InstallerPlacement,
  type InstallerState,
  type OfflineDepotInput,
  type OnlineDepotInput,
  type StorageType,
  type VcfBinary,
  type WizardStep,
  DEPLOYMENT_TRANSITIONS,
  POST_DEPLOYMENT_STEPS,
  VCF_BINARIES,
  WIZARD_STEPS,
} from '../model/bringup';
import type { DnsRecords } from '../model/net';

export const SCENARIO_SCHEMA_VERSION = 1;

// ===========================================================================
// Basic enums
// ===========================================================================

/** Difficulty ladder of a campaign: tutorial -> routine operations -> troubleshooting -> production design. */
export type Difficulty = 'tutorial' | 'routine' | 'troubleshooting' | 'production-design';
export const DIFFICULTIES: readonly Difficulty[] = ['tutorial', 'routine', 'troubleshooting', 'production-design'];
/** UI labels (Czech). */
export const DIFFICULTY_LABEL_CS: Readonly<Record<Difficulty, string>> = {
  tutorial: 'Tutoriál',
  routine: 'Běžný provoz',
  troubleshooting: 'Troubleshooting',
  'production-design': 'Návrh pro produkci',
};

/** Spec files a mission may cite (docs/spec/<file>.md). */
export type SpecFile = '00-architektura' | '06-blueprints' | '10-planning' | '15-hardware' | '20-deployment' | '25-usecases-and-physical' | '26-esx-install';
export const SPEC_FILES: readonly SpecFile[] = ['00-architektura', '06-blueprints', '10-planning', '15-hardware', '20-deployment', '25-usecases-and-physical', '26-esx-install'];

/** Reference into the spec: file + numbered section ("§4.1.5") + source ids ("S6"). */
export interface SpecRef {
  readonly spec: SpecFile;
  /** Numbered section of the spec file, e.g. "§4.1.5" (must exist as a heading). */
  readonly section: string;
  /** Source ids from section "Zdroje" of that spec file, e.g. ["S6"] or ["P9"] (10-planning). */
  readonly sources: readonly string[];
}

/** Link to official documentation. URL must be one of the sources listed in the cited spec file. */
export interface DocLink {
  readonly title: string;
  readonly url: string;
}

export type PostDeploymentStep = (typeof POST_DEPLOYMENT_STEPS)[number];

// ===========================================================================
// Actions the player performs (map to model functions / wizard steps)
// ===========================================================================

/**
 * Model transition functions the engine calls when the player acts (game/src/model/bringup.ts).
 * Key = action id used in JSON, value = model function.
 */
export const MODEL_ACTIONS = {
  'install-esx': 'installEsx',
  'configure-host-network': 'configureHostNetwork',
  'configure-host-ntp': 'configureHostNtp',
  'set-host-ssh': 'setHostSsh',
  'regenerate-host-certificate': 'regenerateHostCertificate',
  'deploy-installer-ova': 'deployInstallerOva',
  'configure-depot': 'configureDepot',
  'download-binary': 'setBinaryStatus',
} as const;
export type ModelActionId = keyof typeof MODEL_ACTIONS;

/**
 * Actions on the simulated infrastructure OUTSIDE VCF (the customer's DNS server). The spec only
 * requires that the records exist (20 §3.5 [S20]); how they are created is not a VCF workflow.
 */
export type EnvironmentActionId = 'dns-add-forward' | 'dns-add-reverse';

export type ActionRef =
  | { readonly kind: 'model'; readonly action: ModelActionId }
  | { readonly kind: 'wizard-step'; readonly step: WizardStep }
  | { readonly kind: 'deployment-event'; readonly event: DeploymentEvent['type'] }
  | { readonly kind: 'post-deployment-step'; readonly step: PostDeploymentStep }
  | { readonly kind: 'environment'; readonly action: EnvironmentActionId }
  | { readonly kind: 'design-choice'; readonly choice: DesignChoiceId }
  /** Player explicitly runs a validator (counts as a validation run for scoring). */
  | { readonly kind: 'run-check'; readonly check: ValidationCheckId }
  | { readonly kind: 'quiz' };

/**
 * Design decisions that are not part of the wizard input (BringupSpec) but are parameters of the
 * model: cluster model of the management domain (`buildFleetFromBringup`), fleet design
 * (`FLEET_DESIGN_CLUSTER_MODELS`), installer placement (`InstallerOvfInput.placement`).
 */
export type DesignChoiceId = 'cluster-model' | 'fleet-design' | 'installer-placement';

// ===========================================================================
// Validation checks (model validators the engine runs)
// ===========================================================================

/**
 * Model validators. `transition` = blocking error returned by a model transition function
 * (TransitionResult.ok === false), e.g. regenerating a certificate with SSH disabled.
 */
export const VALIDATION_CHECKS = [
  'validateDeployInstallerOva',
  'validateInstallerCanDeploy',
  'validateEsxHostsForBringup',
  'validateConfigureOnlineDepot',
  'validateConfigureOfflineDepot',
  'validateBinariesForDeployment',
  'validateBringupSpec',
  'validateFleet',
  'transition',
] as const;
export type ValidationCheckId = (typeof VALIDATION_CHECKS)[number];

/** Extra input some validators need (scenario-level parameters). */
export interface CheckContext {
  /** Subset of host ids (default: all hosts of the environment). */
  readonly hosts?: readonly string[];
  /** For validateEsxHostsForBringup. */
  readonly model?: DeploymentModel;
  readonly storage?: StorageType;
  /** For validateFleet (cluster model passed to buildFleetFromBringup). */
  readonly clusterModel?: ClusterModel;
}

// ===========================================================================
// Completion conditions (required end state of a task)
// ===========================================================================

export interface HostRequirement {
  readonly esxInstalled?: boolean;
  readonly networkConfigured?: boolean;
  readonly customDnsSuffixesEmpty?: boolean;
  readonly ntpRunning?: boolean;
  readonly sshEnabled?: boolean;
  readonly certificateCnMatchesFqdn?: boolean;
}

export type SpecFieldValue = string | number | boolean;

export type CompletionCondition =
  /** InstallerState.mode equals. */
  | { readonly kind: 'installer-mode'; readonly mode: InstallerMode }
  /** Every listed host satisfies every listed requirement (EsxHost fields). */
  | { readonly kind: 'host-state'; readonly hosts: readonly string[]; readonly require: HostRequirement }
  /** Each FQDN has forward (A) and matching reverse (PTR) record (checkForwardReverse). */
  | { readonly kind: 'dns-forward-reverse'; readonly fqdns: readonly string[] }
  /** DepotState.connection.kind. */
  | { readonly kind: 'depot-connected'; readonly connection: 'online' | 'offline' | 'any' }
  /** Binary Download Status of listed binaries ('all-vcf' = VCF_BINARIES). */
  | { readonly kind: 'binaries-status'; readonly binaries: readonly VcfBinary[] | 'all-vcf'; readonly status: BinaryStatus }
  /** Player confirmed this wizard page (Next). */
  | { readonly kind: 'wizard-step-completed'; readonly step: WizardStep }
  /** DeploymentState.status equals. */
  | { readonly kind: 'deployment-status'; readonly status: DeploymentStatus }
  /** Validator returns no errors (and no warnings unless allowWarnings). */
  | { readonly kind: 'check-clean'; readonly check: ValidationCheckId; readonly allowWarnings: boolean; readonly context?: CheckContext }
  /**
   * Validator evaluated on the current state reports none of the codes. The engine evaluates it
   * silently (not counted as a player's validation run); false while required input is missing.
   */
  | { readonly kind: 'codes-absent'; readonly check: ValidationCheckId; readonly codes: readonly string[]; readonly context?: CheckContext }
  /** Dotted path into BringupSpec (e.g. "storage.type") has one of the values. */
  | { readonly kind: 'spec-field'; readonly path: string; readonly oneOf: readonly SpecFieldValue[] }
  /** Design decision outside BringupSpec. */
  | { readonly kind: 'design-choice'; readonly choice: DesignChoiceId; readonly oneOf: readonly string[] }
  /** Post-deployment step (20 §4.4) marked done. */
  | { readonly kind: 'post-deployment-step-done'; readonly step: PostDeploymentStep }
  /** Knowledge check; answer must be backed by the task's specRefs. `correct` = indexes into options. */
  | {
      readonly kind: 'quiz';
      readonly question: string;
      readonly options: readonly string[];
      readonly correct: readonly number[];
      readonly explanation: string;
    }
  | { readonly kind: 'all-of'; readonly conditions: readonly CompletionCondition[] };

export type CompletionKind = CompletionCondition['kind'];
export const COMPLETION_KINDS: readonly CompletionKind[] = [
  'installer-mode',
  'host-state',
  'dns-forward-reverse',
  'depot-connected',
  'binaries-status',
  'wizard-step-completed',
  'deployment-status',
  'check-clean',
  'codes-absent',
  'spec-field',
  'design-choice',
  'post-deployment-step-done',
  'quiz',
  'all-of',
];

// ===========================================================================
// Mission parts
// ===========================================================================

export interface MissionTask {
  readonly id: string;
  /** Expected position (1-based). Ordering bonus: see MissionScoring.orderBonus. */
  readonly order: number;
  readonly title: string;
  readonly description: string;
  /** What the player does (model actions / wizard pages / environment). */
  readonly actions: readonly ActionRef[];
  /** Required end state. */
  readonly completion: CompletionCondition;
  /** Points for completing the task (game mechanic). */
  readonly points: number;
  readonly optional?: boolean;
  readonly specRefs: readonly SpecRef[];
}

/**
 * A trap = a real error state from the spec, detected by the model via validation codes.
 * - `initial-state`: the problem is already in the starting world (a colleague's mistake, missing
 *   PTR record…). Avoided = fixed before any validation reports one of `codes`.
 * - `player-input`: the player can cause it (wrong value, wrong order). Avoided = `codes` never
 *   reported during the mission.
 */
export interface MissionTrap {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** Validation codes produced by the model (game/src/model/*.ts, `issue('<CODE>', …)`). */
  readonly codes: readonly string[];
  readonly armed: 'initial-state' | 'player-input';
  /** Validators that report the codes. */
  readonly detectedBy: readonly ValidationCheckId[];
  /** Bonus when avoided (game mechanic). */
  readonly avoidBonus: number;
  readonly relatedTasks?: readonly string[];
  readonly specRefs: readonly SpecRef[];
}

export interface MissionHint {
  readonly id: string;
  /** Hint belongs to a task or a trap (at least one). */
  readonly taskId?: string;
  readonly trapId?: string;
  readonly text: string;
  readonly specRef: SpecRef;
  readonly doc: DocLink;
  /** Points deducted when the hint is opened (game mechanic). */
  readonly cost: number;
}

/**
 * Scoring (game mechanic).
 * maxPoints = Σ task.points + orderBonus.points + cleanRunBonus + Σ trap.avoidBonus.
 */
export interface MissionScoring {
  /** Bonus when the listed tasks are completed in this relative order. */
  readonly orderBonus: { readonly points: number; readonly sequence: readonly string[] };
  /** Bonus when no validation run in the mission reported a blocking error. */
  readonly cleanRunBonus: number;
  readonly penalties: {
    /** Per distinct (code, subject) error first reported by a validator or a rejected transition. */
    readonly perValidationError: number;
    /** Per validation run (wizard step 19 / JSON validation / pre-check) above freeValidationRuns. */
    readonly perValidationRun: number;
    readonly freeValidationRuns: number;
    /** Per action rejected by the state machine (e.g. ILLEGAL_DEPLOYMENT_TRANSITION). */
    readonly perIllegalAction: number;
  };
  readonly maxPoints: number;
  /** Minimum to pass the mission and unlock the next one. */
  readonly passPoints: number;
}

/**
 * Career economy budget – GAME MECHANIC (fictional currency), never a documentation fact.
 * The HW catalog / prices are not defined yet (engine-dev, docs/PROGRESS.md).
 */
export interface MissionBudget {
  readonly gameMechanic: true;
  readonly currency: string;
  readonly amount: number;
  readonly note: string;
  /** Catalog id of purchasable HW; null until the catalog exists. */
  readonly catalog: string | null;
}

/** Data the player gets (Planning and Preparation Workbook, 20 §3.1 [S36]). Values are illustrative. */
export interface WorkbookEntry {
  readonly key: string;
  readonly label: string;
  readonly value: string | number | boolean | readonly string[];
}
export interface Workbook {
  readonly note: string;
  readonly entries: readonly WorkbookEntry[];
}

/** Starting world in terms of the model's types (BringupEnvironment + drafts). */
export interface InitialEnvironment {
  readonly installer: InstallerState;
  readonly depot: DepotState;
  readonly hosts: readonly EsxHost[];
  readonly dns: DnsRecords;
  readonly existingInstanceNames?: readonly string[];
  readonly unreachableFromInstaller?: readonly string[];
  readonly physicalNetworkLagReady?: boolean;
  /** Configurable model rules (BringupRules is plain data, usable from JSON). */
  readonly rules?: BringupRules;
  /** Pre-filled wizard / JSON input (e.g. a colleague's JSON spec). */
  readonly spec?: BringupSpec;
  readonly deployment?: DeploymentState;
  /** Pre-filled forms. */
  readonly drafts?: {
    readonly installerOvf?: InstallerOvfInput;
    readonly onlineDepot?: OnlineDepotInput;
    readonly offlineDepot?: OfflineDepotInput;
  };
  readonly workbook: Workbook;
}

/** Self-check: what a validator reports on the initial world (unique codes). */
export interface ExpectedIssues {
  readonly check: ValidationCheckId;
  readonly context?: CheckContext;
  readonly codes: readonly string[];
  /** true = exactly these codes; false = at least these codes. */
  readonly exact: boolean;
}

export interface SolutionCheck {
  readonly check: ValidationCheckId;
  readonly context?: CheckContext;
  readonly allowWarnings: boolean;
}

/**
 * Reference solution – proves the mission is solvable with the model; usable by the engine for
 * demos / auto-play. Patches are applied to the initial environment, then `checks` must be clean.
 */
export interface ReferenceSolution {
  readonly description: string;
  readonly installerOvf?: InstallerOvfInput;
  readonly depot?: DepotState;
  readonly hostPatches?: readonly { readonly id: string; readonly patch: Partial<EsxHost> }[];
  readonly dnsPatch?: { readonly forward?: Readonly<Record<string, string>>; readonly reverse?: Readonly<Record<string, string>> };
  readonly spec?: BringupSpec;
  readonly designChoices?: {
    readonly clusterModel?: ClusterModel;
    readonly fleetDesign?: FleetDesign;
    readonly installerPlacement?: InstallerPlacement;
  };
  readonly checks: readonly SolutionCheck[];
}

export interface CampaignRef {
  readonly id: string;
  readonly order: number;
  readonly title: string;
}

export interface Mission {
  readonly schemaVersion: typeof SCENARIO_SCHEMA_VERSION;
  readonly id: string;
  readonly campaign: CampaignRef;
  /** Order within the campaign (1-based). */
  readonly order: number;
  readonly title: string;
  readonly difficulty: Difficulty;
  /** Modelled VCF version (MODELLED_VCF_VERSION). */
  readonly vcfVersion: string;
  /** Mission ids that must be passed first. */
  readonly requires: readonly string[];
  readonly summary: string;
  readonly briefing: string;
  readonly objectives: readonly string[];
  readonly initial: InitialEnvironment;
  readonly tasks: readonly MissionTask[];
  readonly traps: readonly MissionTrap[];
  readonly hints: readonly MissionHint[];
  readonly scoring: MissionScoring;
  readonly budget?: MissionBudget;
  readonly expectedInitialIssues?: readonly ExpectedIssues[];
  readonly referenceSolution?: ReferenceSolution;
  /** Spec sections the mission as a whole is based on. */
  readonly specRefs: readonly SpecRef[];
  /** Optional note on where the situation was picked (VCF Upgrade Planner is navigation only). */
  readonly sourceNote?: string;
}

// ===========================================================================
// Runtime shape check (for JSON loaded at runtime; the engine and tests use it)
// ===========================================================================

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isArr = (x: unknown): x is unknown[] => Array.isArray(x);

const DEPLOYMENT_STATUSES = Object.keys(DEPLOYMENT_TRANSITIONS);
const DEPLOYMENT_EVENTS = [...new Set(Object.values(DEPLOYMENT_TRANSITIONS).flat())] as string[];
const INSTALLER_MODES: readonly InstallerMode[] = ['not-deployed', 'installer', 'sddc-manager'];
const BINARY_STATUSES: readonly BinaryStatus[] = ['not-downloaded', 'downloading', 'validating', 'downloaded', 'failed'];
const DESIGN_CHOICES: readonly DesignChoiceId[] = ['cluster-model', 'fleet-design', 'installer-placement'];
const ENV_ACTIONS: readonly EnvironmentActionId[] = ['dns-add-forward', 'dns-add-reverse'];
const CODE_RE = /^[A-Z][A-Z0-9_]*$/;
/** Source ids: "S<n>" (00, 20) or "P<n>" (10-planning). */
const SOURCE_RE = /^[SP]\d+$/;
const SECTION_RE = /^§\d+(\.\d+)*$/;
const DOC_URL_RE = /^https:\/\/(techdocs|knowledge)\.broadcom\.com\//;

const has = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v);

function checkSpecRef(x: unknown, where: string, out: string[]): void {
  if (!isObj(x)) {
    out.push(`${where}: specRef must be an object`);
    return;
  }
  if (!has(SPEC_FILES, x['spec'])) out.push(`${where}: unknown spec file ${String(x['spec'])}`);
  if (!isStr(x['section']) || !SECTION_RE.test(x['section'])) out.push(`${where}: bad section ${String(x['section'])}`);
  const src = x['sources'];
  if (!isArr(src) || src.length === 0 || !src.every((s) => isStr(s) && SOURCE_RE.test(s))) out.push(`${where}: bad sources`);
}

function checkSpecRefs(x: unknown, where: string, out: string[]): void {
  if (!isArr(x) || x.length === 0) {
    out.push(`${where}: specRefs must be a non-empty array`);
    return;
  }
  x.forEach((r, i) => checkSpecRef(r, `${where}.specRefs[${i}]`, out));
}

function checkCondition(c: unknown, where: string, out: string[]): void {
  if (!isObj(c) || !has(COMPLETION_KINDS, c['kind'])) {
    out.push(`${where}: unknown completion kind`);
    return;
  }
  switch (c['kind'] as CompletionKind) {
    case 'installer-mode':
      if (!has(INSTALLER_MODES, c['mode'])) out.push(`${where}: bad installer mode`);
      break;
    case 'host-state':
      if (!isArr(c['hosts']) || c['hosts'].length === 0) out.push(`${where}: hosts required`);
      if (!isObj(c['require'])) out.push(`${where}: require must be an object`);
      break;
    case 'dns-forward-reverse':
      if (!isArr(c['fqdns']) || c['fqdns'].length === 0) out.push(`${where}: fqdns required`);
      break;
    case 'depot-connected':
      if (!has(['online', 'offline', 'any'], c['connection'])) out.push(`${where}: bad depot connection`);
      break;
    case 'binaries-status': {
      const b = c['binaries'];
      if (b !== 'all-vcf' && !(isArr(b) && b.every((x) => has(VCF_BINARIES, x)))) out.push(`${where}: bad binaries`);
      if (!has(BINARY_STATUSES, c['status'])) out.push(`${where}: bad binary status`);
      break;
    }
    case 'wizard-step-completed':
      if (!has(WIZARD_STEPS, c['step'])) out.push(`${where}: unknown wizard step ${String(c['step'])}`);
      break;
    case 'deployment-status':
      if (!has(DEPLOYMENT_STATUSES, c['status'])) out.push(`${where}: unknown deployment status`);
      break;
    case 'check-clean':
      if (!has(VALIDATION_CHECKS, c['check'])) out.push(`${where}: unknown check`);
      if (typeof c['allowWarnings'] !== 'boolean') out.push(`${where}: allowWarnings must be boolean`);
      break;
    case 'codes-absent': {
      const codes = c['codes'];
      if (!has(VALIDATION_CHECKS, c['check'])) out.push(`${where}: unknown check`);
      if (!isArr(codes) || codes.length === 0 || !codes.every((k) => isStr(k) && CODE_RE.test(k))) out.push(`${where}: codes invalid`);
      break;
    }
    case 'spec-field':
      if (!isStr(c['path'])) out.push(`${where}: path required`);
      if (!isArr(c['oneOf']) || c['oneOf'].length === 0) out.push(`${where}: oneOf required`);
      break;
    case 'design-choice':
      if (!has(DESIGN_CHOICES, c['choice'])) out.push(`${where}: unknown design choice`);
      if (!isArr(c['oneOf']) || c['oneOf'].length === 0) out.push(`${where}: oneOf required`);
      break;
    case 'post-deployment-step-done':
      if (!has(POST_DEPLOYMENT_STEPS, c['step'])) out.push(`${where}: unknown post-deployment step`);
      break;
    case 'quiz': {
      const opts = c['options'];
      const corr = c['correct'];
      if (!isStr(c['question']) || !isStr(c['explanation'])) out.push(`${where}: quiz question/explanation required`);
      if (!isArr(opts) || opts.length < 2 || !opts.every(isStr)) out.push(`${where}: quiz needs >= 2 options`);
      else if (!isArr(corr) || corr.length === 0 || !corr.every((i) => isNum(i) && i >= 0 && i < opts.length))
        out.push(`${where}: quiz correct indexes invalid`);
      break;
    }
    case 'all-of':
      if (!isArr(c['conditions']) || c['conditions'].length === 0) out.push(`${where}: all-of needs conditions`);
      else c['conditions'].forEach((x, i) => checkCondition(x, `${where}.conditions[${i}]`, out));
      break;
  }
}

function checkAction(a: unknown, where: string, out: string[]): void {
  if (!isObj(a)) {
    out.push(`${where}: action must be an object`);
    return;
  }
  switch (a['kind']) {
    case 'model':
      if (!has(Object.keys(MODEL_ACTIONS), a['action'])) out.push(`${where}: unknown model action ${String(a['action'])}`);
      break;
    case 'wizard-step':
      if (!has(WIZARD_STEPS, a['step'])) out.push(`${where}: unknown wizard step ${String(a['step'])}`);
      break;
    case 'deployment-event':
      if (!has(DEPLOYMENT_EVENTS, a['event'])) out.push(`${where}: unknown deployment event`);
      break;
    case 'post-deployment-step':
      if (!has(POST_DEPLOYMENT_STEPS, a['step'])) out.push(`${where}: unknown post-deployment step`);
      break;
    case 'environment':
      if (!has(ENV_ACTIONS, a['action'])) out.push(`${where}: unknown environment action`);
      break;
    case 'design-choice':
      if (!has(DESIGN_CHOICES, a['choice'])) out.push(`${where}: unknown design choice`);
      break;
    case 'run-check':
      if (!has(VALIDATION_CHECKS, a['check'])) out.push(`${where}: unknown check`);
      break;
    case 'quiz':
      break;
    default:
      out.push(`${where}: unknown action kind ${String(a['kind'])}`);
  }
}

/** Flattens a condition tree (all-of) into its leaf conditions. */
export function leafConditions(c: CompletionCondition): CompletionCondition[] {
  return c.kind === 'all-of' ? c.conditions.flatMap(leafConditions) : [c];
}

/** Collects every validation code a mission references (traps, task conditions, expected issues). */
export function referencedCodes(m: Mission): string[] {
  const codes = new Set<string>();
  m.traps.forEach((t) => t.codes.forEach((c) => codes.add(c)));
  m.tasks.forEach((t) =>
    leafConditions(t.completion).forEach((c) => {
      if (c.kind === 'codes-absent') c.codes.forEach((k) => codes.add(k));
    }),
  );
  (m.expectedInitialIssues ?? []).forEach((e) => e.codes.forEach((c) => codes.add(c)));
  return [...codes].sort();
}

/** Computes maxPoints from the parts (see MissionScoring). */
export function computeMaxPoints(m: Mission): number {
  return (
    m.tasks.reduce((a, t) => a + t.points, 0) +
    m.scoring.orderBonus.points +
    m.scoring.cleanRunBonus +
    m.traps.reduce((a, t) => a + t.avoidBonus, 0)
  );
}

/**
 * Basic structural check of a mission loaded from JSON. Returns a list of problems (empty = OK).
 * Cross-checks against the model's enumerations (wizard steps, binaries, statuses…).
 */
export function checkMissionShape(x: unknown): string[] {
  const out: string[] = [];
  if (!isObj(x)) return ['mission must be an object'];
  const id = isStr(x['id']) ? x['id'] : '<no id>';
  const w = (s: string): string => `${id}: ${s}`;

  if (x['schemaVersion'] !== SCENARIO_SCHEMA_VERSION) out.push(w('schemaVersion mismatch'));
  for (const k of ['id', 'title', 'summary', 'briefing', 'vcfVersion'] as const) if (!isStr(x[k])) out.push(w(`${k} required`));
  if (!isNum(x['order']) || x['order'] < 1) out.push(w('order must be >= 1'));
  if (!has(DIFFICULTIES, x['difficulty'])) out.push(w(`unknown difficulty ${String(x['difficulty'])}`));
  const camp = x['campaign'];
  if (!isObj(camp) || !isStr(camp['id']) || !isNum(camp['order']) || !isStr(camp['title'])) out.push(w('campaign {id, order, title} required'));
  if (!isArr(x['requires']) || !x['requires'].every(isStr)) out.push(w('requires must be string[]'));
  if (!isArr(x['objectives']) || x['objectives'].length === 0) out.push(w('objectives required'));
  checkSpecRefs(x['specRefs'], w('mission'), out);

  // Initial environment.
  const init = x['initial'];
  if (!isObj(init)) out.push(w('initial required'));
  else {
    const inst = init['installer'];
    if (!isObj(inst) || !has(INSTALLER_MODES, inst['mode']) || !isStr(inst['version']) || !isNum(inst['platformsDeployed']))
      out.push(w('initial.installer must be an InstallerState'));
    const depot = init['depot'];
    if (!isObj(depot) || !isObj(depot['connection']) || !isObj(depot['binaries'])) out.push(w('initial.depot must be a DepotState'));
    else
      for (const [b, s] of Object.entries(depot['binaries']))
        if (!has(VCF_BINARIES, b) || !has(BINARY_STATUSES, s)) out.push(w(`initial.depot.binaries: bad entry ${b}=${String(s)}`));
    if (!isArr(init['hosts'])) out.push(w('initial.hosts must be an array'));
    else
      init['hosts'].forEach((h, i) => {
        if (!isObj(h) || !isStr(h['id']) || !isStr(h['hwVendor']) || !isStr(h['hwProfileId']) || !isNum(h['pnicCount']) || !isObj(h['ntp']) || !isStr(h['certificateCn']))
          out.push(w(`initial.hosts[${i}] is not an EsxHost`));
      });
    const dns = init['dns'];
    if (!isObj(dns) || !isObj(dns['forward']) || !isObj(dns['reverse'])) out.push(w('initial.dns must be DnsRecords'));
    const wb = init['workbook'];
    if (!isObj(wb) || !isStr(wb['note']) || !isArr(wb['entries'])) out.push(w('initial.workbook required'));
    const dep = init['deployment'];
    if (dep !== undefined && (!isObj(dep) || !has(DEPLOYMENT_STATUSES, dep['status']))) out.push(w('initial.deployment.status invalid'));
  }

  // Tasks.
  const taskIds = new Set<string>();
  const tasks = x['tasks'];
  if (!isArr(tasks) || tasks.length === 0) out.push(w('tasks required'));
  else
    tasks.forEach((t, i) => {
      const tw = w(`tasks[${i}]`);
      if (!isObj(t) || !isStr(t['id'])) {
        out.push(`${tw}: id required`);
        return;
      }
      if (taskIds.has(t['id'])) out.push(`${tw}: duplicate id ${t['id']}`);
      taskIds.add(t['id']);
      if (!isStr(t['title']) || !isStr(t['description'])) out.push(`${tw}: title/description required`);
      if (!isNum(t['order']) || !isNum(t['points']) || t['points'] < 0) out.push(`${tw}: order/points invalid`);
      if (!isArr(t['actions']) || t['actions'].length === 0) out.push(`${tw}: actions required`);
      else t['actions'].forEach((a, j) => checkAction(a, `${tw}.actions[${j}]`, out));
      checkCondition(t['completion'], `${tw}.completion`, out);
      checkSpecRefs(t['specRefs'], tw, out);
    });

  // Traps.
  const trapIds = new Set<string>();
  const traps = x['traps'];
  if (!isArr(traps)) out.push(w('traps must be an array'));
  else
    traps.forEach((t, i) => {
      const tw = w(`traps[${i}]`);
      if (!isObj(t) || !isStr(t['id'])) {
        out.push(`${tw}: id required`);
        return;
      }
      if (trapIds.has(t['id'])) out.push(`${tw}: duplicate id ${t['id']}`);
      trapIds.add(t['id']);
      if (!isStr(t['title']) || !isStr(t['description'])) out.push(`${tw}: title/description required`);
      const codes = t['codes'];
      if (!isArr(codes) || codes.length === 0 || !codes.every((c) => isStr(c) && CODE_RE.test(c))) out.push(`${tw}: codes must be UPPER_SNAKE validation codes`);
      if (!has(['initial-state', 'player-input'], t['armed'])) out.push(`${tw}: armed invalid`);
      const det = t['detectedBy'];
      if (!isArr(det) || det.length === 0 || !det.every((d) => has(VALIDATION_CHECKS, d))) out.push(`${tw}: detectedBy invalid`);
      if (!isNum(t['avoidBonus']) || t['avoidBonus'] < 0) out.push(`${tw}: avoidBonus invalid`);
      const rel = t['relatedTasks'];
      if (rel !== undefined && (!isArr(rel) || !rel.every((r) => typeof r === 'string' && taskIds.has(r)))) out.push(`${tw}: relatedTasks refer to unknown task`);
      checkSpecRefs(t['specRefs'], tw, out);
    });

  // Hints.
  const hints = x['hints'];
  if (!isArr(hints)) out.push(w('hints must be an array'));
  else
    hints.forEach((h, i) => {
      const hw = w(`hints[${i}]`);
      if (!isObj(h) || !isStr(h['id']) || !isStr(h['text'])) {
        out.push(`${hw}: id/text required`);
        return;
      }
      const tId = h['taskId'];
      const trId = h['trapId'];
      if (tId === undefined && trId === undefined) out.push(`${hw}: taskId or trapId required`);
      if (tId !== undefined && !(typeof tId === 'string' && taskIds.has(tId))) out.push(`${hw}: unknown taskId`);
      if (trId !== undefined && !(typeof trId === 'string' && trapIds.has(trId))) out.push(`${hw}: unknown trapId`);
      checkSpecRef(h['specRef'], hw, out);
      const doc = h['doc'];
      if (!isObj(doc) || !isStr(doc['title']) || !isStr(doc['url']) || !DOC_URL_RE.test(doc['url'])) out.push(`${hw}: doc link must point to techdocs/knowledge.broadcom.com`);
      if (!isNum(h['cost']) || h['cost'] < 0) out.push(`${hw}: cost invalid`);
    });

  // Scoring.
  const sc = x['scoring'];
  if (!isObj(sc)) out.push(w('scoring required'));
  else {
    const ob = sc['orderBonus'];
    if (!isObj(ob) || !isNum(ob['points']) || !isArr(ob['sequence'])) out.push(w('scoring.orderBonus invalid'));
    else if (!ob['sequence'].every((s) => typeof s === 'string' && taskIds.has(s))) out.push(w('scoring.orderBonus.sequence refers to unknown task'));
    const p = sc['penalties'];
    if (!isObj(p) || !['perValidationError', 'perValidationRun', 'freeValidationRuns', 'perIllegalAction'].every((k) => isNum(p[k]) && (p[k] as number) >= 0))
      out.push(w('scoring.penalties invalid'));
    if (!isNum(sc['cleanRunBonus']) || !isNum(sc['maxPoints']) || !isNum(sc['passPoints'])) out.push(w('scoring numbers invalid'));
    else if (sc['passPoints'] > sc['maxPoints']) out.push(w('passPoints > maxPoints'));
  }

  // Budget (game mechanic).
  const b = x['budget'];
  if (b !== undefined && (!isObj(b) || b['gameMechanic'] !== true || !isNum(b['amount']) || !isStr(b['currency']) || !isStr(b['note'])))
    out.push(w('budget must be marked gameMechanic: true with currency/amount/note'));

  // Expected issues / reference solution.
  const ei = x['expectedInitialIssues'];
  if (ei !== undefined && (!isArr(ei) || !ei.every((e) => isObj(e) && has(VALIDATION_CHECKS, e['check']) && isArr(e['codes']) && typeof e['exact'] === 'boolean')))
    out.push(w('expectedInitialIssues invalid'));
  const rs = x['referenceSolution'];
  if (rs !== undefined) {
    if (!isObj(rs) || !isStr(rs['description']) || !isArr(rs['checks'])) out.push(w('referenceSolution invalid'));
    else if (!rs['checks'].every((c) => isObj(c) && has(VALIDATION_CHECKS, c['check']) && typeof c['allowWarnings'] === 'boolean'))
      out.push(w('referenceSolution.checks invalid'));
  }

  // Points consistency (only if the structure is sound so far).
  if (out.length === 0) {
    const m = x as unknown as Mission;
    const computed = computeMaxPoints(m);
    if (computed !== m.scoring.maxPoints) out.push(w(`scoring.maxPoints ${m.scoring.maxPoints} != computed ${computed}`));
  }
  return out;
}
