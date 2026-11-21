/**
 * Small static isometric preview of a designed topology (Sandbox "Návrh").
 * ILLUSTRATIVE ONLY: domains drawn as "districts" (GRAPHICS.md, Instance zoom level),
 * hosts as boxes. Canvas 2D, redrawn only when the input changes – no ticker,
 * no second WebGL context (cheap on Chromebooks).
 */
import { TILE_H, TILE_W } from './iso';

export interface PreviewDomain {
  readonly kind: 'management' | 'workload';
  readonly label: string;
  /** Host count to draw; undefined = unknown (plate with "?"). */
  readonly hosts: number | undefined;
}

export interface PreviewInstance {
  readonly label: string;
  readonly domains: readonly PreviewDomain[];
}

export interface DesignPreviewData {
  readonly instances: readonly PreviewInstance[];
}

const COLORS = {
  management: { plate: '#1c2a3a', edge: '#8aa4c8', top: '#c9d6e6', left: '#7f97b6', right: '#5d7593' },
  workload: { plate: '#17302a', edge: '#4cc38a', top: '#c4ecd9', left: '#6fb795', right: '#4f9474' },
} as const;

const S = 0.5; // tile scale for the preview
const TW = TILE_W * S;
const TH = TILE_H * S;
const iso = (gx: number, gy: number): { x: number; y: number } => ({ x: (gx - gy) * (TW / 2), y: (gx + gy) * (TH / 2) });

function diamond(ctx: CanvasRenderingContext2D, ox: number, oy: number, gx: number, gy: number, w: number, d: number): void {
  const a = iso(gx, gy), b = iso(gx + w, gy), c = iso(gx + w, gy + d), e = iso(gx, gy + d);
  ctx.beginPath();
  ctx.moveTo(ox + a.x, oy + a.y);
  ctx.lineTo(ox + b.x, oy + b.y);
  ctx.lineTo(ox + c.x, oy + c.y);
  ctx.lineTo(ox + e.x, oy + e.y);
  ctx.closePath();
}

function box(ctx: CanvasRenderingContext2D, ox: number, oy: number, gx: number, gy: number, hgt: number, col: (typeof COLORS)[keyof typeof COLORS]): void {
  const s = 0.7;
  const p0 = iso(gx, gy), p1 = iso(gx + s, gy), p2 = iso(gx + s, gy + s), p3 = iso(gx, gy + s);
  const X = (p: { x: number }): number => ox + p.x;
  const Y = (p: { y: number }, up = 0): number => oy + p.y - up;
  // left face
  ctx.fillStyle = col.left;
  ctx.beginPath();
  ctx.moveTo(X(p3), Y(p3)); ctx.lineTo(X(p2), Y(p2)); ctx.lineTo(X(p2), Y(p2, hgt)); ctx.lineTo(X(p3), Y(p3, hgt));
  ctx.fill();
  // right face
  ctx.fillStyle = col.right;
  ctx.beginPath();
  ctx.moveTo(X(p2), Y(p2)); ctx.lineTo(X(p1), Y(p1)); ctx.lineTo(X(p1), Y(p1, hgt)); ctx.lineTo(X(p2), Y(p2, hgt));
  ctx.fill();
  // top
  ctx.fillStyle = col.top;
  ctx.beginPath();
  ctx.moveTo(X(p0), Y(p0, hgt)); ctx.lineTo(X(p1), Y(p1, hgt)); ctx.lineTo(X(p2), Y(p2, hgt)); ctx.lineTo(X(p3), Y(p3, hgt));
  ctx.fill();
}

const HOSTS_PER_ROW = 4;
const MAX_DRAWN = 12;

/** Draws the preview into the canvas (CSS size w x h). */
export function drawDesignPreview(canvas: HTMLCanvasElement, data: DesignPreviewData, w: number, h: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Layout in grid units: instances along gy, domains along gx.
  const PLATE_W = 5;
  const PLATE_D = 4;
  const GAP = 2;
  type Item = { gx: number; gy: number; dom: PreviewDomain; inst: PreviewInstance; first: boolean };
  const items: Item[] = [];
  data.instances.forEach((inst, ii) =>
    inst.domains.forEach((dom, di) => items.push({ gx: di * (PLATE_W + GAP), gy: ii * (PLATE_D + GAP + 1), dom, inst, first: di === 0 })),
  );
  if (items.length === 0) return;

  // Fit: compute bounds of all plate corners, center in canvas.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const it of items)
    for (const [dx, dy] of [[0, 0], [PLATE_W, 0], [PLATE_W, PLATE_D], [0, PLATE_D]] as const) {
      const p = iso(it.gx + dx, it.gy + dy);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  const ox = (w - (maxX - minX)) / 2 - minX;
  const oy = (h - (maxY - minY)) / 2 - minY + 8;

  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const it of items) {
    const col = COLORS[it.dom.kind];
    diamond(ctx, ox, oy, it.gx, it.gy, PLATE_W, PLATE_D);
    ctx.fillStyle = col.plate;
    ctx.fill();
    ctx.strokeStyle = col.edge;
    ctx.lineWidth = 1;
    ctx.stroke();

    const n = it.dom.hosts;
    if (n === undefined) {
      const c = iso(it.gx + PLATE_W / 2, it.gy + PLATE_D / 2);
      ctx.fillStyle = col.edge;
      ctx.fillText('?', ox + c.x, oy + c.y + 3);
    } else {
      const drawn = Math.min(n, MAX_DRAWN);
      for (let i = 0; i < drawn; i++) {
        const r = Math.floor(i / HOSTS_PER_ROW);
        const c = i % HOSTS_PER_ROW;
        box(ctx, ox, oy, it.gx + 0.6 + c * 1.1, it.gy + 0.5 + r * 1.1, 9, col);
      }
    }
  }
  // Labels in a second pass so plates never cover them; anchored above each plate's top corner.
  for (const it of items) {
    const n = it.dom.hosts;
    const tp = iso(it.gx, it.gy);
    const text = `${it.dom.label}${n !== undefined ? ` · ${n}` : ''}`;
    const tw = ctx.measureText(text).width + 8;
    const x = ox + tp.x;
    const y = oy + tp.y - 8;
    ctx.fillStyle = 'rgba(15, 20, 27, 0.85)';
    ctx.fillRect(x - tw / 2, y - 9, tw, 13);
    ctx.fillStyle = COLORS[it.dom.kind].top;
    ctx.fillText(text, x, y + 1);
    if (it.first && data.instances.length > 1) {
      ctx.fillStyle = '#7f8fa3';
      ctx.textAlign = 'left';
      const lp = iso(it.gx, it.gy + PLATE_D);
      ctx.fillText(it.inst.label, ox + lp.x - 10, oy + lp.y + 12);
      ctx.textAlign = 'center';
    }
  }
}
