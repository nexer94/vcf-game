import { describe, expect, it } from 'vitest';
import { bezierPoint, distanceToPolyline, distanceToSegment, polylineLength, sampleBezier, type CubicBezier } from './bezier';

const straight: CubicBezier = { p0: { x: 0, y: 0 }, p1: { x: 10, y: 0 }, p2: { x: 20, y: 0 }, p3: { x: 30, y: 0 } };
const curve: CubicBezier = { p0: { x: 0, y: 0 }, p1: { x: 0, y: 100 }, p2: { x: 100, y: 100 }, p3: { x: 100, y: 0 } };

describe('bezier', () => {
  it('hits the endpoints at t=0 and t=1', () => {
    expect(bezierPoint(curve, 0)).toEqual({ x: 0, y: 0 });
    expect(bezierPoint(curve, 1)).toEqual({ x: 100, y: 0 });
  });

  it('evaluates the midpoint of a symmetric curve', () => {
    const m = bezierPoint(curve, 0.5);
    expect(m.x).toBeCloseTo(50);
    expect(m.y).toBeCloseTo(75);
  });

  it('writes into the provided out vector', () => {
    const out = { x: -1, y: -1 };
    expect(bezierPoint(straight, 0.5, out)).toBe(out);
    expect(out.x).toBeCloseTo(15);
  });

  it('samples and measures a straight line exactly', () => {
    const pts = sampleBezier(straight, 6);
    expect(pts.length).toBe(14);
    expect(polylineLength(pts)).toBeCloseTo(30);
  });

  it('measures distances to segments and polylines', () => {
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
    expect(distanceToSegment(-4, 3, 0, 0, 10, 0)).toBeCloseTo(5);
    const pts = sampleBezier(straight, 4);
    expect(distanceToPolyline(pts, 15, -2)).toBeCloseTo(2);
    expect(distanceToPolyline(new Float32Array(), 0, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});
