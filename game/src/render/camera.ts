/**
 * 2D camera for the isometric world: screen = world * scale + (x, y).
 * Pure math (unit-tested); DOM wiring lives in cameraControls.ts.
 */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

export const MIN_SCALE = 0.35;
export const MAX_SCALE = 3.5;

export function clampScale(scale: number, min = MIN_SCALE, max = MAX_SCALE): number {
  return Math.min(max, Math.max(min, scale));
}

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale };
}

export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * cam.scale + cam.x, y: wy * cam.scale + cam.y };
}

export function pan(cam: Camera, dx: number, dy: number): Camera {
  return { x: cam.x + dx, y: cam.y + dy, scale: cam.scale };
}

/** Zoom by `factor` keeping the world point under screen (sx, sy) fixed. */
export function zoomAt(cam: Camera, factor: number, sx: number, sy: number, min = MIN_SCALE, max = MAX_SCALE): Camera {
  const scale = clampScale(cam.scale * factor, min, max);
  const w = screenToWorld(cam, sx, sy);
  return { x: sx - w.x * scale, y: sy - w.y * scale, scale };
}

/** Camera that fits a world rectangle into a screen of size (sw, sh) with padding. */
export function fitRect(
  rect: { x: number; y: number; width: number; height: number },
  sw: number,
  sh: number,
  padding = 40,
): Camera {
  const scale = clampScale(Math.min((sw - padding * 2) / rect.width, (sh - padding * 2) / rect.height));
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { x: sw / 2 - cx * scale, y: sh / 2 - cy * scale, scale };
}

/**
 * Zoom levels from GRAPHICS.md. The prototype only has a datacenter floor,
 * so only the closest levels are reachable; the rest are groundwork.
 */
export const ZOOM_LEVELS = ['Private Cloud', 'Fleet', 'Instance', 'Domain', 'Cluster', 'Rack', 'Host'] as const;
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

export function zoomLevelForScale(scale: number): ZoomLevel {
  if (scale < 0.7) return 'Cluster';
  if (scale < 1.8) return 'Rack';
  return 'Host';
}
