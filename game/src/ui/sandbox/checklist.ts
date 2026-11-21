/**
 * Left tick-off checklist (UX.md Part III ch. 17) – Career levels only (user decision 2026-11-22: Sandbox has no
 * objectives tracker and no bubbles).
 *
 * Exactly ONE active step (engine's "next" objective): title, progress n / N + bar, "Ukaž", "Zdroj ▾", at most one
 * ★ recommendation under it. Done steps of the current group = one grey line with ✓ (max 3 newest), 2 nearest future
 * steps grey, other groups collapsed to "▸ title · N kroků" (click = preview only). Open / bar / hidden states.
 * Pure view over ObjectiveView[] – which step is done is decided by the engine.
 */
import { button, h } from '../dom';
import { checklistModel, isDone } from './checklistModel';
export { checklistModel, type ChecklistModel } from './checklistModel';
import { sourceButton } from './sourcePopover';
import type { ObjectiveView } from './sessionPort';

export type ChecklistMode = 'open' | 'bar' | 'hidden';

export interface ChecklistOptions {
  readonly onShowMe: (o: ObjectiveView) => void;
  readonly onModeChange: (m: ChecklistMode) => void;
  /** Career: no ⤼ skip (UX 17.3). */
  readonly allowSkip: boolean;
  readonly onSkip?: (o: ObjectiveView) => void;
  /** Header extra (Career points, game). */
  readonly headerExtra?: () => string | null;
}

export interface Checklist {
  readonly el: HTMLElement;
  /** Small HUD chip when hidden ("☰ Postup 3/9"). */
  readonly hudChip: HTMLButtonElement;
  update(items: readonly ObjectiveView[], nextId?: string): void;
  /** User / auto mode change. `auto` = layout-driven (does not override a view cap). */
  setMode(m: ChecklistMode, auto?: boolean): void;
  /**
   * Cap of the shown mode for the current view (screen decides): 'open' = no cap, 'bar' = at most the collapsed
   * bar (rack / host view), 'hidden' = only the HUD chip (full-screen PC, whiteboard, console). A user action
   * (chip / bar click, T) "peeks" over the cap until the cap changes again.
   */
  setCap(c: ChecklistMode): void;
  /** Effective (shown) mode = user mode limited by the view cap. */
  readonly mode: ChecklistMode;
  /** The user's own mode (without the view cap). */
  readonly userMode: ChecklistMode;
  /** Bounding rect of the active step (bubble anchor 'ui:checklist'). */
  activeRect(): DOMRect | null;
  dispose(): void;
}

export function createChecklist(o: ChecklistOptions): Checklist {
  let mode: ChecklistMode = 'open';
  let cap: ChecklistMode = 'open';
  let peek = false;
  const RANK: Readonly<Record<ChecklistMode, number>> = { hidden: 0, bar: 1, open: 2 };
  const eff = (): ChecklistMode => (mode === 'hidden' ? 'hidden' : peek ? mode : RANK[cap] < RANK[mode] ? cap : mode);
  let items: readonly ObjectiveView[] = [];
  let nextId: string | undefined;
  let lastActive = '';
  const preview = new Set<string>();
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });
  const el = h('section', { class: 'checklist', role: 'region', 'aria-label': 'Postup' });
  const hudChip = button('', () => setMode('open'), { class: 'hud-chip checklist-chip', title: 'Zobrazit postup (Shift+T)', hidden: true });

  function setMode(m: ChecklistMode, auto = false): void {
    // In a capped view a user "show" (chip / bar click, T) peeks over the cap.
    if (!auto && cap !== 'open' && m !== 'hidden' && RANK[m] > RANK[cap]) {
      peek = true;
      mode = m;
    } else {
      peek = false;
      mode = m;
    }
    render();
    o.onModeChange(m);
  }

  function stepLine(s: ObjectiveView, cls: string, mark: string): HTMLElement {
    return h('li', { class: `cl-step ${cls}` }, h('span', { class: 'cl-mark', 'aria-hidden': 'true' }, mark), h('span', { class: 'cl-title', title: s.title }, s.title));
  }

  function render(): void {
    const m = checklistModel(items, nextId);
    const a = m.active;
    const mode = eff();
    hudChip.hidden = mode !== 'hidden';
    hudChip.textContent = `☰ Postup ${m.done}/${m.total}`;
    el.hidden = mode === 'hidden';
    el.classList.toggle('bar', mode === 'bar');
    const extra = o.headerExtra?.() ?? null;
    if (mode === 'bar') {
      el.replaceChildren(
        button(h('span', { class: 'cl-bar-in' }, '▶ ', h('span', { class: 'cl-title' }, a ? a.title : 'Hotovo'), a?.progress ? h('span', { class: 'muted' }, ` ${a.progress.done}/${a.progress.total}`) : null, ' ▾'), () => setMode('open'), { class: 'cl-bar-btn', 'aria-expanded': 'false', title: 'Rozbalit postup (T)' }),
      );
      return;
    }
    const head = h('div', { class: 'cl-head' },
      h('strong', null, 'Postup'),
      extra ? h('span', { class: 'cl-points', title: 'Body jsou herní mechanika' }, extra) : null,
      h('span', { class: 'cl-count' }, `${m.done} / ${m.total}`),
      button('–', () => setMode('bar'), { class: 'btn btn-small cl-min', 'aria-label': 'Sbalit postup (T)', title: 'Sbalit (T) · Shift+T skrýt' }),
    );
    const list = h('ol', { class: 'cl-list' });
    if (m.olderDone) list.append(h('li', { class: 'cl-step cl-done cl-older' }, h('span', { class: 'cl-mark', 'aria-hidden': 'true' }, '✓'), `${m.olderDone} hotovo`));
    for (const s of m.doneInGroup) list.append(stepLine(s, 'cl-done', '✓'));
    if (a) {
      const prog = a.progress;
      const pct = prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : a.status === 'done' ? 100 : 0;
      const src = a.specRef || a.bubble?.sourceKeys?.length ? sourceButton({ ...(a.specRef ? { specRef: a.specRef } : {}), ...(a.bubble?.sourceKeys ? { keys: a.bubble.sourceKeys } : {}) }) : null;
      const rec = m.recommendation;
      list.append(h('li', { class: `cl-active${m.problem ? ' cl-problem' : ''}`, 'aria-current': 'step' },
        h('div', { class: 'cl-active-title' }, h('span', { 'aria-hidden': 'true' }, m.problem ? '⚠ ' : '▶ '), h('span', { class: 'cl-title' }, a.title), prog ? h('span', { class: 'cl-prog' }, `${prog.done} / ${prog.total}`) : null),
        m.problem ? h('div', { class: 'cl-problem-text' }, 'Bylo hotové – teď to zase chybí. Oprav to.') : null,
        prog ? h('div', { class: 'cl-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(prog.total), 'aria-valuenow': String(prog.done) }, h('span', { style: `width:${pct}%` })) : null,
        h('div', { class: 'cl-actions' },
          a.showMe ? button('Ukaž', () => o.onShowMe(a), { class: 'btn btn-small btn-primary', 'aria-label': `Ukaž: ${a.title}`, 'data-cl': 'showme' }) : null,
          src,
        ),
        rec ? h('div', { class: 'cl-rec' }, h('span', { 'aria-hidden': 'true' }, '★ '), h('span', { class: 'cl-title' }, `doporučeno: ${rec.title}`), rec.bonus ? h('span', { class: 'muted small' }, ' bonus') : null,
          o.allowSkip && o.onSkip ? button('⤼', () => o.onSkip!(rec), { class: 'btn btn-small', 'aria-label': `Přeskočit doporučení: ${rec.title}`, title: 'Přeskočit (nic nemění ve hře)' }) : null) : null,
      ));
    } else if (items.length) list.append(h('li', { class: 'cl-active cl-all' }, '✓ Vše hotovo'));
    for (const s of m.future) list.append(stepLine(s, 'cl-future', '○'));
    for (const g of m.otherGroups) {
      const open = preview.has(g.title);
      const row = h('li', { class: 'cl-group' },
        button(`${open ? '▾' : '▸'} ${g.title} · ${g.steps.length} ${g.steps.length === 1 ? 'krok' : g.steps.length < 5 ? 'kroky' : 'kroků'}`, () => {
          if (open) preview.delete(g.title);
          else preview.add(g.title);
          render();
        }, { class: 'cl-group-btn', 'aria-expanded': String(open) }),
      );
      if (open) row.append(h('ul', { class: 'cl-preview' }, ...g.steps.map((s) => stepLine(s, isDone(s) ? 'cl-done' : 'cl-future', isDone(s) ? '✓' : '○'))));
      list.append(row);
    }
    el.replaceChildren(head, list, ...(items.length ? [] : [h('p', { class: 'muted small' }, 'Úkoly levelu nejsou k dispozici.')]));
    if (a && a.id !== lastActive) {
      const prev = items.find((x) => x.id === lastActive);
      if (lastActive && prev && isDone(prev)) {
        live.textContent = `Hotovo: ${prev.title}. Další krok: ${a.title}.`;
        el.querySelector('.cl-active')?.classList.add('cl-enter');
      }
      lastActive = a.id;
    }
  }

  el.append(live);
  render();
  return {
    el,
    hudChip,
    update(next, nid) {
      items = next;
      nextId = nid;
      render();
      el.append(live);
    },
    setMode,
    setCap(c) {
      if (c === cap) return;
      cap = c;
      peek = false;
      render();
    },
    get mode() {
      return eff();
    },
    get userMode() {
      return mode;
    },
    activeRect: () => el.querySelector('.cl-active')?.getBoundingClientRect() ?? null,
    dispose() {
      el.remove();
      hudChip.remove();
    },
  };
}
