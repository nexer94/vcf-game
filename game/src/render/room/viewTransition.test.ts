import { describe, expect, it } from 'vitest';
import { cameraOnto, easeOutCubic, FADE_MS, transitionDuration, transitionFrame, ZOOM_MS } from './viewTransition';

const A = { x: 0, y: 0, scale: 1 };
const B = { x: 100, y: -50, scale: 3 };

describe('view transition', () => {
  it('opens: zoom first, then crossfade', () => {
    const start = transitionFrame('open', 0, A, B, false);
    expect(start.camera).toEqual(A);
    expect(start.viewAlpha).toBe(0);
    const mid = transitionFrame('open', ZOOM_MS / 2, A, B, false);
    expect(mid.roomAlpha).toBe(1);
    expect(mid.camera!.scale).toBeGreaterThan(2); // ease-out: more than half way at half time
    const fade = transitionFrame('open', ZOOM_MS + FADE_MS / 2, A, B, false);
    expect(fade.camera).toEqual(B);
    expect(fade.viewAlpha).toBeCloseTo(0.5);
    expect(fade.viewScale).toBeCloseTo(0.98);
    const end = transitionFrame('open', transitionDuration('open', false), A, B, false);
    expect(end).toMatchObject({ done: true, roomAlpha: 0, viewAlpha: 1, viewScale: 1 });
  });

  it('closes: fade out then fly back', () => {
    const end = transitionFrame('close', transitionDuration('close', false), B, A, false);
    expect(end.done).toBe(true);
    expect(end.camera).toEqual(A);
    expect(end.roomAlpha).toBe(1);
  });

  it('reduced motion: only a short fade, no flight', () => {
    expect(transitionDuration('open', true)).toBe(100);
    const f = transitionFrame('open', 50, A, B, true);
    expect(f.camera).toBeNull();
    expect(f.viewAlpha).toBeCloseTo(0.5);
  });

  it('fits a rect into ~70 % of the area height', () => {
    const cam = cameraOnto({ x: 0, y: 0, width: 50, height: 100 }, { x: 0, y: 0, width: 1000, height: 500 });
    expect(cam.scale).toBeCloseTo(3.5);
    expect(cam.x + 25 * cam.scale).toBeCloseTo(500);
    expect(easeOutCubic(1)).toBe(1);
  });
});
