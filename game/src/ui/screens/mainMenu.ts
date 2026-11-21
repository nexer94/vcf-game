import { button, h } from '../dom';
import { VCF_VERSION } from '../version';
import { disclaimer } from './disclaimer';
import type { ScreenDef } from './screen';

/** Main menu over the slowly drifting isometric backdrop. */
export const mainMenuScreen: ScreenDef = {
  stageMode: 'backdrop',
  stageScene: 'room',
  mount(root, ctx) {
    // Backdrop: the cosy server room with illustrative demo furniture.
    ctx.stage.showRoomBackdrop();
    const item = (title: string, desc: string, onClick: () => void, extra?: HTMLElement): HTMLButtonElement =>
      button(
        h('span', { class: 'menu-item-body' }, h('span', { class: 'menu-item-title' }, title, extra), h('span', { class: 'menu-item-desc' }, desc)),
        onClick,
        { class: 'menu-item' },
      );

    const sandbox = item('Sandbox', 'Volná simulace architektury VCF podle dokumentace', () =>
      ctx.navigate({ name: 'sandbox-intro' }),
    );
    const view = h(
      'div',
      { class: 'screen screen-menu' },
      h(
        'main',
        { class: 'menu-card', 'aria-labelledby': 'menu-title' },
        h('div', { class: 'brand-mark', 'aria-hidden': 'true' }),
        h('h1', { id: 'menu-title' }, 'VCF Game'),
        h('p', { class: 'menu-sub' }, 'Simulátor privátního cloudu · modelovaná verze ', h('strong', null, VCF_VERSION)),
        h(
          'nav',
          { class: 'menu-list', 'aria-label': 'Hlavní menu' },
          sandbox,
          item('Kariéra', 'Kampaně, mise a úkoly admina', () => ctx.navigate({ name: 'career' }), h('span', { class: 'ui-chip' }, 'Připravujeme')),
          item('Serverovna (prototyp)', 'Nový vzhled Sandboxu: místnost, panáček, racky a kabely', () =>
            ctx.navigate({ name: 'sandbox-room', demo: false }),
            h('span', { class: 'ui-chip' }, 'Nové'),
          ),
          item('Ukázka provozu (ilustrativní)', 'Prototyp izometrické scény s provozem v datacentru', () =>
            ctx.navigate({ name: 'traffic' }),
          ),
        ),
        disclaimer(),
      ),
    );
    root.appendChild(view);
    sandbox.focus();
    return { dispose: () => view.remove() };
  },
};
