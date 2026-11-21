/**
 * Pre-installed top-of-rack switches – GAME (UX Part III 19.5, CLAUDE.md "Zjednodušení Sandboxu v3": "V každém racku
 * nahoře předinstalovaný velký ToR switch").
 *
 * With `SandboxState.autoTor`:
 *  - when a rack is placed in the room for the first time, a generic ToR switch ("ToR-A", default `sw-generic-48x25g`,
 *    UX 27.3 proposal) is added and mounted in the rack's TOP U. It is free (pre-installed, not charged);
 *  - when no company network uplink exists yet, ToR-A's last port becomes the uplink to the company network (game
 *    abstraction "Síť firmy"; the model has ONE company network link, so further racks' ToRs have no uplink – the
 *    player connects racks himself, L2 / L3 between racks is a design question, model rackAwareness);
 *  - the U below ToR-A is reserved for the optional ToR-B (`addTor`, game price). Servers mounted with "lowest free U"
 *    skip it; an explicit server mount into it is rejected (flow 'u-reserved').
 * Switch port MTU stays the generic default 1500 (UX 19.5 / 1.1 P4); trunk / VLAN / MTU stay player tasks (10 §3.3).
 * Why a ToR at all: a host must connect to at least one ToR switch (10 §3.3 VCF-NET-REQD-TOR-001); two ToRs are
 * recommended (VCF-NET-RCMD-TOR-001). Which ToR model is used is a game choice (generic "no-name" switches).
 */
import { type HardwareCatalog, type NicPart, type PhysicalState, addSwitch, mountDevice, rackOccupancy } from '../../model';
import type { SandboxRoomState } from './types';

/** [GAME] default ToR model (UX 27.3: 48× 25G handles the 10 and 25 GbE NICs of the starter configurations). */
export const DEFAULT_TOR_MODEL_ID = 'sw-generic-48x25g';

/** Switch models allowed as a ToR (non-OOB generic switches). */
export function torModelIds(catalog: HardwareCatalog): string[] {
  return [...catalog.switches.values()].filter((m) => !m.oobOnly).map((m) => m.id);
}

export const isTorModel = (catalog: HardwareCatalog, id: string): boolean => catalog.switches.get(id)?.oobOnly === false;

/** Switch id of a pre-installed ToR (`r01-tor-a`). */
export const torSwitchId = (rackId: string, pos: 'a' | 'b'): string => `${rackId}-tor-${pos}`;

/** U reserved for ToR-B (just below ToR-A) while ToR-B is not installed; undefined otherwise. */
export function reservedTorU(room: SandboxRoomState, rackId: string): number | undefined {
  const rec = room.preinstalledTors?.[rackId];
  if (!rec || rec.b !== undefined || rec.a === undefined) return undefined;
  const a = room.physical.switches.find((x) => x.id === rec.a);
  if (a?.mount?.rackId !== rackId) return undefined;
  return a.mount.positionU > 1 ? a.mount.positionU - 1 : undefined;
}

export function isPreinstalledTor(room: SandboxRoomState, switchId: string): { readonly rackId: string; readonly position: 'a' | 'b' } | undefined {
  for (const [rackId, rec] of Object.entries(room.preinstalledTors ?? {})) {
    if (rec.a === switchId) return { rackId, position: 'a' };
    if (rec.b === switchId) return { rackId, position: 'b' };
  }
  return undefined;
}

function freeId(p: PhysicalState, base: string): string {
  const taken = (x: string): boolean => p.switches.some((s) => s.id === x) || p.servers.some((s) => s.id === x);
  let id = base;
  for (let n = 2; taken(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * Adds + mounts ToR-A into the top U of a freshly placed rack (model transitions addSwitch / mountDevice) and connects
 * the company network when none exists. Returns an error message when the rack top is not free.
 */
export function provisionTor(room: SandboxRoomState, catalog: HardwareCatalog, rackId: string, modelId: string): SandboxRoomState | string {
  const p = room.physical;
  const rack = p.racks.find((r) => r.id === rackId);
  const model = catalog.switches.get(modelId);
  if (!rack || !model) return `Rack ${rackId} nebo model ToR ${modelId} neexistuje.`;
  const id = freeId(p, torSwitchId(rackId, 'a'));
  const added = addSwitch(p, catalog, id, modelId);
  if (!added.ok) return added.error.message;
  const top = rack.heightU - model.rackUnits + 1;
  const mounted = mountDevice(added.state, catalog, id, rackId, top);
  if (!mounted.ok) return mounted.error.message;
  const sw = mounted.state.switches.find((x) => x.id === id)!;
  return {
    ...room,
    physical: mounted.state,
    preinstalledTors: { ...room.preinstalledTors, [rackId]: { a: id, modelId } },
    ...(room.companyNetwork ? {} : { companyNetwork: { switchId: id, port: sw.ports.length - 1 } }),
  };
}

/** Free U for ToR-B: the reserved U (or, when ToR-A is gone, the highest free U). */
export function torBPosition(room: SandboxRoomState, catalog: HardwareCatalog, rackId: string): number | undefined {
  const reserved = reservedTorU(room, rackId);
  if (reserved !== undefined) return reserved;
  const rack = room.physical.racks.find((r) => r.id === rackId);
  if (!rack) return undefined;
  const occ = rackOccupancy(room.physical, catalog, rackId);
  for (let u = rack.heightU; u >= 1; u--) if (!occ.some((o) => u >= o.from && u <= o.to)) return u;
  return undefined;
}

/**
 * NIC ↔ ToR speed check (UX 19.4 "⚠ Nespojíš s ToR-A (25G)") – physical / game constraint, not a VCF rule: the link
 * comes up only on a common speed (model linkStatus).
 */
export const nicMatchesSwitch = (nic: NicPart, switchSpeedsGbE: readonly number[]): boolean => nic.speedsGbE.some((x) => switchSpeedsGbE.includes(x));
