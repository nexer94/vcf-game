/**
 * Main menu 2 "Hotové scénáře" (CLAUDE.md section 3): list of pre-built, fully deployed environments (cards in order
 * 1–5 with variants) and a side-by-side comparison of two scenarios.
 *
 * Numbers come from the model only (ui/scenarios/scenarioData.ts over model/deployedInventory.ts = spec 40 §6.3–§6.5);
 * documented totals and derived sums are labelled; sources are readable page titles ("Zdroj ▾").
 */
import { button, h } from '../dom';
import { derivedBadge, docBadge } from '../scenarios/badges';
import { sourceButton } from '../sandbox/sourcePopover';
import { SCENARIO_PRESETS, presetById } from '../../model/deployedInventory';
import { DOCUMENTED_TOTALS_REF, SCENARIO_GROUP_TITLE, compareRows, fmtResShort, scenarioCards, scenarioModel, type ScenarioCardView } from '../scenarios/scenarioData';
import { onEscape, type ScreenDef } from './screen';
import type { Route } from '../router';
import '../sandbox/v3.css';
import '../scenarios/scenarios.css';


function card(c: ScenarioCardView, open: () => void): HTMLElement {
  const go = button('Prozkoumat →', open, { class: 'btn btn-primary btn-small', 'aria-label': `Prozkoumat: ${c.title}` });
  return h('article', { class: 'scen-card', 'data-id': c.id },
    h('h3', null, c.title),
    h('div', { class: 'scen-bp' },
      c.blueprint
        ? h('span', null, 'Blueprint: ', h('span', { lang: 'en' }, c.blueprint.title), ' ', sourceButton({ specRef: c.blueprint.specRef, extra: { label: `Dokumentace: ${c.blueprint.title}`, url: c.blueprint.url } }) ?? '')
        : h('span', { class: 'muted' }, 'Bez blueprintu – management doména podle sizing profilu'),
    ),
    h('dl', { class: 'scen-facts' },
      h('dt', null, 'Profil'), h('dd', null, c.profiles),
      h('dt', null, 'ESX hosty'), h('dd', null, String(c.hosts)),
      h('dt', null, 'Běžící VM'), h('dd', null, String(c.vmCount)),
      ...c.documented.flatMap((d) => [h('dt', null, d.label), h('dd', null, fmtResShort(d.resources), ' ', docBadge())]),
    ),
    h('div', { class: 'scen-card-foot' }, sourceButton({ specRef: [c.specRef, DOCUMENTED_TOTALS_REF] }) ?? '', h('span', { class: 'inv-spacer' }), go),
  );
}

export const scenariosScreen: ScreenDef = {
  stageMode: 'off',
  mount(root, ctx, route) {
    const view = h('div', { class: 'screen screen-page' });
    root.appendChild(view);
    const offEsc = onEscape(() => ctx.navigate(route.name === 'scenarios' && route.compare ? { name: 'scenarios' } : { name: 'menu' }));

    const renderList = (): void => {
      const cards = scenarioCards();
      const groups = ([1, 2, 3, 4, 5] as const).map((n) => {
        const items = cards.filter((c) => c.scenario === n);
        return h('section', { class: 'scen-group', 'aria-labelledby': `scen-g${n}` },
          h('h2', { id: `scen-g${n}` }, `${n}. ${SCENARIO_GROUP_TITLE[n]}`, items.length > 1 ? h('span', { class: 'muted small' }, ` · ${items.length} varianty`) : ''),
          h('div', { class: 'scen-cards' }, ...items.map((c) => card(c, () => ctx.navigate({ name: 'scenario', id: c.id })))),
        );
      });
      const back = button('← Menu', () => ctx.navigate({ name: 'menu' }), { class: 'btn btn-ghost' });
      view.replaceChildren(h('main', { class: 'page-card scen-page', 'aria-labelledby': 'scen-title' },
        h('div', { class: 'scen-head' },
          h('h1', { id: 'scen-title' }, 'Hotové scénáře'),
          h('span', { class: 'inv-spacer' }),
          button('Porovnat dva scénáře', () => ctx.navigate({ name: 'scenarios', compare: true }), { class: 'btn' }),
        ),
        h('p', { class: 'lead' }, 'Plně nasazená prostředí VCF podle dokumentace. Nic neinstaluješ – prohlížíš serverovnu, všechny běžící VM a kolik zdrojů spotřebují.'),
        h('p', { class: 'muted small' },
          docBadge(), ' = součet z dokumentace (VCF Fleet Sizing Models). Velikosti jednotlivých VM jsou z Planning and Preparation Workbooku; jejich součet a rozmístění na hosty ve scénáři jsou odvozené. Konfigurace serverů je herní volba z certifikovaného katalogu.'),
        ...groups,
        h('div', { class: 'actions' }, back),
      ));
      view.querySelector<HTMLButtonElement>('.scen-card .btn-primary')?.focus();
    };

    const renderCompare = (): void => {
      const ids = SCENARIO_PRESETS.map((p) => p.id);
      let a = ids[0]!;
      let b = ids[2] ?? ids[1]!;
      const sel = (v: string, on: (x: string) => void, label: string): HTMLSelectElement => {
        const s = h('select', { 'aria-label': label }, ...SCENARIO_PRESETS.map((p) => h('option', { value: p.id }, `${p.scenario}. ${p.title}`))) as HTMLSelectElement;
        s.value = v;
        s.addEventListener('change', () => on(s.value));
        return s;
      };
      const table = h('div', { class: 'scen-compare-body' });
      const draw = (): void => {
        const pa = presetById(a)!;
        const pb = presetById(b)!;
        const rows = compareRows(scenarioModel(pa), scenarioModel(pb));
        table.replaceChildren(h('table', { class: 'scen-table scen-compare' },
          h('thead', null, h('tr', null, h('th', null, ''), h('th', null, pa.title), h('th', null, pb.title))),
          h('tbody', null, ...rows.map((r) => h('tr', null,
            h('th', { scope: 'row' }, r.label, ' ', r.kind === 'documented' ? docBadge() : r.kind === 'derived' ? derivedBadge() : ''),
            h('td', { class: r.a !== r.b ? 'diff' : '' }, r.a),
            h('td', { class: r.a !== r.b ? 'diff' : '' }, r.b),
          ))),
        ));
      };
      const selA = sel(a, (x) => ((a = x), draw()), 'Scénář A');
      const selB = sel(b, (x) => ((b = x), draw()), 'Scénář B');
      draw();
      view.replaceChildren(h('main', { class: 'page-card scen-page', 'aria-labelledby': 'cmp-title' },
        h('h1', { id: 'cmp-title' }, 'Porovnání scénářů'),
        h('div', { class: 'scen-compare-pick' }, h('label', null, 'A ', selA), h('label', null, 'B ', selB)),
        table,
        h('p', { class: 'muted small' }, 'Formát: vCPU / RAM / disk. Odlišné hodnoty jsou zvýrazněné. ', sourceButton({ specRef: ['40-workload-domains §6.4, §6.5 [W6]'] }) ?? ''),
        h('div', { class: 'actions' }, button('← Seznam scénářů', () => ctx.navigate({ name: 'scenarios' }), { class: 'btn btn-ghost' })),
      ));
      selA.focus();
    };

    const render = (r: Route): void => (r.name === 'scenarios' && r.compare ? renderCompare() : renderList());
    render(route);
    return {
      update(r) {
        route = r;
        render(r);
      },
      dispose() {
        offEsc();
        view.remove();
      },
    };
  },
};
