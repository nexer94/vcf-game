import { describe, expect, it } from 'vitest';
import { loadDesignStepData } from './designData';
import { currentStep, designProgress, proceedBlock, proceedBlockText } from './designProgress';

describe('designProgress', () => {
  it('fresh design: neutral progress, missing is not an error', () => {
    const d = loadDesignStepData(new Map());
    const p = designProgress(d);
    expect(p.done).toBe(0);
    expect(p.total).toBe(d.decisions.length);
    expect(p.next?.id).toBe(d.steps[0]!.decisions[0]!.id);
    const b = proceedBlock(d, new Set());
    expect(b?.kind).toBe('missing');
    expect(proceedBlockText(b!)).toContain('Zbývá rozhodnout');
    expect(currentStep(d)).toBe(1);
  });

  it('counts made decisions and moves the current step', () => {
    const first = loadDesignStepData(new Map()).steps[0]!;
    const sel = new Map(first.decisions.map((d) => [d.id, d.options.find((o) => !o.disabledReason)!.id]));
    const d = loadDesignStepData(sel);
    expect(designProgress(d).done).toBe(first.decisions.length);
    expect(currentStep(d)).toBe(2);
  });
});
