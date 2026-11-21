/**
 * Original illustrated isometric thumbnails of the site layouts (start screen cards). Pure SVG built in the DOM –
 * the PixiJS stage is off on DOM-only screens, so no WebGL work. Same 2:1 projection and palette as the room (GRAPHICS.md T6).
 */
import { planSite } from '../../render/site/siteGeom';
import { presetLayout, siteSceneInput, type SiteLayoutId } from './siteLayout';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TW = 14; // tile width px
const TH = 7;
/** World px (render/iso TILE_W 64) -> thumbnail px. */
const SCALE = 64 / TW;

const C = {
  outline: '#14233a',
  floorA: '#eef1f5',
  floorB: '#e4e8ef',
  slabL: '#a9b5c5',
  slabR: '#8e9cb0',
  wallL: '#b9c5d5',
  wallR: '#d5dde8',
  cap: '#f7f9fb',
  rackTop: '#3b4a5f',
  rackFront: '#24324a',
  rackSide: '#1a2538',
  door: '#3b5f8f',
  grass: '#bfe3a1',
  grassDark: '#a3d184',
  road: '#e8dcc0',
  fibre: '#ffc94d',
  corridor: '#eef1f5',
  roofL: '#e3c79a',
  roofR: '#cfae7c',
  water: '#a9d8f0',
  pin: '#c41f33',
} as const;

interface Pt {
  x: number;
  y: number;
}
const iso = (gx: number, gy: number, h = 0): Pt => ({ x: (gx - gy) * (TW / 2), y: (gx + gy) * (TH / 2) - h });

class Svg {
  readonly parts: string[] = [];
  box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  track(pts: readonly Pt[]): void {
    for (const p of pts) {
      this.box.x0 = Math.min(this.box.x0, p.x);
      this.box.y0 = Math.min(this.box.y0, p.y);
      this.box.x1 = Math.max(this.box.x1, p.x);
      this.box.y1 = Math.max(this.box.y1, p.y);
    }
  }
  poly(pts: readonly Pt[], fill: string, stroke = true, extra = ''): void {
    this.track(pts);
    const d = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    this.parts.push(`<polygon points="${d}" fill="${fill}"${stroke ? ` stroke="${C.outline}" stroke-width="1" stroke-linejoin="round"` : ''} ${extra}/>`);
  }
  line(pts: readonly Pt[], color: string, width: number, extra = ''): void {
    this.track(pts);
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    this.parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`);
  }
  quad(a: Pt, b: Pt, h: number, fill: string): void {
    this.poly([a, b, { x: b.x, y: b.y - h }, { x: a.x, y: a.y - h }], fill);
  }
  prism(gx: number, gy: number, w: number, d: number, h: number, top: string, front: string, side: string, z = 0): void {
    const c00 = iso(gx, gy, z);
    const c10 = iso(gx + w, gy, z);
    const c11 = iso(gx + w, gy + d, z);
    const c01 = iso(gx, gy + d, z);
    const upP = (p: Pt): Pt => ({ x: p.x, y: p.y - h });
    this.poly([c10, c11, upP(c11), upP(c10)], side);
    this.poly([c01, c11, upP(c11), upP(c01)], front);
    this.poly([upP(c00), upP(c10), upP(c11), upP(c01)], top);
  }
}

/** Cut-away room: floor, two low back walls, a door. */
function room(s: Svg, ox: number, oy: number, cols: number, rows: number, wallH: number): void {
  const slab = (a: Pt, b: Pt): void => s.poly([a, b, { x: b.x, y: b.y + 3 }, { x: a.x, y: a.y + 3 }], C.slabL);
  slab(iso(ox, oy + rows), iso(ox + cols, oy + rows));
  s.poly([iso(ox + cols, oy), iso(ox + cols, oy + rows), { ...iso(ox + cols, oy + rows), y: iso(ox + cols, oy + rows).y + 3 }, { ...iso(ox + cols, oy), y: iso(ox + cols, oy).y + 3 }], C.slabR);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) s.poly([iso(ox + x, oy + y), iso(ox + x + 1, oy + y), iso(ox + x + 1, oy + y + 1), iso(ox + x, oy + y + 1)], (x + y) % 2 ? C.floorB : C.floorA, false);
  s.poly([iso(ox, oy), iso(ox + cols, oy), iso(ox + cols, oy + rows), iso(ox, oy + rows)], 'none');
  s.quad(iso(ox, oy), iso(ox, oy + rows), wallH, C.wallL);
  s.quad(iso(ox, oy), iso(ox + cols, oy), wallH, C.wallR);
  const v = oy + Math.max(1, rows - 3.4);
  s.quad(iso(ox, v), iso(ox, v + 1.5), wallH * 0.8, C.door);
}

function fibre(s: Svg, pts: readonly Pt[], dashed = false): void {
  s.line(pts, C.outline, 4, dashed ? 'stroke-dasharray="10 4"' : '');
  s.line(pts, C.fibre, 2, dashed ? 'stroke-dasharray="10 4"' : '');
  if (!dashed) s.line(pts, '#ffffff', 1.2, 'stroke-dasharray="2 6" class="thumb-flow"');
}

/** Rack tiles of a miniature room (decorative: a row along the back wall, a few per room). */
function miniRacks(cols: number, rackSlots: number): { gx: number; gy: number }[] {
  const n = Math.min(rackSlots, Math.max(1, cols - 3), 6);
  return Array.from({ length: n }, (_, i) => ({ gx: 2 + i, gy: 1 }));
}

/**
 * Draw the thumbnail of any layout from the same plan as the in-game overview (render/site/siteGeom), at a
 * smaller scale: ground, building slabs, cut-away rooms with racks, links. Witness rooms get a small "W" flag.
 */
export function siteThumbSvg(layoutId: SiteLayoutId): { markup: string; box: { x0: number; y0: number; x1: number; y1: number } } {
  const layout = presetLayout(layoutId);
  const input = siteSceneInput(layout, (id) => {
    const r = layout.rooms.find((x) => x.id === id)!;
    return miniRacks(r.size.cols, r.rackSlots);
  });
  // Thumbnail hint: the one-rack room of the multi-site presets is the place meant for the witness (model description).
  const plan = planSite({ ...input, rooms: input.rooms.map((r, i) => ({ ...r, witness: r.witness || (layout.rooms.length > 2 && layout.rooms[i]!.rackSlots <= 1) })) });
  const s = new Svg();
  if (plan.ground) {
    const g = plan.ground;
    s.poly([iso(g.x0, g.y0), iso(g.x1, g.y0), iso(g.x1, g.y1), iso(g.x0, g.y1)], C.grass);
    if (plan.sites.length > 1) {
      const mx = (plan.sites[0]!.x1 + plan.sites[1]!.x0) / 2;
      s.poly([iso(mx - 1.2, g.y0), iso(mx + 0.6, g.y0), iso(mx + 1.6, g.y1), iso(mx - 0.2, g.y1)], C.water, false);
    }
  }
  for (const b of plan.buildings) {
    s.prism(b.x0 - 0.5, b.y0 - 0.5, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1, 3, C.cap, C.roofL, C.roofR);
    for (const c of b.corridors) s.poly([iso(c.x0, c.y0, 3), iso(c.x1, c.y0, 3), iso(c.x1, c.y1, 3), iso(c.x0, c.y1, 3)], C.corridor);
  }
  for (const l of plan.links) if (l.kind === 'campus') fibre(s, l.points.map((p) => ({ x: p.x / SCALE, y: p.y / SCALE })));
  for (const p of plan.rooms) {
    const { cols, rows } = p.room;
    const ox = p.ox;
    const oy = p.oy;
    room(s, ox, oy, cols, rows, 18);
    for (const r of p.room.racks) {
      s.prism(ox + r.gx, oy + r.gy, 0.9, 0.9, 18, C.rackTop, C.rackFront, C.rackSide);
    }
    if (p.room.witness) {
      const f = iso(ox + cols / 2, oy + rows / 2, 0);
      s.track([{ x: f.x, y: f.y - 36 }]);
      s.parts.push(`<path d="M${f.x.toFixed(1)},${f.y.toFixed(1)} v-30 h14 l-4,5 l4,5 h-14" fill="${C.pin}" stroke="${C.outline}" stroke-width="1.2" stroke-linejoin="round"/>`);
    }
  }
  for (const l of plan.links) if (l.kind !== 'campus') fibre(s, l.points.map((p) => ({ x: p.x / SCALE, y: p.y / SCALE })), l.kind === 'wan');
  return { markup: s.parts.join(''), box: s.box };
}

/** SVG element with a fitted viewBox. */
export function siteThumb(layout: SiteLayoutId): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'site-thumb');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const { markup, box } = siteThumbSvg(layout);
  svg.innerHTML = markup;
  const pad = 6;
  svg.setAttribute('viewBox', `${(box.x0 - pad).toFixed(1)} ${(box.y0 - pad).toFixed(1)} ${(box.x1 - box.x0 + 2 * pad).toFixed(1)} ${(box.y1 - box.y0 + 2 * pad).toFixed(1)}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return svg;
}
