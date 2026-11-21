/**
 * Site layout adapter (UI side) – "Výběr lokality" (CLAUDE.md, user 2026-11-21).
 *
 * The render / UI layers only consume a plain description of the site: rooms (size + where they sit),
 * buildings, sites and links between rooms. The player's Sandbox uses the SESSION-BACKED port
 * (`sharedSitePort` -> `createSessionSitePort`): blueprint, layout, room roles and rack rooms are session state
 * (commands chooseBlueprint / assignRoomRole / moveRackToRoom, snapshot.site). The local port
 * (`createLocalSitePort`) is only for the illustrative demo room and as a stand-in until the session is loaded.
 *
 * Everything here is GAME data: room sizes, distances, RTT and bandwidth of the links are illustrative
 * game values (always shown with an "herní hodnota" badge). What they mean for VCF (AZ, stretched cluster,
 * DR instance, latency requirements) comes only from docs/spec (00 §6, 05 §4.1, 10 §3.3) – never from here.
 */
import { AZ_ROLES, DEFAULT_SITE_LAYOUT, isSiteLayoutId as isModelLayoutId, LAYOUT_BLUEPRINTS, SITE_LAYOUT_IDS as MODEL_LAYOUT_IDS, SITE_LAYOUTS, type AzRole, type BlueprintId, type SiteLayoutId as ModelLayoutId, type SiteLinkKind } from '../../model/sites';
import type { SiteView } from '../../modes/sandbox/site';
import { roomFloorSize } from '../../modes/sandbox/rackLayout';
import type { SandboxCommand } from '../../modes/sandbox/types';
import { loadedSandboxSession, sharedSandboxSession } from './sessionPort';
import type { RoomSize } from '../../render/room/roomGrid';
import type { SiteSceneInput } from '../../render/site/siteGeom';

/** Layout presets come from the model (model/sites.ts SITE_LAYOUTS – game data marked gameDefault there). */
export type SiteLayoutId = ModelLayoutId;
export const SITE_LAYOUT_IDS: readonly SiteLayoutId[] = MODEL_LAYOUT_IDS;
export const isSiteLayoutId = (s: unknown): s is SiteLayoutId => typeof s === 'string' && isModelLayoutId(s);

/**
 * Role the player assigns to a room (model AzRole: AZ1 / AZ2 / witness location / second VCF Instance).
 * The UI only stores and shows it; what it means for VCF is decided by the model from the spec.
 */
export type AzLabel = AzRole | null;
export const AZ_CYCLE: readonly AzLabel[] = [null, ...AZ_ROLES];
export const AZ_LABEL: Readonly<Record<AzRole, string>> = { az1: 'AZ1', az2: 'AZ2', witness: 'Witness', 'secondary-instance': '2. instance' };
export const azText = (a: AzLabel): string => (a ? AZ_LABEL[a] : 'AZ —');

export interface SiteRoomView {
  readonly id: string;
  readonly label: string;
  readonly size: RoomSize;
  readonly buildingId: string;
  readonly az: AzLabel;
  /** [GAME] rack capacity of the room (model). */
  readonly rackSlots: number;
}

export interface SiteBuildingView {
  readonly id: string;
  readonly label: string;
  readonly siteId: string;
}

export interface SiteSiteView {
  readonly id: string;
  readonly label: string;
  /** 'primary' = first site, 'remote' = reached over a WAN link. */
  readonly role: 'primary' | 'remote';
}

/** Illustrative game values of a link (never facts from the documentation). */
export interface LinkGameValues {
  readonly rttMs: number;
  readonly gbps: number;
}

export interface SiteLinkView {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  /** corridor = rooms in one building, campus = between buildings, wan = between sites. */
  readonly kind: 'corridor' | 'campus' | 'wan';
  readonly game: LinkGameValues;
}

/** Plain layout description consumed by render/site and the room screen. */
export interface SiteLayoutView {
  /** null = no choice yet: the classic single room (backwards compatible default). */
  readonly preset: SiteLayoutId | null;
  readonly label: string;
  readonly rooms: readonly SiteRoomView[];
  readonly buildings: readonly SiteBuildingView[];
  readonly sites: readonly SiteSiteView[];
  readonly links: readonly SiteLinkView[];
}

/**
 * Room floor size (tiles) from the model's rack capacity – [GAME] value of the engine (modes/sandbox/rackLayout.ts
 * roomFloorSize), so the drawn room and the engine's placement grid always agree. Drawing only, not a VCF fact.
 */
export function roomSizeFor(rackSlots: number): RoomSize {
  return roomFloorSize(rackSlots);
}

/** Legacy single room (8 rack slots) – same as the engine's default room. */
export const DEFAULT_ROOM_SIZE: RoomSize = roomFloorSize(8);
const LINK_KIND: Readonly<Record<SiteLinkKind, SiteLinkView['kind']>> = { 'intra-building': 'corridor', campus: 'campus', wan: 'wan' };

/** Layout view of a model preset (AZ = the model's default assignment). null = legacy single room. */
export function presetLayout(id: SiteLayoutId | null): SiteLayoutView {
  if (id === null) {
    return {
      preset: null,
      label: 'Serverovna',
      rooms: [{ id: 'room-a1', label: 'Serverovna', size: DEFAULT_ROOM_SIZE, buildingId: 'bldg-a', az: null, rackSlots: 8 }],
      buildings: [{ id: 'bldg-a', label: 'Budova', siteId: 'site-a' }],
      sites: [{ id: 'site-a', label: 'Lokalita', role: 'primary' }],
      links: [],
    };
  }
  const l = SITE_LAYOUTS[id];
  // A site reached only over WAN links is "remote" (drawn far away, not to scale).
  const wanSites = new Set<string>();
  const siteOfRoom = new Map(l.rooms.map((r) => [r.id, r.siteId]));
  for (const k of l.links) if (k.kind === 'wan') wanSites.add(siteOfRoom.get(k.b) ?? '');
  return {
    preset: id,
    label: l.label,
    rooms: l.rooms.map((r) => ({ id: r.id, label: r.label, size: roomSizeFor(r.rackSlots), buildingId: r.buildingId, az: l.defaultAssignment[r.id] ?? null, rackSlots: r.rackSlots })),
    buildings: l.buildings.map((b) => ({ id: b.id, label: b.label, siteId: b.siteId })),
    sites: l.sites.map((s, i) => ({ id: s.id, label: s.label, role: i > 0 && wanSites.has(s.id) ? 'remote' : 'primary' })),
    links: l.links.map((k) => ({ id: k.id, from: k.a, to: k.b, kind: LINK_KIND[k.kind], game: { rttMs: k.rttMs, gbps: k.bandwidthGbps } })),
  };
}

/** Human text of the illustrative link values (always rendered next to a "herní hodnota" badge). */
export function formatLinkGame(g: LinkGameValues): string {
  return `RTT ${String(g.rttMs).replace('.', ',')} ms · ${g.gbps} Gb/s`;
}

// ---------------------------------------------------------------- adapter

/** Result of a site action (session: model / game-flow rejection message). */
export type SiteResult = { readonly ok: true } | { readonly ok: false; readonly message: string };
const OK: SiteResult = { ok: true };

/** What the room screen needs. Implemented by the session (player) and locally (demo room). */
export interface SitePort {
  layout(): SiteLayoutView;
  /** Chosen blueprint (null = none). */
  blueprintId(): string | null;
  subscribe(fn: () => void): () => void;
  choose(preset: SiteLayoutId, blueprintId: string | null): SiteResult;
  setAz(roomId: string, az: AzLabel): SiteResult;
  /** Room of a rack (racks without an assignment live in the first room). */
  roomOfRack(rackId: string): string;
  assignRack(rackId: string, roomId: string): SiteResult;
}

interface Stored {
  preset: SiteLayoutId | null;
  blueprint: string | null;
  /** Player's role per room; 'none' = explicitly unassigned (overrides the model default). */
  az: Record<string, AzRole | 'none'>;
  racks: Record<string, string>;
}

export const SITE_STORAGE_KEY = 'vcf-game.sandbox.site.v1';

/** Minimal storage interface (localStorage or a test double). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readStored(store: KeyValueStore | null): Stored {
  const empty: Stored = { preset: null, blueprint: null, az: {}, racks: {} };
  if (!store) return empty;
  try {
    const raw = store.getItem(SITE_STORAGE_KEY);
    if (!raw) return empty;
    const o = JSON.parse(raw) as Partial<Stored>;
    const az: Record<string, AzRole | 'none'> = {};
    for (const [k, v] of Object.entries(o.az ?? {})) if (v === 'none' || (AZ_ROLES as readonly string[]).includes(v)) az[k] = v;
    const racks: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.racks ?? {})) if (typeof v === 'string') racks[k] = v;
    return { preset: isSiteLayoutId(o.preset) ? o.preset : null, blueprint: typeof o.blueprint === 'string' ? o.blueprint : null, az, racks };
  } catch {
    return empty;
  }
}

/** Local (UI-only) site adapter. `store` = null keeps everything in memory. */
export function createLocalSitePort(store: KeyValueStore | null): SitePort {
  let s = readStored(store);
  const listeners = new Set<() => void>();
  let cache: SiteLayoutView | null = null;
  const save = (): void => {
    cache = null;
    try {
      store?.setItem(SITE_STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* storage full / disabled: keep in memory */
    }
    for (const fn of listeners) fn();
  };
  const layout = (): SiteLayoutView => {
    if (cache) return cache;
    const base = presetLayout(s.preset);
    cache = { ...base, rooms: base.rooms.map((r) => { const a = s.az[r.id]; return { ...r, az: a === undefined ? r.az : a === 'none' ? null : a }; }) };
    return cache;
  };
  return {
    layout,
    blueprintId: () => s.blueprint,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    choose(preset, blueprintId) {
      // A different layout = different rooms: AZ labels and rack-room assignments start over.
      s = preset === s.preset ? { ...s, blueprint: blueprintId } : { preset, blueprint: blueprintId, az: {}, racks: {} };
      save();
      return OK;
    },
    setAz(roomId, az) {
      const next: Record<string, AzRole | 'none'> = { ...s.az, [roomId]: az ?? 'none' };
      s = { ...s, az: next };
      save();
      return OK;
    },
    roomOfRack(rackId) {
      const rooms = layout().rooms;
      const r = s.racks[rackId];
      return r && rooms.some((x) => x.id === r) ? r : rooms[0]!.id;
    },
    assignRack(rackId, roomId) {
      if (s.racks[rackId] === roomId) return OK;
      s = { ...s, racks: { ...s.racks, [rackId]: roomId } };
      save();
      return OK;
    },
  };
}

// ---------------------------------------------------------------- session-backed port

/** What the site port needs from the SandboxSession (structural; the session is loaded lazily). */
export interface SiteSessionLike {
  snapshot(): unknown;
  dispatch(cmd: { readonly type: string } & Record<string, unknown>): unknown;
  subscribe(fn: (e: unknown) => void): () => void;
}

type DispatchResult = { ok: boolean; rejection?: { message?: string; issues?: readonly { message: string }[]; errors?: readonly { message: string }[] } };

const siteOf = (sess: SiteSessionLike): SiteView | undefined => (sess.snapshot() as { site?: SiteView } | null)?.site;

/** Plain layout view of the session's `snapshot.site` (rooms, roles, links – [GAME] values from the model). */
export function layoutFromSiteView(site: SiteView): SiteLayoutView {
  const l = site.layout;
  const wanSites = new Set<string>();
  const siteOfRoom = new Map(l.rooms.map((r) => [r.id, r.siteId]));
  for (const k of l.links) if (k.kind === 'wan') wanSites.add(siteOfRoom.get(k.b) ?? '');
  return {
    // null = no blueprint chosen yet (the model's default layout is shown)
    preset: site.blueprint ? l.id : null,
    label: l.label,
    rooms: l.rooms.map((r) => ({ id: r.id, label: r.label, size: { cols: r.floor.cols, rows: r.floor.rows }, buildingId: r.buildingId, az: r.role, rackSlots: r.rackSlots })),
    buildings: l.buildings.map((b) => ({ id: b.id, label: b.label, siteId: b.siteId })),
    sites: l.sites.map((x, i) => ({ id: x.id, label: x.label, role: i > 0 && wanSites.has(x.id) ? 'remote' : 'primary' })),
    links: l.links.map((k) => ({ id: k.id, from: k.a, to: k.b, kind: LINK_KIND[k.kind], game: { rttMs: k.rttMs, gbps: k.bandwidthGbps } })),
  };
}

/**
 * Session-backed SitePort. Before the session is loaded, actions are applied to an in-memory local port (instant UI)
 * and queued; once loaded they are dispatched in order and the session becomes the only source of truth.
 */
export function createSessionSitePort(load: () => Promise<SiteSessionLike>, current: () => SiteSessionLike | null): SitePort {
  const local = createLocalSitePort(null);
  const listeners = new Set<() => void>();
  const pending: ({ readonly type: string } & Record<string, unknown>)[] = [];
  let loading: Promise<void> | null = null;
  let cache: { site: SiteView; view: SiteLayoutView } | null = null;
  let sig = '';
  const notify = (): void => {
    for (const fn of listeners) fn();
  };
  const signature = (site: SiteView | undefined): string =>
    site ? JSON.stringify([site.blueprint?.id ?? null, site.layout.id, site.layout.rooms.map((r) => [r.id, r.role]), site.layout.rackRooms]) : '';
  const ensure = (): void => {
    loading ??= load().then(
      (sess) => {
        for (const cmd of pending.splice(0)) sess.dispatch(cmd);
        sig = signature(siteOf(sess));
        sess.subscribe(() => {
          const next = signature(siteOf(sess));
          if (next === sig) return;
          sig = next;
          notify();
        });
        notify();
      },
      () => undefined, // session unavailable: stay on the local port
    );
  };
  const resultOf = (r: unknown): SiteResult => {
    const x = r as DispatchResult;
    if (x?.ok) return OK;
    const rej = x?.rejection ?? {};
    return { ok: false, message: rej.message ?? rej.issues?.[0]?.message ?? rej.errors?.[0]?.message ?? 'Akce se nepovedla.' };
  };
  const send = (cmd: { readonly type: string } & Record<string, unknown>, localApply: () => void): SiteResult => {
    const sess = current();
    if (sess) return resultOf(sess.dispatch(cmd));
    localApply();
    pending.push(cmd);
    ensure();
    return OK;
  };
  const sessSite = (): SiteView | undefined => {
    const sess = current();
    return sess ? siteOf(sess) : undefined;
  };
  const layout = (): SiteLayoutView => {
    const site = sessSite();
    if (site) {
      if (cache?.site !== site) cache = { site, view: layoutFromSiteView(site) };
      return cache.view;
    }
    const l = local.layout();
    // before the session: the model's default layout (same as the session will start with)
    return l.preset === null ? { ...presetLayout(DEFAULT_SITE_LAYOUT), preset: null } : l;
  };
  ensure();
  return {
    layout,
    blueprintId: () => {
      const site = sessSite();
      return site ? (site.blueprint?.id ?? null) : local.blueprintId();
    },
    subscribe(fn) {
      listeners.add(fn);
      const offLocal = local.subscribe(fn);
      return () => {
        listeners.delete(fn);
        offLocal();
      };
    },
    choose(preset, blueprintId) {
      const bp = (blueprintId ?? LAYOUT_BLUEPRINTS[preset].blueprintId) as BlueprintId;
      const site = sessSite();
      if (site && site.blueprint?.id === bp && site.layout.id === preset) return OK;
      const cmd: SandboxCommand = { type: 'chooseBlueprint', blueprintId: bp, layoutId: preset };
      return send(cmd, () => local.choose(preset, bp));
    },
    setAz(roomId, az) {
      const cmd: SandboxCommand = { type: 'assignRoomRole', roomId, role: az };
      return send(cmd, () => local.setAz(roomId, az));
    },
    roomOfRack(rackId) {
      const site = sessSite();
      if (!site) return local.roomOfRack(rackId);
      return site.layout.rackRooms[rackId] ?? site.layout.rooms[0]!.id;
    },
    assignRack(rackId, roomId) {
      const site = sessSite();
      if (site && site.layout.rackRooms[rackId] === roomId) return OK;
      const cmd: SandboxCommand = { type: 'moveRackToRoom', rackId, roomId };
      return send(cmd, () => local.assignRack(rackId, roomId));
    },
  };
}

let shared: SitePort | null = null;

/** App-wide site adapter of the player's Sandbox: backed by the shared SandboxSession. */
export function sharedSitePort(): SitePort {
  shared ??= createSessionSitePort(() => sharedSandboxSession(), loadedSandboxSession);
  return shared;
}

/** Tests / "new sandbox": drop the shared site port (pair with resetSharedRoomPort). */
export function resetSharedSitePort(): void {
  shared = null;
}

/**
 * Site port that follows the room screen's mode: the session port for the player's room, a local one for the
 * illustrative demo room (never mixes with the player's state).
 */
export function switchingSitePort(live: SitePort, demo: SitePort, isDemo: () => boolean): SitePort {
  const pick = (): SitePort => (isDemo() ? demo : live);
  return {
    layout: () => pick().layout(),
    blueprintId: () => pick().blueprintId(),
    subscribe(fn) {
      const a = live.subscribe(fn);
      const b = demo.subscribe(fn);
      return () => {
        a();
        b();
      };
    },
    choose: (p, b) => pick().choose(p, b),
    setAz: (r, a) => pick().setAz(r, a),
    roomOfRack: (id) => pick().roomOfRack(id),
    assignRack: (id, r) => pick().assignRack(id, r),
  };
}

/** Room by id, falling back to the first room. */
export function roomOf(layout: SiteLayoutView, roomId: string | undefined): SiteRoomView {
  return layout.rooms.find((r) => r.id === roomId) ?? layout.rooms[0]!;
}

/** Room the door of `roomId` leads to (2-room layouts: the other room; otherwise null = site overview). */
export function doorTarget(layout: SiteLayoutView, roomId: string): string | null {
  return layout.rooms.length === 2 ? layout.rooms.find((r) => r.id !== roomId)!.id : null;
}

/** Plain scene input from the layout + rack tiles. */
export function siteSceneInput(layout: SiteLayoutView, racksOf: (roomId: string) => readonly { gx: number; gy: number }[]): SiteSceneInput {
  return {
    rooms: layout.rooms.map((r) => ({ id: r.id, label: r.label, cols: r.size.cols, rows: r.size.rows, buildingId: r.buildingId, az: r.az ? AZ_LABEL[r.az] : null, witness: r.az === 'witness', racks: racksOf(r.id) })),
    buildings: layout.buildings,
    sites: layout.sites,
    links: layout.links.map((l) => ({ id: l.id, from: l.from, to: l.to, kind: l.kind })),
  };
}

