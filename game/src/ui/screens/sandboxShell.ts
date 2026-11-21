import { button, h } from '../dom';
import { loadDesignStepData, type DesignStepData } from '../sandbox/designData';
import { sharedDesignState, type DesignStatePort } from '../sandbox/designState';
import { createDesignViewState, renderDesignStep, restoreDesignFocus } from '../sandbox/designStep';
import { gatePhase, SANDBOX_PHASES, SANDBOX_PHASE_INFO, type SandboxPhaseId } from '../sandbox/phases';
import { createStepper } from '../sandbox/stepper';
import { proceedBlock, proceedBlockText } from '../sandbox/designProgress';
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
    // INTEGRATION POINT: swap for a SandboxSession-backed port (see sandbox/designState.ts).
    const design: DesignStatePort = sharedDesignState();
    const designView = createDesignViewState();
    let designData: DesignStepData = loadDesignStepData(design.selection(), design.acknowledged());
    /**
     * Phase gate: a later phase cannot be entered by URL when it is not enterable.
     * TODO(SandboxSession): use snapshot.phases[].enterable instead of design validation.
     */
    const enterable = (p: SandboxPhaseId): boolean => p === 'navrh' || designData.canProceed;
    const requested: SandboxPhaseId = route.name === 'sandbox' ? route.phase : 'navrh';
    let phase: SandboxPhaseId = gatePhase(requested, enterable);
    // Fix the URL after mount (the router then only calls update() with the same phase).
    if (phase !== requested) queueMicrotask(() => ctx.navigate({ name: 'sandbox', phase }, { replace: true }));

    const go = (p: SandboxPhaseId): void => ctx.navigate({ name: 'sandbox', phase: gatePhase(p, enterable) });
    /** Leaving the design phase. Later: session.advancePhase() decides; the UI only reflects it. */
    const advanceFromDesign = (): void => {
      if (designData.canProceed) go('priprava');
    };
    const stepper = createStepper(go);
    const title = h('h2', { tabindex: '-1' });
    const content = h('div', { class: 'phase-content' });
    const panel = h('section', { class: 'phase-panel', 'aria-live': 'polite' }, title, content);
    const prev = button('← Předchozí', () => step(-1), { class: 'btn' });
    const next = button('Další →', () => step(1), { class: 'btn btn-primary', 'aria-describedby': 'shell-next-why' });
    const nextWhy = h('span', { class: 'shell-next-why small', id: 'shell-next-why' });
    const step = (d: number): void => {
      if (phase === 'navrh' && d > 0) return advanceFromDesign();
      const p = SANDBOX_PHASES[SANDBOX_PHASES.indexOf(phase) + d];
      if (p) go(p);
    };

    const renderDesign = (): void => {
      // Keep keyboard focus across the re-render (radios / buttons carry data-fk).
      const fk = (document.activeElement as HTMLElement | null)?.dataset?.['fk'];
      renderDesignStep(content, {
        data: designData,
        view: designView,
        onSelect: (d, o) => design.select(d, o),
        onAcknowledge: (keys) => design.acknowledgeWarnings(keys),
        onProceed: advanceFromDesign,
      }, design.acknowledged());
      restoreDesignFocus(content, fk);
    };

    const updateGates = (): void => {
      for (const p of SANDBOX_PHASES) if (p !== 'navrh') stepper.setEnabled(p, enterable(p), 'Nejdřív dokonči návrh');
      const i = SANDBOX_PHASES.indexOf(phase);
      prev.disabled = i === 0;
      if (phase === 'navrh') {
        next.textContent = 'Pokračovat na Přípravu →';
        next.disabled = !designData.canProceed;
        const block = proceedBlock(designData, design.acknowledged());
        nextWhy.textContent = block ? proceedBlockText(block) : '';
      } else {
        next.textContent = 'Další →';
        next.disabled = i === SANDBOX_PHASES.length - 1;
        nextWhy.textContent = next.disabled ? 'Poslední fáze.' : '';
      }
    };

    const render = (): void => {
      const i = SANDBOX_PHASES.indexOf(phase);
      const info = SANDBOX_PHASE_INFO[phase];
      stepper.setActive(phase);
      title.textContent = `${i + 1}. ${info.title}`;
      panel.classList.toggle('phase-panel-wide', phase === 'navrh');
      content.replaceChildren();
      if (phase === 'navrh') renderDesign();
      else
        content.append(
          h('div', { class: 'placeholder' }, h('h3', null, 'Připravujeme'), h('p', null, PENDING[phase])),
        );
      updateGates();
    };

    const offDesign = design.subscribe(() => {
      designData = loadDesignStepData(design.selection(), design.acknowledged());
      if (phase === 'navrh') renderDesign();
      updateGates();
    });

    const view = h(
      'div',
      { class: 'screen screen-shell' },
      h('header', { class: 'shell-bar' },
        h('div', { class: 'shell-title' }, h('strong', null, 'Sandbox'), h('span', { class: 'muted' }, ` · ${VCF_VERSION}`)),
        button('Ukončit sandbox', () => ctx.navigate({ name: 'menu' }), { class: 'btn btn-ghost' }),
      ),
      h('div', { class: 'shell-steps' }, stepper.el),
      h('main', { class: 'shell-main' }, panel),
      h('footer', { class: 'shell-foot' }, prev, h('div', { class: 'shell-next' }, nextWhy, next)),
    );
    root.appendChild(view);
    render();

    return {
      update(r) {
        if (r.name !== 'sandbox' || r.phase === phase) return;
        const allowed = gatePhase(r.phase, enterable);
        if (allowed !== r.phase) ctx.navigate({ name: 'sandbox', phase: allowed }, { replace: true });
        if (allowed === phase) return;
        phase = allowed;
        render();
        title.focus();
      },
      dispose: () => {
        offDesign();
        view.remove();
      },
    };
  },
};
