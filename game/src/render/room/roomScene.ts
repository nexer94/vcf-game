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
import { BitmapText, Container, Graphics, Particle, ParticleContainer, Rectangle, Sprite, Text, type Renderer, type Texture } from 'pixi.js';
import type { GameSnapshot } from '../../engine';
import { distanceToPolyline } from '../geom/bezier';
import { isoToScreen } from '../iso';
import { DEFAULT_PACKET_SIM, PacketSim, polylinePoint, type PacketPath } from '../traffic/packetSim';
import { dominantType, flowWidth, formatGbps, quantize } from '../traffic/flowScale';
import { drawRibbon, ribbonKey, type RibbonStyle } from '../traffic/flowRibbon';
import { FLOW_FONT, ensureFlowFont } from '../traffic/flowFont';
import { loadBand, type LoadBand } from '../traffic/loadStyle';
import type { LinkTraffic, TrafficSource } from '../traffic/trafficModel';
import { TRAFFIC_STYLE, type TrafficType } from '../traffic/trafficTypes';
import { createAvatarTextures, type AvatarTextures } from './avatarArt';
import { AvatarMotion } from './avatarMotion';
import { diamond, up, type P } from './draw';
import { createDotAtlas, type DotShape } from './dotAtlas';
import { cabinetGeometry, canMount, drawCabinet, firstFreeU, devicePortPoint, rackPlateCenter, type CabinetFacing, type CabinetKind, type CabinetSpec, type RoomDeviceSpec } from './furniture';
import { drawAisles, drawGhostFootprint, drawOobSwitch, drawPlacementHints, drawRackFront, type AisleSet, type PlacementHintTile } from './placementFx';
import { OOB_SWITCH_SPOT } from '../../model/roomFixtures';
import { CABLE, DECOR, HOVER_TILE, OUTLINE, SHADOW, TARGET_TILE } from './palette';
import { BUNDLE_Z, bmcWallPath, bundleWidth, devicePath, faceEdgePoint, flatten, pairKey, polyLength, riserTop, trayPoint, trayRoute } from './roomBundles';
import type { PortRef, RoomCableSpec } from './roomCables';
import { depthOf, nearestReachable, Occupancy, worldToTile, type Footprint, type RoomSize, type Tile } from './roomGrid';
import { drawRowTrays, drawStaticRoom, SLAB_H, WALL_H, WALL_T, wallJack } from './roomStatic';
import { DESK, isFixtureId, RoomFixtures, type FixtureId } from './fixtures';

export const DEFAULT_ROOM: RoomSize = { cols: 11, rows: 9 };

export type PlaceResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'duplicate' | 'outside' | 'occupied' | 'avatar' | 'unknown' | 'slot' };

export type GhostKind = CabinetKind;

/** Placement preview of a cabinet. `valid` comes from the caller (engine hints), never from the render layer. */
export interface GhostSpec {
  readonly kind: GhostKind;
  readonly tile: Tile;
  readonly facing?: CabinetFacing;
  /** Rack height in U (24 / 42 / 48). */
  readonly units?: number;
  /** Omitted = the render layer's physical check (demo room only). */
  readonly valid?: boolean;
  /** Facings the engine allows on this tile (drawn as small chevrons). */
  readonly allowed?: readonly CabinetFacing[];
}

/** Placement hints overlay (engine: valid tiles with their allowed facings). */
export interface PlacementHints {
  readonly tiles: readonly PlacementHintTile[];
  /** Facing currently chosen by the player (R rotates). */
  readonly facing: CabinetFacing;
}

/** Snapshot of what is placed (for UI lists / persistence later). */
export interface RoomContents {
  readonly cabinets: readonly { readonly spec: CabinetSpec; readonly devices: readonly RoomDeviceSpec[] }[];
  /** Data cables (VCF traffic). BMC cables go to `bmcLinks`. */
  readonly cables: readonly RoomCableSpec[];
  /** BMC cables (game scope, UX §28.7): drawn as a thin grey dashed wire, never as a flow ribbon. */
  readonly bmcLinks?: readonly BmcLinkSpec[];
}

/**
 * BMC cable of a server (out of VCF scope – game). `peer` = the other end when it is mounted in this room (e.g. a ToR
 * port in the demo); without it the cable runs to the room's pre-installed wall OOB switch.
 */
export interface BmcLinkSpec {
  readonly id: string;
  /** Server BMC port (port -1). */
  readonly server: PortRef;
  readonly peer?: PortRef;
}

interface BmcEntry {
  readonly spec: BmcLinkSpec;
  readonly cab: string;
  readonly points: readonly P[];
  readonly flat: Float32Array;
  readonly length: number;
  /** Overhead part of the path (from the cabinet top on), drawn in the overhead layer. */
  readonly overheadFrom: number;
  phase: number;
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
  /** Flow ribbon on the riser ("stoupačka", Traffic v3) – width = volume of the cabinet's cables. */
  flow: Graphics;
  flowKey: string;
  /** Riser span (bottom-most port edge point -> top / highest port), null = no data cables. */
  riser: P[] | null;
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
  /** Flow ribbon along the tray (Traffic v3): width = summed volume, colour = dominant type. */
  readonly flow: Graphics;
  flowKey: string;
}

export interface BundleInfo {
  readonly key: string;
  readonly cables: readonly RoomCableSpec[];
}

const MAX_REAL_DELTA_MS = 100;
/** Traffic v3 (UX §28.4): log emission, budget 250 live dots, 70 px/s (slowed only by congestion). */
const ROOM_PACKETS = { ...DEFAULT_PACKET_SIM, maxPackets: 400, budget: 250, speedPxPerMs: 0.07 };
/** Flow ribbons + numbers refresh (4 Hz) – ribbons are redrawn only when their quantised key changes. */
const FLOW_REFRESH_MS = 250;
/** Max flow numbers "≈ x Gb/s" in view (UX §28.6 room normal: top 3) and ISO labels; BitmapText pool ≤ 8. */
const TOP_LABELS = 3;
const LABEL_POOL = 8;
/** BMC wire colour (UX §28.7) and square cadence: 1 per 3 s, ISO transfer 1 per 0.5 s (real time, game scope). */
const BMC_GREY = 0x8592a3;
const BMC_PERIOD_MS = 3000;
const BMC_ISO_PERIOD_MS = 500;
const BMC_TRAVEL_MS = 2200;
const BMC_POOL = 96;
/** Top of the wall OOB switch box (drawOobSwitch: z 84 + 14 px). */
const OOB_TOP_Z = 98;
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

/** Base dot scale; × flowScale.dotScale (0.55–0.9) per packet. */
const DOT_SCALE = 0.85;

/** Rack number for the red plate: trailing digits of the label / id ("rack-3" -> "3"). */
export function rackNumber(label: string): string {
  return /(\d+)\D*$/.exec(label)?.[1] ?? '';
}

export class RoomScene {
  readonly world = new Container();
  /** Occupancy of the current room (replaced by setSize). */
  grid: Occupancy;
  private roomSize: RoomSize;
  readonly avatar: AvatarMotion;

  private staticGfx: Graphics;
  private staticSprite: Sprite | null = null;
  private staticRes = 0;
  private readonly shadows = new Container();
  private readonly floorFx = new Graphics();
  /** Cold / hot aisles + rack front chevrons (redrawn on change only). */
  private readonly aisleFx = new Graphics();
  /** Placement hints (valid tiles / hatched invalid tiles), only while placing. */
  private readonly placeFx = new Graphics();
  /** Pre-installed wall-mounted OOB switch at the back corner (game, out of VCF scope). */
  private readonly oobLayer = new Container();
  private aisles: AisleSet | null = null;
  private hints: PlacementHints | null = null;
  private overlayDirty = true;
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
  /** Fixed objects: desk + computer, whiteboard (Sprint 2B, render/room/fixtures.ts). */
  readonly fixtures: RoomFixtures;
  private highlighted: string | null = null;
  private readonly overhead = new Container();
  /** Flow ribbons of the tray bundles (above the wires, below the dots). */
  private readonly flowLayer = new Container();
  /** BMC: overhead dashed wires (per cabinet a dashed run to the OOB switch) + grey squares (ParticleContainer). */
  private readonly bmcWireFx = new Graphics();
  private bmcView: ParticleContainer<Particle> | null = null;
  private bmcPool: Particle[] = [];
  private readonly bmcLinks = new Map<string, BmcEntry>();
  private bmcSpecs: readonly BmcLinkSpec[] = [];
  private bmcActive = new Set<string>();
  private bmcIso = new Map<string, number | null>();
  private bmcClockMs = 0;
  /** Flow numbers + ISO labels (BitmapText pool, ≤ 8). */
  private readonly labelLayer = new Container();
  private labels: BitmapText[] = [];
  private flowMs = FLOW_REFRESH_MS;
  private flowTotals: { x: number; y: number; gbps: number; ax: number }[] = [];
  /** "Síť firmy" uplink cable (switch -> wall patch panel), GAME abstraction. */
  private readonly uplinkLayer = new Container();
  private readonly uplinkFx = new Graphics();
  private uplinkLabel: Text | null = null;
  private uplink: { deviceId: string; port: number } | null = null;
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
  private ghost: { kind: GhostKind; tile: Tile; valid: boolean; facing: CabinetFacing; units?: number; allowed: readonly CabinetFacing[] } | null = null;
  private ghostTextures = new Map<string, { tex: Texture; ax: number; ay: number }>();
  private fxKey = '';
  private markerMs = 0;
  private arriveListeners = new Set<(tile: Tile) => void>();
  private readonly ghostShadow: Sprite;

  constructor(
    private readonly renderer: Renderer,
    size: RoomSize = DEFAULT_ROOM,
    avatarStart: Tile = { gx: Math.floor(size.cols / 2), gy: size.rows - 2 },
  ) {
    this.roomSize = size;
    this.grid = new Occupancy(size);
    this.fixtures = new RoomFixtures(renderer);
    this.grid.set(DESK, true);
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
    this.objects.addChild(this.highlightFx, this.fixtures.desk);
    this.world.addChild(this.fixtures.wall, this.oobLayer, this.shadows, this.aisleFx, this.placeFx, this.floorFx, this.markerFx, this.objects, this.overhead, this.bmcWireFx, this.flowLayer, this.uplinkLayer, this.labelLayer, this.magnifier);
    ensureFlowFont();
    this.uplinkLayer.addChild(this.uplinkFx);
    this.drawUplink();
    this.drawOob();
    this.bakeStatic(2);
    this.syncAvatar(0);
  }

  // ---------------------------------------------------------------- view

  /** Current room size (tiles). */
  get size(): RoomSize {
    return this.roomSize;
  }

  /**
   * Switch to a room of another size (multi-room sites, small / large room). Clears the furniture
   * (the caller re-syncs the contents of the new room), redraws and re-bakes the static room.
   */
  setSize(size: RoomSize): void {
    if (size.cols === this.roomSize.cols && size.rows === this.roomSize.rows) return;
    this.clear();
    this.roomSize = size;
    this.grid = new Occupancy(size);
    this.grid.set(DESK, true);
    this.staticGfx.destroy();
    this.staticGfx = drawStaticRoom(size);
    this.staticRes = 0;
    this.bakeStatic(2);
    this.simDirty = true;
    this.cablesDirty = true;
    this.drawUplink();
    this.drawOob();
    this.overlayDirty = true;
    const a = this.avatar.tile;
    if (a.gx >= size.cols || a.gy >= size.rows) this.resetAvatar({ gx: Math.floor(size.cols / 2), gy: size.rows - 2 });
  }

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
    const geo = cabinetGeometry(kind);
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
    const geo = cabinetGeometry(spec);
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
    const flow = new Graphics();
    flow.zIndex = sprite.zIndex + 0.006;
    const entry: CabinetEntry = { spec, devices: [], sprite, shadow, texture: null, risers, key: '', flow, flowKey: '', riser: null };
    this.cabinets.set(spec.id, entry);
    this.objects.addChild(sprite, risers, flow);
    this.shadows.addChild(shadow);
    for (const d of devices) this.mountDevice(spec.id, d);
    this.rebakeCabinet(entry);
    this.overlayDirty = true;
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
    const geo = cabinetGeometry(e.spec);
    this.grid.set({ gx: e.spec.gx, gy: e.spec.gy, w: geo.w, d: geo.d }, false);
    e.sprite.destroy();
    e.shadow.destroy();
    e.risers.destroy();
    e.flow.destroy();
    e.texture?.destroy(true);
    this.cabinets.delete(id);
    if (this.highlighted === id) this.setHighlightedCabinet(null);
    this.cablesDirty = true;
    this.overlayDirty = true;
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
      if (!w || w.spec.gx !== e.spec.gx || w.spec.gy !== e.spec.gy || w.spec.kind !== e.spec.kind || (w.spec.facing ?? 'S') !== (e.spec.facing ?? 'S') || w.spec.units !== e.spec.units || w.spec.label !== e.spec.label) this.removeCabinet(id);
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
          if (canMount(e.spec, e.devices, d)) {
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
    this.bmcSpecs = c.bmcLinks ?? [];
    this.cablesDirty = true;
    this.drawTrays();
  }

  /** v3 (UX 23): thin grey wire tray only above rack rows that hold a rack (rows along the rack's side axis). */
  private readonly trayFx = new Graphics();
  private trayKey = '';
  private drawTrays(): void {
    const cabs = [...this.cabinets.values()].map((e) => e.spec).filter((sp) => sp.kind === 'rack');
    const key = cabs.map((c) => `${c.gx},${c.gy},${c.facing ?? 'S'}`).sort().join('|');
    if (key === this.trayKey) return;
    this.trayKey = key;
    if (!this.trayFx.parent) this.overhead.addChildAt(this.trayFx, 0);
    this.trayFx.clear();
    const rows = new Map<string, { gx0: number; gx1: number; gy0: number; gy1: number; ns: boolean; line: number }>();
    for (const c of cabs) {
      const ns = (c.facing ?? 'S') === 'S' || c.facing === 'N';
      const line = ns ? c.gy : c.gx;
      const k = `${ns ? 'r' : 'c'}${line}`;
      const r = rows.get(k) ?? { gx0: c.gx, gx1: c.gx, gy0: c.gy, gy1: c.gy, ns, line };
      r.gx0 = Math.min(r.gx0, c.gx);
      r.gx1 = Math.max(r.gx1, c.gx);
      r.gy0 = Math.min(r.gy0, c.gy);
      r.gy1 = Math.max(r.gy1, c.gy);
      rows.set(k, r);
    }
    drawRowTrays(this.trayFx, [...rows.values()].map((r) => (r.ns ? { a: { gx: r.gx0, gy: r.line + 0.5 }, b: { gx: r.gx1 + 1, gy: r.line + 0.5 } } : { a: { gx: r.line + 0.5, gy: r.gy0 }, b: { gx: r.line + 0.5, gy: r.gy1 + 1 } })));
  }

  /** Mount a server/switch into a cabinet. `u` <= 0 = first free slot. */
  mountDevice(cabinetId: string, dev: RoomDeviceSpec): PlaceResult {
    const e = this.cabinets.get(cabinetId);
    if (!e) return { ok: false, reason: 'unknown' };
    if (this.deviceOwner.has(dev.id)) return { ok: false, reason: 'duplicate' };
    let d = dev;
    if (d.u <= 0) {
      const u = firstFreeU(e.spec, e.devices, d.heightU);
      if (u === null) return { ok: false, reason: 'slot' };
      d = { ...d, u };
    }
    if (!canMount(e.spec, e.devices, d)) return { ok: false, reason: 'slot' };
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
    const root = new Container();
    const g = new Graphics();
    drawCabinet(g, e.spec.kind, e.devices, e.spec);
    root.addChild(g);
    const num = e.spec.kind === 'rack' ? rackNumber(e.spec.label ?? e.spec.id) : '';
    if (num) {
      // White number on the red plate (T6 CABINET.label, 5.85:1), baked into the cabinet texture.
      const c = rackPlateCenter(e.spec);
      const t = new Text({ text: num, style: { fontFamily: 'system-ui, sans-serif', fontSize: 5, fontWeight: '800', fill: 0xffffff }, resolution: FURNITURE_RES });
      t.anchor.set(0.5);
      t.position.set(c.x, c.y);
      root.addChild(t);
    }
    const b = g.getLocalBounds();
    const frame = new Rectangle(Math.floor(b.x) - 2, Math.floor(b.y) - 2, Math.ceil(b.width) + 4, Math.ceil(b.height) + 4);
    const tex = this.renderer.generateTexture({ target: root, frame, resolution: FURNITURE_RES, antialias: true });
    root.destroy({ children: true });
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
    this.computeRiserSpans();
    this.rebuildBmc();
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
        b.flow.destroy();
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
        b = { key: k, cabA: g.a, cabB: g.b, cables: g.ids, route, flat: flatten(route), gfx: new Graphics(), badge: null, flow: new Graphics(), flowKey: '' };
        this.bundles.set(k, b);
        this.overhead.addChild(b.gfx);
        this.flowLayer.addChild(b.flow);
      } else {
        b = { ...b, cables: g.ids, route, flat: flatten(route), flowKey: '' };
        this.bundles.set(k, b);
      }
      this.drawBundle(b);
    }
    this.simDirty = true;
    this.flowMs = FLOW_REFRESH_MS; // refresh ribbons next frame
  }

  /** Riser ribbon span per cabinet: from the lowest port's edge point up to the top (or the highest port). */
  private computeRiserSpans(): void {
    const spans = new Map<string, { lo: P; hi: P; leaves: boolean }>();
    const add = (cabId: string, port: P, leaves: boolean): void => {
      const e = this.cabinets.get(cabId);
      if (!e) return;
      const p = faceEdgePoint(e.spec, port);
      const cur = spans.get(cabId);
      if (!cur) spans.set(cabId, { lo: p, hi: p, leaves });
      else {
        if (p.y > cur.lo.y) cur.lo = p;
        if (p.y < cur.hi.y) cur.hi = p;
        cur.leaves ||= leaves;
      }
    };
    for (const c of this.cables.values()) {
      const leaves = c.cabA !== c.cabB;
      add(c.cabA, c.path.points[0]!, leaves);
      add(c.cabB, c.path.points[c.path.points.length - 1]!, leaves);
    }
    for (const [id, e] of this.cabinets) {
      const sp = spans.get(id);
      e.riser = sp ? [sp.lo, sp.leaves ? riserTop(e.spec) : sp.hi] : null;
      if (e.riser && Math.abs(e.riser[0]!.y - e.riser[1]!.y) < 2) e.riser = [e.riser[0]!, { x: e.riser[1]!.x, y: e.riser[1]!.y - 2 }];
      e.flowKey = '';
    }
  }

  // ---------------------------------------------------------------- BMC (game scope, UX §28.7)

  /** BMC paths: server BMC port -> thin dashed riser -> overhead -> wall OOB switch (or the peer port in this room). */
  private rebuildBmc(): void {
    this.bmcLinks.clear();
    const oobTop = up(isoToScreen(OOB_SWITCH_SPOT.gx + 0.36, OOB_SWITCH_SPOT.gy + 0.13), OOB_TOP_Z);
    const oobGrid = { gx: OOB_SWITCH_SPOT.gx + 0.36, gy: OOB_SWITCH_SPOT.gy + 0.13 };
    let i = 0;
    for (const spec of this.bmcSpecs) {
      const a = this.portWorld(spec.server.deviceId, spec.server.port);
      if (!a) continue;
      const b = spec.peer ? this.portWorld(spec.peer.deviceId, spec.peer.port) : null;
      let points: P[];
      let overheadFrom: number;
      if (b) {
        points = devicePath(a.cabinet.spec, a.p, b.cabinet.spec, b.p);
        overheadFrom = a.cabinet.spec.id === b.cabinet.spec.id ? points.length : 2;
      } else {
        points = bmcWallPath(a.cabinet.spec, a.p, oobTop, oobGrid);
        overheadFrom = 2;
      }
      this.bmcLinks.set(spec.id, { spec, cab: a.cabinet.spec.id, points, flat: flatten(points), length: polyLength(points), overheadFrom, phase: (i++ * 0.37) % 1 });
    }
    // In-cabinet parts (port -> riser -> top) go into the cabinet's riser Graphics (depth-sorted with the cabinet).
    const perCab = new Map<string, P[][]>();
    const overhead: P[][] = [];
    const seenCabRun = new Set<string>();
    for (const l of this.bmcLinks.values()) {
      const inCab = l.points.slice(0, Math.min(l.points.length, l.overheadFrom + 1));
      const list = perCab.get(l.cab) ?? [];
      list.push(inCab);
      perCab.set(l.cab, list);
      if (l.overheadFrom < l.points.length - 1) {
        // One overhead run per cabinet to the wall switch (they coincide), one per link for peers.
        const k = l.spec.peer ? l.spec.id : l.cab;
        if (!seenCabRun.has(k)) {
          seenCabRun.add(k);
          overhead.push(l.points.slice(l.overheadFrom));
        }
      }
    }
    for (const [cabId, runs] of perCab) {
      const g = this.cabinets.get(cabId)?.risers;
      if (!g) continue;
      for (const r of runs) dashedPolyline(g, r, 3, 2.5);
      g.stroke({ color: BMC_GREY, width: 1, cap: 'butt' });
    }
    const w = this.bmcWireFx;
    w.clear();
    for (const r of overhead) dashedPolyline(w, r, 4, 3);
    w.stroke({ color: BMC_GREY, width: 1, cap: 'butt' });
    // Squares: one ParticleContainer, pooled.
    if (!this.bmcView) {
      this.bmcView = new ParticleContainer<Particle>({ texture: this.dots.base, dynamicProperties: { position: true, color: true, vertex: false, rotation: false, uvs: false } });
      const bb = this.bounds;
      this.bmcView.boundsArea = new Rectangle(bb.x - 100, bb.y - 100, bb.width + 200, bb.height + 300);
      this.bmcPool = Array.from({ length: BMC_POOL }, () => new Particle({ texture: this.dots.shapes.bmc, anchorX: 0.5, anchorY: 0.5, scaleX: 0.6, scaleY: 0.6, tint: BMC_GREY }));
      this.world.addChildAt(this.bmcView, this.world.getChildIndex(this.flowLayer) + 1);
    }
  }

  /** Advance the BMC squares (real time – game scope, not tied to the game clock; frozen while paused). */
  private stepBmc(realMs: number, running: boolean): void {
    const view = this.bmcView;
    if (!view) return;
    if (running) this.bmcClockMs += realMs;
    const kids = view.particleChildren;
    let n = 0;
    const tmp = { x: 0, y: 0 };
    for (const [id, l] of this.bmcLinks) {
      if (!this.bmcActive.has(id) && !this.bmcIso.has(id)) continue;
      const iso = this.bmcIso.has(id);
      const period = iso ? BMC_ISO_PERIOD_MS : BMC_PERIOD_MS;
      const offset = l.phase * period;
      // Every square that left within the last travel time is on the wire: t = (clock - k·period) / travel.
      const newest = Math.floor((this.bmcClockMs + offset) / period);
      for (let k = newest; k >= 0 && n < BMC_POOL; k--) {
        const t = (this.bmcClockMs + offset - k * period) / BMC_TRAVEL_MS;
        if (t > 1) break;
        if (t < 0) continue;
        const p = polylineAt(l.flat, l.length, t, tmp);
        const s = this.bmcPool[n++]!;
        s.x = p.x;
        s.y = p.y;
      }
    }
    if (kids.length !== n) {
      kids.length = n;
      for (let i = 0; i < n; i++) kids[i] = this.bmcPool[i]!;
      view.update();
    }
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

  /** Company network uplink (switch port -> wall patch panel). null = not connected. Redrawn on every call (state changes only). */
  setCompanyUplink(link: { deviceId: string; port: number } | null): void {
    this.uplink = link ? { ...link } : null;
    this.drawUplink();
  }

  private drawUplink(): void {
    const g = this.uplinkFx;
    g.clear();
    const j = wallJack(this.size);
    if (!this.uplinkLabel) {
      this.uplinkLabel = new Text({ text: 'Síť firmy · herní zjednodušení', style: { fontFamily: 'system-ui, sans-serif', fontSize: 9, fontWeight: '800', fill: OUTLINE, stroke: { color: 0xffffff, width: 3 } }, resolution: 3 });
      this.uplinkLabel.anchor.set(0.5, 0);
      this.uplinkLabel.visible = false; // v3 (UX 23): only as a tooltip on hover / focus
      this.uplinkLabel.position.set(j.label.x, j.label.y);
      this.uplinkLayer.addChild(this.uplinkLabel);
    }
    const link = this.uplink;
    const pw = link ? this.portWorld(link.deviceId, link.port) : null;
    // Link LED on the panel: green when connected.
    g.circle(j.port.x + 10, j.port.y - 8, 2.4).fill(pw ? 0x3ccf7a : 0x8592a3).stroke({ color: OUTLINE, width: 1 });
    if (!link || !pw) return;
    const cab = pw.cabinet.spec;
    const ju = (j.u0 + j.u1) / 2;
    const tp = trayPoint(cab);
    const corner = up(isoToScreen(ju, cab.gy + 1), BUNDLE_Z);
    const wall = up(isoToScreen(ju, 0.3), BUNDLE_Z);
    const pts: P[] = [pw.p, faceEdgePoint(cab, pw.p), riserTop(cab), tp, corner, wall, j.port];
    const path = (): Graphics => {
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
      return g;
    };
    // Traffic v3 (UX §28.5, D4): neutral cable like the others – yellow is reserved for the load warning.
    path().stroke({ color: OUTLINE, width: 3.6, cap: 'round', join: 'round' });
    path().stroke({ color: CABLE.body, width: 1.8, cap: 'round', join: 'round' });
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
   * BMC traffic (game scope, UX §28.7): `active` = BMC cables with management traffic (grey squares, 1 per 3 s);
   * `iso` = cables carrying the remote ESX install ISO (1 square per 0.5 s + label "✚ ISO n %", progress 0..1 or null).
   * Never VCF dots, ribbons or Gb/s.
   */
  setBmcTraffic(active: Iterable<string>, iso: ReadonlyMap<string, number | null> = new Map()): void {
    this.bmcActive = new Set(active);
    this.bmcIso = new Map(iso);
  }

  /** Show only one traffic type (others at 15 % alpha); null = all (UX §12.5 legend filter). */
  setTrafficFilter(type: TrafficType | null): void {
    this.filter = type;
    this.flowMs = FLOW_REFRESH_MS;
  }

  /** Traffic types with packets on screen right now (legend chip). */
  get activeTypes(): ReadonlySet<TrafficType> {
    return this.active;
  }

  /** BMC squares are running (legend chip shows ▫). */
  get bmcTransferActive(): boolean {
    for (const id of this.bmcActive) if (this.bmcLinks.has(id)) return true;
    for (const id of this.bmcIso.keys()) if (this.bmcLinks.has(id)) return true;
    return false;
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
  /** Fixed object (desk with the computer / whiteboard) under a world point. */
  fixtureAtWorld(wx: number, wy: number): FixtureId | null {
    return this.fixtures.at(wx, wy);
  }

  /** World rect of a fixed object (camera flight target: the monitor / the board). */
  fixtureRect(id: FixtureId): { x: number; y: number; width: number; height: number } {
    return this.fixtures.rect(id);
  }

  /** World rect of the avatar (speech bubble anchor 'avatar', UX 18.1). */
  avatarRect(): { x: number; y: number; width: number; height: number } {
    const p = isoToScreen(this.avatar.x, this.avatar.y);
    return { x: p.x - 10, y: p.y - 60, width: 20, height: 60 };
  }

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
    if (!e && isFixtureId(id)) {
      // Fixed objects (desk / whiteboard): same rim + magnifier.
      const f = this.fixtures.silhouette(id);
      const sil = f.pts.flatMap((p) => [p.x, p.y]);
      g.poly(sil).stroke({ color: 0xffffff, width: 6, join: 'round', alpha: 0.95 });
      g.poly(sil).stroke({ color: OUTLINE, width: 2, join: 'round' });
      g.zIndex = f.z + 0.004;
      g.visible = true;
      this.magnifier.position.set(f.top.x, f.top.y);
      this.magnifier.visible = true;
      return;
    }
    if (!e) {
      g.visible = false;
      this.magnifier.visible = false;
      return;
    }
    const geo = cabinetGeometry(e.spec);
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

  /**
   * Placement preview: translucent cabinet (right height + facing) + blue/red footprint with a front chevron.
   * `valid` is decided by the caller (engine hints); without it the render's physical check is used (demo room).
   */
  setGhost(ghost: GhostSpec | null): void {
    if (!ghost) {
      if (this.ghost) this.overlayDirty = true;
      this.ghost = null;
      this.ghostSprite.visible = false;
      this.ghostShadow.visible = false;
      return;
    }
    const valid = ghost.valid ?? this.checkPlace(ghost.kind, ghost.tile).ok;
    const facing = ghost.facing ?? 'S';
    this.ghost = { kind: ghost.kind, tile: ghost.tile, valid, facing, allowed: ghost.allowed ?? [], ...(ghost.units !== undefined ? { units: ghost.units } : {}) };
    const gt = this.ghostTexture(ghost.kind, ghost.units, facing);
    const geo = cabinetGeometry({ kind: ghost.kind, units: ghost.units });
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

  private ghostTexture(kind: GhostKind, units: number | undefined, facing: CabinetFacing): { tex: Texture; ax: number; ay: number } {
    const key = `${kind}|${units ?? ''}|${facing}`;
    let t = this.ghostTextures.get(key);
    if (!t) {
      const g = new Graphics();
      drawCabinet(g, kind, kind === 'stand' ? [{ id: 'ghost', kind: 'switch', u: 1, heightU: 1 }] : [], { units, facing });
      const b = g.getLocalBounds();
      const frame = new Rectangle(Math.floor(b.x) - 2, Math.floor(b.y) - 2, Math.ceil(b.width) + 4, Math.ceil(b.height) + 4);
      const tex = this.renderer.generateTexture({ target: g, frame, resolution: 2, antialias: true });
      g.destroy();
      t = { tex, ax: -frame.x / frame.width, ay: -frame.y / frame.height };
      this.ghostTextures.set(key, t);
    }
    return t;
  }

  /** Cold / hot aisle tiles of the standing racks (engine snapshot); null hides them. */
  setAisles(a: AisleSet | null): void {
    const key = (x: AisleSet | null): string => (x ? `${x.cold.map((t) => `${t.gx},${t.gy}`).join(';')}|${x.hot.map((t) => `${t.gx},${t.gy}`).join(';')}` : '');
    if (key(a) === key(this.aisles)) return;
    this.aisles = a;
    this.overlayDirty = true;
  }

  /** Placement hints (engine) while the player places / moves a rack; null hides them. */
  setPlacementHints(h: PlacementHints | null): void {
    this.hints = h;
    this.overlayDirty = true;
  }

  /** Redraw aisles, rack front chevrons and placement hints (only after a change). */
  private drawOverlays(): void {
    this.overlayDirty = false;
    const a = this.aisleFx;
    a.clear();
    if (this.aisles) drawAisles(a, this.aisles);
    for (const e of this.cabinets.values()) if (e.spec.kind === 'rack') drawRackFront(a, e.spec, e.spec.facing ?? 'S');
    const p = this.placeFx;
    p.clear();
    if (this.hints) {
      const occupied = new Set([...this.cabinets.values()].map((e) => `${e.spec.gx},${e.spec.gy}`));
      drawPlacementHints(p, this.size, this.hints.tiles, this.hints.facing, occupied);
    }
  }

  /** Wall-mounted OOB switch at the back corner + its game-scope label (redrawn with the room). */
  private drawOob(): void {
    for (const c of this.oobLayer.removeChildren()) c.destroy();
    const g = new Graphics();
    const { label } = drawOobSwitch(g, OOB_SWITCH_SPOT);
    const t = new Text({ text: 'OOB switch · mimo VCF scope – herní', style: { fontFamily: 'system-ui, sans-serif', fontSize: 8, fontWeight: '700', fill: OUTLINE, stroke: { color: 0xffffff, width: 3 } }, resolution: 3 });
    t.anchor.set(0.5, 0);
    t.position.set(label.x, label.y);
    t.visible = false; // v3 (UX 23): only as a tooltip on hover / focus
    this.oobLayer.addChild(g, t);
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
    const f = e.spec.facing ?? 'S';
    const t = f === 'S' ? { gx: e.spec.gx, gy: e.spec.gy + 1 } : f === 'N' ? { gx: e.spec.gx, gy: e.spec.gy - 1 } : f === 'E' ? { gx: e.spec.gx + 1, gy: e.spec.gy } : { gx: e.spec.gx - 1, gy: e.spec.gy };
    return this.walkTo({ gx: Math.max(0, Math.min(this.size.cols - 1, t.gx)), gy: Math.max(0, Math.min(this.size.rows - 1, t.gy)) });
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
    this.flowMs += real;
    if (this.flowMs >= FLOW_REFRESH_MS) {
      this.flowMs = 0;
      this.updateFlows();
      this.updateLabels();
    }
    this.stepBmc(real, gameDelta > 0);
    this.drawFloorFx(real);
  }

  /** Sum + dominant type + worst band over a set of cable ids. */
  private aggregate(ids: Iterable<string>): { gbps: number; dominant: TrafficType | null; band: LoadBand } {
    let gbps = 0;
    let worst = 0;
    const mix: { type: TrafficType; gbps: number }[] = [];
    for (const id of ids) {
      const t = this.traffic.get(id);
      if (!t) continue;
      gbps += t.demandGbps;
      worst = Math.max(worst, t.utilization + (t.dropFraction > 0 ? 1 : 0));
      for (const m of t.mix) mix.push(m);
    }
    return { gbps, dominant: dominantType(mix), band: loadBand(Math.min(1, worst)) };
  }

  private ribbonStyle(a: { gbps: number; dominant: TrafficType | null; band: LoadBand }): RibbonStyle {
    const color = a.dominant ? TRAFFIC_STYLE[a.dominant].color : CABLE.body;
    const dim = this.filter !== null && a.dominant !== this.filter;
    return { width: quantize(flowWidth(a.gbps)), color, alpha: 0.45, band: a.band, dim };
  }

  /** Traffic v3 flow ribbons on tray bundles and cabinet risers (redrawn only when the quantised key changes). */
  private updateFlows(): void {
    const totals: { x: number; y: number; gbps: number; ax: number }[] = [];
    for (const b of this.bundles.values()) {
      const a = this.aggregate(b.cables);
      const st = this.ribbonStyle(a);
      const key = ribbonKey(st);
      if (key !== b.flowKey) {
        b.flowKey = key;
        drawRibbon(b.flow, b.route, st);
      }
      if (a.gbps > 0) {
        const mid = b.route[Math.floor(b.route.length / 2)]!;
        totals.push({ x: mid.x, y: mid.y - 12, gbps: a.gbps, ax: 0.5 });
      }
    }
    const perCab = new Map<string, Set<string>>();
    for (const c of this.cables.values()) {
      for (const cab of [c.cabA, c.cabB]) {
        const set = perCab.get(cab) ?? new Set<string>();
        set.add(c.spec.id);
        perCab.set(cab, set);
      }
    }
    for (const [id, e] of this.cabinets) {
      const ids = perCab.get(id);
      const a = ids && e.riser ? this.aggregate(ids) : { gbps: 0, dominant: null, band: 'normal' as LoadBand };
      const st = this.ribbonStyle(a);
      const key = ribbonKey(st);
      if (key !== e.flowKey) {
        e.flowKey = key;
        if (e.riser) drawRibbon(e.flow, e.riser, st);
        else e.flow.clear();
      }
      if (a.gbps > 0 && e.riser) {
        const top = e.riser[1]!;
        totals.push({ x: top.x + 7, y: top.y + 10, gbps: a.gbps, ax: 0 });
      }
    }
    this.flowTotals = totals;
  }

  /** Visible world rect (for "top 3 in view"). */
  private viewRect(): { x0: number; y0: number; x1: number; y1: number } {
    const scr = this.renderer.screen;
    const a = this.world.toLocal({ x: 0, y: 0 });
    const b = this.world.toLocal({ x: scr.width, y: scr.height });
    return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  }

  /** "≈ x Gb/s" at the 3 busiest bundles / risers in view + "✚ ISO n %" at servers with an ISO transfer. */
  private updateLabels(): void {
    const r = this.viewRect();
    const inView = this.flowTotals.filter((t) => t.x >= r.x0 && t.x <= r.x1 && t.y >= r.y0 && t.y <= r.y1);
    inView.sort((a, b) => b.gbps - a.gbps);
    const want: { x: number; y: number; text: string; anchorX: number }[] = inView.slice(0, TOP_LABELS).map((t) => ({ x: t.x, y: t.y, text: formatGbps(t.gbps), anchorX: t.ax }));
    for (const [id, progress] of this.bmcIso) {
      const l = this.bmcLinks.get(id);
      if (!l || want.length >= LABEL_POOL) continue;
      const p = l.points[0]!;
      want.push({ x: p.x - 6, y: p.y - 2, text: progress === null ? '✚ ISO' : `✚ ISO ${Math.round(progress * 100)} %`, anchorX: 1 });
    }
    // Counter-scale so labels keep ~11 px on screen at any zoom (clamped).
    const ws = Math.abs(this.world.worldTransform.a) || 1;
    const k = Math.min(1.6, Math.max(0.5, 1 / ws));
    while (this.labels.length < want.length) {
      const t = new BitmapText({ text: '', style: { fontFamily: FLOW_FONT, fontSize: 11 } });
      t.anchor.set(0.5, 1);
      this.labels.push(t);
      this.labelLayer.addChild(t);
    }
    this.labels.forEach((t, i) => {
      const w = want[i];
      t.visible = !!w;
      if (!w) return;
      if (t.text !== w.text) t.text = w.text;
      t.anchor.set(w.anchorX, 1);
      t.position.set(w.x, w.y);
      t.scale.set(k);
    });
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
      dynamicProperties: { position: true, color: true, vertex: true, rotation: false, uvs: true },
    });
    const b = this.bounds;
    view.boundsArea = new Rectangle(b.x - 100, b.y - 100, b.width + 200, b.height + 300);
    this.packetPool = this.sim.packets.map(
      () => new Particle({ texture: this.dots.shapes.management, anchorX: 0.5, anchorY: 0.5, scaleX: DOT_SCALE, scaleY: DOT_SCALE }),
    );
    this.packetView = view;
    this.world.addChild(view);
    // Numbers + magnifier stay on top of the packets.
    this.world.addChild(this.labelLayer, this.magnifier);
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
      const sc = DOT_SCALE * p.scale;
      s.scaleX = sc;
      s.scaleY = sc;
      s.alpha = f && p.type !== f ? p.alpha * 0.15 : p.alpha;
    }
  }

  get livePackets(): number {
    return this.sim?.count ?? 0;
  }

  /** Hover tile + ghost footprint (redrawn only on change) and the pulsing walk target. */
  private drawFloorFx(realMs: number): void {
    const gh = this.ghost;
    const ht = this.hoverTile;
    if (this.overlayDirty) this.drawOverlays();
    const key = `${ht ? `${ht.gx},${ht.gy}` : '-'}|${gh ? `${gh.kind}${gh.tile.gx},${gh.tile.gy}${gh.valid}${gh.facing}${gh.allowed.join('')}` : '-'}`;
    if (key !== this.fxKey) {
      this.fxKey = key;
      const g = this.floorFx;
      g.clear();
      if (gh) {
        drawGhostFootprint(g, gh.tile, gh.facing, gh.valid, gh.allowed);
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

/** Dashed segments along a polyline (moveTo / lineTo only; stroke by the caller). No shader, no filter. */
function dashedPolyline(g: Graphics, pts: readonly P[], dash: number, gap: number): void {
  let on = true;
  let left = dash;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let d = 0;
    while (d < len) {
      const step = Math.min(left, len - d);
      if (on) {
        g.moveTo(a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len);
        g.lineTo(a.x + ((b.x - a.x) * (d + step)) / len, a.y + ((b.y - a.y) * (d + step)) / len);
      }
      d += step;
      left -= step;
      if (left <= 1e-6) {
        on = !on;
        left = on ? dash : gap;
      }
    }
  }
}

/** Point at fraction t of a flat polyline (BMC squares). */
function polylineAt(pts: Float32Array, length: number, t: number, out: { x: number; y: number }): { x: number; y: number } {
  return polylinePoint(pts, length, t, out);
}
