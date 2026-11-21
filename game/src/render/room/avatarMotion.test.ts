import { describe, expect, it } from 'vitest';
import { AvatarMotion, facingFor } from './avatarMotion';

describe('AvatarMotion', () => {
  it('walks tile by tile at a fixed speed and stops at the goal', () => {
    const m = new AvatarMotion({ gx: 0, gy: 0 });
    m.setPath([{ gx: 1, gy: 0 }, { gx: 1, gy: 1 }]);
    expect(m.walking).toBe(true);
    expect(m.step(250, 2)).toBe(false); // 0.5 tile
    expect(m.x).toBeCloseTo(1);
    expect(m.y).toBeCloseTo(0.5);
    expect(m.facing).toBe('front-right');
    expect(m.step(750, 2)).toBe(true); // 1.5 tiles: reaches (1,0), then (1,1)
    expect(m.tile).toEqual({ gx: 1, gy: 1 });
    expect(m.facing).toBe('front-left');
    expect(m.walking).toBe(false);
    expect(m.step(100)).toBe(false);
  });

  it('maps grid directions to screen facings', () => {
    expect(facingFor(1, 0)).toBe('front-right');
    expect(facingFor(-1, 0)).toBe('back-left');
    expect(facingFor(0, 1)).toBe('front-left');
    expect(facingFor(0, -1)).toBe('back-right');
  });
});
