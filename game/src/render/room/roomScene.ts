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
import { Container, Graphics, Particle, ParticleContainer, Rectangle, Sprite, type Renderer, type Texture } from 'pixi.js';
import type { GameSnapshot } from '../../engine';
import { distanceToPolyline } from '../geom/bezier';
import { isoToScreen } from '../iso';
import { DEFAULT_PACKET_SIM, PacketSim } from '../traffic/packetSim';
import type { LinkTraffic, TrafficSource } from '../traffic/trafficModel';
import { createAvatarTextures, type AvatarTextures } from './avatarArt';
import { AvatarMotion } from './avatarMotion';
import { diamond } from './draw';
import { CABINETS, canMount, drawCabinet, firstFreeU, devicePortPoint, type CabinetKind, type CabinetSpec, type RoomDeviceSpec } from './furniture';
import { BLOCKED_TILE, HOVER_TILE, OUTLINE, SHADOW, TARGET_TILE } from './palette';
import { buildRoomCable, RoomCableView, type RoomCableSpec } from './roomCables';
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

/** Cartoon packet "pellet": white core with dark rim (tinted per traffic type, readable on light floors). */
function createPelletTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(6, 6, 4.2).fill({ color: 0xffffff, alpha: 0.35 });
  g.circle(6, 6, 3).fill({ color: 0xffffff }).stroke({ color: 0x8a86a8, width: 1.2 });
  const t = renderer.generateTexture({ target: g, resolution: 3, antialias: true });
  g.destroy();
  return t;
}

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
  private readonly pelletTex: Texture;
  private packetView: ParticleContainer<Particle> | null = null;
  private packetPool: Particle[] = [];
  private shownPackets = 0;
  private sim: PacketSim | null = null;
  private simDirty = true;

  private readonly cabinets = new Map<string, CabinetEntry>();
  private readonly deviceOwner = new Map<string, string>();
  private readonly cables = new Map<string, RoomCableView>();
  private source: TrafficSource | null = null;
  private traffic: ReadonlyMap<string, LinkTraffic> = new Map();
  private lastGameTimeMs: number | null = null;
  private hoverTile: Tile | null = null;
  private hoveredCable: string | null = null;
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
    this.pelletTex = createPelletTexture(renderer);
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
    this.world.addChild(this.shadows, this.floorFx, this.markerFx, this.objects);
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

  placeCabinet(spec: CabinetSpec, devices: readonly RoomDeviceSpec[] = []): PlaceResult {
    if (this.cabinets.has(spec.id)) return { ok: false, reason: 'duplicate' };
    const check = this.checkPlace(spec.kind, spec);
    if (!check.ok) return check;
    const geo = CABINETS[spec.kind];
    this.grid.set({ gx: spec.gx, gy: spec.gy, w: geo.w, d: geo.d }, true);
    const sprite = new Sprite();
    const p = isoToScreen(spec.gx, spec.gy);
    sprite.position.set(p.x, p.y);
    sprite.zIndex = depthOf(spec.gx, spec.gy, geo.w, geo.d);
    const shadow = this.makeShadow(0.95);
    const c = isoToScreen(spec.gx + geo.w / 2 + 0.12, spec.gy + geo.d / 2 + 0.12);
    shadow.position.set(c.x, c.y);
    const entry: CabinetEntry = { spec, devices: [], sprite, shadow, texture: null };
    this.cabinets.set(spec.id, entry);
    this.objects.addChild(sprite);
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
    e.texture?.destroy(true);
    this.cabinets.delete(id);
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
    for (const [id, c] of this.cables) if (c.geo.spec.from.deviceId === deviceId || c.geo.spec.to.deviceId === deviceId) this.disconnect(id);
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
  }

  // ---------------------------------------------------------------- cables

  connect(spec: RoomCableSpec): PlaceResult {
    if (this.cables.has(spec.id)) return { ok: false, reason: 'duplicate' };
    const a = this.portWorld(spec.from.deviceId, spec.from.port);
    const b = this.portWorld(spec.to.deviceId, spec.to.port);
    if (!a || !b) return { ok: false, reason: 'unknown' };
    const same = a.cabinet.spec.id === b.cabinet.spec.id;
    // Fan out cables that share a cabinet pair.
    let spread = 0;
    for (const c of this.cables.values()) {
      const ca = this.deviceOwner.get(c.geo.spec.from.deviceId);
      const cb = this.deviceOwner.get(c.geo.spec.to.deviceId);
      if ((ca === a.cabinet.spec.id && cb === b.cabinet.spec.id) || (ca === b.cabinet.spec.id && cb === a.cabinet.spec.id)) spread++;
    }
    const view = new RoomCableView(buildRoomCable(spec, a.p, b.p, same, spread % 6));
    view.view.zIndex = Math.max(a.cabinet.sprite.zIndex, b.cabinet.sprite.zIndex) + 0.01;
    this.cables.set(spec.id, view);
    this.objects.addChild(view.view);
    view.update(undefined, false);
    this.simDirty = true;
    return { ok: true };
  }

  disconnect(id: string): void {
    const c = this.cables.get(id);
    if (!c) return;
    c.view.destroy();
    this.cables.delete(id);
    this.simDirty = true;
  }

  private portWorld(deviceId: string, port: number): { p: { x: number; y: number }; cabinet: CabinetEntry } | null {
    const cabId = this.deviceOwner.get(deviceId);
    const cab = cabId ? this.cabinets.get(cabId) : undefined;
    const dev = cab?.devices.find((d) => d.id === deviceId);
    if (!cab || !dev) return null;
    return { p: devicePortPoint(cab.spec, dev, port), cabinet: cab };
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
      cables: [...this.cables.values()].map((c) => c.geo.spec),
    };
  }

  /** Per-link traffic (TrafficSource contract shared with the datacenter scene). null = idle cables. */
  setTrafficSource(source: TrafficSource | null): void {
    this.source = source;
    this.traffic = new Map();
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

  cableAtWorld(wx: number, wy: number, tolerance: number): RoomCableSpec | null {
    let best: RoomCableSpec | null = null;
    let bestD = tolerance;
    for (const c of this.cables.values()) {
      const d = distanceToPolyline(c.geo.samples, wx, wy);
      if (d <= bestD) {
        bestD = d;
        best = c.geo.spec;
      }
    }
    return best;
  }

  setHoveredCable(id: string | null): void {
    this.hoveredCable = id;
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
    if (this.simDirty) this.rebuildSim();
    if (this.sim) {
      const game = Math.min(gameDelta, MAX_REAL_DELTA_MS * Math.max(1, snapshot.clock.speed));
      this.sim.step(game, real, this.traffic, snapshot.clock.speed);
      this.syncPackets();
    }
    for (const [id, c] of this.cables) c.update(this.traffic.get(id), id === this.hoveredCable);
    this.drawFloorFx(real);
  }

  private rebuildSim(): void {
    this.simDirty = false;
    this.packetView?.destroy();
    this.packetView = null;
    this.sim = null;
    this.shownPackets = 0;
    const paths = [...this.cables.values()].map((c) => c.geo);
    if (paths.length === 0) return;
    this.sim = new PacketSim(paths, ROOM_PACKETS);
    const view = new ParticleContainer<Particle>({
      texture: this.pelletTex,
      dynamicProperties: { position: true, color: true, vertex: false, rotation: false, uvs: false },
    });
    const b = this.bounds;
    view.boundsArea = new Rectangle(b.x - 100, b.y - 100, b.width + 200, b.height + 300);
    this.packetPool = this.sim.packets.map(() => new Particle({ texture: this.pelletTex, anchorX: 0.5, anchorY: 0.5, scaleX: 0.7, scaleY: 0.7 }));
    this.packetView = view;
    this.world.addChild(view);
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
    for (let i = 0; i < n; i++) {
      const p = sim.packets[i]!;
      const s = this.packetPool[i]!;
      s.x = p.x;
      s.y = p.y;
      s.tint = p.color;
      s.alpha = p.alpha;
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
