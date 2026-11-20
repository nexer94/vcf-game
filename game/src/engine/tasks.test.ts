import { describe, expect, it } from 'vitest';
import { advanceTimedTasks, createTimedTask, taskProgress, taskRemainingMs } from './tasks';

const mk = (id: string, durationMs: number) =>
  createTimedTask({ id, kind: 'k', label: id, durationMs, startedAtMs: 0, illustrativeDuration: true, payload: null });

describe('timed tasks', () => {
  it('advances in parallel and completes tasks that reach their duration', () => {
    const r1 = advanceTimedTasks([mk('a', 100), mk('b', 300)], 150);
    expect(r1.completed.map((t) => t.id)).toEqual(['a']);
    expect(r1.running.map((t) => [t.id, t.elapsedMs])).toEqual([['b', 150]]);
    expect(taskProgress(r1.running[0]!)).toBe(0.5);
    expect(taskRemainingMs(r1.running[0]!)).toBe(150);
    const r2 = advanceTimedTasks(r1.running, 1000);
    expect(r2.completed[0]!.elapsedMs).toBe(300);
    expect(r2.running).toEqual([]);
  });

  it('zero delta is a no-op and inputs are not mutated', () => {
    const t = mk('a', 100);
    const r = advanceTimedTasks([t], 0);
    expect(r.running[0]).toBe(t);
    advanceTimedTasks([t], 50);
    expect(t.elapsedMs).toBe(0);
  });

  it('rejects invalid durations and deltas', () => {
    expect(() => mk('x', 0)).toThrow(RangeError);
    expect(() => advanceTimedTasks([], -1)).toThrow(RangeError);
  });
});
