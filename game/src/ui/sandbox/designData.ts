/**
 * Adapter: model (game/src/model/design.ts) -> view data for the "Návrh" phase.
 *
 * Pure (no DOM) so it is testable in Node. Everything VCF-specific shown in the
 * design phase comes from here, i.e. from the model; the UI only adds Czech
 * labels for UI concepts (consequence kinds, step headings in the game order
 * of spec 05 §4.10 – a game order, not a documented one).
 */
import {
  type ConsequenceKind,
  type DesignChoices,
  type DesignConsequence,
  type DesignDecisionDef,
  type DesignRule,
  type DesignRuleKind,
  type DesignSourceId,
  type DesignSummary,
  type ValidationIssue,
  DESIGN_DECISIONS,
  DESIGN_RULES,
  applicableDecisions,
  choicesFromMap,
  docRefOf,
  optionAvailability,
  summarizeDesign,
  validateDesign,
} from '../../model';

export interface DocRef {
  readonly title: string;
  readonly url: string;
}

export interface RuleView {
  readonly id: string;
  readonly kind: DesignRuleKind;
  readonly text: string;
  /** Verbatim English text from the docs (not paraphrased). */
  readonly quote: boolean;
  readonly paraphrased: boolean;
  readonly truncated: boolean;
  readonly justification: readonly string[];
  readonly implication: readonly string[];
  readonly sources: readonly DocRef[];
}

export interface ConsequenceView {
  readonly kind: ConsequenceKind;
  readonly text: string;
  readonly quote: boolean;
  readonly paraphrased: boolean;
  /** Spec reference of an open question (unverified). */
  readonly openQuestion?: string;
  readonly sources: readonly DocRef[];
}

/** A documented recommendation the option deviates from (acknowledgeable). */
export interface OptionWarning {
  /** Descriptive model message (English, not a quote). */
  readonly message: string;
  readonly specRef: string;
  readonly rules: readonly RuleView[];
}

export interface DesignOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly sources: readonly DocRef[];
  /** True if a shown value is not directly from the docs (rendered with the badge). */
  readonly illustrative?: boolean;
  /** Why the option is not available (from model validation), if it is not. */
  readonly disabledReason?: string;
  readonly warnings: readonly OptionWarning[];
  readonly consequences: readonly ConsequenceView[];
  readonly appliedRules: readonly RuleView[];
  readonly deviatedRules: readonly RuleView[];
  readonly day2: boolean;
  readonly paraphrased: boolean;
  readonly openQuestions: readonly string[];
}

export interface DesignDecision {
  readonly id: string;
  readonly title: string;
  readonly help?: string;
  readonly options: readonly DesignOption[];
  readonly sources: readonly DocRef[];
  readonly step: number;
  readonly specRef: string;
  readonly rules: readonly RuleView[];
  readonly consequences: readonly ConsequenceView[];
  readonly chosen?: string;
}

export interface DesignStepGroup {
  readonly step: number;
  readonly title: string;
  readonly decisions: readonly DesignDecision[];
  /** All earlier steps are decided (guided sequence). */
  readonly unlocked: boolean;
  readonly complete: boolean;
}

export interface IssueView {
  /** Stable key for acknowledgement (code + subject). */
  readonly key: string;
  readonly code: string;
  readonly message: string;
  readonly specRef: string;
  readonly decisionId?: string;
  readonly decisionTitle?: string;
}

export interface DayTwoView extends ConsequenceView {
  readonly decisionTitle: string;
}

export interface DesignSummaryView {
  readonly raw: DesignSummary;
  readonly appliedRules: readonly RuleView[];
  readonly deviatedRules: readonly RuleView[];
  readonly dayTwo: readonly DayTwoView[];
}

export interface DesignStepData {
  readonly decisions: readonly DesignDecision[];
  readonly steps: readonly DesignStepGroup[];
  readonly summary: DesignSummaryView;
  readonly issues: {
    /** Decisions not made yet (DESIGN_DECISION_MISSING), shown compactly. */
    readonly missing: readonly { readonly id: string; readonly title: string }[];
    readonly errors: readonly IssueView[];
    readonly warnings: readonly IssueView[];
  };
  /** Warnings acknowledged for the current warning set. */
  readonly warningsAcknowledged: boolean;
  /** No errors, nothing missing, all warnings acknowledged. */
  readonly canProceed: boolean;
}

/** Step headings – game order per spec 05 §4.10 (navigation labels, not VCF facts). */
export const DESIGN_STEP_TITLES: Readonly<Record<number, string>> = {
  1: 'Fleet deployment model',
  2: 'Umístění workloadů a NSX',
  3: 'Deployment model a velikost',
  4: 'vSphere cluster model',
  5: 'Principal storage',
  6: 'Sítě',
  7: 'VCF Operations a VCF Automation',
  8: 'Identita a SSO',
};

const toDoc = (ids: readonly DesignSourceId[]): DocRef[] => ids.map(docRefOf);

function ruleView(r: DesignRule): RuleView {
  return {
    id: r.id,
    kind: r.kind,
    text: r.text,
    quote: r.paraphrased !== true,
    paraphrased: r.paraphrased === true,
    truncated: r.truncated === true,
    justification: r.justification ?? [],
    implication: r.implication ?? [],
    sources: toDoc(r.sources),
  };
}

const rulesById = (ids: Iterable<string>): RuleView[] => {
  const out: RuleView[] = [];
  for (const id of ids) {
    const r = DESIGN_RULES[id];
    if (r) out.push(ruleView(r));
  }
  return out;
};

const consequenceView = (c: DesignConsequence): ConsequenceView => ({
  kind: c.kind,
  text: c.text,
  quote: c.quote,
  paraphrased: c.paraphrased === true,
  ...(c.openQuestion !== undefined ? { openQuestion: c.openQuestion } : {}),
  sources: toDoc(c.sources),
});

/** Rule IDs named in an issue message (model messages cite the rule they deviate from). */
const RULE_ID_RE = /VCF-[A-Z0-9]+(?:-[A-Z0-9]+)*-(?:REQD|RCMD|RECD)-[A-Z0-9]+-\d{3}/g;

function warningView(issue: ValidationIssue, deviates: readonly string[]): OptionWarning {
  const named = (issue.message.match(RULE_ID_RE) ?? []).filter((id) => DESIGN_RULES[id]?.kind !== 'REQD');
  return { message: issue.message, specRef: issue.specRef, rules: rulesById(new Set([...deviates, ...named])) };
}

const issueKey = (i: ValidationIssue): string => `${i.code}|${i.subject ?? ''}`;

const DECISION_TITLE: ReadonlyMap<string, string> = new Map(DESIGN_DECISIONS.map((d) => [d.id, d.title]));

function issueView(i: ValidationIssue): IssueView {
  const title = i.subject !== undefined ? DECISION_TITLE.get(i.subject) : undefined;
  return {
    key: issueKey(i),
    code: i.code,
    message: i.message,
    specRef: i.specRef,
    ...(i.subject !== undefined ? { decisionId: i.subject } : {}),
    ...(title !== undefined ? { decisionTitle: title } : {}),
  };
}

function decisionView(d: DesignDecisionDef, choices: DesignChoices): DesignDecision {
  const chosen = choices[d.id];
  return {
    id: d.id,
    title: d.title,
    help: d.help,
    step: d.step,
    specRef: d.specRef,
    sources: toDoc(d.sources),
    rules: rulesById(d.rules.filter((r) => r.relation === 'applies').map((r) => r.id)),
    consequences: d.consequences.map(consequenceView),
    ...(chosen !== undefined ? { chosen } : {}),
    options: d.options.map((o): DesignOption => {
      const a = optionAvailability(d.id, o.id, choices);
      const deviates = o.rules.filter((r) => r.relation === 'deviates').map((r) => r.id);
      return {
        id: o.id,
        label: o.label,
        description: o.description,
        sources: toDoc(o.sources),
        ...(a.available ? {} : { disabledReason: a.errors[0]?.message ?? '' }),
        warnings: a.warnings.map((w) => warningView(w, deviates)),
        consequences: o.consequences.map(consequenceView),
        appliedRules: rulesById(o.rules.filter((r) => r.relation === 'applies').map((r) => r.id)),
        deviatedRules: rulesById(deviates),
        day2: o.day2 === true,
        paraphrased: o.paraphrased === true,
        openQuestions: o.openQuestions ?? [],
      };
    }),
  };
}

const isMade = (d: DesignDecisionDef, choices: DesignChoices): boolean => {
  const v = choices[d.id];
  return v !== undefined && d.options.some((o) => o.id === v);
};

/**
 * Builds the whole view of the design phase.
 * @param sel player choices (decision id -> option id)
 * @param acknowledged keys of acknowledged warnings (IssueView.key)
 */
export function loadDesignStepData(
  sel: ReadonlyMap<string, string>,
  acknowledged: ReadonlySet<string> = new Set(),
): DesignStepData {
  const choices = choicesFromMap(sel);
  const applicable = applicableDecisions(choices);
  const decisions = applicable.map((d) => decisionView(d, choices));

  const stepNums = [...new Set(DESIGN_DECISIONS.map((d) => d.step))].sort((a, b) => a - b);
  let prevComplete = true;
  const steps = stepNums.map((step): DesignStepGroup => {
    const defs = applicable.filter((d) => d.step === step);
    const complete = defs.every((d) => isMade(d, choices));
    const group: DesignStepGroup = {
      step,
      title: DESIGN_STEP_TITLES[step] ?? `Krok ${step}`,
      decisions: decisions.filter((d) => d.step === step),
      unlocked: prevComplete,
      complete,
    };
    prevComplete = prevComplete && complete;
    return group;
  });

  const all = validateDesign(choices);
  const missing = all
    .filter((i) => i.code === 'DESIGN_DECISION_MISSING')
    .map((i) => ({ id: i.subject ?? '', title: DECISION_TITLE.get(i.subject ?? '') ?? i.subject ?? '' }));
  const errors = all.filter((i) => i.severity === 'error' && i.code !== 'DESIGN_DECISION_MISSING').map(issueView);
  const warnings = all.filter((i) => i.severity === 'warning').map(issueView);
  const warningsAcknowledged = warnings.every((w) => acknowledged.has(w.key));

  const raw = summarizeDesign(choices);
  const summary: DesignSummaryView = {
    raw,
    appliedRules: rulesById(raw.appliedRules),
    deviatedRules: rulesById(raw.deviatedRules),
    dayTwo: raw.dayTwo.map((k) => ({
      ...consequenceView(k),
      decisionTitle: DECISION_TITLE.get(k.decision) ?? k.decision,
    })),
  };

  return {
    decisions,
    steps,
    summary,
    issues: { missing, errors, warnings },
    warningsAcknowledged,
    canProceed: missing.length === 0 && errors.length === 0 && warningsAcknowledged,
  };
}
