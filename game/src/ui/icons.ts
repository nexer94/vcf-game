/**
 * Own line icons (docs/design/GRAPHICS.md T9): 24 px grid, 1.75 px stroke, round caps/joins,
 * stroke="currentColor", no fills (except LED dots). Inline SVG sprite (<symbol>) injected once
 * into the document; icon() returns a tiny <svg><use/></svg>. No icon font, no vendor/product
 * icons, no logos. Icons are decorative (aria-hidden) unless a label is given.
 *
 * Replaces the emoji that used to mark the four message types (⛔ ⚠ 🧩 💡) - emoji render
 * differently on every OS and break the clean enterprise look.
 */

import { ICON_PATHS, type IconName } from './iconNames';

export { ICON_PATHS, MESSAGE_ICON, type IconName } from './iconNames';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SPRITE_ID = 'vcfg-icon-sprite';

/** Inject the <symbol> sprite into the document once (no-op without a DOM). */
export function ensureIconSprite(doc: Document | undefined = globalThis.document): void {
  if (!doc || doc.getElementById(SPRITE_ID)) return;
  const symbols = Object.entries(ICON_PATHS)
    .map(([name, d]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${d}</symbol>`)
    .join('');
  const holder = doc.createElement('div');
  holder.id = SPRITE_ID;
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  // Static, compile-time strings only (no user / model content) - safe to parse.
  holder.innerHTML = `<svg xmlns="${SVG_NS}" width="0" height="0">${symbols}</svg>`;
  doc.body.prepend(holder);
}

export interface IconOptions {
  /** 16 (default) / 20 / 24 px. */
  readonly size?: 16 | 20 | 24;
  /** Accessible label; without it the icon is decorative (aria-hidden). */
  readonly label?: string;
  readonly className?: string;
}

/** One inline icon (<svg class="icon"><use href="#i-name"/></svg>). */
export function icon(name: IconName, o: IconOptions = {}): SVGSVGElement {
  ensureIconSprite();
  const svg = document.createElementNS(SVG_NS, 'svg');
  const cls = ['icon', o.size && o.size !== 16 ? `icon-${o.size}` : '', `i-${name}`, o.className ?? ''].filter(Boolean).join(' ');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 24 24');
  if (o.label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', o.label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}
