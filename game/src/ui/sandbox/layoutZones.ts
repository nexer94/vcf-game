/**
 * Layout zones of the server room (UX.md Part III ch. 22) – pure geometry, unit-tested, no DOM writes except
 * `applyZoneVars` (CSS variables that the CSS grid, Pixi `fitToRect` and the speech bubbles all read).
 *
 *   HUD 48 · checklist 264/288 left · right panel clamp(320, 28vw, 440)/420 · shop 176/212 open, 40 collapsed.
 *   Scene = the rest; the camera fits into the free scene rect (not the whole window).
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ZoneState {
  readonly viewportW: number;
  readonly viewportH: number;
  /** Checklist panel shown (Career only; Sandbox has none – user decision 2026-11-22). */
  readonly checklist: 'open' | 'bar' | 'hidden';
  readonly rightPanel: boolean;
  readonly shop: 'open' | 'collapsed' | 'none';
}

export interface Zones {
  readonly hudH: number;
  readonly checklistW: number;
  readonly rightW: number;
  readonly shopH: number;
  /** Free scene rect (camera fit, bubble placement). */
  readonly scene: Rect;
  /** Obstacles for popovers / bubbles (HUD, checklist, right panel, shop). */
  readonly obstacles: readonly Rect[];
  /** Checklist should auto-collapse (window < 1200 px or free scene width < 560 px – UX 17.3 / 22.1). */
  readonly autoCollapseChecklist: boolean;
}

export const HUD_H = 48;
const CHECKLIST_BAR_H = 40;
const GAP = 12;

const large = (w: number, h: number): boolean => w >= 1680 && h >= 960;

export function computeZones(s: ZoneState): Zones {
  const big = large(s.viewportW, s.viewportH);
  const small = s.viewportW < 1280 || s.viewportH < 720;
  const checklistW = s.checklist === 'hidden' ? 0 : big ? 288 : 264;
  const rightW = s.rightPanel ? (big ? 420 : Math.round(Math.min(440, Math.max(320, s.viewportW * 0.28)))) : 0;
  const shopOpen = big ? 212 : small ? 156 : 176;
  const shopH = s.shop === 'open' ? shopOpen : s.shop === 'collapsed' ? 40 : 0;
  const sceneTop = HUD_H;
  const scene: Rect = { x: 0, y: sceneTop, w: Math.max(0, s.viewportW - rightW), h: Math.max(0, s.viewportH - sceneTop - shopH) };
  const obstacles: Rect[] = [{ x: 0, y: 0, w: s.viewportW, h: HUD_H }];
  if (s.checklist === 'open') obstacles.push({ x: GAP, y: HUD_H + GAP, w: checklistW, h: Math.min(360, scene.h - 2 * GAP) });
  if (s.checklist === 'bar') obstacles.push({ x: GAP, y: HUD_H + GAP, w: checklistW, h: CHECKLIST_BAR_H });
  if (rightW) obstacles.push({ x: s.viewportW - rightW, y: HUD_H, w: rightW, h: scene.h });
  if (shopH) obstacles.push({ x: 0, y: s.viewportH - shopH, w: s.viewportW, h: shopH });
  const freeW = scene.w - (s.checklist === 'open' ? checklistW + GAP : 0);
  return {
    hudH: HUD_H,
    checklistW,
    rightW,
    shopH,
    scene,
    obstacles,
    autoCollapseChecklist: s.viewportW < 1200 || (s.rightPanel && freeW < 560),
  };
}

/** Write the zone sizes as CSS variables on the room UI root. */
export function applyZoneVars(el: { readonly style: { setProperty(name: string, value: string): void } }, z: Zones): void {
  el.style.setProperty('--top-h', `${z.hudH}px`);
  el.style.setProperty('--checklist-w', `${z.checklistW}px`);
  el.style.setProperty('--right-w', `${z.rightW}px`);
  el.style.setProperty('--shop-h', `${z.shopH}px`);
  el.style.setProperty('--bottom-h', `${z.shopH}px`);
}

const overlap = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly side: Side;
  /** Arrow (tail) position along the edge facing the anchor, px from the popover's left / top. */
  readonly arrow: number;
}

/**
 * Shared placement of popovers and speech bubbles (UX 22.2): try above, below, right, left of the anchor; pick the
 * first side without overlap with obstacles (else the least overlapping), then clamp into the viewport.
 */
export function placePopover(
  anchor: Rect,
  size: { readonly w: number; readonly h: number },
  obstacles: readonly Rect[],
  viewport: { readonly w: number; readonly h: number },
  prefer: readonly Side[] = ['top', 'bottom', 'right', 'left'],
  gap = 10,
): Placement {
  const ax = anchor.x + anchor.w / 2;
  const ay = anchor.y + anchor.h / 2;
  const cand = (side: Side): Rect => {
    switch (side) {
      case 'top':
        return { x: ax - size.w / 2, y: anchor.y - gap - size.h, w: size.w, h: size.h };
      case 'bottom':
        return { x: ax - size.w / 2, y: anchor.y + anchor.h + gap, w: size.w, h: size.h };
      case 'right':
        return { x: anchor.x + anchor.w + gap, y: ay - size.h / 2, w: size.w, h: size.h };
      case 'left':
        return { x: anchor.x - gap - size.w, y: ay - size.h / 2, w: size.w, h: size.h };
    }
  };
  const clamp = (r: Rect): Rect => ({
    ...r,
    x: Math.max(8, Math.min(viewport.w - r.w - 8, r.x)),
    y: Math.max(8, Math.min(viewport.h - r.h - 8, r.y)),
  });
  let best: { side: Side; r: Rect; cost: number } | null = null;
  for (const side of prefer) {
    const raw = cand(side);
    const r = clamp(raw);
    const outside = Math.abs(r.x - raw.x) + Math.abs(r.y - raw.y);
    // Never cover the anchor itself.
    const cost = obstacles.reduce((s, o) => s + overlap(r, o), 0) + overlap(r, anchor) * 4 + outside * 50;
    if (!best || cost < best.cost) best = { side, r, cost };
    if (cost === 0) break;
  }
  const b = best!;
  const arrow = b.side === 'top' || b.side === 'bottom' ? Math.max(14, Math.min(b.r.w - 14, ax - b.r.x)) : Math.max(14, Math.min(b.r.h - 14, ay - b.r.y));
  return { x: Math.round(b.r.x), y: Math.round(b.r.y), side: b.side, arrow: Math.round(arrow) };
}

/** Is a rect fully inside the scene (used to decide if a bubble anchor is on screen). */
export const rectInside = (r: Rect, area: Rect): boolean => r.x >= area.x && r.y >= area.y && r.x + r.w <= area.x + area.w && r.y + r.h <= area.y + area.h;
