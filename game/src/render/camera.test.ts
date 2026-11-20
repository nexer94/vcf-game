import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE, fitRect, pan, screenToWorld, worldToScreen, zoomAt, zoomLevelForScale } from './camera';

describe('camera', () => {
  const cam = { x: 100, y: 50, scale: 2 };

  it('round-trips screen <-> world', () => {
    const w = screenToWorld(cam, 300, 250);
    expect(w).toEqual({ x: 100, y: 100 });
    expect(worldToScreen(cam, w.x, w.y)).toEqual({ x: 300, y: 250 });
  });

  it('pans by screen delta', () => {
    expect(pan(cam, 5, -5)).toEqual({ x: 105, y: 45, scale: 2 });
  });

  it('keeps the point under the cursor fixed when zooming', () => {
    const before = screenToWorld(cam, 320, 200);
    const z = zoomAt(cam, 1.5, 320, 200);
    expect(z.scale).toBeCloseTo(3);
    const after = screenToWorld(z, 320, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps zoom', () => {
    expect(zoomAt(cam, 100, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomAt(cam, 0.001, 0, 0).scale).toBe(MIN_SCALE);
  });

  it('fits a rect into the screen centred', () => {
    const c = fitRect({ x: 0, y: 0, width: 100, height: 100 }, 280, 280, 40);
    expect(c.scale).toBe(2);
    expect(worldToScreen(c, 50, 50)).toEqual({ x: 140, y: 140 });
  });

  it('maps scale to zoom level names', () => {
    expect(zoomLevelForScale(0.5)).toBe('Cluster');
    expect(zoomLevelForScale(1)).toBe('Rack');
    expect(zoomLevelForScale(2.5)).toBe('Host');
  });
});
