/**
 * Computer app "Návrh VCF" (UX.md §11.3): design decisions as tiles + detail with option cards.
 *
 * Reads only the view model of pcData.ts (model + snapshot.hw.options); writes only player intent:
 *  - session: commands selectDesignOption / acknowledgeDesignWarnings through RoomPort.ops,
 *  - demo room (no session): the shared local design state (same as the right panel).
 * The right-side panel "Návrhová rozhodnutí" shares the same state (session / sharedDesignState).
 */
import type { DesignDecisionId } from '../../model';
import { button, docLink, h } from '../dom';
import { badge, chip, message } from '../messages';
import { loadDesignStepData, type DocRef } from '../sandbox/designData';
import { sharedDesignState } from '../sandbox/designState';
import type { RoomPort } from '../sandbox/sessionPort';
import { pcDesignFromLocal, pcDesignFromSnapshot, TILE_STATUS, type PcConsequence, type PcDecision, type PcDesignModel, type PcOption, type PcRule, type PcUnlock } from './pcData';

export interface DesignAppOptions {
  readonly port: RoomPort;
  announce(text: string, bad?: boolean): void;
  onUnlock(u: PcUnlock): void;
  onShowBoard(): void;
}

export interface PcApp {
  readonly el: HTMLElement;
  /** Esc inside the app (close the detail / summary). true = handled. */
  escape(): boolean;
  dispose(): void;
}

/** Drops empty slots (replaceChildren does not accept null). */
export const nn = (...xs: (Node | null | undefined | false)[]): Node[] => xs.filter((x): x is Node => !!x);

type Filter = 'all' | 'todo' | 'problems';
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

const sources = (s: readonly DocRef[]): HTMLElement | null =>
  s.length ? h('span', { class: 'sources' }, 'TechDocs: ', ...s.flatMap((x, i) => [i ? ', ' : '', docLink(x.title, x.url)])) : null;
const quoteOr = (text: string, quote: boolean): HTMLElement => (quote ? h('q', { class: 'cite', lang: 'en', title: 'Citace z dokumentace (anglicky)' }, text) : h('span', null, text));

function ruleLi(r: PcRule): HTMLElement {
  return h('li', { class: 'rule' },
    h('code', { class: 'rule-id' }, r.id), ' ',
    h('span', { class: `rule-kind rule-${r.kind}` }, r.kind === 'REQD' ? 'požadavek' : 'doporučení'),
    r.relation === 'deviates' ? h('span', { class: 'ui-badge badge-warn' }, 'odchylka') : null,
    ' ', quoteOr(r.text, r.quote), ' ', sources(r.sources));
}

function conseqLi(c: PcConsequence): HTMLElement {
  return h('li', { class: `conseq conseq-${c.kind}` }, quoteOr(c.text, c.quote), c.paraphrased ? badge('paraphrase') : null, c.openQuestion ? badge('unverified', c.openQuestion) : null, ' ', sources(c.sources));
}

export function createDesignApp(o: DesignAppOptions): PcApp {
  const el = h('div', { class: 'pc-app pc-design' });
  let selected: string | null = null;
  let filter: Filter = 'all';
  let showSummary = false;
  const local = sharedDesignState();

  const model = (): PcDesignModel => {
    const snap = o.port.ops?.snapshot();
    if (snap) return pcDesignFromSnapshot(snap);
    return pcDesignFromLocal(loadDesignStepData(local.selection(), local.acknowledged()), local.acknowledged());
  };

  const select = (d: PcDecision, opt: PcOption): void => {
    if (opt.irreversible.length) {
      const text = opt.irreversible.map((c) => c.text).join('\n');
      if (!window.confirm(`${opt.label} – Nevratné podle dokumentace:\n\n${text}\n\nZvolit?`)) return;
    }
    if (o.port.ops) {
      const r = o.port.ops.dispatch({ type: 'selectDesignOption', decision: d.id as DesignDecisionId, option: opt.id });
      if (!r.ok) return o.announce(r.message, true);
    } else local.select(d.id, opt.id);
    o.announce(`${d.title}: ${opt.label}.`);
  };

  const acknowledge = (keys: readonly string[]): void => {
    if (!keys.length) return;
    if (o.port.ops) {
      const r = o.port.ops.dispatch({ type: 'acknowledgeDesignWarnings', keys });
      if (!r.ok) return o.announce(r.message, true);
    } else local.acknowledgeWarnings(keys);
    o.announce('Varování potvrzena (acknowledge).');
  };

  function tile(d: PcDecision): HTMLButtonElement {
    const st = TILE_STATUS[d.status];
    const descId = `pc-tile-${d.id}`;
    const b = button(
      h('span', { class: 'tile-inner' },
        h('span', { class: `tile-icon tile-${d.status}`, 'aria-hidden': 'true' }, st.icon),
        h('span', { class: 'tile-title' }, d.title),
        h('span', { class: 'tile-sub', id: descId },
          d.chosenLabel ?? st.label,
          d.afterStep ? ` · nejdřív krok ${d.afterStep}` : '',
          d.hwLimited && d.status !== 'hw' ? ` · ${d.hwLimited} omezeno HW` : ''),
      ),
      () => {
        selected = d.id;
        render(`tile:${d.id}`);
        el.querySelector<HTMLElement>('.pc-detail h3')?.focus({ preventScroll: true });
      },
      { class: `pc-tile tile-st-${d.status}${d.id === selected ? ' sel' : ''}${d.afterStep ? ' after' : ''}`, 'aria-describedby': descId, 'aria-pressed': String(d.id === selected), 'data-fk': `tile:${d.id}`, title: `${d.title} – ${st.label}` },
    );
    return b;
  }

  function hwBlock(opt: PcOption): HTMLElement | null {
    const hw = opt.hw;
    if (!hw || hw.status === 'not-hw-dependent') return null;
    return h('div', { class: 'opt-hw' },
      ...hw.requirements.map((r) => h('div', { class: `req ${r.met === null ? 'req-neutral' : r.met ? 'req-ok' : 'req-bad'}` },
        h('span', { 'aria-hidden': 'true' }, r.met === null ? '○ ' : r.met ? '✔ ' : '✖ '),
        h('span', { class: 'sr-only' }, r.met === null ? 'Požadavek: ' : r.met ? 'Splněno: ' : 'Nesplněno: '),
        h('span', { lang: 'en' }, r.issue.message), h('span', { class: 'spec-ref' }, ` ${r.issue.specRef}`))),
      ...hw.errors.filter((e) => !hw.requirements.some((r) => r.issue.message === e.issue.message)).map((e) =>
        h('div', { class: 'req req-bad' }, h('span', { 'aria-hidden': 'true' }, '✖ '), h('span', { lang: 'en' }, e.issue.message), h('span', { class: 'spec-ref' }, ` ${e.issue.specRef}`))),
      ...[...hw.errors, ...hw.warnings].filter((e) => e.unlock).map((e) =>
        button(`${e.unlock!.text} ▸`, () => o.onUnlock(e.unlock!), { class: 'btn btn-small unlock-btn', title: 'Herní akce – odemkne volbu podle požadavku z dokumentace' })),
      ...hw.warnings.map((w) => h('div', { class: 'req req-warn' }, h('span', { 'aria-hidden': 'true' }, '⚠ '), h('span', { lang: 'en' }, w.issue.message), h('span', { class: 'spec-ref' }, ` ${w.issue.specRef}`))),
    );
  }

  function optionCard(d: PcDecision, opt: PcOption): HTMLElement {
    const hwBlocked = opt.hw?.status === 'insufficient';
    const why = h('details', { class: 'more' },
      h('summary', null, 'Proč?'),
      opt.recommended.length ? h('ul', { class: 'conseq-list' }, ...opt.recommended.map((t) => h('li', null, '★ ', t))) : null,
      opt.rules.length ? h('ul', { class: 'rule-list' }, ...opt.rules.map(ruleLi)) : null,
      opt.consequences.length ? h('ul', { class: 'conseq-list' }, ...opt.consequences.map(conseqLi)) : null,
      sources(opt.sources),
      h('div', { class: 'spec-ref' }, `Spec: ${d.specRef}`),
    );
    return h('article', { class: `opt-card${opt.selected ? ' chosen' : ''}${opt.available ? '' : ' blocked'}`, 'aria-label': opt.label },
      h('div', { class: 'opt-head' },
        h('strong', null, opt.label),
        opt.recommended.length ? h('span', { class: 'ui-badge badge-star', title: 'Doporučení z dokumentace (text níže)' }, '★ dokumentace') : null,
        opt.irreversible.length ? badge('irreversible') : null,
        opt.day2 ? badge('day2') : null,
        opt.paraphrased ? badge('paraphrase') : null,
        ...opt.openQuestions.map((q) => badge('unverified', q)),
        opt.warnings.length ? chip('⚠ odchylka', 'badge-warn', 'Odchylka od doporučení dokumentace – po volbě ji potvrdíš.') : null,
      ),
      opt.description ? h('p', { class: 'opt-desc' }, opt.description) : null,
      ...opt.recommended.slice(0, 2).map((t) => h('div', { class: 'opt-rec' }, h('span', { 'aria-hidden': 'true' }, '★ '), t)),
      hwBlock(opt),
      ...opt.errors.map((e) => h('div', { class: 'req req-bad' }, h('span', { 'aria-hidden': 'true' }, '✖ '), 'Nelze: ', h('span', { lang: 'en' }, e.message), e.specRef ? h('span', { class: 'spec-ref' }, ` ${e.specRef}`) : null)),
      ...opt.warnings.map((w) => h('div', { class: 'req req-warn' }, h('span', { 'aria-hidden': 'true' }, '⚠ '), h('span', { lang: 'en' }, w.message), h('span', { class: 'spec-ref' }, ` ${w.specRef}`))),
      why,
      h('div', { class: 'opt-foot' },
        opt.selected
          ? h('span', { class: 'ok' }, '✓ zvoleno')
          : button(hwBlocked ? 'Nelze s tvým HW' : opt.available ? 'Zvolit' : 'Nelze', () => select(d, opt), { class: 'btn btn-small btn-primary', disabled: !opt.available, 'data-fk': `opt:${d.id}:${opt.id}` }),
      ),
    );
  }

  function detail(m: PcDesignModel, d: PcDecision | undefined): HTMLElement {
    if (!d) return h('section', { class: 'pc-detail empty' }, h('p', { class: 'muted' }, 'Vyber dlaždici vlevo – ukážu volby, požadavky na HW a odkazy do dokumentace.'));
    const warns = m.warnings.filter((w) => w.decisionId === d.id);
    const pending = warns.filter((w) => !w.acknowledged);
    return h('section', { class: 'pc-detail', 'aria-label': `Rozhodnutí ${d.title}` },
      h('h3', { tabindex: '-1' }, h('span', { class: `tile-icon tile-${d.status}`, 'aria-hidden': 'true' }, TILE_STATUS[d.status].icon), ' ', d.title),
      d.help ? h('p', { class: 'muted' }, d.help) : null,
      d.afterStep ? message({ type: 'game-tip', compact: true, title: `Doporučené pořadí: nejdřív krok ${d.afterStep}`, body: 'Herní vedení – nic není zamčené, ale volby tady závisí na dřívějších rozhodnutích.' }) : null,
      ...d.errors.map((e) => message({ type: 'vcf-error', compact: true, body: h('span', { lang: 'en' }, e.message), reference: `${e.code} · Spec: ${e.specRef}` })),
      ...warns.map((w) => message({ type: 'vcf-warning', compact: true, muted: w.acknowledged, body: h('span', { lang: 'en' }, w.message), reference: `${w.code} · Spec: ${w.specRef}${w.acknowledged ? ' · potvrzeno' : ''}` })),
      pending.length ? button('Acknowledge – beru odchylku na vědomí', () => acknowledge(pending.map((w) => w.key)), { class: 'btn btn-small', 'data-fk': `ack:${d.id}` }) : null,
      h('div', { class: 'opt-grid' }, ...d.options.map((opt) => optionCard(d, opt))),
      d.rules.length || d.consequences.length
        ? h('details', { class: 'more' }, h('summary', null, `Proč? – platí pro celé rozhodnutí (${d.rules.length + d.consequences.length})`),
            d.consequences.length ? h('ul', { class: 'conseq-list' }, ...d.consequences.map(conseqLi)) : null,
            d.rules.length ? h('ul', { class: 'rule-list' }, ...d.rules.map(ruleLi)) : null)
        : null,
      h('div', { class: 'decision-foot' }, sources(d.sources), h('span', { class: 'spec-ref' }, ` Spec: ${d.specRef}`)),
    );
  }

  function summaryEl(m: PcDesignModel): HTMLElement {
    const s = m.summary;
    const und = 'zatím nerozhodnuto';
    const row = (k: string, v: string): HTMLElement[] => [h('dt', null, k), h('dd', null, v)];
    return h('section', { class: 'pc-summary', 'aria-label': 'Shrnutí návrhu' },
      h('div', { class: 'pop-head' }, h('strong', null, 'Shrnutí návrhu'), button('Ukázat na tabuli ▸', () => o.onShowBoard(), { class: 'btn btn-small' }), button('✖', () => { showSummary = false; render(); }, { class: 'btn btn-small', 'aria-label': 'Zavřít shrnutí' })),
      s
        ? h('dl', { class: 'sum' },
            ...row('Domény', s.domains.map((d) => (d === 'management' ? 'Management domain' : 'Workload domain')).join(' + ')),
            ...row('VCF Instance', s.instances === undefined ? und : String(s.instances)),
            ...row('Min. hostů – default cluster management domain', s.managementDomainMinHosts === undefined ? und : String(s.managementDomainMinHosts)),
            ...row('NSX Manager', s.nsxManagers.length ? s.nsxManagers.map((n) => `${n.domain}: ${n.nodes}`).join(' · ') : und),
            ...row('VCF Operations', s.componentNodes.vcfOperations === undefined ? und : `${s.componentNodes.vcfOperations}×`),
            ...row('VCF Automation', s.componentNodes.vcfAutomation === undefined ? und : `${s.componentNodes.vcfAutomation}×`),
            ...row('Uplatněná pravidla', String(s.appliedRules.length)),
            ...row('Odchylky od doporučení', String(s.deviatedRules.length)),
          )
        : h('p', { class: 'muted' }, und),
      h('p', { class: 'muted small' }, 'Podrobnosti (pravidla, Day 2) jsou v panelu Návrh v místnosti (klávesa D).'),
    );
  }

  function render(focusKey?: string): void {
    const m = model();
    const fk = focusKey ?? (document.activeElement as HTMLElement | null)?.dataset?.['fk'];
    if (selected && !m.decisions.some((d) => d.id === selected)) selected = null;
    const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
    const hw = m.hw;
    const shown = m.decisions.filter((d) => filter === 'all' || (filter === 'todo' ? d.status === 'pending' || d.status === 'hw' : d.status === 'error' || d.status === 'warn' || d.status === 'hw'));
    const radio = (v: Filter, label: string): HTMLElement => {
      const i = h('input', { type: 'radio', name: 'pc-filter', value: v, checked: filter === v });
      i.addEventListener('change', () => { filter = v; render(); });
      return h('label', { class: 'pc-filter' }, i, ` ${label}`);
    };
    const pendingAll = m.warnings.filter((w) => !w.acknowledged);
    el.replaceChildren(...nn(
      h('header', { class: 'pc-app-head' },
        h('h2', null, 'Návrh VCF'),
        h('div', { class: 'dprogress' },
          h('span', { class: 'dprogress-text', role: 'status' }, `Hotovo ${m.done} / ${m.total}`),
          h('span', { class: 'dprogress-bar', role: 'progressbar', 'aria-label': 'Rozhodnuto', 'aria-valuemin': '0', 'aria-valuemax': String(m.total), 'aria-valuenow': String(m.done) }, h('span', { class: 'dprogress-fill', style: `width:${pct}%` }))),
        hw
          ? h('span', { class: 'pc-hw', title: 'Souhrn hardwaru v místnosti (model hardwareContext)' }, `Tvůj HW: ${hw.hostCount} ${hw.hostCount === 1 ? 'server' : hw.hostCount >= 2 && hw.hostCount <= 4 ? 'servery' : 'serverů'}`, hw.vendors.length ? ` · ${hw.vendors.join(', ')}` : '', hw.hostCount ? ` · min. ${hw.minNicPorts} NIC portů/server · vSAN ESA způsobilé ${hw.esaEligible}/${hw.hostCount}` : '')
          : h('span', { class: 'pc-hw muted' }, 'Ukázková místnost: dostupnost podle HW se nepočítá.'),
        h('div', { class: 'pc-filters', role: 'radiogroup', 'aria-label': 'Filtr' }, radio('all', 'vše'), radio('todo', 'čeká na mě'), radio('problems', 'problémy')),
        button(showSummary ? 'Skrýt shrnutí' : 'Shrnutí návrhu', () => { showSummary = !showSummary; render(); }, { class: 'btn btn-small', 'aria-expanded': String(showSummary) }),
      ),
      pendingAll.length
        ? h('div', { class: 'pc-ackbar' }, message({ type: 'vcf-warning', compact: true, title: `Odchylky od doporučení k potvrzení: ${pendingAll.length}`, body: 'Varování se potvrzují, chyby se opravují (jako v průvodci installeru).' }), button('Potvrdit všechna varování', () => acknowledge(pendingAll.map((w) => w.key)), { class: 'btn btn-small' }))
        : m.gateOk ? h('p', { class: 'ok small pc-gate' }, '✓ Návrh je bez chyb a varování potvrzena.') : null,
      showSummary ? summaryEl(m) : null,
      h('div', { class: 'pc-design-body' },
        h('div', { class: 'pc-tiles', role: 'list', 'aria-label': 'Rozhodnutí podle kroků' },
          ...m.steps.flatMap((s) => {
            const ds = shown.filter((d) => d.step === s.step);
            if (!ds.length) return [];
            return [h('h3', { class: 'pc-step-h' }, `${CIRCLED[s.step - 1] ?? s.step} ${s.title}`), h('div', { class: 'pc-tile-row', role: 'listitem' }, ...ds.map(tile))];
          }),
          shown.length ? null : h('p', { class: 'muted' }, filter === 'problems' ? 'Žádné problémy.' : 'Nic nečeká.'),
        ),
        detail(m, m.decisions.find((d) => d.id === selected)),
      ),
    ));
    if (fk) el.querySelector<HTMLElement>(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true });
  }

  const offPort = o.port.subscribe(() => render());
  const offLocal = o.port.ops ? () => undefined : local.subscribe(() => render());
  // Start on the first decision that waits for the player.
  const first = model();
  selected = (first.decisions.find((d) => d.status === 'error') ?? first.decisions.find((d) => d.status !== 'done' && d.status !== 'warn'))?.id ?? null;
  render();

  return {
    el,
    escape() {
      if (showSummary) {
        showSummary = false;
        render();
        return true;
      }
      if (selected) {
        const id = selected;
        selected = null;
        render(`tile:${id}`);
        return true;
      }
      return false;
    },
    dispose() {
      offPort();
      offLocal();
    },
  };
}
