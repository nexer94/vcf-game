import { describe, expect, it } from 'vitest';
import { congestionSpeed, dominantType, dotScale, emitRate, flowWidth, formatGbps, ledHz, levelT, quantize } from './flowScale';

describe('flowScale (UX §28.4)', () => {
  it('levelT maps 1 Mb/s -> 0 and 100 Gb/s -> 1 on a log scale, clamped', () => {
    expect(levelT(0.001)).toBeCloseTo(0);
    expect(levelT(100)).toBeCloseTo(1);
    expect(levelT(1)).toBeCloseTo(0.6);
    expect(levelT(0.0001)).toBe(0);
    expect(levelT(1000)).toBe(1);
    expect(levelT(0)).toBe(0);
    expect(levelT(Number.NaN)).toBe(0);
  });

  it('ribbon width follows w = 1.5 + 8.5·(g/100)^0.35 (reference table §28.4)', () => {
    expect(flowWidth(0.001)).toBeCloseTo(1.65, 1);
    expect(flowWidth(4)).toBeCloseTo(4.3, 1);
    expect(flowWidth(8)).toBeCloseTo(5.0, 1);
    expect(flowWidth(25)).toBeCloseTo(6.7, 1);
    expect(flowWidth(100)).toBeCloseTo(10, 5);
    expect(flowWidth(100, 0.7)).toBeCloseTo(7, 5);
    expect(flowWidth(0)).toBe(0);
    expect(flowWidth(8)).toBeGreaterThan(flowWidth(4));
  });

  it('quantises widths to 0.5 px', () => {
    expect(quantize(4.3)).toBe(4.5);
    expect(quantize(4.2)).toBe(4);
    expect(quantize(1.74)).toBe(1.5);
  });

  it('emission is logarithmic with a 0.4 dots/s minimum', () => {
    expect(emitRate(0.001)).toBeCloseTo(0.4);
    expect(emitRate(0.00001)).toBeCloseTo(0.4);
    expect(emitRate(4)).toBeCloseTo(2.3, 1);
    expect(emitRate(100)).toBeCloseTo(3.0);
    expect(emitRate(0)).toBe(0);
    expect(emitRate(8)).toBeGreaterThan(emitRate(4));
  });

  it('dot size grows with volume', () => {
    expect(dotScale(0.001)).toBeCloseTo(0.55);
    expect(dotScale(100)).toBeCloseTo(0.9);
    expect(dotScale(4)).toBeCloseTo(0.8, 1);
  });

  it('LED blinks 0.5–4 Hz, steady at 0', () => {
    expect(ledHz(0)).toBe(0);
    expect(ledHz(0.001)).toBeCloseTo(0.5);
    expect(ledHz(100)).toBeCloseTo(4);
    expect(ledHz(1e6)).toBeCloseTo(4);
  });

  it('dots slow down only with congestion', () => {
    expect(congestionSpeed(0)).toBe(1);
    expect(congestionSpeed(1)).toBeCloseTo(0.4);
    expect(congestionSpeed(2)).toBeCloseTo(0.4);
  });

  it('formats volumes in Czech with ≈ (illustrative)', () => {
    expect(formatGbps(0)).toBe('≈ < 1 Mb/s');
    expect(formatGbps(0.0005)).toBe('≈ < 1 Mb/s');
    expect(formatGbps(0.0015)).toBe('≈ 1,5 Mb/s');
    expect(formatGbps(0.05)).toBe('≈ 50 Mb/s');
    expect(formatGbps(0.84)).toBe('≈ 840 Mb/s');
    expect(formatGbps(4.2)).toBe('≈ 4,2 Gb/s');
    expect(formatGbps(18)).toBe('≈ 18,0 Gb/s');
    expect(formatGbps(120)).toBe('≈ 120 Gb/s');
  });

  it('dominant type needs ≥ 60 % of the volume', () => {
    expect(dominantType([{ type: 'vsan', gbps: 4 }, { type: 'management', gbps: 0.05 }])).toBe('vsan');
    expect(dominantType([{ type: 'vsan', gbps: 4 }, { type: 'vmotion', gbps: 4 }])).toBeNull();
    expect(dominantType([{ type: 'vsan', gbps: 2 }, { type: 'vsan', gbps: 2 }, { type: 'vmotion', gbps: 2 }])).toBe('vsan');
    expect(dominantType([])).toBeNull();
  });
});
