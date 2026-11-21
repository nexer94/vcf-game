import type { GameEngineView, GameSpeed, GameSnapshot } from '../engine';
import { formatGameTime } from './format';
import { stepSpeed } from './timeKeys';

export { stepSpeed } from './timeKeys';

/**
 * Keyboard scheme (UX.md §4.3):
 *  - 'digits': Space = pause, 1/2/3 = 1×/4×/16× (traffic demo, no inventory)
 *  - 'stepped': Space or P = pause, ',' / '.' = slower / faster (Sandbox: digits belong to the inventory)
 */
export type TimeKeyScheme = 'digits' | 'stepped';

const BUTTONS: readonly { speed: GameSpeed; label: string; title: Record<TimeKeyScheme, string> }[] = [
  { speed: 0, label: 'Pauza', title: { digits: 'Pozastavit (mezerník)', stepped: 'Pozastavit (mezerník nebo P)' } },
  { speed: 1, label: '1×', title: { digits: 'Normální rychlost (1)', stepped: 'Normální rychlost (, zpomalit)' } },
  { speed: 4, label: '4×', title: { digits: 'Zrychlit 4× (2)', stepped: 'Zrychlit 4× (, / .)' } },
  { speed: 16, label: '16×', title: { digits: 'Zrychlit 16× (3)', stepped: 'Zrychlit 16× (. zrychlit)' } },
];

/** Focus on a control that already uses Space / letters itself. */
const isTypingTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement ||
  (t instanceof HTMLElement && t.isContentEditable);

export interface TimeControls {
  update(snapshot: GameSnapshot): void;
  dispose(): void;
}

/**
 * Pause / 1x / 4x / 16x. Sends intent to the engine via GameEngineView and
 * reflects the state from snapshot + speedChanged events.
 */
export function createTimeControls(parent: HTMLElement, engine: GameEngineView, keys: TimeKeyScheme = 'digits'): TimeControls {
  const el = document.createElement('div');
  el.className = 'ui-panel time';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Ovládání času');
  const clock = document.createElement('span');
  clock.className = 'clock';
  clock.title = 'Herní čas';
  el.appendChild(clock);
  const buttons = BUTTONS.map((b) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = b.label;
    btn.title = b.title[keys];
    btn.addEventListener('click', () => engine.setSpeed(b.speed));
    el.appendChild(btn);
    return { ...b, btn };
  });
  parent.appendChild(el);

  const showSpeed = (speed: GameSpeed): void => {
    for (const b of buttons) b.btn.setAttribute('aria-pressed', String(b.speed === speed));
  };
  showSpeed(engine.snapshot().clock.speed);
  const off = engine.subscribe((ev) => {
    if (ev.type === 'speedChanged') showSpeed(ev.speed);
  });

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
    // Space on a focused button/summary activates it - do not also toggle pause.
    if (e.code === 'Space') {
      if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement || (e.target instanceof HTMLElement && e.target.tagName === 'SUMMARY')) return;
      e.preventDefault();
      engine.togglePause();
      return;
    }
    if (keys === 'digits') {
      if (e.key === '1') engine.setSpeed(1);
      else if (e.key === '2') engine.setSpeed(4);
      else if (e.key === '3') engine.setSpeed(16);
      return;
    }
    if (e.key === 'p' || e.key === 'P') engine.togglePause();
    else if (e.key === ',' || e.key === '<') engine.setSpeed(stepSpeed(engine.snapshot().clock.speed, -1));
    else if (e.key === '.' || e.key === '>') engine.setSpeed(stepSpeed(engine.snapshot().clock.speed, 1));
  };
  window.addEventListener('keydown', onKey);

  let lastText = '';
  return {
    update(snapshot) {
      const t = formatGameTime(snapshot.clock.gameTimeMs);
      if (t !== lastText) clock.textContent = lastText = t;
    },
    dispose() {
      off();
      window.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}
