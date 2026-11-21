/**
 * Pre-wired out-of-band (BMC) network of the Sandbox – GAME SCOPE (user decision 2026-11-21, CLAUDE.md).
 *
 * With `SandboxState.autoBmc` (Sandbox default: on; Career will switch it off to make manual OOB cabling a task):
 *  - every room of the site layout has a pre-installed OOB switch (generic catalog model `sw-generic-48x1g-oob`),
 *    wall-mounted: it is NOT mounted in a rack (takes no rack slot / U), is not in the inventory and cannot be
 *    bought, sold, mounted, re-cabled or reconfigured by the player;
 *  - its last port is the uplink to the company network: a derived admin workstation endpoint per OOB switch
 *    (roomNet.derivedEndpoints) – game abstraction like "Síť firmy";
 *  - when a server is mounted, its BMC port is cabled to a free port of the OOB switch of the server's room and the
 *    BMC gets an IP from a game pool (untagged = the OOB switch's default access VLAN). Moving the rack to another
 *    room re-cables it to that room's OOB switch.
 *
 * Out of VCF scope: "switches utilized for out-of-band connectivity to the ESX host are out of scope" (25 §10.1 [U55]).
 * The OOB switch is never a ToR for VCF validations: the model's topology rules look only at host NIC (vmnic)
 * cables, never at BMC cables (physical.validatePhysicalNetworkForBringup). Remote ESX install via BMC stays limited
 * to the vendors documented in 25 §10.6 [U68] (room.ts BMC_REMOTE_INSTALL_VENDORS).
 *
 * All addresses / port numbers here are GAME values (illustrative).
 */
import { type HardwareCatalog, type PhysicalState, type PortRef, cableAt, connectCable, disconnectCable, addSwitch, peerOf, roomOfDevice, sitesOf } from '../../model';
import type { SandboxRoomState, SandboxState } from './types';

export const OOB_SWITCH_MODEL_ID = 'sw-generic-48x1g-oob';
/** [GAME] id of the pre-installed OOB switch of a room. */
export const oobSwitchId = (roomId: string): string => `oob-${roomId}`;
/** [GAME] BMC address pool of the pre-wired OOB network (illustrative, not documentation). */
export const OOB_GAME_DEFAULTS = { bmcPoolPrefix: '10.0.99.', firstHost: 11, lastHost: 254, gameDefault: true } as const;

/** Uplink port (last port) of an OOB switch: connected to the company network (game abstraction). */
export function oobUplinkPort(p: PhysicalState, switchId: string): number | undefined {
  const sw = p.switches.find((x) => x.id === switchId);
  return sw ? sw.ports.length - 1 : undefined;
}

export const isOobSwitch = (room: SandboxRoomState, id: string): boolean => Object.values(room.oobSwitches ?? {}).includes(id);

/** Room id of an OOB switch, undefined for any other device. */
export function oobRoomOf(room: SandboxRoomState, switchId: string): string | undefined {
  return Object.entries(room.oobSwitches ?? {}).find(([, v]) => v === switchId)?.[0];
}

function freeIp(p: PhysicalState): string | undefined {
  const taken = new Set<string>();
  for (const s of p.servers) {
    if (s.bmc.ipv4) taken.add(s.bmc.ipv4);
    for (const v of s.hostNet?.vmks ?? []) if (v.ipv4) taken.add(v.ipv4);
    if (s.esx.network?.ipv4Address) taken.add(s.esx.network.ipv4Address);
  }
  for (let n = OOB_GAME_DEFAULTS.firstHost; n <= OOB_GAME_DEFAULTS.lastHost; n++) {
    const ip = `${OOB_GAME_DEFAULTS.bmcPoolPrefix}${n}`;
    if (!taken.has(ip)) return ip;
  }
  return undefined;
}

/**
 * Brings the room in line with the pre-wired OOB network: one OOB switch per room of the layout (switches of rooms
 * that no longer exist are removed with their cables) and every mounted server's BMC cabled to its room's OOB switch
 * with an IP. Model transitions (addSwitch, connectCable) do the work; returns the same object when nothing changed.
 */
export function syncOob(s: SandboxState, catalog: HardwareCatalog): SandboxState {
  if (!s.autoBmc || !catalog.switches.has(OOB_SWITCH_MODEL_ID)) return s;
  const room = s.room;
  let p = room.physical;
  let changed = false;
  const rooms = sitesOf(p).rooms.map((r) => r.id);
  const oob: Record<string, string> = {};
  // drop switches of vanished rooms
  for (const [roomId, swId] of Object.entries(room.oobSwitches ?? {})) {
    if (rooms.includes(roomId)) {
      if (p.switches.some((x) => x.id === swId)) oob[roomId] = swId;
      continue;
    }
    for (const c of p.cables.filter((c) => [c.a, c.b].some((e) => e.kind === 'switch' && e.switchId === swId))) p = disconnectCable(p, c.id);
    p = { ...p, switches: p.switches.filter((x) => x.id !== swId) };
    changed = true;
  }
  for (const roomId of rooms) {
    if (oob[roomId]) continue;
    const r = addSwitch(p, catalog, oobSwitchId(roomId), OOB_SWITCH_MODEL_ID);
    if (!r.ok) continue;
    p = r.state;
    oob[roomId] = oobSwitchId(roomId);
    changed = true;
  }
  const oobIds = new Set(Object.values(oob));
  for (const srv of p.servers) {
    if (!srv.mount) continue;
    const roomId = roomOfDevice(p, srv.id);
    const target = roomId !== undefined ? oob[roomId] : undefined;
    if (!target) continue;
    const bmc: PortRef = { kind: 'server-bmc', serverId: srv.id };
    const cur = cableAt(p, bmc);
    if (cur) {
      const peer = peerOf(cur, bmc);
      if (peer.kind !== 'switch' || !oobIds.has(peer.switchId) || peer.switchId === target) {
        // player's own cable (not to an OOB switch) or already right
      } else {
        p = disconnectCable(p, cur.id);
        changed = true;
      }
    }
    if (!cableAt(p, bmc)) {
      const sw = p.switches.find((x) => x.id === target);
      const uplink = oobUplinkPort(p, target);
      const port = sw?.ports.findIndex((_, i) => i !== uplink && !cableAt(p, { kind: 'switch', switchId: target, port: i })) ?? -1;
      if (port >= 0) {
        let id = `oobc-${srv.id}`;
        for (let n = 2; p.cables.some((c) => c.id === id); n++) id = `oobc-${srv.id}-${n}`;
        const r = connectCable(p, catalog, { id, a: bmc, b: { kind: 'switch', switchId: target, port } });
        if (r.ok) {
          p = r.state;
          changed = true;
        }
      }
    }
    const now = p.servers.find((x) => x.id === srv.id)!;
    const c = cableAt(p, bmc);
    const onOob = c !== undefined && peerOf(c, bmc).kind === 'switch' && (peerOf(c, bmc) as { switchId: string }).switchId === target;
    if (onOob && now.bmc.ipv4 === undefined) {
      const ip = freeIp(p);
      if (ip) {
        p = { ...p, servers: p.servers.map((x) => (x.id === srv.id ? { ...x, bmc: { ...x.bmc, ipv4: ip } } : x)) };
        changed = true;
      }
    }
  }
  const sameMap = JSON.stringify(oob) === JSON.stringify(room.oobSwitches ?? {});
  if (!changed && sameMap) return s;
  return { ...s, room: { ...room, physical: p, oobSwitches: oob } };
}
