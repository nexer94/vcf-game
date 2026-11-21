/**
 * Počítač – the admin workstation's own simple "OS" (UX.md §11.1–11.2): top bar (AdminPC, game-time clock,
 * Odejít), dock on the left (tablist), one maximised app window. Original light look – no copy of an existing OS
 * or of Broadcom UI. Pure DOM; the Pixi room underneath is hidden while it is open (UX §11.6).
 *
 * Apps: Plocha · Návrh VCF · Use case · Knihovna; later apps are listed with 🧩 "Zatím ve hře není".
 * Route: #/sandbox/mistnost/pocitac/<app>.
 */
import { formatGameTime } from '../format';
import { button, h } from '../dom';
import { message } from '../messages';
import type { RoomPort } from '../sandbox/sessionPort';
import { createDesignApp, type PcApp } from './designApp';
import { createLibraryApp } from './libraryApp';
import type { ObjectView } from './objectView';
import type { PcUnlock } from './pcData';
import { createUseCaseApp } from './useCaseApp';
import './pc.css';

export const PC_APPS = [
  { id: 'plocha', icon: '⌂', label: 'Plocha' },
  { id: 'navrh', icon: '▦', label: 'Návrh VCF' },
  { id: 'use-case', icon: '⇶', label: 'Use case' },
  { id: 'knihovna', icon: '📖', label: 'Knihovna' },
] as const;
export type PcAppId = (typeof PC_APPS)[number]['id'];
/** Apps the game does not have yet (UX §11.5) – shown, never opened. */
const LATER = [
  { icon: '🌐', label: 'Prohlížeč' },
  { icon: '⚙', label: 'VCF Installer' },
  { icon: '📈', label: 'VCF Operations' },
] as const;

export const isPcAppId = (v: string): v is PcAppId => PC_APPS.some((a) => a.id === v);

export interface PcViewOptions {
  readonly ui: HTMLElement;
  readonly port: RoomPort;
  readonly app: string;
  /** Game time (engine clock). */
  gameTimeMs(): number;
  /** Screen point of the monitor in the room (transition origin). */
  readonly originPx?: { readonly x: number; readonly y: number };
  announce(text: string, bad?: boolean): void;
  /** Navigate to another app (route pocitac/<app>). */
  onApp(app: PcAppId): void;
  onBack(): void;
  onUnlock(u: PcUnlock): void;
  onShowBoard(): void;
}

export interface PcView extends ObjectView {
  setApp(app: string): void;
}

export function createPcView(o: PcViewOptions): PcView {
  let appId: PcAppId = isPcAppId(o.app) ? o.app : 'plocha';
  let current: PcApp | null = null;
  const clock = h('span', { class: 'pc-clock', title: 'Herní čas' });
  const winTitle = h('span', { class: 'pc-win-title' });
  const win = h('div', { class: 'pc-window', role: 'tabpanel', id: 'pc-window', tabindex: '-1' });
  const dockBtns = PC_APPS.map((a, i) =>
    button(h('span', { class: 'pc-dock-inner' }, h('span', { class: 'pc-dock-icon', 'aria-hidden': 'true' }, a.icon), h('span', null, a.label)), () => o.onApp(a.id), {
      class: 'pc-dock-btn', role: 'tab', 'aria-controls': 'pc-window', 'data-app': a.id, title: `${a.label} (Alt+${i + 1})`,
    }),
  );
  const later = LATER.map((a) => h('div', { class: 'pc-dock-btn locked', title: 'Zatím ve hře není (🧩)', 'aria-disabled': 'true' }, h('span', { class: 'pc-dock-inner' }, h('span', { class: 'pc-dock-icon', 'aria-hidden': 'true' }, a.icon), h('span', null, a.label), h('span', { class: 'pc-lock', 'aria-label': 'zatím ve hře není' }, '🧩'))));
  const dock = h('nav', { class: 'pc-dock', 'aria-label': 'Aplikace' }, h('div', { role: 'tablist', 'aria-orientation': 'vertical', class: 'pc-dock-list' }, ...dockBtns), h('div', { class: 'pc-dock-later' }, ...later));
  const screen = h('div', { class: 'pc-screen', role: 'region', 'aria-label': 'Počítač' },
    h('div', { class: 'pc-topbar' },
      h('span', { class: 'pc-brand' }, h('span', { class: 'pc-dot', 'aria-hidden': 'true' }), 'AdminPC'),
      winTitle,
      h('span', { class: 'pc-top-right' }, clock, h('span', { class: 'muted small' }, ' herní čas'), button('⏻ Odejít (Esc)', () => o.onBack(), { class: 'btn btn-small pc-leave' })),
    ),
    h('div', { class: 'pc-body' }, dock, win),
  );
  if (o.originPx) screen.style.transformOrigin = `${o.originPx.x}px ${o.originPx.y - 52}px`;
  o.ui.appendChild(screen);

  const desktop = (): PcApp => {
    const el = h('div', { class: 'pc-app pc-desktop' },
      h('h2', null, 'Pracovní stanice admina'),
      h('p', { class: 'muted' }, 'Odtud navrhuješ VCF a vybíráš, co nasazuješ. Později tu přibude prohlížeč a VCF Installer.'),
      h('div', { class: 'pc-icons' }, ...PC_APPS.filter((a) => a.id !== 'plocha').map((a) =>
        button(h('span', { class: 'pc-icon-inner' }, h('span', { class: 'pc-icon-big', 'aria-hidden': 'true' }, a.icon), h('span', null, a.label)), () => o.onApp(a.id), { class: 'pc-icon' }))),
      message({ type: 'game-tip', compact: true, title: 'Herní zjednodušení', body: 'Počítač je připojený do sítě firmy bez kabelu. Pravý panel Návrh v místnosti ukazuje totéž co aplikace Návrh VCF.' }),
    );
    return { el, escape: () => false, dispose: () => undefined };
  };

  function mount(): void {
    current?.dispose();
    const meta = PC_APPS.find((a) => a.id === appId)!;
    current =
      appId === 'navrh'
        ? createDesignApp({ port: o.port, announce: o.announce, onUnlock: o.onUnlock, onShowBoard: o.onShowBoard })
        : appId === 'use-case'
          ? createUseCaseApp({ port: o.port, announce: o.announce, onOpenDesign: () => o.onApp('navrh') })
          : appId === 'knihovna'
            ? createLibraryApp(o.port)
            : desktop();
    win.replaceChildren(current.el);
    win.setAttribute('aria-label', meta.label);
    winTitle.textContent = meta.label;
    for (const b of dockBtns) {
      const on = b.dataset['app'] === appId;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    o.announce(`Počítač: ${meta.label}.`);
  }
  mount();
  dockBtns.find((b) => b.dataset['app'] === appId)?.focus({ preventScroll: true });

  let lastSec = -1;
  const tick = (): void => {
    const s = Math.floor(o.gameTimeMs() / 1000);
    if (s !== lastSec) {
      lastSec = s;
      clock.textContent = formatGameTime(s * 1000);
    }
  };
  tick();
  const timer = setInterval(tick, 250);

  const onKey = (e: KeyboardEvent): void => {
    if (e.altKey && e.key >= '1' && e.key <= String(PC_APPS.length)) {
      e.preventDefault();
      o.onApp(PC_APPS[Number(e.key) - 1]!.id);
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t?.getAttribute('role') === 'tab' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const i = dockBtns.indexOf(t as HTMLButtonElement);
      const n = dockBtns[(i + (e.key === 'ArrowDown' ? 1 : dockBtns.length - 1)) % dockBtns.length]!;
      n.focus();
      n.click();
    }
  };
  window.addEventListener('keydown', onKey);

  return {
    setApp(app) {
      const next: PcAppId = isPcAppId(app) ? app : 'plocha';
      if (next === appId) return;
      appId = next;
      mount();
    },
    setTransition(alpha, scale) {
      // The monitor's screen grows to the full view (UX §11.1): map the shared 0.96..1 view scale to 0.15..1.
      const k = Math.max(0, Math.min(1, (scale - 0.96) / 0.04));
      screen.style.opacity = String(alpha);
      screen.style.transform = k >= 1 ? '' : `scale(${0.15 + 0.85 * k})`;
    },
    escape() {
      if (current?.escape()) return true;
      if (appId !== 'plocha') {
        o.onApp('plocha');
        return true;
      }
      return false;
    },
    dispose() {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      current?.dispose();
      screen.remove();
    },
  };
}
