/**
 * View model of the computer app "Návrh VCF" (UX.md §11.3) – pure, no DOM.
 *
 * Two sources, one shape:
 *  - session snapshot: snapshot.design (decisions, issues, warnings, summary) + snapshot.hw.options
 *    (model optionAvailabilityWithHardware: HW status, reasons, unlock actions, documented requirements),
 *  - local fallback (demo room): designData.loadDesignStepData (model, no hardware context).
 * Nothing VCF-specific is decided here: availability, reasons and numbers come from the model; the only
 * additions are Czech UI labels (tile status, unlock button text) and the step headings of designData.
 */
import { docRefOf, type DesignSummary, type UnlockAction, type ValidationIssue } from '../../model';
import type { SandboxSnapshot } from '../../modes/sandbox/snapshot';
import { DESIGN_STEP_TITLES, type DesignStepData, type DocRef } from '../sandbox/designData';

export type TileStatus = 'done' | 'warn' | 'error' | 'hw' | 'pending';

export const TILE_STATUS: Readonly<Record<TileStatus, { readonly icon: string; readonly label: string }>> = {
  done: { icon: '✓', label: 'hotovo' },
  warn: { icon: '⚠', label: 'hotovo – odchylka od doporučení' },
  error: { icon: '⛔', label: 'chyba podle dokumentace' },
  hw: { icon: '✖', label: 'blokováno hardwarem' },
  pending: { icon: '○', label: 'čeká' },
};

export interface PcIssue {
  readonly code: string;
  readonly message: string;
  readonly specRef: string;
  readonly key?: string;
}

export interface PcRule {
  readonly id: string;
  readonly kind: 'REQD' | 'RCMD' | 'RECD';
  readonly text: string;
  readonly quote: boolean;
  readonly relation: 'applies' | 'deviates';
  readonly sources: readonly DocRef[];
}

export interface PcConsequence {
  readonly kind: string;
  readonly text: string;
  readonly quote: boolean;
  readonly paraphrased: boolean;
  readonly openQuestion?: string;
  readonly sources: readonly DocRef[];
}

export interface PcUnlock {
  readonly text: string;
  /** Where the button takes the player (game navigation). */
  readonly target: 'shop-servers' | 'room';
}

export interface PcHwReason {
  readonly issue: PcIssue;
  readonly unlock?: PcUnlock;
}

export interface PcHw {
  readonly status: 'no-hardware-yet' | 'ok' | 'insufficient' | 'not-hw-dependent';
  readonly errors: readonly PcHwReason[];
  readonly warnings: readonly PcHwReason[];
  /** Documented requirements; `met` null = nothing bought yet (neutral, UX §3.1). */
  readonly requirements: readonly { readonly issue: PcIssue; readonly met: boolean | null }[];
}

export interface PcOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly selected: boolean;
  readonly available: boolean;
  /** Model errors that make the option unavailable (not HW). */
  readonly errors: readonly PcIssue[];
  readonly hw?: PcHw;
  /** RCMD deviations (acknowledgeable). */
  readonly warnings: readonly PcIssue[];
  readonly rules: readonly PcRule[];
  readonly consequences: readonly PcConsequence[];
  readonly sources: readonly DocRef[];
  /** Consequences of kind 'irreversible' (badge "Nevratné" + confirmation text). */
  readonly irreversible: readonly PcConsequence[];
  /** ★ only with support in the spec: positive recommendation consequences / applied RCMD rules. */
  readonly recommended: readonly string[];
  readonly day2: boolean;
  readonly paraphrased: boolean;
  readonly openQuestions: readonly string[];
}

export interface PcDecision {
  readonly id: string;
  readonly step: number;
  readonly title: string;
  readonly help?: string;
  readonly specRef: string;
  readonly sources: readonly DocRef[];
  readonly rules: readonly PcRule[];
  readonly consequences: readonly PcConsequence[];
  readonly chosen?: string;
  readonly chosenLabel?: string;
  readonly status: TileStatus;
  /** Earlier step not finished yet (guided order of designData – a hint, nothing is locked). */
  readonly afterStep?: number;
  readonly errors: readonly PcIssue[];
  /** Options greyed by hardware. */
  readonly hwLimited: number;
  readonly options: readonly PcOption[];
}

export interface PcWarning extends PcIssue {
  readonly key: string;
  readonly acknowledged: boolean;
  readonly decisionId?: string;
}

export interface PcDesignModel {
  readonly source: 'session' | 'local';
  readonly decisions: readonly PcDecision[];
  readonly steps: readonly { readonly step: number; readonly title: string }[];
  readonly done: number;
  readonly total: number;
  readonly hw?: { readonly hostCount: number; readonly vendors: readonly string[]; readonly minNicPorts: number; readonly esaEligible: number };
  readonly errors: readonly (PcIssue & { readonly decisionId?: string })[];
  readonly warnings: readonly PcWarning[];
  readonly gateOk: boolean;
  readonly summary?: DesignSummary;
}

const MISSING = 'DESIGN_DECISION_MISSING';
const pcIssue = (i: ValidationIssue): PcIssue => ({ code: i.code, message: i.message, specRef: i.specRef });
const issueKey = (i: ValidationIssue): string => `${i.code}|${i.subject ?? ''}`;
const docs = (s: readonly { readonly title: string; readonly url: string }[]): DocRef[] => s.map(({ title, url }) => ({ title, url }));

const plural = (n: number, one: string, few: string, many: string): string => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

/** Czech button text for a model unlock action (game UI label; numbers from the model). */
export function unlockOf(u: UnlockAction): PcUnlock {
  switch (u.kind) {
    case 'buy-hosts':
      return { text: `Kup ještě ${u.count} ${plural(u.count, 'server', 'servery', 'serverů')}`, target: 'shop-servers' };
    case 'add-nic-ports':
      return { text: `Přidej NIC porty – min. ${u.minPortsPerHost} na server (${u.hostIds.join(', ')})`, target: 'room' };
    case 'fix-host-config':
      return { text: `Uprav konfiguraci serverů ${u.hostIds.join(', ')}`, target: 'room' };
    case 'add-fc-hba':
      return { text: `Přidej FC HBA do ${u.hostIds.join(', ')}`, target: 'room' };
    case 'use-single-vendor':
      return { text: `Ponech servery jen od jednoho vendora (teď: ${u.vendors.join(', ')})`, target: 'room' };
  }
}

const NEGATIVE = /\bnot recommended\b|nedoporuč/i;
/** ★ texts: positive documented recommendations of the option itself (never a game rating). */
export function recommendationsOf(rules: readonly PcRule[], cons: readonly PcConsequence[]): string[] {
  return [
    ...cons.filter((c) => c.kind === 'recommendation' && !NEGATIVE.test(c.text)).map((c) => c.text),
    ...rules.filter((r) => r.relation === 'applies' && r.kind !== 'REQD').map((r) => `uplatňuje doporučení ${r.id}`),
  ];
}

function statusOf(chosen: boolean, chosenAvailable: boolean, errors: number, warnings: number, options: readonly PcOption[]): TileStatus {
  if (errors > 0 || (chosen && !chosenAvailable)) return 'error';
  if (chosen) return warnings > 0 ? 'warn' : 'done';
  if (options.length > 0 && options.every((o) => !o.available) && options.some((o) => o.hw?.status === 'insufficient')) return 'hw';
  return 'pending';
}

function withSteps(decisions: (Omit<PcDecision, 'afterStep'> & { afterStep?: number })[]): { decisions: PcDecision[]; steps: { step: number; title: string }[] } {
  const stepNums = [...new Set(decisions.map((d) => d.step))].sort((a, b) => a - b);
  let firstOpen: number | undefined;
  for (const s of stepNums) {
    if (decisions.filter((d) => d.step === s).some((d) => d.chosen === undefined)) {
      firstOpen = s;
      break;
    }
  }
  return {
    decisions: decisions.map((d) => (firstOpen !== undefined && d.step > firstOpen ? { ...d, afterStep: firstOpen } : d)),
    steps: stepNums.map((step) => ({ step, title: DESIGN_STEP_TITLES[step] ?? `Krok ${step}` })),
  };
}

/** Session snapshot -> view model. */
export function pcDesignFromSnapshot(snap: SandboxSnapshot): PcDesignModel {
  const d = snap.design;
  const hwOpts = snap.hw.options;
  const raw = d.decisions.map((dv) => {
    const options: PcOption[] = dv.options.map((o) => {
      const hwa = hwOpts[dv.id]?.[o.id];
      const rules: PcRule[] = o.rules.map((r) => ({ id: r.id, kind: r.kind, text: r.text, quote: r.paraphrased !== true, relation: r.relation, sources: r.sources.map(docRefOf) }));
      const consequences: PcConsequence[] = o.consequences.map((c) => ({ kind: c.kind, text: c.text, quote: c.quote, paraphrased: c.paraphrased === true, ...(c.openQuestion ? { openQuestion: c.openQuestion } : {}), sources: docs(c.sourceRefs) }));
      let hw: PcHw | undefined;
      if (hwa) {
        const h = hwa.hardware;
        const errs = h.errors.map((r) => ({ issue: pcIssue(r.issue), ...(r.unlock ? { unlock: unlockOf(r.unlock) } : {}) }));
        hw = {
          status: h.status,
          errors: errs,
          warnings: h.warnings.map((r) => ({ issue: pcIssue(r.issue), ...(r.unlock ? { unlock: unlockOf(r.unlock) } : {}) })),
          requirements: h.requirements.map((q) => ({ issue: pcIssue(q), met: h.status === 'no-hardware-yet' ? null : !h.errors.some((e) => e.issue.code === q.code && e.issue.message === q.message) })),
        };
      }
      return {
        id: o.id,
        label: o.label,
        ...(o.description ? { description: o.description } : {}),
        selected: o.selected,
        available: o.available && (hwa ? hwa.available : true),
        errors: o.errors.map(pcIssue),
        ...(hw ? { hw } : {}),
        warnings: o.warnings.map((w) => ({ ...pcIssue(w), key: issueKey(w) })),
        rules,
        consequences,
        sources: docs(o.sources),
        irreversible: consequences.filter((c) => c.kind === 'irreversible'),
        recommended: recommendationsOf(rules, consequences),
        day2: o.day2,
        paraphrased: o.paraphrased,
        openQuestions: o.openQuestions,
      };
    });
    const chosenOpt = options.find((o) => o.id === dv.selected);
    const errors = dv.issues.errors.filter((i) => i.code !== MISSING).map(pcIssue);
    return {
      id: dv.id,
      step: dv.step,
      title: dv.title,
      help: dv.help,
      specRef: dv.specRef,
      sources: docs(dv.sources),
      rules: dv.rules.map((r) => ({ id: r.id, kind: r.kind, text: r.text, quote: r.paraphrased !== true, relation: r.relation, sources: r.sources.map(docRefOf) })),
      consequences: dv.consequences.map((c) => ({ kind: c.kind, text: c.text, quote: c.quote, paraphrased: c.paraphrased === true, ...(c.openQuestion ? { openQuestion: c.openQuestion } : {}), sources: docs(c.sourceRefs) })),
      ...(chosenOpt ? { chosen: chosenOpt.id, chosenLabel: chosenOpt.label } : {}),
      status: statusOf(!!chosenOpt, chosenOpt?.available ?? true, errors.length, dv.issues.warnings.length, options),
      errors,
      hwLimited: options.filter((o) => o.hw?.status === 'insufficient').length,
      options,
    };
  });
  const { decisions, steps } = withSteps(raw);
  const ack = new Set(d.acknowledgedWarningKeys);
  const ctx = snap.hw.context;
  return {
    source: 'session',
    decisions,
    steps,
    done: decisions.filter((x) => x.chosen !== undefined).length,
    total: decisions.length,
    hw: { hostCount: ctx.hostCount, vendors: ctx.vendors, minNicPorts: ctx.minNicPorts, esaEligible: ctx.esaEligibleHostIds.length },
    errors: d.issues.errors.filter((i) => i.code !== MISSING).map((i) => ({ ...pcIssue(i), ...(i.subject ? { decisionId: i.subject } : {}) })),
    warnings: d.warnings.map((w) => ({ ...pcIssue(w.issue), key: w.key, acknowledged: w.acknowledged || ack.has(w.key), ...(w.issue.subject ? { decisionId: w.issue.subject } : {}) })),
    gateOk: d.gate.ok,
    summary: d.summary,
  };
}

/** Local fallback (demo room, no session): designData over the model, no hardware context. */
export function pcDesignFromLocal(data: DesignStepData, acknowledged: ReadonlySet<string>): PcDesignModel {
  const raw = data.decisions.map((dd) => {
    const options: PcOption[] = dd.options.map((o) => {
      const rules: PcRule[] = [
        ...o.appliedRules.map((r) => ({ id: r.id, kind: r.kind, text: r.text, quote: r.quote, relation: 'applies' as const, sources: r.sources })),
        ...o.deviatedRules.map((r) => ({ id: r.id, kind: r.kind, text: r.text, quote: r.quote, relation: 'deviates' as const, sources: r.sources })),
      ];
      const consequences: PcConsequence[] = o.consequences.map((c) => ({ kind: c.kind, text: c.text, quote: c.quote, paraphrased: c.paraphrased, ...(c.openQuestion ? { openQuestion: c.openQuestion } : {}), sources: c.sources }));
      return {
        id: o.id,
        label: o.label,
        ...(o.description ? { description: o.description } : {}),
        selected: dd.chosen === o.id,
        available: o.disabledReason === undefined,
        errors: o.disabledReason ? [{ code: '', message: o.disabledReason, specRef: dd.specRef }] : [],
        warnings: o.warnings.map((w) => ({ code: '', message: w.message, specRef: w.specRef })),
        rules,
        consequences,
        sources: o.sources,
        irreversible: consequences.filter((c) => c.kind === 'irreversible'),
        recommended: recommendationsOf(rules, consequences),
        day2: o.day2,
        paraphrased: o.paraphrased,
        openQuestions: o.openQuestions,
      };
    });
    const chosenOpt = options.find((o) => o.id === dd.chosen);
    const errors = data.issues.errors.filter((e) => e.decisionId === dd.id).map((e) => ({ code: e.code, message: e.message, specRef: e.specRef }));
    const warns = data.issues.warnings.filter((w) => w.decisionId === dd.id).length;
    return {
      id: dd.id,
      step: dd.step,
      title: dd.title,
      ...(dd.help ? { help: dd.help } : {}),
      specRef: dd.specRef,
      sources: dd.sources,
      rules: dd.rules.map((r) => ({ id: r.id, kind: r.kind, text: r.text, quote: r.quote, relation: 'applies' as const, sources: r.sources })),
      consequences: dd.consequences.map((c) => ({ kind: c.kind, text: c.text, quote: c.quote, paraphrased: c.paraphrased, ...(c.openQuestion ? { openQuestion: c.openQuestion } : {}), sources: c.sources })),
      ...(chosenOpt ? { chosen: chosenOpt.id, chosenLabel: chosenOpt.label } : {}),
      status: statusOf(!!chosenOpt, chosenOpt?.available ?? true, errors.length, warns, options),
      errors,
      hwLimited: 0,
      options,
    };
  });
  const { decisions, steps } = withSteps(raw);
  return {
    source: 'local',
    decisions,
    steps,
    done: decisions.filter((x) => x.chosen !== undefined).length,
    total: decisions.length,
    errors: data.issues.errors.map((e) => ({ code: e.code, message: e.message, specRef: e.specRef, ...(e.decisionId ? { decisionId: e.decisionId } : {}) })),
    warnings: data.issues.warnings.map((w) => ({ code: w.code, message: w.message, specRef: w.specRef, key: w.key, acknowledged: acknowledged.has(w.key), ...(w.decisionId ? { decisionId: w.decisionId } : {}) })),
    gateOk: data.canProceed,
    summary: data.summary.raw,
  };
}
