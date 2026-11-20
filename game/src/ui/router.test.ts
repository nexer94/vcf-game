import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute, type Route } from './router';
import { SANDBOX_PHASES } from './sandbox/phases';

describe('router', () => {
  it('parses known routes', () => {
    expect(parseRoute('')).toEqual({ name: 'menu' });
    expect(parseRoute('#/')).toEqual({ name: 'menu' });
    expect(parseRoute('#/sandbox')).toEqual({ name: 'sandbox-intro' });
    expect(parseRoute('#/sandbox/priprava')).toEqual({ name: 'sandbox', phase: 'priprava' });
    expect(parseRoute('#/kariera')).toEqual({ name: 'career' });
    expect(parseRoute('#/provoz')).toEqual({ name: 'traffic' });
  });

  it('falls back on unknown input', () => {
    expect(parseRoute('#/nic')).toEqual({ name: 'menu' });
    expect(parseRoute('#/sandbox/xyz')).toEqual({ name: 'sandbox-intro' });
  });

  it('round-trips every route', () => {
    const routes: Route[] = [
      { name: 'menu' },
      { name: 'sandbox-intro' },
      { name: 'career' },
      { name: 'traffic' },
      ...SANDBOX_PHASES.map((phase) => ({ name: 'sandbox', phase }) as const),
    ];
    for (const r of routes) expect(parseRoute(formatRoute(r))).toEqual(r);
  });
});
