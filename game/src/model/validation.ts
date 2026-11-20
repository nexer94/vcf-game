/**
 * Shared validation result types for the VCF domain model.
 *
 * Semantics follow docs/spec/20-deployment.md §5.1 (VCF Installer validation):
 * - `warning`: "Review any warnings and either address them or click Acknowledge to proceed
 *   with deployment." -> acknowledgeable, does not block once acknowledged.
 * - `error`: "Review all failed validations and resolve the issue(s) using the remediation
 *   information provided in the error message." -> blocking until fixed and re-validated.
 *
 * NOTE (spec 20 §8 open question 7): the documentation does not publish the concrete text of
 * individual validation messages (except known issues [S31]). Messages here are descriptive,
 * not quotes, unless explicitly marked as a quote.
 */

import type { ValidationCode } from './codes';

export type { ValidationCode } from './codes';
export { VALIDATION_CODES, isValidationCode } from './codes';

/**
 * - `error` / `warning`: documented VCF Installer validation semantics (20 §5.1), see header.
 * - `recommendation`: the documentation only *recommends* something (e.g. "reserve 30 IPs", 20 §3.5 [S19])
 *   and no installer warning is documented. Non-blocking and NOT acknowledgeable: it never moves the
 *   deployment state machine to `awaiting-acknowledgement`. UI should show it as a hint, not as a
 *   VCF validation result.
 */
export type Severity = 'error' | 'warning' | 'recommendation';

/**
 * Where an issue comes from:
 * - `vcf`: modelled VCF behaviour / documented requirement (default when omitted),
 * - `game-scope`: limitation of this game's model (feature not modelled yet). It is NOT a VCF error;
 *   the UI should disable the option instead of presenting it as a validation failure.
 */
export type IssueScope = 'vcf' | 'game-scope';

export interface ValidationIssue {
  /** Stable machine code (used by engine/scenarios/scoring); registry in codes.ts. */
  readonly code: ValidationCode;
  readonly severity: Severity;
  /** Human-readable message (English, UI may localise). */
  readonly message: string;
  /** Spec reference, e.g. "20-deployment §3.2 [S9]". */
  readonly specRef: string;
  /** Object the issue relates to (FQDN, host, field path…). */
  readonly subject?: string;
  /** Omitted = 'vcf'. */
  readonly scope?: IssueScope;
}

export function issue(
  code: ValidationCode,
  severity: Severity,
  message: string,
  specRef: string,
  subject?: string,
  scope?: IssueScope,
): ValidationIssue {
  return {
    code,
    severity,
    message,
    specRef,
    ...(subject !== undefined ? { subject } : {}),
    ...(scope !== undefined && scope !== 'vcf' ? { scope } : {}),
  };
}

export const errorsOf = (issues: readonly ValidationIssue[]): ValidationIssue[] =>
  issues.filter((i) => i.severity === 'error');

export const warningsOf = (issues: readonly ValidationIssue[]): ValidationIssue[] =>
  issues.filter((i) => i.severity === 'warning');

export const recommendationsOf = (issues: readonly ValidationIssue[]): ValidationIssue[] =>
  issues.filter((i) => i.severity === 'recommendation');

/** Issues that are limitations of the game model, not VCF validation results. */
export const gameScopeOf = (issues: readonly ValidationIssue[]): ValidationIssue[] =>
  issues.filter((i) => i.scope === 'game-scope');

export const hasErrors = (issues: readonly ValidationIssue[]): boolean =>
  issues.some((i) => i.severity === 'error');

/** Result of a state-machine transition attempt. Pure: never mutates the input. */
export type TransitionResult<S> =
  | { readonly ok: true; readonly state: S }
  | { readonly ok: false; readonly error: ValidationIssue };
