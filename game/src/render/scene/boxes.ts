import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { isoToScreen } from '../iso';
import { facePoint } from './layout';
import type { BoxSpec, DeviceSpec, Topology } from './topology';

const RACK = { top: 0x263142, front: 0x121820, side: 0x1b2430, edge: 0x3a4a5e };
const SPINE = { top: 0x2c3a4f, front: 0x1a2330, side: 0x202b39, edge: 0x4a5a70 };
const HOST_FILL = 0x2b3646;
const HOST_EDGE = 0x4a5a70;
const SWITCH_FILL = 0x34445a;
const LED_OK = 0x4cc38a;
const PORT_DOT = 0x8aa4c8;

const LABEL_STYLE: TextStyleOptions = {
  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  fontSize: 9,
  fill: 0xc5d0de,
};
const TITLE_STYLE: TextStyleOptions = { ...LABEL_STYLE, fontSize: 12, fontWeight: '600', fill: 0xe8edf3 };

function quad(g: Graphics, pts: readonly { x: number; y: number }[], color: number, edge: number): void {
  g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color }).stroke({ color: edge, width: 1, alpha: 0.9 });
}

function drawBox(g: Graphics, box: BoxSpec): void {
  const pal = box.kind === 'spine' ? SPINE : RACK;
  const h = box.heightPx;
  const c00 = isoToScreen(box.gx, box.gy);
  const c10 = isoToScreen(box.gx + box.w, box.gy);
  const c11 = isoToScreen(box.gx + box.w, box.gy + box.d);
  const c01 = isoToScreen(box.gx, box.gy + box.d);
  const up = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x, y: p.y - h });
  quad(g, [c10, c11, up(c11), up(c10)], pal.side, pal.edge);
  quad(g, [c01, c11, up(c11), up(c01)], pal.front, pal.edge);
  quad(g, [up(c00), up(c10), up(c11), up(c01)], pal.top, pal.edge);
}

function drawDevice(g: Graphics, box: BoxSpec, dev: DeviceSpec): void {
  const u0 = 0.05;
  const u1 = 0.95;
  const pts = [facePoint(box, u0, dev.v1), facePoint(box, u1, dev.v1), facePoint(box, u1, dev.v0), facePoint(box, u0, dev.v0)];
  quad(g, pts, dev.kind === 'host' ? HOST_FILL : SWITCH_FILL, HOST_EDGE);
  const vm = (dev.v0 + dev.v1) / 2;
  if (dev.kind === 'host') {
    const led = facePoint(box, 0.24, vm);
    g.circle(led.x, led.y, 1.6).fill({ color: LED_OK });
  } else {
    for (let u = 0.12; u <= 0.88; u += 0.04) {
      const p = facePoint(box, u, vm);
      g.rect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
    }
    g.fill({ color: PORT_DOT, alpha: 0.55 });
  }
}

export interface BoxesView {
  readonly view: Container;
  /** Device labels are hidden when zoomed out (cheap LOD). */
  setDetailVisible(visible: boolean): void;
}

/** Static racks + devices: one Graphics for all geometry, a few Text labels. */
export function createBoxesView(topo: Topology): BoxesView {
  const view = new Container();
  const g = new Graphics();
  const labels = new Container();
  const detail = new Container();
  view.addChild(g, detail, labels);

  // Painter's order: back (small gx+gy) to front.
  const boxes = [...topo.boxes].sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
  for (const box of boxes) {
    drawBox(g, box);
    for (const dev of topo.devices) {
      if (dev.boxId !== box.id) continue;
      drawDevice(g, box, dev);
      const p = facePoint(box, 0.56, (dev.v0 + dev.v1) / 2);
      const t = new Text({ text: dev.label, style: LABEL_STYLE, resolution: 2 });
      t.anchor.set(0.5);
      t.position.set(p.x, p.y);
      detail.addChild(t);
    }
    const top = isoToScreen(box.gx + box.w / 2, box.gy + box.d / 2);
    const title = new Text({ text: box.label, style: TITLE_STYLE, resolution: 2 });
    title.anchor.set(0.5, 1);
    title.position.set(top.x, top.y - box.heightPx - 10);
    labels.addChild(title);
  }

  return {
    view,
    setDetailVisible(visible: boolean): void {
      detail.visible = visible;
    },
  };
}
