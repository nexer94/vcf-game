import { describe, expect, it } from 'vitest';
import { GameEngine } from './engine';
import { type FrameScheduler, startEngineLoop } from './loop';

class FakeScheduler implements FrameScheduler {
  private next = 1;
  readonly pending = new Map<number, (now: number) => void>();
  request(cb: (now: number) => void): number {
    const h = this.next++;
    this.pending.set(h, cb);
    return h;
  }
  cancel(h: number): void {
    this.pending.delete(h);
  }
  /** Run all callbacks queued for the current frame at time `now`. */
  frame(now: number): void {
    const cbs = [...this.pending.values()];
    this.pending.clear();
    for (const cb of cbs) cb(now);
  }
}

describe('engine loop', () => {
  it('ticks the engine with real deltas, independently of any renderer', () => {
    const sched = new FakeScheduler();
    const engine = new GameEngine(4);
    const loop = startEngineLoop(engine, sched);
    sched.frame(1000); // first frame only establishes the time base
    sched.frame(1016);
    sched.frame(1032);
    expect(engine.snapshot().clock.gameTimeMs).toBe(32 * 4);
    expect(engine.snapshot().tick).toBe(2);
    expect(loop.running).toBe(true);
  });

  it('clamps long gaps and ignores clock going backwards', () => {
    const sched = new FakeScheduler();
    const engine = new GameEngine(1);
    startEngineLoop(engine, sched, { maxDeltaMs: 50 });
    sched.frame(0);
    sched.frame(10_000);
    sched.frame(9_000);
    expect(engine.snapshot().clock.gameTimeMs).toBe(50);
  });

  it('respects pause (game time does not move) and stops cleanly', () => {
    const sched = new FakeScheduler();
    const engine = new GameEngine(0);
    const loop = startEngineLoop(engine, sched);
    sched.frame(0);
    sched.frame(16);
    expect(engine.snapshot().clock.gameTimeMs).toBe(0);
    engine.setSpeed(1);
    sched.frame(32);
    expect(engine.snapshot().clock.gameTimeMs).toBe(16);
    loop.stop();
    expect(sched.pending.size).toBe(0);
    sched.frame(1000);
    expect(engine.snapshot().clock.gameTimeMs).toBe(16);
    expect(loop.running).toBe(false);
  });
});
