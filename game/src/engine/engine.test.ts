import { describe, expect, it } from 'vitest';
import { GameEngine } from './engine';
import type { GameEvent } from './events';

describe('GameEngine', () => {
  it('produces immutable snapshots reflecting ticks and clock', () => {
    const e = new GameEngine(4);
    e.tick(250);
    e.tick(250);
    const s = e.snapshot();
    expect(s).toEqual({ tick: 2, clock: { gameTimeMs: 2000, speed: 4 } });
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.clock)).toBe(true);
  });

  it('emits speedChanged on speed change and pause toggle', () => {
    const e = new GameEngine(1);
    const events: GameEvent[] = [];
    e.subscribe((ev) => events.push(ev));
    e.setSpeed(1); // no-op, no event
    e.tick(1000);
    e.setSpeed(16);
    e.togglePause();
    expect(events).toEqual([
      { type: 'speedChanged', atMs: 1000, speed: 16 },
      { type: 'speedChanged', atMs: 1000, speed: 0 },
    ]);
  });

  it('drives attached systems with game time only while running', () => {
    const e = new GameEngine(4);
    const calls: [number, number][] = [];
    const off = e.attach({ advance: (d, now) => calls.push([d, now]) });
    e.tick(100);
    e.setSpeed(0);
    e.tick(100);
    e.setSpeed(1);
    e.tick(50);
    off();
    e.tick(50);
    expect(calls).toEqual([
      [400, 400],
      [50, 450],
    ]);
  });
});
