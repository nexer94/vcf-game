/**
 * Physical layer of the server room: racks, mounted devices, cables, generic switch ports, ESX host networking
 * after install, out-of-band (BMC) network, L2/L3 reachability, path MTU and the traffic flows to visualise.
 *
 * Sources: docs/spec/25-usecases-and-physical.md §3.5, §5.3, §5.4, §6.3, §7 (ESX network after install, MTU,
 * installer validations, flows N1–N8), docs/spec/10-planning.md §3.3, §7 (switch ports, MTU, VLAN, flows),
 * docs/spec/20-deployment.md §7 (installer / vCenter / ESX flows), docs/spec/15-hardware.md (NICs).
 *
 * Sites (layout, rooms, inter-room links, AZ assignment) live in sites.ts; racks carry a `roomId`. Cables between
 * rooms are [GAME] switch-to-switch uplinks over an inter-room link (connectCable rejects others, linkStatus is down
 * for invalid ones and caps the speed by the link bandwidth).
 *
 * Provenance conventions:
 *  - `[DOC]` value / rule from the spec (reference given),
 *  - `[GAME]` game default or game rule (generic switch, rack U, OOB network, generic 802.1Q behaviour, loads).
 *    Issues produced by [GAME] rules carry `scope: 'game-scope'`.
 *  - OUT-OF-BAND (BMC) management (25 §10): VCF design puts it out of scope ("switches utilized for out-of-band
 *    connectivity to the ESX host are out of scope" [U55]) and lists no OOB network. Documented: the BMC has its own
 *    NIC and IP "as distinct from the IP address of the host" and is powered even when the host is off [U74].
 *    Everything else (OOB cabling, BMC VLAN / IP / MTU, OOB flows) is game scope, optional, never blocks a VCF
 *    validation and carries no VCF management flow. The first documented network is ESX management (vmk0).
 *
 * Simplifications [GAME] (documented, not VCF facts):
 *  - reachability is VLAN based (L2). Routing between VLANs only through a `gateway` endpoint that has an
 *    interface (tag) in both VLANs; IP subnets are not checked here (bringup.ts validates the IP plan).
 *  - generic 802.1Q: an access port accepts untagged frames only; a trunk accepts allowed tagged VLANs and maps
 *    untagged frames to its native VLAN. Switch↔switch cables re-map VLANs (egress tag -> ingress VLAN).
 *  - link speed = highest speed supported by both ends; no common speed = link down. Media / optics ignored.
 *  - the frame path MTU = minimum of host virtual switch MTU, every switch port MTU on the path and endpoint MTU.
 *  - traffic loads are illustrative (UX: "ilustrativní model"), not documented values.
 *
 * Pure TypeScript: no DOM, no PixiJS, no randomness, no time.
 */
import { type EsxHost, type EsxHostNetwork, type StorageType, configureHostNetwork, installEsx, newBareMetalHost } from './bringup';
import { type ServerConfig, BMC_LABEL, BMC_PORT_SPEEDS_GBE, configFingerprint, nicMaxSpeed } from './hardware';
import type { HardwareCatalog } from './hardwareCatalog';
import { type RoomCapacityOptions, type SiteLayoutId, type SiteState, crossRoomCable, defaultRoomId, siteStateFor, sitesOf, validateRoomCapacity } from './sites';
import { type TransitionResult, type ValidationIssue, issue } from './validation';

// ===========================================================================
// Types
// ===========================================================================

export type PortRef =
  | { readonly kind: 'server-nic'; readonly serverId: string; readonly vmnic: number }
  /** Out-of-band management port (BMC). Game scope. */
  | { readonly kind: 'server-bmc'; readonly serverId: string }
  /** 0-based switch port index. */
  | { readonly kind: 'switch'; readonly switchId: string; readonly port: number };

export interface Cable {
  readonly id: string;
  readonly a: PortRef;
  readonly b: PortRef;
}

/** [GAME] generic rack. */
export interface RackInstance {
  readonly id: string;
  readonly modelId: string;
  readonly heightU: number;
  /** Room of the site layout the rack stands in (sites.ts). */
  readonly roomId: string;
}

/** Lowest occupied U (1-based). */
export interface Mount {
  readonly rackId: string;
  readonly positionU: number;
}

/**
 * BMC (out-of-band management). Own NIC + IP distinct from the host IP [U74] (25 §10.2.1); the rest is GAME SCOPE.
 */
export interface BmcState {
  /** Vendor label only (iDRAC / iLO / XCC / CIMC / BMC) – no rule depends on it. */
  readonly label: string;
  /** VLAN tag of the BMC interface; null = untagged. [GAME] default untagged. */
  readonly tag: number | null;
  /** [GAME] optional BMC IP (documented only as "distinct from the IP address of the host" [U74]). */
  readonly ipv4?: string;
  /**
   * OS-to-BMC USB-NIC interface ("OS to iDRAC Pass-Through" / iLO USB NIC). When enabled, ESX creates the
   * standard switch vSwitchBMC with uplink vusb0 (KB 376173 / 25 §10.2.3 [U78][U79]). [GAME] default off.
   */
  readonly hostInterfaceEnabled: boolean;
  readonly gameScope: true;
}

export interface PhysicalServer {
  readonly id: string;
  /** Catalog item id the server was bought as (15 B.3 id), if any. */
  readonly catalogItemId?: string;
  readonly config: ServerConfig;
  readonly rackUnits: number;
  readonly mount?: Mount;
  /** Host preparation state shared with the bring-up model (bringup.ts). */
  readonly esx: EsxHost;
  /** ESX host networking; undefined until ESX is installed. */
  readonly hostNet?: HostNetworking;
  readonly bmc: BmcState;
}

export interface SwitchPortConfig {
  readonly mode: 'access' | 'trunk';
  /** VLAN of untagged frames on an access port. */
  readonly accessVlan: number;
  /** Trunk: allowed tagged VLANs. */
  readonly allowedVlans: 'all' | readonly number[];
  /** Trunk: VLAN of untagged frames. */
  readonly nativeVlan: number;
  readonly mtu: number;
  /** Port is a member of a LAG (port channel). */
  readonly lagGroup?: string;
}

export interface PhysicalSwitch {
  readonly id: string;
  readonly modelId: string;
  readonly mount?: Mount;
  readonly ports: readonly SwitchPortConfig[];
}

export type EndpointKind = 'admin-workstation' | 'dns' | 'ntp' | 'dhcp' | 'gateway' | 'vcf-installer' | 'vcenter';

export type EndpointAttachment =
  /** Plugged into a switch port; `tags` = interfaces (null = untagged). Gateways may have several. */
  | { readonly kind: 'switch-port'; readonly switchId: string; readonly port: number; readonly tags: readonly (number | null)[] }
  /** VM running on an ESX host (e.g. VCF Installer on a management host, vCenter). [GAME] uses vmk0's switch uplinks. */
  | { readonly kind: 'host-vm'; readonly serverId: string; readonly tag: number | null };

/** Service outside the racks (DNS, NTP…) or an appliance VM. Placement / addressing are scenario data. */
export interface ServiceEndpoint {
  readonly id: string;
  readonly kind: EndpointKind;
  readonly label?: string;
  readonly ipv4?: string;
  readonly fqdn?: string;
  readonly attachment: EndpointAttachment;
  /** [GAME] default 1500. */
  readonly mtu: number;
}

export interface PhysicalState {
  readonly racks: readonly RackInstance[];
  readonly servers: readonly PhysicalServer[];
  readonly switches: readonly PhysicalSwitch[];
  readonly cables: readonly Cable[];
  readonly endpoints: readonly ServiceEndpoint[];
  /** Site layout, rooms, inter-room links and AZ assignment (sites.ts). Default layout 'small-room'. */
  readonly sites: SiteState;
}

export const emptyPhysicalState = (layoutId?: SiteLayoutId): PhysicalState => ({ racks: [], servers: [], switches: [], cables: [], endpoints: [], sites: siteStateFor(layoutId) });

// ---------------------------------------------------------------------------
// Host networking after ESX install (25 §3.5, §6.3)
// ---------------------------------------------------------------------------

export type VmkService = 'management' | 'vmotion' | 'vsan' | 'nfs' | 'host-tep';

export interface HostVirtualSwitch {
  readonly name: string;
  readonly kind: 'vss' | 'vds';
  /** vmnic indices. */
  readonly uplinks: readonly number[];
  /** Non-vmnic uplinks (vusb0 of vSwitchBMC, 25 §10.2.3 [U78]). */
  readonly virtualUplinks?: readonly string[];
  readonly mtu: number;
}

export interface VmkernelAdapter {
  readonly name: string;
  readonly switchName: string;
  readonly service: VmkService;
  /** VLAN tag; null = untagged (no VLAN ID set). */
  readonly tag: number | null;
  readonly mtu: number;
  readonly addressing: 'dhcp' | 'static';
  readonly ipv4?: string;
}

export interface HostNetworking {
  readonly switches: readonly HostVirtualSwitch[];
  readonly vmks: readonly VmkernelAdapter[];
}

export interface DefaultValue<T> {
  readonly value: T;
  /** 'documented' = from docs/spec; 'game-default' = chosen by the game (UX label "herní výchozí"). */
  readonly source: 'documented' | 'game-default';
  readonly specRef: string;
}

/** Defaults of a fresh ESX install, with provenance (UX §2.6 labels). */
export const ESX_INSTALL_DEFAULTS = {
  /** "default Standard Switch (vSwitch0) created during the fresh ESXi installation" [U35]. */
  standardSwitchName: { value: 'vSwitch0', source: 'documented', specRef: '25 §6.3 [U35]' } as DefaultValue<string>,
  /** "During the autoconfiguration phase, the ESX host chooses vmnic0 for management traffic." [U32] */
  managementUplink: { value: 0, source: 'documented', specRef: '25 §6.3 [U32]' } as DefaultValue<number>,
  /** Management IP via DHCP; without DHCP link-local 169.254.x.x/16 [U30][U31]. */
  managementAddressing: { value: 'dhcp', source: 'documented', specRef: '25 §6.3 [U30][U31]' } as DefaultValue<'dhcp'>,
  /** ESX Management VMkernel MTU "1500 (Default)" [U43]. */
  vmk0Mtu: { value: 1500, source: 'documented', specRef: '25 §6.3 [U43]; 10 §3.3 [P18]' } as DefaultValue<number>,
  /** VSS default MTU is not documented (25 §8 OQ3) – game default 1500. */
  vswitch0Mtu: { value: 1500, source: 'game-default', specRef: '25 §8 OQ3' } as DefaultValue<number>,
  /** VLAN ID is an optional DCUI setting (1–4094) [U33]; not set after install. */
  managementVlan: { value: null, source: 'documented', specRef: '25 §6.3 [U33]' } as DefaultValue<null>,
} as const;

/** [GAME] defaults of a generic switch port (UX §2.6 "herní výchozí"). */
export const SWITCH_PORT_GAME_DEFAULTS: Omit<SwitchPortConfig, 'mtu'> = { mode: 'access', accessVlan: 1, allowedVlans: 'all', nativeVlan: 1 };

/** Documented MTU limits (25 §6.3 [U39][U40][U41]). */
export const MTU_LIMITS = { vssMax: 9000, vdsMax: 9190, vmkMax: 9000, minHostPort: 1500, tepMinRequired: 1600, tepMinSwitchPort: 1700, recommended: 9000 } as const;
/** [GAME] lowest MTU the game lets the player set anywhere. */
export const GAME_MIN_MTU = 1280;

export function defaultHostNetworkingAfterInstall(hasNic: boolean, bmcHostInterface = false): HostNetworking {
  return {
    switches: [
      { name: 'vSwitch0', kind: 'vss', uplinks: hasNic ? [0] : [], mtu: ESX_INSTALL_DEFAULTS.vswitch0Mtu.value },
      // KB 376173 [U78]: with the BMC USB/NIC interface enabled ESX creates vSwitchBMC with uplink vusb0.
      ...(bmcHostInterface ? [{ name: 'vSwitchBMC', kind: 'vss' as const, uplinks: [], virtualUplinks: ['vusb0'], mtu: ESX_INSTALL_DEFAULTS.vswitch0Mtu.value }] : []),
    ],
    vmks: [{ name: 'vmk0', switchName: 'vSwitch0', service: 'management', tag: null, mtu: ESX_INSTALL_DEFAULTS.vmk0Mtu.value, addressing: 'dhcp' }],
  };
}

// ===========================================================================
// Lookups
// ===========================================================================

const byId = <T extends { readonly id: string }>(xs: readonly T[], id: string): T | undefined => xs.find((x) => x.id === id);
const replace = <T extends { readonly id: string }>(xs: readonly T[], next: T): T[] => xs.map((x) => (x.id === next.id ? next : x));

export interface ServerNicPort {
  readonly vmnic: number;
  readonly partId: string;
  readonly speedsGbE: readonly number[];
}

/** NIC ports of a server, numbered vmnic0.. in configuration order ([GAME] numbering). */
export function serverNicPorts(catalog: HardwareCatalog, server: PhysicalServer): ServerNicPort[] {
  const out: ServerNicPort[] = [];
  for (const n of server.config.nics) {
    const part = catalog.nics.get(n.partId);
    if (!part) continue;
    for (let c = 0; c < n.count; c++) for (let p = 0; p < part.ports; p++) out.push({ vmnic: out.length, partId: part.id, speedsGbE: part.speedsGbE });
  }
  return out;
}

const samePort = (a: PortRef, b: PortRef): boolean =>
  a.kind === b.kind &&
  (a.kind === 'switch' ? b.kind === 'switch' && a.switchId === b.switchId && a.port === b.port
    : a.kind === 'server-nic' ? b.kind === 'server-nic' && a.serverId === b.serverId && a.vmnic === b.vmnic
    : b.kind === 'server-bmc' && a.serverId === b.serverId);

export function cableAt(state: PhysicalState, p: PortRef): Cable | undefined {
  return state.cables.find((c) => samePort(c.a, p) || samePort(c.b, p));
}

export function peerOf(c: Cable, p: PortRef): PortRef {
  return samePort(c.a, p) ? c.b : c.a;
}

export const portLabel = (p: PortRef): string =>
  p.kind === 'switch' ? `${p.switchId}/p${p.port + 1}` : p.kind === 'server-nic' ? `${p.serverId}/vmnic${p.vmnic}` : `${p.serverId}/bmc`;

function portSpeeds(state: PhysicalState, catalog: HardwareCatalog, p: PortRef): readonly number[] | undefined {
  if (p.kind === 'switch') {
    const sw = byId(state.switches, p.switchId);
    const m = sw ? catalog.switches.get(sw.modelId) : undefined;
    return sw && m && p.port >= 0 && p.port < sw.ports.length ? m.speedsGbE : undefined;
  }
  const srv = byId(state.servers, p.serverId);
  if (!srv) return undefined;
  if (p.kind === 'server-bmc') return BMC_PORT_SPEEDS_GBE;
  return serverNicPorts(catalog, srv).find((x) => x.vmnic === p.vmnic)?.speedsGbE;
}

export interface LinkStatus {
  readonly up: boolean;
  /** Negotiated speed (highest common speed) [GAME]. */
  readonly speedGbE?: number;
  /** 'cross-room-invalid': devices in different rooms not joined by a valid switch-to-switch uplink over a link (sites.ts, game). */
  readonly reason?: 'no-common-speed' | 'port-missing' | 'cross-room-invalid';
  /** [GAME] the cable is an uplink between rooms carried over these inter-room links. */
  readonly interRoomLinkIds?: readonly string[];
}

export function linkStatus(state: PhysicalState, catalog: HardwareCatalog, cable: Cable): LinkStatus {
  const a = portSpeeds(state, catalog, cable.a);
  const b = portSpeeds(state, catalog, cable.b);
  if (!a || !b) return { up: false, reason: 'port-missing' };
  const common = a.filter((s) => b.includes(s));
  if (!common.length) return { up: false, reason: 'no-common-speed' };
  // [GAME] between rooms only over inter-room links; the uplink speed is capped by the link bandwidth.
  const x = crossRoomCable(state, cable);
  if (x.issue) return { up: false, reason: 'cross-room-invalid' };
  const speed = Math.max(...common);
  return x.path ? { up: true, speedGbE: Math.min(speed, x.path.bandwidthGbps), interRoomLinkIds: x.path.linkIds } : { up: true, speedGbE: speed };
}

// ===========================================================================
// Transitions: racks, devices, cables, ports
// ===========================================================================

const fail = <S>(i: ValidationIssue): TransitionResult<S> => ({ ok: false, error: i });

/**
 * Adds a rack into `roomId` (default: first room of the site layout). [GAME] room rack capacity (sites.ts); with
 * `opts.occupiesSlot` a rack that takes no slot yet (Sandbox inventory) is not limited by the capacity.
 */
export function addRack(state: PhysicalState, catalog: HardwareCatalog, id: string, modelId = 'rack-generic-42u', roomId?: string, opts: RoomCapacityOptions = {}): TransitionResult<PhysicalState> {
  const m = catalog.racks.get(modelId);
  if (!m || byId(state.racks, id)) return fail(issue('PHYS_DEVICE_INVALID', 'error', `Cannot add rack ${id} (${modelId}).`, 'game: room rules', id, 'game-scope'));
  const sites = sitesOf(state);
  const room = roomId ?? defaultRoomId(sites) ?? '';
  const cap = validateRoomCapacity(state, room, id, opts)[0];
  if (cap) return fail(cap);
  return { ok: true, state: { ...state, sites, racks: [...state.racks, { id, modelId, heightU: m.heightU, roomId: room }] } };
}

/** Adds a bought server (not mounted, no ESX). */
export function addServer(state: PhysicalState, catalog: HardwareCatalog, id: string, config: ServerConfig, catalogItemId?: string): TransitionResult<PhysicalState> {
  const model = catalog.models.get(config.modelId);
  if (!model || byId(state.servers, id) || byId(state.switches, id))
    return fail(issue('PHYS_DEVICE_INVALID', 'error', `Cannot add server ${id} (${config.modelId}).`, 'game: room rules', id, 'game-scope'));
  const pnicCount = config.nics.reduce((a, n) => a + n.count * (catalog.nics.get(n.partId)?.ports ?? 0), 0);
  const server: PhysicalServer = {
    id,
    ...(catalogItemId !== undefined ? { catalogItemId } : {}),
    config,
    rackUnits: model.rackUnits,
    esx: newBareMetalHost(id, { hwVendor: model.vendor, hwProfileId: configFingerprint(config), pnicCount }),
    bmc: { label: BMC_LABEL[model.vendor], tag: null, hostInterfaceEnabled: false, gameScope: true },
  };
  return { ok: true, state: { ...state, servers: [...state.servers, server] } };
}

export function addSwitch(state: PhysicalState, catalog: HardwareCatalog, id: string, modelId: string): TransitionResult<PhysicalState> {
  const m = catalog.switches.get(modelId);
  if (!m || byId(state.switches, id) || byId(state.servers, id))
    return fail(issue('PHYS_DEVICE_INVALID', 'error', `Cannot add switch ${id} (${modelId}).`, 'game: room rules', id, 'game-scope'));
  const ports = Array.from({ length: m.ports }, (): SwitchPortConfig => ({ ...SWITCH_PORT_GAME_DEFAULTS, mtu: m.defaultPortMtu }));
  return { ok: true, state: { ...state, switches: [...state.switches, { id, modelId, ports }] } };
}

export function addEndpoint(state: PhysicalState, ep: ServiceEndpoint): TransitionResult<PhysicalState> {
  if (byId(state.endpoints, ep.id)) return fail(issue('PHYS_DEVICE_INVALID', 'error', `Endpoint ${ep.id} exists.`, 'game', ep.id, 'game-scope'));
  return { ok: true, state: { ...state, endpoints: [...state.endpoints, ep] } };
}

function deviceHeight(state: PhysicalState, catalog: HardwareCatalog, deviceId: string): number | undefined {
  const s = byId(state.servers, deviceId);
  if (s) return s.rackUnits;
  const sw = byId(state.switches, deviceId);
  return sw ? catalog.switches.get(sw.modelId)?.rackUnits : undefined;
}

/** Occupied U ranges of a rack, optionally ignoring one device. */
export function rackOccupancy(state: PhysicalState, catalog: HardwareCatalog, rackId: string, ignore?: string): { readonly deviceId: string; readonly from: number; readonly to: number }[] {
  const out: { deviceId: string; from: number; to: number }[] = [];
  for (const d of [...state.servers, ...state.switches]) {
    if (d.id === ignore || d.mount?.rackId !== rackId) continue;
    const h = deviceHeight(state, catalog, d.id) ?? 1;
    out.push({ deviceId: d.id, from: d.mount.positionU, to: d.mount.positionU + h - 1 });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** [GAME] room rule: device fits into the rack at `positionU` (1-based lowest U) without overlap. */
export function validateMount(state: PhysicalState, catalog: HardwareCatalog, deviceId: string, rackId: string, positionU: number): ValidationIssue[] {
  const rack = byId(state.racks, rackId);
  const h = deviceHeight(state, catalog, deviceId);
  if (!rack || h === undefined) return [issue('PHYS_DEVICE_INVALID', 'error', `Unknown rack ${rackId} or device ${deviceId}.`, 'game: room rules', deviceId, 'game-scope')];
  if (!Number.isInteger(positionU) || positionU < 1 || positionU + h - 1 > rack.heightU)
    return [issue('PHYS_RACK_POSITION_INVALID', 'error', `${deviceId} (${h}U) does not fit at U${positionU} of a ${rack.heightU}U rack.`, 'game: room rules', deviceId, 'game-scope')];
  const clash = rackOccupancy(state, catalog, rackId, deviceId).find((o) => positionU <= o.to && positionU + h - 1 >= o.from);
  if (clash) return [issue('PHYS_RACK_SLOT_OCCUPIED', 'error', `U${positionU}–U${positionU + h - 1} overlaps ${clash.deviceId} (U${clash.from}–U${clash.to}).`, 'game: room rules', deviceId, 'game-scope')];
  return [];
}

/** First free position for a device in a rack (lowest U), or undefined when full. */
export function firstFreeU(state: PhysicalState, catalog: HardwareCatalog, deviceId: string, rackId: string): number | undefined {
  const rack = byId(state.racks, rackId);
  if (!rack) return undefined;
  for (let u = 1; u <= rack.heightU; u++) if (validateMount(state, catalog, deviceId, rackId, u).length === 0) return u;
  return undefined;
}

export function mountDevice(state: PhysicalState, catalog: HardwareCatalog, deviceId: string, rackId: string, positionU: number): TransitionResult<PhysicalState> {
  const issues = validateMount(state, catalog, deviceId, rackId, positionU);
  if (issues[0]) return fail(issues[0]);
  const mount: Mount = { rackId, positionU };
  const srv = byId(state.servers, deviceId);
  if (srv) return { ok: true, state: { ...state, servers: replace(state.servers, { ...srv, mount }) } };
  const sw = byId(state.switches, deviceId);
  if (sw) return { ok: true, state: { ...state, switches: replace(state.switches, { ...sw, mount }) } };
  return fail(issue('PHYS_DEVICE_INVALID', 'error', `Unknown device ${deviceId}.`, 'game: room rules', deviceId, 'game-scope'));
}

/**
 * Connects a cable. [GAME] rules: both ports exist and are free; server ports connect to switch ports only;
 * switch↔switch (ISL) allowed. Speed mismatch is allowed – the link simply stays down (linkStatus).
 */
export function connectCable(state: PhysicalState, catalog: HardwareCatalog, cable: Cable): TransitionResult<PhysicalState> {
  for (const p of [cable.a, cable.b]) {
    if (!portSpeeds(state, catalog, p)) return fail(issue('PHYS_PORT_NOT_FOUND', 'error', `Port ${portLabel(p)} does not exist.`, 'game: cabling', portLabel(p), 'game-scope'));
    if (cableAt(state, p)) return fail(issue('PHYS_PORT_IN_USE', 'error', `Port ${portLabel(p)} is already cabled.`, 'game: cabling', portLabel(p), 'game-scope'));
  }
  if (byId(state.cables, cable.id) || samePort(cable.a, cable.b) || (cable.a.kind !== 'switch' && cable.b.kind !== 'switch'))
    return fail(issue('PHYS_CABLE_INVALID', 'error', `Cable ${cable.id}: server ports connect to switch ports.`, 'game: cabling', cable.id, 'game-scope'));
  const cross = crossRoomCable(state, cable).issue;
  if (cross) return fail(cross);
  return { ok: true, state: { ...state, cables: [...state.cables, cable] } };
}

export function disconnectCable(state: PhysicalState, cableId: string): PhysicalState {
  return { ...state, cables: state.cables.filter((c) => c.id !== cableId) };
}

const vlanValid = (v: number): boolean => Number.isInteger(v) && v >= 1 && v <= 4094;

/** Switch port configuration. VLAN IDs 1–4094 (802.1Q range, as in DCUI [U33]); MTU within the generic switch range [GAME]. */
export function setSwitchPortConfig(state: PhysicalState, catalog: HardwareCatalog, switchId: string, port: number, cfg: SwitchPortConfig): TransitionResult<PhysicalState> {
  const sw = byId(state.switches, switchId);
  const m = sw ? catalog.switches.get(sw.modelId) : undefined;
  if (!sw || !m || port < 0 || port >= sw.ports.length)
    return fail(issue('PHYS_PORT_NOT_FOUND', 'error', `Port ${switchId}/p${port + 1} does not exist.`, 'game: cabling', switchId, 'game-scope'));
  if (cfg.mtu < GAME_MIN_MTU || cfg.mtu > m.maxMtu)
    return fail(issue('PHYS_MTU_OUT_OF_RANGE', 'error', `Port MTU ${cfg.mtu} outside ${GAME_MIN_MTU}–${m.maxMtu} of the generic switch.`, 'game: generic switch', switchId, 'game-scope'));
  const vlans = [cfg.accessVlan, cfg.nativeVlan, ...(cfg.allowedVlans === 'all' ? [] : cfg.allowedVlans)];
  if (!vlans.every(vlanValid))
    return fail(issue('PHYS_VLAN_INVALID', 'error', 'VLAN ID must be 1–4094.', '25 §6.3 [U33]', switchId));
  const ports = sw.ports.map((p, i) => (i === port ? cfg : p));
  return { ok: true, state: { ...state, switches: replace(state.switches, { ...sw, ports }) } };
}

/** Helper: apply the same config to many ports (e.g. "Nastavit MTU podle doporučení"). */
export function setSwitchPortsConfig(state: PhysicalState, catalog: HardwareCatalog, switchId: string, ports: readonly number[], f: (p: SwitchPortConfig) => SwitchPortConfig): TransitionResult<PhysicalState> {
  let s = state;
  for (const port of ports) {
    const cur = byId(s.switches, switchId)?.ports[port];
    if (!cur) return fail(issue('PHYS_PORT_NOT_FOUND', 'error', `Port ${switchId}/p${port + 1} does not exist.`, 'game: cabling', switchId, 'game-scope'));
    const r = setSwitchPortConfig(s, catalog, switchId, port, f(cur));
    if (!r.ok) return r;
    s = r.state;
  }
  return { ok: true, state: s };
}

/** [GAME] BMC OS pass-through / USB-NIC interface toggle (takes effect at the next ESX install). */
export function setBmcHostInterface(state: PhysicalState, serverId: string, enabled: boolean): TransitionResult<PhysicalState> {
  const srv = byId(state.servers, serverId);
  if (!srv) return fail(issue('PHYS_DEVICE_INVALID', 'error', `Unknown server ${serverId}.`, 'game', serverId, 'game-scope'));
  return { ok: true, state: { ...state, servers: replace(state.servers, { ...srv, bmc: { ...srv.bmc, hostInterfaceEnabled: enabled } }) } };
}

/**
 * Possible-cause hints for a failed bring-up (NOT installer validations). KB 376173 [U78]: vSwitchBMC / vusb0
 * "might cause the VMware Cloud Foundation Bring-Up process to fail"; Dell variant: "turn off the OS to iDRAC
 * Pass-Through functionality" [U79]. The KB names vSphere 8.0 / 8.0.3 – shown only as a hint.
 */
export function bringupPossibleCauseHints(state: PhysicalState, serverIds: readonly string[]): ValidationIssue[] {
  return state.servers
    .filter((s) => serverIds.includes(s.id) && s.hostNet?.switches.some((sw) => sw.name === 'vSwitchBMC'))
    .map((s) => issue('PHYS_HINT_VSWITCHBMC', 'recommendation', `Host ${s.esx.network?.hostnameFqdn ?? s.id} has vSwitchBMC (uplink vusb0) from the ${s.bmc.label} USB/NIC interface; this "might cause the VMware Cloud Foundation Bring-Up process to fail" – possible cause, turn off the OS to ${s.bmc.label} pass-through and reinstall / remove vSwitchBMC.`, '25 §10.2.3 [U78][U79] (KB for vSphere 8.0)', s.id));
}

/** [GAME] BMC VLAN tag (OOB is game scope). */
export function setBmcTag(state: PhysicalState, serverId: string, tag: number | null): TransitionResult<PhysicalState> {
  const srv = byId(state.servers, serverId);
  if (!srv) return fail(issue('PHYS_DEVICE_INVALID', 'error', `Unknown server ${serverId}.`, 'game', serverId, 'game-scope'));
  if (tag !== null && !vlanValid(tag)) return fail(issue('PHYS_VLAN_INVALID', 'error', 'VLAN ID must be 1–4094.', '25 §6.3 [U33]', serverId));
  return { ok: true, state: { ...state, servers: replace(state.servers, { ...srv, bmc: { ...srv.bmc, tag } }) } };
}

// ---------------------------------------------------------------------------
// ESX on a physical server
// ---------------------------------------------------------------------------

const withServer = (state: PhysicalState, s: PhysicalServer): PhysicalState => ({ ...state, servers: replace(state.servers, s) });

/** Installs ESX (bringup.installEsx) and creates the default host networking (25 §6.3). Reinstall resets it. */
export function installEsxOnServer(state: PhysicalState, serverId: string, version: string): TransitionResult<PhysicalState> {
  const srv = byId(state.servers, serverId);
  if (!srv) return fail(issue('PHYS_DEVICE_INVALID', 'error', `Unknown server ${serverId}.`, 'game', serverId, 'game-scope'));
  const r = installEsx(srv.esx, version);
  if (!r.ok) return r;
  return { ok: true, state: withServer(state, { ...srv, esx: r.state, hostNet: defaultHostNetworkingAfterInstall(srv.esx.pnicCount > 0, srv.bmc.hostInterfaceEnabled) }) };
}

const notInstalledIssue = (id: string): ValidationIssue => issue('ESX_NOT_INSTALLED', 'error', `Host ${id}: ESX is not installed.`, '20 §4.1.1 [S8]', id);

/**
 * DCUI "Configure Management Network" (20 §4.1.2; 25 §3.5): static IPv4 + optional VLAN on vmk0.
 * VLAN 1–4094 [U33].
 */
export function configureServerManagementNetwork(state: PhysicalState, serverId: string, network: EsxHostNetwork): TransitionResult<PhysicalState> {
  const srv = byId(state.servers, serverId);
  if (!srv) return fail(issue('PHYS_DEVICE_INVALID', 'error', `Unknown server ${serverId}.`, 'game', serverId, 'game-scope'));
  if (network.vlanId !== undefined && !vlanValid(network.vlanId)) return fail(issue('PHYS_VLAN_INVALID', 'error', 'VLAN ID must be 1–4094.', '25 §6.3 [U33]', serverId));
  const r = configureHostNetwork(srv.esx, network);
  if (!r.ok || !srv.hostNet) return r.ok ? fail(notInstalledIssue(serverId)) : r;
  const vmks = srv.hostNet.vmks.map((v) => (v.name === 'vmk0' ? { ...v, addressing: 'static' as const, ipv4: network.ipv4Address, tag: network.vlanId ?? null } : v));
  return { ok: true, state: withServer(state, { ...srv, esx: r.state, hostNet: { ...srv.hostNet, vmks } }) };
}

/** Writes back a bringup.ts host-prep transition (NTP, SSH, certificate) to the server. */
export function updateServerEsx(state: PhysicalState, serverId: string, f: (h: EsxHost) => TransitionResult<EsxHost>): TransitionResult<PhysicalState> {
  const srv = byId(state.servers, serverId);
  if (!srv) return fail(issue('PHYS_DEVICE_INVALID', 'error', `Unknown server ${serverId}.`, 'game', serverId, 'game-scope'));
  const r = f(srv.esx);
  return r.ok ? { ok: true, state: withServer(state, { ...srv, esx: r.state }) } : r;
}

/** DCUI "Network Adapters" – NICs of the management network on vSwitch0 [U32]. */
export function setStandardSwitchUplinks(state: PhysicalState, catalog: HardwareCatalog, serverId: string, uplinks: readonly number[]): TransitionResult<PhysicalState> {
  const srv = byId(state.servers, serverId);
  if (!srv?.hostNet) return fail(notInstalledIssue(serverId));
  const ports = serverNicPorts(catalog, srv).map((p) => p.vmnic);
  if (!uplinks.every((u) => ports.includes(u))) return fail(issue('PHYS_PORT_NOT_FOUND', 'error', `Host ${serverId}: unknown vmnic.`, 'game', serverId, 'game-scope'));
  const switches = srv.hostNet.switches.map((s) => (s.name === 'vSwitch0' ? { ...s, uplinks: [...uplinks] } : s));
  return { ok: true, state: withServer(state, { ...srv, hostNet: { ...srv.hostNet, switches } }) };
}

/** Virtual switch MTU: VSS max 9000 [U39], VDS max 9190 [U40]. */
export function setHostSwitchMtu(state: PhysicalState, serverId: string, switchName: string, mtu: number): TransitionResult<PhysicalState> {
  const srv = byId(state.servers, serverId);
  const sw = srv?.hostNet?.switches.find((s) => s.name === switchName);
  if (!srv?.hostNet || !sw) return fail(notInstalledIssue(serverId));
  const max = sw.kind === 'vss' ? MTU_LIMITS.vssMax : MTU_LIMITS.vdsMax;
  if (mtu < GAME_MIN_MTU || mtu > max)
    return fail(issue('HOST_MTU_OUT_OF_RANGE', 'error', `${switchName}: MTU ${mtu} exceeds the maximum ${max} for a ${sw.kind === 'vss' ? 'vSphere Standard Switch' : 'vSphere Distributed Switch'}.`, sw.kind === 'vss' ? '25 §6.3 [U39]' : '25 §6.3 [U40]', serverId));
  const switches = srv.hostNet.switches.map((s) => (s.name === switchName ? { ...s, mtu } : s));
  return { ok: true, state: withServer(state, { ...srv, hostNet: { ...srv.hostNet, switches } }) };
}

/** VMkernel MTU max 9000 [U41]. */
export function setVmkMtu(state: PhysicalState, serverId: string, vmk: string, mtu: number): TransitionResult<PhysicalState> {
  const srv = byId(state.servers, serverId);
  if (!srv?.hostNet?.vmks.some((v) => v.name === vmk)) return fail(notInstalledIssue(serverId));
  if (mtu < GAME_MIN_MTU || mtu > MTU_LIMITS.vmkMax)
    return fail(issue('HOST_MTU_OUT_OF_RANGE', 'error', `${vmk}: VMkernel MTU ${mtu} exceeds the maximum 9000.`, '25 §6.3 [U41]', serverId));
  const vmks = srv.hostNet.vmks.map((v) => (v.name === vmk ? { ...v, mtu } : v));
  return { ok: true, state: withServer(state, { ...srv, hostNet: { ...srv.hostNet, vmks } }) };
}

/** Planned host networks (subset of the wizard's NetworkDetails, 20 §4.2 step 11). */
export interface PlannedHostNetworks {
  readonly esxManagement: { readonly vlanId: number };
  readonly vmotion: { readonly vlanId: number; readonly mtu: number };
  /** vSAN or NFS network (not used for VMFS on FC). */
  readonly storage?: { readonly vlanId: number; readonly mtu: number };
  readonly nsxHostOverlay?: { readonly vlanId: number; readonly mtu: number };
}

/**
 * Host networking after bring-up: "Po bring-upu installer migruje hosty na VDS a přidá další uplinky" (25 §7 [U18]).
 * [GAME] details: one VDS "vds01" with every cabled vmnic as uplink, VDS MTU = largest planned MTU, vmk0 moved to it,
 * vmk1 vMotion, vmk2 vSAN/NFS, vmk10 TEP with the planned VLAN / MTU. IP addresses are not assigned here.
 */
export function applyBringupHostNetworking(state: PhysicalState, serverIds: readonly string[], plan: PlannedHostNetworks, storage: StorageType): PhysicalState {
  let s = state;
  for (const id of serverIds) {
    const srv = byId(s.servers, id);
    if (!srv?.hostNet) continue;
    const uplinks = s.cables
      .flatMap((c) => [c.a, c.b])
      .filter((p): p is Extract<PortRef, { kind: 'server-nic' }> => p.kind === 'server-nic' && p.serverId === id)
      .map((p) => p.vmnic)
      .sort((a, b) => a - b);
    const nets = [plan.vmotion, plan.storage, plan.nsxHostOverlay].filter((n): n is { vlanId: number; mtu: number } => n !== undefined);
    const vdsMtu = Math.min(MTU_LIMITS.vdsMax, Math.max(1500, ...nets.map((n) => n.mtu)));
    const vmk0 = srv.hostNet.vmks.find((v) => v.name === 'vmk0');
    const vmks: VmkernelAdapter[] = [
      ...(vmk0 ? [{ ...vmk0, switchName: 'vds01', tag: plan.esxManagement.vlanId }] : []),
      { name: 'vmk1', switchName: 'vds01', service: 'vmotion', tag: plan.vmotion.vlanId, mtu: plan.vmotion.mtu, addressing: 'static' },
      ...(plan.storage && storage !== 'vmfs-fc'
        ? [{ name: 'vmk2', switchName: 'vds01', service: storage === 'nfs-v3' ? ('nfs' as const) : ('vsan' as const), tag: plan.storage.vlanId, mtu: plan.storage.mtu, addressing: 'static' as const }]
        : []),
      ...(plan.nsxHostOverlay ? [{ name: 'vmk10', switchName: 'vds01', service: 'host-tep' as const, tag: plan.nsxHostOverlay.vlanId, mtu: Math.min(MTU_LIMITS.vmkMax, plan.nsxHostOverlay.mtu), addressing: 'static' as const }] : []),
    ];
    const hostNet: HostNetworking = { switches: [{ name: 'vds01', kind: 'vds', uplinks, mtu: vdsMtu }], vmks };
    s = withServer(s, { ...srv, esx: { ...srv.esx, vmk0OnStandardSwitch: false }, hostNet });
  }
  return s;
}

// ===========================================================================
// Reachability (L2 per VLAN + routing via gateway endpoints) [GAME simplification, see header]
// ===========================================================================

/** Something that sends / receives traffic. */
export type NetNode =
  | { readonly kind: 'vmk'; readonly serverId: string; readonly vmk: string }
  /** Planned network on all cabled host NIC ports (installer validation before the VDS exists). */
  | { readonly kind: 'host-uplinks'; readonly serverId: string; readonly tag: number | null; readonly mtu: number }
  | { readonly kind: 'bmc'; readonly serverId: string }
  | { readonly kind: 'endpoint'; readonly endpointId: string };

interface AttachPoint {
  readonly switchId: string;
  readonly port: number;
  readonly tag: number | null;
  readonly sideMtu: number;
  /** Device-side port (host vmnic / BMC) and cable. */
  readonly devicePort?: PortRef;
  readonly cableId?: string;
  /** For local (same host, same virtual switch) delivery. */
  readonly local?: { readonly serverId: string; readonly switchName: string };
}

export type PathHop =
  | { readonly kind: 'cable'; readonly cableId: string }
  | { readonly kind: 'switch'; readonly switchId: string }
  | { readonly kind: 'endpoint-port'; readonly endpointId: string; readonly switchId: string; readonly port: number };

export interface PathResult {
  readonly reachable: boolean;
  /** Effective path MTU = min along the path. */
  readonly pathMtu?: number;
  readonly vlan?: number;
  readonly hops: readonly PathHop[];
  readonly cableIds: readonly string[];
  /** Device ports used at both ends (vmnicN / bmc) – for per-uplink visualisation. */
  readonly fromPort?: PortRef;
  readonly toPort?: PortRef;
  /** Gateway endpoint the traffic was routed through. */
  readonly routedVia?: string;
  /** Same host, same virtual switch – no physical hop. */
  readonly local?: boolean;
}

const NO_PATH: PathResult = { reachable: false, hops: [], cableIds: [] };

/** The same path walked the other way (hops / cables reversed, end ports swapped). */
export function reversedPath(p: PathResult): PathResult {
  const { fromPort, toPort, ...rest } = p;
  return { ...rest, hops: [...p.hops].reverse(), cableIds: [...p.cableIds].reverse(), ...(toPort ? { fromPort: toPort } : {}), ...(fromPort ? { toPort: fromPort } : {}) };
}

export interface NetContext {
  readonly state: PhysicalState;
  readonly catalog: HardwareCatalog;
}

function switchPortFor(ctx: NetContext, devicePort: PortRef): { switchId: string; port: number; cableId: string } | undefined {
  const c = cableAt(ctx.state, devicePort);
  if (!c || !linkStatus(ctx.state, ctx.catalog, c).up) return undefined;
  const peer = peerOf(c, devicePort);
  return peer.kind === 'switch' ? { switchId: peer.switchId, port: peer.port, cableId: c.id } : undefined;
}

function hostUplinkAps(ctx: NetContext, srv: PhysicalServer, vmnics: readonly number[], tag: number | null, sideMtu: number, local?: AttachPoint['local']): AttachPoint[] {
  const out: AttachPoint[] = [];
  for (const vmnic of vmnics) {
    const devicePort: PortRef = { kind: 'server-nic', serverId: srv.id, vmnic };
    const sp = switchPortFor(ctx, devicePort);
    if (sp) out.push({ switchId: sp.switchId, port: sp.port, tag, sideMtu, devicePort, cableId: sp.cableId, ...(local ? { local } : {}) });
  }
  // keep a "local only" point even without cables so VMs on the same host can talk
  if (out.length === 0 && local) out.push({ switchId: '', port: -1, tag, sideMtu, local });
  return out;
}

function attachPoints(ctx: NetContext, node: NetNode): AttachPoint[] {
  const { state } = ctx;
  switch (node.kind) {
    case 'vmk': {
      const srv = byId(state.servers, node.serverId);
      const vmk = srv?.hostNet?.vmks.find((v) => v.name === node.vmk);
      const sw = srv?.hostNet?.switches.find((s) => s.name === vmk?.switchName);
      if (!srv || !vmk || !sw) return [];
      return hostUplinkAps(ctx, srv, sw.uplinks, vmk.tag, sw.mtu, { serverId: srv.id, switchName: sw.name });
    }
    case 'host-uplinks': {
      const srv = byId(state.servers, node.serverId);
      if (!srv) return [];
      return hostUplinkAps(ctx, srv, serverNicPorts(ctx.catalog, srv).map((p) => p.vmnic), node.tag, node.mtu);
    }
    case 'bmc': {
      const srv = byId(state.servers, node.serverId);
      if (!srv) return [];
      const devicePort: PortRef = { kind: 'server-bmc', serverId: srv.id };
      const sp = switchPortFor(ctx, devicePort);
      return sp ? [{ switchId: sp.switchId, port: sp.port, tag: srv.bmc.tag, sideMtu: 1500, devicePort, cableId: sp.cableId }] : [];
    }
    case 'endpoint': {
      const ep = byId(state.endpoints, node.endpointId);
      if (!ep) return [];
      const a = ep.attachment;
      if (a.kind === 'switch-port') return a.tags.map((tag) => ({ switchId: a.switchId, port: a.port, tag, sideMtu: ep.mtu }));
      const srv = byId(state.servers, a.serverId);
      const vmk0 = srv?.hostNet?.vmks.find((v) => v.name === 'vmk0');
      const sw = srv?.hostNet?.switches.find((s) => s.name === vmk0?.switchName);
      if (!srv || !sw) return [];
      return hostUplinkAps(ctx, srv, sw.uplinks, a.tag, Math.min(sw.mtu, ep.mtu), { serverId: srv.id, switchName: sw.name });
    }
  }
}

function portCfg(ctx: NetContext, switchId: string, port: number): SwitchPortConfig | undefined {
  return byId(ctx.state.switches, switchId)?.ports[port];
}

/** [GAME] generic 802.1Q ingress: switch VLAN of a frame with `tag`, or null when dropped. */
export function ingressVlan(cfg: SwitchPortConfig, tag: number | null): number | null {
  if (cfg.mode === 'access') return tag === null ? cfg.accessVlan : null;
  if (tag === null) return cfg.nativeVlan;
  return carriesVlan(cfg, tag) ? tag : null;
}

export function carriesVlan(cfg: SwitchPortConfig, vlan: number): boolean {
  if (cfg.mode === 'access') return cfg.accessVlan === vlan;
  return vlan === cfg.nativeVlan || cfg.allowedVlans === 'all' || cfg.allowedVlans.includes(vlan);
}

/** [GAME] generic 802.1Q egress: tag of a frame in switch VLAN `vlan` leaving `cfg` (null = untagged), or undefined when not carried. */
export function egressTag(cfg: SwitchPortConfig, vlan: number): number | null | undefined {
  if (!carriesVlan(cfg, vlan)) return undefined;
  if (cfg.mode === 'access') return null;
  return vlan === cfg.nativeVlan ? null : vlan;
}

/**
 * Widest path (max bottleneck MTU) from (switch, VLAN) to (switch, VLAN) over up switch↔switch cables.
 * Crossing a cable re-maps the VLAN: egress tag on this side -> ingress VLAN on the other side ([GAME] 802.1Q).
 */
function switchPath(ctx: NetContext, from: string, fromVlan: number, to: string, toVlan: number): { mtu: number; switches: string[]; cables: string[] } | undefined {
  type Label = { mtu: number; switches: string[]; cables: string[] };
  const key = (sw: string, v: number): string => `${sw}|${v}`;
  const start = key(from, fromVlan);
  const goal = key(to, toVlan);
  const best = new Map<string, Label & { sw: string; vlan: number }>([[start, { mtu: Infinity, switches: [from], cables: [], sw: from, vlan: fromVlan }]]);
  const done = new Set<string>();
  for (;;) {
    let cur: string | undefined;
    for (const [k, v] of best) if (!done.has(k) && (cur === undefined || v.mtu > (best.get(cur)?.mtu ?? -1))) cur = k;
    if (cur === undefined) return undefined;
    const lab = best.get(cur);
    if (!lab) return undefined;
    if (cur === goal) return { mtu: lab.mtu, switches: lab.switches, cables: lab.cables };
    done.add(cur);
    for (const c of ctx.state.cables) {
      if (c.a.kind !== 'switch' || c.b.kind !== 'switch') continue;
      const [here, there] = c.a.switchId === lab.sw ? [c.a, c.b] : c.b.switchId === lab.sw ? [c.b, c.a] : [undefined, undefined];
      if (!here || !there || here.kind !== 'switch' || there.kind !== 'switch' || !linkStatus(ctx.state, ctx.catalog, c).up) continue;
      const ca = portCfg(ctx, here.switchId, here.port);
      const cb = portCfg(ctx, there.switchId, there.port);
      if (!ca || !cb) continue;
      const tag = egressTag(ca, lab.vlan);
      if (tag === undefined) continue;
      const v2 = ingressVlan(cb, tag);
      if (v2 === null) continue;
      const k2 = key(there.switchId, v2);
      if (done.has(k2)) continue;
      const mtu = Math.min(lab.mtu, ca.mtu, cb.mtu);
      if (mtu > (best.get(k2)?.mtu ?? -1)) best.set(k2, { mtu, switches: [...lab.switches, there.switchId], cables: [...lab.cables, c.id], sw: there.switchId, vlan: v2 });
    }
  }
}

function l2Path(ctx: NetContext, A: readonly AttachPoint[], B: readonly AttachPoint[]): PathResult {
  let best: PathResult = NO_PATH;
  const better = (r: PathResult): void => {
    if (!best.reachable || (r.pathMtu ?? 0) > (best.pathMtu ?? 0)) best = r;
  };
  for (const a of A)
    for (const b of B) {
      if (a.local && b.local && a.local.serverId === b.local.serverId && a.local.switchName === b.local.switchName && a.tag === b.tag) {
        better({ reachable: true, pathMtu: Math.min(a.sideMtu, b.sideMtu), hops: [], cableIds: [], local: true, ...(a.tag !== null ? { vlan: a.tag } : {}) });
        continue;
      }
      if (a.port < 0 || b.port < 0) continue;
      const ca = portCfg(ctx, a.switchId, a.port);
      const cb = portCfg(ctx, b.switchId, b.port);
      if (!ca || !cb) continue;
      const vlan = ingressVlan(ca, a.tag);
      const vlanB = ingressVlan(cb, b.tag);
      if (vlan === null || vlanB === null) continue;
      if (a.switchId === b.switchId && a.port === b.port && a.devicePort && b.devicePort) continue; // same physical port, different device ends: impossible
      const sp = a.switchId === b.switchId && vlan === vlanB ? { mtu: Infinity, switches: [a.switchId], cables: [] as string[] } : switchPath(ctx, a.switchId, vlan, b.switchId, vlanB);
      if (!sp) continue;
      const mtu = Math.min(a.sideMtu, b.sideMtu, ca.mtu, cb.mtu, sp.mtu);
      const cableIds = [...(a.cableId ? [a.cableId] : []), ...sp.cables, ...(b.cableId ? [b.cableId] : [])];
      const hops: PathHop[] = [];
      if (a.cableId) hops.push({ kind: 'cable', cableId: a.cableId });
      sp.switches.forEach((s, i) => {
        hops.push({ kind: 'switch', switchId: s });
        const isl = sp.cables[i];
        if (isl) hops.push({ kind: 'cable', cableId: isl });
      });
      if (b.cableId) hops.push({ kind: 'cable', cableId: b.cableId });
      better({ reachable: true, pathMtu: mtu, vlan, hops, cableIds, ...(a.devicePort ? { fromPort: a.devicePort } : {}), ...(b.devicePort ? { toPort: b.devicePort } : {}) });
    }
  return best;
}

function hasGatewayConfigured(ctx: NetContext, node: NetNode): boolean {
  if (node.kind === 'endpoint') return true; // [GAME] services are assumed to have their gateway set
  if (node.kind === 'vmk') {
    const srv = byId(ctx.state.servers, node.serverId);
    return node.vmk === 'vmk0' ? (srv?.esx.network?.defaultGateway ?? '') !== '' : false;
  }
  return node.kind === 'bmc'; // [GAME] BMC uses the OOB gateway
}

/**
 * Path between two nodes: L2 in one VLAN, else routed through a `gateway` endpoint that has an interface in
 * both VLANs (both ends must have a gateway configured). [GAME] simplification, see header.
 */
export function pathBetween(ctx: NetContext, from: NetNode, to: NetNode): PathResult {
  const A = attachPoints(ctx, from);
  const B = attachPoints(ctx, to);
  const direct = l2Path(ctx, A, B);
  if (direct.reachable) return direct;
  if (!hasGatewayConfigured(ctx, from) || !hasGatewayConfigured(ctx, to)) return NO_PATH;
  let best: PathResult = NO_PATH;
  for (const gw of ctx.state.endpoints) {
    if (gw.kind !== 'gateway') continue;
    if ((from.kind === 'endpoint' && from.endpointId === gw.id) || (to.kind === 'endpoint' && to.endpointId === gw.id)) continue;
    const G = attachPoints(ctx, { kind: 'endpoint', endpointId: gw.id });
    const p1 = l2Path(ctx, A, G);
    const p2 = l2Path(ctx, G, B);
    if (!p1.reachable || !p2.reachable) continue;
    const mtu = Math.min(p1.pathMtu ?? 0, p2.pathMtu ?? 0);
    if (!best.reachable || mtu > (best.pathMtu ?? 0)) {
      const { vlan: _v, ...p1rest } = p1;
      void _v;
      best = {
        ...p1rest,
        reachable: true,
        pathMtu: mtu,
        hops: [...p1.hops, ...p2.hops],
        cableIds: [...p1.cableIds, ...p2.cableIds],
        ...(p2.toPort ? { toPort: p2.toPort } : {}),
        routedVia: gw.id,
      };
    }
  }
  return best;
}

// ===========================================================================
// Traffic flows for visualisation
// ===========================================================================

/** Visual traffic classes (render TRAFFIC_TYPES subset) + 'oob' (game scope). */
export type FlowTrafficClass = 'management' | 'vmotion' | 'vsan' | 'nfs' | 'overlay' | 'oob';

export type FlowNodeRef = { readonly kind: 'server'; readonly id: string } | { readonly kind: 'endpoint'; readonly id: string };

export interface TrafficFlow {
  readonly id: string;
  readonly trafficClass: FlowTrafficClass;
  readonly from: FlowNodeRef;
  readonly to: FlowNodeRef;
  readonly bidirectional: boolean;
  /** Protocol / ports as documented (or 'neuvedeno' when the source gives none). */
  readonly protocol: string;
  readonly purpose: string;
  /** 'steady' = continuous while the state allows it; 'activity' = only during the given activity. */
  readonly trigger: 'steady' | 'activity';
  readonly vlan?: number;
  readonly pathMtu?: number;
  /** Cables of the path, ordered from `from` to `to` (same order as `hops`). */
  readonly cableIds: readonly string[];
  /** Path hops ordered from `from` to `to` (direction of the flow; per-direction volumes rely on it). */
  readonly hops: readonly PathHop[];
  /** Device port at the `from` end / at the `to` end. */
  readonly fromPort?: PortRef;
  readonly toPort?: PortRef;
  /** Illustrative load in Gbit/s (game value, UX "ilustrativní model"). */
  readonly illustrativeLoadGbps: number;
  readonly specRef: string;
  /** Game-scope flow (OOB) – not a documented VCF flow. */
  readonly gameScope?: true;
  /** Flow is documented, but showing it continuously is a visual simplification. */
  readonly visualSimplification?: true;
}

export type NetworkActivity =
  | { readonly kind: 'dcui-test-management-network'; readonly serverId: string }
  | { readonly kind: 'installer-validation'; readonly plan?: PlannedHostNetworks }
  | { readonly kind: 'bringup' }
  | { readonly kind: 'vmotion' }
  | { readonly kind: 'overlay' };

export interface FlowContext {
  /** Hosts managed by the vCenter endpoint (after it was deployed). */
  readonly vcenterManagedServerIds?: readonly string[];
  readonly activities?: readonly NetworkActivity[];
}

/** [GAME] illustrative loads (Gbit/s). */
export const ILLUSTRATIVE_LOAD_GBPS: Readonly<Record<string, number>> = {
  oob: 0.01, dhcp: 0.001, ntp: 0.001, dns: 0.002, hostClient: 0.02, ping: 0.005,
  vcenter: 0.05, heartbeat: 0.005, vmkping: 0.2, vsan: 4, vmotion: 8, overlay: 2,
};
const L = ILLUSTRATIVE_LOAD_GBPS;

export interface UplinkTraffic {
  readonly serverId: string;
  /** vmnicN or BMC port of the host. */
  readonly port: Extract<PortRef, { kind: 'server-nic' | 'server-bmc' }>;
  readonly label: string;
  readonly cableId?: string;
  readonly linkUp: boolean;
  readonly speedGbE?: number;
  /** Illustrative load per class (Gbit/s). */
  readonly loadGbpsByClass: Readonly<Partial<Record<FlowTrafficClass, number>>>;
  readonly totalLoadGbps: number;
  /** total / speed (0..n, illustrative). */
  readonly utilization: number;
  readonly flowIds: readonly string[];
}

export interface LinkTraffic {
  readonly cableId: string;
  readonly speedGbE?: number;
  readonly loadGbpsByClass: Readonly<Partial<Record<FlowTrafficClass, number>>>;
  readonly totalLoadGbps: number;
  readonly utilization: number;
  readonly flowIds: readonly string[];
}

export interface TrafficView {
  readonly flows: readonly TrafficFlow[];
  /** One entry per host NIC port and BMC port (also idle ones). */
  readonly uplinks: readonly UplinkTraffic[];
  /** One entry per cable (also idle ones). */
  readonly links: readonly LinkTraffic[];
}

const isOnline = (s: PhysicalServer): boolean => s.esx.esxVersion !== undefined && s.hostNet !== undefined;
const vmk0Static = (s: PhysicalServer): boolean => s.hostNet?.vmks.some((v) => v.name === 'vmk0' && v.addressing === 'static') === true;
const vmkOf = (s: PhysicalServer, service: VmkService): VmkernelAdapter | undefined => s.hostNet?.vmks.find((v) => v.service === service);

/**
 * Flows to visualise for the current state. Only flows documented in 25 §7 (N1–N8), 20 §7 and 10 §7,
 * plus OOB (game scope). A flow appears only when cabling and configuration allow it (pathBetween).
 */
export function computeTrafficFlows(ctx: NetContext, fctx: FlowContext = {}): TrafficView {
  const { state } = ctx;
  const flows: TrafficFlow[] = [];
  const eps = (k: EndpointKind): ServiceEndpoint[] => state.endpoints.filter((e) => e.kind === k);
  const acts = fctx.activities ?? [];
  const has = (k: NetworkActivity['kind']): boolean => acts.some((a) => a.kind === k);
  const S = (id: string): FlowNodeRef => ({ kind: 'server', id });
  const E = (id: string): FlowNodeRef => ({ kind: 'endpoint', id });
  const add = (f: Omit<TrafficFlow, 'cableIds' | 'hops' | 'vlan' | 'pathMtu' | 'fromPort' | 'toPort'>, p: PathResult): void => {
    if (!p.reachable) return;
    flows.push({
      ...f,
      cableIds: p.cableIds,
      hops: p.hops,
      ...(p.vlan !== undefined ? { vlan: p.vlan } : {}),
      ...(p.pathMtu !== undefined ? { pathMtu: p.pathMtu } : {}),
      ...(p.fromPort ? { fromPort: p.fromPort } : {}),
      ...(p.toPort ? { toPort: p.toPort } : {}),
    });
  };
  const vmk0 = (id: string): NetNode => ({ kind: 'vmk', serverId: id, vmk: 'vmk0' });
  const ep = (id: string): NetNode => ({ kind: 'endpoint', endpointId: id });

  for (const srv of state.servers) {
    // OOB – game scope: admin workstation ↔ BMC (remote console / power) as soon as the BMC is cabled.
    for (const a of eps('admin-workstation'))
      add({ id: `oob:${a.id}:${srv.id}`, trafficClass: 'oob', from: E(a.id), to: S(srv.id), bidirectional: true, protocol: 'game: BMC web / remote console', purpose: `${srv.bmc.label} out-of-band management (game scope)`, trigger: 'steady', illustrativeLoadGbps: L['oob'] ?? 0, specRef: '25 §10 [U55] (OOB out of VCF scope – game flow)', gameScope: true }, pathBetween(ctx, ep(a.id), { kind: 'bmc', serverId: srv.id }));

    if (!isOnline(srv)) continue;
    // N1: DHCP right after install (25 §7 N1 [U30][U31]); broadcast -> L2 only.
    if (!vmk0Static(srv))
      for (const d of eps('dhcp')) {
        const p = l2Path(ctx, attachPoints(ctx, vmk0(srv.id)), attachPoints(ctx, ep(d.id)));
        add({ id: `dhcp:${srv.id}:${d.id}`, trafficClass: 'management', from: S(srv.id), to: E(d.id), bidirectional: true, protocol: 'DHCP (port neuveden)', purpose: 'ESX management IP via DHCP after install', trigger: 'steady', illustrativeLoadGbps: L['dhcp'] ?? 0, specRef: '25 §7 N1 [U30][U31]' }, p);
      }
    if (!vmk0Static(srv)) continue;

    // 20 §7 #3 / 25 N7: admin -> ESX Host Client (HTTPS).
    for (const a of eps('admin-workstation'))
      add({ id: `hostclient:${a.id}:${srv.id}`, trafficClass: 'management', from: E(a.id), to: S(srv.id), bidirectional: true, protocol: 'HTTPS', purpose: 'VMware Host Client (NTP, SSH, OVA)', trigger: 'steady', illustrativeLoadGbps: L['hostClient'] ?? 0, specRef: '20 §7 #3; 25 §7 N7', visualSimplification: true }, pathBetween(ctx, ep(a.id), vmk0(srv.id)));
    // 20 §7 #7: ESX -> NTP.
    if (srv.esx.ntp.serviceRunning)
      for (const n of eps('ntp'))
        add({ id: `ntp:${srv.id}:${n.id}`, trafficClass: 'management', from: S(srv.id), to: E(n.id), bidirectional: false, protocol: 'NTP (port neuveden)', purpose: 'time synchronisation', trigger: 'steady', illustrativeLoadGbps: L['ntp'] ?? 0, specRef: '20 §7 #7 [S10]' }, pathBetween(ctx, vmk0(srv.id), ep(n.id)));
    // 20 §7 #19, #20: vCenter <-> managed hosts.
    if (fctx.vcenterManagedServerIds?.includes(srv.id))
      for (const vc of eps('vcenter')) {
        const p = pathBetween(ctx, ep(vc.id), vmk0(srv.id));
        add({ id: `vc:${vc.id}:${srv.id}`, trafficClass: 'management', from: E(vc.id), to: S(srv.id), bidirectional: true, protocol: 'TCP 443, 902, ICMP', purpose: 'host management, vLCM', trigger: 'steady', illustrativeLoadGbps: L['vcenter'] ?? 0, specRef: '20 §7 #19 [S41]' }, p);
        add({ id: `hb:${srv.id}:${vc.id}`, trafficClass: 'management', from: S(srv.id), to: E(vc.id), bidirectional: false, protocol: 'UDP 902', purpose: 'ESXi host heartbeats', trigger: 'steady', illustrativeLoadGbps: L['heartbeat'] ?? 0, specRef: '20 §7 #20 [S42]' }, reversedPath(p));
      }
  }

  // Activity: DCUI Test Management Network (25 §7 N2 [U34]).
  for (const a of acts) {
    if (a.kind !== 'dcui-test-management-network') continue;
    const srv = byId(state.servers, a.serverId);
    if (!srv || !isOnline(srv)) continue;
    for (const g of eps('gateway'))
      add({ id: `dcui-gw:${srv.id}:${g.id}`, trafficClass: 'management', from: S(srv.id), to: E(g.id), bidirectional: true, protocol: 'ping', purpose: 'Test Management Network: ping default gateway', trigger: 'activity', illustrativeLoadGbps: L['ping'] ?? 0, specRef: '25 §7 N2 [U34]' }, l2Path(ctx, attachPoints(ctx, vmk0(srv.id)), attachPoints(ctx, ep(g.id))));
    for (const d of eps('dns'))
      add({ id: `dcui-dns:${srv.id}:${d.id}`, trafficClass: 'management', from: S(srv.id), to: E(d.id), bidirectional: true, protocol: 'ping; DNS', purpose: 'Test Management Network: ping DNS, resolve hostname', trigger: 'activity', illustrativeLoadGbps: L['dns'] ?? 0, specRef: '25 §7 N2 [U34]' }, pathBetween(ctx, vmk0(srv.id), ep(d.id)));
  }

  // Activity: installer validation / bring-up (20 §7 #5, #6, #18; 25 §7 N3–N6).
  if (has('installer-validation') || has('bringup')) {
    for (const inst of eps('vcf-installer')) {
      for (const srv of state.servers.filter((s) => isOnline(s) && vmk0Static(s)))
        add({ id: `inst:${inst.id}:${srv.id}`, trafficClass: 'management', from: E(inst.id), to: S(srv.id), bidirectional: true, protocol: 'ICMP; TCP 7/80/8443 (IP in use check)', purpose: 'installer validation / configuration of ESX hosts', trigger: 'activity', illustrativeLoadGbps: L['ping'] ?? 0, specRef: '20 §7 #5 [S5][S6][S39]' }, pathBetween(ctx, ep(inst.id), vmk0(srv.id)));
      for (const d of eps('dns'))
        add({ id: `inst-dns:${inst.id}:${d.id}`, trafficClass: 'management', from: E(inst.id), to: E(d.id), bidirectional: true, protocol: 'DNS 53 UDP/TCP', purpose: 'forward + reverse lookups', trigger: 'activity', illustrativeLoadGbps: L['dns'] ?? 0, specRef: '20 §7 #6 [S6][S38]' }, pathBetween(ctx, ep(inst.id), ep(d.id)));
      if (has('bringup'))
        for (const vc of eps('vcenter'))
          add({ id: `inst-vc:${inst.id}:${vc.id}`, trafficClass: 'management', from: E(inst.id), to: E(vc.id), bidirectional: true, protocol: 'TCP 22, 443, 5480, ICMP', purpose: 'vCenter deployment', trigger: 'activity', illustrativeLoadGbps: L['vcenter'] ?? 0, specRef: '20 §7 #18 [S40]' }, pathBetween(ctx, ep(inst.id), ep(vc.id)));
    }
    const plan = acts.find((a): a is Extract<NetworkActivity, { kind: 'installer-validation' }> => a.kind === 'installer-validation')?.plan;
    if (plan) {
      const online = state.servers.filter(isOnline);
      const nets: [string, FlowTrafficClass, { vlanId: number; mtu: number } | undefined, string][] = [
        ['vmotion', 'vmotion', plan.vmotion, '25 §7 N3 [U45][U46][U47]'],
        ['vsan', 'vsan', plan.storage, '25 §7 N5 [U45][U48]'],
        ['tep', 'overlay', plan.nsxHostOverlay, '25 §7 N6 [U46]'],
      ];
      for (const [name, tc, net, ref] of nets) {
        if (!net) continue;
        for (let i = 0; i < online.length; i++)
          for (let j = i + 1; j < online.length; j++) {
            const a = online[i];
            const b = online[j];
            if (!a || !b) continue;
            const p = pathBetween(ctx, { kind: 'host-uplinks', serverId: a.id, tag: net.vlanId, mtu: net.mtu }, { kind: 'host-uplinks', serverId: b.id, tag: net.vlanId, mtu: net.mtu });
            add({ id: `vmkping-${name}:${a.id}:${b.id}`, trafficClass: tc, from: S(a.id), to: S(b.id), bidirectional: true, protocol: `vmkping MTU ${net.mtu} / 1500`, purpose: `installer ${name} network connectivity validation`, trigger: 'activity', illustrativeLoadGbps: L['vmkping'] ?? 0, specRef: ref }, p);
          }
      }
    }
  }

  // Host <-> host after bring-up (10 §7 #2, #3, #4, #5).
  const pairs = (service: VmkService, tc: FlowTrafficClass, trigger: 'steady' | 'activity', load: number, ref: string, purpose: string): void => {
    const hosts = state.servers.filter((s) => isOnline(s) && vmkOf(s, service));
    for (let i = 0; i < hosts.length; i++)
      for (let j = i + 1; j < hosts.length; j++) {
        const a = hosts[i];
        const b = hosts[j];
        const va = a && vmkOf(a, service);
        const vb = b && vmkOf(b, service);
        if (!a || !b || !va || !vb) continue;
        const p = pathBetween(ctx, { kind: 'vmk', serverId: a.id, vmk: va.name }, { kind: 'vmk', serverId: b.id, vmk: vb.name });
        // Frames larger than the path MTU are dropped (25 §5.4 [U44]) -> no flow when the vmk MTU does not fit.
        if (p.reachable && (p.pathMtu ?? 0) >= Math.max(va.mtu, vb.mtu))
          add({ id: `${service}:${a.id}:${b.id}`, trafficClass: tc, from: S(a.id), to: S(b.id), bidirectional: true, protocol: 'neuvedeno', purpose, trigger, illustrativeLoadGbps: load, specRef: ref }, p);
      }
  };
  pairs('vsan', 'vsan', 'steady', L['vsan'] ?? 0, '10 §7 #3 [P15][P18]', 'vSAN synchronous replication');
  if (has('vmotion')) pairs('vmotion', 'vmotion', 'activity', L['vmotion'] ?? 0, '10 §7 #2 [P18][P21]', 'VM migration');
  if (has('overlay')) pairs('host-tep', 'overlay', 'activity', L['overlay'] ?? 0, '10 §7 #5 [P19][P21]', 'NSX overlay (Geneve)');

  return { flows, ...aggregateTraffic(ctx, flows) };
}

/** Per-uplink / per-cable aggregates of a flow list (also used by modes that merge flow lists, e.g. Hotové scénáře). */
export function aggregateTraffic(ctx: NetContext, flows: readonly TrafficFlow[]): Pick<TrafficView, 'uplinks' | 'links'> {
  const { state, catalog } = ctx;
  const linkAgg = new Map<string, { byClass: Partial<Record<FlowTrafficClass, number>>; total: number; flowIds: string[] }>();
  for (const f of flows)
    for (const cid of new Set(f.cableIds)) {
      const a = linkAgg.get(cid) ?? { byClass: {}, total: 0, flowIds: [] };
      a.byClass[f.trafficClass] = (a.byClass[f.trafficClass] ?? 0) + f.illustrativeLoadGbps;
      a.total += f.illustrativeLoadGbps;
      a.flowIds.push(f.id);
      linkAgg.set(cid, a);
    }
  const links: LinkTraffic[] = state.cables.map((c) => {
    const ls = linkStatus(state, catalog, c);
    const a = linkAgg.get(c.id);
    const total = a?.total ?? 0;
    return { cableId: c.id, ...(ls.speedGbE !== undefined ? { speedGbE: ls.speedGbE } : {}), loadGbpsByClass: a?.byClass ?? {}, totalLoadGbps: total, utilization: ls.speedGbE ? total / ls.speedGbE : 0, flowIds: a?.flowIds ?? [] };
  });
  const linkById = new Map(links.map((l) => [l.cableId, l]));
  const uplinks: UplinkTraffic[] = [];
  for (const srv of state.servers) {
    const ports: Extract<PortRef, { kind: 'server-nic' | 'server-bmc' }>[] = [
      { kind: 'server-bmc', serverId: srv.id },
      ...serverNicPorts(catalog, srv).map((p) => ({ kind: 'server-nic' as const, serverId: srv.id, vmnic: p.vmnic })),
    ];
    for (const port of ports) {
      const c = cableAt(state, port);
      const l = c ? linkById.get(c.id) : undefined;
      const ls = c ? linkStatus(state, catalog, c) : undefined;
      uplinks.push({
        serverId: srv.id,
        port,
        label: port.kind === 'server-bmc' ? srv.bmc.label : `vmnic${port.vmnic}`,
        ...(c ? { cableId: c.id } : {}),
        linkUp: ls?.up === true,
        ...(ls?.speedGbE !== undefined ? { speedGbE: ls.speedGbE } : {}),
        loadGbpsByClass: l?.loadGbpsByClass ?? {},
        totalLoadGbps: l?.totalLoadGbps ?? 0,
        utilization: l?.utilization ?? 0,
        flowIds: l?.flowIds ?? [],
      });
    }
  }
  return { uplinks, links };
}

/** [GAME] OOB console reachable from an admin workstation (game rule helper, not VCF). */
export function bmcReachable(ctx: NetContext, serverId: string): boolean {
  return ctx.state.endpoints.some((e) => e.kind === 'admin-workstation' && pathBetween(ctx, { kind: 'endpoint', endpointId: e.id }, { kind: 'bmc', serverId }).reachable);
}

/** DCUI "Test Management Network": ping gateway, ping DNS servers, resolve hostname (25 §6.3 [U34]). */
export function testManagementNetwork(ctx: NetContext, serverId: string): { readonly gateway: boolean; readonly dns: Readonly<Record<string, boolean>> } {
  const node: NetNode = { kind: 'vmk', serverId, vmk: 'vmk0' };
  const A = attachPoints(ctx, node);
  const gateway = ctx.state.endpoints.some((g) => g.kind === 'gateway' && l2Path(ctx, A, attachPoints(ctx, { kind: 'endpoint', endpointId: g.id })).reachable);
  const dns: Record<string, boolean> = {};
  for (const d of ctx.state.endpoints.filter((e) => e.kind === 'dns')) dns[d.id] = pathBetween(ctx, node, { kind: 'endpoint', endpointId: d.id }).reachable;
  return { gateway, dns };
}

// ===========================================================================
// Physical network validation before bring-up (10 §3.3; 25 §3.5, §5.3, §5.4)
// ===========================================================================

export interface PhysicalBringupInput {
  readonly serverIds: readonly string[];
  readonly plan: PlannedHostNetworks;
  readonly storage: StorageType;
  /** VCF version (1 Gbit NIC fix in 9.1.1, 25 §5.3 [U15]). Default '9.1.1'. */
  readonly vcfVersion?: string;
}

const versionAtLeast = (v: string, min: string): boolean => {
  const a = v.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
};

const fqdnOf = (s: PhysicalServer): string => s.esx.network?.hostnameFqdn ?? s.id;

/** Host-facing switch ports of a server (cabled NIC ports). */
export function hostFacingPorts(state: PhysicalState, serverId: string): { readonly vmnic: number; readonly switchId: string; readonly port: number; readonly cableId: string }[] {
  const out: { vmnic: number; switchId: string; port: number; cableId: string }[] = [];
  for (const c of state.cables)
    for (const [mine, other] of [[c.a, c.b], [c.b, c.a]] as const)
      if (mine.kind === 'server-nic' && mine.serverId === serverId && other.kind === 'switch') out.push({ vmnic: mine.vmnic, switchId: other.switchId, port: other.port, cableId: c.id });
  return out.sort((a, b) => a.vmnic - b.vmnic);
}

// ===========================================================================
// Host-facing switch port requirements (10 §3.3 [P18][P19]) – shared by the bring-up validation and objectives
// ===========================================================================

/** Traffic types that use a host-facing switch port (VMkernel services, 10 §3.3 [P18]). */
export type HostPortTrafficType = 'management' | 'vmotion' | 'vsan' | 'nfs' | 'host-tep';

export interface HostPortTraffic {
  readonly type: HostPortTrafficType;
  /** 802.1Q VLAN of the traffic; null = untagged (no VLAN the trunk has to allow). */
  readonly vlanId: number | null;
  /** VMkernel MTU of the traffic. */
  readonly mtu: number;
}

export interface HostPortRequirements {
  /** Tagged VLANs of all given traffic types (sorted, unique) – what a trunk to the host has to carry (VCF-NET-RCMD-SWT-001). */
  readonly vlans: readonly number[];
  /** With a port config: tagged VLANs the port does NOT carry (model `carriesVlan`); without: []. */
  readonly missingVlans: readonly number[];
  /** Traffic types the MTU requirement is computed from (with a port config: only those the port carries). */
  readonly carried: readonly HostPortTrafficType[];
  /** The port carries Host TEP traffic (VCF-NET-REQD-SWT-002 applies). */
  readonly tepCarried: boolean;
  /** Largest MTU of the carried traffic types (0 = none). */
  readonly maxTrafficMtu: number;
  /**
   * Required port MTU: largest MTU of all carried traffic types, minimum 1500 (VCF-NET-REQD-SWT-003); a port carrying
   * Host TEP minimum 1700 (VCF-NET-REQD-SWT-002; footnote: "1600 is the minimum required MTU, however 1700 is
   * recommended") – 10 §3.3 [P19].
   */
  readonly requiredMtu: number;
  /** Recommended port MTU: ≥ 9000 (VCF-NET-RCMD-SWT-004, 10 §3.3 [P19]) and never below `requiredMtu`. */
  readonly recommendedMtu: number;
}

/**
 * Required MTU and VLAN set of a host-facing switch port for the traffic types it carries (10 §3.3 [P19]).
 * With `port`, traffic whose VLAN the port does not carry is left out of the MTU requirement (untagged traffic counts
 * as carried) and reported in `missingVlans`. Single source for validatePhysicalNetworkForBringup and the Sandbox
 * objectives (switchMtuForTraffic / switchPortsTrunkVlans).
 */
export function hostPortRequirements(traffic: readonly HostPortTraffic[], port?: SwitchPortConfig): HostPortRequirements {
  const vlans = [...new Set(traffic.flatMap((t) => (t.vlanId === null ? [] : [t.vlanId])))].sort((a, b) => a - b);
  const carriedTraffic = port ? traffic.filter((t) => t.vlanId === null || carriesVlan(port, t.vlanId)) : traffic;
  const tepCarried = carriedTraffic.some((t) => t.type === 'host-tep');
  const maxTrafficMtu = Math.max(0, ...carriedTraffic.map((t) => t.mtu));
  const requiredMtu = Math.max(MTU_LIMITS.minHostPort, maxTrafficMtu, tepCarried ? MTU_LIMITS.tepMinSwitchPort : 0);
  return {
    vlans,
    missingVlans: port ? vlans.filter((v) => !carriesVlan(port, v)) : [],
    carried: [...new Set(carriedTraffic.map((t) => t.type))],
    tepCarried,
    maxTrafficMtu,
    requiredMtu,
    recommendedMtu: Math.max(requiredMtu, MTU_LIMITS.recommended),
  };
}

/**
 * Traffic on the host-facing ports of a host, from the wizard's planned host networks (20 §4.2 step 11):
 * ESX management (MTU 1500 default, 10 §3.3 [P18]), vMotion, vSAN or NFS (none for VMFS on FC) and Host TEP.
 * `mgmtVlanId`: the host's own management VLAN (DCUI) – a number, null = untagged; undefined = the plan's
 * ESX management VLAN (or no management traffic without a plan).
 */
export function plannedHostPortTraffic(plan: PlannedHostNetworks | undefined, storage: StorageType, mgmtVlanId?: number | null): HostPortTraffic[] {
  const out: HostPortTraffic[] = [];
  const mgmt = mgmtVlanId !== undefined ? mgmtVlanId : plan?.esxManagement.vlanId;
  if (mgmt !== undefined) out.push({ type: 'management', vlanId: mgmt, mtu: MTU_LIMITS.minHostPort });
  if (!plan) return out;
  out.push({ type: 'vmotion', vlanId: plan.vmotion.vlanId, mtu: plan.vmotion.mtu });
  if (plan.storage && storage !== 'vmfs-fc') out.push({ type: storage === 'nfs-v3' ? 'nfs' : 'vsan', vlanId: plan.storage.vlanId, mtu: plan.storage.mtu });
  if (plan.nsxHostOverlay) out.push({ type: 'host-tep', vlanId: plan.nsxHostOverlay.vlanId, mtu: plan.nsxHostOverlay.mtu });
  return out;
}

/**
 * Validations of the physical network for the hosts of a bring-up. Messages quote the documentation where the
 * spec has the text (25 §5.3 / §5.4); otherwise they are descriptive.
 */
export function validatePhysicalNetworkForBringup(ctx: NetContext, input: PhysicalBringupInput): ValidationIssue[] {
  const { state, catalog } = ctx;
  const out: ValidationIssue[] = [];
  const version = input.vcfVersion ?? '9.1.1';
  const servers = input.serverIds.map((id) => byId(state.servers, id)).filter((s): s is PhysicalServer => s !== undefined);
  const plan = input.plan;
  const tepVlan = plan.nsxHostOverlay?.vlanId;
  const traffic = plannedHostPortTraffic(plan, input.storage);

  for (const srv of servers) {
    const fqdn = fqdnOf(srv);
    const ports = hostFacingPorts(state, srv.id);
    // VCF-NET-REQD-TOR-001 / RCMD-TOR-001 (10 §3.3 [P19]).
    if (ports.length === 0) {
      out.push(issue('PHYS_HOST_NOT_CONNECTED', 'error', `Host ${fqdn} is not connected to any switch (each host must be connected to at least one switch, VCF-NET-REQD-TOR-001).`, '10 §3.3 [P19]', srv.id));
      continue;
    }
    if (new Set(ports.map((p) => p.switchId)).size < 2)
      out.push(issue('PHYS_SINGLE_TOR', 'recommendation', `Host ${fqdn} is connected to a single switch; two or more ToR switches are recommended (VCF-NET-RCMD-TOR-001).`, '10 §3.3 [P19]', srv.id));
    for (const p of ports) {
      const cable = byId(state.cables, p.cableId);
      const ls = cable ? linkStatus(state, catalog, cable) : undefined;
      if (!ls?.up)
        out.push(issue('PHYS_LINK_DOWN', 'error', `Host ${fqdn} vmnic${p.vmnic} -> ${p.switchId}/p${p.port + 1}: no common link speed, link is down.`, 'game: generic switch; 15 §7', srv.id, 'game-scope'));
      const cfg = portCfg(ctx, p.switchId, p.port);
      if (!cfg) continue;
      if (cfg.lagGroup !== undefined)
        out.push(issue('PHYS_HOST_PORT_IN_LAG', 'error', `${p.switchId}/p${p.port + 1} (host ${fqdn}) is in LAG ${cfg.lagGroup}: each host–fabric connection must be a separate uplink, not a LAG (VCF-NET-REQD-LAG-001).`, '10 §3.3 [P19]', srv.id));
      if (cfg.mode !== 'trunk')
        out.push(issue('PHYS_PORT_NOT_TRUNK', 'recommendation', `${p.switchId}/p${p.port + 1} (host ${fqdn}) is an access port; switch ports to hosts in trunk mode with 802.1Q are recommended (VCF-NET-RCMD-SWT-001).`, '10 §3.3 [P19]; 25 §3.5 [U55]', srv.id));
      const req = hostPortRequirements(traffic, cfg);
      if (cfg.mtu < MTU_LIMITS.minHostPort)
        out.push(issue('PHYS_PORT_MTU_BELOW_1500', 'error', `${p.switchId}/p${p.port + 1} MTU ${cfg.mtu} < 1500 (host ports: largest MTU of all traffic types, minimum 1500, VCF-NET-REQD-SWT-003).`, '10 §3.3 [P19]', srv.id));
      if (req.tepCarried && cfg.mtu < MTU_LIMITS.tepMinSwitchPort)
        out.push(
          cfg.mtu < MTU_LIMITS.tepMinRequired
            ? issue('PHYS_TEP_PORT_MTU_BELOW_MIN', 'error', `${p.switchId}/p${p.port + 1} carries the Host TEP VLAN ${tepVlan} with MTU ${cfg.mtu}: ports for NSX TEP need minimum 1700 (VCF-NET-REQD-SWT-002; "1600 is the minimum required MTU").`, '10 §3.3 [P19]', srv.id)
            : issue('PHYS_TEP_PORT_MTU_BELOW_MIN', 'warning', `${p.switchId}/p${p.port + 1} carries the Host TEP VLAN ${tepVlan} with MTU ${cfg.mtu}: "1600 is the minimum required MTU, however 1700 is recommended to address future expansion" (VCF-NET-REQD-SWT-002 states minimum 1700).`, '10 §3.3 [P19]', srv.id),
        );
    }

    // vSwitch0 (25 §3.5, §5.3 [U36][U37][U38]).
    const hn = srv.hostNet;
    if (hn) {
      const vss = hn.switches.find((s) => s.name === 'vSwitch0' && s.kind === 'vss');
      if (!vss) out.push(issue('PHYS_VSWITCH0_MISSING', 'error', 'Host does not contain vSphere Standard Switch - vSwitch0', '25 §5.3 [U36]', srv.id));
      else {
        if (vss.uplinks.length !== 1)
          out.push(issue('PHYS_VSWITCH0_UPLINK_COUNT', 'error', `ESX Host ${fqdn} has ${vss.uplinks.length} Physical NICs connected to vSphere Standard Switch vSwitch0 (Expecting 1)`, '25 §5.3 [U37]', srv.id));
        const up = vss.uplinks[0];
        const p = up !== undefined ? ports.find((x) => x.vmnic === up) : undefined;
        const cable = p ? byId(state.cables, p.cableId) : undefined;
        const speed = cable ? linkStatus(state, catalog, cable).speedGbE : undefined;
        if (speed !== undefined && speed < 10 && !versionAtLeast(version, '9.1.1'))
          out.push(issue('PHYS_VSWITCH0_UPLINK_BELOW_10G', 'error', 'vSphere standard switch vSwitch0 must have only one NIC as Uplink. ("All physical NICs must have a minimum speed of 10 Gbps.")', '25 §5.3 [U38]; fixed in 9.1.1 [U15]', srv.id));
      }
    }
  }

  // Planned MTU (25 §5.4 [U49]; 10 §3.3 [P18] recommendations).
  if (plan.nsxHostOverlay && plan.nsxHostOverlay.mtu < MTU_LIMITS.tepMinRequired)
    out.push(issue('PHYS_HOST_OVERLAY_MTU_BELOW_1600', 'error', `The provided MTU for Distributed vSphere Switch which is going to be used for Host Overlay is ${plan.nsxHostOverlay.mtu}. Must be at least 1600`, '25 §5.4 [U49] (KB for VVF 9.1, 25 §8 OQ4)', 'nsxHostOverlay.mtu'));
  const rec: [string, { mtu: number } | undefined][] = [['vMotion', plan.vmotion], [input.storage === 'nfs-v3' ? 'NFS' : 'vSAN', input.storage === 'vmfs-fc' ? undefined : plan.storage], ['Host TEP', plan.nsxHostOverlay]];
  for (const [name, n] of rec)
    if (n && n.mtu < MTU_LIMITS.recommended)
      out.push(issue('PHYS_MTU_BELOW_RECOMMENDED', 'recommendation', `${name} VMkernel MTU ${n.mtu}: recommended MTU size is 9000 (VCF-NET-RCMD-SWT-004).`, '10 §3.3 [P18][P19]', name));

  // Host ↔ host vmkping on planned networks (25 §5.4 [U45][U46][U48]).
  const vsanStorage = input.storage === 'vsan-esa' || input.storage === 'vsan-osa';
  for (let i = 0; i < servers.length; i++)
    for (let j = i + 1; j < servers.length; j++) {
      const a = servers[i];
      const b = servers[j];
      if (!a || !b || hostFacingPorts(state, a.id).length === 0 || hostFacingPorts(state, b.id).length === 0) continue;
      const check = (net: { vlanId: number; mtu: number }) =>
        pathBetween(ctx, { kind: 'host-uplinks', serverId: a.id, tag: net.vlanId, mtu: net.mtu }, { kind: 'host-uplinks', serverId: b.id, tag: net.vlanId, mtu: net.mtu });
      const pair = `${fqdnOf(a)} <-> ${fqdnOf(b)}`;
      const vm = check(plan.vmotion);
      if (!vm.reachable)
        out.push(issue('PHYS_NETWORK_UNREACHABLE', 'error', `Failed to validate connectivity of VMOTION network (VLAN ${plan.vmotion.vlanId}, ${pair}).`, '25 §5.4 [U45][U47]', pair));
      else if ((vm.pathMtu ?? 0) < plan.vmotion.mtu)
        // [U46] verbatim for MTU 9000 (incl. the odd quote); the MTU number follows the plan.
        out.push(issue('PHYS_MTU_PATH_TOO_SMALL', 'error', `ESX host vmkping from VLAN ${plan.vmotion.vlanId} does not support MTU ${plan.vmotion.mtu} for network "VMOTION' (path MTU ${vm.pathMtu}, ${pair})`, '25 §5.4 [U46]', pair));
      if (vsanStorage && plan.storage) {
        const vs = check(plan.storage);
        if (!vs.reachable)
          out.push(issue('PHYS_VSAN_NO_CONNECTIVITY', 'warning', `ESX Hosts ${pair} with MTU ${plan.storage.mtu} fail to vmkping. Possible no network connection or not reachable.`, '25 §5.4 [U48]', pair));
        else if ((vs.pathMtu ?? 0) < plan.storage.mtu)
          out.push(issue('PHYS_MTU_PATH_TOO_SMALL', 'error', `vSAN Network Connectivity: vmkping with MTU ${plan.storage.mtu} fails on VLAN ${plan.storage.vlanId} (path MTU ${vs.pathMtu}, ${pair}); a smaller 1500 packet passes.`, '25 §5.4 [U45][U46]', pair));
      }
      if (plan.nsxHostOverlay) {
        const t = check(plan.nsxHostOverlay);
        if (!t.reachable)
          out.push(issue('PHYS_NETWORK_UNREACHABLE', 'error', `NSX Host Overlay (VLAN ${plan.nsxHostOverlay.vlanId}): hosts ${pair} cannot reach each other.`, '25 §5.4 [U46]; 10 §7 #5', pair));
        else if ((t.pathMtu ?? 0) < plan.nsxHostOverlay.mtu)
          out.push(issue('PHYS_MTU_PATH_TOO_SMALL', 'error', `ESX Host ${fqdnOf(a)} with MTU ${plan.nsxHostOverlay.mtu} fails vmkping. Ensure that ESX Host ${fqdnOf(b)} is responsive. (path MTU ${t.pathMtu})`, '25 §5.4 [U46]', pair));
      }
    }
  return out;
}

/**
 * OOB network check – GAME SCOPE ("switches utilized for out-of-band connectivity … are out of scope" [U55]).
 * Optional hint only; it is never part of validatePhysicalNetworkForBringup.
 */
export function validateOobNetwork(ctx: NetContext, serverIds: readonly string[]): ValidationIssue[] {
  return serverIds
    .filter((id) => byId(ctx.state.servers, id) && !bmcReachable(ctx, id))
    .map((id) => issue('PHYS_BMC_NOT_REACHABLE', 'recommendation', `${byId(ctx.state.servers, id)?.bmc.label ?? 'BMC'} of ${id} is not reachable from an admin workstation (out-of-band network).`, '25 §10 [U55] (OOB out of VCF scope – game rule)', id, 'game-scope'));
}

/**
 * FQDNs / IPs the VCF Installer endpoint cannot reach – input `BringupEnvironment.unreachableFromInstaller`
 * of bringup.validateReachability (20 §3.3 [S5][S6]). Hosts are identified by their DCUI FQDN, services by
 * their IPv4 and FQDN.
 */
export function unreachableFromInstaller(ctx: NetContext, installerEndpointId: string): string[] {
  const inst: NetNode = { kind: 'endpoint', endpointId: installerEndpointId };
  if (!byId(ctx.state.endpoints, installerEndpointId)) return [];
  const out: string[] = [];
  for (const s of ctx.state.servers) {
    if (!s.esx.network) continue;
    if (!pathBetween(ctx, inst, { kind: 'vmk', serverId: s.id, vmk: 'vmk0' }).reachable || !vmk0Static(s)) out.push(s.esx.network.hostnameFqdn);
  }
  for (const e of ctx.state.endpoints) {
    if ((e.kind !== 'dns' && e.kind !== 'ntp') || e.id === installerEndpointId) continue;
    if (!pathBetween(ctx, inst, { kind: 'endpoint', endpointId: e.id }).reachable) {
      if (e.ipv4) out.push(e.ipv4);
      if (e.fqdn) out.push(e.fqdn);
    }
  }
  return out;
}

/** Speed of the fastest NIC part (for summaries). */
export function serverNodeSpeed(catalog: HardwareCatalog, srv: PhysicalServer): number {
  const speeds = srv.config.nics.map((n) => catalog.nics.get(n.partId)).filter((p) => p !== undefined).map(nicMaxSpeed);
  return speeds.length ? Math.max(...speeds) : 0;
}
