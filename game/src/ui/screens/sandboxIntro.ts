import { button, docLink, h } from '../dom';
import { badge, message } from '../messages';
import { SANDBOX_FLOW_V2 } from '../sandbox/phases';
import { VCF_DOCS_URL, VCF_VERSION } from '../version';
import { disclaimer } from './disclaimer';
import { onEscape, type ScreenDef } from './screen';

/**
 * Sandbox invitation (UX.md §6: short, 3 bullets, one primary action).
 * Deliberately contains no concrete VCF facts (components, host counts, design
 * options) - those come from docs/spec/ through the model.
 */
const BULLETS: readonly [string, string][] = [
  ['Postav serverovnu.', 'Racky, servery, switche a kabely – jako nábytek v útulné místnosti.'],
  ['Nainstaluj a navrhni.', 'Připrav hosty a rozhodni o architektuře podle dokumentace.'],
  ['Nasaď podle dokumentace.', 'Hra dovolí jen to, co jde udělat i ve skutečnosti.'],
];

export const sandboxIntroScreen: ScreenDef = {
  stageMode: 'off',
  mount(root, ctx) {
    const start = button('Vybrat blueprint a vstoupit →', () => ctx.navigate({ name: 'sandbox-site' }), {
      class: 'btn btn-primary btn-big',
    });
    const design = button('Otevřít jen návrh', () => ctx.navigate({ name: 'sandbox', phase: 'navrh' }), {
      class: 'btn btn-small',
      title: 'Průvodce návrhovými rozhodnutími bez místnosti',
    });
    const back = button('← Menu', () => ctx.navigate({ name: 'menu' }), { class: 'btn btn-ghost' });

    const view = h(
      'div',
      { class: 'screen screen-page' },
      h(
        'main',
        { class: 'page-card intro-card', 'aria-labelledby': 'intro-title' },
        h('h1', { id: 'intro-title' }, 'Sandbox – volná simulace'),
        h('p', { class: 'lead' },
          'Simulace architektury VMware Cloud Foundation (modelovaná verze ', h('strong', null, VCF_VERSION), ')',
          ' podle oficiální dokumentace. Žádné mise, neomezené zdroje.'),
        message({
          type: 'game-tip',
          title: 'Sandbox tě nevede – pravidla VCF ale platí',
          body: 'Nejsou tu úkoly, checklist ani bubliny s nápovědou. Všechny limity, prerekvizity a validace VCF podle dokumentace ale platí stejně jako v Kariéře – co nejde ve skutečnosti, nepůjde ani tady. Chceš vedení krok za krokem? Zkus Kariéru.',
        }),
        h('ul', { class: 'intro-bullets' },
          ...BULLETS.map(([t, d], i) =>
            h('li', null, h('span', { class: 'flow-num', 'aria-hidden': 'true' }, String(i + 1)), h('span', null, h('strong', null, t), ' ', d)),
          ),
        ),
        h('div', { class: 'actions intro-actions' }, start, design),
        h('details', { class: 'more intro-more' },
          h('summary', null, 'Jak to probíhá'),
          h('ol', { class: 'flow-inline' },
            ...SANDBOX_FLOW_V2.map((f) => h('li', null, h('strong', null, f.title), h('span', { class: 'muted' }, ` – ${f.blurb}`))),
          ),
        ),
        h('details', { class: 'more intro-more' },
          h('summary', null, 'Jak hra pracuje s dokumentací'),
          h('ul', { class: 'facts' },
            h('li', null, 'Pravidla a prerekvizity vychází z oficiální dokumentace a mají odkaz na příslušnou stránku. ',
              'Texty hlášek jsou popisné (ne doslovné), pokud nejsou označené jako citace.'),
            h('li', null, 'Hodnoty, které nejsou z dokumentace, jsou označené – např. ', badge('illustrative'), ' nebo ',
              badge('game-price'), '. Co hra zatím neumí, řekne otevřeně jako omezení hry.'),
          ),
          h('p', { class: 'muted small' }, docLink('Oficiální dokumentace VCF (TechDocs)', VCF_DOCS_URL)),
        ),
        h('div', { class: 'intro-foot' }, back),
        disclaimer(),
      ),
    );
    root.appendChild(view);
    start.focus();
    const offEsc = onEscape(() => ctx.navigate({ name: 'menu' }));
    return {
      dispose() {
        offEsc();
        view.remove();
      },
    };
  },
};
