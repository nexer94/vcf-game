/**
 * Neutral progress + "why can't I continue" for the design phase (UX.md §2.7, §3.2).
 * Pure (no DOM). Undecided decisions are progress, not errors; only real
 * validation errors from the model are errors.
 */
import type { DesignStepData } from './designData';

export interface DesignProgress {
  /** Applicable decisions already made. */
  readonly done: number;
  /** Applicable decisions in total (depends on earlier choices). */
  readonly total: number;
  /** First undecided decision in guided order (for "Další: …" links). */
  readonly next?: { readonly id: string; readonly title: string };
}

export type ProceedBlock =
  | { readonly kind: 'errors'; readonly count: number }
  | { readonly kind: 'missing'; readonly count: number; readonly next?: { readonly id: string; readonly title: string } }
  | { readonly kind: 'warnings'; readonly count: number };

export function designProgress(data: DesignStepData): DesignProgress {
  const total = data.decisions.length;
  const done = data.decisions.filter((d) => d.chosen !== undefined).length;
  const firstUndecided = data.steps.flatMap((s) => s.decisions).find((d) => d.chosen === undefined);
  return {
    done,
    total,
    ...(firstUndecided ? { next: { id: firstUndecided.id, title: firstUndecided.title } } : {}),
  };
}

/** Why "Pokračovat" is disabled (null = can proceed). Errors first, then missing, then warnings. */
export function proceedBlock(data: DesignStepData, acknowledged: ReadonlySet<string>): ProceedBlock | null {
  if (data.canProceed) return null;
  const { errors, missing, warnings } = data.issues;
  if (errors.length) return { kind: 'errors', count: errors.length };
  if (missing.length) {
    const p = designProgress(data);
    return { kind: 'missing', count: missing.length, ...(p.next ? { next: p.next } : {}) };
  }
  const pending = warnings.filter((w) => !acknowledged.has(w.key)).length;
  return { kind: 'warnings', count: pending };
}

/** Czech UI sentence for a block (no VCF facts). */
export function proceedBlockText(b: ProceedBlock): string {
  switch (b.kind) {
    case 'errors':
      return `Nejdřív oprav ${b.count === 1 ? 'chybu' : `chyby (${b.count})`} podle dokumentace.`;
    case 'missing':
      return `Zbývá rozhodnout ${b.count}${b.next ? ` – další: ${b.next.title}` : ''}.`;
    case 'warnings':
      return `Potvrď ${b.count === 1 ? 'varování' : `varování (${b.count})`} (Acknowledge), nebo návrh uprav.`;
  }
}

/** Step to open in the accordion: the first unlocked, incomplete step (or the last step). */
export function currentStep(data: DesignStepData): number | undefined {
  const s = data.steps.find((g) => g.unlocked && !g.complete) ?? data.steps[data.steps.length - 1];
  return s?.step;
}
