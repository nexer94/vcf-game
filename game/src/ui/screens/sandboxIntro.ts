import { button, docLink, h } from '../dom';
import { ILLUSTRATIVE_LABEL } from '../hud';
import { SANDBOX_PHASES, SANDBOX_PHASE_INFO } from '../sandbox/phases';
import { VCF_DOCS_URL, VCF_VERSION } from '../version';
import { disclaimer } from './disclaimer';
import { onEscape, type ScreenDef } from './screen';

/**
 * What Sandbox is and how it flows. Deliberately contains no concrete VCF facts
 * (components, host counts, design options) - those come from docs/spec/.
 */
const PHASE_BLURB: Record<(typeof SANDBOX_PHASES)[number], string> = {
  navrh: 'rozmyslíš, jak má prostředí vypadat – volby podle dokumentace.',
  priprava: 'plánování a příprava: DNS, IP adresy, sítě a hardware.',
  deploy: 'krok za krokem – VCF Installer, bring-up, workload domény a další.',
};

export const sandboxIntroScreen: ScreenDef = {
  stageMode: 'off',
  mount(root, ctx) {
    const start = button('Začít – 1. Návrh →', () => ctx.navigate({ name: 'sandbox', phase: 'navrh' }), {
      class: 'btn btn-primary',
    });
    const back = button('← Zpět do menu', () => ctx.navigate({ name: 'menu' }), { class: 'btn' });

    const view = h(
      'div',
      { class: 'screen screen-page' },
      h(
        'main',
        { class: 'page-card' },
        h('h1', null, 'Sandbox – volná simulace'),
        h('p', { class: 'lead' },
          'Sandbox je simulace skutečné architektury VMware Cloud Foundation podle oficiální dokumentace Broadcom. ' +
            'Můžeš v něm dělat to, co jde ve skutečnosti udělat – a nic, co nejde.'),
        h('ul', { class: 'facts' },
          h('li', null, h('strong', null, 'Podle dokumentace. '),
            'Každé pravidlo, prerekvizita i chybová hláška vychází z oficiální dokumentace. ' +
              'U pravidel a chyb najdeš ve hře odkaz na příslušnou stránku.'),
          h('li', null, h('strong', null, 'Laboratoř. '),
            'Žádné mise, žádné peníze, neomezené zdroje. Navrhuj, nasazuj, rozšiřuj i rozbíjej.'),
          h('li', null, h('strong', null, 'Označené odhady. '),
            'Hodnoty, které nejsou přímo z dokumentace (např. ilustrativní provoz), jsou vždy označené štítkem ',
            h('span', { class: 'ui-badge' }, ILLUSTRATIVE_LABEL), '.'),
        ),
        h('h2', null, 'Jak to probíhá'),
        h('ol', { class: 'flow' },
          ...SANDBOX_PHASES.map((id, i) =>
            h('li', null,
              h('span', { class: 'flow-num' }, String(i + 1)),
              h('span', null, h('strong', null, `${SANDBOX_PHASE_INFO[id].title} – `), PHASE_BLURB[id]),
            ),
          ),
        ),
        h('p', { class: 'muted' }, 'Modelovaná verze: ', h('strong', null, VCF_VERSION), ' · ',
          docLink('oficiální dokumentace VCF (TechDocs)', VCF_DOCS_URL)),
        h('div', { class: 'actions' }, back, start),
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
