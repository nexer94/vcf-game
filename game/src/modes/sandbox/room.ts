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
} from '../../model';
import { CABLE_ITEM_ID, itemPrice, serverConfigPrice } from '../economy';
import { netContextOf } from './roomNet';
import { type SandboxContext, Tx, flow, invalid, no, ok } from './tx';
import type { CableEndInput, CommandResult, SandboxCommand, SandboxRoomState, SandboxState, SwitchPortInput } from './types';

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

const notInstalled = (id: string): ValidationIssue => issue('ESX_NOT_INSTALLED', 'error', `Host ${id}: ESX is not installed.`, '20 §4.1.1 [S8]', id);

/** Codes of `validateServerConfig` that mean ESX itself cannot be installed (15 §3.1 [H12]). */
const ESX_INSTALL_BLOCKERS: readonly string[] = ['HW_BELOW_ESX_MINIMUM', 'HW_NO_NIC', 'HW_UNKNOWN_PART'];

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function applyRoom(tx: Tx, cmd: RoomCommand, ctx: SandboxContext): CommandResult {
  const r = applyRoomInner(tx, cmd, ctx);
  if (r.ok && cmd.type !== 'undoRoom' && cmd.type !== 'redoRoom' && cmd.type !== 'setCableMeta' && cmd.type !== 'testManagementNetwork') tx.invalidateValidation();
  return r;
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
          const r = addRack(next.physical, catalog, id, item.id);
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
      let next = room;
      let id = cmd.inventoryId ?? cmd.rackId;
      const created: string[] = [];
      if (id === undefined) {
        const item = cmd.itemId !== undefined ? catalog.items.get(cmd.itemId) : undefined;
        if (!item || item.kind !== 'rack') return no(flow('unknown-item', `Rack ${cmd.itemId ?? '(nezadán)'} není v katalogu.`));
        const newId = nextId(tx, 'rack', 'r', 2, (x) => byId(next.physical.racks, x) !== undefined);
        const r = addRack(next.physical, catalog, newId, item.id);
        if (!r.ok) return no(invalid([r.error]));
        next = charge(tx, withPhysical(next, r.state), 'buy', item.id, 1, itemPrice(catalog, item.id, prices) ?? 0);
        id = newId;
        created.push(newId);
      } else if (!byId(p.racks, id)) return no(flow('unknown-rack', `Rack ${id} neexistuje.`));
      const tile = { gx: t.gx, gy: t.gy, ...(t.rotation !== undefined ? { rotation: t.rotation } : {}) };
      setRoom(tx, { ...next, rackTiles: { ...next.rackTiles, [id]: tile } }, undoable);
      return { ok: true, warnings: [], created };
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
      const u = cmd.u ?? cmd.positionU ?? firstFreeU(p, catalog, id, cmd.rackId);
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
          if (p.servers.some((x) => x.mount?.rackId === id) || p.switches.some((x) => x.mount?.rackId === id))
            return no(flow('rack-not-empty', `Rack ${id} není prázdný – nejdřív z něj vyndej zařízení.`));
          const rackTiles = { ...room.rackTiles };
          delete rackTiles[id];
          setRoom(tx, { ...room, rackTiles }, undoable);
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
      return `Rack ${cmd.inventoryId ?? cmd.rackId ?? cmd.itemId ?? ''} na dlaždici ${cmd.tile.gx},${cmd.tile.gy}`;
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
