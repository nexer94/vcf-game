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
    expect(parseRoute('#/sandbox/mistnost')).toEqual({ name: 'sandbox-room', demo: false });
    expect(parseRoute('#/sandbox/mistnost/ukazka')).toEqual({ name: 'sandbox-room', demo: true });
    expect(parseRoute('#/sandbox/mistnost/rack/R1')).toEqual({ name: 'sandbox-room', demo: false, view: { kind: 'rack', rackId: 'R1' } });
    expect(parseRoute('#/sandbox/mistnost/ukazka/tabule')).toEqual({ name: 'sandbox-room', demo: true, view: { kind: 'board' } });
    // Bad ids fall back to the room itself.
    expect(parseRoute('#/sandbox/mistnost/rack/%3Cx%3E')).toEqual({ name: 'sandbox-room', demo: false });
    expect(parseRoute('#/sandbox/lokalita')).toEqual({ name: 'sandbox-site' });
    expect(parseRoute('#/sandbox/mistnost/areal')).toEqual({ name: 'sandbox-room', demo: false, overview: true });
    expect(parseRoute('#/sandbox/mistnost/m2')).toEqual({ name: 'sandbox-room', demo: false, roomId: 'm2' });
    expect(parseRoute('#/sandbox/mistnost/m2/rack/R1')).toEqual({ name: 'sandbox-room', demo: false, roomId: 'm2', view: { kind: 'rack', rackId: 'R1' } });
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
      { name: 'career', level: 'c1-l1' },
      { name: 'career', level: 'c1-l1', result: true },
      { name: 'scenarios' },
      { name: 'sandbox-room', demo: false, career: 'c1-l1' },
      { name: 'sandbox-room', demo: false, career: 'c1-l1', view: { kind: 'rack', rackId: 'r01' } },
      { name: 'traffic' },
      { name: 'sandbox-room', demo: false },
      { name: 'sandbox-room', demo: true },
      { name: 'sandbox-room', demo: false, view: { kind: 'rack', rackId: 'R1' } },
      { name: 'sandbox-room', demo: true, view: { kind: 'host', rackId: 'R1', hostId: 'srv-1' } },
      { name: 'sandbox-room', demo: false, view: { kind: 'board' } },
      { name: 'sandbox-room', demo: false, view: { kind: 'pc', app: 'navrh' } },
      { name: 'sandbox-site' },
      { name: 'sandbox-room', demo: false, overview: true },
      { name: 'sandbox-room', demo: true, overview: true },
      { name: 'sandbox-room', demo: false, roomId: 'm2' },
      { name: 'sandbox-room', demo: true, roomId: 'm2', view: { kind: 'host', rackId: 'R1', hostId: 'srv-1' } },
      ...SANDBOX_PHASES.map((phase) => ({ name: 'sandbox', phase }) as const),
    ];
    for (const r of routes) expect(parseRoute(formatRoute(r))).toEqual(r);
  });
});
