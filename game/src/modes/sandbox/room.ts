/**
 * Server room reducer (physical layer): shop, racks, mounting, cabling, switch ports, server hardware, ESX install
 * on physical servers, DCUI management network, BMC, company network, undo / redo.
 *
 * VCF / hardware rules come ONLY from the model (model/physical.ts, model/hardware.ts, model/bringup.ts) and their
 * issues are returned unchanged (`kind: 'validation'`). Rules of this file are GAME rules (room / flow), reported as
 * `kind: 'flow'`:
 *  - devices are cabled only while mounted; unmounting / removing a device disconnects its cables;
 *  - a placed rack must be empty to go back to the inventory;
 *  - a server busy with a task (ESX install) cannot be moved, removed, reconfigured or reinstalled;
 *  - servers of a deployed / deploying management domain cannot be moved, removed, reconfigured or reinstalled
 *    (Day 2 host operations are not modelled yet);
 *  - CPU / RAM / drives / NICs are edited before ESX is installed; the model id of a server cannot change;
 *  - the company network uplink port is reserved (no cable into it);
 *  - cables are free in the Sandbox (UX §9.1); spare parts are consumed by configureServer before buying new ones.
 * Missing model helpers implemented here as game logic (reported to domain-modeler): unmount / remove device,
 * remove rack, BMC IP.
 *
 * Money: unlimited in the Sandbox, the spent game currency is recorded (economy/prices.ts – fictional).
 */
import {
  type Cable,
  type EsxHostNetwork,
  type Facing,
  type HwVendor,
  type PhysicalServer,
  type PhysicalState,
  type PortRef,
  type ServerConfig,
  type SwitchPortConfig,
  type ValidationIssue,
  addRack,
  addServer,
  addSwitch,
  bmcReachable,
  configureServerManagementNetwork,
  connectCable,
  disconnectCable,
  emptyConfigFor,
  emptyPhysicalState,
  firstFreeU,
  issue,
  mountDevice,
  parseIpv4,
  setBmcHostInterface,
  setBmcTag,
  setHostSwitchMtu,
  setStandardSwitchUplinks,
  setSwitchPortConfig,
  setVmkMtu,
  validateMount,
  validateServerConfig,
  assignRoomRole,
  moveRackToRoom,
  roomOfRack,
  sitesOf,
  validateRoomCapacity,
} from '../../model';
import { CABLE_ITEM_ID, itemPrice, serverConfigPrice } from '../economy';
import { netContextOf } from './roomNet';
import { isOobSwitch, syncOob } from './oob';
import { isAzRole } from './site';
import { checkRackPlacement, facingOfTile, isFacing, occupiesSlot, tileWithFacing } from './rackLayout';
import { DEFAULT_TOR_MODEL_ID, isTorModel, provisionTor, reservedTorU, torBPosition, torSwitchId } from './tor';
import { cardsToNics, certifiedNicParts, nicCards, nicSlotCount } from './nicSlots';
import { type SandboxContext, Tx, flow, invalid, no, ok } from './tx';
import type { CableEndInput, CommandResult, RoomTile, SandboxCommand, SandboxRoomState, SandboxState, SwitchPortInput } from './types';

/** ESX version recorded when the player does not choose one and no `rules.requiredEsxVersion` is set (GAME label). */
export const ESX_VERSION_GAME_DEFAULT = '9.1 (verze podle VCF Release Notes – herní označení)';

/**
 * Vendors whose BMC the documentation lists for remote ESX installation (25 §10.6 [U68]): Dell DRAC, HPE iLO,
 * Lenovo XCC. Cisco IMC and Supermicro are not in the table. Minimum firmware is not modelled.
 */
export const BMC_REMOTE_INSTALL_VENDORS: readonly HwVendor[] = ['Dell', 'HPE', 'Lenovo'];
export const BMC_REMOTE_INSTALL_REF = '25 §10.6 [U68]';

export const ROOM_HISTORY_LIMIT = 50;
const MAX_QTY = 64;
const LABEL_MAX = 24;

export function emptyRoom(): SandboxRoomState {
  return { physical: emptyPhysicalState(), rackTiles: {}, parts: [], cableMeta: {}, mgmtTests: {}, economy: { spent: 0, ledger: [] } };
}

// ---------------------------------------------------------------------------
// Command classification
// ---------------------------------------------------------------------------

export type PhysicalInstallCommand = Extract<SandboxCommand, { type: 'installEsx'; serverId: string }>;

const ROOM_TYPES = [
  'buyItem',
  'placeRack',
  'mountDevice',
  'unmountDevice',
  'removeItem',
  'connectCable',
  'disconnectCable',
  'setCableMeta',
  'setSwitchPort',
  'connectCompanyNetwork',
  'disconnectCompanyNetwork',
  'undoRoom',
  'redoRoom',
  'configureServer',
  'configureMgmtNetwork',
  'testManagementNetwork',
  'setHostUplinks',
  'setHostSwitchMtu',
  'setVmkMtu',
  'configureBmc',
  'moveRackToRoom',
  'rotateRack',
  'assignRoomRole',
  'addTor',
  'addNic',
  'removeNic',
] as const;
type RoomType = (typeof ROOM_TYPES)[number];
export type RoomCommand = Extract<SandboxCommand, { type: RoomType }> | PhysicalInstallCommand;

export function isRoomCommand(cmd: SandboxCommand): cmd is RoomCommand {
  return (ROOM_TYPES as readonly string[]).includes(cmd.type) || (cmd.type === 'installEsx' && 'serverId' in cmd);
}

/** Room edits that can be undone. Every other change of `room` clears the history (it would be reverted by undo). */
const UNDOABLE: ReadonlySet<string> = new Set([
  'buyItem',
  'placeRack',
  'mountDevice',
  'unmountDevice',
  'removeItem',
  'connectCable',
  'disconnectCable',
  'setCableMeta',
  'setSwitchPort',
  'connectCompanyNetwork',
  'disconnectCompanyNetwork',
  'configureServer',
  'configureBmc',
  'moveRackToRoom',
  'rotateRack',
  'assignRoomRole',
  'addTor',
  'addNic',
  'removeNic',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
const byId = <T extends { readonly id: string }>(xs: readonly T[], id: string): T | undefined => xs.find((x) => x.id === id);

export function deployedHostFqdns(s: SandboxState): Set<string> {
  return s.deployment.status === 'completed' || s.deployment.status === 'deploying' ? new Set(s.spec.esxHosts.map((h) => h.fqdn)) : new Set();
}

export const serverInDeployedDomain = (s: SandboxState, srv: PhysicalServer): boolean =>
  srv.esx.network !== undefined && deployedHostFqdns(s).has(srv.esx.network.hostnameFqdn);

/** Running task bound to a server (ESX install / DCUI test). */
export function serverTask(s: SandboxState, serverId: string): SandboxState['tasks'][number] | undefined {
  return s.tasks.find((t) => (t.payload.kind === 'esx-install' || t.payload.kind === 'mgmt-network-test') && t.payload.serverId === serverId);
}

const roomTaskRunning = (s: SandboxState): boolean => s.tasks.some((t) => t.payload.kind === 'esx-install' || t.payload.kind === 'mgmt-network-test');

function setRoom(tx: Tx, room: SandboxRoomState, undoable: boolean): void {
  const before = tx.s.room;
  const undo = undoable ? [...tx.s.roomHistory.undo, before].slice(-ROOM_HISTORY_LIMIT) : [];
  tx.s = { ...tx.s, room, roomHistory: { undo, redo: [] } };
}

const withPhysical = (room: SandboxRoomState, physical: PhysicalState): SandboxRoomState => ({ ...room, physical });

function charge(tx: Tx, room: SandboxRoomState, kind: 'buy' | 'sell' | 'reconfigure', itemId: string, qty: number, amount: number): SandboxRoomState {
  const seq = tx.s.seq.ledger + 1;
  tx.s = { ...tx.s, seq: { ...tx.s.seq, ledger: seq } };
  const ledger = [...room.economy.ledger, { seq, atMs: tx.s.timeMs, kind, itemId, qty, amount }].slice(-200);
  return { ...room, economy: { spent: room.economy.spent + amount, ledger } };
}

/** Next free host id (shared with abstract planning hosts: esx01, esx02 …). */
function nextHostId(tx: Tx): string {
  let n = tx.s.seq.host;
  const taken = (id: string) => tx.s.env.hosts.some((h) => h.id === id) || tx.s.room.physical.servers.some((x) => x.id === id) || tx.s.room.physical.switches.some((x) => x.id === id);
  let id: string;
  do {
    n += 1;
    id = `esx${pad(n)}`;
  } while (taken(id));
  tx.s = { ...tx.s, seq: { ...tx.s.seq, host: n } };
  return id;
}

function nextId(tx: Tx, key: 'switch' | 'rack' | 'cable' | 'part', prefix: string, width: number, taken: (id: string) => boolean): string {
  let n = tx.s.seq[key];
  let id: string;
  do {
    n += 1;
    id = `${prefix}${pad(n, width)}`;
  } while (taken(id));
  tx.s = { ...tx.s, seq: { ...tx.s.seq, [key]: n } };
  return id;
}

const cablesOfDevice = (p: PhysicalState, deviceId: string): Cable[] =>
  p.cables.filter((c) => [c.a, c.b].some((e) => (e.kind === 'switch' ? e.switchId === deviceId : e.serverId === deviceId)));

function dropCables(room: SandboxRoomState, ids: readonly string[]): SandboxRoomState {
  if (ids.length === 0) return room;
  let physical = room.physical;
  for (const id of ids) physical = disconnectCable(physical, id);
  const cableMeta = { ...room.cableMeta };
  for (const id of ids) delete cableMeta[id];
  return { ...room, physical, cableMeta };
}

/** Unmount (game logic – model has no unmount): mount removed, cables disconnected, company uplink dropped. */
function unmountInRoom(room: SandboxRoomState, deviceId: string): SandboxRoomState {
  let r = dropCables(room, cablesOfDevice(room.physical, deviceId).map((c) => c.id));
  const p = r.physical;
  const servers = p.servers.map((x) => (x.id === deviceId ? stripMount(x) : x));
  const switches = p.switches.map((x) => (x.id === deviceId ? stripMount(x) : x));
  r = withPhysical(r, { ...p, servers, switches });
  if (r.companyNetwork?.switchId === deviceId) {
    const { companyNetwork: _c, ...rest } = r;
    void _c;
    r = rest;
  }
  return r;
}

function stripMount<T extends { readonly mount?: unknown }>(x: T): T {
  const { mount: _m, ...rest } = x;
  void _m;
  return rest as T;
}

function resolveEnd(p: PhysicalState, e: CableEndInput): PortRef | string {
  const srv = byId(p.servers, e.deviceId);
  if (srv) return e.port === 'bmc' ? { kind: 'server-bmc', serverId: srv.id } : { kind: 'server-nic', serverId: srv.id, vmnic: e.port };
  const sw = byId(p.switches, e.deviceId);
  if (sw) return e.port === 'bmc' ? 'Switch nemá port BMC.' : { kind: 'switch', switchId: sw.id, port: e.port };
  return `Zařízení ${e.deviceId} neexistuje.`;
}

const isMounted = (p: PhysicalState, deviceId: string): boolean => (byId(p.servers, deviceId) ?? byId(p.switches, deviceId))?.mount !== undefined;

function mergePort(cur: SwitchPortConfig, input: SwitchPortInput): SwitchPortConfig {
  const { lagGroup: curLag, ...base } = cur;
  const lag = input.lagGroup === undefined ? curLag : input.lagGroup ?? undefined;
  return {
    ...base,
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.vlan !== undefined ? { accessVlan: input.vlan } : {}),
    ...(input.vlans !== undefined ? { allowedVlans: input.vlans === 'all' ? 'all' : [...input.vlans] } : {}),
    ...(input.nativeVlan !== undefined ? { nativeVlan: input.nativeVlan } : {}),
    ...(input.mtu !== undefined ? { mtu: input.mtu } : {}),
    ...(lag !== undefined ? { lagGroup: lag } : {}),
  };
}

/**
 * Room a newly bought rack is assigned to: the first room of the layout with a free [GAME] rack slot (only placed racks
 * take a slot – model validateRoomCapacity with occupiesSlot); when every room is full, the first room. A bought rack
 * waits in the inventory and takes no slot, so buying never fails on the room capacity.
 */
function roomForNewRack(room: SandboxRoomState): string | undefined {
  const p = room.physical;
  const rooms = sitesOf(p).rooms;
  const counts = { occupiesSlot: occupiesSlot(room) };
  return rooms.find((r) => validateRoomCapacity(p, r.id, undefined, counts).length === 0)?.id ?? rooms[0]?.id;
}

/** Adds a bought rack to the inventory (assigned to `roomId`, no tile, takes no slot). */
function addInventoryRack(room: SandboxRoomState, catalog: SandboxContext['catalog'], id: string, modelId: string, roomId?: string) {
  return addRack(room.physical, catalog, id, modelId, roomId ?? roomForNewRack(room), { occupiesSlot: occupiesSlot(room) });
}

/**
 * [GAME] rack placement rules of the room (model validateRackPlacement: bounds, door / fixtures, occupied tile,
 * cold / hot aisle clearance, rows, capacity). Issues are passed through unchanged (scope 'game-scope').
 */
function placementProblem(room: SandboxRoomState, rackId: string, roomId: string, t: RoomTile, facing: Facing) {
  const r = checkRackPlacement(room, roomId, rackId, t, facing);
  if (!r) return flow('invalid-input', `Místnost ${roomId} neexistuje.`);
  return r.ok ? undefined : invalid(r.issues);
}

const notInstalled = (id: string): ValidationIssue => issue('ESX_NOT_INSTALLED', 'error', `Host ${id}: ESX is not installed.`, '20 §4.1.1 [S8]', id);

/** Codes of `validateServerConfig` that mean ESX itself cannot be installed (15 §3.1 [H12]). */
const ESX_INSTALL_BLOCKERS: readonly string[] = ['HW_BELOW_ESX_MINIMUM', 'HW_NO_NIC', 'HW_UNKNOWN_PART'];

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function applyRoom(tx: Tx, cmd: RoomCommand, ctx: SandboxContext): CommandResult {
  const oob = oobGuard(tx.s, cmd);
  if (oob) return no(oob);
  const r = applyRoomInner(tx, cmd, ctx);
  // Pre-wired OOB network (oob.ts): BMC of newly mounted / moved servers. Undo / redo restore a consistent room.
  if (r.ok && cmd.type !== 'undoRoom' && cmd.type !== 'redoRoom') tx.s = syncOob(tx.s, ctx.catalog);
  if (r.ok && cmd.type !== 'undoRoom' && cmd.type !== 'redoRoom' && cmd.type !== 'setCableMeta' && cmd.type !== 'testManagementNetwork') tx.invalidateValidation();
  return r;
}

/** [GAME] the pre-installed OOB switch and its cables are managed by the game (oob.ts), not by the player. */
function oobGuard(s: SandboxState, cmd: RoomCommand) {
  const room = s.room;
  const msg = 'Předinstalovaný OOB switch je zapojený a nastavený automaticky (herní zjednodušení Sandboxu, mimo VCF scope).';
  const ids: string[] = [];
  switch (cmd.type) {
    case 'mountDevice':
      ids.push(cmd.inventoryId ?? cmd.deviceId ?? '');
      break;
    case 'unmountDevice':
      ids.push(cmd.deviceId);
      break;
    case 'removeItem':
      ids.push(cmd.id);
      break;
    case 'setSwitchPort':
    case 'connectCompanyNetwork':
      ids.push(cmd.switchId);
      break;
    case 'connectCable':
      ids.push(cmd.from.deviceId, cmd.to.deviceId);
      break;
    case 'disconnectCable': {
      const c = room.physical.cables.find((x) => x.id === cmd.cableId);
      if (c) for (const e of [c.a, c.b]) if (e.kind === 'switch') ids.push(e.switchId);
      break;
    }
    default:
      return undefined;
  }
  return ids.some((id) => isOobSwitch(room, id)) ? flow('preinstalled-oob', msg) : undefined;
}

function applyRoomInner(tx: Tx, cmd: RoomCommand, ctx: SandboxContext): CommandResult {
  const { catalog, prices } = ctx;
  const s = tx.s;
  const room = s.room;
  const p = room.physical;
  const undoable = UNDOABLE.has(cmd.type);

  const serverGuard = (id: string, opts: { mounted?: boolean } = {}): PhysicalServer | CommandResult => {
    const srv = byId(p.servers, id);
    if (!srv) return no(flow('unknown-device', `Server ${id} neexistuje.`));
    if (serverTask(s, id)) return no(flow('device-busy', `Na serveru ${id} právě běží úloha.`));
    if (serverInDeployedDomain(s, srv)) return no(flow('host-in-deployed-domain', `Host ${id} je součástí nasazované / nasazené management domain; operace Day 2 zatím nejsou v modelu.`));
    if (opts.mounted && !srv.mount) return no(flow('not-mounted', `Server ${id} není v racku (bez napájení a sítě).`));
    return srv;
  };
  const isResult = (x: unknown): x is CommandResult => typeof x === 'object' && x !== null && 'ok' in x && typeof (x as { ok: unknown }).ok === 'boolean' && !('esx' in x);

  switch (cmd.type) {
    // ------------------------------------------------------------------ shop
    case 'buyItem': {
      const qty = cmd.qty ?? 1;
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return no(flow('invalid-input', `Počet kusů musí být celé číslo 1–${MAX_QTY}.`));
      if (cmd.itemId === CABLE_ITEM_ID) return no(flow('nothing-to-do', 'Kabely jsou v Sandboxu zdarma a bez omezení – zapoj je rovnou (herní zjednodušení).'));
      const item = catalog.items.get(cmd.itemId);
      const model = item ? undefined : catalog.models.get(cmd.itemId);
      if (!item && !model) return no(flow('unknown-item', `Položka ${cmd.itemId} není v katalogu.`));
      let next = room;
      const created: string[] = [];
      for (let i = 0; i < qty; i++) {
        if (model || item?.kind === 'server') {
          const config = model ? emptyConfigFor(model) : (item as Extract<typeof item, { kind: 'server' }>).config;
          const id = nextHostId(tx);
          const r = addServer(next.physical, catalog, id, config, cmd.itemId);
          if (!r.ok) return no(invalid([r.error]));
          next = charge(tx, withPhysical(next, r.state), 'buy', cmd.itemId, 1, serverConfigPrice(catalog, config, prices));
          created.push(id);
        } else if (item?.kind === 'switch') {
          const id = nextId(tx, 'switch', 'sw', 2, (x) => byId(next.physical.switches, x) !== undefined || byId(next.physical.servers, x) !== undefined);
          const r = addSwitch(next.physical, catalog, id, item.id);
          if (!r.ok) return no(invalid([r.error]));
          next = charge(tx, withPhysical(next, r.state), 'buy', item.id, 1, itemPrice(catalog, item.id, prices) ?? 0);
          created.push(id);
        } else if (item?.kind === 'rack') {
          const id = nextId(tx, 'rack', 'r', 2, (x) => byId(next.physical.racks, x) !== undefined);
          const r = addInventoryRack(next, catalog, id, item.id);
          if (!r.ok) return no(invalid([r.error]));
          next = charge(tx, withPhysical(next, r.state), 'buy', item.id, 1, itemPrice(catalog, item.id, prices) ?? 0);
          created.push(id);
        } else if (item) {
          const id = nextId(tx, 'part', 'part-', 3, (x) => next.parts.some((q) => q.id === x));
          next = charge(tx, { ...next, parts: [...next.parts, { id, itemId: item.id }] }, 'buy', item.id, 1, itemPrice(catalog, item.id, prices) ?? 0);
          created.push(id);
        }
      }
      setRoom(tx, next, undoable);
      return { ok: true, warnings: [], created };
    }

    // ------------------------------------------------------------- placement
    case 'placeRack': {
      const t = cmd.tile;
      if (!Number.isInteger(t.gx) || !Number.isInteger(t.gy) || t.gx < 0 || t.gy < 0) return no(flow('invalid-input', 'Dlaždice musí mít nezáporné celé souřadnice.'));
      if (cmd.facing !== undefined && !isFacing(cmd.facing)) return no(flow('invalid-input', `Neznámá orientace racku ${String(cmd.facing)}.`));
      if (t.rotation !== undefined && ![0, 90, 180, 270].includes(t.rotation)) return no(flow('invalid-input', `Neplatné otočení racku ${String(t.rotation)}.`));
      if (cmd.torModelId !== undefined && !isTorModel(catalog, cmd.torModelId)) return no(flow('unknown-item', `Switch ${cmd.torModelId} není model ToR v katalogu.`));
      let next = room;
      let id = cmd.inventoryId ?? cmd.rackId;
      const created: string[] = [];
      if (id === undefined) {
        const item = cmd.itemId !== undefined ? catalog.items.get(cmd.itemId) : undefined;
        if (!item || item.kind !== 'rack') return no(flow('unknown-item', `Rack ${cmd.itemId ?? '(nezadán)'} není v katalogu.`));
        const newId = nextId(tx, 'rack', 'r', 2, (x) => byId(next.physical.racks, x) !== undefined);
        const r = addInventoryRack(next, catalog, newId, item.id, cmd.roomId);
        if (!r.ok) return no(invalid([r.error]));
        next = charge(tx, withPhysical(next, r.state), 'buy', item.id, 1, itemPrice(catalog, item.id, prices) ?? 0);
        id = newId;
        created.push(newId);
      } else if (!byId(p.racks, id)) return no(flow('unknown-rack', `Rack ${id} neexistuje.`));
      else if (cmd.roomId !== undefined && roomOfRack(p, id) !== cmd.roomId) {
        if (p.servers.some((x) => x.mount?.rackId === id && (serverTask(s, x.id) || serverInDeployedDomain(s, x))))
          return no(flow('device-busy', `V racku ${id} je server s běžící úlohou nebo v nasazené management domain.`));
        // Model: room exists + [GAME] room rack capacity (placed racks only).
        const r = moveRackToRoom(p, id, cmd.roomId, { occupiesSlot: occupiesSlot(room) });
        if (!r.ok) return no(invalid([r.error]));
        next = withPhysical(next, r.state);
      }
      const current = room.rackTiles[id];
      // Facing: explicit > tile.rotation > the rack's current facing (moving) > default S (rotation 0).
      const facing = cmd.facing ?? (t.rotation !== undefined ? facingOfTile(t) : current ? facingOfTile(current) : 'S');
      const target = roomOfRack(next.physical, id) ?? '';
      const bad = placementProblem(next, id, target, t, facing);
      if (bad) return no(bad);
      let placed: SandboxRoomState = { ...next, rackTiles: { ...next.rackTiles, [id]: tileWithFacing(t.gx, t.gy, facing) } };
      // [GAME] pre-installed ToR-A in the top U on the first placement (tor.ts, UX 19.5)
      if (s.autoTor && !room.rackTiles[id] && !placed.preinstalledTors?.[id]) {
        const r = provisionTor(placed, catalog, id, cmd.torModelId ?? DEFAULT_TOR_MODEL_ID);
        if (typeof r === 'string') return no(flow('invalid-input', r));
        placed = r;
        created.push(r.preinstalledTors![id]!.a!);
      }
      setRoom(tx, placed, undoable);
      return { ok: true, warnings: [], created };
    }
    case 'rotateRack': {
      if (!isFacing(cmd.facing)) return no(flow('invalid-input', `Neznámá orientace racku ${String(cmd.facing)}.`));
      if (!byId(p.racks, cmd.rackId)) return no(flow('unknown-rack', `Rack ${cmd.rackId} neexistuje.`));
      const cur = room.rackTiles[cmd.rackId];
      if (!cur) return no(flow('rack-not-placed', `Rack ${cmd.rackId} ještě nestojí v místnosti.`));
      if (facingOfTile(cur) === cmd.facing) return no(flow('nothing-to-do', `Rack ${cmd.rackId} už je otočený na ${cmd.facing}.`));
      const bad = placementProblem(room, cmd.rackId, roomOfRack(p, cmd.rackId) ?? '', cur, cmd.facing);
      if (bad) return no(bad);
      setRoom(tx, { ...room, rackTiles: { ...room.rackTiles, [cmd.rackId]: tileWithFacing(cur.gx, cur.gy, cmd.facing) } }, undoable);
      return ok();
    }
    case 'moveRackToRoom': {
      if (!byId(p.racks, cmd.rackId)) return no(flow('unknown-rack', `Rack ${cmd.rackId} neexistuje.`));
      if (roomOfRack(p, cmd.rackId) === cmd.roomId) return no(flow('nothing-to-do', `Rack ${cmd.rackId} už je v této místnosti.`));
      if (p.servers.some((x) => x.mount?.rackId === cmd.rackId && (serverTask(s, x.id) || serverInDeployedDomain(s, x))))
        return no(flow('device-busy', `V racku ${cmd.rackId} je server s běžící úlohou nebo v nasazené management domain.`));
      const r = moveRackToRoom(p, cmd.rackId, cmd.roomId, { occupiesSlot: occupiesSlot(room) });
      if (!r.ok) return no(invalid([r.error]));
      const moved = withPhysical(room, r.state);
      const tile = room.rackTiles[cmd.rackId];
      if (tile) {
        // A placed rack keeps its tile and facing: the target room's placement rules apply there.
        const bad = placementProblem(moved, cmd.rackId, cmd.roomId, tile, facingOfTile(tile));
        if (bad) return no(bad);
      }
      setRoom(tx, moved, undoable);
      return ok();
    }
    case 'assignRoomRole': {
      if (cmd.role !== null && !isAzRole(cmd.role)) return no(flow('invalid-input', `Neznámá role místnosti ${String(cmd.role)}.`));
      const r = assignRoomRole(p, cmd.roomId, cmd.role);
      if (!r.ok) return no(invalid([r.error]));
      if ((sitesOf(p).azAssignment[cmd.roomId] ?? null) === cmd.role) return no(flow('nothing-to-do', 'Místnost už tuto roli má.'));
      setRoom(tx, withPhysical(room, r.state), undoable);
      return ok();
    }
    case 'mountDevice': {
      const id = cmd.inventoryId ?? cmd.deviceId;
      if (id === undefined) return no(flow('invalid-input', 'Chybí id zařízení.'));
      const srv = byId(p.servers, id);
      if (srv) {
        const g = serverGuard(id);
        if (isResult(g)) return g;
      } else if (!byId(p.switches, id)) return no(flow('unknown-device', `Zařízení ${id} neexistuje.`));
      if (!byId(p.racks, cmd.rackId)) return no(flow('unknown-rack', `Rack ${cmd.rackId} neexistuje.`));
      if (!room.rackTiles[cmd.rackId]) return no(flow('rack-not-placed', `Rack ${cmd.rackId} ještě nestojí v místnosti.`));
      const reserved = srv ? reservedTorU(room, cmd.rackId) : undefined;
      const h = srv?.rackUnits ?? 1;
      const hits = (u0: number): boolean => reserved !== undefined && u0 <= reserved && u0 + h - 1 >= reserved;
      const explicit = cmd.u ?? cmd.positionU;
      if (explicit !== undefined && hits(explicit))
        return no(flow('u-reserved', `U${reserved} racku ${cmd.rackId} je rezervovaná pro druhý ToR switch (herní pravidlo Sandboxu).`));
      let u = explicit ?? firstFreeU(p, catalog, id, cmd.rackId);
      if (explicit === undefined && u !== undefined && hits(u)) {
        const rack = byId(p.racks, cmd.rackId)!;
        u = undefined;
        for (let x = 1; x <= rack.heightU; x++) if (!hits(x) && validateMount(p, catalog, id, cmd.rackId, x).length === 0) { u = x; break; }
      }
      if (u === undefined) return no(invalid(validateMount(p, catalog, id, cmd.rackId, 1)));
      const r = mountDevice(p, catalog, id, cmd.rackId, u);
      if (!r.ok) return no(invalid([r.error]));
      setRoom(tx, withPhysical(room, r.state), undoable);
      return ok();
    }
    case 'unmountDevice': {
      const srv = byId(p.servers, cmd.deviceId);
      if (srv) {
        const g = serverGuard(cmd.deviceId);
        if (isResult(g)) return g;
      } else if (!byId(p.switches, cmd.deviceId)) return no(flow('unknown-device', `Zařízení ${cmd.deviceId} neexistuje.`));
      if (!isMounted(p, cmd.deviceId)) return no(flow('not-mounted', `${cmd.deviceId} není v racku.`));
      setRoom(tx, unmountInRoom(room, cmd.deviceId), undoable);
      return ok();
    }
    case 'removeItem': {
      const id = cmd.id;
      const rack = byId(p.racks, id);
      if (rack) {
        if (room.rackTiles[id]) {
          // pre-installed ToR-A goes with the rack (it was never bought); a bought ToR-B goes to the inventory
          const tor = room.preinstalledTors?.[id];
          const onlyTors = (x: { id: string; mount?: { rackId: string } }) => x.mount?.rackId === id && x.id !== tor?.a && x.id !== tor?.b;
          if (p.servers.some((x) => x.mount?.rackId === id) || p.switches.some(onlyTors))
            return no(flow('rack-not-empty', `Rack ${id} není prázdný – nejdřív z něj vyndej zařízení.`));
          let r: SandboxRoomState = room;
          if (tor?.b !== undefined && isMounted(p, tor.b)) r = unmountInRoom(r, tor.b);
          if (tor?.a !== undefined && byId(r.physical.switches, tor.a)) {
            r = unmountInRoom(r, tor.a);
            r = withPhysical(r, { ...r.physical, switches: r.physical.switches.filter((x) => x.id !== tor.a) });
          }
          const rackTiles = { ...r.rackTiles };
          delete rackTiles[id];
          const preinstalledTors = { ...r.preinstalledTors };
          delete preinstalledTors[id];
          setRoom(tx, { ...r, rackTiles, preinstalledTors }, undoable);
          return ok();
        }
        const sold = charge(tx, withPhysical(room, { ...p, racks: p.racks.filter((x) => x.id !== id) }), 'sell', rack.modelId, 1, -(itemPrice(catalog, rack.modelId, prices) ?? 0));
        setRoom(tx, sold, undoable);
        return ok();
      }
      const srv = byId(p.servers, id);
      const sw = byId(p.switches, id);
      if (srv || sw) {
        if (srv) {
          const g = serverGuard(id);
          if (isResult(g)) return g;
        }
        if (isMounted(p, id)) {
          setRoom(tx, unmountInRoom(room, id), undoable);
          return ok();
        }
        const physical = { ...p, servers: p.servers.filter((x) => x.id !== id), switches: p.switches.filter((x) => x.id !== id) };
        const refund = srv ? serverConfigPrice(catalog, srv.config, prices) : (itemPrice(catalog, sw!.modelId, prices) ?? 0);
        const mgmtTests = { ...room.mgmtTests };
        delete mgmtTests[id];
        setRoom(tx, charge(tx, { ...withPhysical(room, physical), mgmtTests }, 'sell', srv?.catalogItemId ?? srv?.config.modelId ?? sw!.modelId, 1, -refund), undoable);
        return ok();
      }
      const part = room.parts.find((x) => x.id === id);
      if (part) {
        setRoom(tx, charge(tx, { ...room, parts: room.parts.filter((x) => x.id !== id) }, 'sell', part.itemId, 1, -(itemPrice(catalog, part.itemId, prices) ?? 0)), undoable);
        return ok();
      }
      return no(flow('unknown-item', `Položka ${id} neexistuje.`));
    }

    // --------------------------------------------------------------- cabling
    case 'connectCable': {
      const a = resolveEnd(p, cmd.from);
      const b = resolveEnd(p, cmd.to);
      if (typeof a === 'string') return no(flow('unknown-device', a));
      if (typeof b === 'string') return no(flow('unknown-device', b));
      for (const e of [cmd.from, cmd.to]) if (!isMounted(p, e.deviceId)) return no(flow('not-mounted', `${e.deviceId} není v racku – zapojit jde jen namontované zařízení.`));
      const link = room.companyNetwork;
      for (const e of [a, b])
        if (link && e.kind === 'switch' && e.switchId === link.switchId && e.port === link.port)
          return no(flow('port-reserved', `Port ${e.switchId}/p${e.port + 1} je uplink do sítě firmy.`));
      const id = nextId(tx, 'cable', 'c', 3, (x) => byId(p.cables, x) !== undefined);
      const r = connectCable(p, catalog, { id, a, b });
      if (!r.ok) return no(invalid([r.error]));
      const meta = {
        ...(cmd.color !== undefined ? { color: cmd.color } : {}),
        ...(cmd.label !== undefined ? { label: cmd.label.slice(0, LABEL_MAX) } : {}),
      };
      setRoom(tx, { ...withPhysical(room, r.state), cableMeta: Object.keys(meta).length ? { ...room.cableMeta, [id]: meta } : room.cableMeta }, undoable);
      return { ok: true, warnings: [], created: [id] };
    }
    case 'disconnectCable': {
      if (!byId(p.cables, cmd.cableId)) return no(flow('unknown-cable', `Kabel ${cmd.cableId} neexistuje.`));
      setRoom(tx, dropCables(room, [cmd.cableId]), undoable);
      return ok();
    }
    case 'setCableMeta': {
      if (!byId(p.cables, cmd.cableId)) return no(flow('unknown-cable', `Kabel ${cmd.cableId} neexistuje.`));
      const cur = room.cableMeta[cmd.cableId] ?? {};
      const color = cmd.color === undefined ? cur.color : cmd.color ?? undefined;
      const label = cmd.label === undefined ? cur.label : cmd.label === null ? undefined : cmd.label.slice(0, LABEL_MAX);
      const meta = { ...(color !== undefined ? { color } : {}), ...(label !== undefined && label !== '' ? { label } : {}) };
      const cableMeta = { ...room.cableMeta };
      if (Object.keys(meta).length) cableMeta[cmd.cableId] = meta;
      else delete cableMeta[cmd.cableId];
      setRoom(tx, { ...room, cableMeta }, undoable);
      return ok();
    }
    case 'setSwitchPort': {
      const sw = byId(p.switches, cmd.switchId);
      if (!sw) return no(flow('unknown-device', `Switch ${cmd.switchId} neexistuje.`));
      const ports = typeof cmd.port === 'number' ? [cmd.port] : cmd.port;
      if (ports.length === 0) return no(flow('nothing-to-do', 'Není vybraný žádný port.'));
      if (cmd.config.mtu !== undefined && !Number.isInteger(cmd.config.mtu)) return no(flow('invalid-input', 'MTU musí být celé číslo.'));
      let physical = p;
      for (const port of ports) {
        const cur = byId(physical.switches, sw.id)?.ports[port];
        if (!cur) return no(invalid([issue('PHYS_PORT_NOT_FOUND', 'error', `Port ${sw.id}/p${port + 1} does not exist.`, 'game: cabling', sw.id, 'game-scope')]));
        const r = setSwitchPortConfig(physical, catalog, sw.id, port, mergePort(cur, cmd.config));
        if (!r.ok) return no(invalid([r.error]));
        physical = r.state;
      }
      setRoom(tx, withPhysical(room, physical), undoable);
      return ok();
    }
    case 'connectCompanyNetwork': {
      const sw = byId(p.switches, cmd.switchId);
      if (!sw) return no(flow('unknown-device', `Switch ${cmd.switchId} neexistuje.`));
      if (!sw.mount) return no(flow('not-mounted', `Switch ${sw.id} není v racku.`));
      const port = cmd.port ?? sw.ports.length - 1;
      if (!Number.isInteger(port) || port < 0 || port >= sw.ports.length) return no(flow('invalid-input', `Switch ${sw.id} nemá port ${port + 1}.`));
      if (p.cables.some((c) => [c.a, c.b].some((e) => e.kind === 'switch' && e.switchId === sw.id && e.port === port)))
        return no(flow('port-reserved', `Port ${sw.id}/p${port + 1} je obsazený kabelem.`));
      setRoom(tx, { ...room, companyNetwork: { switchId: sw.id, port } }, undoable);
      return ok();
    }
    case 'disconnectCompanyNetwork': {
      if (!room.companyNetwork) return no(flow('nothing-to-do', 'Síť firmy není připojená.'));
      const { companyNetwork: _c, ...rest } = room;
      void _c;
      setRoom(tx, rest, undoable);
      return ok();
    }
    case 'undoRoom':
    case 'redoRoom': {
      if (roomTaskRunning(s)) return no(flow('task-in-progress', 'Během instalace ESX / testu sítě nejde vracet změny místnosti.'));
      const h = s.roomHistory;
      if (cmd.type === 'undoRoom') {
        const prev = h.undo[h.undo.length - 1];
        if (!prev) return no(flow('nothing-to-do', 'Není co vrátit.'));
        tx.s = { ...s, room: prev, roomHistory: { undo: h.undo.slice(0, -1), redo: [...h.redo, room] } };
      } else {
        const nxt = h.redo[h.redo.length - 1];
        if (!nxt) return no(flow('nothing-to-do', 'Není co zopakovat.'));
        tx.s = { ...s, room: nxt, roomHistory: { undo: [...h.undo, room], redo: h.redo.slice(0, -1) } };
      }
      return ok();
    }

    // --------------------------------------------------- pre-installed ToR-B
    case 'addTor': {
      const rack = byId(p.racks, cmd.rackId);
      if (!rack) return no(flow('unknown-rack', `Rack ${cmd.rackId} neexistuje.`));
      if (!room.rackTiles[cmd.rackId]) return no(flow('rack-not-placed', `Rack ${cmd.rackId} ještě nestojí v místnosti.`));
      const rec = room.preinstalledTors?.[cmd.rackId];
      if (rec?.b !== undefined && byId(p.switches, rec.b)) return no(flow('nothing-to-do', `Rack ${cmd.rackId} už má druhý ToR switch.`));
      const modelId = cmd.modelId ?? rec?.modelId ?? DEFAULT_TOR_MODEL_ID;
      if (!isTorModel(catalog, modelId)) return no(flow('unknown-item', `Switch ${modelId} není model ToR v katalogu.`));
      const u = torBPosition(room, catalog, cmd.rackId);
      if (u === undefined) return no(flow('invalid-input', `V racku ${cmd.rackId} není volná pozice pro ToR switch.`));
      let swId = torSwitchId(cmd.rackId, 'b');
      for (let n = 2; byId(p.switches, swId) || byId(p.servers, swId); n++) swId = `${torSwitchId(cmd.rackId, 'b')}-${n}`;
      const added = addSwitch(p, catalog, swId, modelId);
      if (!added.ok) return no(invalid([added.error]));
      const mounted = mountDevice(added.state, catalog, swId, cmd.rackId, u);
      if (!mounted.ok) return no(invalid([mounted.error]));
      const next = charge(tx, { ...withPhysical(room, mounted.state), preinstalledTors: { ...room.preinstalledTors, [cmd.rackId]: { ...(rec ?? { modelId }), b: swId } } }, 'buy', modelId, 1, itemPrice(catalog, modelId, prices) ?? 0);
      setRoom(tx, next, undoable);
      return { ok: true, warnings: [], created: [swId] };
    }

    // -------------------------------------------------------------- NIC slots
    case 'addNic':
    case 'removeNic': {
      const g = serverGuard(cmd.serverId);
      if (isResult(g)) return g;
      if (g.esx.esxVersion !== undefined)
        return no(flow('esx-installed', 'Vypni host (herní zjednodušení: hardware se mění jen u serveru bez nainstalovaného ESX).'));
      const cards = nicCards(g.config);
      const slots = nicSlotCount(g.config);
      if (!Number.isInteger(cmd.slot) || cmd.slot < 1 || cmd.slot > slots) return no(flow('invalid-input', `Server ${g.id} nemá slot ${cmd.slot} (sloty 1–${slots}, herní hodnota).`));
      let nextCards: string[];
      if (cmd.type === 'addNic') {
        if (cards.length >= slots) return no(flow('no-free-slot', `Server ${g.id} nemá volný NIC slot.`));
        if (cmd.slot <= cards.length) return no(flow('invalid-input', `Slot ${cmd.slot} serveru ${g.id} je obsazený.`));
        if (!certifiedNicParts(catalog, g.config.modelId).some((n) => n.id === cmd.nicPartId))
          return no(flow('nic-not-certified', `Karta ${cmd.nicPartId} není v certifikované sestavě (BCG) modelu serveru ${g.id}.`));
        nextCards = [...cards, cmd.nicPartId];
      } else {
        if (cmd.slot > cards.length) return no(flow('slot-empty', `Slot ${cmd.slot} serveru ${g.id} je prázdný.`));
        nextCards = cards.filter((_, i) => i !== cmd.slot - 1);
      }
      return applyRoomInner(tx, { type: 'configureServer', serverId: g.id, config: { ...g.config, nics: cardsToNics(nextCards) } }, ctx);
    }

    // ------------------------------------------------------ server hardware
    case 'configureServer': {
      const g = serverGuard(cmd.serverId);
      if (isResult(g)) return g;
      const srv = g;
      if (srv.esx.esxVersion !== undefined) return no(flow('esx-installed', `Na ${srv.id} je nainstalovaný ESX – hardware se v Sandboxu mění před instalací.`));
      if (cmd.config.modelId !== srv.config.modelId) return no(flow('invalid-input', 'Model serveru nejde změnit – kup jiný server.'));
      const v = validateServerConfig(catalog, cmd.config, { subject: srv.id });
      const impossible = v.findings.filter((f) => f.physicallyImpossible === true || f.code === 'HW_UNKNOWN_PART');
      if (impossible.length) return no(invalid(impossible));
      // Parts: added ones are taken from spare stock first, the rest are bought; removed ones go to stock.
      const count = (c: ServerConfig): Map<string, number> => {
        const m = new Map<string, number>();
        for (const x of [...c.drives, ...c.nics]) m.set(x.partId, (m.get(x.partId) ?? 0) + Math.max(0, x.count));
        return m;
      };
      const before = count(srv.config);
      const after = count(cmd.config);
      let parts = [...room.parts];
      let partsCost = 0;
      const ids = new Set([...before.keys(), ...after.keys()]);
      let partSeq = tx.s.seq.part;
      for (const partId of ids) {
        const d = (after.get(partId) ?? 0) - (before.get(partId) ?? 0);
        for (let i = 0; i < d; i++) {
          const idx = parts.findIndex((q) => q.itemId === partId);
          if (idx >= 0) parts.splice(idx, 1);
          else partsCost += itemPrice(catalog, partId, prices) ?? 0;
        }
        for (let i = 0; i < -d; i++) {
          partSeq += 1;
          parts = [...parts, { id: `part-${pad(partSeq, 3)}`, itemId: partId }];
        }
      }
      tx.s = { ...tx.s, seq: { ...tx.s.seq, part: partSeq } };
      const bare = (c: ServerConfig): ServerConfig => ({ ...c, drives: [], nics: [] });
      const delta = serverConfigPrice(catalog, bare(cmd.config), prices) - serverConfigPrice(catalog, bare(srv.config), prices) + partsCost;
      // Rebuild the server through the model (pNIC count, HW profile fingerprint), keep identity / mount / BMC.
      const without = { ...p, servers: p.servers.filter((x) => x.id !== srv.id) };
      const r = addServer(without, catalog, srv.id, cmd.config, srv.catalogItemId);
      if (!r.ok) return no(invalid([r.error]));
      const rebuilt = byId(r.state.servers, srv.id)!;
      const merged: PhysicalServer = { ...rebuilt, ...(srv.mount ? { mount: srv.mount } : {}), bmc: srv.bmc };
      let next: SandboxRoomState = { ...withPhysical(room, { ...p, servers: p.servers.map((x) => (x.id === srv.id ? merged : x)) }), parts };
      const nicCount = merged.esx.pnicCount;
      next = dropCables(next, cablesOfDevice(next.physical, srv.id).filter((c) => [c.a, c.b].some((e) => e.kind === 'server-nic' && e.serverId === srv.id && e.vmnic >= nicCount)).map((c) => c.id));
      next = charge(tx, next, 'reconfigure', srv.catalogItemId ?? srv.config.modelId, 1, delta);
      setRoom(tx, next, undoable);
      return ok(v.findings.filter((f) => f.severity !== 'error'));
    }

    // ------------------------------------------------------------ ESX / DCUI
    case 'installEsx': {
      const g = serverGuard(cmd.serverId, { mounted: true });
      if (isResult(g)) return g;
      const srv = g;
      const hw = validateServerConfig(catalog, srv.config, { subject: srv.id }).findings.filter((f) => ESX_INSTALL_BLOCKERS.includes(f.code));
      if (hw.length) return no(invalid(hw));
      if (cmd.method === 'bmc') {
        const vendor = catalog.models.get(srv.config.modelId)?.vendor;
        if (!vendor || !BMC_REMOTE_INSTALL_VENDORS.includes(vendor))
          return no(flow('bmc-remote-install-not-documented', `Dokumentace pro ${srv.bmc.label} vzdálenou instalaci ESX neuvádí (${BMC_REMOTE_INSTALL_REF}) – instaluj u serveru.`));
        if (srv.bmc.ipv4 === undefined || !bmcReachable(netContextOf(s, catalog), srv.id))
          return no(flow('bmc-not-ready', `${srv.bmc.label} serveru ${srv.id} není zapojený, nemá IP nebo není dosažitelný z počítače admina (mimo VCF scope – herní).`));
      } else if (cmd.method !== 'physical') return no(flow('invalid-input', 'Neznámá cesta instalace.'));
      const version = cmd.version ?? s.rules.requiredEsxVersion ?? ESX_VERSION_GAME_DEFAULT;
      tx.startTask('esx-install', `${srv.id}: instalace ESX (${cmd.method === 'bmc' ? `vzdáleně přes ${srv.bmc.label}` : 'u serveru'})`, { kind: 'esx-install', serverId: srv.id, method: cmd.method, version });
      return ok();
    }
    case 'configureMgmtNetwork': {
      const g = serverGuard(cmd.serverId);
      if (isResult(g)) return g;
      if (cmd.hostname.trim() === '' || !Array.isArray(cmd.dns)) return no(flow('invalid-input', 'Management síť potřebuje FQDN hostname a seznam DNS serverů.'));
      const network: EsxHostNetwork = {
        ipv4Address: cmd.ip,
        subnetMask: cmd.mask,
        defaultGateway: cmd.gw,
        dnsServers: [...cmd.dns],
        hostnameFqdn: cmd.hostname.trim(),
        customDnsSuffixes: [...(cmd.customDnsSuffixes ?? [])],
        ...(cmd.vlan !== undefined && cmd.vlan !== null ? { vlanId: cmd.vlan } : {}),
      };
      const r = configureServerManagementNetwork(p, g.id, network);
      if (!r.ok) return no(invalid([r.error]));
      const mgmtTests = { ...room.mgmtTests };
      delete mgmtTests[g.id];
      setRoom(tx, { ...withPhysical(room, r.state), mgmtTests }, false);
      return ok();
    }
    case 'testManagementNetwork': {
      const srv = byId(p.servers, cmd.serverId);
      if (!srv) return no(flow('unknown-device', `Server ${cmd.serverId} neexistuje.`));
      if (serverTask(s, srv.id)) return no(flow('device-busy', `Na serveru ${srv.id} právě běží úloha.`));
      if (!srv.hostNet || srv.esx.esxVersion === undefined) return no(invalid([notInstalled(srv.id)]));
      tx.startTask('mgmt-network-test', `${srv.id}: Test Management Network (DCUI)`, { kind: 'mgmt-network-test', serverId: srv.id });
      return ok();
    }
    case 'setHostUplinks':
    case 'setHostSwitchMtu':
    case 'setVmkMtu': {
      const g = serverGuard(cmd.serverId);
      if (isResult(g)) return g;
      const r =
        cmd.type === 'setHostUplinks'
          ? setStandardSwitchUplinks(p, catalog, g.id, cmd.vmnics)
          : cmd.type === 'setHostSwitchMtu'
            ? setHostSwitchMtu(p, g.id, cmd.switchName, cmd.mtu)
            : setVmkMtu(p, g.id, cmd.vmk, cmd.mtu);
      if (!r.ok) return no(invalid([r.error]));
      setRoom(tx, withPhysical(room, r.state), false);
      return ok();
    }
    case 'configureBmc': {
      const g = serverGuard(cmd.serverId);
      if (isResult(g)) return g;
      let physical = p;
      if (cmd.vlan !== undefined) {
        const r = setBmcTag(physical, g.id, cmd.vlan);
        if (!r.ok) return no(invalid([r.error]));
        physical = r.state;
      }
      if (cmd.hostInterfaceEnabled !== undefined) {
        const r = setBmcHostInterface(physical, g.id, cmd.hostInterfaceEnabled);
        if (!r.ok) return no(invalid([r.error]));
        physical = r.state;
      }
      const ip = cmd.ip;
      if (ip !== undefined) {
        if (ip !== null && parseIpv4(ip) === undefined) return no(flow('invalid-input', 'IP BMC musí být platná IPv4 adresa.'));
        if (ip !== null && ip === g.esx.network?.ipv4Address)
          return no(flow('invalid-input', 'IP BMC musí být jiná než IP hosta („as distinct from the IP address of the host“, 25 §10.2.1 [U74]).'));
        // GAME logic (model has no BMC IP transition): BMC is game scope (25 §10).
        physical = {
          ...physical,
          servers: physical.servers.map((x) => {
            if (x.id !== g.id) return x;
            const { ipv4: _ip, ...bmc } = x.bmc;
            void _ip;
            return { ...x, bmc: ip === null ? bmc : { ...bmc, ipv4: ip } };
          }),
        };
      }
      setRoom(tx, withPhysical(room, physical), undoable);
      return ok();
    }
  }
}

/** Writes a room change made outside a player command (task completion, bring-up): clears the undo history. */
export function commitRoomChange(tx: Tx, room: SandboxRoomState): void {
  setRoom(tx, room, false);
}

export function describeRoom(cmd: RoomCommand): string {
  switch (cmd.type) {
    case 'buyItem':
      return `Nákup: ${cmd.itemId}${cmd.qty && cmd.qty > 1 ? ` × ${cmd.qty}` : ''}`;
    case 'placeRack':
      return `Rack ${cmd.inventoryId ?? cmd.rackId ?? cmd.itemId ?? ''} na dlaždici ${cmd.tile.gx},${cmd.tile.gy}${cmd.roomId ? ` (${cmd.roomId})` : ''}`;
    case 'moveRackToRoom':
      return `Rack ${cmd.rackId} → místnost ${cmd.roomId}`;
    case 'rotateRack':
      return `Rack ${cmd.rackId} otočen čelem na ${cmd.facing}`;
    case 'assignRoomRole':
      return `Místnost ${cmd.roomId}: role ${cmd.role ?? 'žádná'}`;
    case 'mountDevice':
      return `${cmd.inventoryId ?? cmd.deviceId ?? ''} → rack ${cmd.rackId}${cmd.u ?? cmd.positionU ? ` U${cmd.u ?? cmd.positionU}` : ''}`;
    case 'unmountDevice':
      return `${cmd.deviceId} vyndán z racku`;
    case 'removeItem':
      return `Odebráno: ${cmd.id}`;
    case 'connectCable':
      return `Kabel ${cmd.from.deviceId}:${String(cmd.from.port)} ⇄ ${cmd.to.deviceId}:${String(cmd.to.port)}`;
    case 'disconnectCable':
      return `Kabel ${cmd.cableId} odpojen`;
    case 'setCableMeta':
      return `Kabel ${cmd.cableId}: značení`;
    case 'setSwitchPort':
      return `${cmd.switchId}: konfigurace portu ${typeof cmd.port === 'number' ? `p${cmd.port + 1}` : cmd.port.map((x) => `p${x + 1}`).join(', ')}`;
    case 'connectCompanyNetwork':
      return `${cmd.switchId}: připojen do sítě firmy`;
    case 'disconnectCompanyNetwork':
      return 'Síť firmy odpojena';
    case 'undoRoom':
      return 'Zpět (místnost)';
    case 'redoRoom':
      return 'Znovu (místnost)';
    case 'configureServer':
      return `${cmd.serverId}: změna hardwaru`;
    case 'addTor':
      return `Rack ${cmd.rackId}: přidán druhý ToR switch`;
    case 'addNic':
      return `${cmd.serverId}: NIC ${cmd.nicPartId} do slotu ${cmd.slot}`;
    case 'removeNic':
      return `${cmd.serverId}: NIC ze slotu ${cmd.slot} odebrána`;
    case 'installEsx':
      return `${cmd.serverId}: spuštěna instalace ESX (${cmd.method === 'bmc' ? 'přes BMC' : 'u serveru'})`;
    case 'configureMgmtNetwork':
      return `${cmd.serverId}: management síť (${cmd.hostname}, ${cmd.ip}${cmd.vlan ? `, VLAN ${cmd.vlan}` : ''})`;
    case 'testManagementNetwork':
      return `${cmd.serverId}: Test Management Network`;
    case 'setHostUplinks':
      return `${cmd.serverId}: vSwitch0 uplinky ${cmd.vmnics.map((v) => `vmnic${v}`).join(', ')}`;
    case 'setHostSwitchMtu':
      return `${cmd.serverId}: ${cmd.switchName} MTU ${cmd.mtu}`;
    case 'setVmkMtu':
      return `${cmd.serverId}: ${cmd.vmk} MTU ${cmd.mtu}`;
    case 'configureBmc':
      return `${cmd.serverId}: BMC (mimo VCF scope – herní)`;
  }
}
