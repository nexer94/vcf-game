/**
 * Whiteboard renderer (UX.md §10.3, §10.7) – PixiJS, no filters.
 *
 * - Board surface + aluminium frame: one Graphics drawn once.
 * - Auto diagram (hldLayout): hand-drawn Graphics baked into ONE texture per zoom step (1× / 2× / 3×, capped at
 *   4096 px); labels are live Text objects whose resolution follows the zoom step (crisp at any zoom).
 * - Player notes: finished strokes merged into blocks of 50 strokes per Graphics; the stroke being drawn is one
 *   Graphics extended incrementally.
 * The auto diagram uses a reserved ink colour the player does not have.
 */
import { Container, Graphics, Rectangle, Sprite, Text, type Renderer, type Texture } from 'pixi.js';
import type { HldLayout, HldNode, BoardTraffic } from './hldLayout';
import { BOARD_H, BOARD_W, NOTES_X, PEN_COLORS, PEN_WIDTHS, type PageNotes, type PenColorId } from './notes';
import { arrowHead, dashPolyline, hashSeed, sketchCloud, sketchEllipse, sketchLine, sketchRect, type Pt } from './sketch';

/** Reserved ink of the auto diagram (dark blue) – never in the player's palette. */
export const AUTO_INK = 0x1f3477;
export const AUTO_INK_CSS = '#1f3477';
const BMC_INK = 0x7a7f8f;
export const BOARD_SURFACE = 0xfbfbf7;
const FRAME = 0xb9bfc9;
const FRAME_DARK = 0x8b93a1;
export const HAND_FONT = "'Patrick Hand', 'Comic Neue', 'Comic Sans MS', 'Segoe Print', 'Bradley Hand', 'Chalkboard SE', cursive";

/** Same colours as the packets (GRAPHICS.md "Vizualizace provozu"). */
const TRAFFIC_COLOR: Readonly<Record<BoardTraffic, number>> = {
  management: 0x8aa4c8,
  vmotion: 0xf0a14a,
  vsan: 0x4cc38a,
  nfs: 0x3fb8c9,
  overlay: 0xa37cf0,
  vm: 0xe8edf3,
};

const PEN = new Map<PenColorId, number>(PEN_COLORS.map((c) => [c.id, c.color]));
const STROKES_PER_BLOCK = 50;
const MAX_TEX = 4096;

export interface BoardCamera {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/** Zoom step for baking: 1 (scale < 1.25), 2 (< 2.25), 3. */
export const zoomStep = (scale: number): number => (scale < 1.25 ? 1 : scale < 2.25 ? 2 : 3);

function strokePoly(g: Graphics, pts: readonly Pt[], color: number, width: number, alpha = 1): void {
  if (pts.length < 2) return;
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
  g.stroke({ color, width, alpha, cap: 'round', join: 'round' });
}

/** Marker look: main pass + a faint second pass offset by 0.6 units. */
function marker(g: Graphics, pts: readonly Pt[], color: number, width: number, dashed = false): void {
  const parts = dashed ? dashPolyline(pts, 10, 7) : [pts];
  for (const p of parts) {
    strokePoly(g, p, color, width);
    strokePoly(g, p.map((q) => ({ x: q.x + 0.6, y: q.y + 0.6 })), color, width * 0.8, 0.35);
  }
}

export class BoardRenderer {
  readonly root = new Container();
  private readonly paper = new Container();
  private readonly autoGfx = new Graphics();
  private readonly autoSprite = new Sprite();
  private autoTex: Texture | null = null;
  private readonly autoLabels = new Container();
  private readonly notesLayer = new Container();
  private readonly notesTexts = new Container();
  private readonly live = new Graphics();
  private livePts: Pt[] = [];
  private liveStyle = { color: 0, width: 2 };
  private readonly hoverFx = new Graphics();
  private layout: HldLayout | null = null;
  private step = 0;
  private dirty = true;

  constructor(
    private readonly renderer: Renderer,
    private readonly dpr: number,
  ) {
    this.drawPaper();
    this.root.addChild(this.paper, this.autoSprite, this.autoLabels, this.hoverFx, this.notesLayer, this.notesTexts, this.live);
  }

  // ------------------------------------------------------------------ camera

  setCamera(cam: BoardCamera): void {
    this.root.position.set(cam.x, cam.y);
    this.root.scale.set(cam.scale);
    const s = zoomStep(cam.scale);
    if (s !== this.step || this.dirty) {
      this.step = s;
      this.bake();
    }
  }

  private get res(): number {
    return Math.min(this.step * this.dpr, MAX_TEX / BOARD_W);
  }

  // ------------------------------------------------------------------ auto layer

  setLayout(layout: HldLayout): void {
    this.layout = layout;
    this.autoGfx.clear();
    for (const t of this.autoLabels.removeChildren()) t.destroy();
    const g = this.autoGfx;
    // Containers first (racks, fleet / instance / domain boxes), then the rest, then edges on top of boxes.
    const nodes = [...layout.nodes].sort((a, b) => Number(!!b.container) - Number(!!a.container));
    for (const n of nodes) this.drawNode(g, n);
    for (const e of layout.edges) {
      const color = e.tone === 'bmc' ? BMC_INK : AUTO_INK;
      const pts = sketchLine(e.a, e.b, hashSeed(e.id));
      marker(g, pts, color, e.tone === 'bmc' ? 1.6 : 2.2, e.dashed);
      if (e.label) {
        const mx = e.a.x + (e.b.x - e.a.x) * 0.8;
        const my = e.a.y + (e.b.y - e.a.y) * 0.8;
        this.label(e.label, mx + 4, my - 8, 17, e.tone === 'bmc' ? BMC_INK : AUTO_INK, 0.5);
      }
      if (e.id === 'uplink') for (const h of arrowHead(e.a, e.b, 10)) marker(g, h, color, 2.2);
    }
    // Stamp (UX §10.4 – auto vs player).
    this.label('Diagram kreslí hra podle tvé serverovny', 24, BOARD_H - 40, 16, AUTO_INK, 0);
    this.dirty = true;
    if (this.step) this.bake();
  }

  private drawNode(g: Graphics, n: HldNode): void {
    const seed = hashSeed(n.id);
    const ink = AUTO_INK;
    if (n.kind === 'cloud') {
      marker(g, sketchCloud(n.x + n.w / 2, n.y + n.h / 2, n.w * 0.86, n.h * 0.8, seed), ink, 2.4, n.dashed);
    } else {
      if (!n.container) g.rect(n.x, n.y, n.w, n.h).fill({ color: 0xffffff, alpha: n.dashed ? 0.4 : 0.85 });
      for (const side of sketchRect(n.x, n.y, n.w, n.h, seed)) marker(g, side, ink, n.container ? 1.8 : 2.4, n.dashed);
      if (n.kind === 'switch' && n.id.startsWith('sw:')) for (let i = 0; i < 8; i++) g.rect(n.x + 12 + i * 12, n.y + n.h - 16, 7, 6).stroke({ color: ink, width: 1.2, alpha: 0.7 });
    }
    let ty = n.y + (n.kind === 'cloud' ? n.h / 2 - 22 : 8);
    const tx = n.kind === 'cloud' ? n.x + n.w / 2 : n.x + (n.traffic !== undefined && n.traffic !== null ? 34 : 12);
    const anchor = n.kind === 'cloud' ? 0.5 : 0;
    if (n.traffic) {
      g.rect(n.x + 12, n.y + 12, 14, 14).fill({ color: TRAFFIC_COLOR[n.traffic] }).stroke({ color: ink, width: 1.5 });
    }
    this.label(n.title, tx, ty, n.container ? 23 : 24, ink, anchor, true);
    ty += 32;
    for (const line of n.lines) {
      this.label(line, n.kind === 'cloud' ? tx : n.x + 12, ty, 19, ink, anchor);
      ty += 26;
    }
    if (n.badge) this.label(`[${n.badge}]`, n.x + n.w - 8, n.y + 8, 16, 0x6a6585, 1);
    if (n.problem) {
      const cx = n.x + n.w - 6;
      const cy = n.y + 4;
      strokePoly(g, sketchEllipse(cx, cy, 13, 13, seed ^ 0x55), 0xc0322e, 2.4);
      this.label('!', cx, cy - 12, 20, 0xc0322e, 0.5, true);
    }
  }

  private label(text: string, x: number, y: number, size: number, color: number, anchorX: number, bold = false): void {
    const t = new Text({ text, style: { fontFamily: HAND_FONT, fontSize: size, fill: color, fontWeight: bold ? '700' : '400' }, resolution: this.res || this.dpr });
    t.anchor.set(anchorX, 0);
    t.position.set(x, y);
    this.autoLabels.addChild(t);
  }

  private bake(): void {
    this.dirty = false;
    const res = this.res;
    const tex = this.renderer.generateTexture({ target: this.autoGfx, frame: new Rectangle(0, 0, NOTES_X, BOARD_H), resolution: res, antialias: true });
    this.autoTex?.destroy(true);
    this.autoTex = tex;
    this.autoSprite.texture = tex;
    for (const t of this.autoLabels.children) (t as Text).resolution = res;
    for (const t of this.notesTexts.children) (t as Text).resolution = res;
  }

  setAutoVisible(v: boolean): void {
    this.autoSprite.visible = v;
    this.autoLabels.visible = v;
    this.hoverFx.visible = v;
  }

  setNotesVisible(v: boolean): void {
    this.notesLayer.visible = v;
    this.notesTexts.visible = v;
    this.live.visible = v;
  }

  /** Auto node under a board point (pointer tool tooltips). Containers lose against inner boxes. */
  nodeAt(p: Pt): HldNode | null {
    if (!this.layout || !this.autoSprite.visible) return null;
    let best: HldNode | null = null;
    for (const n of this.layout.nodes) {
      if (p.x < n.x || p.x > n.x + n.w || p.y < n.y || p.y > n.y + n.h) continue;
      if (!best || (best.container && !n.container) || n.w * n.h < best.w * best.h) best = n;
    }
    return best;
  }

  setHover(n: HldNode | null): void {
    const g = this.hoverFx;
    g.clear();
    if (!n) return;
    g.roundRect(n.x - 5, n.y - 5, n.w + 10, n.h + 10, 8).stroke({ color: 0xffc94d, width: 5, alpha: 0.85 });
  }

  // ------------------------------------------------------------------ player notes

  setNotes(page: PageNotes): void {
    for (const c of this.notesLayer.removeChildren()) c.destroy();
    for (const c of this.notesTexts.removeChildren()) c.destroy();
    let g: Graphics | null = null;
    page.strokes.forEach((s, i) => {
      if (i % STROKES_PER_BLOCK === 0) {
        g = new Graphics();
        this.notesLayer.addChild(g);
      }
      const w = PEN_WIDTHS[s.width] ?? 2.5;
      const color = PEN.get(s.color) ?? 0xc92a2a;
      if (s.points.length === 1) g!.circle(s.points[0]!.x, s.points[0]!.y, w / 2).fill({ color });
      else strokePoly(g!, s.points, color, w);
    });
    for (const t of page.texts) {
      const tx = new Text({ text: t.text, style: { fontFamily: HAND_FONT, fontSize: t.size, fill: PEN.get(t.color) ?? 0xc92a2a }, resolution: this.res || this.dpr });
      tx.position.set(t.x, t.y);
      this.notesTexts.addChild(tx);
    }
  }

  beginStroke(color: PenColorId, width: number, p: Pt): void {
    this.liveStyle = { color: PEN.get(color) ?? 0xc92a2a, width: PEN_WIDTHS[width] ?? 2.5 };
    this.livePts = [p];
    this.live.clear();
    this.live.circle(p.x, p.y, this.liveStyle.width / 2).fill({ color: this.liveStyle.color });
  }

  extendStroke(p: Pt): void {
    const last = this.livePts[this.livePts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) < 0.8) return;
    this.livePts.push(p);
    this.live.moveTo(last.x, last.y).lineTo(p.x, p.y).stroke({ color: this.liveStyle.color, width: this.liveStyle.width, cap: 'round' });
  }

  endStroke(): Pt[] {
    const pts = this.livePts;
    this.livePts = [];
    this.live.clear();
    return pts;
  }

  // ------------------------------------------------------------------ surface

  private drawPaper(): void {
    const g = new Graphics();
    this.paper.addChild(g);
    const f = 22;
    g.roundRect(-f, -f, BOARD_W + 2 * f, BOARD_H + 2 * f + 34, 14).fill({ color: FRAME }).stroke({ color: 0x2e2645, width: 3 });
    g.rect(0, 0, BOARD_W, BOARD_H).fill({ color: BOARD_SURFACE }).stroke({ color: FRAME_DARK, width: 2 });
    // Marker shelf (the DOM toolbar sits on it).
    g.roundRect(-f + 8, BOARD_H + 6, BOARD_W + 2 * f - 16, 26, 6).fill({ color: FRAME_DARK }).stroke({ color: 0x2e2645, width: 2 });
    // Notes strip divider (dotted) + heading.
    for (let y = 16; y < BOARD_H - 16; y += 18) g.moveTo(NOTES_X, y).lineTo(NOTES_X, y + 8);
    g.stroke({ color: 0xc9c4d6, width: 2 });
    const t = new Text({ text: 'Poznámky', style: { fontFamily: HAND_FONT, fontSize: 22, fill: 0x8b86a0 } });
    t.position.set(NOTES_X + 20, 16);
    this.paper.addChild(t);
  }

  dispose(): void {
    this.autoTex?.destroy(true);
    this.autoTex = null;
    this.root.destroy({ children: true });
  }
}
