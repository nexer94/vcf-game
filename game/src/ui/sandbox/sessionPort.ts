/**
 * SINGLE ADAPTER between the server-room UI (room, rack view, shop, HUD) and the Sandbox session.
 *
 * The UI only talks to `RoomPort` and reads `RoomState`. Nothing in the UI decides what VCF allows:
 * placement / cabling are model transitions (game/src/model/physical.ts), issues are model issues,
 * flows are model flows; prices are a game mechanic of the mode layer ("herní cena").
 *
 * Backends:
 *  - `session` – SandboxSession (game/src/modes/sandbox) once it exposes the physical layer
 *    (commands buyItem, placeRack, mountDevice, unmountDevice, removeItem, connectCable, disconnectCable,
 *    skipObjective, setObjectivesHidden; snapshot fields physical / flows / hw / objectives).
 *    All engine names are touched ONLY in `sessionBackend()` below – if engine-dev's final names differ,
 *    only that function changes.
 *  - `local-fallback` – thin local state over the same model transitions (sessionFallback.ts), used until the
 *    session API lands. It holds no VCF rules of its own.
 */
import type { FlowTrafficClass, HwVendor, EsaProfileId, ValidationIssue } from '../../model';
import { validateRackPlacement, type Facing } from '../../model/roomLayout';
import type { SandboxSnapshot } from '../../modes/sandbox/snapshot';
import type { SandboxCommand } from '../../modes/sandbox/types';
import type { Tile } from '../../render/room/roomGrid';
import { roomStateFromSnapshot } from './sessionMapper';

// ---------------------------------------------------------------------------
// View types consumed by the UI
// ---------------------------------------------------------------------------

/** Port on a device: NIC index (vmnicN / switch port index, 0-based) or the BMC port of a server. */
export type PortSide = number | 'bmc';

export interface PortKey {
  readonly deviceId: string;
  readonly port: PortSide;
}

export const portKeyId = (p: PortKey): string => `${p.deviceId}:${p.port}`;
export const samePortKey = (a: PortKey, b: PortKey): boolean => a.deviceId === b.deviceId && a.port === b.port;

export interface ShopServerItem {
  readonly kind: 'server';
  readonly id: string;
  readonly vendor: HwVendor;
  readonly model: string;
  readonly rackUnits: number;
  readonly sockets: number;
  readonly coresPerSocket: number;
  readonly ramGB: number;
  readonly drives: readonly { readonly label: string; readonly count: number; readonly capacityTB: number; readonly iface: string }[];
  readonly capacityTB: number;
  readonly nics: readonly { readonly label: string; readonly count: number; readonly ports: number; readonly speedsGbE: readonly number[] }[];
  readonly nicPorts: number;
  readonly maxNicGbE: number;
  readonly boot: string;
  /** vSAN ESA profile derived by the model (15 §6.1); undefined = below SM. */
  readonly profile?: EsaProfileId;
  readonly profileNetworkLimited: boolean;
  /** BCG lists "ESXi 9.1 (vSAN 9.1)" as supported release for the model. */
  readonly certified91: boolean;
  readonly bcgUrl: string;
  readonly price: number;
  /** Starter configuration status (15 B.3): ok ✓, dev = deviation, req / ext = trap (hidden in v3). */
  readonly starterStatus?: 'ok' | 'dev' | 'req' | 'ext';
  /** One-sentence note of the configuration (DEV tooltip). */
  readonly note?: string;
  /** Height in U is the game default 2U [SIMPL] (true) or verified from the vendor spec sheet (false). */
  readonly rackUnitsGameDefault?: boolean;
  readonly rackUnitsUrl?: string;
}

export interface ShopSwitchItem {
  readonly kind: 'switch';
  readonly id: string;
  readonly label: string;
  readonly ports: number;
  readonly speedsGbE: readonly number[];
  readonly maxMtu: number;
  readonly defaultPortMtu: number;
  readonly rackUnits: number;
  readonly price: number;
}

export interface ShopRackItem {
  readonly kind: 'rack';
  readonly id: string;
  readonly label: string;
  readonly heightU: number;
  readonly price: number;
}

export interface ShopPartItem {
  readonly kind: 'drive' | 'nic';
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly oem?: string;
  readonly bcgUrl?: string;
  readonly price: number;
}

export interface ShopCatalog {
  readonly servers: readonly ShopServerItem[];
  readonly switches: readonly ShopSwitchItem[];
  readonly racks: readonly ShopRackItem[];
  readonly drives: readonly ShopPartItem[];
  readonly nics: readonly ShopPartItem[];
  readonly datasetFetchedAt: string;
  readonly datasetRelease: string;
  /** v3 vendor shelves (engine); undefined = group in the UI by vendor. */
  readonly shelves?: readonly VendorShelf[];
}

/** Shop v3 shelf: vendor -> offered configurations (✓ / DEV) and hidden traps (UX 19.1). */
export interface VendorShelf {
  readonly vendor: HwVendor;
  readonly items: readonly string[];
  readonly traps: readonly string[];
}

export interface RoomRack {
  readonly id: string;
  readonly label: string;
  readonly heightU: number;
  /** Floor tile; null = still in the backpack. */
  readonly tile: Tile | null;
  /** Where the rack front points ([GAME] room layout rules; engine rackTiles rotation). Default 'S'. */
  readonly facing?: Facing;
}

/** Valid tile for a rack with the facings the [GAME] room layout rules allow (engine hints). */
export interface RackTileHint {
  readonly tile: Tile;
  readonly facings: readonly Facing[];
}

/** [GAME] rack placement view of one room (engine snapshot site.layout.rooms[].placement). */
export interface RoomPlacement {
  readonly roomId: string;
  readonly cols: number;
  readonly rows: number;
  readonly rackSlots: number;
  readonly freeSlots: number;
  readonly racks: readonly { readonly rackId: string; readonly tile: Tile; readonly facing: Facing }[];
  readonly aisles: { readonly cold: readonly Tile[]; readonly hot: readonly Tile[] };
  /** Ghost hints for a NEW rack per rack model id. */
  readonly hintsByModel: Readonly<Record<string, readonly RackTileHint[]>>;
}

/** Result of checking one tile against the model's [GAME] rules (reasons = model issues, scope game-scope). */
export interface RackTileCheck {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface DeviceNicPort {
  readonly index: number;
  /** "NIC 1" before ESX, "vmnic0" after (UX §9.2). */
  readonly label: string;
  readonly speedsGbE: readonly number[];
}

export interface RoomDevice {
  readonly id: string;
  readonly kind: 'server' | 'switch';
  readonly label: string;
  readonly catalogItemId: string;
  readonly vendor?: HwVendor;
  readonly modelLabel: string;
  readonly heightU: number;
  readonly mount?: { readonly rackId: string; readonly positionU: number };
  /** Server NIC ports. */
  readonly nicPorts: readonly DeviceNicPort[];
  /** Server BMC (vendor label only; game scope – UX §15). */
  readonly bmc?: { readonly label: string };
  /** Switch port count (0 for servers). */
  readonly switchPorts: number;
  readonly switchSpeedsGbE?: readonly number[];
  readonly esxInstalled: boolean;
  /** v3: role of a switch – rack ToR (pre-installed at the top of each rack) or the room's OOB switch (game). */
  readonly role?: 'tor' | 'oob';
  /** v3: pre-installed by the game (ToR-A, OOB switch) – UI badge "předinstalováno · herní". */
  readonly preinstalled?: boolean;
  /** v3 (UX 19.4): NIC slots of a server; slot count is a game value [SIMPL]. Undefined = engine has no slots yet. */
  readonly nicSlots?: readonly NicSlotView[];
  /** Server status (LED in the rack view): powered ESX, installing, no OS. */
  readonly status?: string;
}

export interface NicSlotView {
  readonly slot: number;
  /** Installed NIC (undefined = free slot "[+]"). */
  readonly nic?: { readonly partId: string; readonly label: string; readonly ports: number; readonly speedsGbE: readonly number[] };
}

/** One certified NIC choice for a free slot (model's ServerModel.nics ∩ part catalog – UX 19.4). */
export interface NicChoice {
  readonly partId: string;
  readonly label: string;
  readonly ports: number;
  readonly speedsGbE: readonly number[];
  readonly price: number;
  /** ToRs of the rack without a common speed ("⚠ Nespojíš s ToR-A (25G)" – game / physical, still allowed). */
  readonly incompatibleTors?: readonly { readonly label: string; readonly speedsGbE: readonly number[] }[];
}

export interface RoomCable {
  readonly id: string;
  readonly a: PortKey;
  readonly b: PortKey;
  readonly linkUp: boolean;
  readonly speedGbE?: number;
  /** One end is a BMC port (out of VCF scope – game). */
  readonly bmc: boolean;
  /** Cosmetic colour id (CABLE_COLORS) and label – player's marking only. */
  readonly color: CableColorId;
  readonly label: string;
}

export interface CableTraffic {
  readonly cableId: string;
  readonly speedGbE?: number;
  readonly byClass: Readonly<Partial<Record<FlowTrafficClass, number>>>;
  readonly utilization: number;
}

export type ObjectiveKind = 'doc-required' | 'doc-recommended' | 'game-step' | 'game-optional';
export type ObjectiveStatus = 'todo' | 'progress' | 'done' | 'skipped' | 'problem';

export interface ObjectiveView {
  readonly id: string;
  readonly title: string;
  readonly kind: ObjectiveKind;
  readonly status: ObjectiveStatus;
  readonly progress?: { readonly done: number; readonly total: number };
  readonly specRef?: string;
  readonly docUrl?: string;
  /** Tracker group title (engine objectives). */
  readonly group?: string;
  /** "Ukaž mi" hint of the objective (opaque data from scenarios/objectives, interpreted by ui/sandbox/showMe.ts). */
  readonly showMe?: Readonly<Record<string, string>>;
  /** Speech bubble of the step (UX 26.1 ObjectiveBubble) – Career levels. */
  readonly bubble?: ObjectiveBubbleView;
  /** Career points of the step (game mechanic). */
  readonly points?: number;
  /** Career bonus step (★, only adds points). */
  readonly bonus?: boolean;
}

/** UX 26.1: 1–2 sentences, anchor 'avatar' | 'object:<kind>:<id|first>' | 'ui:<id>', registry keys for "Zdroj". */
export interface ObjectiveBubbleView {
  readonly text: string;
  readonly anchor: string;
  readonly sourceKeys?: readonly string[];
}

export interface InventoryEntry {
  /** Instance id (rack / device id). */
  readonly id: string;
  readonly kind: 'rack' | 'server' | 'switch';
  readonly label: string;
  readonly catalogItemId: string;
}

export interface RoomState {
  readonly revision: number;
  readonly source: 'session' | 'local-fallback';
  readonly catalog: ShopCatalog;
  readonly racks: readonly RoomRack[];
  readonly devices: readonly RoomDevice[];
  readonly cables: readonly RoomCable[];
  /** Bought, not placed / mounted ("V batohu"). */
  readonly inventory: readonly InventoryEntry[];
  /** Model issues for the physical layer (subject = device id). */
  readonly issues: readonly ValidationIssue[];
  readonly traffic: readonly CableTraffic[];
  readonly objectives: readonly ObjectiveView[];
  /** "Další krok" chosen by the tracker (engine); undefined = first unfinished objective. */
  readonly nextObjectiveId?: string;
  readonly objectivesHidden: boolean;
  /** Game currency spent (Sandbox money is unlimited). */
  readonly spent: number;
  /** Room undo / redo availability (session only). */
  readonly undo?: { readonly canUndo: boolean; readonly canRedo: boolean };
  /** Switch port connected to the company network (GAME abstraction "Síť firmy"). */
  readonly companyNetwork?: { readonly switchId: string; readonly port: number };
  /** v3 (UX 19.5): reserved U for the recommended second ToR per rack (rackId -> U). */
  readonly torReservations?: Readonly<Record<string, number>>;
  /** Career: budget (game currency, finite); undefined = Sandbox (∞). */
  readonly budget?: number;
  /** Career: points so far (game). */
  readonly points?: number;
}

export type PortResult =
  | { readonly ok: true; readonly id?: string; readonly warnings?: readonly ValidationIssue[] }
  | { readonly ok: false; readonly message: string; readonly issues?: readonly ValidationIssue[] };

export interface RoomPort {
  readonly source: RoomState['source'];
  state(): RoomState;
  subscribe(fn: () => void): () => void;
  buyItem(catalogItemId: string): PortResult;
  /**
   * `roomId` = room of the site layout (session backend; the local fallback has one room and ignores it).
   * `facing` = where the rack front points (session backend; the fallback ignores it).
   */
  placeRack(rackId: string, tile: Tile, roomId?: string, facing?: Facing): PortResult;
  /** Turn a placed rack (session backend only). */
  rotateRack?(rackId: string, facing: Facing): PortResult;
  /** [GAME] placement view of a room (session backend only; undefined for an unknown room). */
  roomPlacement?(roomId: string): RoomPlacement | undefined;
  /** Hints for moving / rotating an already placed rack (its own tile counts as free). */
  rackHints?(roomId: string, rackId: string): readonly RackTileHint[] | undefined;
  /** Why a tile is (not) valid for a rack – model validateRackPlacement over the snapshot grid. */
  checkRackTile?(roomId: string, tile: Tile, facing: Facing, rackId?: string): RackTileCheck | undefined;
  /** `positionU` omitted = lowest free position (model firstFreeU). */
  mountDevice(deviceId: string, rackId: string, positionU?: number): PortResult;
  unmountDevice(deviceId: string): PortResult;
  /** Sell / remove an item (Sandbox: 100 % refund). */
  removeItem(id: string): PortResult;
  connectCable(from: PortKey, to: PortKey): PortResult;
  disconnectCable(cableId: string): PortResult;
  /** Cosmetic only. */
  setCableMeta(cableId: string, meta: { readonly color?: CableColorId; readonly label?: string }): PortResult;
  skipObjective(id: string): PortResult;
  /** v3 (UX 19.4): certified NICs for a free slot of a server (engine E3); undefined = not supported yet. */
  nicChoices?(serverId: string): readonly NicChoice[] | undefined;
  addNic?(serverId: string, slot: number, partId: string): PortResult;
  removeNic?(serverId: string, slot: number): PortResult;
  /** v3 (UX 19.5): add the recommended second ToR into the reserved U (engine E1). */
  addSecondTor?(rackId: string): PortResult;
  /** Career: "Ukaž" hint used on an objective (game penalty). */
  useHint?(objectiveId: string, kind: 'show' | 'solution'): void;
  setObjectivesHidden(hidden: boolean): PortResult;
  /**
   * Full session access for the object panels (server / switch / DNS / host detail). Only the session backend has
   * it; the local fallback (demo room) does not – panels then show a game-limit note.
   */
  readonly ops?: SessionOps;
}

/** Session commands + snapshot for the object panels. Every VCF decision stays in the engine / model. */
export interface SessionOps {
  snapshot(): SandboxSnapshot;
  dispatch(cmd: SandboxCommand): PortResult;
}

// ---------------------------------------------------------------------------
// Cosmetic cable colours (player's own marking – never traffic colours, UX §9.4)
// ---------------------------------------------------------------------------

export const CABLE_COLORS = {
  neutral: { label: 'neutrální', color: 0x6b6880 },
  black: { label: 'černá', color: 0x26232f },
  white: { label: 'bílá', color: 0xf4f2fa },
  yellow: { label: 'žlutá', color: 0xe0b400 },
  pink: { label: 'růžová', color: 0xe86fb0 },
  brown: { label: 'hnědá', color: 0x8a5a3c },
} as const;
export type CableColorId = keyof typeof CABLE_COLORS;
export const isCableColorId = (s: string | undefined): s is CableColorId => !!s && s in CABLE_COLORS;

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

/**
 * Engine contract assumed for the session backend (names announced by engine-dev for Sprint 1).
 * Kept structural so this file compiles before the session API exists.
 */
export interface SessionLike {
  snapshot(): unknown;
  dispatch(cmd: { readonly type: string } & Record<string, unknown>): unknown;
  subscribe(fn: (e: unknown) => void): () => void;
}

/** True when a SandboxSession exposes the physical layer (snapshot.physical). */
export function sessionHasPhysical(session: unknown): session is SessionLike {
  if (!session || typeof session !== 'object') return false;
  const s = session as Partial<SessionLike>;
  if (typeof s.snapshot !== 'function' || typeof s.dispatch !== 'function') return false;
  try {
    const snap = s.snapshot.call(session) as Record<string, unknown> | null;
    return !!snap && typeof snap === 'object' && 'physical' in snap && !!snap['physical'];
  } catch {
    return false;
  }
}

/**
 * Play mode of the room screen (user decision 2026-11-22): 'sandbox' = free simulation without objectives / bubbles,
 * 'career' = story level with checklist + bubbles. Each mode has its OWN session (never mixes states).
 */
export type PlayMode = 'sandbox' | 'career';
let playMode: PlayMode = 'sandbox';
export const currentPlayMode = (): PlayMode => playMode;
export function setPlayMode(m: PlayMode): void {
  playMode = m;
}

interface Slot {
  port: Promise<RoomPort> | null;
  session: Promise<SessionLike> | null;
  loaded: SessionLike | null;
  attached: boolean;
}
const slots: Record<PlayMode, Slot> = {
  sandbox: { port: null, session: null, loaded: null, attached: false },
  career: { port: null, session: null, loaded: null, attached: false },
};

/** Career level id of the career session (one level at a time). */
let careerLevelId = 'c1-l1-single-site';
export function setCareerLevel(id: string): void {
  if (id !== careerLevelId) resetSharedRoomPort('career');
  careerLevelId = id;
}
export const currentCareerLevel = (): string => careerLevelId;

/** Career snapshot fields the UI reads (modes/career CareerView). */
export interface CareerInfo {
  readonly budget: { readonly total: number; readonly spent: number; readonly remaining: number };
  readonly score: { readonly points: number; readonly maxPoints: number; readonly bonusPoints: number; readonly stars: number; readonly penalties: { readonly hints: number; readonly validation: number } };
  readonly completed: boolean;
}

/**
 * Career level session (modes/career CareerSession) adapted to the Sandbox session shape the room adapter uses:
 * snapshot() = the Sandbox snapshot + `career` (budget, score, evaluation); dispatch goes through the career layer
 * (budget, locked decisions). `useHint` books the "Ukaž" penalty (game).
 */
async function createCareerSession(): Promise<unknown> {
  const c = await import('../../modes/career');
  const level = c.careerLevel(careerLevelId);
  if (!level) throw new Error(`unknown career level ${careerLevelId}`);
  const cs = new c.CareerSession(level);
  let memo: { src: unknown; out: unknown } | null = null;
  return {
    snapshot() {
      const snap = cs.snapshot();
      if (memo?.src !== snap) memo = { src: snap, out: { ...snap.sandbox, career: snap.career } };
      return memo.out;
    },
    dispatch: (cmd: Parameters<typeof cs.dispatch>[0]) => cs.dispatch(cmd),
    subscribe: (fn: (e: unknown) => void) => cs.subscribe(fn),
    attachTo: (engine: Parameters<typeof cs.attachTo>[0]) => cs.attachTo(engine),
    useHint: (id: string, kind: 'show' | 'solution') => cs.useHint(id, kind),
    rackPlacementHints: (roomId: string, o: { rackId: string }) => (cs.sandbox as unknown as { rackPlacementHints(r: string, o: { rackId: string }): unknown }).rackPlacementHints(roomId, o),
  };
}

/**
 * The ONE session of the current play mode (lazy: the hardware catalog / BCG dataset is loaded with it). Shared by the
 * room port and the site port (siteLayout.ts). `engine` attaches the session to the shared clock once.
 */
export function sharedSandboxSession(engine?: { attach(system: never): () => void }, mode: PlayMode = playMode): Promise<SessionLike> {
  const slot = slots[mode];
  slot.session ??= import('../../modes/sandbox').then(async (m) => {
    const session = mode === 'career' ? await createCareerSession() : new m.SandboxSession(m.SANDBOX_V3_OPTIONS);
    if (!sessionHasPhysical(session)) throw new Error('session without physical layer');
    slot.loaded = session;
    return session;
  });
  if (engine && !slot.attached) {
    slot.attached = true;
    slot.session.then((s) => (s as unknown as { attachTo(e: unknown): void }).attachTo(engine), () => undefined);
  }
  return slot.session;
}

/** The shared session of the current play mode once loaded (null before / when it failed). */
export const loadedSandboxSession = (mode: PlayMode = playMode): SessionLike | null => slots[mode].loaded;

/**
 * One room port per play mode. Uses the mode's session (attached to the shared engine clock) when it exposes the
 * physical layer; otherwise the local fallback. Both load the hardware catalog lazily (BCG dataset ~360 kB).
 */
export function sharedRoomPort(engine?: { attach(system: never): () => void }, mode: PlayMode = playMode): Promise<RoomPort> {
  const slot = slots[mode];
  slot.port ??= sharedSandboxSession(engine, mode)
    .then((session) => sessionBackend(session))
    .catch(() => import('./sessionFallback').then((m) => m.createLocalRoomPort()));
  if (engine) sharedSandboxSession(engine, mode);
  return slot.port;
}

/** Fresh isolated port for the illustrative demo room (never mixes with the player's state). */
export function createDemoRoomPort(): Promise<RoomPort> {
  return import('./sessionFallback').then((m) => m.createLocalRoomPort());
}

/** Tests / "new sandbox" / "Znovu" in Career: drop the shared port and session of a mode (default: all). */
export function resetSharedRoomPort(mode?: PlayMode): void {
  for (const k of mode ? [mode] : (Object.keys(slots) as PlayMode[])) slots[k] = { port: null, session: null, loaded: null, attached: false };
}

/**
 * Session-backed port. THE ONLY PLACE that knows engine command / snapshot names.
 * The snapshot mapping is delegated to the fallback's mapper over the model PhysicalState so both backends
 * produce identical RoomState shapes.
 */
function sessionBackend(session: SessionLike): RoomPort {
  type R = { ok: boolean; created?: readonly string[]; rejection?: { message?: string; issues?: readonly ValidationIssue[]; errors?: readonly ValidationIssue[] } };
  const run = (cmd: { readonly type: string } & Record<string, unknown>): PortResult => {
    const r = session.dispatch(cmd) as R;
    if (r.ok) return r.created?.[0] !== undefined ? { ok: true, id: r.created[0] } : { ok: true };
    const rej = r.rejection ?? {};
    return { ok: false, message: rej.message ?? rej.issues?.[0]?.message ?? 'Akce se nepovedla.', ...(rej.issues ? { issues: rej.issues } : {}) };
  };
  const ops: SessionOps = {
    snapshot: () => session.snapshot() as SandboxSnapshot,
    dispatch: (cmd) => {
      const r = session.dispatch(cmd as unknown as { readonly type: string } & Record<string, unknown>) as R & { warnings?: readonly ValidationIssue[] };
      if (r.ok) return { ok: true, ...(r.created?.[0] !== undefined ? { id: r.created[0] } : {}), ...(r.warnings?.length ? { warnings: r.warnings } : {}) };
      const rej = r.rejection ?? {};
      const issues = rej.issues ?? rej.errors;
      return { ok: false, message: rej.message ?? issues?.[0]?.message ?? 'Akce se nepovedla.', ...(issues ? { issues } : {}) };
    },
  };
  const toPortRef = (p: PortKey): Record<string, unknown> => ({ deviceId: p.deviceId, port: p.port });
  const snap = (): SandboxSnapshot => session.snapshot() as SandboxSnapshot;
  /** Engine [GAME] placement view of a room (snapshot site.layout.rooms[].placement). */
  const placementView = (roomId: string) => snap().site?.layout?.rooms.find((r) => r.id === roomId)?.placement;
  const placedRack = (rackId: string): boolean => !!snap().physical?.racks.find((r) => r.id === rackId)?.placed;
  const memo: { snap?: unknown; state?: RoomState } = {};
  const empty: RoomState = {
    revision: 0, source: 'session',
    catalog: { servers: [], switches: [], racks: [], drives: [], nics: [], datasetFetchedAt: '', datasetRelease: '' },
    racks: [], devices: [], cables: [], inventory: [], issues: [], traffic: [], objectives: [], objectivesHidden: false, spent: 0,
  };
  return {
    source: 'session',
    ops,
    state() {
      const snap = session.snapshot();
      if (memo.state && memo.snap === snap) return memo.state;
      const state = roomStateFromSnapshot(snap) ?? empty;
      memo.snap = snap;
      memo.state = state;
      return state;
    },
    subscribe: (fn) => session.subscribe(() => fn()),
    buyItem: (itemId) => run({ type: 'buyItem', itemId }),
    placeRack: (rackId, tile, roomId, facing) =>
      run({ type: 'placeRack', ...(placedRack(rackId) ? { rackId } : { inventoryId: rackId }), tile: { gx: tile.gx, gy: tile.gy }, ...(roomId !== undefined ? { roomId } : {}), ...(facing ? { facing } : {}) }),
    rotateRack: (rackId, facing) => run({ type: 'rotateRack', rackId, facing }),
    roomPlacement: (roomId) => {
      const v = placementView(roomId);
      if (!v) return undefined;
      return {
        roomId: v.roomId, cols: v.grid.cols, rows: v.grid.rows, rackSlots: v.grid.rackSlots, freeSlots: v.freeSlots,
        racks: v.racks.map((r) => ({ rackId: r.rackId, tile: r.tile, facing: r.facing })),
        aisles: { cold: v.aisles.cold, hot: v.aisles.hot },
        hintsByModel: v.placement,
      };
    },
    rackHints: (roomId, rackId) => (session as unknown as { rackPlacementHints(r: string, o: { rackId: string }): readonly RackTileHint[] | undefined }).rackPlacementHints(roomId, { rackId }),
    checkRackTile: (roomId, tile, facing, rackId) => {
      const v = placementView(roomId);
      if (!v) return undefined;
      const r = validateRackPlacement(v.grid, v.racks, { rackId: rackId ?? '__candidate__', tile: { gx: tile.gx, gy: tile.gy }, facing });
      return { ok: r.ok, issues: r.issues };
    },
    mountDevice: (deviceId, rackId, positionU) => run({ type: 'mountDevice', inventoryId: deviceId, rackId, ...(positionU !== undefined ? { positionU } : {}) }),
    unmountDevice: (deviceId) => run({ type: 'unmountDevice', deviceId }),
    removeItem: (id) => run({ type: 'removeItem', id }),
    connectCable: (from, to) => run({ type: 'connectCable', from: toPortRef(from), to: toPortRef(to) }),
    disconnectCable: (cableId) => run({ type: 'disconnectCable', cableId }),
    setCableMeta: (cableId, meta) => run({ type: 'setCableMeta', cableId, ...(meta.color ? { color: meta.color } : {}), ...(meta.label !== undefined ? { label: meta.label } : {}) }),
    skipObjective: (id) => run({ type: 'skipObjective', id }),
    nicChoices: (serverId) => nicChoicesOf(snap(), serverId),
    addNic: (serverId, slot, partId) => run({ type: 'addNic', serverId, slot, nicPartId: partId }),
    removeNic: (serverId, slot) => run({ type: 'removeNic', serverId, slot }),
    addSecondTor: (rackId) => run({ type: 'addTor', rackId }),
    ...(typeof (session as { useHint?: unknown }).useHint === 'function'
      ? { useHint: (id: string, kind: 'show' | 'solution') => (session as unknown as { useHint(i: string, k: string): void }).useHint(id, kind) }
      : {}),
    setObjectivesHidden: (hidden) => run({ type: 'setObjectivesHidden', hidden }),
  };
}

/**
 * Certified NIC choices for a server (UX 19.4): the engine's own list when the server view has one (`nicChoices`),
 * else the model's BOM NIC names (ServerModel.nics) matched with the part catalog. Nothing else.
 */
export function nicChoicesOf(snap: SandboxSnapshot, serverId: string): readonly NicChoice[] | undefined {
  const p = snap.physical;
  const srv = p?.servers.find((x) => x.id === serverId);
  if (!p || !srv) return undefined;
  if (Array.isArray(srv.nicOptions))
    return srv.nicOptions.map((o) => ({ partId: o.partId, label: o.label, ports: o.ports, speedsGbE: o.speedsGbE, price: o.price, incompatibleTors: o.incompatibleTors.map((t: { readonly label: string; readonly speedsGbE: readonly number[] }) => ({ label: t.label, speedsGbE: t.speedsGbE })) }));
  const nicItems = p.catalog.items.filter((x): x is Extract<typeof x, { kind: 'nic' }> => x.kind === 'nic');
  const byId = new Map(nicItems.map((x) => [x.id, x]));
  const choice = (it: (typeof nicItems)[number]): NicChoice => ({ partId: it.id, label: it.part.bomName, ports: it.part.ports, speedsGbE: it.part.speedsGbE, price: it.price });
  void byId;
  const model = p.catalog.serverModels.find((m) => m.id === srv.modelId) as ({ nics?: readonly string[] } & object) | undefined;
  if (!model?.nics) return undefined;
  const names = new Set(model.nics);
  return nicItems.filter((x) => names.has(x.part.bomName)).map(choice);
}
