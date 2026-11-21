/**
 * Sandbox server room (cosy cartoon isometric look, GRAPHICS.md "Styl").
 *
 * Render-only: it shows what it is told (cabinets, devices, cables, avatar
 * commands) and never decides what is allowed in VCF terms. The only checks
 * here are physical drawing constraints (tile occupied, unit slot taken).
 *
 * Performance: the static room is one baked texture; every cabinet is one baked
 * sprite (re-baked only when its devices change); cables are one Graphics each,
 * re-tessellated only when their style changes; packets use one ParticleContainer.
 * No filters.
 */
import { Container, Graphics, Particle, ParticleContainer, Rectangle, Sprite, Text, type Renderer, type Texture } from 'pixi.js';
import type { GameSnapshot } from '../../engine';
import { distanceToPolyline } from '../geom/bezier';
import { isoToScreen } from '../iso';
import { DEFAULT_PACKET_SIM, PacketSim, type PacketPath } from '../traffic/packetSim';
import type { LinkTraffic, TrafficSource } from '../traffic/trafficModel';
import type { TrafficType } from '../traffic/trafficTypes';
import { createAvatarTextures, type AvatarTextures } from './avatarArt';
import { AvatarMotion } from './avatarMotion';
import { diamond, up, type P } from './draw';
import { createDotAtlas, type DotShape } from './dotAtlas';
import { CABINETS, canMount, drawCabinet, firstFreeU, devicePortPoint, type CabinetKind, type CabinetSpec, type RoomDeviceSpec } from './furniture';
import { BLOCKED_TILE, CABLE, DECOR, HOVER_TILE, OUTLINE, SHADOW, TARGET_TILE } from './palette';
import { bundleWidth, devicePath, faceEdgePoint, flatten, pairKey, polyLength, riserTop, trayRoute } from './roomBundles';
import type { RoomCableSpec } from './roomCables';
import { depthOf, nearestReachable, Occupancy, worldToTile, type Footprint, type RoomSize, type Tile } from './roomGrid';
import { drawStaticRoom, SLAB_H, WALL_H, WALL_T } from './roomStatic';

export const DEFAULT_ROOM: RoomSize = { cols: 11, rows: 9 };

export type PlaceResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'duplicate' | 'outside' | 'occupied' | 'avatar' | 'unknown' | 'slot' };

export type GhostKind = CabinetKind;

/** Snapshot of what is placed (for UI lists / persistence later). */
export interface RoomContents {
  readonly cabinets: readonly { readonly spec: CabinetSpec; readonly devices: readonly RoomDeviceSpec[] }[];
  readonly cables: readonly RoomCableSpec[];
}

interface CabinetEntry {
  spec: CabinetSpec;
  devices: RoomDeviceSpec[];
  sprite: Sprite;
  shadow: Sprite;
  texture: Texture | null;
  /** Thin cable risers on the front-right edge (port -> edge -> top). */
  risers: Graphics;
  key: string;
}

/** Cable in the room: endpoints + packet path through the tray (UX §12.2). */
interface CableEntry {
  readonly spec: RoomCableSpec;
  readonly cabA: string;
  readonly cabB: string;
  readonly path: PacketPath & { readonly polyline: Float32Array; readonly points: readonly P[] };
}

/** Cables between one cabinet pair, drawn as one neutral bundle along the overhead tray. */
interface BundleEntry {
  readonly key: string;
  readonly cabA: string;
  readonly cabB: string;
  readonly cables: string[];
  readonly route: readonly P[];
  readonly flat: Float32Array;
  readonly gfx: Graphics;
  badge: Text | null;
}

export interface BundleInfo {
  readonly key: string;
  readonly cables: readonly RoomCableSpec[];
}

const MAX_REAL_DELTA_MS = 100;
const ROOM_PACKETS = { ...DEFAULT_PACKET_SIM, maxPackets: 400, packetsPerGbps: 0.9, speedPxPerMs: 0.09 };
const FURNITURE_RES = 3;

/** Soft blob shadow: stacked translucent ellipses (no blur filter). */
function createShadowTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  for (let i = 0; i < 6; i++) g.ellipse(0, 0, 40 - i * 4, 20 - i * 2).fill({ color: SHADOW, alpha: 0.07 });
  const t = renderer.generateTexture({ target: g, resolution: 1, antialias: true });
  g.destroy();
  return t;
}

/**
 * Cartoon packet "pellet": white core (tinted per traffic type) with a dark OUTLINE
 * rim - the rim stays dark under any tint, so packets keep >= 3:1 on the light floor
 * (GRAPHICS.md "Světlá serverovna"). One texture -> one batched ParticleContainer.
 */
/** Small magnifier icon shown above an interactive object on hover / focus (UX §7.2). */
function createMagnifierTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(9, 9, 8).fill({ color: 0xffffff }).stroke({ color: OUTLINE, width: 2 });
  g.circle(8, 8, 3.6).stroke({ color: OUTLINE, width: 2 });
  g.moveTo(10.6, 10.6).lineTo(13.4, 13.4).stroke({ color: OUTLINE, width: 2.4, cap: 'round' });
  const t = renderer.generateTexture({ target: g, frame: new Rectangle(0, 0, 18, 18), resolution: 3, antialias: true });
  g.destroy();
  return t;
}

const DOT_SCALE = 0.62;
/** Real-ms period of the dashed "ISO transfer" animation on BMC cables (game scope, UX §15.4). */
const DASH_FRAME_MS = 90;

export class RoomScene {
  readonly world = new Container();
  readonly grid: Occupancy;
  readonly avatar: AvatarMotion;

  private readonly staticGfx: Graphics;
  private staticSprite: Sprite | null = null;
  private staticRes = 0;
  private readonly shadows = new Container();
  private readonly floorFx = new Graphics();
  private readonly markerFx = new Graphics();
  private readonly objects = new Container();
  private readonly ghostSprite = new Sprite();
  private readonly avatarSprite = new Sprite();
  private readonly avatarShadow: Sprite;
  private readonly avatarTex: AvatarTextures;
  private readonly shadowTex: Texture;
  private readonly dots: ReturnType<typeof createDotAtlas>;
  private readonly magnifierTex: Texture;
  private readonly magnifier: Sprite;
  private readonly highlightFx = new Graphics();
  private highlighted: string | null = null;
  private readonly overhead = new Container();
  private readonly bmcFx = new Graphics();
  private bmcActive = new Set<string>();
  private dashMs = 0;
  private dashPhase = 0;
  private packetView: ParticleContainer<Particle> | null = null;
  private packetPool: Particle[] = [];
  private shownPackets = 0;
  private sim: PacketSim | null = null;
  private simDirty = true;

  private readonly cabinets = new Map<string, CabinetEntry>();
  private readonly deviceOwner = new Map<string, string>();
  private readonly cables = new Map<string, CableEntry>();
  private readonly bundles = new Map<string, BundleEntry>();
  private cablesDirty = false;
  private hoveredBundle: string | null = null;
  private filter: TrafficType | null = null;
  private viewScale = 1;
  private readonly active = new Set<TrafficType>();
  private source: TrafficSource | null = null;
  private traffic: ReadonlyMap<string, LinkTraffic> = new Map();
  private lastGameTimeMs: number | null = null;
  private hoverTile: Tile | null = null;
  private ghost: { kind: GhostKind; tile: Tile; valid: boolean } | null = null;
  private ghostTextures = new Map<GhostKind, { tex: Texture; ax: number; ay: number }>();
  private fxKey = '';
  private markerMs = 0;
  private arriveListeners = new Set<(tile: Tile) => void>();
  private readonly ghostShadow: Sprite;

  constructor(
    private readonly renderer: Renderer,
    readonly size: RoomSize = DEFAULT_ROOM,
    avatarStart: Tile = { gx: Math.floor(size.cols / 2), gy: size.rows - 2 },
  ) {
    this.grid = new Occupancy(size);
    this.avatar = new AvatarMotion(avatarStart);
    this.staticGfx = drawStaticRoom(size);
    this.shadowTex = createShadowTexture(renderer);
    this.dots = createDotAtlas(renderer);
    this.magnifierTex = createMagnifierTexture(renderer);
    this.magnifier = new Sprite(this.magnifierTex);
    this.magnifier.anchor.set(0.5, 1);
    this.magnifier.scale.set(0.9);
    this.magnifier.visible = false;
    this.highlightFx.visible = false;
    this.avatarTex = createAvatarTextures(renderer);
    this.avatarSprite.anchor.set(this.avatarTex.anchor.x, this.avatarTex.anchor.y);
    this.avatarSprite.texture = this.avatarTex.frames.front.stand;
    this.avatarShadow = this.makeShadow(0.42);
    this.ghostShadow = this.makeShadow(0.9);
    this.ghostShadow.visible = false;
    this.ghostSprite.visible = false;
    this.ghostSprite.alpha = 0.6;
    this.objects.sortableChildren = true;
    this.objects.addChild(this.avatarSprite, this.ghostSprite);
    this.shadows.addChild(this.avatarShadow, this.ghostShadow);
    this.objects.addChild(this.highlightFx);
    this.world.addChild(this.shadows, this.floorFx, this.markerFx, this.objects, this.overhead, this.bmcFx, this.magnifier);
    this.bakeStatic(2);
    this.syncAvatar(0);
  }

  // ---------------------------------------------------------------- view

  /** World bounds of the room (floor, walls, slab). */
  get bounds(): { x: number; y: number; width: number; height: number } {
    const { cols, rows } = this.size;
    const left = isoToScreen(-WALL_T, rows).x;
    const right = isoToScreen(cols, -WALL_T).x;
    const top = isoToScreen(-WALL_T, -WALL_T).y - WALL_H;
    const bottom = isoToScreen(cols, rows).y + SLAB_H;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  /**
   * Re-bake the static room texture for the current zoom (resolution buckets
   * 1/2/3/4, capped so the texture stays <= 4096 px - safe on Chromebook GPUs).
   */
  setViewScale(scale: number, devicePixelRatio = 1): void {
    if ((scale >= 1) !== (this.viewScale >= 1)) this.cablesDirty = true; // count badges appear at zoom >= 1
    this.viewScale = scale;
    const b = this.bounds;
    const maxRes = Math.max(1, Math.floor(4096 / Math.max(b.width, b.height)));
    const res = Math.min(maxRes, Math.max(1, Math.ceil(scale * devicePixelRatio)));
    if (res !== this.staticRes) this.bakeStatic(res);
  }

  private bakeStatic(res: number): void {
    const b = this.bounds;
    const frame = new Rectangle(b.x - 4, b.y - 4, b.width + 8, b.height + 8);
    const tex = this.renderer.generateTexture({ target: this.staticGfx, frame, resolution: res, antialias: true });
    if (!this.staticSprite) {
      this.staticSprite = new Sprite(tex);
      this.world.addChildAt(this.staticSprite, 0);
    } else {
      const old = this.staticSprite.texture;
      this.staticSprite.texture = tex;
      old.destroy(true);
    }
    this.staticSprite.position.set(frame.x, frame.y);
    this.staticRes = res;
  }

  private makeShadow(scale: number): Sprite {
    const s = new Sprite(this.shadowTex);
    s.anchor.set(0.5);
    s.scale.set(scale);
    return s;
  }

  // ---------------------------------------------------------------- furniture

  /** Can a cabinet of `kind` stand at `tile`? (physical check only) */
  checkPlace(kind: CabinetKind, tile: Tile): PlaceResult {
    const geo = CABINETS[kind];
    const f: Footprint = { gx: tile.gx, gy: tile.gy, w: geo.w, d: geo.d };
    if (tile.gx < 0 || tile.gy < 0 || tile.gx + geo.w > this.size.cols || tile.gy + geo.d > this.size.rows) return { ok: false, reason: 'outside' };
    if (!this.grid.canPlace(f)) return { ok: false, reason: 'occupied' };
    const a = this.avatar.tile;
    if (a.gx >= f.gx && a.gx < f.gx + f.w && a.gy >= f.gy && a.gy < f.gy + f.d) return { ok: false, reason: 'avatar' };
    return { ok: true };
  }

  /** `force` skips the avatar check (syncing state that was validated when it was placed). */
  placeCabinet(spec: CabinetSpec, devices: readonly RoomDeviceSpec[] = [], force = false): PlaceResult {
    if (this.cabinets.has(spec.id)) return { ok: false, reason: 'duplicate' };
    const check = this.checkPlace(spec.kind, spec);
    if (!check.ok && !(force && check.reason === 'avatar')) return check;
    const geo = CABINETS[spec.kind];
    this.grid.set({ gx: spec.gx, gy: spec.gy, w: geo.w, d: geo.d }, true);
    const sprite = new Sprite();
    const p = isoToScreen(spec.gx, spec.gy);
    sprite.position.set(p.x, p.y);
    sprite.zIndex = depthOf(spec.gx, spec.gy, geo.w, geo.d);
    const shadow = this.makeShadow(0.95);
    const c = isoToScreen(spec.gx + geo.w / 2 + 0.12, spec.gy + geo.d / 2 + 0.12);
    shadow.position.set(c.x, c.y);
    const risers = new Graphics();
    risers.zIndex = sprite.zIndex + 0.005;
    const entry: CabinetEntry = { spec, devices: [], sprite, shadow, texture: null, risers, key: '' };
    this.cabinets.set(spec.id, entry);
    this.objects.addChild(sprite, risers);
    this.shadows.addChild(shadow);
    for (const d of devices) this.mountDevice(spec.id, d);
    this.rebakeCabinet(entry);
    // Walk path may now be blocked - re-plan.
    this.replanWalk();
    return { ok: true };
  }

  placeRack(id: string, tile: Tile, label?: string): PlaceResult {
    return this.placeCabinet({ id, kind: 'rack', gx: tile.gx, gy: tile.gy, ...(label ? { label } : {}) });
  }

  /** Standalone generic switch on a low stand. */
  placeSwitch(id: string, tile: Tile, opts: { tagColor?: number; label?: string } = {}): PlaceResult {
    const r = this.placeCabinet({ id: `${id}-stand`, kind: 'stand', gx: tile.gx, gy: tile.gy });
    if (!r.ok) return r;
    return this.mountDevice(`${id}-stand`, { id, kind: 'switch', u: 1, heightU: 1, ...opts });
  }

  removeCabinet(id: string): void {
    const e = this.cabinets.get(id);
    if (!e) return;
    for (const d of [...e.devices]) this.unmountDevice(d.id);
    const geo = CABINETS[e.spec.kind];
    this.grid.set({ gx: e.spec.gx, gy: e.spec.gy, w: geo.w, d: geo.d }, false);
    e.sprite.destroy();
    e.shadow.destroy();
    e.risers.destroy();
    e.texture?.destroy(true);
    this.cabinets.delete(id);
    if (this.highlighted === id) this.setHighlightedCabinet(null);
    this.cablesDirty = true;
  }

  /**
   * Make the room show exactly these cabinets / devices / cables (diffed: only changed cabinets are re-baked,
   * cable geometry is rebuilt once). Used by the Sandbox screen to mirror the session state.
   */
  syncContents(c: RoomContents): void {
    const want = new Map(c.cabinets.map((x) => [x.spec.id, x]));
    for (const id of [...this.cabinets.keys()]) {
      const e = this.cabinets.get(id)!;
      const w = want.get(id);
      if (!w || w.spec.gx !== e.spec.gx || w.spec.gy !== e.spec.gy || w.spec.kind !== e.spec.kind) this.removeCabinet(id);
    }
    for (const w of c.cabinets) {
      const key = JSON.stringify(w.devices);
      const e = this.cabinets.get(w.spec.id);
      if (!e) {
        this.placeCabinet(w.spec, w.devices, true);
        const ne = this.cabinets.get(w.spec.id);
        if (ne) ne.key = key;
      } else if (e.key !== key) {
        for (const d of e.devices) this.deviceOwner.delete(d.id);
        e.devices = [];
        for (const d of w.devices) {
          if (canMount(e.spec.kind, e.devices, d)) {
            e.devices.push(d);
            this.deviceOwner.set(d.id, e.spec.id);
          }
        }
        e.key = key;
        this.rebakeCabinet(e);
      }
    }
    const cableKey = (x: RoomCableSpec): string => `${x.id}|${x.from.deviceId}:${x.from.port}|${x.to.deviceId}:${x.to.port}`;
    const wantCables = new Map(c.cables.map((x) => [x.id, x]));
    for (const id of [...this.cables.keys()]) {
      const w = wantCables.get(id);
      if (!w || cableKey(w) !== cableKey(this.cables.get(id)!.spec)) this.disconnect(id);
    }
    for (const x of c.cables) if (!this.cables.has(x.id)) this.connect(x);
    this.cablesDirty = true;
  }

  /** Mount a server/switch into a cabinet. `u` <= 0 = first free slot. */
  mountDevice(cabinetId: string, dev: RoomDeviceSpec): PlaceResult {
    const e = this.cabinets.get(cabinetId);
    if (!e) return { ok: false, reason: 'unknown' };
    if (this.deviceOwner.has(dev.id)) return { ok: false, reason: 'duplicate' };
    let d = dev;
    if (d.u <= 0) {
      const u = firstFreeU(e.spec.kind, e.devices, d.heightU);
      if (u === null) return { ok: false, reason: 'slot' };
      d = { ...d, u };
    }
    if (!canMount(e.spec.kind, e.devices, d)) return { ok: false, reason: 'slot' };
    e.devices.push(d);
    this.deviceOwner.set(d.id, cabinetId);
    if (e.texture) this.rebakeCabinet(e);
    return { ok: true };
  }

  /** Convenience: server of `heightU` units into the first free slot (or at `u`). */
  addServer(rackId: string, server: { id: string; heightU?: number; u?: number; tagColor?: number; label?: string }): PlaceResult {
    const { id, heightU = 2, u = 0, ...rest } = server;
    return this.mountDevice(rackId, { id, kind: 'server', u, heightU, ...rest });
  }

  unmountDevice(deviceId: string): void {
    const cabId = this.deviceOwner.get(deviceId);
    if (!cabId) return;
    for (const [id, c] of this.cables) if (c.spec.from.deviceId === deviceId || c.spec.to.deviceId === deviceId) this.disconnect(id);
    const e = this.cabinets.get(cabId)!;
    e.devices = e.devices.filter((d) => d.id !== deviceId);
    this.deviceOwner.delete(deviceId);
    this.rebakeCabinet(e);
  }

  private rebakeCabinet(e: CabinetEntry): void {
    const g = new Graphics();
    drawCabinet(g, e.spec.kind, e.devices);
    const b = g.getLocalBounds();
    const frame = new Rectangle(Math.floor(b.x) - 2, Math.floor(b.y) - 2, Math.ceil(b.width) + 4, Math.ceil(b.height) + 4);
    const tex = this.renderer.generateTexture({ target: g, frame, resolution: FURNITURE_RES, antialias: true });
    g.destroy();
    e.texture?.destroy(true);
    e.texture = tex;
    e.sprite.texture = tex;
    e.sprite.anchor.set(-frame.x / frame.width, -frame.y / frame.height);
    this.cablesDirty = true;
  }

  // ---------------------------------------------------------------- cables (bundles, UX §12.2)

  connect(spec: RoomCableSpec): PlaceResult {
    if (this.cables.has(spec.id)) return { ok: false, reason: 'duplicate' };
    const a = this.portWorld(spec.from.deviceId, spec.from.port);
    const b = this.portWorld(spec.to.deviceId, spec.to.port);
    if (!a || !b) return { ok: false, reason: 'unknown' };
    this.cables.set(spec.id, this.cableEntry(spec, a, b));
    this.cablesDirty = true;
    return { ok: true };
  }

  private cableEntry(spec: RoomCableSpec, a: { p: P; cabinet: CabinetEntry }, b: { p: P; cabinet: CabinetEntry }): CableEntry {
    const points = devicePath(a.cabinet.spec, a.p, b.cabinet.spec, b.p);
    const polyline = flatten(points);
    return { spec, cabA: a.cabinet.spec.id, cabB: b.cabinet.spec.id, path: { spec: { id: spec.id }, polyline, points, length: polyLength(points) } };
  }

  disconnect(id: string): void {
    if (!this.cables.delete(id)) return;
    this.cablesDirty = true;
  }

  private portWorld(deviceId: string, port: number): { p: P; cabinet: CabinetEntry } | null {
    const cabId = this.deviceOwner.get(deviceId);
    const cab = cabId ? this.cabinets.get(cabId) : undefined;
    const dev = cab?.devices.find((d) => d.id === deviceId);
    if (!cab || !dev) return null;
    return { p: devicePortPoint(cab.spec, dev, port), cabinet: cab };
  }

  /** Rebuild cable paths, risers and bundles after any cabling / furniture change. */
  private rebuildCables(): void {
    this.cablesDirty = false;
    // Re-resolve endpoints (devices may have moved); drop cables whose ends vanished.
    for (const [id, c] of [...this.cables]) {
      const a = this.portWorld(c.spec.from.deviceId, c.spec.from.port);
      const b = this.portWorld(c.spec.to.deviceId, c.spec.to.port);
      if (!a || !b) this.cables.delete(id);
      else this.cables.set(id, this.cableEntry(c.spec, a, b));
    }
    // Risers per cabinet: port -> edge -> top (only cables that leave the cabinet go to the top).
    for (const e of this.cabinets.values()) e.risers.clear();
    for (const c of this.cables.values()) {
      for (const [cabId, port, leaves] of [
        [c.cabA, c.path.points[0]!, c.cabA !== c.cabB],
        [c.cabB, c.path.points[c.path.points.length - 1]!, c.cabA !== c.cabB],
      ] as const) {
        const e = this.cabinets.get(cabId);
        if (!e) continue;
        const edge = faceEdgePoint(e.spec, port);
        const g = e.risers.moveTo(port.x, port.y).lineTo(edge.x, edge.y);
        if (leaves) {
          const top = riserTop(e.spec);
          g.lineTo(top.x, top.y);
        }
      }
      if (c.cabA === c.cabB) {
        const e = this.cabinets.get(c.cabA)!;
        const p = c.path.points;
        e.risers.moveTo(p[1]!.x, p[1]!.y).lineTo(p[2]!.x, p[2]!.y);
      }
    }
    for (const e of this.cabinets.values()) {
      e.risers.stroke({ color: OUTLINE, width: 2.6, cap: 'round', join: 'round' });
      // Neutral core over the outline (redraw the same path cheaply by cloning commands is not available -> second pass).
    }
    this.drawRiserCores();
    // Bundles per cabinet pair.
    const groups = new Map<string, { a: string; b: string; ids: string[] }>();
    for (const c of this.cables.values()) {
      if (c.cabA === c.cabB) continue;
      const k = pairKey(c.cabA, c.cabB);
      const g = groups.get(k) ?? { a: c.cabA < c.cabB ? c.cabA : c.cabB, b: c.cabA < c.cabB ? c.cabB : c.cabA, ids: [] };
      g.ids.push(c.spec.id);
      groups.set(k, g);
    }
    for (const [k, b] of this.bundles) {
      if (!groups.has(k)) {
        b.gfx.destroy();
        b.badge?.destroy();
        this.bundles.delete(k);
      }
    }
    for (const [k, g] of groups) {
      const ca = this.cabinets.get(g.a)!.spec;
      const cb = this.cabinets.get(g.b)!.spec;
      const route = [riserTop(ca), ...trayRoute(ca, cb), riserTop(cb)];
      let b = this.bundles.get(k);
      if (!b) {
        b = { key: k, cabA: g.a, cabB: g.b, cables: g.ids, route, flat: flatten(route), gfx: new Graphics(), badge: null };
        this.bundles.set(k, b);
        this.overhead.addChild(b.gfx);
      } else {
        b = { ...b, cables: g.ids, route, flat: flatten(route) };
        this.bundles.set(k, b);
      }
      this.drawBundle(b);
    }
    this.simDirty = true;
  }

  private drawRiserCores(): void {
    // Second pass with the neutral core colour (outline first, then core -> cartoon cable look).
    const tmp = new Map<string, P[][]>();
    for (const c of this.cables.values()) {
      for (const [cabId, port, leaves] of [
        [c.cabA, c.path.points[0]!, c.cabA !== c.cabB],
        [c.cabB, c.path.points[c.path.points.length - 1]!, c.cabA !== c.cabB],
      ] as const) {
        const e = this.cabinets.get(cabId);
        if (!e) continue;
        const seg = [port, faceEdgePoint(e.spec, port)];
        if (leaves) seg.push(riserTop(e.spec));
        const list = tmp.get(cabId) ?? [];
        list.push(seg);
        tmp.set(cabId, list);
      }
      if (c.cabA === c.cabB) {
        const list = tmp.get(c.cabA) ?? [];
        list.push([c.path.points[1]!, c.path.points[2]!]);
        tmp.set(c.cabA, list);
      }
    }
    for (const [cabId, segs] of tmp) {
      const g = this.cabinets.get(cabId)!.risers;
      for (const seg of segs) {
        g.moveTo(seg[0]!.x, seg[0]!.y);
        for (let i = 1; i < seg.length; i++) g.lineTo(seg[i]!.x, seg[i]!.y);
      }
      g.stroke({ color: CABLE.body, width: 1.1, cap: 'round', join: 'round' });
    }
  }

  private drawBundle(b: BundleEntry): void {
    const g = b.gfx;
    g.clear();
    const pts = b.route;
    const path = (): Graphics => {
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
      return g;
    };
    // Little hanging tray under the bundle (between the two risers).
    const tray = pts.slice(1, -1);
    if (tray.length >= 2) {
      g.moveTo(tray[0]!.x, tray[0]!.y + 3);
      for (let i = 1; i < tray.length; i++) g.lineTo(tray[i]!.x, tray[i]!.y + 3);
      g.stroke({ color: DECOR.trayDark, width: 7, cap: 'round', join: 'round' });
      g.moveTo(tray[0]!.x, tray[0]!.y + 2);
      for (let i = 1; i < tray.length; i++) g.lineTo(tray[i]!.x, tray[i]!.y + 2);
      g.stroke({ color: DECOR.tray, width: 4.5, cap: 'round', join: 'round' });
    }
    const hovered = this.hoveredBundle === b.key;
    const n = b.cables.length;
    if (hovered && n > 1) {
      // Fan the bundle out into its cables (only this one).
      const spread = Math.min(3, 18 / n);
      for (let i = 0; i < n; i++) {
        const dy = (i - (n - 1) / 2) * spread;
        g.moveTo(pts[0]!.x, pts[0]!.y + dy);
        for (let k = 1; k < pts.length; k++) g.lineTo(pts[k]!.x, pts[k]!.y + dy);
        g.stroke({ color: OUTLINE, width: 2.4, cap: 'round', join: 'round' });
        g.moveTo(pts[0]!.x, pts[0]!.y + dy);
        for (let k = 1; k < pts.length; k++) g.lineTo(pts[k]!.x, pts[k]!.y + dy);
        g.stroke({ color: CABLE.body, width: 1, cap: 'round', join: 'round' });
      }
    } else {
      const w = bundleWidth(n);
      if (hovered) path().stroke({ color: 0xffffff, width: w + 7, alpha: 0.7, cap: 'round', join: 'round' });
      path().stroke({ color: OUTLINE, width: w + 2.5, cap: 'round', join: 'round' });
      path().stroke({ color: CABLE.body, width: w, cap: 'round', join: 'round' });
    }
    // Count badge (x N) at zoom >= 1 (UX §12.2).
    const showBadge = n > 1 && this.viewScale >= 1;
    if (showBadge) {
      const mid = pts[Math.floor(pts.length / 2)]!;
      if (!b.badge) {
        b.badge = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fontWeight: '800', fill: OUTLINE, stroke: { color: 0xffffff, width: 3 } }, resolution: 3 });
        b.badge.anchor.set(0.5, 1);
        this.overhead.addChild(b.badge);
      }
      b.badge.text = `×${n}`;
      b.badge.position.set(mid.x, mid.y - 5);
    } else if (b.badge) {
      b.badge.destroy();
      b.badge = null;
    }
  }

  /** Remove everything except the avatar. */
  clear(): void {
    for (const id of [...this.cabinets.keys()]) this.removeCabinet(id);
    this.source = null;
    this.setGhost(null);
  }

  contents(): RoomContents {
    return {
      cabinets: [...this.cabinets.values()].map((e) => ({ spec: e.spec, devices: [...e.devices] })),
      cables: [...this.cables.values()].map((c) => c.spec),
    };
  }

  /** Cables of the room by id (for tooltips / lists). */
  cableSpec(id: string): RoomCableSpec | undefined {
    return this.cables.get(id)?.spec;
  }

  /** Per-link traffic (TrafficSource contract shared with the datacenter scene). null = idle cables. */
  setTrafficSource(source: TrafficSource | null): void {
    this.source = source;
    this.traffic = new Map();
  }

  /**
   * BMC cables currently carrying the game-scope "ISO transfer" (remote ESX install, UX §15.4): drawn as a grey
   * dashed animation, never as VCF traffic dots.
   */
  setBmcTransfers(cableIds: Iterable<string>): void {
    this.bmcActive = new Set(cableIds);
    if (this.bmcActive.size === 0) this.bmcFx.clear();
  }

  /** Show only one traffic type (others at 15 % alpha); null = all (UX §12.5 legend filter). */
  setTrafficFilter(type: TrafficType | null): void {
    this.filter = type;
  }

  /** Traffic types with packets on screen right now (legend chip). */
  get activeTypes(): ReadonlySet<TrafficType> {
    return this.active;
  }

  get bmcTransferActive(): boolean {
    return this.bmcActive.size > 0;
  }

  trafficFor(id: string): LinkTraffic | undefined {
    return this.traffic.get(id);
  }

  // ---------------------------------------------------------------- picking

  tileAtWorld(wx: number, wy: number): Tile | null {
    return worldToTile(this.size, wx, wy);
  }

  /** Front-most cabinet whose sprite covers the world point. */
  cabinetAtWorld(wx: number, wy: number): CabinetSpec | null {
    let best: CabinetEntry | null = null;
    for (const e of this.cabinets.values()) {
      const s = e.sprite;
      const x0 = s.x - s.anchor.x * s.width;
      const y0 = s.y - s.anchor.y * s.height;
      if (wx >= x0 && wx <= x0 + s.width && wy >= y0 && wy <= y0 + s.height && (!best || s.zIndex > best.sprite.zIndex)) best = e;
    }
    return best?.spec ?? null;
  }

  /** Bundle under a world point (hover = fan out + tooltip). */
  bundleAtWorld(wx: number, wy: number, tolerance: number): BundleInfo | null {
    let best: BundleEntry | null = null;
    let bestD = tolerance;
    for (const b of this.bundles.values()) {
      const d = distanceToPolyline(b.flat, wx, wy);
      if (d <= bestD) {
        bestD = d;
        best = b;
      }
    }
    if (!best) return null;
    return { key: best.key, cables: best.cables.map((id) => this.cables.get(id)?.spec).filter((x): x is RoomCableSpec => !!x) };
  }

  setHoveredBundle(key: string | null): void {
    if (key === this.hoveredBundle) return;
    const prev = this.hoveredBundle ? this.bundles.get(this.hoveredBundle) : undefined;
    this.hoveredBundle = key;
    if (prev) this.drawBundle(prev);
    const next = key ? this.bundles.get(key) : undefined;
    if (next) this.drawBundle(next);
  }

  /** World rect of a cabinet sprite (camera flight target). */
  cabinetRect(id: string): { x: number; y: number; width: number; height: number } | null {
    const e = this.cabinets.get(id);
    if (!e) return null;
    const s = e.sprite;
    return { x: s.x - s.anchor.x * s.width, y: s.y - s.anchor.y * s.height, width: s.width, height: s.height };
  }

  /** Ids of cabinets in tab order (back to front). */
  cabinetIds(kind?: CabinetKind): string[] {
    return [...this.cabinets.values()]
      .filter((e) => !kind || e.spec.kind === kind)
      .sort((a, b) => a.sprite.zIndex - b.sprite.zIndex)
      .map((e) => e.spec.id);
  }

  /**
   * Hover / focus highlight of an interactive object: thick light rim + dark outline around the silhouette and a
   * magnifier icon above it (UX §7.2). Drawn only on change.
   */
  setHighlightedCabinet(id: string | null): void {
    if (id === this.highlighted) return;
    this.highlighted = id;
    const g = this.highlightFx;
    g.clear();
    const e = id ? this.cabinets.get(id) : undefined;
    if (!e) {
      g.visible = false;
      this.magnifier.visible = false;
      return;
    }
    const geo = CABINETS[e.spec.kind];
    const { gx, gy } = e.spec;
    const H = geo.heightPx;
    const c00 = isoToScreen(gx, gy);
    const c10 = isoToScreen(gx + geo.w, gy);
    const c11 = isoToScreen(gx + geo.w, gy + geo.d);
    const c01 = isoToScreen(gx, gy + geo.d);
    const sil = [up(c00, H), up(c10, H), c10, c11, c01, up(c01, H)].flatMap((p) => [p.x, p.y]);
    g.poly(sil).stroke({ color: 0xffffff, width: 6, join: 'round', alpha: 0.95 });
    g.poly(sil).stroke({ color: OUTLINE, width: 2, join: 'round' });
    g.zIndex = e.sprite.zIndex + 0.004;
    g.visible = true;
    const top = up(isoToScreen(gx + geo.w / 2, gy + geo.d / 2), H + 8);
    this.magnifier.position.set(top.x, top.y);
    this.magnifier.visible = true;
  }

  setHoverTile(tile: Tile | null): void {
    this.hoverTile = tile;
  }

  /** Placement preview: translucent object + green/red footprint. null hides it. */
  setGhost(ghost: { kind: GhostKind; tile: Tile } | null): void {
    if (!ghost) {
      this.ghost = null;
      this.ghostSprite.visible = false;
      this.ghostShadow.visible = false;
      return;
    }
    const valid = this.checkPlace(ghost.kind, ghost.tile).ok;
    this.ghost = { ...ghost, valid };
    const gt = this.ghostTexture(ghost.kind);
    const geo = CABINETS[ghost.kind];
    const p = isoToScreen(ghost.tile.gx, ghost.tile.gy);
    this.ghostSprite.texture = gt.tex;
    this.ghostSprite.anchor.set(gt.ax, gt.ay);
    this.ghostSprite.position.set(p.x, p.y);
    this.ghostSprite.zIndex = depthOf(ghost.tile.gx, ghost.tile.gy, geo.w, geo.d) + 0.02;
    this.ghostSprite.tint = valid ? 0xffffff : 0xff9a9a;
    this.ghostSprite.visible = true;
    const c = isoToScreen(ghost.tile.gx + geo.w / 2 + 0.12, ghost.tile.gy + geo.d / 2 + 0.12);
    this.ghostShadow.position.set(c.x, c.y);
    this.ghostShadow.visible = true;
  }

  private ghostTexture(kind: GhostKind): { tex: Texture; ax: number; ay: number } {
    let t = this.ghostTextures.get(kind);
    if (!t) {
      const g = new Graphics();
      drawCabinet(g, kind, kind === 'stand' ? [{ id: 'ghost', kind: 'switch', u: 1, heightU: 1 }] : []);
      const b = g.getLocalBounds();
      const frame = new Rectangle(Math.floor(b.x) - 2, Math.floor(b.y) - 2, Math.ceil(b.width) + 4, Math.ceil(b.height) + 4);
      const tex = this.renderer.generateTexture({ target: g, frame, resolution: 2, antialias: true });
      g.destroy();
      t = { tex, ax: -frame.x / frame.width, ay: -frame.y / frame.height };
      this.ghostTextures.set(kind, t);
    }
    return t;
  }

  // ---------------------------------------------------------------- avatar

  /** Walk to a tile (or next to it when occupied). Returns the tile it will reach, or null. */
  walkTo(tile: Tile): Tile | null {
    const r = nearestReachable(this.grid, this.avatar.tile, tile);
    if (!r) return null;
    this.avatar.setPath(r.path);
    this.markerMs = 0;
    if (r.path.length === 0) this.emitArrive(r.tile);
    return r.tile;
  }

  /** Walk in front of a cabinet (its +gy side). */
  walkToCabinet(id: string): Tile | null {
    const e = this.cabinets.get(id);
    if (!e) return null;
    const geo = CABINETS[e.spec.kind];
    return this.walkTo({ gx: e.spec.gx, gy: Math.min(this.size.rows - 1, e.spec.gy + geo.d) });
  }

  /** Called whenever the avatar finishes a walk. Returns unsubscribe. */
  onAvatarArrive(fn: (tile: Tile) => void): () => void {
    this.arriveListeners.add(fn);
    return () => this.arriveListeners.delete(fn);
  }

  /** Teleport (no walk), e.g. when the scene is reset. */
  resetAvatar(tile: Tile): void {
    this.avatar.stop();
    this.avatar.x = tile.gx + 0.5;
    this.avatar.y = tile.gy + 0.5;
    this.syncAvatar(0);
  }

  private emitArrive(tile: Tile): void {
    for (const fn of this.arriveListeners) fn(tile);
  }

  private replanWalk(): void {
    const dest = this.avatar.destination;
    if (!dest) return;
    // Continue from the next tile centre to keep tile-by-tile movement.
    const r = nearestReachable(this.grid, this.avatar.tile, dest);
    this.avatar.setPath(r ? r.path : []);
  }

  private syncAvatar(timeMs: number): void {
    const m = this.avatar;
    const p = isoToScreen(m.x, m.y);
    const walking = m.walking;
    const frames = m.facing.startsWith('front') ? this.avatarTex.frames.front : this.avatarTex.frames.back;
    const flip = m.facing === 'front-left' || m.facing === 'back-left';
    let bob: number;
    if (walking) {
      const phase = Math.floor(m.walkMs / 140) % 4;
      this.avatarSprite.texture = phase === 0 ? frames.stepA : phase === 2 ? frames.stepB : frames.stand;
      bob = phase % 2 === 1 ? -1.5 : 0;
    } else {
      this.avatarSprite.texture = frames.stand;
      bob = Math.sin(timeMs / 420) * 1.2 - 1.2;
    }
    this.avatarSprite.scale.x = flip ? -1 : 1;
    this.avatarSprite.position.set(p.x, p.y + bob);
    this.avatarSprite.zIndex = m.x + m.y;
    this.avatarShadow.position.set(p.x, p.y);
  }

  // ---------------------------------------------------------------- frame

  private idleMs = 0;

  update(snapshot: GameSnapshot, realDeltaMs: number): void {
    const real = Math.min(realDeltaMs, MAX_REAL_DELTA_MS);
    // Avatar walks in real time (UI feedback, not game state).
    const wasWalking = this.avatar.walking;
    const done = this.avatar.step(real);
    this.idleMs += real;
    this.syncAvatar(this.idleMs);
    if (wasWalking && done) this.emitArrive(this.avatar.tile);

    // Traffic + packets (game time; paused game freezes packets).
    const now = snapshot.clock.gameTimeMs;
    const gameDelta = this.lastGameTimeMs === null ? 0 : Math.max(0, now - this.lastGameTimeMs);
    this.lastGameTimeMs = now;
    this.traffic = this.source ? this.source.sample(now) : new Map();
    if (this.cablesDirty) this.rebuildCables();
    if (this.simDirty) this.rebuildSim();
    if (this.sim) {
      const game = Math.min(gameDelta, MAX_REAL_DELTA_MS * Math.max(1, snapshot.clock.speed));
      this.sim.step(game, real, this.traffic, snapshot.clock.speed);
      this.syncPackets();
    }
    this.active.clear();
    for (const [id, t] of this.traffic) if (this.cables.has(id)) for (const m of t.mix) if (m.gbps > 0) this.active.add(m.type);
    this.drawBmcTransfers(real, gameDelta > 0);
    this.drawFloorFx(real);
  }

  private rebuildSim(): void {
    this.simDirty = false;
    this.packetView?.destroy();
    this.packetView = null;
    this.sim = null;
    this.shownPackets = 0;
    const paths = [...this.cables.values()].map((c) => c.path);
    if (paths.length === 0) return;
    this.sim = new PacketSim(paths, ROOM_PACKETS);
    const view = new ParticleContainer<Particle>({
      texture: this.dots.base,
      dynamicProperties: { position: true, color: true, vertex: false, rotation: false, uvs: true },
    });
    const b = this.bounds;
    view.boundsArea = new Rectangle(b.x - 100, b.y - 100, b.width + 200, b.height + 300);
    this.packetPool = this.sim.packets.map(
      () => new Particle({ texture: this.dots.shapes.management, anchorX: 0.5, anchorY: 0.5, scaleX: DOT_SCALE, scaleY: DOT_SCALE }),
    );
    this.packetView = view;
    this.world.addChild(view);
    // Magnifier stays on top of the packets.
    this.world.addChild(this.magnifier);
  }

  private syncPackets(): void {
    const sim = this.sim;
    const view = this.packetView;
    if (!sim || !view) return;
    const n = sim.count;
    const children = view.particleChildren;
    if (n !== this.shownPackets) {
      children.length = n;
      for (let i = 0; i < n; i++) children[i] = this.packetPool[i]!;
      this.shownPackets = n;
      view.update();
    }
    const f = this.filter;
    for (let i = 0; i < n; i++) {
      const p = sim.packets[i]!;
      const s = this.packetPool[i]!;
      s.x = p.x;
      s.y = p.y;
      const shape: DotShape = p.falling ? 'nfs' : p.type;
      const tex = this.dots.shapes[shape];
      if (s.texture !== tex) s.texture = tex;
      s.tint = p.color;
      s.alpha = f && p.type !== f ? p.alpha * 0.15 : p.alpha;
    }
  }

  /** Grey dashed "ISO transfer" along BMC cables (game scope) – ~11 Hz redraw, only while some is active. */
  private drawBmcTransfers(realMs: number, running: boolean): void {
    if (this.bmcActive.size === 0) return;
    this.dashMs += realMs;
    if (this.dashMs < DASH_FRAME_MS) return;
    this.dashMs = 0;
    if (running) this.dashPhase = (this.dashPhase + 2) % 12;
    const segs: number[] = [];
    for (const id of this.bmcActive) {
      const c = this.cables.get(id);
      if (!c) continue;
      const pts = c.path.points;
      // Dashes of 6 px with 6 px gaps along the whole path, shifted by the phase.
      let s0 = -this.dashPhase;
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const bb = pts[i]!;
        const len = Math.hypot(bb.x - a.x, bb.y - a.y);
        if (len === 0) continue;
        while (s0 < acc + len) {
          const t0 = Math.max(s0, acc) - acc;
          const t1 = Math.min(s0 + 6, acc + len) - acc;
          if (t1 > t0) segs.push(a.x + ((bb.x - a.x) * t0) / len, a.y + ((bb.y - a.y) * t0) / len, a.x + ((bb.x - a.x) * t1) / len, a.y + ((bb.y - a.y) * t1) / len);
          if (s0 + 6 > acc + len) break;
          s0 += 12;
        }
        acc += len;
      }
    }
    const g = this.bmcFx;
    g.clear();
    for (const [color, width] of [[OUTLINE, 3.4], [0xb8b4c8, 1.8]] as const) {
      for (let i = 0; i < segs.length; i += 4) g.moveTo(segs[i]!, segs[i + 1]!).lineTo(segs[i + 2]!, segs[i + 3]!);
      g.stroke({ color, width, cap: 'round' });
    }
  }

  get livePackets(): number {
    return this.sim?.count ?? 0;
  }

  /** Hover tile + ghost footprint (redrawn only on change) and the pulsing walk target. */
  private drawFloorFx(realMs: number): void {
    const gh = this.ghost;
    const ht = this.hoverTile;
    const key = `${ht ? `${ht.gx},${ht.gy}` : '-'}|${gh ? `${gh.kind}${gh.tile.gx},${gh.tile.gy}${gh.valid}` : '-'}`;
    if (key !== this.fxKey) {
      this.fxKey = key;
      const g = this.floorFx;
      g.clear();
      if (gh) {
        const geo = CABINETS[gh.kind];
        const pts = diamond(gh.tile.gx, gh.tile.gy, geo.w, geo.d).flatMap((p) => [p.x, p.y]);
        g.poly(pts).fill({ color: gh.valid ? 0x4cc38a : BLOCKED_TILE, alpha: 0.45 }).stroke({ color: gh.valid ? 0x2e9e6a : BLOCKED_TILE, width: 2 });
      } else if (ht) {
        const pts = diamond(ht.gx, ht.gy, 1, 1, -0.04).flatMap((p) => [p.x, p.y]);
        g.poly(pts).fill({ color: HOVER_TILE, alpha: 0.45 }).stroke({ color: OUTLINE, width: 1.5, alpha: 0.5 });
      }
    }
    const m = this.markerFx;
    const dest = this.avatar.destination;
    m.visible = dest !== null;
    if (dest) {
      if (this.markerMs === 0) {
        m.clear();
        const pts = diamond(dest.gx, dest.gy, 1, 1, -0.12).flatMap((p) => [p.x, p.y]);
        m.poly(pts).stroke({ color: TARGET_TILE, width: 2.5 });
        const c = isoToScreen(dest.gx + 0.5, dest.gy + 0.5);
        m.ellipse(c.x, c.y, 5, 2.5).fill({ color: TARGET_TILE });
      }
      this.markerMs += realMs;
      m.alpha = 0.55 + 0.45 * Math.sin(this.markerMs / 160);
    }
  }
}
