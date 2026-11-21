import { describe, expect, it } from 'vitest';
import { stepSpeed } from './timeKeys';

describe('stepSpeed (, / . shortcuts)', () => {
  it('steps through 1x / 4x / 16x and clamps', () => {
    expect(stepSpeed(1, 1)).toBe(4);
    expect(stepSpeed(4, 1)).toBe(16);
    expect(stepSpeed(16, 1)).toBe(16);
    expect(stepSpeed(16, -1)).toBe(4);
    expect(stepSpeed(1, -1)).toBe(1);
  });
  it('resumes from pause at 1x', () => {
    expect(stepSpeed(0, 1)).toBe(1);
    expect(stepSpeed(0, -1)).toBe(1);
  });
});
