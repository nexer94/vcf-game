/**
 * Server console shell (UX.md Part III ch. 20): ESX installer + DCUI in one text-mode console.
 *
 * Data-driven: the screens (EsxConsoleScreen, titles / texts only from the spec), the current screen, selection,
 * disks, prefilled values and messages come from the engine's console state machine (snapshot.consoles); every key
 * is a `consoleKey` command – the UI never decides the next screen. Own look (dark console theme, light grey dialog,
 * monospace), no copy of a real product. Keys work on the physical keyboard (when the console has focus) and as
 * buttons (mouse / touch). Inputs are real <input>s (screen readers, IME, mobile).
 */
import type { ConsoleView, EsxConsoleScreen } from '../../modes/sandbox/console';
import type { SandboxSnapshot } from '../../modes/sandbox/snapshot';
import { button, h } from '../dom';
import { sourceButton } from './sourcePopover';
import type { SessionOps } from './sessionPort';

type Key = EsxConsoleScreen['keys'][number]['key'];

const KEY_LABEL: Readonly<Record<Key, string>> = { Enter: 'Enter', F1: 'F1', F2: 'F2', F11: 'F11', Esc: 'Esc', Y: 'Y', N: 'N', Up: '↑', Down: '↓', Space: 'Mezerník' };
const DOM_KEY: Readonly<Record<string, Key>> = { Enter: 'Enter', F1: 'F1', F2: 'F2', F11: 'F11', Escape: 'Esc', y: 'Y', Y: 'Y', n: 'N', N: 'N', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space' };

export interface ServerConsoleOptions {
  readonly ops: SessionOps;
  readonly serverId: string;
  readonly host: HTMLElement;
  readonly announce: (t: string, bad?: boolean) => void;
  readonly onClose: () => void;
}

export interface ServerConsole {
  update(snap: SandboxSnapshot): void;
  /** Esc from outside: true when consumed (console handles Esc as a console key when it has one). */
  readonly el: HTMLElement;
  dispose(): void;
}

export function createServerConsole(o: ServerConsoleOptions): ServerConsole {
  const { ops, serverId } = o;
  let snap = ops.snapshot();
  let lastScreen = '';
  const drafts: Record<string, string> = {};

  const title = h('strong', null, '');
  const methodSel = h('select', { 'aria-label': 'Boot médium instalace' },
    h('option', { value: 'physical' }, 'U serveru (médium)'),
    h('option', { value: 'bmc' }, 'Vzdáleně přes BMC (virtual media)'),
  ) as HTMLSelectElement;
  const stepEl = h('span', { class: 'con-step' });
  const srcSlot = h('span', { class: 'con-src' });
  const head = h('div', { class: 'con-head' },
    button('← Zpět', () => close(), { class: 'btn btn-small', title: 'Zavřít konzoli (hodnoty zůstanou)' }),
    title, methodSel, stepEl, srcSlot);
  const screen = h('div', { class: 'con-screen', role: 'application', 'aria-label': 'Konzole serveru, ovládej klávesami uvedenými dole', tabindex: '0' });
  const summary = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  const keys = h('div', { class: 'con-keys', role: 'toolbar', 'aria-label': 'Klávesy konzole' });
  const batch = h('div', { class: 'con-batch', hidden: true });
  const el = h('section', { class: 'console-overlay', role: 'region', 'aria-label': `Konzole serveru ${serverId}` }, head, h('div', { class: 'con-body' }, screen, keys, batch), summary);
  o.host.appendChild(el);

  methodSel.addEventListener('change', () => {
    const r = ops.dispatch({ type: 'openConsole', serverId, method: methodSel.value as 'physical' | 'bmc' });
    if (!r.ok) {
      o.announce(r.message, true);
      methodSel.value = view()?.method ?? 'physical';
    }
  });

  const view = (): ConsoleView | undefined => snap.consoles?.byServer[serverId];

  function open(): void {
    const v = view();
    if (!v || !v.open) {
      const r = ops.dispatch({ type: 'openConsole', serverId });
      if (!r.ok) o.announce(r.message, true);
    }
  }

  function close(): void {
    ops.dispatch({ type: 'closeConsole', serverId });
    o.onClose();
  }

  function valueFor(v: ConsoleView): string | Record<string, string> | undefined {
    const sc = v.screen;
    if (sc.input === 'password' || sc.input === 'text') return drafts[`${sc.id}:value`] ?? '';
    if (sc.input === 'form') return Object.fromEntries((sc.fields ?? []).map((f) => [f.id, drafts[`${sc.id}:${f.id}`] ?? v.values?.[f.id] ?? '']));
    return undefined;
  }

  function press(k: Key): void {
    const v = view();
    if (!v) return;
    if (!v.screen.keys.some((x) => x.key === k)) return;
    const value = valueFor(v);
    const r = ops.dispatch({ type: 'consoleKey', serverId, key: k, ...(value !== undefined ? { value } : {}) });
    if (!r.ok) o.announce(r.message, true);
  }

  function boxLines(v: ConsoleView): HTMLElement[] {
    const sc = v.screen;
    const out: HTMLElement[] = [];
    for (const line of sc.body ?? []) out.push(h('p', { class: 'con-line', lang: 'en' }, line));
    for (const line of v.info) out.push(h('p', { class: 'con-line con-info' }, line));
    if (sc.input === 'disk' && v.disks) {
      out.push(h('div', { class: 'con-row con-row-head', 'aria-hidden': 'true' }, h('span', null, 'Storage Device'), h('span', null, 'Capacity')));
      v.disks.forEach((d, i) => out.push(h('div', { class: `con-row${i === v.selection ? ' sel' : ''}`, role: 'option', 'aria-selected': String(i === v.selection) },
        h('span', null, `${i === v.selection ? '> ' : '  '}${d.label}`, d.kind === 'data' ? h('small', { class: 'con-hint' }, '  (vSAN – nechat volné · herní nápověda)') : null),
        h('span', null, d.capacityGB >= 1000 ? `${(d.capacityGB / 1000).toFixed(1)} TB` : `${d.capacityGB} GB`))));
    }
    if (sc.input === 'keyboard' && v.keyboardLayouts) {
      const from = Math.max(0, Math.min(v.selection - 4, v.keyboardLayouts.length - 9));
      v.keyboardLayouts.slice(from, from + 9).forEach((k, j) => {
        const i = from + j;
        out.push(h('div', { class: `con-row${i === v.selection ? ' sel' : ''}`, role: 'option', 'aria-selected': String(i === v.selection) }, h('span', null, `${i === v.selection ? '> ' : '  '}${k}`)));
      });
    }
    if (sc.menu) sc.menu.forEach((m, i) => out.push(h('div', { class: `con-row${i === v.selection ? ' sel' : ''}`, role: 'option', 'aria-selected': String(i === v.selection) }, h('span', { lang: 'en' }, `${i === v.selection ? '> ' : '  '}${m.label}`))));
    if (sc.input === 'password' || sc.input === 'text') {
      const key = `${sc.id}:value`;
      const inp = h('input', { type: sc.input === 'password' ? 'password' : 'text', class: 'con-input', 'aria-label': sc.title, autocomplete: 'off', value: drafts[key] ?? '' });
      inp.addEventListener('input', () => (drafts[key] = inp.value));
      out.push(h('label', { class: 'con-field' }, h('span', { lang: 'en' }, sc.input === 'password' ? 'Password:' : 'Value:'), inp));
    }
    if (sc.input === 'form')
      for (const f of sc.fields ?? []) {
        const key = `${sc.id}:${f.id}`;
        const inp = h('input', { type: 'text', class: 'con-input', 'aria-label': f.label, autocomplete: 'off', value: drafts[key] ?? v.values?.[f.id] ?? '' });
        inp.addEventListener('input', () => (drafts[key] = inp.value));
        out.push(h('label', { class: 'con-field' }, h('span', { lang: 'en' }, `${f.label}${f.optional ? ' (optional)' : ''}:`), inp));
      }
    if (v.taskId) {
      const t = snap.tasks.find((x) => x.id === v.taskId);
      if (t) {
        const n = 40;
        const done = Math.round(t.progress * n);
        out.push(h('p', { class: 'con-line con-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(t.progress * 100)) }, `[${'█'.repeat(done)}${'░'.repeat(n - done)}] ${Math.round(t.progress * 100)} %`));
        out.push(h('p', { class: 'con-line con-dim' }, 'trvání je herní (ilustrativní) – čas jde zrychlit 1× 4× 16×'));
      }
    }
    if (v.message) out.push(h('p', { class: `con-line con-msg con-msg-${v.message.level}`, role: v.message.level === 'error' ? 'alert' : 'status' }, v.message.text, v.message.specRef ? ' ' : null, v.message.specRef ? sourceButton({ specRef: v.message.specRef }, 'Zdroj ▾', 'src-btn src-on-dark') : null));
    return out;
  }

  function render(): void {
    const v = view();
    const srv = snap.physical.servers.find((x) => x.id === serverId);
    const name = srv?.esx.network?.hostnameFqdn?.split('.')[0] ?? serverId;
    title.textContent = `Konzole: ${name} · ${srv?.modelName ?? ''}`;
    if (!v) {
      screen.replaceChildren(h('p', { class: 'con-line' }, 'Konzole se připojuje…'));
      keys.replaceChildren();
      return;
    }
    const sc = v.screen;
    methodSel.hidden = v.flow !== 'installer' || sc.id === 'installing' || sc.id === 'complete';
    methodSel.value = v.method;
    stepEl.textContent = v.step && v.flow === 'installer' ? `krok ${v.step.index} / ${v.step.total}` : v.flow === 'dcui' ? 'DCUI' : '';
    srcSlot.replaceChildren(sourceButton({ specRef: sc.specRef }) ?? '');
    const keyLine = sc.keys.map((k) => `(${KEY_LABEL[k.key]}) ${k.label}`).join('    ');
    screen.replaceChildren(
      h('div', { class: 'con-top' }, h('span', null, v.flow === 'installer' ? 'ESX Installer' : 'ESX – Direct Console'), sc.simplified ? h('span', { class: 'con-simpl' }, 'zjednodušená obrazovka (herní)') : null),
      h('div', { class: 'con-dialog' }, h('div', { class: 'con-title', lang: 'en' }, sc.title), ...boxLines(v)),
      h('div', { class: 'con-footer', lang: 'en' }, keyLine),
    );
    keys.replaceChildren(...sc.keys.map((k) => button(h('span', null, h('kbd', null, KEY_LABEL[k.key]), ' ', k.label), () => press(k.key), { class: 'con-key', 'data-key': k.key, 'aria-label': `${KEY_LABEL[k.key]}: ${k.label}` })));
    if (sc.id !== lastScreen) {
      summary.textContent = `${sc.title}. ${(sc.body ?? []).join(' ')} Klávesy: ${sc.keys.map((k) => `${KEY_LABEL[k.key]} ${k.label}`).join(', ')}.`;
      lastScreen = sc.id;
      (screen.querySelector<HTMLElement>('input') ?? screen).focus({ preventScroll: true });
    }
    // "Instalovat stejně na …" (UX 20.3) after the first host – game acceleration.
    const b = snap.consoles?.batch;
    const eligible = b?.candidates.filter((c) => c.eligible) ?? [];
    const notEligible = b?.candidates.filter((c) => !c.eligible) ?? [];
    batch.hidden = !b?.template || (eligible.length === 0 && notEligible.length === 0);
    if (!batch.hidden) {
      batch.replaceChildren(
        h('span', null, `Další hosty se stejnou sestavou: ${eligible.map((c) => c.serverId).join(', ') || '—'} `),
        ...(eligible.length ? [button(`Instalovat stejně na ${eligible.length} ${eligible.length === 1 ? 'host' : eligible.length < 5 ? 'hosty' : 'hostů'}`, () => {
          const r = ops.dispatch({ type: 'installEsxBatch' });
          o.announce(r.ok ? 'Hromadná instalace ESX se stejnými volbami běží.' : r.message, !r.ok);
        }, { class: 'btn btn-small btn-primary' })] : []),
        h('span', { class: 'ui-badge badge-game-simplification', title: 'Hra spustí instalaci se stejnými volbami paralelně – zrychlení, ne krok z dokumentace' }, 'herní zrychlení'),
        ...notEligible.map((c) => h('div', { class: 'muted small' }, c.reason ?? c.serverId)),
      );
    }
  }

  screen.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const inInput = e.target instanceof HTMLInputElement;
    const k = DOM_KEY[e.key];
    if (!k) return;
    if (inInput && (k === 'Y' || k === 'N' || k === 'Space')) return;
    const v = view();
    if (!v || !v.screen.keys.some((x) => x.key === k)) return;
    e.preventDefault();
    e.stopPropagation();
    press(k);
  });

  open();
  snap = ops.snapshot();
  render();
  return {
    el,
    update(next) {
      snap = next;
      render();
    },
    dispose() {
      el.remove();
    },
  };
}
