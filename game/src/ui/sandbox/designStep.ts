import { drawDesignPreview, type DesignPreviewData } from '../../render/designPreview';
import { button, docLink, h } from '../dom';
import { badge, badgeLegend, chip, message } from '../messages';
import type {
  ConsequenceView,
  DesignDecision,
  DesignOption,
  DesignStepData,
  DesignStepGroup,
  DocRef,
  IssueView,
  OptionWarning,
  RuleView,
} from './designData';
import { currentStep, designProgress, proceedBlock, proceedBlockText } from './designProgress';

/**
 * "Návrh" (design) phase view. Renders only what designData.ts derives from the
 * model (game/src/model/design.ts); no VCF facts are written here. Czech strings
 * are UI labels (kinds of consequences, section headings, hints).
 *
 * Layout (UX.md §2.7): neutral progress "Hotovo X / N" on top, one step open at a
 * time (accordion), decided steps collapse to one line with the chosen options.
 * Errors (red) only for real model validation errors; undecided = progress.
 */
export type { DocRef } from './designData';

export interface DesignStepProps {
  readonly data: DesignStepData;
  /** Player intent; forwarded to the state port (later an engine command). */
  onSelect(decisionId: string, optionId: string): void;
  onAcknowledge(keys: readonly string[]): void;
  onProceed(): void;
  /** Persistent view state across re-renders (open/closed detail panels, open step). */
  readonly view: DesignViewState;
  /** Optional notice shown above the steps (e.g. a game-limitation message). */
  readonly notice?: Node;
  /** Label of the proceed button. */
  readonly proceedLabel?: string;
}

export interface DesignViewState {
  readonly details: Map<string, boolean>;
  /** Step open in the accordion; undefined = follow the current step, null = all closed. */
  openStep: number | null | undefined;
  /** Current step at the last render (to auto-advance when a step gets completed). */
  lastCurrent: number | undefined;
}

export const createDesignViewState = (): DesignViewState => ({ details: new Map(), openStep: undefined, lastCurrent: undefined });

/** Kept for callers; the label itself lives in messages.ts (BADGES.paraphrase). */
export const PARAPHRASE_LABEL = 'parafráze';

const KIND_LABEL: Readonly<Record<ConsequenceView['kind'], string>> = {
  benefit: 'Výhoda',
  implication: 'Důsledek',
  requirement: 'Požadavek',
  recommendation: 'Doporučení',
  hardware: 'Hardware',
  day2: 'Day 2',
  irreversible: 'Nevratné',
  limit: 'Limit',
};

const RULE_KIND_LABEL: Readonly<Record<RuleView['kind'], string>> = {
  REQD: 'požadavek',
  RCMD: 'doporučení',
  RECD: 'doporučení',
};

const sourceList = (sources: readonly DocRef[]): HTMLElement | null =>
  sources.length === 0
    ? null
    : h('span', { class: 'sources' }, 'Zdroj: ', ...sources.flatMap((s, i) => [i ? ', ' : '', docLink(s.title, s.url)]));

const paraBadge = (): HTMLElement => badge('paraphrase');
const openQBadge = (ref: string): HTMLElement => badge('unverified', ref);

/** English quote from the docs, marked as a citation. */
const quote = (text: string): HTMLElement =>
  h('q', { class: 'cite', lang: 'en', title: 'Citace z dokumentace (anglicky)' }, text);

const quotes = (texts: readonly string[]): (Node | string)[] => texts.flatMap((t, i) => (i ? [' ', quote(t)] : [quote(t)]));

function textOf(text: string, isQuote: boolean): HTMLElement {
  return isQuote ? quote(text) : h('span', null, text);
}

function consequenceItem(c: ConsequenceView): HTMLElement {
  return h('li', { class: `conseq conseq-${c.kind}` },
    h('span', { class: 'conseq-kind' }, KIND_LABEL[c.kind]),
    h('span', { class: 'conseq-body' },
      textOf(c.text, c.quote),
      c.paraphrased ? paraBadge() : null,
      c.openQuestion ? openQBadge(c.openQuestion) : null,
      ' ',
      sourceList(c.sources),
    ),
  );
}

function ruleItem(r: RuleView): HTMLElement {
  return h('li', { class: 'rule' },
    h('span', { class: 'rule-head' },
      h('code', { class: 'rule-id' }, r.id),
      h('span', { class: `rule-kind rule-${r.kind}` }, RULE_KIND_LABEL[r.kind]),
      r.paraphrased ? paraBadge() : null,
      r.truncated ? chip('zkráceno', 'badge-muted', 'Text pravidla je ve specifikaci zkrácený („…“).') : null,
    ),
    h('span', { class: 'rule-text' }, textOf(r.text, r.quote)),
    r.justification.length
      ? h('span', { class: 'rule-sub' }, h('strong', null, 'Zdůvodnění: '), ...quotes(r.justification))
      : null,
    r.implication.length
      ? h('span', { class: 'rule-sub' }, h('strong', null, 'Důsledek: '), ...quotes(r.implication))
      : null,
    sourceList(r.sources),
  );
}

function warningBox(w: OptionWarning): HTMLElement {
  return message({
    type: 'vcf-warning',
    compact: true,
    body: [
      w.rules.length ? h('ul', { class: 'rule-list' }, ...w.rules.map(ruleItem)) : null,
      h('div', { class: 'issue-msg', lang: 'en', title: 'Popisná hláška modelu (ne citace)' }, w.message),
    ],
    reference: `Spec: ${w.specRef}`,
  });
}

function details(view: DesignViewState, key: string, defaultOpen: boolean, summary: string, ...body: (Node | null)[]): HTMLElement {
  const el = h('details', { class: 'more', open: view.details.get(key) ?? defaultOpen }, h('summary', null, summary), ...body);
  el.addEventListener('toggle', () => view.details.set(key, (el as HTMLDetailsElement).open));
  return el;
}

function optionEl(d: DesignDecision, o: DesignOption, props: DesignStepProps): HTMLElement {
  const chosen = d.chosen === o.id;
  const disabled = o.disabledReason !== undefined;
  const reasonId = disabled ? `why-${d.id}-${o.id}` : undefined;
  const input = h('input', {
    type: 'radio',
    name: `design-${d.id}`,
    value: o.id,
    checked: chosen,
    // A chosen-but-now-invalid option stays enabled so the state is visible.
    disabled: disabled && !chosen,
    'data-fk': `opt:${d.id}:${o.id}`,
    ...(reasonId ? { 'aria-describedby': reasonId } : {}),
  });
  input.addEventListener('change', () => props.onSelect(d.id, o.id));
  const nMore = o.consequences.length + o.appliedRules.length;
  const irreversible = o.consequences.some((c) => c.kind === 'irreversible');
  return h('div', { class: `option${chosen ? ' chosen' : ''}${disabled ? ' blocked' : ''}` },
    h('label', { class: 'option-main' },
      input,
      h('span', { class: 'option-body' },
        h('span', { class: 'option-title' },
          o.label,
          irreversible ? badge('irreversible') : null,
          o.day2 ? badge('day2') : null,
          o.paraphrased ? paraBadge() : null,
          ...o.openQuestions.map(openQBadge),
          o.illustrative ? badge('illustrative') : null,
          o.warnings.length ? chip('⚠ varování', 'badge-warn', 'Volba se odchyluje od doporučení dokumentace – před pokračováním ji potvrdíš.') : null,
        ),
        o.description ? h('span', { class: 'option-desc' }, o.description) : null,
        o.disabledReason
          ? h('span', { class: 'option-blocked', id: reasonId },
              h('span', { 'aria-hidden': 'true' }, '✖ '), 'Nelze: ', h('span', { lang: 'en' }, o.disabledReason))
          : null,
      ),
    ),
    h('div', { class: 'option-extra' },
      ...o.warnings.map(warningBox),
      nMore
        ? details(props.view, `opt:${d.id}:${o.id}`, false, `Důsledky a pravidla (${nMore})`,
            o.consequences.length ? h('ul', { class: 'conseq-list' }, ...o.consequences.map(consequenceItem)) : null,
            o.appliedRules.length ? h('div', { class: 'sub-h' }, 'Pravidla designu, která volba uplatňuje') : null,
            o.appliedRules.length ? h('ul', { class: 'rule-list' }, ...o.appliedRules.map(ruleItem)) : null,
          )
        : null,
      sourceList(o.sources),
    ),
  );
}

function errorMessage(i: IssueView, fix?: () => void): HTMLElement {
  return message({
    type: 'vcf-error',
    compact: true,
    body: h('span', { lang: 'en', title: 'Popisná hláška modelu (ne citace)' }, i.message),
    reference: `${i.code} · Spec: ${i.specRef}`,
    actions: fix ? [button('Opravit', fix, { class: 'btn btn-small' })] : [],
  });
}

function decisionEl(d: DesignDecision, props: DesignStepProps): HTMLElement {
  const errs = props.data.issues.errors.filter((e) => e.decisionId === d.id);
  return h('fieldset', { class: `decision${d.chosen ? ' decided' : ''}${errs.length ? ' has-error' : ''}`, id: `dec-${d.id}` },
    h('legend', null, d.title),
    d.help ? h('p', { class: 'muted decision-help' }, d.help) : null,
    ...errs.map((e) => errorMessage(e)),
    ...d.options.map((o) => optionEl(d, o, props)),
    d.consequences.length || d.rules.length
      ? details(props.view, `dec:${d.id}`, false, `Platí pro rozhodnutí (${d.consequences.length + d.rules.length})`,
          d.consequences.length ? h('ul', { class: 'conseq-list' }, ...d.consequences.map(consequenceItem)) : null,
          d.rules.length ? h('ul', { class: 'rule-list' }, ...d.rules.map(ruleItem)) : null,
        )
      : null,
    h('div', { class: 'decision-foot' }, sourceList(d.sources), h('span', { class: 'spec-ref' }, `Spec: ${d.specRef}`)),
  );
}

const chosenLabel = (d: DesignDecision): string | undefined => d.options.find((o) => o.id === d.chosen)?.label;

function stepEl(g: DesignStepGroup, props: DesignStepProps, open: boolean, toggle: (step: number) => void): HTMLElement {
  const state = !g.unlocked ? 'locked' : g.complete ? 'complete' : 'current';
  const decided = g.decisions.filter((d) => d.chosen !== undefined).length;
  const hasError = g.decisions.some((d) => props.data.issues.errors.some((e) => e.decisionId === d.id));
  const bodyId = `dstep-body-${g.step}`;
  const status = !g.unlocked
    ? h('span', { class: 'dstep-status' }, h('span', { 'aria-hidden': 'true' }, '🔒 '), 'po předchozím kroku')
    : g.complete
      ? h('span', { class: 'dstep-status dstep-chosen' }, g.decisions.map(chosenLabel).filter(Boolean).join(' · '))
      : h('span', { class: 'dstep-status' }, `${decided} / ${g.decisions.length}`);
  const head = button(
    h('span', { class: 'dstep-head-inner' },
      h('span', { class: 'flow-num', 'aria-hidden': 'true' }, g.complete && g.unlocked ? '✓' : String(g.step)),
      h('span', { class: 'dstep-title' }, g.title),
      hasError ? h('span', { class: 'dstep-err', title: 'V kroku je chyba podle dokumentace' }, '⛔') : null,
      status,
      g.unlocked ? h('span', { class: 'dstep-caret', 'aria-hidden': 'true' }, open ? '▾' : '▸') : null,
    ),
    () => toggle(g.step),
    {
      class: 'dstep-head',
      'aria-expanded': String(open),
      'aria-controls': bodyId,
      disabled: !g.unlocked,
      'data-fk': `step:${g.step}`,
      title: !g.unlocked ? 'Nejdřív dokonči předchozí krok' : g.complete && !open ? 'Změnit volby v tomto kroku' : undefined,
    },
  );
  return h('section', { class: `dstep dstep-${state}${open ? ' open' : ''}`, 'aria-label': `Krok ${g.step}: ${g.title}` },
    h('h3', { class: 'dstep-h' }, head),
    open && g.unlocked ? h('div', { class: 'dstep-body', id: bodyId }, ...g.decisions.map((d) => decisionEl(d, props))) : null,
  );
}

// ---------------------------------------------------------------------------
// Summary + status (side column)
// ---------------------------------------------------------------------------

const UNDECIDED = 'zatím nerozhodnuto';

function row(label: string, ...value: (Node | string | null)[]): HTMLElement {
  return h('div', { class: 'sum-row' }, h('dt', null, label), h('dd', null, ...value));
}

function previewData(data: DesignStepData): DesignPreviewData {
  const s = data.summary.raw;
  const wldHosts = s.workloadDomainMinHosts ? (s.workloadDomainMinHosts.vsan ?? s.workloadDomainMinHosts.nfsOrFc) : undefined;
  const first = {
    label: 'VCF Instance 1',
    domains: s.domains.map((k) =>
      k === 'management'
        ? { kind: k, label: 'Management', hosts: s.managementDomainMinHosts }
        : { kind: k, label: 'Workload', hosts: wldHosts },
    ),
  };
  const instances = [first];
  if (s.instances === 2)
    instances.push({ label: 'VCF Instance 2', domains: [{ kind: 'management', label: 'Management', hosts: undefined }] });
  return { instances };
}

function previewEl(data: DesignStepData): HTMLElement {
  const canvas = h('canvas', { class: 'design-preview', 'aria-hidden': 'true' });
  const s = data.summary.raw;
  const fig = h('figure', { class: 'preview-fig' },
    canvas,
    h('figcaption', null,
      badge('illustrative'),
      ' Náhled topologie – domény jako „čtvrti“, počet kostiček = minimum hostů ze shrnutí',
      s.workloadDomainMinHosts ? ' (u WLD hodnota pro vSAN, pokud je známa)' : '',
      '.'),
  );
  // Draw after layout (needs no measurement – fixed size).
  queueMicrotask(() => drawDesignPreview(canvas, previewData(data), 300, 170));
  return fig;
}

function summaryEl(data: DesignStepData, props: DesignStepProps): HTMLElement {
  const s = data.summary.raw;
  const w = s.workloadDomainMinHosts;
  const nodes = s.componentNodes;
  return h('section', { class: 'side-card' },
    h('h3', null, 'Shrnutí návrhu'),
    previewEl(data),
    h('dl', { class: 'sum' },
      row('Domény', s.domains.map((d) => (d === 'management' ? 'Management domain' : 'Workload domain')).join(' + ')),
      row('VCF Instance', s.instances === undefined ? UNDECIDED : String(s.instances)),
      row('Availability zones', s.twoAvailabilityZones === undefined ? UNDECIDED : s.twoAvailabilityZones ? '2' : '1'),
      row('Min. hostů – default cluster management domain',
        s.managementDomainMinHosts === undefined ? UNDECIDED : h('strong', null, String(s.managementDomainMinHosts))),
      s.domains.includes('workload')
        ? row('Min. hostů – cluster workload domain',
            w === undefined
              ? UNDECIDED
              : [w.vsan !== undefined ? `vSAN ${w.vsan}` : null, w.nfsOrFc !== undefined ? `NFS/FC ${w.nfsOrFc}` : null].filter(Boolean).join(' · ') || 'neuvedeno',
            w ? openQBadge(w.openQuestion) : null,
            w ? h('span', { class: 'spec-ref' }, ` ${w.specRef}`) : null)
        : null,
      row('NSX Manager',
        s.nsxManagers.length === 0
          ? UNDECIDED
          : s.nsxManagers.map((n) => `${n.domain === 'management' ? 'management' : 'workload'}: ${n.nodes} ${n.nodes === 1 ? 'uzel' : 'uzly'}`).join(' · ')),
      row('VCF Operations', nodes.vcfOperations === undefined ? UNDECIDED : `${nodes.vcfOperations}×`),
      row('VCF Automation', nodes.vcfAutomation === undefined ? UNDECIDED : `${nodes.vcfAutomation}×`),
      row('VCF management services',
        nodes.managementServicesControlPlane === undefined ? UNDECIDED : `control plane ${nodes.managementServicesControlPlane}× · workers `,
        nodes.managementServicesControlPlane === undefined ? null : openQBadge(nodes.managementServicesWorkersOpenQuestion)),
    ),
    data.summary.appliedRules.length
      ? details(props.view, 'sum:applied', false, `Uplatněná pravidla designu (${data.summary.appliedRules.length})`,
          h('ul', { class: 'rule-list' }, ...data.summary.appliedRules.map(ruleItem)))
      : null,
    data.summary.deviatedRules.length
      ? details(props.view, 'sum:deviated', true, `Odchylky od doporučení (${data.summary.deviatedRules.length})`,
          h('ul', { class: 'rule-list' }, ...data.summary.deviatedRules.map(ruleItem)))
      : null,
    data.summary.dayTwo.length
      ? details(props.view, 'sum:day2', false, `Day 2 – na později (${data.summary.dayTwo.length})`,
          h('ul', { class: 'conseq-list' }, ...data.summary.dayTwo.map((k) =>
            h('li', { class: 'conseq conseq-day2' },
              h('span', { class: 'conseq-kind' }, k.decisionTitle),
              h('span', { class: 'conseq-body' }, textOf(k.text, k.quote), k.paraphrased ? paraBadge() : null,
                k.openQuestion ? openQBadge(k.openQuestion) : null, ' ', sourceList(k.sources)),
            ))))
      : null,
  );
}

function progressEl(done: number, total: number, live = false): HTMLElement {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h('div', { class: 'dprogress' },
    h('span', { class: 'dprogress-text', ...(live ? { role: 'status' } : {}) }, `Hotovo ${done} / ${total}`),
    h('span', {
      class: 'dprogress-bar',
      role: 'progressbar',
      'aria-label': 'Rozhodnuto',
      'aria-valuemin': '0',
      'aria-valuemax': String(total),
      'aria-valuenow': String(done),
    }, h('span', { class: 'dprogress-fill', style: `width:${pct}%` })),
  );
}

function statusEl(data: DesignStepData, props: DesignStepProps, acked: ReadonlySet<string>, jump: (id: string | undefined) => void): HTMLElement {
  const { errors, warnings } = data.issues;
  const p = designProgress(data);
  const pending = warnings.filter((w) => !acked.has(w.key));
  const block = proceedBlock(data, acked);
  const whyId = 'design-proceed-why';
  const ack = button('Acknowledge – beru varování na vědomí', () => props.onAcknowledge(pending.map((w) => w.key)), {
    class: 'btn',
    disabled: pending.length === 0,
    'data-fk': 'ack',
  });
  const proceed = button(props.proceedLabel ?? 'Pokračovat na Přípravu →', () => props.onProceed(), {
    class: 'btn btn-primary',
    disabled: !data.canProceed,
    'data-fk': 'proceed',
    ...(block ? { 'aria-describedby': whyId, title: proceedBlockText(block) } : {}),
  });
  const allGood = errors.length === 0 && warnings.length === 0 && p.done === p.total;
  return h('section', { class: 'side-card status-card' },
    h('h3', null, 'Stav návrhu'),
    progressEl(p.done, p.total),
    p.next
      ? h('p', { class: 'small next-line' }, 'Další: ', button(p.next.title, () => jump(p.next?.id), { class: 'link-btn', 'data-fk': 'next' }))
      : null,
    ...errors.map((e) => errorMessage(e, e.decisionId ? () => jump(e.decisionId) : undefined)),
    ...warnings.map((w) =>
      message({
        type: 'vcf-warning',
        compact: true,
        muted: acked.has(w.key),
        ...(acked.has(w.key) ? { title: 'Odchylka od doporučení (potvrzeno)' } : {}),
        body: [
          w.decisionTitle ? button(w.decisionTitle, () => jump(w.decisionId), { class: 'link-btn' }) : null,
          h('div', { lang: 'en', title: 'Popisná hláška modelu (ne citace)' }, w.message),
        ],
        reference: `${w.code} · Spec: ${w.specRef}`,
      }),
    ),
    warnings.length ? h('div', { class: 'ack-row' }, ack, data.warningsAcknowledged ? h('span', { class: 'ok small' }, '✓ Potvrzeno') : null) : null,
    allGood ? h('p', { class: 'ok all-good' }, '✓ Vše v pořádku') : null,
    errors.length || warnings.length
      ? h('p', { class: 'muted small' }, 'Hlášky jsou popisné texty modelu (ne doslovné citace); pravidla a odkazy pochází ze specifikace.')
      : null,
    h('div', { class: 'proceed-row' }, proceed),
    block
      ? h('p', { class: 'proceed-why small', id: whyId },
          proceedBlockText(block),
          block.kind === 'missing' && block.next ? ' ' : null,
          block.kind === 'missing' && block.next ? button('Přejít ▸', () => jump(block.next?.id), { class: 'link-btn' }) : null,
        )
      : null,
  );
}

/** Renders the whole design phase into `parent` (replaces its children). */
export function renderDesignStep(parent: HTMLElement, props: DesignStepProps, acknowledged: ReadonlySet<string>): void {
  const { data, view } = props;
  const rerender = (focusKey?: string): void => {
    renderDesignStep(parent, props, acknowledged);
    if (focusKey) parent.querySelector<HTMLElement>(`[data-fk="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  };

  // Accordion: follow the current step unless the player opened another one;
  // when a step gets completed, move on to the next one.
  const cur = currentStep(data);
  if (view.lastCurrent !== cur) {
    view.lastCurrent = cur;
    view.openStep = undefined;
  }
  const openStep = view.openStep === undefined ? cur : view.openStep;
  const toggle = (step: number): void => {
    view.openStep = openStep === step ? null : step;
    rerender(`step:${step}`);
  };
  const jump = (id: string | undefined): void => {
    if (!id) return;
    const dec = data.decisions.find((d) => d.id === id);
    if (dec && dec.step !== openStep) {
      view.openStep = dec.step;
      rerender();
    }
    const el = parent.querySelector<HTMLElement>(`#dec-${CSS.escape(id)}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true });
  };

  const p = designProgress(data);
  const top = h('div', { class: 'design-top' },
    progressEl(p.done, p.total, true),
    badgeLegend(['paraphrase', 'unverified', 'illustrative', 'irreversible', 'day2'], [
      [h('q', { class: 'cite' }, 'citace'), 'Doslovná citace z dokumentace (anglicky).'],
    ]),
  );
  const tip =
    p.done === 0
      ? message({
          type: 'game-tip',
          compact: true,
          title: 'Jak na návrh',
          body: 'Postupuj po krocích – další krok se odemkne, až dokončíš předchozí. Co znamenají značky, vysvětlí „?“.',
        })
      : null;
  parent.replaceChildren(
    h('div', { class: 'design-layout' },
      h('div', { class: 'design-main' },
        top,
        props.notice ?? null,
        tip,
        ...data.steps.map((g) => stepEl(g, props, g.step === openStep && g.unlocked, toggle)),
      ),
      h('aside', { class: 'design-side' }, statusEl(data, props, acknowledged, jump), summaryEl(data, props)),
    ),
  );
}

/**
 * Restores keyboard focus after a re-render: the same control (data-fk), or - when
 * it disappeared because the accordion moved on - the header of the open step.
 */
export function restoreDesignFocus(parent: HTMLElement, fk: string | undefined): void {
  if (!fk) return;
  const el =
    parent.querySelector<HTMLElement>(`[data-fk="${CSS.escape(fk)}"]`) ??
    parent.querySelector<HTMLElement>('.dstep.open .dstep-head');
  el?.focus({ preventScroll: true });
}
