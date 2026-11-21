import { describe, expect, it } from 'vitest';
import { LOAD_COLORS, MAX_CABLE_WIDTH, MIN_CABLE_WIDTH, loadBand, loadColor, loadWidth } from './loadStyle';
import { TRAFFIC_STYLE, TRAFFIC_TYPES } from './trafficTypes';

describe('loadStyle', () => {
  it('maps utilisation to bands with strict thresholds', () => {
    expect(loadBand(0)).toBe('normal');
    expect(loadBand(0.8)).toBe('normal');
    expect(loadBand(0.81)).toBe('warn');
    expect(loadBand(0.95)).toBe('warn');
    expect(loadBand(0.951)).toBe('crit');
    expect(loadBand(1.3)).toBe('crit');
  });

  it('maps bands to yellow / red colours', () => {
    expect(loadColor(0.9)).toBe(0xf2c94c);
    expect(loadColor(0.99)).toBe(0xe5484d);
    expect(loadColor(0.2)).toBe(LOAD_COLORS.normal);
  });

  it('scales width linearly and clamps', () => {
    expect(loadWidth(0)).toBe(MIN_CABLE_WIDTH);
    expect(loadWidth(1)).toBe(MAX_CABLE_WIDTH);
    expect(loadWidth(2)).toBe(MAX_CABLE_WIDTH);
    expect(loadWidth(-1)).toBe(MIN_CABLE_WIDTH);
    expect(loadWidth(Number.NaN)).toBe(MIN_CABLE_WIDTH);
    expect(loadWidth(0.5, 2, 4)).toBe(3);
  });
});

describe('trafficTypes', () => {
  it('uses the GRAPHICS.md palette', () => {
    expect(TRAFFIC_TYPES).toHaveLength(6);
    expect(TRAFFIC_STYLE.management.css).toBe('#a9b6c9');
    expect(TRAFFIC_STYLE.vmotion.css).toBe('#f0a14a');
    expect(TRAFFIC_STYLE.vsan.css).toBe('#4cc38a');
    expect(TRAFFIC_STYLE.nfs.css).toBe('#1fa3b8');
    expect(TRAFFIC_STYLE.overlay.css).toBe('#a37cf0');
    expect(TRAFFIC_STYLE.vm.css).toBe('#e8edf3');
    for (const t of TRAFFIC_TYPES) {
      expect(TRAFFIC_STYLE[t].color).toBe(parseInt(TRAFFIC_STYLE[t].css.slice(1), 16));
    }
  });
});
