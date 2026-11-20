import { describe, expect, it } from 'vitest';
import { GAME_SPEEDS, GameClock, isGameSpeed, type GameSpeed } from './clock';

describe('GameClock', () => {
  it('starts paused at time 0 by default', () => {
    const c = new GameClock();
    expect(c.paused).toBe(true);
    expect(c.advance(1000)).toBe(0);
    expect(c.timeMs).toBe(0);
  });

  it.each([1, 4, 16] as const)('advances %ix real time', (speed) => {
    const c = new GameClock(speed);
    expect(c.advance(100)).toBe(100 * speed);
    expect(c.state()).toEqual({ gameTimeMs: 100 * speed, speed });
  });

  it('pause/resume restores the last running speed', () => {
    const c = new GameClock(4);
    c.pause();
    expect(c.speed).toBe(0);
    c.advance(500);
    expect(c.timeMs).toBe(0);
    c.resume();
    expect(c.speed).toBe(4);
    c.togglePause();
    expect(c.paused).toBe(true);
    c.togglePause();
    expect(c.speed).toBe(4);
  });

  it('resume from a fresh paused clock runs at 1x', () => {
    const c = new GameClock();
    c.resume();
    expect(c.speed).toBe(1);
  });

  it('rejects invalid speeds and deltas', () => {
    const c = new GameClock(1);
    expect(() => c.setSpeed(2 as GameSpeed)).toThrow(RangeError);
    expect(() => c.advance(-1)).toThrow(RangeError);
    expect(() => c.advance(Number.NaN)).toThrow(RangeError);
  });

  it('exposes exactly pause/1x/4x/16x', () => {
    expect(GAME_SPEEDS).toEqual([0, 1, 4, 16]);
    expect(isGameSpeed(16)).toBe(true);
    expect(isGameSpeed(8)).toBe(false);
  });
});
