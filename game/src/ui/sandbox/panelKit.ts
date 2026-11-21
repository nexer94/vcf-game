/**
 * Small DOM building blocks shared by the object panels (server, DCUI, switch, DNS, host detail).
 * Presentation only – texts of VCF issues come from the model unchanged (lang="en").
 */
import type { ValidationIssue } from '../../model';
import type { TaskView } from '../../modes/sandbox/snapshot';
import { button, h } from '../dom';
import { badge, message, type MessageType } from '../messages';
import type { Provenance } from './panelData';

/** Message type of a model issue (UX §3.2). */
export function issueType(i: ValidationIssue): MessageType {
  if (i.scope === 'game-scope') return 'game-limit';
  return i.severity === 'error' ? 'vcf-error' : 'vcf-warning';
}

function issueHeading(i: ValidationIssue): string {
  if (i.scope === 'game-scope') return 'Herní pravidlo';
  if (i.severity === 'recommendation') return 'Odchylka od doporučení';
  if (i.severity === 'warning') return 'Varování validace';
  return 'Podle dokumentace nelze';
}

/** One model issue as a message box (text = model message, English). */
export function issueBox(i: ValidationIssue, title?: string): HTMLElement {
  return message({
    type: issueType(i),
    compact: true,
    title: title ?? issueHeading(i),
    body: i.message,
    bodyLang: 'en',
    reference: `${i.specRef} · ${i.code}`,
  });
}

export function issueList(issues: readonly ValidationIssue[], empty?: string): HTMLElement {
  const box = h('div', { class: 'op-issues' });
  if (!issues.length) {
    if (empty) box.append(h('p', { class: 'ok-line' }, empty));
    return box;
  }
  for (const i of issues) box.append(issueBox(i));
  return box;
}

/** Badge for a prefilled value's provenance (nothing for current values). */
export function provenanceBadge(p: Provenance): HTMLElement | null {
  if (p.kind === 'documented') return badge('documented', p.specRef);
  if (p.kind === 'game-default') return badge('game-default', p.note);
  return null;
}

/** Labelled form row; `fk` is the focus key used to restore focus after a re-render. */
export function fieldRow(label: string, input: HTMLElement, extra?: (Node | null)[], hint?: string): HTMLElement {
  const id = input.id || `op-f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return h('div', { class: 'op-field' },
    h('label', { for: id }, label),
    h('div', { class: 'op-field-ctl' }, input, ...(extra ?? []).filter((x): x is Node => !!x)),
    hint ? h('div', { class: 'op-hint' }, hint) : null,
  );
}

export function textInput(value: string, fk: string, onInput: (v: string) => void, attrs: Record<string, string> = {}): HTMLInputElement {
  const i = h('input', { type: 'text', value, 'data-fk': fk, spellcheck: 'false', autocomplete: 'off', ...attrs });
  i.addEventListener('input', () => onInput(i.value));
  return i;
}

/** Progress bar of a running task (duration is illustrative – UX label). */
export function taskBar(t: TaskView): HTMLElement {
  const pct = Math.round(t.progress * 100);
  const bar = h('div', { class: 'op-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': t.label },
    h('div', { class: 'op-progress-fill', style: `width:${pct}%` }),
  );
  bar.dataset['task'] = t.id;
  const secs = Math.ceil(t.remainingMs / 1000);
  return h('div', { class: 'op-task' },
    h('div', { class: 'op-task-head' }, h('strong', null, t.label), ' ', h('span', { class: 'muted small', 'data-task-left': t.id }, `${pct} % · zbývá ~${secs} s herního času`)),
    bar,
    h('div', { class: 'op-task-foot' }, 'trvání: ', badge('illustrative', 'trvání úlohy není z dokumentace')),
  );
}

/** Updates task bars in place (cheap; called on pure progress ticks). */
export function updateTaskBars(root: HTMLElement, tasks: readonly TaskView[]): void {
  for (const t of tasks) {
    const pct = Math.round(t.progress * 100);
    const bar = root.querySelector<HTMLElement>(`[data-task="${CSS.escape(t.id)}"]`);
    if (!bar) continue;
    bar.setAttribute('aria-valuenow', String(pct));
    const fill = bar.firstElementChild as HTMLElement | null;
    if (fill) fill.style.width = `${pct}%`;
    const left = root.querySelector<HTMLElement>(`[data-task-left="${CSS.escape(t.id)}"]`);
    if (left) left.textContent = `${pct} % · zbývá ~${Math.ceil(t.remainingMs / 1000)} s herního času`;
  }
}

/** Panel tabs (role=tablist). */
export function tabs<T extends string>(items: readonly (readonly [T, string])[], current: T, onSelect: (t: T) => void, label: string): HTMLElement {
  const bar = h('div', { class: 'op-tabs', role: 'tablist', 'aria-label': label });
  for (const [id, text] of items) {
    bar.append(button(text, () => onSelect(id), { class: `op-tab${id === current ? ' on' : ''}`, role: 'tab', 'aria-selected': String(id === current), 'data-fk': `tab-${id}` }));
  }
  return bar;
}

/** Result line after a command (ok / rejection message + model issues). */
export interface ResultNote {
  readonly ok: boolean;
  readonly text: string;
  readonly issues?: readonly ValidationIssue[];
}

export function resultNote(r: ResultNote | null): HTMLElement | null {
  if (!r) return null;
  return h('div', { class: `op-result ${r.ok ? 'ok' : 'bad'}`, role: 'status' },
    h('div', null, r.ok ? '✓ ' : '✖ ', r.text),
    r.issues?.length ? issueList(r.issues) : null,
  );
}

/** Focus key of the active element inside `root` (restored after re-render). */
export function focusKey(root: HTMLElement): { fk: string; start: number | null; end: number | null } | null {
  const a = document.activeElement as HTMLElement | null;
  if (!a || !root.contains(a)) return null;
  const fk = a.dataset['fk'];
  if (!fk) return null;
  const inp = a as HTMLInputElement;
  let start: number | null = null;
  let end: number | null = null;
  try {
    start = inp.selectionStart ?? null;
    end = inp.selectionEnd ?? null;
  } catch {
    /* not a text input */
  }
  return { fk, start, end };
}

export function restoreFocus(root: HTMLElement, k: ReturnType<typeof focusKey>): void {
  if (!k) return;
  const el = root.querySelector<HTMLElement>(`[data-fk="${CSS.escape(k.fk)}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (k.start !== null && el instanceof HTMLInputElement) {
    try {
      el.setSelectionRange(k.start, k.end ?? k.start);
    } catch {
      /* ignore */
    }
  }
}
