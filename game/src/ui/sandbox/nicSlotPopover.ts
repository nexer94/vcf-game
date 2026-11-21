/**
 * NIC slot popover (UX.md 19.4): click on a free slot "[+]" of a server → certified NICs for this model.
 * The list is the engine's (model BOM from BCG ∩ game parts catalog); "⚠ Nespojíš s ToR-A (25G)" is a game / physical
 * hint from the engine, the choice stays allowed. The engine decides (addNic) – e.g. "only a powered-off host / no ESX"
 * (game rule) comes back as its rejection message.
 */
import { button, h } from '../dom';
import { placePopover, type Rect } from './layoutZones';
import { formatPrice } from './shop';
import { sourceButton } from './sourcePopover';
import type { NicChoice, PortResult } from './sessionPort';

export interface NicSlotPopoverOptions {
  readonly serverLabel: string;
  readonly modelLabel: string;
  readonly slot: number;
  readonly choices: readonly NicChoice[] | undefined;
  readonly bcgUrl?: string;
  readonly anchor: Rect;
  readonly obstacles: readonly Rect[];
  readonly onAdd: (partId: string) => PortResult;
  readonly onClose: () => void;
}

export function createNicSlotPopover(o: NicSlotPopoverOptions): HTMLElement {
  const list = o.choices ?? [];
  let sel = list.find((c) => !c.incompatibleTors?.length)?.partId ?? list[0]?.partId ?? '';
  const err = h('p', { class: 'nic-err', role: 'alert', hidden: true });
  const name = `nic-slot-${o.slot}`;
  const addBtn = button('', () => {
    if (!sel) return;
    const r = o.onAdd(sel);
    if (r.ok) o.onClose();
    else {
      err.hidden = false;
      err.textContent = r.message;
    }
  }, { class: 'btn btn-small btn-primary' });
  const syncBtn = (): void => {
    const c = list.find((x) => x.partId === sel);
    addBtn.textContent = c ? `Přidat · ${formatPrice(c.price)} herní` : 'Přidat';
    addBtn.disabled = !c;
  };
  const rows = list.map((c) => {
    const id = `${name}-${c.partId}`;
    const r = h('input', { type: 'radio', name, id, value: c.partId, ...(c.partId === sel ? { checked: true } : {}) });
    r.addEventListener('change', () => {
      sel = c.partId;
      syncBtn();
    });
    const warn = c.incompatibleTors?.length ? c.incompatibleTors.map((t) => `⚠ Nespojíš s ${t.label} (${t.speedsGbE.join('/')}G)`).join(' · ') : '';
    return h('div', { class: 'nic-row' }, r, h('label', { for: id }, h('span', { lang: 'en' }, c.label), h('span', { class: 'muted' }, ` · ${c.ports}× ${c.speedsGbE.join('/')} GbE`), warn ? h('span', { class: 'nic-warn', title: 'Herní / fyzické omezení – volba zůstává povolená' }, ` ${warn}`) : null));
  });
  syncBtn();
  const src = sourceButton(o.bcgUrl ? { extra: { label: `Broadcom Compatibility Guide: ${o.modelLabel}`, url: o.bcgUrl }, specRef: '15-hardware §2.2' } : { specRef: '15-hardware §2.2' });
  const el = h('div', { class: 'nic-pop', role: 'dialog', 'aria-label': `Slot ${o.slot} · ${o.serverLabel}` },
    h('div', { class: 'pop-head' }, h('strong', null, `Slot ${o.slot} · ${o.serverLabel} · ${o.modelLabel}`), button('×', () => o.onClose(), { class: 'btn btn-small', 'aria-label': 'Zavřít (Esc)' })),
    list.length
      ? h('fieldset', { class: 'nic-list' }, h('legend', null, 'Síťové karty certifikované pro tento model:'), ...rows)
      : h('p', { class: 'muted' }, o.choices ? 'Pro tento model nejsou v herním katalogu další certifikované karty.' : 'Přidávání karet do slotů zatím engine nepodporuje.'),
    h('p', { class: 'muted small' }, 'Počet slotů je herní hodnota (BCG ji neuvádí).'),
    err,
    h('div', { class: 'nic-foot' }, src, h('span', { class: 'inv-spacer' }), button('Zrušit', () => o.onClose(), { class: 'btn btn-small' }), list.length ? addBtn : null),
  );
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      o.onClose();
    }
  });
  document.body.appendChild(el);
  const p = placePopover(o.anchor, { w: el.offsetWidth || 380, h: el.offsetHeight || 220 }, o.obstacles, { w: innerWidth, h: innerHeight }, ['right', 'left', 'bottom', 'top']);
  el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  (el.querySelector<HTMLElement>('input:checked') ?? el.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  return el;
}
