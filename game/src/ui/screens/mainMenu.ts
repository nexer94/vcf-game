import { button, h } from '../dom';
import { VCF_VERSION } from '../version';
import { disclaimer } from './disclaimer';
import { icon } from '../icons';
import type { ScreenDef } from './screen';

/**
 * Main menu over the cosy room backdrop (UX.md §6): Sandbox is the primary entry,
 * Kariéra shows a clear "Připravujeme" state (no dead end), the traffic demo is a
 * small secondary link.
 */
export const mainMenuScreen: ScreenDef = {
  stageMode: 'backdrop',
  stageScene: 'room',
  mount(root, ctx) {
    // Backdrop: the cosy server room with illustrative demo furniture.
    ctx.stage.showRoomBackdrop();

    const sandbox = button(
      h('span', { class: 'menu-item-body' },
        h('span', { class: 'menu-item-title' }, 'Sandbox'),
        h('span', { class: 'menu-item-desc' }, 'Postav serverovnu a nasaď VCF podle dokumentace'),
      ),
      () => ctx.navigate({ name: 'sandbox-intro' }),
      { class: 'menu-item menu-primary' },
    );
    // Not a button: nothing to activate yet, but the state is readable.
    const career = h('div', { class: 'menu-item menu-soon', 'aria-disabled': 'true', role: 'group', 'aria-label': 'Kariéra – připravujeme' },
      h('span', { class: 'menu-item-body' },
        h('span', { class: 'menu-item-title' }, 'Kariéra', h('span', { class: 'ui-chip chip-soon' }, 'Připravujeme')),
        h('span', { class: 'menu-item-desc' }, 'Kampaně, mise a úkoly admina. Zatím ve hře není – vyzkoušej Sandbox.'),
      ),
    );
    const more = h('nav', { class: 'menu-more', 'aria-label': 'Další' },
      h('span', { class: 'menu-more-label' }, 'Další:'),
      button('Ukázka provozu', () => ctx.navigate({ name: 'traffic' }), { class: 'link-btn', title: 'Prototyp izometrické scény s ilustrativním provozem' }),
      h('span', { 'aria-hidden': 'true' }, '·'),
      button('Ukázková serverovna', () => ctx.navigate({ name: 'sandbox-room', demo: true }), { class: 'link-btn', title: 'Místnost s rozmístěným ukázkovým vybavením' }),
      h('span', { 'aria-hidden': 'true' }, '·'),
      button('Plán kampaní', () => ctx.navigate({ name: 'career' }), { class: 'link-btn' }),
    );
    const view = h(
      'div',
      { class: 'screen screen-menu' },
      h(
        'main',
        { class: 'menu-card', 'aria-labelledby': 'menu-title' },
        h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('game-mark')),
        h('h1', { id: 'menu-title' }, 'VCF Game'),
        h('p', { class: 'menu-sub' }, 'Simulátor privátního cloudu · modelovaná verze ', h('strong', null, VCF_VERSION)),
        h('nav', { class: 'menu-list', 'aria-label': 'Hlavní menu' }, sandbox, career),
        more,
        disclaimer(),
      ),
    );
    root.appendChild(view);
    sandbox.focus();
    return { dispose: () => view.remove() };
  },
};
