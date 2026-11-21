/**
 * Bottom bar of the server room: shop + backpack ("V batohu") – UX.md §2.3.
 * Data come from RoomState.catalog (model catalog from the BCG dataset, game prices from the economy layer).
 * The UI shows; it never decides what is certified or which profile a node has (model fields).
 */
import { button, docLink, h } from '../dom';
import { badge, chip } from '../messages';
import { VENDOR_TAG } from '../../render/room/palette';
import type { InventoryEntry, RoomState, ShopPartItem, ShopRackItem, ShopServerItem, ShopSwitchItem } from './sessionPort';

import type { ShopTab } from './panelData';
export type { ShopTab };

const TABS: readonly [ShopTab, string][] = [
  ['backpack', 'V batohu'],
  ['racks', 'Racky'],
  ['servers', 'Servery'],
  ['switches', 'Switche'],
  ['cables', 'Kabely'],
  ['drives', 'Disky'],
  ['nics', 'NIC'],
];

const MAX_COMPARE = 3;
const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
export const formatPrice = (n: number): string => `¤ ${n.toLocaleString('cs-CZ')}`;

export interface ShopOptions {
  readonly onBuy: (itemId: string) => void;
  /** Pick a backpack item for placement (null = cancel). */
  readonly onPick: (entry: InventoryEntry | null) => void;
  readonly onSell: (id: string) => void;
}

export interface ShopHandle {
  readonly el: HTMLElement;
  update(state: RoomState, pickedId: string | null): void;
  setTab(tab: ShopTab): void;
  /** Highlight a tab with a dot (tracker wants something from it). */
  dispose(): void;
}

function priceLine(price: number): HTMLElement {
  return h('div', { class: 'card-price' }, h('strong', null, formatPrice(price)), ' ', badge('game-price'));
}

function serverSummary(s: ShopServerItem): { cpu: string; ram: string; disks: string; nics: string } {
  const disks = s.drives.length ? s.drives.map((d) => `${d.count}× ${d.capacityTB} TB ${d.iface}`).join(' + ') : 'bez disků';
  const nics = s.nics.length ? s.nics.map((n) => `${n.count * n.ports}× ${n.speedsGbE.join('/')} GbE`).join(' + ') : 'bez NIC';
  return { cpu: `${s.sockets}× CPU · ${s.sockets * s.coresPerSocket} jader`, ram: `${s.ramGB} GB RAM`, disks, nics };
}

export function createShop(opts: ShopOptions): ShopHandle {
  let tab: ShopTab = 'racks';
  let state: RoomState | null = null;
  let picked: string | null = null;
  let vendor = '';
  let certifiedOnly = false;
  let sort: 'price' | 'cores' | 'ram' = 'price';
  const compare = new Set<string>();

  const tabs = h('div', { class: 'inv-tabs', role: 'tablist', 'aria-label': 'Kategorie (klávesy 1–7)' });
  const tools = h('div', { class: 'inv-tools' });
  const items = h('div', { class: 'inv-items', role: 'tabpanel' });
  const comparePanel = h('div', { class: 'compare-panel', hidden: true, role: 'dialog', 'aria-label': 'Porovnání serverů' });
  const el = h('footer', { class: 'room-inv', 'aria-label': 'Obchod a inventář' },
    h('div', { class: 'inv-head' }, tabs, tools),
    items,
    comparePanel,
  );
  const tabButtons = new Map<ShopTab, HTMLButtonElement>();
  for (const [id, label] of TABS) {
    const b = button(label, () => setTab(id), { class: 'inv-tab', role: 'tab', 'aria-selected': 'false', 'data-tab': id });
    tabButtons.set(id, b);
    tabs.appendChild(b);
  }
  el.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const n = Number(e.key);
    const t = Number.isInteger(n) && n >= 1 ? TABS[n - 1] : undefined;
    if (!t) return;
    e.preventDefault();
    setTab(t[0]);
    tabButtons.get(t[0])?.focus();
  });

  function setTab(t: ShopTab): void {
    tab = t;
    render();
  }

  function renderTools(): void {
    tools.replaceChildren();
    if (tab === 'servers' && state) {
      const vendors = [...new Set(state.catalog.servers.map((s) => s.vendor))];
      const sel = h('select', { 'aria-label': 'Vendor' }, h('option', { value: '' }, 'všichni vendoři'), ...vendors.map((v) => h('option', { value: v }, v)));
      sel.value = vendor;
      sel.addEventListener('change', () => {
        vendor = sel.value;
        render();
      });
      const cert = h('input', { type: 'checkbox', id: 'shop-cert' });
      cert.checked = certifiedOnly;
      cert.addEventListener('change', () => {
        certifiedOnly = cert.checked;
        render();
      });
      const so = h('select', { 'aria-label': 'Řazení' }, h('option', { value: 'price' }, '⇅ cena'), h('option', { value: 'cores' }, '⇅ jádra'), h('option', { value: 'ram' }, '⇅ RAM'));
      so.value = sort;
      so.addEventListener('change', () => {
        sort = so.value as typeof sort;
        render();
      });
      const cmp = button(`Porovnat (${compare.size})`, () => toggleCompare(), { class: 'btn btn-small', disabled: compare.size < 2, 'aria-expanded': String(!comparePanel.hidden) });
      tools.append(sel, h('label', { class: 'inv-check', for: 'shop-cert' }, cert, ' jen certified 9.1'), so, cmp);
    }
    tools.append(h('span', { class: 'inv-note' }, 'Ceny: ', badge('game-price'), ' · Sandbox: peníze ∞'));
  }

  function toggleCompare(force?: boolean): void {
    comparePanel.hidden = force !== undefined ? !force : !comparePanel.hidden;
    renderCompare();
    renderTools();
  }

  function renderCompare(): void {
    comparePanel.replaceChildren();
    if (comparePanel.hidden || !state) return;
    const list = state.catalog.servers.filter((s) => compare.has(s.id));
    const rows: [string, (s: ShopServerItem) => Node | string][] = [
      ['Vendor', (s) => s.vendor],
      ['Model', (s) => s.model],
      ['CPU', (s) => serverSummary(s).cpu],
      ['RAM', (s) => `${s.ramGB} GB`],
      ['Disky', (s) => serverSummary(s).disks],
      ['Kapacita', (s) => `${s.capacityTB} TB`],
      ['NIC', (s) => serverSummary(s).nics],
      ['Boot', (s) => s.boot],
      ['Profil vSAN ESA (model)', (s) => s.profile ?? 'pod HCI-SM'],
      ['Certifikace ESXi 9.1 (BCG)', (s) => (s.certified91 ? '✔ ano' : '✖ ne')],
      ['Cena', (s) => formatPrice(s.price)],
    ];
    comparePanel.append(
      h('div', { class: 'compare-head' }, h('strong', null, 'Porovnání'), button('✖', () => toggleCompare(false), { class: 'btn btn-small', 'aria-label': 'Zavřít porovnání' })),
      h('table', { class: 'compare-table' },
        h('thead', null, h('tr', null, h('th', null, ''), ...list.map((s) => h('th', null, `${s.vendor} ${s.model}`, h('div', { class: 'card-variant' }, s.id))))),
        h('tbody', null, ...rows.map(([label, f]) => h('tr', null, h('th', { scope: 'row' }, label), ...list.map((s) => h('td', null, f(s)))))),
      ),
      h('p', { class: 'muted small' }, 'Splnění požadavků VCF se ukáže až podle zvoleného návrhu (bez návrhu neradíme naslepo). Cena: ', badge('game-price')),
    );
  }

  function serverCard(s: ShopServerItem): HTMLElement {
    const sum = serverSummary(s);
    const cmp = h('input', { type: 'checkbox', 'aria-label': `Porovnat ${s.vendor} ${s.model}` });
    cmp.checked = compare.has(s.id);
    cmp.disabled = !cmp.checked && compare.size >= MAX_COMPARE;
    cmp.addEventListener('change', () => {
      if (cmp.checked) compare.add(s.id);
      else compare.delete(s.id);
      render();
    });
    const dataDate = state?.catalog.datasetFetchedAt.slice(0, 10) ?? '';
    return h('article', { class: 'shop-card', 'aria-label': `${s.vendor} ${s.model} (${s.id})` },
      h('div', { class: 'card-title' },
        h('span', { class: 'vendor-tag', style: `background:${css(VENDOR_TAG[s.vendor])}` }, s.vendor),
        h('span', { class: 'card-model', title: s.model }, s.model),
      ),
      h('div', { class: 'card-line card-variant', title: 'Sestava (konfigurace) z katalogu – stejný model může mít víc sestav' }, `sestava ${s.id}`),
      h('div', { class: 'card-line' }, `${s.rackUnits}U · ${sum.cpu} · ${sum.ram}`),
      h('div', { class: 'card-line', title: s.drives.map((d) => d.label).join(', ') }, sum.disks),
      h('div', { class: 'card-line', title: s.nics.map((n) => n.label).join(', ') }, sum.nics),
      h('div', { class: 'card-badges' },
        s.profile
          ? chip(s.profile + (s.profileNetworkLimited ? ' ⚠' : ''), 'badge-profile', `Profil vSAN ESA odvozený modelem z konfigurace (spec 15 §6.1)${s.profileNetworkLimited ? ' – síť drží uzel pod jeho výpočetním profilem' : ''}`)
          : chip('pod HCI-SM', 'badge-profile badge-muted', 'Konfigurace nesplňuje minima nejmenšího profilu vSAN ESA (spec 15 §6.1)'),
        s.certified91
          ? h('a', { class: 'ui-badge badge-cert', href: s.bcgUrl, target: '_blank', rel: 'noopener noreferrer', title: `Broadcom Compatibility Guide uvádí podporu „ESXi 9.1“ pro tento model (export dat ${dataDate}). Ověřují se i NIC a HBA.` }, '✔ certified ESXi 9.1 ↗')
          : chip('není certifikováno', 'badge-muted', 'BCG pro tento model neuvádí ESXi 9.1'),
      ),
      h('div', { class: 'card-foot' }, priceLine(s.price), h('label', { class: 'inv-check' }, cmp, ' porovnat'), button('Koupit', () => opts.onBuy(s.id), { class: 'btn btn-small btn-primary' })),
    );
  }

  function genericCard(it: ShopSwitchItem | ShopRackItem): HTMLElement {
    const lines = it.kind === 'switch'
      ? [`${it.ports}× port · ${it.speedsGbE.join('/')} GbE`, `MTU portu ${it.defaultPortMtu} (výchozí) – max ${it.maxMtu}`, `${it.rackUnits}U do racku`]
      : [`${it.heightU}U · postav na volnou dlaždici`];
    return h('article', { class: 'shop-card', 'aria-label': it.label },
      h('div', { class: 'card-title' }, h('span', { class: 'card-model' }, it.label)),
      ...lines.map((l) => h('div', { class: 'card-line' }, l)),
      h('div', { class: 'card-badges' }, chip('generický (herní zjednodušení)', 'badge-generic', 'No-name položka hry – hodnoty jsou herní, ne z dokumentace'), it.kind === 'switch' ? badge('game-default', 'MTU 1500 generického switche') : null),
      h('div', { class: 'card-foot' }, priceLine(it.price), button('Koupit', () => opts.onBuy(it.id), { class: 'btn btn-small btn-primary' })),
    );
  }

  function partCard(it: ShopPartItem): HTMLElement {
    return h('article', { class: 'shop-card shop-card-part', 'aria-label': it.label },
      h('div', { class: 'card-title' }, h('span', { class: 'card-model', title: it.label }, it.label)),
      h('div', { class: 'card-line' }, it.detail, it.oem ? ` · OEM ${it.oem}` : ''),
      h('div', { class: 'card-badges' }, it.bcgUrl ? docLink('BCG ↗', it.bcgUrl) : null),
      h('div', { class: 'card-foot' }, priceLine(it.price), button('Koupit', () => undefined, { class: 'btn btn-small', disabled: true, title: 'Výměna dílů v serveru zatím ve hře není (🧩 omezení hry)' })),
    );
  }

  function backpack(entries: readonly InventoryEntry[]): Node[] {
    if (!entries.length) return [h('p', { class: 'inv-empty' }, 'Batoh je prázdný. Kup něco v obchodě – koupené věci tu čekají, než je umístíš.')];
    return entries.map((e) => {
      const isPicked = picked === e.id;
      const hint = e.kind === 'rack' ? 'klikni na dlaždici v místnosti' : 'klikni na rack (nebo volnou pozici v pohledu racku)';
      return h('article', { class: `shop-card bp-card${isPicked ? ' picked' : ''}`, 'aria-label': e.label },
        h('div', { class: 'card-title' }, h('span', { class: `inv-icon icon-${e.kind === 'rack' ? 'rack' : e.kind === 'switch' ? 'switch' : 'server-a'}`, 'aria-hidden': 'true' }), h('span', { class: 'card-model' }, e.label)),
        h('div', { class: 'card-line' }, isPicked ? `Vybráno – ${hint}` : e.kind === 'rack' ? 'Rack' : e.kind === 'switch' ? 'Switch' : 'Server'),
        h('div', { class: 'card-foot' },
          button(isPicked ? 'Zrušit' : 'Umístit', () => opts.onPick(isPicked ? null : e), { class: 'btn btn-small btn-primary', 'aria-pressed': String(isPicked) }),
          button('Prodat', () => opts.onSell(e.id), { class: 'btn btn-small', title: 'Sandbox vrací 100 % herní ceny' }),
        ),
      );
    });
  }

  function render(): void {
    for (const [id, b] of tabButtons) b.setAttribute('aria-selected', String(id === tab));
    const bp = tabButtons.get('backpack')!;
    const n = state?.inventory.length ?? 0;
    bp.textContent = `V batohu (${n})`;
    bp.classList.toggle('has-dot', n > 0);
    renderTools();
    if (!state) {
      items.replaceChildren(...[0, 1, 2].map(() => h('div', { class: 'shop-card skeleton', 'aria-hidden': 'true' })));
      return;
    }
    const c = state.catalog;
    let list: Node[];
    switch (tab) {
      case 'backpack':
        list = backpack(state.inventory);
        break;
      case 'racks':
        list = c.racks.map(genericCard);
        break;
      case 'switches':
        list = c.switches.map(genericCard);
        break;
      case 'servers': {
        let s = c.servers.filter((x) => (!vendor || x.vendor === vendor) && (!certifiedOnly || x.certified91));
        s = [...s].sort((a, b) => (sort === 'price' ? a.price - b.price : sort === 'cores' ? b.sockets * b.coresPerSocket - a.sockets * a.coresPerSocket : b.ramGB - a.ramGB));
        list = s.length
          ? s.map(serverCard)
          : [h('p', { class: 'inv-empty' }, 'Žádná položka neodpovídá filtrům. ', button('Zrušit filtry', () => { vendor = ''; certifiedOnly = false; render(); }, { class: 'btn btn-small' }))];
        break;
      }
      case 'cables':
        list = [h('p', { class: 'inv-empty' }, 'Kabely zapojuješ v pohledu racku (klik na rack v místnosti). V Sandboxu jsou zdarma a nekonečné – ', chip('herní zjednodušení', 'badge-generic'), '.')];
        break;
      case 'drives':
        list = c.drives.map(partCard);
        break;
      case 'nics':
        list = c.nics.map(partCard);
        break;
    }
    items.replaceChildren(...list);
    renderCompare();
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
    dispose() {
      el.remove();
    },
  };
}
