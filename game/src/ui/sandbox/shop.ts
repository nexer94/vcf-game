/**
 * Shop v3 (UX.md Part III ch. 19.1–19.2): two tabs only – Racky / Servery.
 *   Servery: step 1 = vendor tiles (Dell · HPE · Lenovo · Cisco · Supermicro, colour tag + text, no logos),
 *            step 2 = fixed-size cards of the vendor's starter configurations (15 B.3; traps hidden unless enabled).
 *   Card (minimal, user 2026-11-22): mini front in U scale with the vendor colour tag, model, U, vSAN ESA profile, price
 *   (game) and "Koupit" → placement right away. "Detail ▾" / click on the card = popover with cores · RAM / drives ·
 *   NIC, "✓ certified VCF 9.1" (Zdroj popover with the BCG page), deviation / trap note and "Koupit 4".
 * Not placed items = chip "Nezaracováno: N ▸" in the shop bar. Data come from RoomState.catalog (engine); the UI
 * never decides certification, profile or trap status.
 */
import { button, h } from '../dom';
import { chip } from '../messages';
import { VENDOR_TAG } from '../../render/room/palette';
import type { HwVendor } from '../../model';
import { openSourcePopover } from './sourcePopover';
import { placePopover } from './layoutZones';
import type { InventoryEntry, RoomState, ShopRackItem, ShopServerItem } from './sessionPort';

import type { ShopTab } from './panelData';
export type { ShopTab };

type V3Tab = 'racks' | 'servers';
const VENDORS: readonly HwVendor[] = ['Dell', 'HPE', 'Lenovo', 'Cisco', 'Supermicro'];
const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
export const formatPrice = (n: number): string => `¤ ${n.toLocaleString('cs-CZ')}`;

export interface ShopOptions {
  /** `qty` > 1 = Shift+click "koupit 4" (cluster). */
  readonly onBuy: (itemId: string, qty: number) => void;
  /** Pick a not-placed item for placement (null = cancel). */
  readonly onPick: (entry: InventoryEntry | null) => void;
  readonly onSell: (id: string) => void;
  /** Open / collapsed changed (layout zones). */
  readonly onLayout: () => void;
  /** Settings: show unsuitable configurations (traps). */
  readonly showTraps: () => boolean;
  /** Money label (Sandbox ∞ / Career budget). */
  readonly moneyNote: () => string;
}

export interface ShopHandle {
  readonly el: HTMLElement;
  update(state: RoomState, pickedId: string | null): void;
  setTab(tab: ShopTab): void;
  readonly open: boolean;
  setOpen(open: boolean): void;
  /** Screen rect of a tab (bubble anchors 'ui:shop-racks' / 'ui:shop-servers'). */
  tabRect(tab: V3Tab): DOMRect | null;
  dispose(): void;
}

const v3Tab = (t: ShopTab): V3Tab => (t === 'racks' ? 'racks' : 'servers');

/** Groups servers by vendor (engine shelves when present). Pure. */
export function vendorShelves(state: RoomState, showTraps: boolean): { vendor: HwVendor; items: ShopServerItem[] }[] {
  const byId = new Map(state.catalog.servers.map((s) => [s.id, s]));
  const shelves = state.catalog.shelves;
  return VENDORS.map((vendor) => {
    const sh = shelves?.find((x) => x.vendor === vendor);
    const ids = sh ? [...sh.items, ...(showTraps ? sh.traps : [])] : state.catalog.servers.filter((s) => s.vendor === vendor && (showTraps || !s.starterStatus || s.starterStatus === 'ok' || s.starterStatus === 'dev')).map((s) => s.id);
    return { vendor, items: ids.map((id) => byId.get(id)).filter((x): x is ShopServerItem => !!x) };
  });
}

/** Mini server front in U scale (UX 19.1: height = U × 10 px). */
export function miniFront(u: number, vendor: HwVendor | undefined): HTMLElement {
  return h('div', { class: 'mini-front', style: `height:${u * 10}px;--tag:${vendor ? css(VENDOR_TAG[vendor]) : '#8592a3'}`, 'aria-hidden': 'true' },
    ...Array.from({ length: u }, () => h('span', { class: 'mini-u' })));
}

/** "2U" label; "herní" when the height is the game default (not in BCG data). */
export function uLabel(u: number, gameDefault: boolean): HTMLElement {
  return h('span', { class: 'mini-u-label', title: gameDefault ? 'Výška v U není v datech BCG – hra používá výchozí hodnotu (herní zjednodušení)' : 'Výška podle datasheetu výrobce' }, `${u}U`, gameDefault ? h('small', null, ' herní') : null);
}

export function createShop(opts: ShopOptions): ShopHandle {
  let tab: V3Tab = 'racks';
  let vendor: HwVendor | null = null;
  let state: RoomState | null = null;
  let picked: string | null = null;
  let open = true;
  let unplacedOpen = false;

  const tabs = h('div', { class: 'inv-tabs', role: 'tablist', 'aria-label': 'Obchod (klávesy 1–2)' });
  const tabButtons = new Map<V3Tab, HTMLButtonElement>();
  for (const [id, label] of [['racks', 'Racky'], ['servers', 'Servery']] as const) {
    const b = button(label, () => setTab(id), { class: 'inv-tab', role: 'tab', 'aria-selected': 'false', 'data-tab': id });
    tabButtons.set(id, b);
    tabs.appendChild(b);
  }
  const unplacedChip = button('', () => {
    unplacedOpen = !unplacedOpen;
    render();
  }, { class: 'unplaced-chip', 'aria-expanded': 'false', hidden: true });
  const note = h('span', { class: 'inv-note' });
  const toggle = button('▾ sbalit', () => setOpen(!open), { class: 'btn btn-small btn-ghost inv-toggle', 'aria-expanded': 'true' });
  const crumbs = h('div', { class: 'inv-crumbs' });
  const items = h('div', { class: 'inv-items', role: 'tabpanel' });
  const scrollL = button('‹', () => items.scrollBy({ left: -items.clientWidth * 0.8, behavior: 'smooth' }), { class: 'inv-scroll inv-scroll-l', 'aria-label': 'Posunout doleva', tabindex: '-1' });
  const scrollR = button('›', () => items.scrollBy({ left: items.clientWidth * 0.8, behavior: 'smooth' }), { class: 'inv-scroll inv-scroll-r', 'aria-label': 'Posunout doprava', tabindex: '-1' });
  // Detail popover of a server card (minimal cards, user 2026-11-22).
  let detailId: string | null = null;
  const detailPop = h('div', { class: 'shop-detail-pop', role: 'dialog', 'aria-label': 'Detail sestavy', hidden: true });
  const unplacedPop = h('div', { class: 'unplaced-pop', role: 'dialog', 'aria-label': 'Nezaracováno', hidden: true });
  const el = h('footer', { class: 'room-inv v3', 'aria-label': 'Obchod' }, detailPop,
    h('div', { class: 'inv-head' }, tabs, unplacedChip, h('span', { class: 'inv-spacer' }), note, toggle),
    h('div', { class: 'inv-body' }, crumbs, h('div', { class: 'inv-scroller' }, scrollL, items, scrollR)),
    unplacedPop,
  );
  items.addEventListener('wheel', (e) => {
    if (!e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY) && items.scrollWidth <= items.clientWidth) return;
    if (e.shiftKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      items.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });
  items.addEventListener('scroll', () => {
    updateScrollButtons();
    const card = detailId ? items.querySelector<HTMLElement>(`[data-item="${CSS.escape(detailId)}"]`) : null;
    if (card) placeDetail(card);
  });
  el.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === '1' || e.key === '2') {
      e.preventDefault();
      const t: V3Tab = e.key === '1' ? 'racks' : 'servers';
      setTab(t);
      tabButtons.get(t)?.focus();
    } else if (e.key === 'Backspace' && tab === 'servers' && vendor) {
      e.preventDefault();
      e.stopPropagation();
      vendor = null;
      render();
      items.querySelector<HTMLElement>('button')?.focus();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const cards = [...items.querySelectorAll<HTMLElement>('.shop-card, .vendor-tile')];
      const i = cards.findIndex((c) => c.contains(document.activeElement));
      if (i < 0) return;
      const n = cards[Math.max(0, Math.min(cards.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))];
      (n?.querySelector<HTMLElement>('.btn-primary') ?? n)?.focus();
      e.preventDefault();
    }
  });

  function setTab(t: ShopTab): void {
    tab = v3Tab(t);
    if (!open) setOpen(true);
    render();
  }

  function setOpen(v: boolean): void {
    if (open === v) return;
    open = v;
    render();
    opts.onLayout();
  }

  function updateScrollButtons(): void {
    scrollL.hidden = items.scrollLeft <= 2;
    scrollR.hidden = items.scrollLeft + items.clientWidth >= items.scrollWidth - 2;
  }

  function buy(id: string, e?: MouseEvent): void {
    opts.onBuy(id, e?.shiftKey ? 4 : 1);
  }

  /** "Koupit" with Shift+click = 4 and touch long-press = 4 (cluster). */
  function buyButton(s: ShopServerItem, label = 'Koupit'): HTMLButtonElement {
    const buyBtn = button(label, () => undefined, { class: 'btn btn-small btn-primary', title: 'Koupit a umístit · Shift+klik = koupit 4 (cluster)', 'aria-label': `Koupit ${s.vendor} ${s.model}` });
    buyBtn.addEventListener('click', (e) => {
      closeDetail(false);
      buy(s.id, e);
    });
    let pressT = 0;
    buyBtn.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pressT = window.setTimeout(() => {
        pressT = -1;
        opts.onBuy(s.id, 4);
      }, 650);
    });
    buyBtn.addEventListener('pointerup', () => {
      if (pressT > 0) clearTimeout(pressT);
    });
    return buyBtn;
  }

  const shortModel = (s: ShopServerItem): string => s.model.replace(/^(Dell |HPE |Lenovo |Cisco |Supermicro )/i, '');
  const profileChip = (s: ShopServerItem): HTMLElement | null =>
    s.profile ? chip(s.profile.replace(/^vsan-esa-/i, '').replace(/^vSAN-/, 'ESA '), 'badge-profile', `Profil vSAN ESA odvozený modelem z konfigurace (15 §6.1)${s.profileNetworkLimited ? ' – omezeno sítí' : ''}`) : null;

  /**
   * Minimal card (user 2026-11-22): vendor colour tag (mini front), model, U height, profile badge, price, "Koupit".
   * Everything else (cores / RAM / disks / NIC, certification + BCG, deviation / trap, sources) in the detail popover.
   */
  function serverCard(s: ShopServerItem): HTMLElement {
    const dev = s.starterStatus === 'dev';
    const trap = s.starterStatus === 'req' || s.starterStatus === 'ext';
    const full = `${s.vendor} ${shortModel(s)}`;
    const detailBtn = button('Detail ▾', () => toggleDetail(s.id), { class: 'link-btn card-detail-btn', 'aria-expanded': String(detailId === s.id), 'aria-haspopup': 'dialog', 'aria-label': `Detail sestavy ${full}`, title: 'Parametry, certifikace a zdroje' });
    const card = h('article', { class: `shop-card v3 server-card${trap ? ' trap' : ''}${detailId === s.id ? ' expanded' : ''}`, 'aria-label': full, 'data-item': s.id },
      h('div', { class: 'card-top' },
        miniFront(s.rackUnits, s.vendor),
        h('div', { class: 'card-top-text' },
          h('div', { class: 'card-model', title: `${s.model} (sestava ${s.id})` }, shortModel(s)),
          h('div', { class: 'card-meta' },
            uLabel(s.rackUnits, s.rackUnitsGameDefault !== false),
            profileChip(s),
            dev || trap ? h('span', { class: `card-warn${trap ? ' bad' : ''}`, title: `${dev ? 'Odchylka' : 'Nevhodná sestava'} – viz Detail`, 'aria-label': dev ? 'odchylka' : 'nevhodná' }, '⚠') : null,
          ),
          detailBtn)),
      h('div', { class: 'card-foot' }, h('strong', { class: 'card-price' }, formatPrice(s.price)), buyButton(s)),
    );
    card.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('button, a')) return;
      toggleDetail(s.id);
    });
    return card;
  }

  // ------------------------------------------------------------ detail popover of a server card
  function onDetailKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || document.querySelector('.src-pop')) return; // Zdroj popover on top closes first
    e.preventDefault();
    e.stopPropagation();
    closeDetail(true);
  }
  function onDetailOutside(e: PointerEvent): void {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (detailPop.contains(t) || t.closest('.src-pop') || t.closest('.server-card')) return;
    closeDetail(false);
  }
  function closeDetail(focusBack: boolean): void {
    if (!detailId) return;
    const id = detailId;
    detailId = null;
    detailPop.hidden = true;
    detailPop.replaceChildren();
    document.removeEventListener('keydown', onDetailKey, true);
    document.removeEventListener('pointerdown', onDetailOutside, true);
    const card = items.querySelector<HTMLElement>(`[data-item="${CSS.escape(id)}"]`);
    card?.classList.remove('expanded');
    card?.querySelector('.card-detail-btn')?.setAttribute('aria-expanded', 'false');
    if (focusBack) card?.querySelector<HTMLElement>('.card-detail-btn')?.focus({ preventScroll: true });
  }
  function toggleDetail(id: string): void {
    if (detailId === id) return closeDetail(true);
    closeDetail(false);
    detailId = id;
    document.addEventListener('keydown', onDetailKey, true);
    document.addEventListener('pointerdown', onDetailOutside, true);
    renderDetail(true);
  }
  function renderDetail(focus: boolean): void {
    const s = detailId && state ? state.catalog.servers.find((x) => x.id === detailId) : undefined;
    const card = detailId ? items.querySelector<HTMLElement>(`[data-item="${CSS.escape(detailId)}"]`) : null;
    if (!s || !card || !open) return closeDetail(false);
    for (const c of items.querySelectorAll('.server-card')) c.classList.toggle('expanded', c === card);
    card.querySelector('.card-detail-btn')?.setAttribute('aria-expanded', 'true');
    const cores = s.sockets * s.coresPerSocket;
    const dev = s.starterStatus === 'dev';
    const trap = s.starterStatus === 'req' || s.starterStatus === 'ext';
    const cert = s.certified91
      ? button(h('span', null, '✓ certified VCF 9.1'), () => openSourcePopover(cert!, { extra: { label: `Broadcom Compatibility Guide: ${s.vendor} ${s.model}`, url: s.bcgUrl }, specRef: '15-hardware §2.2' }), { class: 'ui-badge badge-cert', title: 'Broadcom Compatibility Guide uvádí ESXi 9.1 – klik = zdroj' })
      : chip('bez certifikace 9.1', 'badge-muted', 'Broadcom Compatibility Guide neuvádí ESXi 9.1 pro tento model');
    const row = (k: string, ...v: (Node | string | null)[]): HTMLElement => h('div', { class: 'sd-row' }, h('span', { class: 'sd-k' }, k), h('span', { class: 'sd-v' }, ...v));
    detailPop.replaceChildren(...[
      h('div', { class: 'pop-head' },
        h('span', { class: 'sd-title' }, h('span', { class: 'vendor-tag', style: `background:${css(VENDOR_TAG[s.vendor])}` }, s.vendor), h('strong', null, shortModel(s))),
        button('×', () => closeDetail(true), { class: 'btn btn-small', 'aria-label': 'Zavřít detail (Esc)' })),
      h('div', { class: 'sd-sub muted' }, `sestava ${s.id}`),
      h('div', { class: 'sd-rows' },
        row('CPU', `${s.sockets}× socket · ${cores} jader`),
        row('RAM', `${s.ramGB} GB`),
        row('Disky', ...s.drives.flatMap((d, i) => [i ? h('br') : null, `${d.count}× ${d.label} (${d.capacityTB} TB, ${d.iface})`])),
        row('NIC', ...s.nics.flatMap((n, i) => [i ? h('br') : null, `${n.count}× ${n.label} (${n.ports} porty · ${n.speedsGbE.join('/')} GbE)`])),
        s.boot ? row('Boot', s.boot) : null,
        row('Výška', uLabel(s.rackUnits, s.rackUnitsGameDefault !== false), s.rackUnitsUrl ? h('a', { href: s.rackUnitsUrl, target: '_blank', rel: 'noopener noreferrer', class: 'sd-link' }, ' datasheet ↗') : null),
      ),
      h('div', { class: 'card-badges sd-badges' }, cert, profileChip(s)),
      dev || trap ? h('p', { class: `sd-note${trap ? ' bad' : ''}` }, h('strong', null, dev ? 'Odchylka: ' : 'Nevhodná sestava: '), s.note || 'Sestava se odchyluje od doporučení (15 B.3).') : null,
      h('div', { class: 'card-foot' }, h('strong', { class: 'card-price' }, formatPrice(s.price), h('small', { class: 'muted' }, ' herní cena')), buyButton(s, 'Koupit'), buyButton4(s)),
    ].filter((x) => x !== null) as HTMLElement[]);
    detailPop.hidden = false;
    placeDetail(card);
    if (focus) detailPop.querySelector<HTMLElement>('.btn-primary')?.focus({ preventScroll: true });
  }
  function buyButton4(s: ShopServerItem): HTMLButtonElement {
    return button('Koupit 4', () => {
      closeDetail(false);
      opts.onBuy(s.id, 4);
    }, { class: 'btn btn-small', title: 'Koupit 4 stejné (cluster) – jako Shift+klik', 'aria-label': `Koupit 4× ${s.vendor} ${s.model}` });
  }
  function placeDetail(card: HTMLElement): void {
    const a = card.getBoundingClientRect();
    const size = { w: detailPop.offsetWidth || 340, h: detailPop.offsetHeight || 240 };
    const hud = { x: 0, y: 0, w: innerWidth, h: 56 };
    const p = placePopover({ x: a.left, y: a.top, w: a.width, h: a.height }, size, [hud], { w: innerWidth, h: innerHeight }, ['top', 'right', 'left', 'bottom'], 8);
    detailPop.style.transform = `translate(${p.x}px, ${Math.max(56, p.y)}px)`;
  }

  function rackCard(r: ShopRackItem): HTMLElement {
    const b = button('Koupit', () => opts.onBuy(r.id, 1), { class: 'btn btn-small btn-primary', 'aria-label': `Koupit ${r.label}` });
    return h('article', { class: 'shop-card v3 rack-card', 'aria-label': r.label },
      h('div', { class: 'card-top' },
        h('span', { class: 'mini-rack', style: `height:${Math.round(r.heightU * 0.7)}px`, 'aria-hidden': 'true' }, h('span', { class: 'mini-rack-tor' })),
        h('div', { class: 'card-top-text' }, h('div', { class: 'card-model', title: r.label }, r.label),
          h('div', { class: 'card-meta' }, h('span', { class: 'mini-u-label' }, `${r.heightU}U`), chip('generický · herní', 'badge-generic', 'No-name rack a ToR switch – herní zjednodušení, hodnoty nejsou z dokumentace')),
          h('div', { class: 'card-line', title: 'ToR switch nahoře v ceně' }, '+ ToR switch v ceně'))),
      h('div', { class: 'card-foot' }, h('strong', { class: 'card-price' }, formatPrice(r.price)), b),
    );
  }

  function vendorTiles(s: RoomState): HTMLElement[] {
    return vendorShelves(s, opts.showTraps()).map(({ vendor: v, items: list }) =>
      button(h('span', { class: 'vendor-tile-in' }, h('span', { class: 'vendor-stripe', style: `background:${css(VENDOR_TAG[v])}` }), h('strong', null, v), h('span', { class: 'muted' }, `${list.length} ${list.length === 1 ? 'sestava' : list.length < 5 ? 'sestavy' : 'sestav'}`)), () => {
        vendor = v;
        render();
        items.querySelector<HTMLElement>('.btn-primary')?.focus();
      }, { class: 'vendor-tile', disabled: list.length === 0, 'aria-label': `${v}: ${list.length} sestav` }),
    );
  }

  function renderUnplaced(s: RoomState): void {
    const list = s.inventory;
    unplacedChip.hidden = list.length === 0;
    unplacedChip.textContent = `Neumístěno: ${list.length} ${unplacedOpen ? '▾' : '▸'}`;
    unplacedChip.setAttribute('aria-expanded', String(unplacedOpen && list.length > 0));
    unplacedPop.hidden = !unplacedOpen || list.length === 0;
    if (unplacedPop.hidden) return;
    unplacedPop.replaceChildren(
      h('div', { class: 'pop-head' }, h('strong', null, 'Neumístěno'), button('×', () => { unplacedOpen = false; render(); }, { class: 'btn btn-small', 'aria-label': 'Zavřít' })),
      h('ul', { class: 'unplaced-list' }, ...list.map((e) => {
        const on = picked === e.id;
        return h('li', null,
          h('span', { class: 'unplaced-name', title: e.label }, e.label),
          button(on ? 'Zrušit' : 'Umístit', () => opts.onPick(on ? null : e), { class: `btn btn-small${on ? '' : ' btn-primary'}`, 'aria-pressed': String(on) }),
          button('Prodat', () => opts.onSell(e.id), { class: 'btn btn-small', title: 'Sandbox vrací 100 % herní ceny' }),
        );
      })),
    );
  }

  function render(): void {
    for (const [id, b] of tabButtons) b.setAttribute('aria-selected', String(id === tab && open));
    el.classList.toggle('collapsed', !open);
    toggle.textContent = open ? '▾ sbalit' : '▴ obchod';
    toggle.setAttribute('aria-expanded', String(open));
    note.textContent = opts.moneyNote();
    if (!state) {
      items.replaceChildren(...[0, 1, 2].map(() => h('div', { class: 'shop-card v3 skeleton', 'aria-hidden': 'true' })));
      return;
    }
    renderUnplaced(state);
    crumbs.replaceChildren();
    if (!open) {
      closeDetail(false);
      items.replaceChildren();
      return;
    }
    let list: Node[];
    if (tab === 'racks') {
      list = state.catalog.racks.map(rackCard);
      crumbs.append(h('span', { class: 'muted' }, 'Rack přijde s předinstalovaným ToR switchem nahoře.'));
    } else if (!vendor) {
      list = vendorTiles(state);
      crumbs.append(h('span', { class: 'muted' }, 'Vyber výrobce – ukazujeme jen sestavy certifikované pro VCF 9.1.'));
    } else {
      const shelf = vendorShelves(state, opts.showTraps()).find((x) => x.vendor === vendor);
      list = (shelf?.items ?? []).map(serverCard);
      const owned = state.devices.filter((d) => d.kind === 'server' && d.vendor === vendor);
      const models = [...new Set(owned.map((d) => d.modelLabel))];
      crumbs.append(
        button('← Výrobci', () => { vendor = null; render(); }, { class: 'link-btn', title: 'Zpět na výrobce (Backspace)' }),
        h('span', { class: 'muted' }, ' / '), h('strong', null, vendor),
        ...(models.length ? [h('span', { class: 'inv-owned' }, ` · Už máš: ${models.join(', ')} (${owned.length}×)`)] : []),
      );
    }
    items.replaceChildren(...list);
    if (detailId) renderDetail(false);
    requestAnimationFrame(updateScrollButtons);
  }

  render();
  return {
    el,
    update(s, p) {
      state = s;
      picked = p;
      render();
    },
    setTab,
    get open() {
      return open;
    },
    setOpen,
    tabRect: (t) => tabButtons.get(t)?.getBoundingClientRect() ?? null,
    dispose() {
      closeDetail(false);
      el.remove();
    },
  };
}
