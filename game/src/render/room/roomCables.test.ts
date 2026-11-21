import { describe, expect, it } from 'vitest';
import { bezierPoint } from '../geom/bezier';
import { LOAD_COLORS } from '../traffic/loadStyle';
import { TRAFFIC_STYLE } from '../traffic/trafficTypes';
import { roomCableColor, roomCableCurve } from './roomCables';

describe('room cables', () => {
  it('connects the two ports', () => {
    const p0 = { x: 0, y: 0 };
    const p3 = { x: 100, y: 20 };
    const c = roomCableCurve(p0, p3, false);
    expect(bezierPoint(c, 0)).toEqual(p0);
    const end = bezierPoint(c, 1);
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(20);
  });

  it('arcs above the ports between cabinets', () => {
    const c = roomCableCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, false);
    expect(bezierPoint(c, 0.5).y).toBeLessThan(-20);
  });

  it('uses the traffic-type colour unless the link is overloaded', () => {
    expect(roomCableColor('vsan', 0.5)).toBe(TRAFFIC_STYLE.vsan.color);
    expect(roomCableColor('vsan', 0.85)).toBe(LOAD_COLORS.warn);
    expect(roomCableColor('vsan', 0.99)).toBe(LOAD_COLORS.crit);
  });
});
