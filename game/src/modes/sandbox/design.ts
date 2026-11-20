/**
 * Design phase helpers: the design gate and the decision/option view for the UI.
 * Everything is computed by the model (validateDesign, deriveBringupParams, optionAvailability,
 * validateRedesign, summarizeDesign); this file only assembles it.
 */
import {
  type DeriveResult,
  type DesignBringupParams,
  type DesignChoices,
  type DesignConsequence,
  type DesignContext,
  type DesignDecisionDef,
  type DesignDecisionId,
  type DesignRule,
  type DesignRuleRef,
  type DesignSourceId,
  type ValidationIssue,
  DESIGN_RULES,
  DESIGN_SOURCES,
  applicableDecisions,
  deriveBringupParams,
  errorsOf,
  gameScopeOf,
  optionAvailability,
  recommendationsOf,
  validateDesign,
  validateRedesign,
  warningsOf,
} from '../../model';
import { issueKey } from './wizard';

/**
 * Model issues grouped by the model's own severity / scope. Issue objects are passed through unchanged
 * (incl. `scope` and any flags the model adds later) – nothing is reinterpreted here.
 */
export interface IssueGroups {
  /** severity 'error' (blocking). Includes game-scope errors – see `gameScope`. */
  readonly errors: readonly ValidationIssue[];
  /** severity 'warning' (acknowledgeable, 20 §5.1). */
  readonly warnings: readonly ValidationIssue[];
  /** severity 'recommendation': documented recommendation only, non-blocking, not acknowledgeable. */
  readonly recommendations: readonly ValidationIssue[];
  /** Subset of all issues with scope 'game-scope' (game limitation, not a VCF error). */
  readonly gameScope: readonly ValidationIssue[];
}

export function groupIssues(issues: readonly ValidationIssue[]): IssueGroups {
  return { errors: errorsOf(issues), warnings: warningsOf(issues), recommendations: recommendationsOf(issues), gameScope: gameScopeOf(issues) };
}

export const EMPTY_ISSUE_GROUPS: IssueGroups = { errors: [], warnings: [], recommendations: [], gameScope: [] };

export interface DesignGate {
  /** True = the player may leave the design phase (no errors, every warning acknowledged). */
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly errors: readonly ValidationIssue[];
  readonly unacknowledgedWarnings: readonly ValidationIssue[];
  readonly derive: DeriveResult;
}

/**
 * Gate design -> planning. Uses only model validation: validateDesign (via deriveBringupParams).
 * Warnings (RCMD deviations, documentation discrepancies, limitations) must be acknowledged.
 */
export function designGate(choices: DesignChoices, acknowledged: readonly string[], context: DesignContext): DesignGate {
  const issues = validateDesign(choices, context);
  const derive = deriveBringupParams(choices, context);
  const errors = errorsOf(issues);
  const ack = new Set(acknowledged);
  const unacknowledgedWarnings = warningsOf(issues).filter((w) => !ack.has(issueKey(w)));
  return { ok: errors.length === 0 && unacknowledgedWarnings.length === 0 && derive.ok, issues, errors, unacknowledgedWarnings, derive };
}

export const derivedParamsOf = (gate: DesignGate): DesignBringupParams | undefined => (gate.derive.ok ? gate.derive.params : undefined);

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export interface SourceRef {
  readonly id: DesignSourceId;
  readonly title: string;
  readonly url: string;
}

export const sourceRefs = (ids: readonly DesignSourceId[]): SourceRef[] =>
  ids.map((id) => ({ id, title: DESIGN_SOURCES[id].title, url: DESIGN_SOURCES[id].url }));

export interface RuleView extends DesignRule {
  readonly relation: DesignRuleRef['relation'];
}

const ruleViews = (refs: readonly DesignRuleRef[]): RuleView[] =>
  refs.flatMap((r) => {
    const rule = DESIGN_RULES[r.id];
    return rule ? [{ ...rule, relation: r.relation }] : [];
  });

export interface ConsequenceView extends DesignConsequence {
  readonly sourceRefs: readonly SourceRef[];
}

const consequenceViews = (cs: readonly DesignConsequence[]): ConsequenceView[] => cs.map((c) => ({ ...c, sourceRefs: sourceRefs(c.sources) }));

export interface DesignOptionView {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly sources: readonly SourceRef[];
  readonly rules: readonly RuleView[];
  readonly consequences: readonly ConsequenceView[];
  readonly day2: boolean;
  readonly paraphrased: boolean;
  readonly openQuestions: readonly string[];
  readonly selected: boolean;
  /** False when choosing it yields an error on this decision (model optionAvailability / validateRedesign). */
  readonly available: boolean;
  /** Errors that make it unavailable (reasons for the UI). */
  readonly errors: readonly ValidationIssue[];
  /** RCMD deviations the player could accept. */
  readonly warnings: readonly ValidationIssue[];
}

export interface DesignDecisionView {
  readonly id: DesignDecisionId;
  readonly step: DesignDecisionDef['step'];
  readonly title: string;
  readonly help: string;
  readonly scope: DesignDecisionDef['scope'];
  readonly specRef: string;
  readonly sources: readonly SourceRef[];
  readonly rules: readonly RuleView[];
  readonly consequences: readonly ConsequenceView[];
  readonly selected?: string;
  /** Current issues of this decision (subject === decision id), grouped. */
  readonly issues: IssueGroups;
  readonly options: readonly DesignOptionView[];
}

export function decisionViews(
  choices: DesignChoices,
  issues: readonly ValidationIssue[],
  context: DesignContext,
  deployedChoices: DesignChoices | undefined,
): DesignDecisionView[] {
  return applicableDecisions(choices).map((def) => {
    const selected = choices[def.id];
    const options = def.options.map((o): DesignOptionView => {
      const av = optionAvailability(def.id, o.id, choices, context);
      const redesign = deployedChoices ? validateRedesign(deployedChoices, { ...choices, [def.id]: o.id }, 'deployed').filter((i) => i.subject === def.id) : [];
      const errors = [...av.errors, ...errorsOf(redesign)];
      return {
        id: o.id,
        label: o.label,
        description: o.description,
        sources: sourceRefs(o.sources),
        rules: ruleViews(o.rules),
        consequences: consequenceViews(o.consequences),
        day2: o.day2 === true,
        paraphrased: o.paraphrased === true,
        openQuestions: o.openQuestions ?? [],
        selected: selected === o.id,
        available: errors.length === 0,
        errors,
        warnings: av.warnings,
      };
    });
    return {
      id: def.id,
      step: def.step,
      title: def.title,
      help: def.help,
      scope: def.scope,
      specRef: def.specRef,
      sources: sourceRefs(def.sources),
      rules: ruleViews(def.rules),
      consequences: consequenceViews(def.consequences),
      ...(selected !== undefined ? { selected } : {}),
      issues: groupIssues(issues.filter((i) => i.subject === def.id)),
      options,
    };
  });
}

/**
 * Structural equivalent of the UI's `DesignStepData` (game/src/ui/sandbox/designStep.ts) – the mode
 * layer must not import ui, so the shape is repeated here; TypeScript checks compatibility at the
 * call site in ui.
 */
export interface DesignStepDataShape {
  readonly decisions: readonly {
    readonly id: string;
    readonly title: string;
    readonly help?: string;
    readonly sources: readonly { readonly title: string; readonly url: string }[];
    readonly options: readonly {
      readonly id: string;
      readonly label: string;
      readonly description?: string;
      readonly sources: readonly { readonly title: string; readonly url: string }[];
      readonly illustrative?: boolean;
      readonly disabledReason?: string;
    }[];
  }[];
}

/** Maps the decision views to the UI's DesignStepData. disabledReason = model error messages. */
export function designStepDataOf(decisions: readonly DesignDecisionView[]): DesignStepDataShape {
  return {
    decisions: decisions.map((d) => ({
      id: d.id,
      title: d.title,
      help: d.help,
      sources: d.sources.map(({ title, url }) => ({ title, url })),
      options: d.options.map((o) => ({
        id: o.id,
        label: o.label,
        description: o.description,
        sources: o.sources.map(({ title, url }) => ({ title, url })),
        ...(o.available ? {} : { disabledReason: o.errors.map((e) => e.message).join(' ') }),
      })),
    })),
  };
}
