/**
 * "Zdroj ▾" – readable documentation sources instead of bracket ids like [P13] (UX.md ch. 21).
 *
 * Data: the build-time source registry generated from the "Zdroje" sections of docs/spec/*.md
 * (game/src/scenarios/sources). Max. 3 links; the "spec §" line is small and grey, never with bracket ids.
 * One popover instance for the whole app; placed with the shared `placePopover` (22.2), Esc closes and returns focus.
 */
import { stripSourceIds } from '../../scenarios/sources';
import { hasSources, resolveSources, type SourceSpec } from './sourceResolve';
export { hasSources, resolveSources, type ResolvedSources, type SourceSpec } from './sourceResolve';
import { button, h } from '../dom';
import { placePopover, type Rect } from './layoutZones';

let pop: HTMLElement | null = null;
let opener: HTMLElement | null = null;
let obstaclesOf: () => readonly Rect[] = () => [];

/** The room screen registers its zone obstacles so the popover never covers HUD / panels. */
export function setSourceObstacles(fn: () => readonly Rect[]): void {
  obstaclesOf = fn;
}

export function closeSourcePopover(): boolean {
  if (!pop) return false;
  pop.remove();
  pop = null;
  const o = opener;
  opener = null;
  if (o && document.contains(o)) o.focus({ preventScroll: true });
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('pointerdown', onOutside, true);
  return true;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeSourcePopover();
  }
}

function onOutside(e: PointerEvent): void {
  if (pop && e.target instanceof Node && !pop.contains(e.target) && !(opener && opener.contains(e.target))) closeSourcePopover();
}

export function openSourcePopover(anchor: HTMLElement, s: SourceSpec): void {
  if (pop && opener === anchor) {
    closeSourcePopover();
    return;
  }
  closeSourcePopover();
  const r = resolveSources(s);
  const dev = import.meta.env?.DEV === true;
  const el = h('div', { class: 'src-pop', role: 'dialog', 'aria-label': 'Zdroj' },
    h('div', { class: 'pop-head' }, h('strong', null, 'Zdroj'), button('×', () => closeSourcePopover(), { class: 'btn btn-small', 'aria-label': 'Zavřít (Esc)' })),
    r.links.length
      ? h('ul', { class: 'src-links' }, ...r.links.map((l) => h('li', null, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.label, ' ↗'))))
      : h('p', { class: 'muted small' }, 'Odkaz na stránku dokumentace zatím není v registru zdrojů.'),
    r.more ? h('p', { class: 'muted small' }, `+${r.more} další v Knihovně (?)`) : null,
    s.why || s.rule ? h('hr') : null,
    s.why ? h('p', { class: 'small' }, h('span', { class: 'ui-badge badge-paraphrase' }, 'parafráze'), ' ', stripSourceIds(s.why)) : null,
    s.rule ? h('p', { class: 'small' }, 'Pravidlo: ', h('code', { lang: 'en' }, s.rule)) : null,
    r.specLine ? h('p', { class: 'src-spec' }, r.specLine) : null,
    dev && r.unknown ? h('p', { class: 'src-missing' }, `chybí zdroj (${r.unknown})`) : null,
  );
  document.body.appendChild(el);
  pop = el;
  opener = anchor;
  const a = anchor.getBoundingClientRect();
  const size = { w: el.offsetWidth || 360, h: el.offsetHeight || 160 };
  const p = placePopover({ x: a.left, y: a.top, w: a.width, h: a.height }, size, obstaclesOf().filter((o) => !(a.left >= o.x && a.left <= o.x + o.w && a.top >= o.y && a.top <= o.y + o.h)), { w: innerWidth, h: innerHeight }, ['bottom', 'top', 'left', 'right'], 6);
  el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  el.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true });
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onOutside, true);
}

/**
 * Compact "Zdroj ▾" link. `label` = e.g. "Zdroj: VCF Fleet in a Single Site ▾" for blueprint cards.
 * Returns null when nothing resolves (never a bare [P19]).
 */
export function sourceButton(s: SourceSpec, label = 'Zdroj ▾', cls = 'src-btn'): HTMLButtonElement | null {
  if (!hasSources(s)) return null;
  const b = button(label, () => openSourcePopover(b, s), { class: cls, 'aria-haspopup': 'dialog', title: 'Odkud to víme – stránky dokumentace' });
  return b;
}

/** First readable title of a reference (for inline labels like "Zdroj: <title>"). */
export function firstSourceTitle(s: SourceSpec): string | undefined {
  return resolveSources(s).links[0]?.title;
}

/** Inline spec reference for the player: text WITHOUT bracket ids (UX P5) + "Zdroj ▾" with readable page titles. */
export function specRefInline(ref: string, prefix = ' '): HTMLElement {
  const btn = sourceButton({ specRef: ref });
  return h('span', { class: 'spec-ref' }, `${prefix}${stripSourceIds(ref)}`, btn ? ' ' : '', btn ?? '');
}
