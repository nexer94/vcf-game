/**
 * Floating object panel host of the server room / rack view: at most one panel (server, switch, DNS) at a time,
 * re-rendered on structural snapshot changes (snapshot.revision) and only task bars on pure progress ticks.
 * Without session ops (demo room = local fallback) it shows a game-limit note instead.
 */
import './panels.css';
import type { SandboxSnapshot } from '../../modes/sandbox/snapshot';
import { button, h } from '../dom';
import { message } from '../messages';
import { createDnsPanel } from './dnsPanel';
import type { ServerTab } from './panelData';
import { createServerPanel, type ObjectPanel } from './serverPanel';
import type { RoomPort } from './sessionPort';
import { createSwitchPanel } from './switchPanel';

export interface ObjectPanelsOptions {
  readonly ui: HTMLElement;
  readonly port: () => RoomPort | null;
  readonly announce: (text: string, bad?: boolean) => void;
  readonly onOpenHost: (serverId: string) => void;
}

export interface ObjectPanels {
  openServer(id: string, tab?: ServerTab): void;
  openSwitch(id: string): void;
  openDns(): void;
  close(): void;
  readonly openId: string | null;
  /** Port state changed. */
  refresh(): void;
  /** Esc: closes the panel; true when consumed. */
  escape(): boolean;
  dispose(): void;
}

export function createObjectPanels(o: ObjectPanelsOptions): ObjectPanels {
  const host = h('div', { class: 'op-host', hidden: true });
  o.ui.appendChild(host);
  let current: (ObjectPanel & { setTab?: (t: ServerTab) => void }) | null = null;
  let openId: string | null = null;
  let lastRev = -1;
  let opener: HTMLElement | null = null;

  const close = (): void => {
    current?.dispose();
    current = null;
    openId = null;
    host.hidden = true;
    host.replaceChildren();
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    opener = null;
  };

  function show(id: string, make: (ops: NonNullable<RoomPort['ops']>) => ObjectPanel & { setTab?: (t: ServerTab) => void }, tab?: ServerTab): void {
    const ops = o.port()?.ops;
    if (openId === id && current) {
      if (tab && current.setTab) current.setTab(tab);
      return;
    }
    const prevOpener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    current?.dispose();
    current = null;
    opener = prevOpener;
    host.hidden = false;
    host.replaceChildren();
    openId = id;
    if (!ops) {
      host.append(h('section', { class: 'op-panel', role: 'dialog', 'aria-label': 'Panel' },
        message({ type: 'game-limit', title: 'V ukázce není k dispozici', body: 'Panely serveru, switche a DNS fungují nad tvou serverovnou (Sandbox), ne v ilustrativní ukázce.' }),
        button('Zavřít', close, { class: 'btn btn-small' })));
      return;
    }
    current = make(ops);
    lastRev = ops.snapshot().revision;
    host.append(current.el);
    current.el.querySelector<HTMLElement>('.op-tab.on, button, input, select')?.focus({ preventScroll: true });
  }

  return {
    openServer(id, tab) {
      show(`server:${id}`, (ops) => createServerPanel({ ops, serverId: id, ...(tab ? { tab } : {}), announce: o.announce, onOpenHost: (sid) => o.onOpenHost(sid), onOpenDns: () => this.openDns(), onClose: close }), tab);
    },
    openSwitch(id) {
      show(`switch:${id}`, (ops) => createSwitchPanel({ ops, switchId: id, announce: o.announce, onClose: close }));
    },
    openDns() {
      show('dns', (ops) => createDnsPanel({ ops, announce: o.announce, onClose: close }));
    },
    close,
    get openId() {
      return openId;
    },
    refresh() {
      const ops = o.port()?.ops;
      if (!current || !ops) return;
      const snap: SandboxSnapshot = ops.snapshot();
      const structural = snap.revision !== lastRev;
      lastRev = snap.revision;
      current.update(snap, structural);
    },
    escape() {
      if (host.hidden) return false;
      close();
      return true;
    },
    dispose() {
      current?.dispose();
      host.remove();
    },
  };
}
