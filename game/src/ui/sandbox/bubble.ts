/**
 * Speech bubble "co teď" (UX.md Part III ch. 18) – Career levels only.
 *
 * - Always at most ONE bubble with the instruction of the active checklist step (ObjectiveView.bubble).
 * - Anchor: 'avatar' | 'object:<kind>:<id|first>' | 'ui:<id>' – resolved by the screen to a screen rect; when the anchor
 *   is off screen the bubble sits at the avatar with an arrow "→" and "Ukaž".
 * - × / Esc -> small badge "…" over the anchor; click / B re-opens. A new active step re-opens it.
 * - Events (first purchase, first validation error…) temporarily replace the text ("Hotovo!" / "Pozor:"), back after
 *   "Rozumím" or 6 s – never a second bubble.
 * - DOM over the canvas (sharp text, screen readers: role=status, aria-live=polite). `reposition()` is called every
 *   frame by the screen (camera zoom / pan, avatar walking, view transitions, panel changes): the anchor's world rect
 *   goes through the camera (bubbleAnchor.ts) and the DOM is touched only when the result changed.
 * - Anchor off screen -> a small edge arrow pointing to it (click = "Ukaž"); no anchor in the current view or a
 *   full-screen view (PC, whiteboard, console) -> nothing (`host.visible()`).
 */
import { button, h } from '../dom';
import { placePopover, type Rect } from './layoutZones';
import { anchorVisible, clampIntoScene, resolveAnchor } from './bubbleAnchor';
import { sourceButton } from './sourcePopover';
import type { ObjectiveBubbleView } from './sessionPort';

export interface BubbleHost {
  /** Screen rect of an anchor (null = not on screen / unknown). */
  anchorRect(anchor: string): Rect | null;
  /** Obstacles (HUD, checklist, right panel, shop). */
  obstacles(): readonly Rect[];
  /** Free scene rect. */
  scene(): Rect;
  /** "Ukaž" – move the camera / open the view of the anchor ('avatar' = centre the camera on the avatar). */
  onShow(anchor: string): void;
  /** False while a full-screen view (PC, whiteboard, console, overview) or a view transition is shown. */
  visible?(): boolean;
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
  const edge = button('➜', () => host.onShow(curAnchor()), { class: 'bubble-edge', 'aria-label': 'Nápověda je mimo obrazovku – ukázat (B)', title: 'Co teď? Nápověda je mimo obrazovku – klik ji ukáže', hidden: true });
  const el = h('div', { class: 'bubble-layer' }, card, badge, edge);
  /** Last written placement (DOM is touched only on change). */
  let lastKey = '';
  let cardSize = { w: 0, h: 0 };
  const curAnchor = (): string => (ev ? null : content?.anchor) ?? 'avatar';

  function open(): void {
    closed = false;
    render();
  }

  /** Bubble wanted by the game state (independent of the anchor being on screen). */
  let want: 'card' | 'badge' | null = null;
  function render(): void {
    const has = enabled && (!!content || !!ev);
    want = has ? (closed ? 'badge' : 'card') : null;
    lastKey = '';
    if (!has) {
      card.hidden = true;
      badge.hidden = true;
      edge.hidden = true;
      return;
    }
    actions.replaceChildren();
    if (ev) {
      text.replaceChildren(h('strong', null, ev.kind === 'done' ? 'Hotovo! ' : 'Pozor: '), ev.text);
      actions.append(button('Rozumím', () => clearEvent(), { class: 'btn btn-small' }));
    } else if (content) {
      text.textContent = content.text;
      const ar = content.anchor !== 'avatar' ? host.anchorRect(content.anchor) : null;
      const off = content.anchor !== 'avatar' && !(ar && anchorVisible(ar, host.scene()));
      if (off || content.anchor !== 'avatar') actions.append(button(off ? 'Ukaž →' : 'Ukaž', () => host.onShow(content!.anchor), { class: 'btn btn-small' }));
      const src = content.sourceKeys?.length ? sourceButton({ keys: content.sourceKeys }) : null;
      if (src) actions.append(src);
    }
    actions.append(button('×', () => close(), { class: 'btn btn-small bubble-x', 'aria-label': 'Zavřít nápovědu (Esc)', title: 'Zavřít (Esc) – B znovu otevře' }));
    cardSize = { w: 0, h: 0 };
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
    if (!want || (host.visible && !host.visible())) {
      if (lastKey !== 'off') {
        card.hidden = true;
        badge.hidden = true;
        edge.hidden = true;
        lastKey = 'off';
      }
      return;
    }
    const anchor = curAnchor();
    const scene = host.scene();
    const primary = host.anchorRect(anchor);
    const fallback = anchor === 'avatar' ? null : host.anchorRect('avatar');
    const pl = resolveAnchor(primary, fallback, scene);
    if (pl.kind === 'none') {
      if (lastKey !== 'none') {
        card.hidden = true;
        badge.hidden = true;
        edge.hidden = true;
        lastKey = 'none';
      }
      return;
    }
    if (pl.kind === 'edge') {
      const key = `e${pl.x},${pl.y},${pl.angle.toFixed(2)}`;
      if (key === lastKey) return;
      lastKey = key;
      card.hidden = true;
      badge.hidden = true;
      edge.hidden = false;
      edge.style.transform = `translate(${pl.x - 16}px, ${pl.y - 16}px) rotate(${pl.angle}rad)`;
      return;
    }
    const r = pl.rect;
    edge.hidden = true;
    if (want === 'badge') {
      card.hidden = true;
      badge.hidden = false;
      const key = `b${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)}`;
      if (key === lastKey) return;
      lastKey = key;
      badge.style.transform = `translate(${Math.round(r.x + r.w / 2 - 12)}px, ${Math.round(Math.max(scene.y + 4, r.y - 28))}px)`;
      return;
    }
    badge.hidden = true;
    const wasHidden = card.hidden;
    card.hidden = false;
    if (wasHidden || !cardSize.w) cardSize = { w: card.offsetWidth || 320, h: card.offsetHeight || 90 };
    const obstacles = host.obstacles();
    const key = `c${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)},${scene.x},${scene.y},${scene.w},${scene.h},${obstacles.length},${cardSize.w},${cardSize.h}`;
    if (key === lastKey) return;
    lastKey = key;
    const p0 = placePopover(r, cardSize, obstacles, { w: innerWidth, h: innerHeight }, ['top', 'bottom', 'right', 'left'], 12);
    const p = clampIntoScene(p0, cardSize, r, scene);
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
      if (want !== 'card') return false;
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
