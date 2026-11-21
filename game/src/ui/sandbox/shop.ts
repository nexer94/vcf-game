/**
 * Shop v3 (UX.md Part III ch. 19.1–19.2): two tabs only – Racky / Servery.
 *   Servery: step 1 = vendor tiles (Dell · HPE · Lenovo · Cisco · Supermicro, colour tag + text, no logos),
 *            step 2 = fixed-size cards of the vendor's starter configurations (15 B.3; traps hidden unless enabled).
 *   Card: mini front in U scale, name, cores · RAM / drives · NIC ports, "✓ certified VCF 9.1" (Zdroj popover with the
 *   BCG page), vSAN ESA profile, price (game) and "Koupit" → placement right away (no backpack tab).
 * Not placed items = chip "Nezaracováno: N ▸" in the shop bar. Data come from RoomState.catalog (engine); the UI
 * never decides certification, profile or trap status.
 */
import { button, h } from '../dom';
import { chip } from '../messages';
import { VENDOR_TAG } from '../../render/room/palette';
import type { HwVendor } from '../../model';
import { openSourcePopover } from './sourcePopover';
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
  const unplacedPop = h('div', { class: 'unplaced-pop', role: 'dialog', 'aria-label': 'Nezaracováno', hidden: true });
  const el = h('footer', { class: 'room-inv v3', 'aria-label': 'Obchod' },
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
  items.addEventListener('scroll', () => updateScrollButtons());
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

  function serverCard(s: ShopServerItem): HTMLElement {
    const cores = s.sockets * s.coresPerSocket;
    const drives = s.drives.reduce((n, d) => n + d.count, 0);
    const iface = [...new Set(s.drives.map((d) => d.iface))].join('/');
    const nicPorts = s.nics.reduce((n, x) => n + x.count * x.ports, 0);
    const speed = s.maxNicGbE || Math.max(0, ...s.nics.flatMap((n) => n.speedsGbE));
    const cert = s.certified91
      ? button(h('span', null, '✓ certified VCF 9.1'), () => openSourcePopover(cert!, { extra: { label: `Broadcom Compatibility Guide: ${s.vendor} ${s.model}`, url: s.bcgUrl }, specRef: '15-hardware §2.2' }), { class: 'ui-badge badge-cert', title: 'Broadcom Compatibility Guide uvádí ESXi 9.1 – klik = zdroj' })
      : null;
    const dev = s.starterStatus === 'dev';
    const trap = s.starterStatus === 'req' || s.starterStatus === 'ext';
    const buyBtn = button(`Koupit`, () => undefined, { class: 'btn btn-small btn-primary', title: 'Koupit a umístit · Shift+klik = koupit 4 (cluster)', 'aria-label': `Koupit ${s.vendor} ${s.model}` });
    buyBtn.addEventListener('click', (e) => buy(s.id, e));
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
    return h('article', { class: `shop-card v3${trap ? ' trap' : ''}`, 'aria-label': `${s.vendor} ${s.model}` },
      h('div', { class: 'card-top' },
        miniFront(s.rackUnits, s.vendor),
        h('div', { class: 'card-top-text' },
          h('div', { class: 'card-model', title: `${s.model} (sestava ${s.id})` }, s.model.replace(/^(Dell |HPE |Lenovo |Cisco |Supermicro )/i, '')),
          h('div', { class: 'card-line' }, `${cores} jader · ${s.ramGB} GB`))),
      h('div', { class: 'card-line' }, `${drives}× ${iface || 'disk'} · ${nicPorts}× ${speed ? `${speed}G` : 'NIC'} · `, uLabel(s.rackUnits, s.rackUnitsGameDefault !== false)),
      h('div', { class: 'card-badges' },
        cert,
        dev ? chip('odchylka', 'badge-dev', s.note || 'Sestava se odchyluje od doporučení (15 B.3)') : trap ? chip('nevhodná', 'badge-trap', s.note || 'Nevhodná sestava (15 B.3)') : s.profile ? chip(s.profile.replace(/^vsan-esa-/i, '').replace(/^vSAN-/, 'ESA '), 'badge-profile', `Profil vSAN ESA odvozený modelem z konfigurace (15 §6.1)${s.profileNetworkLimited ? ' – omezeno sítí' : ''}`) : null,
      ),
      h('div', { class: 'card-foot' }, h('strong', { class: 'card-price' }, formatPrice(s.price)), buyBtn),
    );
  }

  function rackCard(r: ShopRackItem): HTMLElement {
    const b = button('Koupit', () => opts.onBuy(r.id, 1), { class: 'btn btn-small btn-primary', 'aria-label': `Koupit ${r.label}` });
    return h('article', { class: 'shop-card v3 rack-card', 'aria-label': r.label },
      h('div', { class: 'card-top' },
        h('span', { class: 'mini-rack', style: `height:${Math.round(r.heightU * 0.7)}px`, 'aria-hidden': 'true' }, h('span', { class: 'mini-rack-tor' })),
        h('div', { class: 'card-top-text' }, h('div', { class: 'card-model', title: r.label }, r.label), h('span', { class: 'mini-u-label' }, `${r.heightU}U`))),
      h('div', { class: 'card-line' }, 'ToR switch nahoře v ceně'),
      h('div', { class: 'card-badges' }, chip('generický · herní', 'badge-generic', 'No-name rack a ToR switch – herní zjednodušení, hodnoty nejsou z dokumentace')),
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
      el.remove();
    },
  };
}
