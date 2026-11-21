import { describe, expect, it } from 'vitest';
import { canMount, CABINETS, devicePortPoint, firstFreeU, type RoomDeviceSpec } from './furniture';

const srv = (id: string, u: number, heightU = 2): RoomDeviceSpec => ({ id, kind: 'server', u, heightU });

describe('furniture slots', () => {
  it('rejects overlapping or out-of-range units', () => {
    const existing = [srv('a', 10)];
    expect(canMount('rack', existing, srv('b', 12))).toBe(true);
    expect(canMount('rack', existing, srv('b', 11))).toBe(false);
    expect(canMount('rack', existing, srv('b', 9))).toBe(false);
    expect(canMount('rack', [], srv('b', CABINETS.rack.units))).toBe(false);
    expect(canMount('rack', [], srv('b', 0))).toBe(false);
  });

  it('finds the first free slot', () => {
    expect(firstFreeU('rack', [srv('a', 1), srv('b', 4)], 1)).toBe(3);
    expect(firstFreeU('rack', [srv('a', 1), srv('b', 4)], 2)).toBe(6);
    expect(firstFreeU('stand', [srv('a', 1, CABINETS.stand.units)], 1)).toBeNull();
  });

  it('places ports on the cabinet front face, higher units higher on screen', () => {
    const cab = { id: 'r', kind: 'rack' as const, gx: 2, gy: 3 };
    const low = devicePortPoint(cab, srv('a', 1), 0);
    const high = devicePortPoint(cab, srv('b', 30), 0);
    expect(high.y).toBeLessThan(low.y);
    expect(high.x).toBeCloseTo(low.x);
  });
});
