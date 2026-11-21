import { describe, expect, it } from 'vitest';
import { zoomAt, pan, worldToScreen } from '../../render/camera';
import { anchorVisible, clampIntoScene, edgeArrow, resolveAnchor, worldRectToScreen } from './bubbleAnchor';
import { placePopover } from './layoutZones';

const scene = { x: 0, y: 48, w: 1366, h: 768 - 48 - 176 };
const avatarWorld = { x: 90, y: 40, width: 20, height: 60 };

describe('bubble anchoring (world -> screen)', () => {
  it('maps a world rect through the camera like render/camera worldToScreen', () => {
    const cam = { x: 300, y: 120, scale: 1.5 };
    const r = worldRectToScreen(cam, avatarWorld);
    const p = worldToScreen(cam, avatarWorld.x, avatarWorld.y);
    expect(r).toEqual({ x: p.x, y: p.y, w: 30, h: 90 });
  });

  it('follows the anchor through zoom and pan (anchor under the cursor stays fixed)', () => {
    let cam = { x: 400, y: 200, scale: 1 };
    const before = worldRectToScreen(cam, avatarWorld);
    // Zoom around the avatar's top-left corner: that point stays at the same screen position, size scales.
    cam = zoomAt(cam, 2, before.x, before.y);
    const zoomed = worldRectToScreen(cam, avatarWorld);
    expect(zoomed.x).toBeCloseTo(before.x);
    expect(zoomed.y).toBeCloseTo(before.y);
    expect(zoomed.w).toBeCloseTo(before.w * 2);
    cam = pan(cam, -50, 30);
    const panned = worldRectToScreen(cam, avatarWorld);
    expect(panned.x).toBeCloseTo(zoomed.x - 50);
    expect(panned.y).toBeCloseTo(zoomed.y + 30);
  });

  it('attaches when visible, falls back to the avatar, edge arrow when off screen, nothing without anchor', () => {
    const avatar = { x: 600, y: 300, w: 20, h: 60 };
    const offRack = { x: 2000, y: 300, w: 40, h: 80 };
    expect(resolveAnchor(avatar, null, scene)).toEqual({ kind: 'attach', rect: avatar });
    expect(resolveAnchor(offRack, avatar, scene)).toEqual({ kind: 'attach', rect: avatar });
    const e = resolveAnchor({ x: 2000, y: 300, w: 20, h: 60 }, null, scene);
    expect(e.kind).toBe('edge');
    if (e.kind === 'edge') {
      expect(e.x).toBeLessThanOrEqual(scene.x + scene.w);
      expect(e.x).toBeGreaterThan(scene.x + scene.w - 40);
      expect(Math.abs(e.angle)).toBeLessThan(Math.PI / 2); // points right
    }
    expect(resolveAnchor(null, null, scene)).toEqual({ kind: 'none' });
  });

  it('anchor partly under the HUD is not visible', () => {
    expect(anchorVisible({ x: 600, y: 10, w: 20, h: 30 }, scene)).toBe(false);
    expect(anchorVisible({ x: 600, y: 60, w: 20, h: 60 }, scene)).toBe(true);
  });

  it('edge arrow stays inside the scene in every direction', () => {
    for (const p of [{ x: -500, y: 300 }, { x: 600, y: -900 }, { x: 600, y: 5000 }, { x: 9000, y: 9000 }]) {
      const e = edgeArrow(p, scene);
      expect(e.kind).toBe('edge');
      if (e.kind !== 'edge') continue;
      expect(e.x).toBeGreaterThanOrEqual(scene.x);
      expect(e.x).toBeLessThanOrEqual(scene.x + scene.w);
      expect(e.y).toBeGreaterThanOrEqual(scene.y);
      expect(e.y).toBeLessThanOrEqual(scene.y + scene.h);
    }
  });

  it('clamps the card into the free scene (never over HUD / shop) and keeps the tail on the anchor', () => {
    const anchor = { x: 1350, y: 520, w: 20, h: 60 };
    const size = { w: 320, h: 90 };
    const p0 = placePopover(anchor, size, [], { w: 1366, h: 768 });
    const p = clampIntoScene(p0, size, anchor, scene);
    expect(p.x).toBeGreaterThanOrEqual(scene.x);
    expect(p.x + size.w).toBeLessThanOrEqual(scene.x + scene.w);
    expect(p.y).toBeGreaterThanOrEqual(scene.y);
    expect(p.y + size.h).toBeLessThanOrEqual(scene.y + scene.h);
    expect(p.arrow).toBeGreaterThanOrEqual(14);
  });
});
