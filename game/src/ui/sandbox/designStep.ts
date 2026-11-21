import { drawDesignPreview, type DesignPreviewData } from '../../render/designPreview';
import { button, docLink, h } from '../dom';
import { ILLUSTRATIVE_LABEL } from '../hud';
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

/**
 * "Návrh" (design) phase view. Renders only what designData.ts derives from the
 * model (game/src/model/design.ts); no VCF facts are written here. Czech strings
 * are UI labels (kinds of consequences, section headings, hints).
 */
export type { DocRef } from './designData';

export interface DesignStepProps {
  readonly data: DesignStepData;
  /** Player intent; forwarded to the state port (later an engine command). */
  onSelect(decisionId: string, optionId: string): void;
  onAcknowledge(keys: readonly string[]): void;
  onProceed(): void;
  /** Persistent view state across re-renders (open/closed detail panels). */
  readonly view: DesignViewState;
}

export interface DesignViewState {
  readonly details: Map<string, boolean>;
}

export const createDesignViewState = (): DesignViewState => ({ details: new Map() });

/** Badge labels (UI). "parafráze" is deliberately distinct from "ilustrativní model". */
export const PARAPHRASE_LABEL = 'parafráze';
const OPEN_Q_LABEL = 'neověřeno';

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

const badge = (text: string, cls: string, title?: string): HTMLElement =>
  h('span', { class: `ui-badge ${cls}`, ...(title ? { title, tabindex: '0' } : {}) }, text);

const paraBadge = (): HTMLElement =>
  badge(PARAPHRASE_LABEL, 'badge-para', 'Text je parafráze dokumentace, ne doslovná citace.');

const openQBadge = (ref: string): HTMLElement =>
  badge(OPEN_Q_LABEL, 'badge-openq', `Otevřená otázka ve specifikaci (${ref}) – zatím neověřeno v dokumentaci.`);

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
      r.truncated ? badge('zkráceno', 'badge-muted', 'Text pravidla je ve specifikaci zkrácený („…“).') : null,
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
  return h('div', { class: 'opt-warning', role: 'note' },
    h('div', { class: 'opt-warning-title' }, 'Odchylka od doporučení'),
    w.rules.length ? h('ul', { class: 'rule-list' }, ...w.rules.map(ruleItem)) : null,
    h('div', { class: 'issue-msg', lang: 'en', title: 'Popisná hláška modelu (ne citace)' }, w.message),
    h('div', { class: 'spec-ref' }, `Spec: ${w.specRef}`),
  );
}

function details(view: DesignViewState, key: string, defaultOpen: boolean, summary: string, ...body: (Node | null)[]): HTMLElement {
  const el = h('details', { class: 'more', open: view.details.get(key) ?? defaultOpen }, h('summary', null, summary), ...body);
  el.addEventListener('toggle', () => view.details.set(key, (el as HTMLDetailsElement).open));
  return el;
}

function optionEl(d: DesignDecision, o: DesignOption, props: DesignStepProps): HTMLElement {
  const chosen = d.chosen === o.id;
  const disabled = o.disabledReason !== undefined;
  const input = h('input', {
    type: 'radio',
    name: `design-${d.id}`,
    value: o.id,
    checked: chosen,
    // A chosen-but-now-invalid option stays enabled so the state is visible.
    disabled: disabled && !chosen,
    'data-fk': `opt:${d.id}:${o.id}`,
  });
  input.addEventListener('change', () => props.onSelect(d.id, o.id));
  const nMore = o.consequences.length + o.appliedRules.length;
  return h('div', { class: `option${chosen ? ' chosen' : ''}${disabled ? ' blocked' : ''}` },
    h('label', { class: 'option-main' },
      input,
      h('span', { class: 'option-body' },
        h('span', { class: 'option-title' },
          o.label,
          o.day2 ? badge('Day 2', 'badge-day2', 'Podle dokumentace až Day 2 – není součástí návrhu Day 0.') : null,
          o.paraphrased ? paraBadge() : null,
          ...o.openQuestions.map(openQBadge),
          o.illustrative ? h('span', { class: 'ui-badge' }, ILLUSTRATIVE_LABEL) : null,
          o.warnings.length ? badge('varování', 'badge-warn') : null,
        ),
        o.description ? h('span', { class: 'option-desc' }, o.description) : null,
        o.disabledReason ? h('span', { class: 'option-blocked', lang: 'en' }, `Nelze: ${o.disabledReason}`) : null,
      ),
    ),
    h('div', { class: 'option-extra' },
      ...o.warnings.map(warningBox),
      nMore
        ? details(props.view, `opt:${d.id}:${o.id}`, chosen, `Důsledky a pravidla (${nMore})`,
            o.consequences.length ? h('ul', { class: 'conseq-list' }, ...o.consequences.map(consequenceItem)) : null,
            o.appliedRules.length ? h('div', { class: 'sub-h' }, 'Pravidla designu, která volba uplatňuje') : null,
            o.appliedRules.length ? h('ul', { class: 'rule-list' }, ...o.appliedRules.map(ruleItem)) : null,
          )
        : null,
      sourceList(o.sources),
    ),
  );
}

function decisionEl(d: DesignDecision, props: DesignStepProps): HTMLElement {
  return h('fieldset', { class: `decision${d.chosen ? ' decided' : ''}`, id: `dec-${d.id}` },
    h('legend', null, d.title),
    d.help ? h('p', { class: 'muted decision-help' }, d.help) : null,
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

function stepEl(g: DesignStepGroup, props: DesignStepProps): HTMLElement {
  const state = !g.unlocked ? 'locked' : g.complete ? 'complete' : 'current';
  const head = h('header', { class: 'dstep-head' },
    h('span', { class: 'flow-num' }, g.complete && g.unlocked ? '✓' : String(g.step)),
    h('h3', null, g.title),
    !g.unlocked ? h('span', { class: 'muted dstep-lock' }, 'Nejdřív dokonči předchozí krok') : null,
  );
  return h('section', { class: `dstep dstep-${state}`, 'aria-label': `Krok ${g.step}: ${g.title}` },
    head,
    ...(g.unlocked ? g.decisions.map((d) => decisionEl(d, props)) : []),
  );
}

// ---------------------------------------------------------------------------
// Summary + issues (right column)
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
      h('span', { class: 'ui-badge' }, ILLUSTRATIVE_LABEL),
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
      ? details(props.view, 'sum:day2', true, `Day 2 – na později (${data.summary.dayTwo.length})`,
          h('ul', { class: 'conseq-list' }, ...data.summary.dayTwo.map((k) =>
            h('li', { class: 'conseq conseq-day2' },
              h('span', { class: 'conseq-kind' }, k.decisionTitle),
              h('span', { class: 'conseq-body' }, textOf(k.text, k.quote), k.paraphrased ? paraBadge() : null,
                k.openQuestion ? openQBadge(k.openQuestion) : null, ' ', sourceList(k.sources)),
            ))))
      : null,
  );
}

const jump = (id: string | undefined): void => {
  if (!id) return;
  const el = document.getElementById(`dec-${id}`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

function issueItem(i: IssueView, acknowledged?: boolean): HTMLElement {
  return h('li', { class: `issue${acknowledged ? ' acked' : ''}` },
    i.decisionTitle ? button(i.decisionTitle, () => jump(i.decisionId), { class: 'link-btn' }) : null,
    h('div', { class: 'issue-msg', lang: 'en', title: 'Popisná hláška modelu (ne citace)' }, i.message),
    h('div', { class: 'spec-ref' }, `${i.code} · Spec: ${i.specRef}`),
  );
}

function issuesEl(data: DesignStepData, props: DesignStepProps, acked: ReadonlySet<string>): HTMLElement {
  const { missing, errors, warnings } = data.issues;
  const nErr = errors.length + (missing.length ? 1 : 0);
  const pending = warnings.filter((w) => !acked.has(w.key));
  const ack = button('Acknowledge – beru varování na vědomí', () => props.onAcknowledge(pending.map((w) => w.key)), {
    class: 'btn',
    disabled: pending.length === 0,
    'data-fk': 'ack',
  });
  const proceed = button('Pokračovat na Přípravu →', () => props.onProceed(), {
    class: 'btn btn-primary',
    disabled: !data.canProceed,
    'data-fk': 'proceed',
  });
  const why = !data.canProceed
    ? h('p', { class: 'muted small' },
        nErr ? 'Nejdřív vyřeš chyby.' : 'Potvrď varování (Acknowledge), nebo návrh uprav.')
    : null;
  return h('section', { class: 'side-card' },
    h('h3', null, 'Validace návrhu'),
    h('h4', { class: 'iss-h iss-err' }, `Chyby (blokují) · ${nErr}`),
    nErr === 0 ? h('p', { class: 'muted small' }, 'Žádné.') : null,
    missing.length
      ? h('div', { class: 'issue missing' },
          h('div', null, `Nerozhodnuto (${missing.length}): `),
          h('div', { class: 'missing-list' }, ...missing.map((m) => button(m.title, () => jump(m.id), { class: 'link-btn' }))))
      : null,
    errors.length ? h('ul', { class: 'issue-list' }, ...errors.map((e) => issueItem(e))) : null,
    h('h4', { class: 'iss-h iss-warn' }, `Varování (potvrdit) · ${warnings.length}`),
    warnings.length === 0 ? h('p', { class: 'muted small' }, 'Žádné.') : null,
    warnings.length ? h('ul', { class: 'issue-list' }, ...warnings.map((w) => issueItem(w, acked.has(w.key)))) : null,
    warnings.length ? h('div', { class: 'ack-row' }, ack, data.warningsAcknowledged ? h('span', { class: 'ok small' }, 'Potvrzeno') : null) : null,
    h('p', { class: 'muted small' },
      'Hlášky jsou popisné texty modelu (ne doslovné citace); pravidla a odkazy pochází ze specifikace.'),
    h('div', { class: 'proceed-row' }, proceed),
    why,
  );
}

/** Renders the whole design phase into `parent` (replaces its children). */
export function renderDesignStep(parent: HTMLElement, props: DesignStepProps, acknowledged: ReadonlySet<string>): void {
  const { data } = props;
  const legend = h('p', { class: 'design-legend muted small' },
    'Postupuj po krocích – další rozhodnutí se objeví, až dokončíš předchozí. Značky: ',
    h('q', { class: 'cite' }, 'citace'), ' = doslovná citace z dokumentace (anglicky) · ',
    paraBadge(), ' · ', openQBadge('spec §8'), ' = otevřená otázka ve specifikaci · ',
    h('span', { class: 'ui-badge' }, ILLUSTRATIVE_LABEL), ' = herní vizualizace.',
  );
  parent.replaceChildren(
    h('div', { class: 'design-layout' },
      h('div', { class: 'design-main' }, legend, ...data.steps.map((g) => stepEl(g, props))),
      h('aside', { class: 'design-side' }, issuesEl(data, props, acknowledged), summaryEl(data, props)),
    ),
  );
}
