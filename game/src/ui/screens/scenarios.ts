import { button, h } from '../dom';
import { onEscape, type ScreenDef } from './screen';

/** Main menu entry 2 "Hotové scénáře" – placeholder until pre-built environments (data) exist. */
export const scenariosScreen: ScreenDef = {
  stageMode: 'off',
  mount(root, ctx) {
    const back = button('← Zpět do menu', () => ctx.navigate({ name: 'menu' }), { class: 'btn' });
    const view = h('div', { class: 'screen screen-page' },
      h('main', { class: 'page-card' },
        h('h1', null, 'Hotové scénáře ', h('span', { class: 'ui-chip chip-soon' }, 'Připravujeme')),
        h('p', null, 'Plně nasazená prostředí VCF, která si projdeš a prozkoumáš – serverovna, kabeláž, návrh i nasazené komponenty. Data scénářů se připravují.'),
        h('div', { class: 'actions' }, back,
          button('Zatím zkus Kariéru →', () => ctx.navigate({ name: 'career' }), { class: 'btn btn-primary' })),
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
