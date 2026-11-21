/**
 * Speech bubble anchoring math (UX.md Part III ch. 18 / 22.2) – pure geometry, unit-tested, no DOM.
 *
 * The bubble follows its anchor every frame: world rect -> screen rect through the camera
 * (screen = world * scale + (x, y), see render/camera.ts), then either attaches to it (anchor visible in the free
 * scene), shows a small edge arrow pointing towards it (anchor exists but is off screen) or hides (no anchor in the
 * current view). The placed card is clamped into the free scene so it never covers HUD / shop / side panels.
 */
import type { Camera } from '../../render/camera';
import type { Placement, Rect } from './layoutZones';

/** World rect (Pixi style) -> screen rect through the camera. */
export function worldRectToScreen(cam: Camera, r: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): Rect {
  return { x: cam.x + r.x * cam.scale, y: cam.y + r.y * cam.scale, w: r.width * cam.scale, h: r.height * cam.scale };
}

/** Margin (px) the anchor point must keep from the scene edge to count as visible. */
export const VISIBLE_MARGIN = 6;
/** Inset (px) of the edge arrow from the scene border. */
export const EDGE_INSET = 22;

/** The point the bubble tail points to: top-centre of the anchor (avatar head, top of a rack). */
export const anchorPoint = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + Math.min(r.h / 2, 12) });

export function anchorVisible(r: Rect, scene: Rect, margin = VISIBLE_MARGIN): boolean {
  const p = anchorPoint(r);
  return p.x >= scene.x + margin && p.x <= scene.x + scene.w - margin && p.y >= scene.y + margin && p.y <= scene.y + scene.h - margin;
}

export type AnchorPlacement =
  | { readonly kind: 'attach'; readonly rect: Rect }
  /** Anchor off screen: arrow at (x, y) on the scene edge, `angle` (rad, 0 = right, y down) towards the anchor. */
  | { readonly kind: 'edge'; readonly x: number; readonly y: number; readonly angle: number }
  | { readonly kind: 'none' };

/**
 * Decide how to show the bubble for the resolved anchor rect (screen px) – `primary` is the step's own anchor,
 * `fallback` the avatar (a step whose object is off screen talks from the avatar, UX 18.1).
 */
export function resolveAnchor(primary: Rect | null, fallback: Rect | null, scene: Rect): AnchorPlacement {
  if (scene.w <= 2 * EDGE_INSET || scene.h <= 2 * EDGE_INSET) return { kind: 'none' };
  if (primary && anchorVisible(primary, scene)) return { kind: 'attach', rect: primary };
  if (fallback && anchorVisible(fallback, scene)) return { kind: 'attach', rect: fallback };
  const target = primary ?? fallback;
  if (!target) return { kind: 'none' };
  return edgeArrow(anchorPoint(target), scene);
}

/** Point on the scene border (inset) on the ray from the scene centre towards `p`. */
export function edgeArrow(p: { x: number; y: number }, scene: Rect, inset = EDGE_INSET): AnchorPlacement {
  const cx = scene.x + scene.w / 2;
  const cy = scene.y + scene.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (dx === 0 && dy === 0) return { kind: 'none' };
  const hw = scene.w / 2 - inset;
  const hh = scene.h / 2 - inset;
  const t = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { kind: 'edge', x: Math.round(cx + dx * t), y: Math.round(cy + dy * t), angle: Math.atan2(dy, dx) };
}

/**
 * Clamp a popover placement into the free scene rect (placePopover only clamps into the viewport) and move the
 * tail so it keeps pointing at the anchor.
 */
export function clampIntoScene(p: Placement, size: { readonly w: number; readonly h: number }, anchor: Rect, scene: Rect, pad = 8): Placement {
  const x = Math.round(Math.max(scene.x + pad, Math.min(scene.x + scene.w - size.w - pad, p.x)));
  const y = Math.round(Math.max(scene.y + pad, Math.min(scene.y + scene.h - size.h - pad, p.y)));
  const a = anchorPoint(anchor);
  const arrow = p.side === 'top' || p.side === 'bottom' ? Math.max(14, Math.min(size.w - 14, a.x - x)) : Math.max(14, Math.min(size.h - 14, a.y - y));
  return { x, y, side: p.side, arrow: Math.round(arrow) };
}
