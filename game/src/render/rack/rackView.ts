/**
 * Rack front elevation view (UX.md §9, GRAPHICS.md "Čelní pohled racku") – PixiJS, render-only.
 *
 * - Static layer (tray, rack frames, U numbers, devices, ports, LEDs, labels) is rebuilt only when the data
 *   change and cached as ONE texture (cacheAsTexture) – a frame costs one sprite.
 * - Dynamic: one Graphics per cable (re-tessellated on style change only), one Graphics for hover / pending
 *   cable / compatible-port marks, packet dots in a ParticleContainer (pooled, dot atlas shared with the room).
 * - No filters. Cosmetic cable colours never use traffic colours (UX §9.4).
 */
import { BitmapText, Container, Graphics, Particle, ParticleContainer, Rectangle, Text, type Renderer } from 'pixi.js';
import type { GameSnapshot } from '../../engine';
import type { Camera } from '../camera';
import { distanceToPolyline } from '../geom/bezier';
import { createDotAtlas } from '../room/dotAtlas';
import { CABINET, DEVICE, OUTLINE } from '../room/palette';
import { DEFAULT_PACKET_SIM, PacketSim } from '../traffic/packetSim';
import type { LinkTraffic, TrafficSource } from '../traffic/trafficModel';
import { formatGbps } from '../traffic/flowScale';
import { FLOW_FONT, ensureFlowFont } from '../traffic/flowFont';
import { ELEV, layoutElevation, rowRange, type ElevationLayout, type ElevDevice, type ElevRack, type PortGeom } from './rackLayout';
import { pathLength, pointAt, routeAll, toFloat32, type Pt } from './rackRoute';

export interface RackCableData {
  readonly id: string;
  /** Port ids (`deviceId:port`). */
  readonly a: string;
  readonly b: string;
  /** Cosmetic colour (player's marking); undefined = colour by meaning (Traffic v3, UX §28.8). */
  readonly color?: number;
  readonly linkUp: boolean;
  readonly bmc: boolean;
}

export interface RackDeviceState {
  /** ESX installed -> status LED ● green; otherwise ■ grey "bez OS". */
  readonly esxInstalled: boolean;
  /** ESX install running -> LED ◐ amber. */
  readonly installing?: boolean;
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
/** Traffic v3 (UX §28.4): log emission, budget 200 live dots, 110 px/s (slowed only by congestion). */
const RACK_PACKETS = { ...DEFAULT_PACKET_SIM, maxPackets: 300, budget: 200, speedPxPerMs: 0.11 };
/** Base dot scale × flowScale.dotScale. */
const RACK_DOT = 0.75;
/** Cable colours by meaning (UX §28.8): data light grey (6.9:1 on the rack face), BMC grey dashed, error red dashed. */
export const RACK_CABLE = { data: 0xb4bfcd, bmc: 0x8592a3, error: 0xff5a6a, select: 0x1d63c8 } as const;
const BMC_PERIOD_MS = 3000;
const BMC_ISO_PERIOD_MS = 500;
const BMC_TRAVEL_MS = 2000;
const HOVER_SCALE = 1.6;
const LED_UP = DEVICE.ledOk;
const LED_DOWN = 0xf0a14a;
const LED_OFF = 0x8592a3;

const txt = (text: string, size: number, color: number, weight: '400' | '700' | '800' = '700'): Text =>
  new Text({ text, style: { fontFamily: FONT, fontSize: size, fontWeight: weight, fill: color }, resolution: 2 });

export class RackElevationView {
  readonly root = new Container();
  private readonly staticLayer = new Container();
  private readonly cableLayer = new Container();
  private readonly fx = new Graphics();
  /** Velcro ties over the cable bundle in the side channel every 6 U (decorative, UX §28.8 P9). */
  private readonly tiesFx = new Graphics();
  /** Grey BMC squares (game scope, own shape outside the VCF dot atlas – UX 19.6). */
  private readonly bmcFx = new Graphics();
  private bmcCables: string[] = [];
  private bmcIso = new Set<string>();
  private bmcClock = 0;
  private source: TrafficSource | null = null;
  /** "≈ x Gb/s" sum above each ToR (BitmapText pool, ≤ 8). */
  private readonly labelLayer = new Container();
  private torLabels: BitmapText[] = [];
  private labelMs = 0;
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
  private switchIds = new Set<string>();

  constructor(renderer: Renderer) {
    this.dots = createDotAtlas(renderer);
    this.root.visible = false;
    this.root.addChild(this.staticLayer, this.cableLayer, this.tiesFx, this.bmcFx, this.fx, this.labelLayer);
    ensureFlowFont();
  }

  get layout(): ElevationLayout {
    return this.layoutCache;
  }

  route(id: string): readonly Pt[] | undefined {
    return this.routes.get(id);
  }

  /** Rebuild everything that depends on the data (static texture, routes, cables). Cheap no-op when unchanged. */
  setData(racks: readonly ElevRack[], cables: readonly RackCableData[], devices: ReadonlyMap<string, RackDeviceState>, uPx: number = ELEV.uPx): void {
    const key = JSON.stringify([racks, cables, [...devices], uPx]);
    if (key === this.dataKey) return;
    this.dataKey = key;
    this.layoutCache = layoutElevation(racks, { uPx });
    this.cables = cables;
    this.routes = routeAll(this.layoutCache, cables);
    const linked = new Map<string, boolean>();
    for (const c of cables) {
      linked.set(c.a, c.linkUp);
      linked.set(c.b, c.linkUp);
    }
    this.switchIds = new Set(racks.flatMap((r) => r.devices.filter((d) => d.kind === 'switch').map((d) => d.id)));
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
    this.drawTies();
    this.rebuildSim();
    this.drawFx();
  }

  /** Dark 3 px ties across the vertical cable runs of each channel, every 6 U (redrawn with the data only). */
  private drawTies(): void {
    const g = this.tiesFx;
    g.clear();
    const L = this.layoutCache;
    const step = 6 * L.uPx;
    for (const col of L.columns) {
      const segs: { x: number; y0: number; y1: number }[] = [];
      for (const pts of this.routes.values()) {
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1]!;
          const b = pts[i]!;
          if (Math.abs(a.x - b.x) > 0.01 || a.x < col.channelX || a.x > col.channelX + col.channelW) continue;
          segs.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
        }
      }
      if (!segs.length) continue;
      for (let y = col.y + col.h - step; y > col.y + 4; y -= step) {
        const hit = segs.filter((sg) => sg.y0 <= y && sg.y1 >= y);
        if (hit.length < 2) continue;
        const x0 = Math.min(...hit.map((h) => h.x)) - 2;
        const x1 = Math.max(...hit.map((h) => h.x)) + 2;
        g.roundRect(x0, y - 1.5, x1 - x0, 3, 1);
      }
    }
    g.fill({ color: 0x0f1b2d, alpha: 0.9 });
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

  /**
   * BMC cables with game-scope traffic (grey squares ▫ 1 per 3 s – UX §28.7); `iso` = cables carrying the remote
   * install ISO (1 square per 0.5 s). Never VCF dots or Gb/s.
   */
  setBmcTraffic(ids: readonly string[], iso: Iterable<string> = []): void {
    this.bmcIso = new Set([...iso].filter((id) => this.routes.has(id)));
    this.bmcCables = [...new Set([...ids, ...this.bmcIso])].filter((id) => this.routes.has(id));
    if (!this.bmcCables.length) this.bmcFx.clear();
  }

  /** Same traffic source as the room (engine E-T6 contract; the demo too). Sampled every frame at game time. */
  setTrafficSource(source: TrafficSource | null, show: boolean): void {
    this.source = source;
    this.setTraffic(this.traffic, show);
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
    if (this.source) this.traffic = this.source.sample(now);
    this.drawBmc(Math.min(realMs, 100), dt > 0);
    this.labelMs += realMs;
    if (this.labelMs >= 500) {
      this.labelMs = 0;
      this.updateTorLabels();
    }
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
      s.scaleX = s.scaleY = RACK_DOT * p.scale;
      s.alpha = p.alpha;
    }
  }

  /** Sum "≈ x Gb/s" above every switch with traffic (UX §28.6 rack: number at the ToR port group). */
  private updateTorLabels(): void {
    const L = this.layoutCache;
    const sums = new Map<string, number>();
    if (this.showTraffic) {
      for (const c of this.cables) {
        const t = this.traffic.get(c.id);
        if (!t || c.bmc || t.demandGbps <= 0) continue;
        for (const pid of [c.a, c.b]) {
          const port = L.ports.get(pid);
          const dev = port ? L.devices.get(port.deviceId) : undefined;
          if (!port || !dev || !this.switchIds.has(port.deviceId)) continue;
          sums.set(port.deviceId, (sums.get(port.deviceId) ?? 0) + t.demandGbps);
        }
      }
    }
    const want = [...sums].filter(([, g]) => g > 0).slice(0, 8);
    while (this.torLabels.length < want.length) {
      const t = new BitmapText({ text: '', style: { fontFamily: FLOW_FONT, fontSize: 12 } });
      t.anchor.set(1, 1);
      this.torLabels.push(t);
      this.labelLayer.addChild(t);
    }
    this.torLabels.forEach((t, i) => {
      const w = want[i];
      t.visible = !!w;
      if (!w) return;
      const geo = L.devices.get(w[0])!;
      const text = formatGbps(w[1]);
      if (t.text !== text) t.text = text;
      t.position.set(geo.x + geo.w - 4, geo.y - 2);
    });
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.dots.base.destroy(true);
  }

  // ------------------------------------------------------------------ drawing

  private drawBmc(realMs: number, running: boolean): void {
    const g = this.bmcFx;
    if (!this.bmcCables.length || !this.showTraffic) {
      if (g.visible) g.clear();
      g.visible = this.showTraffic;
      return;
    }
    g.visible = true;
    // Real-time animation (game scope, frozen while paused): ▫ 1 per 3 s, ISO transfer 1 per 0.5 s, 2 s travel.
    if (running) this.bmcClock += realMs;
    g.clear();
    let any = false;
    this.bmcCables.forEach((id, i) => {
      const pts = this.routes.get(id);
      if (!pts) return;
      const period = this.bmcIso.has(id) ? BMC_ISO_PERIOD_MS : BMC_PERIOD_MS;
      const off = ((i * 0.37) % 1) * period;
      const newest = Math.floor((this.bmcClock + off) / period);
      for (let k = newest; k >= 0; k--) {
        const t = (this.bmcClock + off - k * period) / BMC_TRAVEL_MS;
        if (t > 1) break;
        const p = pointAt(pts, t);
        g.rect(p.x - 3, p.y - 3, 6, 6);
        any = true;
      }
    });
    if (any) g.fill(RACK_CABLE.bmc).stroke({ color: OUTLINE, width: 1.2 });
  }

  private drawStatic(racks: readonly ElevRack[], linked: ReadonlyMap<string, boolean>, devState: ReadonlyMap<string, RackDeviceState>): void {
    const layer = this.staticLayer;
    if (layer.isCachedAsTexture) layer.cacheAsTexture(false);
    for (const c of layer.removeChildren()) c.destroy();
    const L = this.layoutCache;
    const g = new Graphics();
    layer.addChild(g);
    if (L.columns.length === 0) return;
    const U = L.uPx;
    // Thin grey bar to the ceiling tray (v3: no amber tray; 8 px, alpha 0.5).
    const tx0 = L.columns[0]!.x - 6;
    const tx1 = L.columns[L.columns.length - 1]!.x + L.columns[L.columns.length - 1]!.w + 6;
    g.roundRect(tx0, L.trayY - 4, tx1 - tx0, 8, 3).fill({ color: 0x8592a3, alpha: 0.5 }).stroke({ color: 0x6c7c93, width: 1, alpha: 0.5 });
    const tl = txt('↑ ke stropnímu žlabu', 10, 0x4a5566, '700');
    tl.position.set(tx0 + 4, L.trayY - 17);
    layer.addChild(tl);

    for (const col of L.columns) {
      const rack = racks[col.index]!;
      // Frame (graphite), mounting area, side channel with subtle (semi-transparent) rails.
      g.roundRect(col.x, col.y, col.w, col.h, 6).fill(CABINET.front).stroke({ color: OUTLINE, width: 2 });
      g.rect(col.innerX, col.y + 4, col.innerW, col.h - 8).fill(CABINET.inner);
      g.rect(col.channelX, col.y + 4, col.channelW, col.h - 8).fill({ color: CABINET.side });
      g.moveTo(col.innerX + 0.5, col.y + 4).lineTo(col.innerX + 0.5, col.y + col.h - 4).moveTo(col.innerX + col.innerW - 0.5, col.y + 4).lineTo(col.innerX + col.innerW - 0.5, col.y + col.h - 4);
      g.stroke({ color: CABINET.rail, width: 1, alpha: 0.5 });
      const head = txt(`${rack.label} · ${rack.heightU}U`, 13, OUTLINE, '800');
      head.position.set(col.x + 2, col.y - 19);
      layer.addChild(head);
      for (const row of col.rows) {
        // U ruler on the left rail: ranges ("7–8") for devices, single numbers for empty U.
        const big = row.kind === 'device' || (row.kind === 'empty' && row.compressed);
        const num = txt(rowRange(row), Math.min(11, U * 0.55), big ? 0xe6edf6 : 0x8592a3, '700');
        num.anchor.set(1, 0.5);
        num.position.set(col.innerX - 4, row.y + (row.kind === 'device' ? row.h / 2 : Math.min(row.h / 2, U / 2)));
        layer.addChild(num);
        // Tick between rows.
        g.moveTo(col.x + 6, row.y).lineTo(col.innerX - 2, row.y);
        g.stroke({ color: 0x4a5b73, width: 1, alpha: 0.6 });
        if (row.kind === 'empty') {
          if (row.compressed) {
            g.rect(col.innerX + 2, row.y + 2, col.innerW - 4, row.h - 4).fill({ color: 0x2e3d55 });
            for (let x = col.innerX + 6; x < col.innerX + col.innerW - 6; x += 10) g.moveTo(x, row.y + row.h - 4).lineTo(x + 8, row.y + 4);
            g.stroke({ color: 0x4a5b73, width: 1.2 });
            // Break marks (two slanted lines) on the left edge.
            g.moveTo(col.innerX - 10, row.y + row.h / 2 + 4).lineTo(col.innerX - 2, row.y + row.h / 2 - 4).moveTo(col.innerX - 6, row.y + row.h / 2 + 4).lineTo(col.innerX + 2, row.y + row.h / 2 - 4);
            g.stroke({ color: 0xe6edf6, width: 1.5 });
            const t = txt(`${row.topU - row.bottomU + 1} U volné`, Math.min(12, U * 0.62), 0xe6edf6, '700');
            t.anchor.set(0.5);
            t.position.set(col.innerX + col.innerW / 2, row.y + row.h / 2);
            layer.addChild(t);
          } else {
            g.rect(col.innerX + 2, row.y + 1, col.innerW - 4, row.h - 2).stroke({ color: 0x33435c, width: 1 });
          }
        } else if (row.kind === 'reserved') {
          // Reserved U for the recommended second ToR (UX 19.5): dashed outline.
          dashedRect(g, col.innerX + 3, row.y + 2, col.innerW - 6, row.h - 4, 5, 4);
          g.stroke({ color: 0x9fb3cc, width: 1.2 });
          const t = txt('+ druhý ToR (doporučeno)', Math.min(11, U * 0.55), 0xc9d3ea, '700');
          t.anchor.set(0.5);
          t.position.set(col.innerX + col.innerW / 2, row.y + row.h / 2);
          layer.addChild(t);
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
    const U = this.layoutCache.uPx;
    const DU = this.layoutCache.devU;
    if (d.kind === 'server') {
      g.roundRect(x, y, w, h, 3).fill(DEVICE.serverFace).stroke({ color: OUTLINE, width: 1.6 });
      g.roundRect(x + 3, y + 3, 8, h - 6, 2).fill(d.tagColor ?? 0x2560c4);
      // Drive bays (per U one row).
      const bays = Math.max(1, d.heightU);
      for (let r = 0; r < bays; r++) for (let bx = x + 150; bx < x + 205; bx += 9) g.roundRect(bx, y + 3 + r * (h / bays), 7, h / bays - 6, 1.5);
      g.fill(DEVICE.serverShade).stroke({ color: DEVICE.bay, width: 1 });
      const t = txt(d.label, Math.min(14, DU * 0.5), OUTLINE, '800');
      t.position.set(x + 15, y + 3);
      layer.addChild(t);
      if (h >= U * 1.6) {
        const sub = txt((d.sublabel ?? '').slice(0, 20), Math.min(11, DU * 0.4), 0x4a5566, '700');
        sub.position.set(x + 15, y + h / 2 + 1);
        layer.addChild(sub);
      }
      // Status LED: shape + colour (● online, ◐ installing, ■ no OS) – UX §4.5.
      const lx = x + w - 10;
      const ly = y + h / 2;
      if (st?.esxInstalled) g.circle(lx, ly, 4).fill(LED_UP).stroke({ color: OUTLINE, width: 1.2 });
      else if (st?.installing) g.circle(lx, ly, 4).fill(DEVICE.ledAct).stroke({ color: OUTLINE, width: 1.2 });
      else g.rect(lx - 3.5, ly - 3.5, 7, 7).fill(LED_OFF).stroke({ color: OUTLINE, width: 1.2 });
      // Free NIC slots "[+]" (DOM buttons sit on top; UX 19.4).
      for (const sl of this.layoutCache.slots.values()) {
        if (sl.deviceId !== d.id) continue;
        dashedRect(g, sl.x, sl.y, sl.w, sl.h, 3, 2);
        g.stroke({ color: 0x4a5b73, width: 1 });
        const p = txt('+', Math.min(12, sl.h * 0.8), 0x1d63c8, '800');
        p.anchor.set(0.5);
        p.position.set(sl.x + sl.w / 2, sl.y + sl.h / 2);
        layer.addChild(p);
      }
    } else {
      g.roundRect(x, y, w, h, 3).fill(DEVICE.switchFace).stroke({ color: OUTLINE, width: 1.6 });
      const t = txt(d.label, Math.min(13, DU * 0.5), 0xffffff, '800');
      t.anchor.set(0, 0.5);
      t.position.set(x + 8, y + h / 2 - (h >= U * 1.6 ? 5 : 0));
      layer.addChild(t);
      const sub = txt(d.preinstalled ? 'předinstalováno · herní' : (d.sublabel ?? 'generický').slice(0, 14), Math.min(8, U * 0.4), 0xc9d3ea, '700');
      // 1U: second line does not fit -> under the name only when the device is taller; else hidden (tooltip / panel).
      if (h >= U * 1.6) {
        sub.position.set(x + 8, y + h / 2 + 2);
        layer.addChild(sub);
      } else sub.destroy();
    }
    for (const p of this.layoutCache.ports.values()) {
      if (p.deviceId !== d.id) continue;
      const up = st?.companyUplinkPort;
      const isUplink = d.kind === 'switch' && up !== undefined && p.port === up;
      this.drawPort(g, p, isUplink ? true : linked.get(p.id), isUplink, d.kind === 'switch');
      if (isUplink) {
        // Company uplink: short cable up to the ceiling bar + label (GAME abstraction "Síť firmy").
        const ty = this.layoutCache.trayY;
        const col = this.layoutCache.columns[p.column]!;
        const ex = col.channelX + col.channelW - 5;
        const path = [{ x: p.x, y: p.y }, { x: p.x, y: p.stubY - 1 }, { x: ex, y: p.stubY - 1 }, { x: ex, y: ty + 4 }];
        // Traffic v3 (UX §28.5 / 28.8): same neutral jacket as data cables – yellow is reserved for the load warning.
        roundedPath(g, path, 3).stroke({ color: OUTLINE, width: 4, join: 'round', cap: 'round' });
        roundedPath(g, path, 3).stroke({ color: RACK_CABLE.data, width: 2.2, join: 'round', cap: 'round' });
        const lab = txt('↑ síť firmy (herní)', 9, OUTLINE, '800');
        lab.anchor.set(1, 1);
        lab.position.set(ex + 4, ty - 6);
        layer.addChild(lab);
      }
    }
  }

  private drawPort(g: Graphics, p: PortGeom, link: boolean | undefined, uplink: boolean, onSwitch = false): void {
    const bmc = p.port === 'bmc';
    const w = p.w;
    const hh = p.h;
    if (bmc) g.rect(p.x - w / 2, p.y - hh / 2, w, hh).fill(0x8592a3).stroke({ color: OUTLINE, width: 1.2 });
    else if (link === undefined && onSwitch) {
      // Free ToR port: dimmed outline only (UX §28.8, D9) – connected ports stand out.
      g.roundRect(p.x - w / 2, p.y - hh / 2, w, hh, 2).stroke({ color: 0xc9d3ea, width: 1, alpha: 0.45 });
      return;
    } else g.roundRect(p.x - w / 2, p.y - hh / 2, w, hh, 2).fill(link === undefined ? DEVICE.port : 0x24324a).stroke({ color: uplink ? 0x9fb3cc : OUTLINE, width: uplink ? 2 : 1.1 });
    // Link LED (shape: filled = link, hollow = no link) at the port corner.
    const ly = p.y - hh / 2 - 1.5;
    if (link === undefined) g.circle(p.x + w / 2 - 1.5, ly, 1.1).stroke({ color: LED_OFF, width: 0.8 });
    else g.circle(p.x + w / 2 - 1.5, ly, 1.5).fill(link ? LED_UP : LED_DOWN);
  }

  private drawCables(): void {
    const sel = this.selected;
    for (const c of this.cables) {
      const v = this.cableGfx.get(c.id);
      const pts = this.routes.get(c.id);
      if (!v || !pts) continue;
      const hovered = this.hoverCable === c.id;
      const dim = sel !== null && sel !== c.id;
      const key = `${c.color}|${hovered ? 1 : 0}|${sel === c.id ? 1 : 0}|${dim ? 1 : 0}|${c.bmc ? 1 : 0}|${c.linkUp ? 1 : 0}`;
      if (key === v.key) continue;
      v.key = key;
      const g = v.g;
      g.clear();
      const path = (): Graphics => roundedPath(g, pts, 4);
      // Colour by meaning only (UX §28.8): data light grey, BMC grey dashed, link down red dashed, selection blue rim;
      // the player's cosmetic colour only when set (never yellow – reserved for the load warning).
      const error = !c.linkUp && !c.bmc;
      const color = error ? RACK_CABLE.error : c.bmc ? RACK_CABLE.bmc : (c.color ?? RACK_CABLE.data);
      if (hovered || sel === c.id) path().stroke({ color: sel === c.id ? RACK_CABLE.select : 0xffffff, width: 7, alpha: 0.9, join: 'round', cap: 'round' });
      if (c.bmc || error) {
        dashedPath(g, pts, 4, 3);
        g.stroke({ color: OUTLINE, width: c.bmc ? 3 : 4, cap: 'butt' });
        dashedPath(g, pts, 4, 3);
        g.stroke({ color, width: c.bmc ? 1.5 : 2.2, cap: 'butt' });
      } else {
        path().stroke({ color: OUTLINE, width: 4, join: 'round', cap: 'round' });
        path().stroke({ color, width: 2.2, join: 'round', cap: 'round' });
      }
      // Connector plugs.
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      g.rect(a.x - 3, a.y - 3, 6, 6).rect(b.x - 3, b.y - 3, 6, 6).fill(color).stroke({ color: OUTLINE, width: 1.4 });
      if (error) {
        // ⛔ mark at both ends (shape + colour, not colour only).
        for (const q of [a, b]) g.circle(q.x + 7, q.y - 7, 4).fill(RACK_CABLE.error).stroke({ color: OUTLINE, width: 1 }).moveTo(q.x + 4.6, q.y - 7).lineTo(q.x + 9.4, q.y - 7).stroke({ color: 0xffffff, width: 1.6 });
      }
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
          g.rect(p.cell.x, p.cell.y, p.cell.w, p.cell.h).fill({ color: 0x0f1b2d, alpha: 0.55 });
          g.moveTo(p.cell.x, p.cell.y + p.cell.h).lineTo(p.cell.x + p.cell.w, p.cell.y).stroke({ color: 0xe5484d, width: 1, alpha: 0.8 });
        }
      }
      const from = L.ports.get(pend.from);
      if (from) {
        g.roundRect(from.x - from.w / 2 - 4, from.y - from.h / 2 - 4, from.w + 8, from.h + 8, 4).stroke({ color: 0x1d63c8, width: 3 });
        if (pend.cursor) {
          const c = pend.cursor;
          const dx = Math.max(30, Math.abs(c.x - from.x) * 0.4);
          g.moveTo(from.x, from.y).bezierCurveTo(from.x + dx, from.y + 30, c.x - dx * 0.3, c.y + 40, c.x, c.y);
          g.stroke({ color: OUTLINE, width: 4, cap: 'round' });
          g.moveTo(from.x, from.y).bezierCurveTo(from.x + dx, from.y + 30, c.x - dx * 0.3, c.y + 40, c.x, c.y);
          g.stroke({ color: 0x1d63c8, width: 2, cap: 'round' });
          g.circle(c.x, c.y, 3.5).fill(0x1d63c8).stroke({ color: OUTLINE, width: 1.4 });
        }
      }
    }
    const hp = this.hoverPort ? L.ports.get(this.hoverPort) : undefined;
    if (hp) {
      // Port under the cursor grows 1.6x (UX §9.3) – drawn as an enlarged copy on top.
      const w = hp.w * HOVER_SCALE;
      const h = hp.h * HOVER_SCALE;
      g.roundRect(hp.x - w / 2, hp.y - h / 2, w, h, 3).fill(hp.port === 'bmc' ? 0x8592a3 : DEVICE.port).stroke({ color: 0x1d63c8, width: 2.4 });
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
    const view = new ParticleContainer<Particle>({ texture: this.dots.base, dynamicProperties: { position: true, color: true, uvs: true, vertex: true, rotation: false } });
    view.boundsArea = new Rectangle(0, 0, this.layoutCache.width, this.layoutCache.height);
    this.pool = this.sim.packets.map(() => new Particle({ texture: this.dots.shapes.management, anchorX: 0.5, anchorY: 0.5, scaleX: 0.55, scaleY: 0.55 }));
    view.visible = this.showTraffic;
    this.packetView = view;
    this.root.addChildAt(view, this.root.getChildIndex(this.fx));
  }
}

/** Dashed segments along an orthogonal polyline (stroke by the caller). */
function dashedPath(g: Graphics, pts: readonly Pt[], dash: number, gap: number): void {
  let on = true;
  let left = dash;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let d = 0;
    while (d < len) {
      const step = Math.min(left, len - d);
      if (on) g.moveTo(a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len).lineTo(a.x + ((b.x - a.x) * (d + step)) / len, a.y + ((b.y - a.y) * (d + step)) / len);
      d += step;
      left -= step;
      if (left <= 1e-6) {
        on = !on;
        left = on ? dash : gap;
      }
    }
  }
}

/** Dashed rectangle outline (no shader / filter – plain segments; stroke by the caller). */
function dashedRect(g: Graphics, x: number, y: number, w: number, h: number, dash: number, gap: number): void {
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      g.moveTo(x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len).lineTo(x0 + ((x1 - x0) * e) / len, y0 + ((y1 - y0) * e) / len);
    }
  };
  seg(x, y, x + w, y);
  seg(x + w, y, x + w, y + h);
  seg(x + w, y + h, x, y + h);
  seg(x, y + h, x, y);
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
