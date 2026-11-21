/** Value badges of the "Hotové scénáře" mode: dokumentováno / odvozeno / nedoloženo / herní volba. */
import { h } from '../dom';

export const docBadge = (): HTMLElement =>
  h('span', { class: 'ui-badge badge-doc', title: 'Součet uvedený v dokumentaci (VCF Fleet Sizing Models).' }, 'dokumentováno');
export const derivedBadge = (what = 'Odvozeno ze součtu velikostí VM (workbook) – není to číslo z dokumentace.'): HTMLElement =>
  h('span', { class: 'ui-badge badge-derived', title: what }, 'odvozeno');
export const undocBadge = (short = false): HTMLElement =>
  h('span', { class: 'ui-badge badge-unverified', title: 'Velikost License serveru neuvádí workbook ani TechDocs (otevřená otázka specifikace).' }, short ? 'nedoloženo' : 'nedoloženo (License server)');
export const gameBadge = (title: string): HTMLElement => h('span', { class: 'ui-badge badge-game-default', title }, 'herní volba');
