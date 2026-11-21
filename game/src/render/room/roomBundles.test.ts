import { describe, expect, it } from 'vitest';
import { BUNDLE_Z, bundleWidth, devicePath, faceEdgePoint, offsetPolyline, pairKey, riserTop, trayRoute } from './roomBundles';
import { devicePortPoint, type CabinetSpec } from './furniture';

const A: CabinetSpec = { id: 'R1', kind: 'rack', gx: 2, gy: 2 };
const B: CabinetSpec = { id: 'R2', kind: 'rack', gx: 5, gy: 4 };

describe('room bundles', () => {
  it('pair keys are order independent', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'));
  });

  it('tray route runs above both cabinets, grid-orthogonally', () => {
    const r = trayRoute(A, B);
    expect(r).toHaveLength(3);
    expect(r[0]!.y).toBeLessThan(riserTop(A).y);
    // first leg along +gx: screen slope +0.5, second along +gy: slope -0.5
    const s1 = (r[1]!.y - r[0]!.y) / (r[1]!.x - r[0]!.x);
    const s2 = (r[2]!.y - r[1]!.y) / (r[2]!.x - r[1]!.x);
    expect(s1).toBeCloseTo(0.5);
    expect(s2).toBeCloseTo(-0.5);
    expect(BUNDLE_Z).toBeGreaterThan(130);
  });

  it('device path starts and ends at the ports', () => {
    const pa = devicePortPoint(A, { id: 's', kind: 'server', u: 3, heightU: 2 }, 0);
    const pb = devicePortPoint(B, { id: 'w', kind: 'switch', u: 40, heightU: 1 }, 2);
    const p = devicePath(A, pa, B, pb);
    expect(p[0]).toEqual(pa);
    expect(p[p.length - 1]).toEqual(pb);
    const same = devicePath(A, pa, A, devicePortPoint(A, { id: 'w', kind: 'switch', u: 40, heightU: 1 }, 1));
    expect(same).toHaveLength(4);
  });

  it('edge point keeps the height on the face', () => {
    const pa = devicePortPoint(A, { id: 's', kind: 'server', u: 3, heightU: 2 }, 0);
    const e = faceEdgePoint(A, pa);
    expect(e.x).toBeGreaterThan(pa.x);
    expect(bundleWidth(1)).toBeLessThan(bundleWidth(8));
    expect(bundleWidth(1000)).toBe(3);
  });

  it('offsets a polyline sideways with mitred joins (ribbon outline edges)', () => {
    const o = offsetPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 2);
    expect(o[0]).toEqual({ x: 0, y: 2 });
    expect(o[1]!.x).toBeCloseTo(8);
    expect(o[1]!.y).toBeCloseTo(2);
    expect(o[2]!.x).toBeCloseTo(8);
    expect(o[2]!.y).toBeCloseTo(10);
  });
});
