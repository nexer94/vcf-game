/**
 * Traffic legend v3 (UX.md §28.12): a ONE-LINE chip bottom-left – `Provoz ◆ ■ ▲ ▫ │ ▬ šířka = objem ▾` (active
 * types as glyphs only, full names in the expansion / tooltip; never wraps). Click / key L expands the legend
 * (types with filter, width swatch by volume, link load, out-of-VCF BMC, illustrative footer). No automatic
 * expansion: on the first VCF traffic a small help bubble appears once per profile (§28.11), closes after 8 s.
 */
import { DOT_GLYPH } from '../../render/room/dotAtlas';
import { flowWidth } from '../../render/traffic/flowScale';
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

const BMC_CSS = '#8592a3';
const HINT_KEY = 'vcf-game.traffic-hint-v3';
const HINT_MS = 8000;

const glyph = (t: TrafficType): HTMLElement => h('span', { class: 'tglyph', style: `color:${TRAFFIC_STYLE[t].css}`, 'aria-hidden': 'true' }, DOT_GLYPH[t]);
const bmcGlyph = (): HTMLElement => h('span', { class: 'tglyph tglyph-bmc', style: `color:${BMC_CSS}`, 'aria-hidden': 'true' }, DOT_GLYPH.bmc);

function hintSeen(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return true;
  }
}

function markHintSeen(): void {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* private mode – the hint may show again next time */
  }
}

/** Width swatch rows (UX §28.12 "Objem"): 1 Mb/s … 100 Gb/s with the room ribbon width. */
const SWATCH: readonly [number, string][] = [
  [0.001, '1 Mb/s'],
  [0.1, '100 Mb/s'],
  [1, '1 Gb/s'],
  [10, '10 Gb/s'],
  [100, '100 Gb/s'],
];

export function createTrafficChip(onFilter: (t: TrafficType | null) => void): TrafficChip {
  let open = false;
  let filter: TrafficType | null = null;
  let key = '';
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  const summary = h('span', { class: 'tchip-active' });
  const head = button('', () => toggle(), { class: 'tchip-head', 'aria-expanded': 'false', 'aria-controls': 'tchip-body', title: 'Legenda provozu (L)' });
  head.append(
    h('strong', null, 'Provoz'),
    summary,
    h('span', { class: 'tchip-sep', 'aria-hidden': 'true' }, '│'),
    h('span', { class: 'tchip-width', 'aria-hidden': 'true' }),
    h('span', null, 'šířka = objem'),
    h('span', { 'aria-hidden': 'true' }, ' ▾'),
  );
  const typeButtons = new Map<TrafficType, HTMLButtonElement>();
  const list = h('ul', { class: 'tchip-types' },
    ...TRAFFIC_TYPES.map((t) => {
      const b = button('', () => setFilter(filter === t ? null : t), { class: 'tchip-type', 'aria-pressed': 'false', title: 'Klik = zobrazit jen tento provoz' });
      b.append(glyph(t), ' ', TRAFFIC_STYLE[t].label);
      typeButtons.set(t, b);
      return h('li', null, b);
    }),
  );
  const bmcRow = h('li', { class: 'tchip-bmc' }, bmcGlyph(), ' BMC – vzdálená správa serveru ', h('span', { class: 'ui-badge badge-outscope' }, 'mimo VCF scope – herní'));
  const swatch = h('ul', { class: 'tchip-swatch' },
    ...SWATCH.map(([g, label]) => h('li', null, h('span', { class: 'swatch-bar', style: `height:${flowWidth(g).toFixed(1)}px` }), label)),
  );
  const body = h('div', { class: 'tchip-body', id: 'tchip-body', hidden: true },
    h('div', { class: 'tchip-group' }, 'Typ provozu (tvar + barva teček)'),
    list,
    h('div', { class: 'tchip-group' }, 'Objem – šířka proudu'),
    swatch,
    h('div', { class: 'tchip-group' }, 'Vytížení linky'),
    h('ul', { class: 'tchip-load' },
      h('li', null, h('span', { class: 'bar bar-neutral' }), 'normální'),
      h('li', null, h('span', { class: 'bar', style: `background:${LOAD_CSS.warn}` }), '⚠ nad 80 %'),
      h('li', null, h('span', { class: 'bar', style: `background:${LOAD_CSS.crit}` }), '⛔ nad 95 % – zahozené pakety padají'),
    ),
    h('div', { class: 'tchip-group' }, 'Mimo VCF (herní)'),
    h('ul', { class: 'tchip-types' }, bmcRow),
    h('div', { class: 'tchip-foot' }, badge('illustrative'), ' ≈ = ilustrativní model (objemy jsou herní hodnoty); toky podle dokumentace → Zdroj u každého toku'),
  );
  const empty = h('span', { class: 'tchip-empty' }, 'zatím nic');
  const hint = h('div', { class: 'tchip-hint', role: 'status', hidden: true },
    'Tohle je provoz. Čím širší proud, tím víc dat teče. Čísla ≈ jsou ilustrativní model.',
  );
  hint.addEventListener('click', () => closeHint());
  const el = h('section', { class: 'tchip', 'aria-label': 'Legenda provozu' }, hint, body, head);

  function setFilter(t: TrafficType | null): void {
    filter = t;
    for (const [k, b] of typeButtons) b.setAttribute('aria-pressed', String(k === t));
    onFilter(t);
  }

  function toggle(force?: boolean): void {
    open = force ?? !open;
    body.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    if (open) closeHint();
  }

  function closeHint(): void {
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = null;
    hint.hidden = true;
  }

  function showHintOnce(): void {
    if (hintSeen()) return;
    markHintSeen();
    hint.hidden = false;
    hintTimer = setTimeout(closeHint, HINT_MS);
  }

  return {
    el,
    update(active, bmc) {
      const k = [...active].sort().join(',') + (bmc ? '|bmc' : '');
      if (k === key) return;
      key = k;
      summary.replaceChildren();
      if (active.size === 0 && !bmc) summary.append(empty);
      for (const t of TRAFFIC_TYPES) if (active.has(t)) summary.append(glyph(t));
      if (bmc) summary.append(bmcGlyph());
      head.title = `Legenda provozu (L) – ${[...TRAFFIC_TYPES.filter((t) => active.has(t)).map((t) => TRAFFIC_STYLE[t].label), ...(bmc ? ['BMC (mimo VCF, herní)'] : [])].join(', ') || 'zatím žádný provoz'}`;
      for (const [t, b] of typeButtons) b.classList.toggle('inactive', !active.has(t));
      bmcRow.classList.toggle('inactive', !bmc);
      // First VCF traffic: a small help bubble once per profile instead of auto-expanding the legend (UX §28.11, D6).
      if (active.size > 0) showHintOnce();
    },
    toggle,
    dispose() {
      closeHint();
      el.remove();
    },
  };
}
