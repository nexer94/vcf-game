import { button, h } from '../dom';
import { onEscape, type ScreenDef } from './screen';

/** Campaign order from CLAUDE.md ("Herní režimy" -> Kariéra). Titles only, no VCF facts. */
const CAMPAIGNS: readonly string[] = [
  'Nové prostředí (bring-up)',
  'Migrace – konvergence vSphere do VCF',
  'Upgrade VCF 5.2 / 9.0 → 9.1',
  'Den 2 – nová workload doména / instance',
];

/** Placeholder until the career mode (missions, score, economy) exists. */
export const careerScreen: ScreenDef = {
  stageMode: 'off',
  mount(root, ctx) {
    const back = button('← Zpět do menu', () => ctx.navigate({ name: 'menu' }), { class: 'btn' });
    const view = h(
      'div',
      { class: 'screen screen-page' },
      h(
        'main',
        { class: 'page-card' },
        h('h1', null, 'Kariéra ', h('span', { class: 'ui-chip' }, 'Připravujeme')),
        h(
          'p',
          null,
          'Postup po kampaních, misích a úkolech. Jako admin budeš řešit problémy, které reálně potkají správce VCF – ' +
            'vždy jen chybové stavy podle dokumentace.',
        ),
        h('h2', null, 'Plánované kampaně'),
        h(
          'ol',
          { class: 'campaign-list' },
          ...CAMPAIGNS.map((c) => h('li', { 'aria-disabled': 'true' }, h('span', null, c), h('span', { class: 'lock' }, 'zamčeno'))),
        ),
        h('p', { class: 'muted' }, '…a dál provoz a incidenty.'),
        h(
          'p',
          { class: 'muted' },
          'Rozpočet a ceny budou herní mechanika (fiktivní měna), v UI vždy označené jako herní – nejde o údaje z dokumentace.',
        ),
        h('div', { class: 'actions' }, back,
          button('Zatím zkus Sandbox →', () => ctx.navigate({ name: 'sandbox-intro' }), { class: 'btn btn-primary' })),
      ),
    );
    root.appendChild(view);
    back.focus();
    const offEsc = onEscape(() => ctx.navigate({ name: 'menu' }));
    return {
      dispose() {
        offEsc();
        view.remove();
      },
    };
  },
};
