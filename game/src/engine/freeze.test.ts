import { describe, expect, it } from 'vitest';
import { deepFreeze } from './freeze';

describe('deepFreeze', () => {
  it('freezes nested objects and arrays', () => {
    const o = deepFreeze({ a: { b: [{ c: 1 }] } });
    expect(Object.isFrozen(o.a)).toBe(true);
    expect(Object.isFrozen(o.a.b)).toBe(true);
    expect(Object.isFrozen(o.a.b[0])).toBe(true);
    expect(() => {
      (o.a.b[0] as { c: number }).c = 2;
    }).toThrow(TypeError);
  });

  it('walks into objects that were only shallow-frozen elsewhere', () => {
    const inner = { x: 1 };
    const shallow = Object.freeze({ inner });
    deepFreeze({ shallow });
    expect(Object.isFrozen(inner)).toBe(true);
  });

  it('passes primitives through', () => {
    expect(deepFreeze(3)).toBe(3);
    expect(deepFreeze(null)).toBe(null);
  });
});
