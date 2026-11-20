import { button, h } from '../dom';
import { loadDesignStepData } from '../sandbox/designData';
import { renderDesignStep } from '../sandbox/designStep';
import { SANDBOX_PHASES, SANDBOX_PHASE_INFO, type SandboxPhaseId } from '../sandbox/phases';
import { createStepper } from '../sandbox/stepper';
import { VCF_VERSION } from '../version';
import type { ScreenDef } from './screen';

/** Placeholder text for phases whose content is not specified yet. No VCF facts. */
const PENDING: Record<Exclude<SandboxPhaseId, 'navrh'>, string> = {
  priprava:
    'Tady bude plánování a příprava prostředí (DNS, IP adresy, sítě, hardware) – kontroly a chybové stavy ' +
    'přesně podle specifikace z dokumentace.',
  deploy:
    'Tady bude postupný deploy (VCF Installer, bring-up, workload domény…) – kroky ve stejném pořadí jako ' +
    'v reálném průvodci, s chybovými stavy podle dokumentace.',
};

/** Sandbox wizard shell: header, stepper, phase content, prev/next. */
export const sandboxShellScreen: ScreenDef = {
  stageMode: 'off',
  mount(root, ctx, route) {
    // UI-only state for now; design choices move to the engine once the model supports them.
    const designSelection = new Map<string, string>();
    let phase: SandboxPhaseId = route.name === 'sandbox' ? route.phase : 'navrh';

    const go = (p: SandboxPhaseId): void => ctx.navigate({ name: 'sandbox', phase: p });
    const stepper = createStepper(go);
    const title = h('h2', { tabindex: '-1' });
    const content = h('div', { class: 'phase-content' });
    const prev = button('← Předchozí', () => step(-1), { class: 'btn' });
    const next = button('Další →', () => step(1), { class: 'btn btn-primary' });
    const step = (d: number): void => {
      const p = SANDBOX_PHASES[SANDBOX_PHASES.indexOf(phase) + d];
      if (p) go(p);
    };

    const render = (): void => {
      const i = SANDBOX_PHASES.indexOf(phase);
      const info = SANDBOX_PHASE_INFO[phase];
      stepper.setActive(phase);
      title.textContent = `${i + 1}. ${info.title}`;
      content.replaceChildren();
      if (phase === 'navrh') {
        renderDesignStep(content, {
          data: loadDesignStepData(),
          selection: designSelection,
          onSelect: (decision, option) => {
            designSelection.set(decision, option);
          },
        });
      } else {
        content.append(
          h('div', { class: 'placeholder' }, h('h3', null, 'Připravujeme'), h('p', null, PENDING[phase])),
        );
      }
      prev.disabled = i === 0;
      next.disabled = i === SANDBOX_PHASES.length - 1;
    };

    const view = h(
      'div',
      { class: 'screen screen-shell' },
      h('header', { class: 'shell-bar' },
        h('div', { class: 'shell-title' }, h('strong', null, 'Sandbox'), h('span', { class: 'muted' }, ` · ${VCF_VERSION}`)),
        button('Ukončit sandbox', () => ctx.navigate({ name: 'menu' }), { class: 'btn btn-ghost' }),
      ),
      h('div', { class: 'shell-steps' }, stepper.el),
      h('main', { class: 'shell-main' },
        h('section', { class: 'phase-panel', 'aria-live': 'polite' }, title, content),
      ),
      h('footer', { class: 'shell-foot' }, prev, next),
    );
    root.appendChild(view);
    render();

    return {
      update(r) {
        if (r.name !== 'sandbox' || r.phase === phase) return;
        phase = r.phase;
        render();
        title.focus();
      },
      dispose: () => view.remove(),
    };
  },
};
