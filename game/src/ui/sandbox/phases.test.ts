import { describe, expect, it } from 'vitest';
import { gatePhase, type SandboxPhaseId } from './phases';

describe('gatePhase', () => {
  const only = (...ok: SandboxPhaseId[]) => (p: SandboxPhaseId) => ok.includes(p);

  it('keeps an enterable phase', () => {
    expect(gatePhase('priprava', only('navrh', 'priprava'))).toBe('priprava');
    expect(gatePhase('navrh', only())).toBe('navrh');
  });

  it('redirects a locked phase to the furthest enterable earlier phase', () => {
    expect(gatePhase('deploy', only('navrh'))).toBe('navrh');
    expect(gatePhase('deploy', only('navrh', 'priprava'))).toBe('priprava');
    expect(gatePhase('priprava', only())).toBe('navrh');
  });
});
