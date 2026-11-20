import type { GameEngineView, GameSpeed, GameSnapshot } from '../engine';
import { formatGameTime } from './format';

const BUTTONS: readonly { speed: GameSpeed; label: string; title: string }[] = [
  { speed: 0, label: 'Pauza', title: 'Pozastavit (mezerník)' },
  { speed: 1, label: '1×', title: 'Normální rychlost (1)' },
  { speed: 4, label: '4×', title: 'Zrychlit 4× (2)' },
  { speed: 16, label: '16×', title: 'Zrychlit 16× (3)' },
];

export interface TimeControls {
  update(snapshot: GameSnapshot): void;
  dispose(): void;
}

/**
 * Pause / 1x / 4x / 16x. Sends intent to the engine via GameEngineView and
 * reflects the state from snapshot + speedChanged events.
 */
export function createTimeControls(parent: HTMLElement, engine: GameEngineView): TimeControls {
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
    btn.title = b.title;
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
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      engine.togglePause();
    } else if (e.key === '1') engine.setSpeed(1);
    else if (e.key === '2') engine.setSpeed(4);
    else if (e.key === '3') engine.setSpeed(16);
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
