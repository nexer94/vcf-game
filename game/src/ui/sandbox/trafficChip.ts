/**
 * Traffic legend v2 (UX.md §12.5): a chip "Provoz ▾" bottom-left with the ACTIVE types (shape + colour + name);
 * click expands the full legend; clicking a type filters the dots (others at 15 % alpha). BMC is in a separate
 * group "Mimo VCF (herní)" – never a VCF traffic colour. Key L toggles.
 */
import { DOT_GLYPH } from '../../render/room/dotAtlas';
import { LOAD_CSS } from '../../render/traffic/loadStyle';
import { TRAFFIC_STYLE, TRAFFIC_TYPES, type TrafficType } from '../../render/traffic/trafficTypes';
import { button, h } from '../dom';
import { badge } from '../messages';

export interface TrafficChip {
  readonly el: HTMLElement;
  /** Called every ~250 ms with the currently active types. */
  update(active: ReadonlySet<TrafficType>, bmc: boolean): void;
  toggle(open?: boolean): void;
  dispose(): void;
}

const glyph = (t: TrafficType): HTMLElement => h('span', { class: 'tglyph', style: `color:${TRAFFIC_STYLE[t].css}`, 'aria-hidden': 'true' }, DOT_GLYPH[t]);

export function createTrafficChip(onFilter: (t: TrafficType | null) => void): TrafficChip {
  let open = false;
  let filter: TrafficType | null = null;
  let key = '';
  let autoOpened = false;
  const summary = h('span', { class: 'tchip-active' });
  const head = button('', () => toggle(), { class: 'tchip-head', 'aria-expanded': 'false', 'aria-controls': 'tchip-body', title: 'Legenda provozu (L)' });
  head.append(h('strong', null, 'Provoz'), summary, h('span', { 'aria-hidden': 'true' }, ' ▾'));
  const typeButtons = new Map<TrafficType, HTMLButtonElement>();
  const list = h('ul', { class: 'tchip-types' },
    ...TRAFFIC_TYPES.map((t) => {
      const b = button('', () => setFilter(filter === t ? null : t), { class: 'tchip-type', 'aria-pressed': 'false', title: 'Klik = zobrazit jen tento provoz' });
      b.append(glyph(t), ' ', TRAFFIC_STYLE[t].label);
      typeButtons.set(t, b);
      return h('li', null, b);
    }),
  );
  const bmcRow = h('li', { class: 'tchip-bmc' }, h('span', { class: 'tglyph', style: 'color:#9a96ad', 'aria-hidden': 'true' }, DOT_GLYPH.bmc), ' BMC – přenos ISO, šedá čárkovaná ', h('span', { class: 'ui-badge badge-outscope' }, 'mimo VCF scope – herní'));
  const body = h('div', { class: 'tchip-body', id: 'tchip-body', hidden: true },
    h('div', { class: 'tchip-group' }, 'Typ provozu (tvar + barva teček)'),
    list,
    h('div', { class: 'tchip-group' }, 'Mimo VCF (herní)'),
    h('ul', { class: 'tchip-types' }, bmcRow),
    h('div', { class: 'tchip-group' }, 'Vytížení linky'),
    h('ul', { class: 'tchip-load' },
      h('li', null, h('span', { class: 'bar bar-neutral' }), 'svazek: tloušťka = počet kabelů'),
      h('li', null, h('span', { class: 'bar', style: `background:${LOAD_CSS.warn}` }), 'nad 80 %'),
      h('li', null, h('span', { class: 'bar', style: `background:${LOAD_CSS.crit}` }), 'nad 95 % – zahozené pakety padají'),
    ),
    h('div', { class: 'tchip-foot' }, badge('illustrative'), ' objemy a rychlosti'),
  );
  const empty = h('span', { class: 'tchip-empty' }, 'Zatím žádný provoz – zapni první host s ESX.');
  const el = h('section', { class: 'tchip', 'aria-label': 'Legenda provozu' }, body, head);

  function setFilter(t: TrafficType | null): void {
    filter = t;
    for (const [k, b] of typeButtons) b.setAttribute('aria-pressed', String(k === t));
    onFilter(t);
  }

  function toggle(force?: boolean): void {
    open = force ?? !open;
    body.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
  }

  return {
    el,
    update(active, bmc) {
      const k = [...active].sort().join(',') + (bmc ? '|bmc' : '');
      if (k === key) return;
      key = k;
      summary.replaceChildren();
      if (active.size === 0 && !bmc) summary.append(empty);
      for (const t of TRAFFIC_TYPES) if (active.has(t)) summary.append(' ', glyph(t), h('span', { class: 'tchip-name' }, TRAFFIC_STYLE[t].label));
      if (bmc) summary.append(' ', h('span', { class: 'tglyph', style: 'color:#9a96ad', 'aria-hidden': 'true' }, DOT_GLYPH.bmc), h('span', { class: 'tchip-name' }, 'BMC (herní)'));
      for (const [t, b] of typeButtons) b.classList.toggle('inactive', !active.has(t));
      bmcRow.classList.toggle('inactive', !bmc);
      // First traffic ever: expand once (UX §3.3), the player closes it.
      if (!autoOpened && active.size > 0) {
        autoOpened = true;
        toggle(true);
      }
    },
    toggle,
    dispose() {
      el.remove();
    },
  };
}
