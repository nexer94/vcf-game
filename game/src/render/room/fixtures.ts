/**
 * Fixed interactive objects of the server room (UX.md §10.1, §11.1) – not bought, not movable:
 *  - '@pc'    desk with the admin workstation (monitor, keyboard, chair) at the left wall,
 *  - '@board' whiteboard on the right wall (replaces the old poster) with a live LOD thumbnail of the
 *             auto High-Level Design (boxes and lines only, no text) and a "!" sticker for new content.
 * Original cosy art; the desk is baked into one texture, the board is a few Graphics on the wall plane.
 * Render-only; RoomScene only places them (occupancy, picking, highlight).
 */
import { Container, Graphics, Matrix, Rectangle, Sprite, type Renderer, type Texture } from 'pixi.js';
import { isoToScreen, TILE_H, TILE_W } from '../iso';
import type { HldLayout } from '../whiteboard/hldLayout';
import { BOARD_H, NOTES_X } from '../whiteboard/notes';
import { poly, prism, sideQuad, up, type P } from './draw';
import { OUTLINE } from './palette';
import { depthOf, type Footprint } from './roomGrid';
import { BOARD_WALL as SHARED_BOARD_WALL, DESK_FOOTPRINT } from '../../model/roomFixtures';

export type FixtureId = '@pc' | '@board';
export const FIXTURE_IDS: readonly FixtureId[] = ['@board', '@pc'];
export const isFixtureId = (id: string | null | undefined): id is FixtureId => id === '@pc' || id === '@board';

/**
 * Desk footprint (left wall, between the corner and the door). Blocks these tiles for racks and walking.
 * Shared game data with the engine's rack placement rules (model/roomFixtures.ts – single source).
 */
export const DESK: Footprint = DESK_FOOTPRINT;
/** Whiteboard on the right wall (gy = 0): u = tiles along +gx, h = px above the floor (model/roomFixtures.ts). */
export const BOARD_WALL = SHARED_BOARD_WALL;
/** Flat board space mapped onto the wall (px of the 2D board drawing). */
const BW = 172;
const BH = 92;

const C = {
  wood: 0xe9b77a,
  woodSide: 0xc98f52,
  woodTop: 0xf5cf98,
  leg: 0x8a6a4a,
  monitor: 0x24324a,
  monitorSide: 0x1a2538,
  screen: 0xbfe6ff,
  screenGlow: 0xe8f7ff,
  key: 0xf6f8fa,
  keyShade: 0xd5dde8,
  chair: 0x3b5f8f,
  chairDark: 0x2b4a78,
  chairTop: 0x6f8fb8,
  mug: 0xff7a8a,
  plant: 0x4cc38a,
  pot: 0xd98a3d,
  frame: 0xc8ccd6,
  frameDark: 0x9aa1b1,
  surface: 0xfbfbf7,
  ink: 0x1f3477,
  sticker: 0xffd34d,
} as const;

function drawDesk(g: Graphics): void {
  const { gx, gy } = DESK;
  // Legs (back pair first).
  const legs = [
    [gx + 0.1, gy + 0.12],
    [gx + 0.1, gy + 1.78],
    [gx + 0.66, gy + 0.12],
    [gx + 0.66, gy + 1.78],
  ] as const;
  for (const [x, y] of legs) prism(g, x, y, 0.07, 0.07, 28, { top: C.leg, front: C.leg, side: C.leg });
  // Drawer block under the far end.
  prism(g, gx + 0.12, gy + 0.15, 0.56, 0.55, 26, { top: C.woodTop, front: C.wood, side: C.woodSide }, 2);
  // Table top.
  prism(g, gx + 0.06, gy + 0.08, 0.68, 1.84, 4, { top: C.woodTop, front: C.wood, side: C.woodSide }, 28);
  // Plant in the corner of the desk (cosy decor).
  prism(g, gx + 0.18, gy + 0.22, 0.16, 0.16, 8, { top: C.pot, front: C.pot, side: 0xb86f2c }, 32);
  const leaf = up(isoToScreen(gx + 0.26, gy + 0.3), 46);
  g.circle(leaf.x - 3, leaf.y + 2, 5).circle(leaf.x + 3, leaf.y, 5).circle(leaf.x, leaf.y - 4, 5).fill({ color: C.plant }).stroke({ color: OUTLINE, width: 1.2 });
  // Monitor stand + monitor facing the room (+gx).
  prism(g, gx + 0.2, gy + 0.92, 0.12, 0.16, 6, { top: C.monitorSide, front: C.monitor, side: C.monitor }, 32);
  prism(g, gx + 0.18, gy + 0.5, 0.08, 1.0, 30, { top: C.monitorSide, front: C.monitorSide, side: C.monitor }, 38);
  const scr = sideQuad(gx + 0.18, gy + 0.5, 0.08, 1.0, 0.07, 0.93, 41, 65);
  poly(g, scr, C.screen);
  // Tiny "desktop": dock strip + window (original, no OS look-alike).
  poly(g, sideQuad(gx + 0.18, gy + 0.5, 0.08, 1.0, 0.09, 0.22, 43, 63), 0x8fb9e8, false);
  poly(g, sideQuad(gx + 0.18, gy + 0.5, 0.08, 1.0, 0.28, 0.88, 46, 61), C.screenGlow, false);
  poly(g, sideQuad(gx + 0.18, gy + 0.5, 0.08, 1.0, 0.28, 0.88, 58, 61), 0xc41f33, false);
  // Keyboard + mouse + mug.
  prism(g, gx + 0.44, gy + 0.62, 0.2, 0.74, 2, { top: C.key, front: C.keyShade, side: C.keyShade }, 32);
  for (let i = 0; i < 4; i++) {
    const a = up(isoToScreen(gx + 0.48 + i * 0.04, gy + 0.68), 34.5);
    const b = up(isoToScreen(gx + 0.48 + i * 0.04, gy + 1.3), 34.5);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  g.stroke({ color: C.keyShade, width: 1 });
  prism(g, gx + 0.5, gy + 1.5, 0.1, 0.08, 2, { top: C.key, front: C.keyShade, side: C.keyShade }, 32);
  prism(g, gx + 0.5, gy + 0.22, 0.1, 0.1, 9, { top: 0xffd0d6, front: C.mug, side: 0xe0606f }, 32);
  // Office chair in front of the desk.
  const cx = gx + 0.8;
  const cy = gy + 0.72;
  prism(g, cx + 0.12, cy + 0.24, 0.06, 0.06, 16, { top: OUTLINE, front: 0x4a5566, side: 0x4a5566 });
  prism(g, cx - 0.02, cy + 0.12, 0.34, 0.3, 1, { top: 0x4a5566, front: 0x24324a, side: 0x24324a }, 1);
  prism(g, cx, cy, 0.3, 0.54, 5, { top: C.chairTop, front: C.chair, side: C.chairDark }, 17);
  prism(g, cx + 0.26, cy + 0.02, 0.08, 0.5, 26, { top: C.chairTop, front: C.chair, side: C.chairDark }, 22);
}

/** Wall-plane transform: flat board (bx 0..BW, by 0..BH) -> world on the right wall. */
function wallMatrix(): Matrix {
  const { u0, u1, h0, h1 } = BOARD_WALL;
  const ku = (u1 - u0) / BW;
  const kh = (h1 - h0) / BH;
  return new Matrix(ku * (TILE_W / 2), ku * (TILE_H / 2), 0, kh, u0 * (TILE_W / 2), u0 * (TILE_H / 2) - h1);
}

const wallPt = (u: number, h: number): P => up(isoToScreen(u, 0), h);

export class RoomFixtures {
  /** Goes into the world right above the static room (wall decorations). */
  readonly wall = new Container();
  /** Goes into the depth-sorted objects container. */
  readonly desk = new Sprite();
  private deskTex: Texture | null = null;
  private readonly boardFlat = new Container();
  private readonly thumb = new Graphics();
  private readonly sticker = new Graphics();

  constructor(renderer: Renderer) {
    const g = new Graphics();
    drawDesk(g);
    const b = g.getLocalBounds();
    const frame = new Rectangle(Math.floor(b.x) - 2, Math.floor(b.y) - 2, Math.ceil(b.width) + 4, Math.ceil(b.height) + 4);
    this.deskTex = renderer.generateTexture({ target: g, frame, resolution: 3, antialias: true });
    g.destroy();
    this.desk.texture = this.deskTex;
    this.desk.position.set(frame.x, frame.y);
    this.desk.zIndex = depthOf(DESK.gx, DESK.gy, DESK.w, DESK.d);

    // Whiteboard: frame + surface + marker tray, drawn flat and mapped onto the wall.
    const fr = new Graphics();
    fr.roundRect(-5, -5, BW + 10, BH + 10, 3).fill({ color: C.frame }).stroke({ color: OUTLINE, width: 1.6 });
    fr.rect(0, 0, BW, BH).fill({ color: C.surface }).stroke({ color: C.frameDark, width: 1 });
    fr.roundRect(BW * 0.3, BH + 3, BW * 0.4, 5, 2).fill({ color: C.frameDark }).stroke({ color: OUTLINE, width: 1 });
    fr.rect(BW * 0.34, BH + 1, 10, 3).fill({ color: 0xc92a2a });
    fr.rect(BW * 0.34 + 14, BH + 1, 10, 3).fill({ color: 0x2b8a3e });
    fr.rect(BW * 0.34 + 28, BH + 1, 10, 3).fill({ color: C.ink });
    this.sticker.visible = false;
    this.sticker.roundRect(BW - 20, -2, 18, 18, 3).fill({ color: C.sticker }).stroke({ color: OUTLINE, width: 1.2 });
    this.sticker.rect(BW - 12, 2, 2.4, 7).rect(BW - 12, 11, 2.4, 2.4).fill({ color: OUTLINE });
    this.boardFlat.addChild(fr, this.thumb, this.sticker);
    this.boardFlat.setFromMatrix(wallMatrix());
    this.wall.addChild(this.boardFlat);
  }

  /**
   * LOD thumbnail of the auto diagram: boxes and lines only (no text). Call throttled (≥ 1 s) – it is one small
   * Graphics, redrawn only when the content changes.
   */
  setThumbnail(layout: HldLayout | null): void {
    const g = this.thumb;
    g.clear();
    if (!layout) return;
    const k = Math.min((BW - 8) / NOTES_X, (BH - 8) / BOARD_H);
    const ox = 4;
    const oy = 4;
    for (const e of layout.edges) g.moveTo(ox + e.a.x * k, oy + e.a.y * k).lineTo(ox + e.b.x * k, oy + e.b.y * k);
    g.stroke({ color: C.ink, width: 0.8, alpha: 0.8 });
    for (const n of layout.nodes) {
      if (n.kind === 'cloud') g.ellipse(ox + (n.x + n.w / 2) * k, oy + (n.y + n.h / 2) * k, (n.w / 2) * k, (n.h / 2) * k);
      else g.rect(ox + n.x * k, oy + n.y * k, n.w * k, n.h * k);
      g.stroke({ color: n.problem ? 0xb42318 : C.ink, width: n.container ? 0.6 : 1, alpha: n.dashed ? 0.45 : 0.9 });
    }
  }

  /** Small "!" sticker: content changed since the board was last opened. */
  setSticker(on: boolean): void {
    this.sticker.visible = on;
  }

  /** Front-most fixture under a world point. */
  at(wx: number, wy: number): FixtureId | null {
    const d = this.desk;
    if (wx >= d.x && wx <= d.x + d.width && wy >= d.y && wy <= d.y + d.height) {
      // Ignore the transparent corners above the chair: inside the desk silhouette only.
      if (pointInPoly(wx, wy, this.silhouette('@pc').pts)) return '@pc';
    }
    if (pointInPoly(wx, wy, this.silhouette('@board').pts)) return '@board';
    return null;
  }

  /** World rect (camera flight target). For the PC the monitor, for the board the board. */
  rect(id: FixtureId): { x: number; y: number; width: number; height: number } {
    const pts = id === '@pc' ? monitorPts() : this.silhouette('@board').pts;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }

  /** Outline for the hover / focus highlight + magnifier anchor + depth. */
  silhouette(id: FixtureId): { pts: P[]; top: P; z: number } {
    if (id === '@board') {
      const { u0, u1, h0, h1 } = BOARD_WALL;
      const pts = [wallPt(u0 - 0.05, h1 + 4), wallPt(u1 + 0.05, h1 + 4), wallPt(u1 + 0.05, h0 - 6), wallPt(u0 - 0.05, h0 - 6)];
      return { pts, top: wallPt((u0 + u1) / 2, h1 + 14), z: 0.1 };
    }
    const { gx, gy } = DESK;
    const x1 = gx + 1.15;
    const y1 = gy + DESK.d;
    const H = 68;
    const pts = [up(isoToScreen(gx, gy), H), up(isoToScreen(x1, gy), 40), isoToScreen(x1, gy), isoToScreen(x1, y1), isoToScreen(gx, y1), up(isoToScreen(gx, y1), H)];
    return { pts, top: up(isoToScreen(gx + 0.25, gy + 1), 74), z: this.desk.zIndex };
  }

  dispose(): void {
    this.deskTex?.destroy(true);
    this.wall.destroy({ children: true });
    this.desk.destroy();
  }
}

function monitorPts(): P[] {
  const { gx, gy } = DESK;
  return sideQuad(gx + 0.18, gy + 0.5, 0.08, 1.0, 0, 1, 38, 68);
}

function pointInPoly(x: number, y: number, pts: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
