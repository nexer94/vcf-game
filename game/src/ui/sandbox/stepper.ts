import { h } from '../dom';
import { SANDBOX_PHASES, SANDBOX_PHASE_INFO, type SandboxPhaseId } from './phases';

export interface Stepper {
  readonly el: HTMLElement;
  setActive(phase: SandboxPhaseId): void;
  /** Disable picking a phase (gating comes from model validation, e.g. design not ready). */
  setEnabled(phase: SandboxPhaseId, enabled: boolean): void;
}

/**
 * Horizontal stepper (wizard-style progress). Steps are navigable freely for now;
 * gating by prerequisites will be driven by model validation, not by the UI.
 */
export function createStepper(onPick: (phase: SandboxPhaseId) => void): Stepper {
  const items = SANDBOX_PHASES.map((id, i) => {
    const info = SANDBOX_PHASE_INFO[id];
    const btn = h('button', { type: 'button', class: 'step' },
      h('span', { class: 'step-num' }, String(i + 1)),
      h('span', { class: 'step-text' }, h('span', { class: 'step-title' }, info.title), h('span', { class: 'step-sub' }, info.subtitle)),
    );
    btn.addEventListener('click', () => onPick(id));
    return { id, btn, li: h('li', null, btn) };
  });
  const el = h('ol', { class: 'stepper', 'aria-label': 'Fáze sandboxu' }, ...items.map((x) => x.li));
  return {
    el,
    setEnabled(phase, enabled) {
      const x = items.find((i) => i.id === phase);
      if (x) x.btn.disabled = !enabled;
    },
    setActive(phase) {
      const at = SANDBOX_PHASES.indexOf(phase);
      items.forEach((x, i) => {
        x.btn.classList.toggle('done', i < at);
        x.btn.classList.toggle('active', i === at);
        if (i === at) x.btn.setAttribute('aria-current', 'step');
        else x.btn.removeAttribute('aria-current');
      });
    },
  };
}
