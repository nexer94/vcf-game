/**
 * Počítač – the admin workstation's own simple "OS" (UX.md §11.1–11.2): top bar (AdminPC, game-time clock,
 * Odejít), dock on the left (tablist), one maximised app window. Original light look – no copy of an existing OS
 * or of Broadcom UI. Pure DOM; the Pixi room underneath is hidden while it is open (UX §11.6).
 *
 * Apps: Plocha · Návrh VCF · Use case · Knihovna · O hře (disclaimer in the footer, GRAPHICS.md T0).
 * Later "console" apps (VCF Installer, VCF Operations) open only a placeholder window in the dark `console`
 * theme (T3) that says they are not in the game yet (game limitation) - no VCF behaviour is simulated there.
 * Own line icons (ui/icons.ts), no emoji.
 * Route: #/sandbox/mistnost/pocitac/<app>.
 */
import { formatGameTime } from '../format';
import { button, h } from '../dom';
import { message } from '../messages';
import { icon, type IconName } from '../icons';
import { disclaimer } from '../screens/disclaimer';
import { VCF_VERSION } from '../version';
import type { RoomPort } from '../sandbox/sessionPort';
import { createDesignApp, type PcApp } from './designApp';
import { createLibraryApp } from './libraryApp';
import type { ObjectView } from './objectView';
import type { PcUnlock } from './pcData';
import { createUseCaseApp } from './useCaseApp';
import './pc.css';

export const PC_APPS = [
  { id: 'plocha', icon: 'computer', label: 'Plocha' },
  { id: 'navrh', icon: 'cluster', label: 'Návrh VCF' },
  { id: 'use-case', icon: 'domain', label: 'Use case' },
  { id: 'knihovna', icon: 'doc', label: 'Knihovna' },
  { id: 'o-hre', icon: 'info', label: 'O hře' },
] as const satisfies readonly { id: string; icon: IconName; label: string }[];
/** Console-type apps the game does not simulate yet (UX §11.5): a placeholder window in the console theme. */
export const PC_LATER = [
  { id: 'installer', icon: 'settings', label: 'VCF Installer' },
  { id: 'operations', icon: 'fleet', label: 'VCF Operations' },
] as const satisfies readonly { id: string; icon: IconName; label: string }[];
export type PcAppId = (typeof PC_APPS)[number]['id'] | (typeof PC_LATER)[number]['id'];

const ALL_APPS: readonly { readonly id: PcAppId; readonly icon: IconName; readonly label: string }[] = [...PC_APPS, ...PC_LATER];
/** Apps rendered with `data-theme="console"` (GRAPHICS.md T3) - education apps stay light. */
const CONSOLE_APPS: ReadonlySet<PcAppId> = new Set(PC_LATER.map((a) => a.id));

export const isPcAppId = (v: string): v is PcAppId => ALL_APPS.some((a) => a.id === v);

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
  const dockBtns = ALL_APPS.map((a) => {
    const later = CONSOLE_APPS.has(a.id);
    const i = PC_APPS.findIndex((p) => p.id === a.id);
    return button(
      h('span', { class: 'pc-dock-inner' },
        h('span', { class: 'pc-dock-icon' }, icon(a.icon, { size: 20 })),
        h('span', null, a.label),
        later ? h('span', { class: 'pc-lock', title: 'Zatím ve hře není (omezení hry)' }, icon('puzzle', { label: 'zatím ve hře není' })) : null,
      ),
      () => o.onApp(a.id),
      {
        class: `pc-dock-btn${later ? ' locked' : ''}`, role: 'tab', 'aria-controls': 'pc-window', 'data-app': a.id,
        title: later ? `${a.label} – zatím ve hře není` : `${a.label} (Alt+${i + 1})`,
      },
    );
  });
  const dock = h('nav', { class: 'pc-dock', 'aria-label': 'Aplikace' },
    h('div', { role: 'tablist', 'aria-orientation': 'vertical', class: 'pc-dock-list' }, ...dockBtns.slice(0, PC_APPS.length), h('div', { class: 'pc-dock-sep small muted', role: 'presentation' }, 'Konzole (později)'), ...dockBtns.slice(PC_APPS.length)),
  );
  const screen = h('div', { class: 'pc-screen', role: 'region', 'aria-label': 'Počítač' },
    h('div', { class: 'pc-topbar' },
      h('span', { class: 'pc-brand' }, h('span', { class: 'pc-dot', 'aria-hidden': 'true' }), 'AdminPC'),
      winTitle,
      h('span', { class: 'pc-top-right' }, clock, h('span', { class: 'muted small' }, ' herní čas'), button('Odejít (Esc)', () => o.onBack(), { class: 'btn btn-small pc-leave' })),
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
        button(h('span', { class: 'pc-icon-inner' }, h('span', { class: 'pc-icon-big' }, icon(a.icon, { size: 24 })), h('span', null, a.label)), () => o.onApp(a.id), { class: 'pc-icon' }))),
      message({ type: 'game-tip', compact: true, title: 'Herní zjednodušení', body: 'Počítač je připojený do sítě firmy bez kabelu. Pravý panel Návrh v místnosti ukazuje totéž co aplikace Návrh VCF.' }),
    );
    return { el, escape: () => false, dispose: () => undefined };
  };

  /** "O hře": what the game is, modelled version, disclaimer in the footer (T0). */
  const about = (): PcApp => {
    const el = h('div', { class: 'pc-app pc-about' },
      h('h2', null, 'O hře'),
      h('p', null, `Výuková hra / simulátor, který modeluje architekturu VMware Cloud Foundation podle veřejné dokumentace (modelovaná verze ${VCF_VERSION}).`),
      h('p', { class: 'muted' }, 'Barvy a vzhled jsou vlastní herní – jen inspirace barevným světem enterprise konzolí, ne oficiální značka. Ceny, měna a čas jsou herní mechanika.'),
      h('footer', { class: 'pc-about-foot' }, disclaimer()),
    );
    return { el, escape: () => false, dispose: () => undefined };
  };

  /** Console-type app the game does not have yet: dark console theme + game limitation (no VCF behaviour). */
  const later = (label: string): PcApp => {
    const el = h('div', { class: 'pc-app pc-console-app' },
      h('h2', null, label),
      h('p', { class: 'muted' }, 'Konzolová aplikace – v tmavém tématu „console“.'),
      message({ type: 'game-limit', title: 'Zatím ve hře není', body: `${label} hra zatím nesimuluje. Až přibude, kroky budou kopírovat pořadí ze specifikace (ne vzhled produktu).` }),
    );
    return { el, escape: () => false, dispose: () => undefined };
  };

  function mount(): void {
    current?.dispose();
    const meta = ALL_APPS.find((a) => a.id === appId)!;
    if (CONSOLE_APPS.has(appId)) win.setAttribute('data-theme', 'console');
    else win.removeAttribute('data-theme');
    current =
      CONSOLE_APPS.has(appId)
        ? later(meta.label)
        : appId === 'o-hre'
          ? about()
          : appId === 'navrh'
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
