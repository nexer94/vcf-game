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

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  /** Stable machine code (used by engine/scenarios/scoring). */
  readonly code: string;
  readonly severity: Severity;
  /** Human-readable message (English, UI may localise). */
  readonly message: string;
  /** Spec reference, e.g. "20-deployment §3.2 [S9]". */
  readonly specRef: string;
  /** Object the issue relates to (FQDN, host, field path…). */
  readonly subject?: string;
}

export function issue(
  code: string,
  severity: Severity,
  message: string,
  specRef: string,
  subject?: string,
): ValidationIssue {
  return subject === undefined
    ? { code, severity, message, specRef }
    : { code, severity, message, specRef, subject };
}

export const errorsOf = (issues: readonly ValidationIssue[]): ValidationIssue[] =>
  issues.filter((i) => i.severity === 'error');

export const warningsOf = (issues: readonly ValidationIssue[]): ValidationIssue[] =>
  issues.filter((i) => i.severity === 'warning');

export const hasErrors = (issues: readonly ValidationIssue[]): boolean =>
  issues.some((i) => i.severity === 'error');

/** Result of a state-machine transition attempt. Pure: never mutates the input. */
export type TransitionResult<S> =
  | { readonly ok: true; readonly state: S }
  | { readonly ok: false; readonly error: ValidationIssue };
