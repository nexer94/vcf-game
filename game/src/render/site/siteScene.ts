/**
 * Site overview (multi-room Sandbox): one building with two rooms and a corridor, a campus with two buildings
 * and an outdoor fibre, or a map-like view of the main site and a far-away DR site. Click a room -> the UI zooms
 * into it. Render-only: it draws the plain SiteSceneInput it is given.
 *
 * Performance: everything static (ground, buildings, room miniatures, fibres) is ONE Graphics baked into a texture
 * (re-baked per zoom bucket, capped at 4096 px); labels are a handful of Text objects; the illustrative traffic on
 * the links is a few sprites from the shared dot atlas. No filters.
 */
import { Container, Graphics, Rectangle, Sprite, Text, type Renderer, type Texture } from 'pixi.js';
import { isoToScreen } from '../iso';
import { poly, prism, up, type P } from '../room/draw';
import { CABINET, DECOR, FLOOR, OUTLINE, SHADOW, WALL } from '../room/palette';
import { planBounds, planSite, pointAlong, polylineLength, roomAt, roomWorldRect, ROOM_WALL_H, type PlacedLink, type PlacedRoom, type Rect, type SitePlan, type SiteSceneInput } from './siteGeom';

const GROUND = { grass: 0xbfe3a1, grassDark: 0xa3d184, path: 0xeadfc4, water: 0xa9d8f0, waterDark: 0x86c3e2 } as const;
const BUILDING = { slab: 0xf6f8fa, slabFront: 0xc5cdd8, slabSide: 0xa9b6c8, corridor: 0xeef1f5, corridorLine: 0xdde3ea } as const;
const FIBRE = 0xffc94d;
/** AZ tags (GRAPHICS.md T4) - AZ2 no longer pink/red, always with a text label. */
const AZ_FILL: Readonly<Record<string, number>> = { AZ1: 0xe3ecf8, AZ2: 0xefe8f7, Witness: 0xfff4dc, '2. instance': 0xe6f4ec };
const DOTS_PER_LINK = 5;
const DOT_SPEED = 0.06; // px per real ms (illustrative)

interface DotSprite {
  readonly sprite: Sprite;
  readonly link: PlacedLink;
  readonly length: number;
  offset: number;
  readonly dir: 1 | -1;
}

export class SiteScene {
  readonly world = new Container();
  private plan: SitePlan | null = null;
  private gfx: Graphics | null = null;
  private sprite: Sprite | null = null;
  private res = 0;
  private readonly labels = new Container();
  private readonly dotLayer = new Container();
  private readonly highlight = new Graphics();
  private readonly here = new Graphics();
  private dots: DotSprite[] = [];
  /** Neutral capsule dot: traffic between rooms is illustrative, its type is not modelled (no type colour/shape). */
  private readonly dotTex: Texture;
  private hovered: string | null = null;
  private hereRoom: string | null = null;

  constructor(private readonly renderer: Renderer) {
    const dg = new Graphics();
    dg.roundRect(1, 1, 14, 7, 3.5).fill({ color: 0xffffff }).stroke({ color: OUTLINE, width: 1.6 });
    this.dotTex = renderer.generateTexture({ target: dg, frame: new Rectangle(0, 0, 16, 9), resolution: 3, antialias: true });
    dg.destroy();
    this.world.addChild(this.highlight, this.dotLayer, this.here, this.labels);
    this.world.visible = false;
  }

  /** Lay out + redraw (call when the layout, AZ labels or rack placement change). */
  setInput(input: SiteSceneInput): void {
    const plan = planSite(input);
    this.plan = plan;
    this.gfx?.destroy();
    this.gfx = drawSite(plan);
    this.res = 0;
    this.bake(2);
    this.buildLabels(plan);
    this.buildDots(plan);
    this.drawHighlight();
    this.drawHere();
  }

  get bounds(): Rect {
    return this.plan ? planBounds(this.plan) : { x: 0, y: 0, width: 1, height: 1 };
  }

  roomAtWorld(wx: number, wy: number): string | null {
    return this.plan ? roomAt(this.plan, wx, wy) : null;
  }

  roomRect(id: string): Rect | null {
    const p = this.plan?.rooms.find((r) => r.room.id === id);
    return p ? roomWorldRect(p) : null;
  }

  setHoveredRoom(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.drawHighlight();
  }

  /** "You are here" marker (the avatar's room). */
  setHereRoom(id: string | null): void {
    this.hereRoom = id;
    this.drawHere();
  }

  /** Re-bake for the zoom (resolution buckets like the room). */
  setViewScale(scale: number, dpr = 1): void {
    const b = this.bounds;
    const maxRes = Math.max(1, Math.floor(4096 / Math.max(b.width, b.height)));
    const res = Math.min(maxRes, Math.max(1, Math.ceil(scale * dpr)));
    if (res !== this.res) this.bake(res);
  }

  update(realMs: number): void {
    const dt = Math.min(realMs, 100);
    for (const d of this.dots) {
      d.offset = (d.offset + d.dir * dt * DOT_SPEED * (d.link.kind === 'wan' ? 2.5 : 1) + d.length) % d.length;
      const p = pointAlong(d.link.points, d.offset);
      d.sprite.position.set(p.x, p.y);
    }
  }

  private bake(res: number): void {
    if (!this.gfx || !this.plan) return;
    const b = planBounds(this.plan);
    const frame = new Rectangle(b.x - 6, b.y - 6, b.width + 12, b.height + 12);
    const r = Math.min(res, Math.max(1, Math.floor(4096 / Math.max(frame.width, frame.height))));
    const tex: Texture = this.renderer.generateTexture({ target: this.gfx, frame, resolution: r, antialias: true });
    if (!this.sprite) {
      this.sprite = new Sprite(tex);
      this.world.addChildAt(this.sprite, 0);
    } else {
      const old = this.sprite.texture;
      this.sprite.texture = tex;
      old.destroy(true);
    }
    this.sprite.position.set(frame.x, frame.y);
    this.res = res;
  }

  private buildLabels(plan: SitePlan): void {
    for (const c of this.labels.removeChildren()) c.destroy();
    const style = { fontFamily: 'Nunito, Segoe UI, system-ui, sans-serif', fontWeight: '800' as const, fill: OUTLINE, fontSize: 15 };
    for (const p of plan.rooms) {
      const top = up(isoToScreen(p.ox + p.room.cols / 2, p.oy), ROOM_WALL_H + 26);
      const t = new Text({ text: p.room.label, style, resolution: 2 });
      t.anchor.set(0.5, 1);
      t.position.set(top.x, top.y);
      this.labels.addChild(t);
      const az = new Text({ text: p.room.az ?? 'AZ —', style: { ...style, fontSize: 13, fill: p.room.az ? OUTLINE : 0x5c6878 }, resolution: 2 });
      az.anchor.set(0.5, 1);
      az.position.set(top.x, top.y + 18);
      const pill = new Graphics();
      const w = az.width + 14;
      pill.roundRect(top.x - w / 2, top.y + 1, w, 19, 9).fill({ color: AZ_FILL[p.room.az ?? ''] ?? 0xeef1f5 }).stroke({ color: OUTLINE, width: 2 });
      this.labels.addChild(pill, az);
    }
    for (const s of plan.sites) {
      if (plan.sites.length < 2 && plan.buildings.length < 2) break;
      const p = isoToScreen((s.x0 + s.x1) / 2 + 2, s.y1 + 4);
      const t = new Text({ text: s.label, style: { ...style, fontSize: 17, fill: 0x2f5f2a }, resolution: 2 });
      t.anchor.set(0.5, 0);
      t.position.set(p.x, p.y);
      this.labels.addChild(t);
    }
    for (const l of plan.links) {
      if (!l.breakAt) continue;
      const t = new Text({ text: '≈ nekresleno v měřítku', style: { ...style, fontSize: 12, fontWeight: '700', fill: 0x5c6878 }, resolution: 2 });
      t.anchor.set(0.5, 1);
      t.position.set(l.breakAt.x, l.breakAt.y - 12);
      this.labels.addChild(t);
    }
  }

  private buildDots(plan: SitePlan): void {
    for (const c of this.dotLayer.removeChildren()) c.destroy();
    this.dots = [];
    for (const link of plan.links) {
      const length = polylineLength(link.points);
      if (length <= 0) continue;
      for (let i = 0; i < DOTS_PER_LINK * 2; i++) {
        const sprite = new Sprite(this.dotTex);
        sprite.anchor.set(0.5);
        sprite.scale.set(link.kind === 'wan' ? 0.9 : 0.7);
        this.dotLayer.addChild(sprite);
        const dir = i % 2 === 0 ? 1 : -1;
        this.dots.push({ sprite, link, length, offset: (i / (DOTS_PER_LINK * 2)) * length, dir });
      }
    }
    this.update(0);
  }

  private drawHighlight(): void {
    const g = this.highlight;
    g.clear();
    const p = this.plan?.rooms.find((r) => r.room.id === this.hovered);
    if (!p) return;
    const { ox, oy } = p;
    const { cols, rows } = p.room;
    g.poly([isoToScreen(ox, oy), isoToScreen(ox + cols, oy), isoToScreen(ox + cols, oy + rows), isoToScreen(ox, oy + rows)].flatMap((q) => [q.x, q.y]))
      .fill({ color: 0xffffff, alpha: 0.28 })
      .stroke({ color: 0x1d63c8, width: 4, join: 'round' });
  }

  private drawHere(): void {
    const g = this.here;
    g.clear();
    const p = this.plan?.rooms.find((r) => r.room.id === this.hereRoom);
    if (!p) return;
    // Little orange pin (the avatar's hoodie colour) standing in front of the room door.
    const c = isoToScreen(p.ox + 0.8, p.oy + p.room.rows - 1.5);
    g.ellipse(c.x, c.y, 7, 3.5).fill({ color: SHADOW, alpha: 0.25 });
    g.moveTo(c.x, c.y).lineTo(c.x - 7, c.y - 16).arc(c.x, c.y - 20, 8, Math.PI * 0.82, Math.PI * 0.18).lineTo(c.x, c.y).fill({ color: 0x1d63c8 }).stroke({ color: OUTLINE, width: 2, join: 'round' });
    g.circle(c.x, c.y - 20, 3).fill({ color: 0xffffff });
  }
}

// ---------------------------------------------------------------- static drawing

const gp = (gx: number, gy: number): P => isoToScreen(gx, gy);

function drawSite(plan: SitePlan): Graphics {
  const g = new Graphics();
  if (plan.ground) drawGround(g, plan);
  for (const b of plan.buildings) drawBuildingSlab(g, b.x0, b.y0, b.x1, b.y1, b.corridors);
  // Campus trenches go under everything above the ground.
  for (const l of plan.links) if (l.kind === 'campus') drawFibre(g, l, 0.75);
  for (const p of plan.rooms) drawMiniRoom(g, p);
  for (const l of plan.links) if (l.kind !== 'campus') drawFibre(g, l, 1);
  return g;
}

function drawGround(g: Graphics, plan: SitePlan): void {
  const gr = plan.ground!;
  const SL = 10;
  // Ground slab sides (diorama look).
  poly(g, [gp(gr.x0, gr.y1), gp(gr.x1, gr.y1), { x: gp(gr.x1, gr.y1).x, y: gp(gr.x1, gr.y1).y + SL }, { x: gp(gr.x0, gr.y1).x, y: gp(gr.x0, gr.y1).y + SL }], 0x9a7b55);
  poly(g, [gp(gr.x1, gr.y0), gp(gr.x1, gr.y1), { x: gp(gr.x1, gr.y1).x, y: gp(gr.x1, gr.y1).y + SL }, { x: gp(gr.x1, gr.y0).x, y: gp(gr.x1, gr.y0).y + SL }], 0x7f6444);
  poly(g, [gp(gr.x0, gr.y0), gp(gr.x1, gr.y0), gp(gr.x1, gr.y1), gp(gr.x0, gr.y1)], GROUND.grass);
  // Mowed stripes (cheap texture).
  for (let x = gr.x0 + 1; x < gr.x1; x += 2) g.poly([gp(x, gr.y0), gp(x + 1, gr.y0), gp(x + 1, gr.y1), gp(x, gr.y1)].flatMap((p) => [p.x, p.y])).fill({ color: GROUND.grassDark, alpha: 0.35 });
  // A path in front of the buildings.
  const py = gr.y1 - 3;
  poly(g, [gp(gr.x0, py), gp(gr.x1, py), gp(gr.x1, py + 1.2), gp(gr.x0, py + 1.2)], GROUND.path, false);
  // Between two sites: a river and a few trees -> reads as "far away".
  if (plan.sites.length > 1) {
    const a = plan.sites[0]!;
    const b = plan.sites[1]!;
    const mx = (a.x1 + b.x0) / 2;
    poly(g, [gp(mx - 1.2, gr.y0), gp(mx + 0.6, gr.y0), gp(mx + 1.6, gr.y1), gp(mx - 0.2, gr.y1)], GROUND.water, false);
    g.moveTo(gp(mx - 0.4, gr.y0 + 2).x, gp(mx - 0.4, gr.y0 + 2).y).lineTo(gp(mx + 0.6, gr.y1 - 2).x, gp(mx + 0.6, gr.y1 - 2).y).stroke({ color: GROUND.waterDark, width: 2, alpha: 0.6 });
    for (let i = 0; i < 7; i++) tree(g, a.x1 + 3 + i * 2.3, (i % 3) * 3 + 1);
    for (let i = 0; i < 5; i++) tree(g, mx + 3 + i * 2.1, ((i + 1) % 3) * 3 + 0.5);
  } else {
    // Campus: trees around the buildings.
    tree(g, gr.x0 + 1.5, gr.y0 + 1.5);
    tree(g, gr.x1 - 1.5, gr.y1 - 1.5);
    tree(g, gr.x0 + 1.5, gr.y1 - 1.5);
  }
}

function tree(g: Graphics, gx: number, gy: number): void {
  const b = gp(gx, gy);
  g.ellipse(b.x, b.y, 9, 4.5).fill({ color: SHADOW, alpha: 0.18 });
  g.rect(b.x - 2, b.y - 12, 4, 12).fill({ color: 0x8a6a4a }).stroke({ color: OUTLINE, width: 1.2 });
  g.circle(b.x - 5, b.y - 16, 7).circle(b.x + 5, b.y - 16, 7).circle(b.x, b.y - 23, 8).fill({ color: 0x4cc38a }).stroke({ color: OUTLINE, width: 1.5 });
}

function drawBuildingSlab(g: Graphics, x0: number, y0: number, x1: number, y1: number, corridors: readonly { x0: number; y0: number; x1: number; y1: number }[]): void {
  const m = 0.5;
  prism(g, x0 - m, y0 - m, x1 - x0 + 2 * m, y1 - y0 + 2 * m, 8, { top: BUILDING.slab, front: BUILDING.slabFront, side: BUILDING.slabSide });
  for (const c of corridors) {
    const z = 8;
    poly(g, [up(gp(c.x0, c.y0), z), up(gp(c.x1, c.y0), z), up(gp(c.x1, c.y1), z), up(gp(c.x0, c.y1), z)], BUILDING.corridor);
    for (let y = c.y0 + 1; y < c.y1; y++) g.moveTo(up(gp(c.x0, y), z).x, up(gp(c.x0, y), z).y).lineTo(up(gp(c.x1, y), z).x, up(gp(c.x1, y), z).y);
    g.stroke({ color: BUILDING.corridorLine, width: 1 });
    // Corridor back wall (low, cut-away).
    poly(g, [up(gp(c.x0, c.y0), z), up(gp(c.x1, c.y0), z), up(gp(c.x1, c.y0), z + ROOM_WALL_H), up(gp(c.x0, c.y0), z + ROOM_WALL_H)], WALL.rightDark);
  }
}

/** Cut-away miniature of a room: floor, two low back walls, door openings on the side walls, racks. */
function drawMiniRoom(g: Graphics, p: PlacedRoom): void {
  const { ox, oy } = p;
  const { cols, rows } = p.room;
  const z = 8;
  const fp = (gx: number, gy: number, h = 0): P => up(gp(ox + gx, oy + gy), z + h);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      g.poly([fp(x, y), fp(x + 1, y), fp(x + 1, y + 1), fp(x, y + 1)].flatMap((q) => [q.x, q.y])).fill({ color: (x + y) % 2 === 0 ? FLOOR.a : FLOOR.b });
    }
  }
  poly(g, [fp(0, 0), fp(cols, 0), fp(cols, rows), fp(0, rows)], 0, true, 0);
  const H = ROOM_WALL_H;
  poly(g, [fp(0, 0), fp(0, rows), fp(0, rows, H), fp(0, 0, H)], WALL.left);
  poly(g, [fp(0, 0), fp(cols, 0), fp(cols, 0, H), fp(0, 0, H)], WALL.right);
  poly(g, [fp(0, 0, H), fp(cols, 0, H), fp(cols, -0.25, H), fp(-0.25, -0.25, H), fp(-0.25, rows, H), fp(0, rows, H)], WALL.cap);
  // Door on the left wall (same place as in the full room: rows - 3.4 .. + 1.5).
  const v0 = Math.max(1, rows - 3.4);
  poly(g, [fp(0, v0), fp(0, v0 + 1.5), fp(0, v0 + 1.5, H * 0.75), fp(0, v0, H * 0.75)], DECOR.door);
  // Low front walls as a thin outline (cut-away) with a door gap on the right side wall.
  g.moveTo(fp(0, rows).x, fp(0, rows).y).lineTo(fp(cols, rows).x, fp(cols, rows).y).lineTo(fp(cols, 0).x, fp(cols, 0).y).stroke({ color: WALL.base, width: 3, alpha: 0.8 });
  // Witness location: a small red pennant in the middle of the floor.
  if (p.room.witness) {
    const c = fp(cols / 2, rows / 2);
    g.moveTo(c.x, c.y).lineTo(c.x, c.y - 46).stroke({ color: OUTLINE, width: 2.5, cap: 'round' });
    poly(g, [{ x: c.x, y: c.y - 46 }, { x: c.x + 24, y: c.y - 40 }, { x: c.x, y: c.y - 32 }], 0xc41f33);
  }
  // Racks.
  for (const r of p.room.racks) {
    if (r.gx >= cols || r.gy >= rows) continue;
    prism(g, ox + r.gx + 0.08, oy + r.gy + 0.08, 0.84, 0.84, 34, { top: CABINET.top, front: CABINET.front, side: CABINET.side }, z);
  }
}

function drawFibre(g: Graphics, l: PlacedLink, alpha: number): void {
  const pts = l.points.flatMap((p) => [p.x, p.y]);
  const path = (): Graphics => {
    g.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
    return g;
  };
  const w = l.kind === 'wan' ? 7 : 5;
  path().stroke({ color: OUTLINE, width: w, cap: 'round', join: 'round', alpha });
  path().stroke({ color: FIBRE, width: w - 3, cap: 'round', join: 'round', alpha });
  if (l.breakAt) {
    // "Not to scale" break marks: two short slanted bars across the link.
    const b = l.breakAt;
    for (const dx of [-6, 6]) g.moveTo(b.x + dx - 4, b.y + 9).lineTo(b.x + dx + 4, b.y - 9);
    g.stroke({ color: OUTLINE, width: 3, cap: 'round' });
  }
}
