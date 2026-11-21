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
import type { Tile } from '../../render/room/roomGrid';

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
}

export interface RoomRack {
  readonly id: string;
  readonly label: string;
  readonly heightU: number;
  /** Floor tile; null = still in the backpack. */
  readonly tile: Tile | null;
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
  readonly objectivesHidden: boolean;
  /** Game currency spent (Sandbox money is unlimited). */
  readonly spent: number;
}

export type PortResult =
  | { readonly ok: true; readonly id?: string }
  | { readonly ok: false; readonly message: string; readonly issues?: readonly ValidationIssue[] };

export interface RoomPort {
  readonly source: RoomState['source'];
  state(): RoomState;
  subscribe(fn: () => void): () => void;
  buyItem(catalogItemId: string): PortResult;
  placeRack(rackId: string, tile: Tile): PortResult;
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
  setObjectivesHidden(hidden: boolean): PortResult;
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
interface SessionLike {
  snapshot(): unknown;
  dispatch(cmd: { readonly type: string } & Record<string, unknown>): unknown;
  subscribe(fn: (e: unknown) => void): () => void;
}

/** True when a SandboxSession exposes the physical layer (snapshot.physical). */
export function sessionHasPhysical(session: unknown): session is SessionLike {
  if (!session || typeof session !== 'object') return false;
  const s = session as Partial<SessionLike>;
  if (typeof s.snapshot !== 'function' || typeof s.dispatch !== 'function') return false;
  const snap = s.snapshot.call(session) as Record<string, unknown> | null;
  return !!snap && typeof snap === 'object' && 'physical' in snap;
}

let shared: Promise<RoomPort> | null = null;

/**
 * One room port for the whole Sandbox run. Loads the hardware catalog lazily (BCG dataset ~360 kB,
 * only needed in the room).
 */
export function sharedRoomPort(session?: unknown): Promise<RoomPort> {
  if (!shared) {
    shared = sessionHasPhysical(session)
      ? Promise.resolve(sessionBackend(session))
      : import('./sessionFallback').then((m) => m.createLocalRoomPort());
  }
  return shared;
}

/** Tests / "new sandbox": drop the shared port. */
export function resetSharedRoomPort(): void {
  shared = null;
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
  const toPortRef = (p: PortKey): Record<string, unknown> => ({ deviceId: p.deviceId, port: p.port });
  const memo: { snap?: unknown; state?: RoomState } = {};
  let mapper: ((snap: unknown) => RoomState) | null = null;
  void import('./sessionFallback').then((m) => {
    mapper = m.roomStateFromSessionSnapshot;
  });
  const empty: RoomState = {
    revision: 0, source: 'session',
    catalog: { servers: [], switches: [], racks: [], drives: [], nics: [], datasetFetchedAt: '', datasetRelease: '' },
    racks: [], devices: [], cables: [], inventory: [], issues: [], traffic: [], objectives: [], objectivesHidden: false, spent: 0,
  };
  return {
    source: 'session',
    state() {
      const snap = session.snapshot();
      if (!mapper) return empty;
      if (memo.state && memo.snap === snap) return memo.state;
      const state = mapper(snap);
      memo.snap = snap;
      memo.state = state;
      return state;
    },
    subscribe: (fn) => session.subscribe(() => fn()),
    buyItem: (itemId) => run({ type: 'buyItem', itemId }),
    placeRack: (rackId, tile) => run({ type: 'placeRack', rackId, tile: { gx: tile.gx, gy: tile.gy } }),
    mountDevice: (deviceId, rackId, positionU) => run({ type: 'mountDevice', deviceId, rackId, ...(positionU !== undefined ? { positionU } : {}) }),
    unmountDevice: (deviceId) => run({ type: 'unmountDevice', deviceId }),
    removeItem: (id) => run({ type: 'removeItem', id }),
    connectCable: (from, to) => run({ type: 'connectCable', from: toPortRef(from), to: toPortRef(to) }),
    disconnectCable: (cableId) => run({ type: 'disconnectCable', cableId }),
    setCableMeta: (cableId, meta) => run({ type: 'setCableMeta', cableId, ...(meta.color ? { color: meta.color } : {}), ...(meta.label !== undefined ? { label: meta.label } : {}) }),
    skipObjective: (id) => run({ type: 'skipObjective', id }),
    setObjectivesHidden: (hidden) => run({ type: 'setObjectivesHidden', hidden }),
  };
}
