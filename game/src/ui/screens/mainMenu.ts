import { button, h } from '../dom';
import { VCF_VERSION } from '../version';
import { disclaimer } from './disclaimer';
import { icon } from '../icons';
import type { ScreenDef } from './screen';

/**
 * Main menu over the cosy room backdrop: Kariéra (primary) → Hotové scénáře → Sandbox
 * (user decision 2026-11-22); the traffic demo and the demo room are small secondary links.
 */
export const mainMenuScreen: ScreenDef = {
  stageMode: 'backdrop',
  stageScene: 'room',
  mount(root, ctx) {
    // Backdrop: the cosy server room with illustrative demo furniture.
    ctx.stage.showRoomBackdrop();

    // Order decided by the user (2026-11-22): 1. Kariéra · 2. Hotové scénáře · 3. Sandbox.
    const career = button(
      h('span', { class: 'menu-item-body' },
        h('span', { class: 'menu-item-title' }, 'Kariéra'),
        h('span', { class: 'menu-item-desc' }, 'Příběhové levely s vedením krok za krokem. Level 1: Single Site fleet s vSAN na 4 hostech.'),
      ),
      () => ctx.navigate({ name: 'career' }),
      { class: 'menu-item menu-primary' },
    );
    const scenarios = button(
      h('span', { class: 'menu-item-body' },
        h('span', { class: 'menu-item-title' }, 'Hotové scénáře'),
        h('span', { class: 'menu-item-desc' }, 'Plně nasazená prostředí k prozkoumání – hardware, běžící VM a kolik zdrojů spotřebují.'),
      ),
      () => ctx.navigate({ name: 'scenarios' }),
      { class: 'menu-item' },
    );
    const sandbox = button(
      h('span', { class: 'menu-item-body' },
        h('span', { class: 'menu-item-title' }, 'Sandbox'),
        h('span', { class: 'menu-item-desc' }, 'Volná simulace bez úkolů – pravidla a validace VCF platí.'),
      ),
      () => ctx.navigate({ name: 'sandbox-intro' }),
      { class: 'menu-item' },
    );
    const more = h('nav', { class: 'menu-more', 'aria-label': 'Další' },
      h('span', { class: 'menu-more-label' }, 'Další:'),
      button('Ukázka provozu', () => ctx.navigate({ name: 'traffic' }), { class: 'link-btn', title: 'Prototyp izometrické scény s ilustrativním provozem' }),
      h('span', { 'aria-hidden': 'true' }, '·'),
      button('Ukázková serverovna', () => ctx.navigate({ name: 'sandbox-room', demo: true }), { class: 'link-btn', title: 'Místnost s rozmístěným ukázkovým vybavením' }),
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
        h('nav', { class: 'menu-list', 'aria-label': 'Hlavní menu' }, career, scenarios, sandbox),
        more,
        disclaimer(),
      ),
    );
    root.appendChild(view);
    career.focus();
    return { dispose: () => view.remove() };
  },
};
