/**
 * Rack front elevation view (UX.md §9, GRAPHICS.md "Čelní pohled racku") – PixiJS, render-only.
 *
 * - Static layer (tray, rack frames, U numbers, devices, ports, LEDs, labels) is rebuilt only when the data
 *   change and cached as ONE texture (cacheAsTexture) – a frame costs one sprite.
 * - Dynamic: one Graphics per cable (re-tessellated on style change only), one Graphics for hover / pending
 *   cable / compatible-port marks, packet dots in a ParticleContainer (pooled, dot atlas shared with the room).
 * - No filters. Cosmetic cable colours never use traffic colours (UX §9.4).
 */
import { Container, Graphics, Particle, ParticleContainer, Rectangle, Text, type Renderer } from 'pixi.js';
import type { GameSnapshot } from '../../engine';
import type { Camera } from '../camera';
import { distanceToPolyline } from '../geom/bezier';
import { createDotAtlas } from '../room/dotAtlas';
import { CABINET, DECOR, DEVICE, OUTLINE } from '../room/palette';
import { DEFAULT_PACKET_SIM, PacketSim } from '../traffic/packetSim';
import type { LinkTraffic } from '../traffic/trafficModel';
import { ELEV, layoutElevation, type ElevationLayout, type ElevDevice, type ElevRack, type PortGeom } from './rackLayout';
import { pathLength, routeAll, toFloat32, type Pt } from './rackRoute';

export interface RackCableData {
  readonly id: string;
  /** Port ids (`deviceId:port`). */
  readonly a: string;
  readonly b: string;
  /** Cosmetic colour (player's marking). */
  readonly color: number;
  readonly linkUp: boolean;
  readonly bmc: boolean;
}

export interface RackDeviceState {
  /** ESX installed -> status LED ● green; otherwise ■ grey "bez OS". */
  readonly esxInstalled: boolean;
  /** Switch port connected to the company network (GAME abstraction) – framed + "⇧ síť firmy" mark. */
  readonly companyUplinkPort?: number;
}

export interface PendingCable {
  readonly from: string;
  /** Cursor in view-local coords (null = keyboard mode, no dangling end). */
  readonly cursor: Pt | null;
  readonly compatible: ReadonlySet<string>;
}

const FONT = 'system-ui, "Segoe UI", sans-serif';
const RACK_PACKETS = { ...DEFAULT_PACKET_SIM, maxPackets: 300, packetsPerGbps: 1.2, speedPxPerMs: 0.16 };
const HOVER_SCALE = 1.6;
const LED_UP = DEVICE.ledOk;
const LED_DOWN = 0xf0a14a;
const LED_OFF = 0x9a96ad;

const txt = (text: string, size: number, color: number, weight: '400' | '700' | '800' = '700'): Text =>
  new Text({ text, style: { fontFamily: FONT, fontSize: size, fontWeight: weight, fill: color }, resolution: 2 });

export class RackElevationView {
  readonly root = new Container();
  private readonly staticLayer = new Container();
  private readonly cableLayer = new Container();
  private readonly fx = new Graphics();
  private readonly dots: ReturnType<typeof createDotAtlas>;
  private packetView: ParticleContainer<Particle> | null = null;
  private pool: Particle[] = [];
  private sim: PacketSim | null = null;
  private shown = 0;
  private lastGameMs: number | null = null;

  private layoutCache: ElevationLayout = layoutElevation([]);
  private routes = new Map<string, Pt[]>();
  private cables: readonly RackCableData[] = [];
  private cableGfx = new Map<string, { g: Graphics; key: string }>();
  private hoverPort: string | null = null;
  private hoverCable: string | null = null;
  private selected: string | null = null;
  private pending: PendingCable | null = null;
  private traffic: ReadonlyMap<string, LinkTraffic> = new Map();
  private showTraffic = true;
  private cacheRes = 0;
  private dataKey = '';

  constructor(renderer: Renderer) {
    this.dots = createDotAtlas(renderer);
    this.root.visible = false;
    this.root.addChild(this.staticLayer, this.cableLayer, this.fx);
  }

  get layout(): ElevationLayout {
    return this.layoutCache;
  }

  route(id: string): readonly Pt[] | undefined {
    return this.routes.get(id);
  }

  /** Rebuild everything that depends on the data (static texture, routes, cables). Cheap no-op when unchanged. */
  setData(racks: readonly ElevRack[], cables: readonly RackCableData[], devices: ReadonlyMap<string, RackDeviceState>): void {
    const key = JSON.stringify([racks, cables, [...devices]]);
    if (key === this.dataKey) return;
    this.dataKey = key;
    this.layoutCache = layoutElevation(racks);
    this.cables = cables;
    this.routes = routeAll(this.layoutCache, cables);
    const linked = new Map<string, boolean>();
    for (const c of cables) {
      linked.set(c.a, c.linkUp);
      linked.set(c.b, c.linkUp);
    }
    this.drawStatic(racks, linked, devices);
    for (const v of this.cableGfx.values()) v.g.destroy();
    this.cableGfx.clear();
    for (const c of cables) {
      if (!this.routes.has(c.id)) continue;
      const g = new Graphics();
      this.cableLayer.addChild(g);
      this.cableGfx.set(c.id, { g, key: '' });
    }
    this.drawCables();
    this.rebuildSim();
    this.drawFx();
  }

  setCamera(cam: Camera, devicePixelRatio = 1): void {
    this.root.position.set(cam.x, cam.y);
    this.root.scale.set(cam.scale);
    const L = this.layoutCache;
    const maxRes = Math.max(1, Math.floor(4096 / Math.max(1, L.width, L.height)));
    const res = Math.min(maxRes, Math.max(1, Math.ceil(cam.scale * devicePixelRatio * 2) / 2));
    if (res !== this.cacheRes && this.staticLayer.children.length) {
      this.cacheRes = res;
      this.staticLayer.cacheAsTexture({ resolution: res, antialias: true });
      this.staticLayer.updateCacheTexture();
    }
  }

  setHoverPort(id: string | null): void {
    if (id === this.hoverPort) return;
    this.hoverPort = id;
    this.drawFx();
  }

  setHoverCable(id: string | null): void {
    if (id === this.hoverCable) return;
    this.hoverCable = id;
    this.drawCables();
  }

  setSelectedCable(id: string | null): void {
    if (id === this.selected) return;
    this.selected = id;
    this.drawCables();
  }

  setPending(p: PendingCable | null): void {
    this.pending = p;
    this.drawFx();
  }

  setTraffic(map: ReadonlyMap<string, LinkTraffic>, show: boolean): void {
    this.traffic = map;
    if (show !== this.showTraffic) {
      this.showTraffic = show;
      if (this.packetView) this.packetView.visible = show;
    }
  }

  /** Cable whose route passes within `tol` of the point (view-local coords). */
  cableAt(x: number, y: number, tol: number): string | null {
    let best: string | null = null;
    let bestD = tol;
    for (const [id, pts] of this.routes) {
      const d = distanceToPolyline(toFloat32(pts), x, y);
      if (d <= bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  update(snapshot: GameSnapshot, realMs: number): void {
    if (!this.root.visible) return;
    const now = snapshot.clock.gameTimeMs;
    const dt = this.lastGameMs === null ? 0 : Math.max(0, now - this.lastGameMs);
    this.lastGameMs = now;
    if (!this.sim || !this.packetView || !this.showTraffic) return;
    this.sim.step(Math.min(dt, 100 * Math.max(1, snapshot.clock.speed)), Math.min(realMs, 100), this.traffic, snapshot.clock.speed);
    const n = this.sim.count;
    const kids = this.packetView.particleChildren;
    if (n !== this.shown) {
      kids.length = n;
      for (let i = 0; i < n; i++) kids[i] = this.pool[i]!;
      this.shown = n;
      this.packetView.update();
    }
    for (let i = 0; i < n; i++) {
      const p = this.sim.packets[i]!;
      const s = this.pool[i]!;
      s.x = p.x;
      s.y = p.y;
      const tex = this.dots.shapes[p.falling ? 'nfs' : p.type];
      if (s.texture !== tex) s.texture = tex;
      s.tint = p.color;
      s.alpha = p.alpha;
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.dots.base.destroy(true);
  }

  // ------------------------------------------------------------------ drawing

  private drawStatic(racks: readonly ElevRack[], linked: ReadonlyMap<string, boolean>, devState: ReadonlyMap<string, RackDeviceState>): void {
    const layer = this.staticLayer;
    if (layer.isCachedAsTexture) layer.cacheAsTexture(false);
    for (const c of layer.removeChildren()) c.destroy();
    const L = this.layoutCache;
    const g = new Graphics();
    layer.addChild(g);
    if (L.columns.length === 0) return;
    // Overhead tray (ladder) across all columns.
    const tx0 = L.columns[0]!.x - 8;
    const tx1 = L.columns[L.columns.length - 1]!.x + L.columns[L.columns.length - 1]!.w + 8;
    g.roundRect(tx0, L.trayY - 12, tx1 - tx0, 24, 6).fill(DECOR.tray).stroke({ color: OUTLINE, width: 2 });
    for (let x = tx0 + 14; x < tx1 - 6; x += 22) g.moveTo(x, L.trayY - 12).lineTo(x, L.trayY + 12);
    g.stroke({ color: DECOR.trayDark, width: 2 });
    const tl = txt('kabelový žlab', 11, OUTLINE, '700');
    tl.position.set(tx0 + 8, L.trayY - 27);
    layer.addChild(tl);

    for (const col of L.columns) {
      const rack = racks[col.index]!;
      // Frame.
      g.roundRect(col.x, col.y, col.w, col.h, 8).fill(CABINET.front).stroke({ color: OUTLINE, width: 2.5 });
      g.rect(col.innerX, col.y + 6, col.innerW, col.h - 12).fill(CABINET.inner);
      g.rect(col.channelX, col.y + 6, col.channelW, col.h - 12).fill({ color: CABINET.side });
      for (let y = col.y + 12; y < col.y + col.h - 8; y += 14) g.rect(col.channelX + 3, y, col.channelW - 6, 2);
      g.fill({ color: CABINET.inner, alpha: 0.6 });
      const head = txt(`${rack.label} · ${rack.heightU}U`, 14, OUTLINE, '800');
      head.position.set(col.x + 4, col.y - 22);
      layer.addChild(head);
      for (const row of col.rows) {
        // U number on the left rail.
        const num = txt(row.kind === 'empty' && row.compressed ? `${row.topU}–${row.bottomU}` : String(row.topU), row.kind === 'empty' && row.compressed ? 8 : 10, 0xdad8f0, '700');
        num.anchor.set(1, 0.5);
        num.position.set(col.innerX - 3, row.y + Math.min(row.h / 2, 12));
        layer.addChild(num);
        if (row.kind === 'empty') {
          if (row.compressed) {
            g.rect(col.innerX + 2, row.y + 3, col.innerW - 4, row.h - 6).fill({ color: 0x3a3a62 });
            for (let x = col.innerX + 6; x < col.innerX + col.innerW - 6; x += 10) g.moveTo(x, row.y + row.h - 5).lineTo(x + 8, row.y + 5);
            g.stroke({ color: 0x55557e, width: 1.5 });
            const t = txt(`${row.topU - row.bottomU + 1} U volné`, 12, 0xe9e7ff, '700');
            t.anchor.set(0.5);
            t.position.set(col.innerX + col.innerW / 2, row.y + row.h / 2);
            layer.addChild(t);
          } else {
            g.rect(col.innerX + 2, row.y + 1, col.innerW - 4, row.h - 2).stroke({ color: 0x3e3e68, width: 1 });
          }
        }
      }
    }
    for (const rack of racks) for (const d of rack.devices) this.drawDevice(g, layer, d, linked, devState.get(d.id));
    this.cacheRes = 0;
  }

  private drawDevice(g: Graphics, layer: Container, d: ElevDevice, linked: ReadonlyMap<string, boolean>, st: RackDeviceState | undefined): void {
    const geo = this.layoutCache.devices.get(d.id);
    if (!geo) return;
    const { x, y, w, h } = geo;
    if (d.kind === 'server') {
      g.roundRect(x, y, w, h, 4).fill(DEVICE.serverFace).stroke({ color: OUTLINE, width: 2 });
      g.roundRect(x + 3, y + 3, 10, h - 6, 2).fill(d.tagColor ?? 0x3d8bfd);
      // Drive bays.
      for (let bx = x + 238; bx < x + 318; bx += 11) g.roundRect(bx, y + 5, 8, h - 10, 1.5);
      g.fill(DEVICE.serverShade).stroke({ color: DEVICE.bay, width: 1 });
      const t = txt(d.label, 13, OUTLINE, '800');
      t.position.set(x + 18, y + 4);
      const sub = txt(d.sublabel ?? '', 10, 0x5a4f78, '700');
      sub.position.set(x + 18, y + 21);
      layer.addChild(t, sub);
      // Status LED: shape + colour (● online, ■ no OS / off) – UX §4.5.
      const lx = x + w - 10;
      const ly = y + 9;
      if (st?.esxInstalled) g.circle(lx, ly, 4).fill(LED_UP).stroke({ color: OUTLINE, width: 1.2 });
      else g.rect(lx - 3.5, ly - 3.5, 7, 7).fill(LED_OFF).stroke({ color: OUTLINE, width: 1.2 });
    } else {
      g.roundRect(x, y, w, h, 4).fill(DEVICE.switchFace).stroke({ color: OUTLINE, width: 2 });
      g.roundRect(x + 3, y + 3, 8, h - 6, 2).fill(d.tagColor ?? DEVICE.ledAct);
      const t = txt(d.label, 12, 0xffffff, '800');
      t.position.set(x + 15, y + 3);
      const sub = txt(d.sublabel ? `${d.sublabel.slice(0, 14)}` : 'generický', 8, 0xdfe8ff, '700');
      sub.position.set(x + 15, y + 19);
      layer.addChild(t, sub);
    }
    for (const p of this.layoutCache.ports.values()) {
      if (p.deviceId !== d.id) continue;
      const up = st?.companyUplinkPort;
      const isUplink = d.kind === 'switch' && p.port === (up ?? d.switchPorts - 1);
      this.drawPort(g, p, up !== undefined && isUplink ? true : linked.get(p.id), isUplink);
      if (up !== undefined && isUplink) {
        // Company uplink: short cable up to the tray + label (GAME abstraction "Síť firmy").
        const ty = this.layoutCache.trayY;
        g.moveTo(p.x, p.y - p.h / 2).lineTo(p.x, ty + 12).stroke({ color: OUTLINE, width: 3.2, cap: 'round' });
        g.moveTo(p.x, p.y - p.h / 2).lineTo(p.x, ty + 12).stroke({ color: 0xffc94d, width: 1.6, cap: 'round' });
        const lab = txt('⇧ síť firmy (herní)', 9, OUTLINE, '800');
        lab.anchor.set(0.5, 1);
        lab.position.set(p.x, ty - 13);
        layer.addChild(lab);
      }
      if (d.kind === 'switch' && typeof p.port === 'number') {
        const n = txt(String(p.port + 1), 7, 0xdfe8ff, '700');
        n.anchor.set(0.5, p.stubY < p.y ? 1 : 0);
        n.position.set(p.x, p.stubY < p.y ? p.y - 6 : p.y + 6);
        layer.addChild(n);
      }
      if (p.port === 'bmc') {
        const b = txt('BMC', 7, 0x5a4f78, '800');
        b.anchor.set(0.5, 1);
        b.position.set(p.x, p.y - 7);
        layer.addChild(b);
      }
    }
  }

  private drawPort(g: Graphics, p: PortGeom, link: boolean | undefined, uplink: boolean): void {
    const bmc = p.port === 'bmc';
    const w = p.w;
    const hh = p.h;
    if (bmc) g.rect(p.x - w / 2, p.y - hh / 2, w, hh).fill(0x9a96ad).stroke({ color: OUTLINE, width: 1.4 });
    else g.roundRect(p.x - w / 2, p.y - hh / 2, w, hh, 2.5).fill(link === undefined ? DEVICE.port : 0x3a3550).stroke({ color: uplink ? 0xffc94d : OUTLINE, width: uplink ? 2.2 : 1.4 });
    // Link LED (shape: filled = link, hollow = no link) above the port.
    const ly = p.y - hh / 2 - 2.5;
    if (link === undefined) g.circle(p.x + w / 2 - 2, ly, 1.4).stroke({ color: LED_OFF, width: 1 });
    else g.circle(p.x + w / 2 - 2, ly, 1.8).fill(link ? LED_UP : LED_DOWN);
  }

  private drawCables(): void {
    const sel = this.selected;
    for (const c of this.cables) {
      const v = this.cableGfx.get(c.id);
      const pts = this.routes.get(c.id);
      if (!v || !pts) continue;
      const hovered = this.hoverCable === c.id;
      const dim = sel !== null && sel !== c.id;
      const key = `${c.color}|${hovered ? 1 : 0}|${sel === c.id ? 1 : 0}|${dim ? 1 : 0}|${c.bmc ? 1 : 0}`;
      if (key === v.key) continue;
      v.key = key;
      const g = v.g;
      g.clear();
      const path = (): Graphics => roundedPath(g, pts, 5);
      if (hovered || sel === c.id) path().stroke({ color: 0xffffff, width: 8, alpha: 0.85, join: 'round', cap: 'round' });
      path().stroke({ color: OUTLINE, width: 4, join: 'round', cap: 'round' });
      path().stroke({ color: c.color, width: 2.2, join: 'round', cap: 'round' });
      // Connector plugs.
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      g.rect(a.x - 3, a.y - 3, 6, 6).rect(b.x - 3, b.y - 3, 6, 6).fill(c.color).stroke({ color: OUTLINE, width: 1.4 });
      g.alpha = dim ? 0.4 : 1;
    }
  }

  private drawFx(): void {
    const g = this.fx;
    g.clear();
    const L = this.layoutCache;
    const pend = this.pending;
    if (pend) {
      for (const p of L.ports.values()) {
        if (p.id === pend.from) continue;
        if (pend.compatible.has(p.id)) g.roundRect(p.x - p.w / 2 - 3, p.y - p.h / 2 - 3, p.w + 6, p.h + 6, 4).stroke({ color: 0x2e9e6a, width: 2 });
        else {
          // Dimmed + hatched (not colour only).
          g.rect(p.cell.x, p.cell.y, p.cell.w, p.cell.h).fill({ color: 0x1b1730, alpha: 0.55 });
          g.moveTo(p.cell.x, p.cell.y + p.cell.h).lineTo(p.cell.x + p.cell.w, p.cell.y).stroke({ color: 0xe5484d, width: 1, alpha: 0.8 });
        }
      }
      const from = L.ports.get(pend.from);
      if (from) {
        g.roundRect(from.x - from.w / 2 - 4, from.y - from.h / 2 - 4, from.w + 8, from.h + 8, 4).stroke({ color: 0xff8a3d, width: 3 });
        if (pend.cursor) {
          const c = pend.cursor;
          const dx = Math.max(30, Math.abs(c.x - from.x) * 0.4);
          g.moveTo(from.x, from.y).bezierCurveTo(from.x + dx, from.y + 30, c.x - dx * 0.3, c.y + 40, c.x, c.y);
          g.stroke({ color: OUTLINE, width: 4, cap: 'round' });
          g.moveTo(from.x, from.y).bezierCurveTo(from.x + dx, from.y + 30, c.x - dx * 0.3, c.y + 40, c.x, c.y);
          g.stroke({ color: 0xff8a3d, width: 2, cap: 'round' });
          g.circle(c.x, c.y, 3.5).fill(0xff8a3d).stroke({ color: OUTLINE, width: 1.4 });
        }
      }
    }
    const hp = this.hoverPort ? L.ports.get(this.hoverPort) : undefined;
    if (hp) {
      // Port under the cursor grows 1.6x (UX §9.3) – drawn as an enlarged copy on top.
      const w = hp.w * HOVER_SCALE;
      const h = hp.h * HOVER_SCALE;
      g.roundRect(hp.x - w / 2, hp.y - h / 2, w, h, 3).fill(hp.port === 'bmc' ? 0x9a96ad : DEVICE.port).stroke({ color: 0xff8a3d, width: 2.4 });
    }
  }

  private rebuildSim(): void {
    this.packetView?.destroy();
    this.packetView = null;
    this.sim = null;
    this.shown = 0;
    const paths = this.cables
      .filter((c) => this.routes.has(c.id))
      .map((c) => {
        const pts = this.routes.get(c.id)!;
        return { spec: { id: c.id }, polyline: toFloat32(pts), length: pathLength(pts) };
      });
    if (!paths.length) return;
    this.sim = new PacketSim(paths, RACK_PACKETS);
    const view = new ParticleContainer<Particle>({ texture: this.dots.base, dynamicProperties: { position: true, color: true, uvs: true, vertex: false, rotation: false } });
    view.boundsArea = new Rectangle(0, 0, this.layoutCache.width, this.layoutCache.height);
    this.pool = this.sim.packets.map(() => new Particle({ texture: this.dots.shapes.management, anchorX: 0.5, anchorY: 0.5, scaleX: 0.55, scaleY: 0.55 }));
    view.visible = this.showTraffic;
    this.packetView = view;
    this.root.addChildAt(view, this.root.getChildIndex(this.fx));
  }
}

/** Orthogonal polyline with rounded corners (radius clamped to half of the shorter neighbour segment). */
export function roundedPath(g: Graphics, pts: readonly Pt[], radius: number): Graphics {
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const r = Math.min(radius, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    g.arcTo(b.x, b.y, c.x, c.y, r);
  }
  const last = pts[pts.length - 1]!;
  return g.lineTo(last.x, last.y);
}

export { ELEV };
