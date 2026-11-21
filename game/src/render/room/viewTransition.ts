/**
 * Room -> object view transition (UX.md §7.2): camera tween towards the object, then a crossfade.
 * Pure timeline math (no PixiJS) so it is unit-tested; the screen applies the values.
 *
 *   open:  zoom 350 ms (ease-out cubic) -> crossfade 150 ms (new view scale 0.96 -> 1)
 *   close: crossfade 150 ms -> camera back to the saved room camera 250 ms
 *   reduced motion: no camera flight, only a 100 ms fade.
 * Any input during the transition finishes it immediately (`finish()`).
 */
import type { Camera } from '../camera';

export const ZOOM_MS = 350;
export const FADE_MS = 150;
export const RETURN_MS = 250;
export const REDUCED_FADE_MS = 100;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, scale: a.scale + (b.scale - a.scale) * t };
}

/**
 * Camera that puts the world rect at the centre of the screen area so that it fills `fill` of the area height
 * (clamped by width). Used to fly onto a rack (~70 % of the height).
 */
export function cameraOnto(
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  area: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  fill = 0.7,
): Camera {
  const scale = Math.min((area.height * fill) / Math.max(1, rect.height), (area.width * fill) / Math.max(1, rect.width));
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { x: area.x + area.width / 2 - cx * scale, y: area.y + area.height / 2 - cy * scale, scale };
}

export interface TransitionFrame {
  /** Room camera (null = leave it). */
  readonly camera: Camera | null;
  /** Alpha of the room world. */
  readonly roomAlpha: number;
  /** Alpha of the object view. */
  readonly viewAlpha: number;
  /** Scale of the object view (0.96 -> 1 while it fades in). */
  readonly viewScale: number;
  readonly done: boolean;
}

export type TransitionDirection = 'open' | 'close';

/** Stateless timeline: frame at `elapsedMs`. */
export function transitionFrame(
  dir: TransitionDirection,
  elapsedMs: number,
  from: Camera,
  to: Camera,
  reducedMotion: boolean,
): TransitionFrame {
  if (reducedMotion) {
    const t = Math.min(1, elapsedMs / REDUCED_FADE_MS);
    const a = dir === 'open' ? t : 1 - t;
    return { camera: dir === 'close' ? to : null, roomAlpha: 1 - a, viewAlpha: a, viewScale: 1, done: t >= 1 };
  }
  if (dir === 'open') {
    if (elapsedMs < ZOOM_MS) {
      return { camera: lerpCamera(from, to, easeOutCubic(elapsedMs / ZOOM_MS)), roomAlpha: 1, viewAlpha: 0, viewScale: 0.96, done: false };
    }
    const t = Math.min(1, (elapsedMs - ZOOM_MS) / FADE_MS);
    return { camera: to, roomAlpha: 1 - t, viewAlpha: t, viewScale: 0.96 + 0.04 * t, done: t >= 1 };
  }
  if (elapsedMs < FADE_MS) {
    const t = elapsedMs / FADE_MS;
    return { camera: from, roomAlpha: t, viewAlpha: 1 - t, viewScale: 1 - 0.04 * t, done: false };
  }
  const t = Math.min(1, (elapsedMs - FADE_MS) / RETURN_MS);
  return { camera: lerpCamera(from, to, easeOutCubic(t)), roomAlpha: 1, viewAlpha: 0, viewScale: 0.96, done: t >= 1 };
}

/** Total duration of a transition. */
export function transitionDuration(dir: TransitionDirection, reducedMotion: boolean): number {
  if (reducedMotion) return REDUCED_FADE_MS;
  return dir === 'open' ? ZOOM_MS + FADE_MS : FADE_MS + RETURN_MS;
}
