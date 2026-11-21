/**
 * Speech bubble "co teď" (UX.md Part III ch. 18) – Career levels only.
 *
 * - Always at most ONE bubble with the instruction of the active checklist step (ObjectiveView.bubble).
 * - Anchor: 'avatar' | 'object:<kind>:<id|first>' | 'ui:<id>' – resolved by the screen to a screen rect; when the anchor
 *   is off screen the bubble sits at the avatar with an arrow "→" and "Ukaž".
 * - × / Esc -> small badge "…" over the anchor; click / B re-opens. A new active step re-opens it.
 * - Events (first purchase, first validation error…) temporarily replace the text ("Hotovo!" / "Pozor:"), back after
 *   "Rozumím" or 6 s – never a second bubble.
 * - DOM over the canvas (sharp text, screen readers: role=status, aria-live=polite). Position recomputed only on
 *   camera / layout change (`reposition()`), not every frame.
 */
import { button, h } from '../dom';
import { placePopover, rectInside, type Rect } from './layoutZones';
import { sourceButton } from './sourcePopover';
import type { ObjectiveBubbleView } from './sessionPort';

export interface BubbleHost {
  /** Screen rect of an anchor (null = not on screen / unknown). */
  anchorRect(anchor: string): Rect | null;
  /** Obstacles (HUD, checklist, right panel, shop). */
  obstacles(): readonly Rect[];
  /** Free scene rect. */
  scene(): Rect;
  /** "Ukaž" – move the camera / open the view of the anchor. */
  onShow(anchor: string): void;
}

export interface SpeechBubble {
  readonly el: HTMLElement;
  /** Instruction of the active step (null = none). `stepId` change re-opens a closed bubble. */
  setInstruction(stepId: string | null, b: ObjectiveBubbleView | null): void;
  /** Temporary event text (prefix "Hotovo!" / "Pozor:"). */
  event(kind: 'done' | 'warn', text: string): void;
  reposition(): void;
  /** Placement / cable drag: 30 % opacity, no clicks. */
  setDimmed(d: boolean): void;
  open(): void;
  /** Esc: close to the badge; true when consumed. */
  escape(): boolean;
  setEnabled(on: boolean): void;
  dispose(): void;
}

const EVENT_MS = 6000;

export function createSpeechBubble(host: BubbleHost): SpeechBubble {
  let step: string | null = null;
  let content: ObjectiveBubbleView | null = null;
  let closed = false;
  let enabled = true;
  let ev: { kind: 'done' | 'warn'; text: string; timer: number } | null = null;
  const text = h('p', { class: 'bubble-text' });
  const actions = h('div', { class: 'bubble-actions' });
  const tail = h('span', { class: 'bubble-tail', 'aria-hidden': 'true' });
  const card = h('div', { class: 'bubble', role: 'status', 'aria-live': 'polite' }, text, actions, tail);
  const badge = button('…', () => open(), { class: 'bubble-badge', 'aria-label': 'Znovu zobrazit nápovědu (B)', title: 'Co teď? (B)', hidden: true });
  const el = h('div', { class: 'bubble-layer' }, card, badge);

  function open(): void {
    closed = false;
    render();
  }

  function render(): void {
    const has = enabled && (!!content || !!ev);
    card.hidden = !has || closed;
    badge.hidden = !has || !closed;
    if (!has) return;
    actions.replaceChildren();
    if (ev) {
      text.replaceChildren(h('strong', null, ev.kind === 'done' ? 'Hotovo! ' : 'Pozor: '), ev.text);
      actions.append(button('Rozumím', () => clearEvent(), { class: 'btn btn-small' }));
    } else if (content) {
      text.textContent = content.text;
      const off = content.anchor !== 'avatar' && !host.anchorRect(content.anchor);
      if (off || content.anchor !== 'avatar') actions.append(button(off ? 'Ukaž →' : 'Ukaž', () => host.onShow(content!.anchor), { class: 'btn btn-small' }));
      const src = content.sourceKeys?.length ? sourceButton({ keys: content.sourceKeys }) : null;
      if (src) actions.append(src);
    }
    actions.append(button('×', () => close(), { class: 'btn btn-small bubble-x', 'aria-label': 'Zavřít nápovědu (Esc)', title: 'Zavřít (Esc) – B znovu otevře' }));
    reposition();
  }

  function close(): void {
    closed = true;
    render();
  }

  function clearEvent(): void {
    if (ev) clearTimeout(ev.timer);
    ev = null;
    render();
  }

  function reposition(): void {
    if (card.hidden && badge.hidden) return;
    const anchor = (ev ? null : content?.anchor) ?? 'avatar';
    const scene = host.scene();
    let r = host.anchorRect(anchor);
    if (!r || !rectInside(r, scene)) r = host.anchorRect('avatar') ?? { x: scene.x + scene.w / 2 - 10, y: scene.y + scene.h - 80, w: 20, h: 40 };
    if (!badge.hidden) {
      badge.style.transform = `translate(${Math.round(r.x + r.w / 2 - 12)}px, ${Math.round(Math.max(scene.y + 4, r.y - 28))}px)`;
      return;
    }
    const size = { w: card.offsetWidth || 320, h: card.offsetHeight || 90 };
    const p = placePopover(r, size, host.obstacles(), { w: innerWidth, h: innerHeight }, ['top', 'bottom', 'right', 'left'], 12);
    card.style.transform = `translate(${p.x}px, ${p.y}px)`;
    card.dataset['side'] = p.side;
    tail.style.cssText = p.side === 'top' || p.side === 'bottom' ? `left:${p.arrow - 7}px` : `top:${p.arrow - 7}px`;
  }

  render();
  return {
    el,
    setInstruction(id, b) {
      const changed = id !== step;
      step = id;
      content = b;
      if (changed) closed = false;
      render();
    },
    event(kind, t) {
      if (ev) clearTimeout(ev.timer);
      ev = { kind, text: t, timer: window.setTimeout(() => clearEvent(), EVENT_MS) };
      closed = false;
      render();
    },
    reposition,
    setDimmed(d) {
      el.classList.toggle('dimmed', d);
    },
    open,
    escape() {
      if (card.hidden) return false;
      if (ev) clearEvent();
      else close();
      return true;
    },
    setEnabled(on) {
      enabled = on;
      render();
    },
    dispose() {
      if (ev) clearTimeout(ev.timer);
      el.remove();
    },
  };
}
