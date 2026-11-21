/**
 * Rack awareness: physical cluster topology (racks, ToR, L2 / L3 between racks, AZ), vSAN fault domains, storage
 * policy vs. fault domains, the multi-rack checklist, L3 per-rack NSX / HA requirements, consistency of the design's
 * vSphere cluster model with the physical placement, and a rack failure simulation.
 *
 * Source of truth: docs/spec/50-vsan.md (references "50 §x [Vn]"), with 00-architektura §6 (cluster models) and
 * 05-design §4.4–4.5 (cluster / principal storage decisions).
 *
 * Provenance conventions (same as physical.ts):
 *  - documented rule -> severity per design.ts policy: error = REQD / documented "not supported" / documented error
 *    message; warning = documented recommendation the player may accept (50 §7a bod 2 says to show the vSAN
 *    planning recommendations as warnings, not blocks); recommendation = hint without an installer warning.
 *  - *(derived)* = the spec marks the rule as odvozené; the comment says so.
 *  - game-scope issues (model invariants, e.g. a host that is not mounted) carry `scope: 'game-scope'`.
 *
 * How the L2 / L3 nature of a multi-rack cluster is derived (game model, 50 §7a bod 1 + 7):
 *  - L2 = "The networks are stretched across racks using a single broadcast domain for each network." [V20]
 *  - L3 = "The networks are isolated to a rack using a separate broadcast domain for each network per rack." [V20];
 *    in L3 the ESX management VMK is "Rack Local" [V22].
 *  - The game tests the ESX management VMkernel (vmk0) of one representative host per rack against one host of every
 *    other rack with physical.pathBetween: reachable in one broadcast domain -> L2; reachable only through a gateway
 *    -> L3. In a stretched cluster only racks of the same AZ are compared (ESX management is AZ-local routed between
 *    AZs, sites.MULTI_AZ_NETWORK_SPAN).
 *
 * NOT modelled (open questions of 50 §8, see TODOs): VCF Installer and fault domains (OQ2), per-rack network pools at
 * commissioning (OQ3), RAID-5 3 vs 4 fault domains (OQ4 – table value used, alternative exposed), Auto-RAID together
 * with fault domains (OQ5), HA admission control / capacity reserve for a rack failure (OQ6 – never asserted),
 * L3 vSAN routing (OQ9), ToR per rack (OQ10 – only a hint), Multi-Rack vSAN Compute Cluster rules (VCF-VSAN-COMP-CLU-*).
 *
 * Pure TypeScript: no DOM, no PixiJS, no randomness, no time.
 */
import type { ClusterModel, VcfMinorVersion } from './architecture';
import type { HardwareCatalog } from './hardwareCatalog';
import { type IpPool, cidrContains, cidrInterval, cidrSize, formatIpv4, intervalsSize, parseCidr, parseIpv4, poolToIntervals } from './net';
import { type NetContext, type PhysicalState, hostFacingPorts, pathBetween } from './physical';
import { type AzRole, roomOfRack, sitesOf } from './sites';
import { type ValidationIssue, issue } from './validation';

// ===========================================================================
// Unlock actions and reasons
// ===========================================================================

/** What the player can do to remove a rack-awareness issue (data only; the UI formats it). */
export type RackUnlockAction =
  | { readonly kind: 'mount-hosts'; readonly hostIds: readonly string[] }
  | { readonly kind: 'cable-hosts'; readonly hostIds: readonly string[] }
  /** „přidej ToR do racku r02“ */
  | { readonly kind: 'add-tor-to-rack'; readonly rackId: string; readonly hostIds: readonly string[] }
  | { readonly kind: 'connect-racks'; readonly rackIds: readonly string[] }
  /** „rozmísti hosty do 3 racků“; `buyHosts` = hosts missing for one host per rack. */
  | { readonly kind: 'spread-hosts-across-racks'; readonly targetRacks: number; readonly currentRackIds: readonly string[]; readonly buyHosts: number }
  | { readonly kind: 'consolidate-into-rack'; readonly rackId: string; readonly hostIds: readonly string[] }
  | { readonly kind: 'balance-hosts-per-rack'; readonly rackIds: readonly string[]; readonly targetHostsPerRack: number }
  | { readonly kind: 'stretch-network-across-racks'; readonly network: 'esx-management'; readonly rackIds: readonly string[] }
  | { readonly kind: 'isolate-network-per-rack'; readonly network: 'esx-management'; readonly rackIds: readonly string[] }
  | { readonly kind: 'choose-cluster-model'; readonly models: readonly ClusterModel[] }
  | { readonly kind: 'create-fault-domains'; readonly rackIds: readonly string[] }
  | { readonly kind: 'add-fault-domains'; readonly count: number }
  | { readonly kind: 'deactivate-auto-policy-management' }
  | { readonly kind: 'disable-reserved-capacity' }
  | { readonly kind: 'assign-default-storage-policy' }
  | { readonly kind: 'create-uplink-profile'; readonly rackId: string }
  | { readonly kind: 'create-host-tep-pool'; readonly rackId: string }
  | { readonly kind: 'create-sub-tnp'; readonly rackId: string }
  | { readonly kind: 'set-ha-isolation-address'; readonly rackId: string; readonly address?: string };

export interface RackReason {
  readonly issue: ValidationIssue;
  readonly unlock?: RackUnlockAction;
  /** Second way out (e.g. change the design instead of moving hosts). */
  readonly alternative?: RackUnlockAction;
}

const reason = (i: ValidationIssue, unlock?: RackUnlockAction, alternative?: RackUnlockAction): RackReason => ({
  issue: i,
  ...(unlock ? { unlock } : {}),
  ...(alternative ? { alternative } : {}),
});

const plural = (n: number, one: string, few: string, many: string): string => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

/** Czech label of an unlock action (game UI text; numbers from the model). */
export function rackUnlockLabel(u: RackUnlockAction): string {
  switch (u.kind) {
    case 'mount-hosts':
      return `Zarackuj servery ${u.hostIds.join(', ')}`;
    case 'cable-hosts':
      return `Zapoj servery ${u.hostIds.join(', ')} do switche`;
    case 'add-tor-to-rack':
      return `Přidej ToR switch do racku ${u.rackId}`;
    case 'connect-racks':
      return `Propoj switche racků ${u.rackIds.join(', ')}`;
    case 'spread-hosts-across-racks':
      return `Rozmísti hosty do ${u.targetRacks} ${plural(u.targetRacks, 'racku', 'racků', 'racků')}${u.buyHosts > 0 ? ` (dokup ${u.buyHosts} ${plural(u.buyHosts, 'server', 'servery', 'serverů')})` : ''}`;
    case 'consolidate-into-rack':
      return `Přesuň hosty ${u.hostIds.join(', ')} do racku ${u.rackId}`;
    case 'balance-hosts-per-rack':
      return `Vyrovnej počet hostů v rackách (${u.targetHostsPerRack} na rack)`;
    case 'stretch-network-across-racks':
      return `Roztáhni VLAN ESX managementu přes racky ${u.rackIds.join(', ')} (L2)`;
    case 'isolate-network-per-rack':
      return `Odděl VLAN/subnet ESX managementu pro každý rack (L3)`;
    case 'choose-cluster-model':
      return `Zvol cluster model: ${u.models.join(', ')}`;
    case 'create-fault-domains':
      return `Vytvoř vSAN fault domain pro každý rack (${u.rackIds.join(', ')})`;
    case 'add-fault-domains':
      return `Přidej ${u.count} ${plural(u.count, 'fault domain', 'fault domains', 'fault domains')}`;
    case 'deactivate-auto-policy-management':
      return 'Vypni vSAN ESA Auto-policy Management';
    case 'disable-reserved-capacity':
      return 'Vypni vSAN Reserved Capacity';
    case 'assign-default-storage-policy':
      return 'Vytvoř a přiřaď vlastní default storage policy';
    case 'create-uplink-profile':
      return `Vytvoř NSX uplink profile pro rack ${u.rackId}`;
    case 'create-host-tep-pool':
      return `Vytvoř Host TEP IP pool pro rack ${u.rackId}`;
    case 'create-sub-tnp':
      return `Vytvoř NSX sub-TNP pro rack ${u.rackId}`;
    case 'set-ha-isolation-address':
      return `Nastav HA isolation address racku ${u.rackId}${u.address ? ` na ${u.address}` : ''}`;
  }
}

// ===========================================================================
// 1. Cluster topology derived from the physical room
// ===========================================================================

/**
 * Effective vSphere cluster model of the physical placement (50 §7a bod 1).
 * - 'none': no cluster host mounted yet,
 * - 'multi-rack-unknown': hosts in ≥ 2 racks, but the ESX management network is not configured yet, so L2 / L3
 *   cannot be told apart (game state, not a VCF model),
 * - 'inconsistent': see `inconsistencies`.
 */
export type EffectiveClusterModel = 'none' | 'single-rack' | 'multi-rack-l2' | 'multi-rack-l3' | 'multi-rack-unknown' | 'stretched' | 'inconsistent';

/** Physical span regardless of network consistency. */
export type RackSpan = 'none' | 'single-rack' | 'multi-rack' | 'multi-az';

export interface TopologyUplink {
  readonly vmnic: number;
  readonly switchId: string;
  /** Rack the switch is mounted in; undefined = switch not mounted. */
  readonly switchRackId?: string;
}

export interface TopologyHost {
  readonly hostId: string;
  readonly rackId?: string;
  readonly roomId?: string;
  readonly azRole?: AzRole;
  readonly uplinks: readonly TopologyUplink[];
  /** Distinct switches the host's NICs are cabled to. */
  readonly switchIds: readonly string[];
  /** CPU cores (sockets × cores per socket) and RAM from the server configuration. */
  readonly cores: number;
  readonly ramGB: number;
  readonly esxInstalled: boolean;
  /** ESX management (vmk0 / DCUI): VLAN (null = untagged), subnet "a.b.c.d/p", default gateway. */
  readonly mgmt: { readonly vlanId: number | null; readonly subnet?: string; readonly gateway?: string };
}

export interface TopologyRack {
  readonly rackId: string;
  readonly roomId?: string;
  readonly azRole?: AzRole;
  readonly hostIds: readonly string[];
  /** Switches mounted in this rack that hosts of this rack are cabled to (ToR). */
  readonly torSwitchIds: readonly string[];
  /** Switches outside this rack (other rack / not mounted) that hosts of this rack are cabled to. */
  readonly remoteSwitchIds: readonly string[];
  readonly mgmtVlans: readonly (number | null)[];
  readonly mgmtSubnets: readonly string[];
}

/** Result of the ESX management test between two racks. */
export type RackPairScope = 'l2' | 'l3' | 'disconnected' | 'unknown';

export interface RackPairLink {
  readonly rackA: string;
  readonly rackB: string;
  readonly scope: RackPairScope;
  readonly hostA?: string;
  readonly hostB?: string;
  /** Gateway endpoint of the routed path (L3). */
  readonly routedVia?: string;
}

export type NetworkScope = 'n/a' | 'l2' | 'l3' | 'mixed' | 'unknown';

export type TopologyInconsistencyKind =
  | 'host-not-found'
  | 'host-not-mounted'
  | 'racks-not-connected'
  | 'mixed-l2-l3'
  | 'l2-subnet-mismatch'
  | 'l3-same-subnet'
  | 'host-outside-az'
  | 'l3-stretched';

export interface TopologyInconsistency {
  readonly kind: TopologyInconsistencyKind;
  readonly message: string;
  readonly hostIds?: readonly string[];
  readonly rackIds?: readonly string[];
}

export interface ClusterTopology {
  readonly clusterHostIds: readonly string[];
  /** Hosts that exist in the room (mounted or not). */
  readonly hosts: readonly TopologyHost[];
  /** Racks with at least one cluster host, in the order of `PhysicalState.racks`. */
  readonly racks: readonly TopologyRack[];
  readonly missingHostIds: readonly string[];
  readonly unmountedHostIds: readonly string[];
  readonly pairs: readonly RackPairLink[];
  readonly networkScope: NetworkScope;
  /** AZ roles of the rooms that hold cluster hosts (undefined = room without role). */
  readonly azRoles: readonly (AzRole | undefined)[];
  readonly span: RackSpan;
  readonly model: EffectiveClusterModel;
  readonly inconsistencies: readonly TopologyInconsistency[];
}

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

function maskPrefix(mask: string): number | undefined {
  const n = parseIpv4(mask);
  if (n === undefined) return undefined;
  let p = 0;
  let zero = false;
  for (let b = 31; b >= 0; b--) {
    const bit = Math.floor(n / 2 ** b) % 2;
    if (bit === 1) {
      if (zero) return undefined;
      p++;
    } else zero = true;
  }
  return p;
}

function subnetOf(ip: string, mask: string): string | undefined {
  const p = maskPrefix(mask);
  const c = p === undefined ? undefined : parseCidr(`${ip}/${p}`);
  return c ? `${formatIpv4(c.network)}/${c.prefix}` : undefined;
}

function hostOf(physical: PhysicalState, id: string): TopologyHost | undefined {
  const srv = physical.servers.find((s) => s.id === id);
  if (!srv) return undefined;
  const sites = sitesOf(physical);
  const rackId = srv.mount && physical.racks.some((r) => r.id === srv.mount?.rackId) ? srv.mount.rackId : undefined;
  const roomId = rackId !== undefined ? roomOfRack(physical, rackId) : undefined;
  const azRole = roomId !== undefined ? sites.azAssignment[roomId] : undefined;
  const uplinks = hostFacingPorts(physical, id).map((p): TopologyUplink => {
    const swRack = physical.switches.find((s) => s.id === p.switchId)?.mount?.rackId;
    return { vmnic: p.vmnic, switchId: p.switchId, ...(swRack !== undefined ? { switchRackId: swRack } : {}) };
  });
  const net = srv.esx.network;
  const vmk0 = srv.hostNet?.vmks.find((v) => v.name === 'vmk0');
  const subnet = net ? subnetOf(net.ipv4Address, net.subnetMask) : undefined;
  return {
    hostId: id,
    ...(rackId !== undefined ? { rackId } : {}),
    ...(roomId !== undefined ? { roomId } : {}),
    ...(azRole !== undefined ? { azRole } : {}),
    uplinks,
    switchIds: uniq(uplinks.map((u) => u.switchId)),
    cores: srv.config.sockets * srv.config.coresPerSocket,
    ramGB: srv.config.ramGB,
    esxInstalled: srv.hostNet !== undefined,
    mgmt: {
      vlanId: vmk0?.tag ?? net?.vlanId ?? null,
      ...(subnet !== undefined ? { subnet } : {}),
      ...(net && net.defaultGateway !== '' ? { gateway: net.defaultGateway } : {}),
    },
  };
}

/**
 * Derives the cluster topology from where the hosts are physically mounted and cabled (50 §7a bod 1, 7).
 * `catalog` is needed for link status / NIC numbering (physical.pathBetween).
 */
export function deriveClusterTopology(physical: PhysicalState, clusterHostIds: readonly string[], catalog: HardwareCatalog): ClusterTopology {
  const ctx: NetContext = { state: physical, catalog };
  const ids = uniq(clusterHostIds);
  const hosts: TopologyHost[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const h = hostOf(physical, id);
    if (h) hosts.push(h);
    else missing.push(id);
  }
  const unmounted = hosts.filter((h) => h.rackId === undefined).map((h) => h.hostId);
  const mounted = hosts.filter((h) => h.rackId !== undefined);

  const racks: TopologyRack[] = physical.racks
    .filter((r) => mounted.some((h) => h.rackId === r.id))
    .map((r) => {
      const rh = mounted.filter((h) => h.rackId === r.id);
      const sw = uniq(rh.flatMap((h) => h.uplinks));
      const first = rh[0];
      return {
        rackId: r.id,
        ...(first?.roomId !== undefined ? { roomId: first.roomId } : {}),
        ...(first?.azRole !== undefined ? { azRole: first.azRole } : {}),
        hostIds: rh.map((h) => h.hostId),
        torSwitchIds: uniq(sw.filter((u) => u.switchRackId === r.id).map((u) => u.switchId)),
        remoteSwitchIds: uniq(sw.filter((u) => u.switchRackId !== r.id).map((u) => u.switchId)),
        mgmtVlans: uniq(rh.filter((h) => h.esxInstalled).map((h) => h.mgmt.vlanId)),
        mgmtSubnets: uniq(rh.flatMap((h) => (h.mgmt.subnet !== undefined ? [h.mgmt.subnet] : []))),
      };
    });

  const azRoles = uniq(mounted.map((h) => h.azRole));
  const stretched = azRoles.includes('az1') && azRoles.includes('az2');
  const inconsistencies: TopologyInconsistency[] = [];
  if (missing.length) inconsistencies.push({ kind: 'host-not-found', message: `Hosts ${missing.join(', ')} do not exist in the server room.`, hostIds: missing });
  if (unmounted.length) inconsistencies.push({ kind: 'host-not-mounted', message: `Hosts ${unmounted.join(', ')} are not mounted in a rack; their physical location (fault domain) is unknown.`, hostIds: unmounted });

  // --- L2 / L3 between racks (ESX management vmk0, see header) -------------------------------------------------
  const rep = (r: TopologyRack): TopologyHost | undefined => mounted.find((h) => h.rackId === r.rackId && h.esxInstalled && h.uplinks.length > 0);
  const groups: TopologyRack[][] = stretched ? (['az1', 'az2'] as const).map((role) => racks.filter((r) => r.azRole === role)) : [racks];
  const pairs: RackPairLink[] = [];
  for (const g of groups)
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) {
        const ra = g[i];
        const rb = g[j];
        if (!ra || !rb) continue;
        const a = rep(ra);
        const b = rep(rb);
        if (!a || !b) {
          pairs.push({ rackA: ra.rackId, rackB: rb.rackId, scope: 'unknown' });
          continue;
        }
        const p = pathBetween(ctx, { kind: 'vmk', serverId: a.hostId, vmk: 'vmk0' }, { kind: 'vmk', serverId: b.hostId, vmk: 'vmk0' });
        const configured = a.mgmt.subnet !== undefined && b.mgmt.subnet !== undefined;
        const scope: RackPairScope = p.reachable ? (p.routedVia !== undefined ? 'l3' : 'l2') : configured ? 'disconnected' : 'unknown';
        pairs.push({ rackA: ra.rackId, rackB: rb.rackId, scope, hostA: a.hostId, hostB: b.hostId, ...(p.routedVia !== undefined ? { routedVia: p.routedVia } : {}) });
        // [V20]: L2 = single broadcast domain for each network (one subnet); L3 = separate broadcast domain per rack.
        if (scope === 'l2' && configured && a.mgmt.subnet !== b.mgmt.subnet)
          inconsistencies.push({ kind: 'l2-subnet-mismatch', message: `Racks ${ra.rackId} and ${rb.rackId} share the ESX management broadcast domain but use different subnets (${a.mgmt.subnet} / ${b.mgmt.subnet}).`, rackIds: [ra.rackId, rb.rackId] });
        if (scope === 'l3' && a.mgmt.subnet === b.mgmt.subnet)
          inconsistencies.push({ kind: 'l3-same-subnet', message: `Racks ${ra.rackId} and ${rb.rackId} are routed but use the same ESX management subnet ${a.mgmt.subnet ?? ''}.`, rackIds: [ra.rackId, rb.rackId] });
        if (scope === 'disconnected')
          inconsistencies.push({ kind: 'racks-not-connected', message: `ESX management of ${a.hostId} (rack ${ra.rackId}) cannot reach ${b.hostId} (rack ${rb.rackId}) – neither in one VLAN nor through a gateway.`, rackIds: [ra.rackId, rb.rackId], hostIds: [a.hostId, b.hostId] });
      }
  const scopes = new Set(pairs.map((p) => p.scope));
  const networkScope: NetworkScope = pairs.length === 0 ? 'n/a' : scopes.has('l2') && scopes.has('l3') ? 'mixed' : scopes.has('l3') ? 'l3' : scopes.has('l2') ? 'l2' : 'unknown';
  if (networkScope === 'mixed')
    inconsistencies.push({ kind: 'mixed-l2-l3', message: 'Some racks share the ESX management network (L2) and others are routed (L3); the cluster is neither Multi-Rack Layer 2 nor Layer 3.', rackIds: racks.map((r) => r.rackId) });

  if (stretched) {
    const outside = mounted.filter((h) => h.azRole !== 'az1' && h.azRole !== 'az2').map((h) => h.hostId);
    if (outside.length) inconsistencies.push({ kind: 'host-outside-az', message: `Hosts ${outside.join(', ')} are in a room that is neither AZ1 nor AZ2 while the other hosts span both AZs.`, hostIds: outside });
    // 50 §2 [V6]: "Layer 3 multi-rack vSphere clusters cannot be stretched."
    if (networkScope === 'l3') inconsistencies.push({ kind: 'l3-stretched', message: 'Layer 3 multi-rack vSphere clusters cannot be stretched.', rackIds: racks.map((r) => r.rackId) });
  }

  const span: RackSpan = mounted.length === 0 ? 'none' : stretched ? 'multi-az' : racks.length === 1 ? 'single-rack' : 'multi-rack';
  const model: EffectiveClusterModel = inconsistencies.length
    ? 'inconsistent'
    : span === 'none' ? 'none'
    : span === 'multi-az' ? 'stretched'
    : span === 'single-rack' ? 'single-rack'
    : networkScope === 'l2' ? 'multi-rack-l2'
    : networkScope === 'l3' ? 'multi-rack-l3'
    : 'multi-rack-unknown';

  return { clusterHostIds: ids, hosts, racks, missingHostIds: missing, unmountedHostIds: unmounted, pairs, networkScope, azRoles, span, model, inconsistencies };
}

/** Topology problems as validation issues (with unlock actions). */
export function topologyIssues(topo: ClusterTopology): RackReason[] {
  const out: RackReason[] = [];
  const l3 = topo.model === 'multi-rack-l3';
  for (const inc of topo.inconsistencies) {
    switch (inc.kind) {
      case 'host-not-found':
        out.push(reason(issue('PHYS_DEVICE_INVALID', 'error', inc.message, 'game: room', inc.hostIds?.join(','), 'game-scope')));
        break;
      case 'host-not-mounted':
        out.push(reason(issue('RACK_HOST_NOT_MOUNTED', 'error', inc.message, '50 §7a bod 1 [V8][V9] (game: placement)', inc.hostIds?.join(','), 'game-scope'), { kind: 'mount-hosts', hostIds: inc.hostIds ?? [] }));
        break;
      case 'racks-not-connected':
        // Hosts of one cluster must reach each other on the management network (25 §5.4 connectivity validations).
        out.push(reason(issue('RACK_NETWORK_DISCONNECTED', 'error', inc.message, '50 §3.3 [V20][V22]; 25 §5.4', inc.rackIds?.join(',')), { kind: 'connect-racks', rackIds: inc.rackIds ?? [] }));
        break;
      case 'mixed-l2-l3':
      case 'l2-subnet-mismatch':
      case 'l3-same-subnet':
        out.push(reason(issue('RACK_NETWORK_INCONSISTENT', 'warning', `${inc.message} L2: "single broadcast domain for each network"; L3: "separate broadcast domain for each network per rack".`, '50 §7.1 [V20][V22]', inc.rackIds?.join(','))));
        break;
      case 'host-outside-az':
        out.push(reason(issue('RACK_HOST_OUTSIDE_AZ', 'warning', inc.message, '50 §2 [V6]; 00 §6 [S7]', inc.hostIds?.join(','))));
        break;
      case 'l3-stretched':
        out.push(reason(issue('RACK_L3_CANNOT_STRETCH', 'error', 'Layer 3 multi-rack vSphere clusters cannot be stretched.', '50 §2, §5 [V6]', inc.rackIds?.join(',')), { kind: 'stretch-network-across-racks', network: 'esx-management', rackIds: inc.rackIds ?? [] }));
        break;
    }
  }
  for (const h of topo.hosts) {
    if (h.rackId === undefined) continue;
    // VCF-NET-REQD-TOR-001 / VCF-NET-RCMD-TOR-001 (50 §3.3 [V23]).
    if (h.switchIds.length === 0)
      out.push(reason(issue('PHYS_HOST_NOT_CONNECTED', 'error', `Host ${h.hostId} is not connected to any switch ("Each ESX host must be connected to at least one network switch for IP connectivity.", VCF-NET-REQD-TOR-001).`, '50 §3.3 [V23]', h.hostId), { kind: 'cable-hosts', hostIds: [h.hostId] }));
    else if (h.switchIds.length === 1)
      out.push(reason(issue('PHYS_SINGLE_TOR', 'recommendation', `Host ${h.hostId} is connected to a single switch; "Connect each ESX host to two (2) or more top of rack switches." (VCF-NET-RCMD-TOR-001).`, '50 §3.3 [V23]', h.hostId), { kind: 'add-tor-to-rack', rackId: h.rackId, hostIds: [h.hostId] }));
  }
  // OQ10: the documentation has no explicit "ToR per rack" requirement; in L3 the gateway / VLANs live "at the ToR
  // switches … in the rack" [V1][V9] -> warning in L3, hint otherwise.
  for (const r of topo.racks)
    if (r.torSwitchIds.length === 0 && r.remoteSwitchIds.length > 0)
      out.push(reason(
        l3
          ? issue('RACK_NO_TOR', 'warning', `Rack ${r.rackId} has no own ToR switch; its hosts are cabled to switches of other racks (${r.remoteSwitchIds.join(', ')}). In Multi-Rack Layer 3 the VLANs are local to the ToR and the gateway sits on the ToR switches of the rack.`, '50 §3.3, §7.1 [V1][V9]; §8 OQ10', r.rackId)
          : issue('RACK_NO_TOR', 'recommendation', `Rack ${r.rackId} has no own ToR switch; its hosts are cabled to switches of other racks (${r.remoteSwitchIds.join(', ')}). The documentation has no explicit per-rack ToR requirement (open question).`, '50 §3.3 [V23]; §8 OQ10', r.rackId),
        { kind: 'add-tor-to-rack', rackId: r.rackId, hostIds: r.hostIds },
      ));
  return out;
}

// ===========================================================================
// 2. vSAN fault domains
// ===========================================================================

/** vSAN fault domain as configured in vCenter (50 §4.2 step 4, §4.4). `rackId` = the rack the player meant it for. */
export interface FaultDomain {
  readonly name: string;
  readonly rackId?: string;
  readonly hostIds: readonly string[];
}

export interface EffectiveFaultDomain {
  readonly name: string;
  readonly hostIds: readonly string[];
  readonly rackIds: readonly string[];
  /** Host without a configured FD: "vSAN interprets it as a stand-alone fault domain." [V12] */
  readonly standalone: boolean;
  /** At least one host available (not disconnected / partitioned / in maintenance mode, 50 §5 [V33]). */
  readonly usable: boolean;
}

/**
 * Configured FDs (non-empty, cluster hosts only) plus one stand-alone FD per host without an FD (50 §2 [V12]).
 * `unavailableHostIds` = hosts that do not count ([V33]: disconnected, partitioned, maintenance mode…).
 */
export function effectiveFaultDomains(
  clusterHostIds: readonly string[],
  faultDomains: readonly FaultDomain[],
  topo?: ClusterTopology,
  unavailableHostIds: readonly string[] = [],
): EffectiveFaultDomain[] {
  const rackOf = (id: string): string | undefined => topo?.hosts.find((h) => h.hostId === id)?.rackId;
  const racksOf = (hs: readonly string[]): string[] => uniq(hs.map(rackOf).filter((r): r is string => r !== undefined));
  const usable = (hs: readonly string[]): boolean => hs.some((h) => !unavailableHostIds.includes(h));
  const assigned = new Set<string>();
  const out: EffectiveFaultDomain[] = [];
  for (const fd of faultDomains) {
    const hs = uniq(fd.hostIds.filter((h) => clusterHostIds.includes(h) && !assigned.has(h)));
    hs.forEach((h) => assigned.add(h));
    if (hs.length) out.push({ name: fd.name, hostIds: hs, rackIds: racksOf(hs), standalone: false, usable: usable(hs) });
  }
  for (const h of uniq(clusterHostIds)) if (!assigned.has(h)) out.push({ name: h, hostIds: [h], rackIds: racksOf([h]), standalone: true, usable: usable([h]) });
  return out;
}

export interface FaultDomainValidationOptions {
  /** Multi-rack vSAN: one FD per rack is required (VCF-VSAN-L3MR-REQD-CFG-003). */
  readonly requireRackFaultDomains?: boolean;
  /** Hosts that are not online (50 §5: "Verify that your vSAN hosts are online."). */
  readonly offlineHostIds?: readonly string[];
}

/**
 * Validates the configured fault domains (50 §4.4, §5, §3.1):
 * - empty FD: "A fault domain cannot be empty. You must select at least one host to include in the fault domain." [V14]
 * - duplicate name: "vSAN does not support duplicate fault domain names in a cluster." [V14]
 * - host offline (paraphrase of the prerequisite "Verify that your vSAN hosts are online.") [V14]
 * - [game-scope] host outside the cluster / in several FDs (data invariant; vSphere moves a host between FDs, [V31b])
 * - with `requireRackFaultDomains`: VCF-VSAN-L3MR-REQD-CFG-003 "Configure vSAN fault domains and place the nodes of
 *   each rack in their fault domain." [V1]; racks with one host need no FD ("with more than one ESX node per rack
 *   create a vSAN fault domain" [V29]).
 */
export function validateFaultDomains(faultDomains: readonly FaultDomain[], topo: ClusterTopology, opts: FaultDomainValidationOptions = {}): RackReason[] {
  const out: RackReason[] = [];
  const cluster = topo.clusterHostIds;
  const seenNames = new Set<string>();
  const seenHosts = new Set<string>();
  for (const fd of faultDomains) {
    if (fd.hostIds.length === 0)
      out.push(reason(issue('VSAN_FD_EMPTY', 'error', 'A fault domain cannot be empty. You must select at least one host to include in the fault domain.', '50 §5 [V14]', fd.name)));
    if (seenNames.has(fd.name))
      out.push(reason(issue('VSAN_FD_DUPLICATE_NAME', 'error', 'vSAN does not support duplicate fault domain names in a cluster.', '50 §5 [V14]', fd.name)));
    seenNames.add(fd.name);
    for (const h of fd.hostIds) {
      if (!cluster.includes(h))
        out.push(reason(issue('VSAN_FD_HOST_INVALID', 'error', `Fault domain ${fd.name}: host ${h} is not a member of the cluster.`, 'game: fault domain data', h, 'game-scope')));
      else if (seenHosts.has(h))
        out.push(reason(issue('VSAN_FD_HOST_INVALID', 'error', `Host ${h} is in more than one fault domain (a host is moved between fault domains, [V31b]).`, '50 §4.4 [V31b] (game: data invariant)', h, 'game-scope')));
      seenHosts.add(h);
      if (opts.offlineHostIds?.includes(h))
        out.push(reason(issue('VSAN_FD_HOST_OFFLINE', 'error', `Host ${h} cannot be added to fault domain ${fd.name}: "Verify that your vSAN hosts are online." (paraphrase of the prerequisite).`, '50 §5 [V14]', h)));
    }
  }
  if (!opts.requireRackFaultDomains) return out;

  const rackOf = (id: string): string | undefined => topo.hosts.find((h) => h.hostId === id)?.rackId;
  for (const fd of faultDomains) {
    const racks = uniq(fd.hostIds.map(rackOf).filter((r): r is string => r !== undefined));
    if (racks.length > 1 || (fd.rackId !== undefined && racks.some((r) => r !== fd.rackId)))
      out.push(reason(
        issue('VSAN_FD_NOT_PER_RACK', 'error', `Fault domain ${fd.name} contains hosts of racks ${racks.join(', ')}; "Configure vSAN fault domains and place the nodes of each rack in their fault domain." (VCF-VSAN-L3MR-REQD-CFG-003).`, '50 §3.1 [V1]', fd.name),
        { kind: 'create-fault-domains', rackIds: racks },
      ));
  }
  const eff = effectiveFaultDomains(cluster, faultDomains, topo);
  for (const r of topo.racks) {
    if (r.hostIds.length < 2) continue;
    const fds = eff.filter((f) => f.hostIds.some((h) => r.hostIds.includes(h)));
    if (fds.every((f) => f.standalone))
      out.push(reason(
        issue('VSAN_FD_NOT_CONFIGURED', 'error', `Rack ${r.rackId} has ${r.hostIds.length} hosts without a fault domain; each host is a stand-alone fault domain and vSAN "might store both replicas of an object with hosts in the same rack enclosure". "For vSAN multi-rack clusters with more than one ESX node per rack create a vSAN fault domain" (VCF-VSAN-L3MR-REQD-CFG-003).`, '50 §3.1, §4.2 krok 4, §7a bod 3 [V1][V12][V29]', r.rackId),
        { kind: 'create-fault-domains', rackIds: [r.rackId] },
      ));
    else if (fds.length > 1)
      out.push(reason(
        issue('VSAN_FD_NOT_PER_RACK', 'error', `Hosts of rack ${r.rackId} are split across ${fds.length} fault domains (${fds.map((f) => f.name).join(', ')}); "place the nodes of each rack in their fault domain" (VCF-VSAN-L3MR-REQD-CFG-003). Expansion: "add hosts manually to their respective fault domains."`, '50 §3.1, §4.5 [V1][V29]', r.rackId),
        { kind: 'create-fault-domains', rackIds: [r.rackId] },
      ));
  }
  return out;
}

// ===========================================================================
// Storage policy vs. fault domains (50 §6.1, §6.2)
// ===========================================================================

export type VsanRaidLayout = 'raid-0' | 'raid-1' | 'raid-5-2+1' | 'raid-5-4+1' | 'raid-6-4+2';
export type Ftt = 0 | 1 | 2 | 3;

export interface VsanStoragePolicy {
  readonly ftt: Ftt;
  readonly layout: VsanRaidLayout;
}

export interface EsaRaidRow {
  readonly ftt: Ftt;
  readonly layout: VsanRaidLayout;
  readonly overhead: number;
  readonly minHosts: number;
}

/** vSAN ESA 9.1, standard (not stretched) cluster, column "Min Hosts" (50 §6.2 [V18]). */
export const ESA_RAID_TABLE: readonly EsaRaidRow[] = [
  { ftt: 0, layout: 'raid-0', overhead: 1, minHosts: 1 },
  { ftt: 1, layout: 'raid-1', overhead: 2, minHosts: 3 },
  { ftt: 2, layout: 'raid-1', overhead: 3, minHosts: 5 },
  { ftt: 3, layout: 'raid-1', overhead: 4, minHosts: 7 },
  { ftt: 1, layout: 'raid-5-2+1', overhead: 1.5, minHosts: 3 },
  { ftt: 1, layout: 'raid-5-4+1', overhead: 1.25, minHosts: 6 },
  { ftt: 2, layout: 'raid-6-4+2', overhead: 1.5, minHosts: 6 },
];

export interface FaultDomainRequirement {
  /** Fault domains the model requires. */
  readonly required: number;
  /** "vSAN requires a minimum of 2*n+1 fault domains in the cluster." [V13][V16] */
  readonly formula2n1: number;
  /** ESA table "Min Hosts" [V18], applied to fault domains *(derived: every component in a different FD [V12])*. */
  readonly esaTableMinHosts: number;
  /** 50 §8 OQ4: RAID-5 – same page also says "four or more fault domains"; value shown as alternative only. */
  readonly openQuestionAlternative?: { readonly required: number; readonly note: string };
  readonly specRef: string;
}

const isErasureCoding = (l: VsanRaidLayout): boolean => l.startsWith('raid-5') || l.startsWith('raid-6');

/** Row of the ESA table for a policy, or undefined when the combination is not in the table. */
export const esaRaidRow = (p: VsanStoragePolicy): EsaRaidRow | undefined => ESA_RAID_TABLE.find((r) => r.ftt === p.ftt && r.layout === p.layout);

export function requiredFaultDomains(p: VsanStoragePolicy): FaultDomainRequirement {
  const formula2n1 = 2 * p.ftt + 1;
  const esaTableMinHosts = esaRaidRow(p)?.minHosts ?? formula2n1;
  return {
    required: Math.max(formula2n1, esaTableMinHosts),
    formula2n1,
    esaTableMinHosts,
    ...(p.layout.startsWith('raid-5')
      ? { openQuestionAlternative: { required: 4, note: '"You can configure RAID 5 on all-flash clusters with four or more fault domains." – conflicts with the ESA table (50 §8 OQ4).' } }
      : {}),
    specRef: '50 §6.1, §6.2 [V13][V16][V18]',
  };
}

/**
 * Policy vs. usable fault domains (50 §5, §6.1, §6.2):
 * - "RAID 5 or RAID 6 erasure coding does not support a Failures to tolerate value of 3." [V18]
 * - not enough FDs: "There are currently [X] usable fault domains. The operation requires [Y] more usable fault
 *   domain." [V33] (FTT=n -> 2n+1 FDs [V13]; ESA table minimum [V18]).
 */
export function validateStoragePolicy(policy: VsanStoragePolicy, usableFaultDomains: number, subject = 'storage-policy'): RackReason[] {
  if (isErasureCoding(policy.layout) && policy.ftt === 3)
    return [reason(issue('VSAN_POLICY_INVALID', 'error', 'RAID 5 or RAID 6 erasure coding does not support a Failures to tolerate value of 3.', '50 §6.2 [V18]', subject))];
  if (!esaRaidRow(policy))
    return [reason(issue('VSAN_POLICY_INVALID', 'error', `Failures to tolerate ${policy.ftt} with ${policy.layout} is not a vSAN ESA RAID configuration (ESA table: RAID-0 FTT0, RAID-1 FTT1–3, RAID-5 FTT1, RAID-6 FTT2).`, '50 §6.2 [V18]', subject))];
  const req = requiredFaultDomains(policy);
  if (usableFaultDomains >= req.required) return [];
  const more = req.required - usableFaultDomains;
  return [reason(
    issue('VSAN_POLICY_TOO_FEW_FAULT_DOMAINS', 'error', `There are currently ${usableFaultDomains} usable fault domains. The operation requires ${more} more usable fault domain.`, '50 §5, §6.1 [V13][V33]', subject),
    { kind: 'add-fault-domains', count: more },
  )];
}

export interface AutoRaidResult {
  /** Policy vSAN picks; undefined = not documented / not available. */
  readonly policy?: VsanStoragePolicy;
  readonly mechanism: 'auto-raid-9.1' | 'auto-policy-management-9.0' | 'none';
  readonly note: string;
  readonly specRef: string;
}

/** "In VCF 9.1, vSAN clusters use RAID-6 as the default RAID level." [V19] (with ≥ 6 hosts, see autoRaidPolicy). */
export const VSAN_91_DEFAULT_RAID: VsanRaidLayout = 'raid-6-4+2';

/**
 * ESA default RAID by host count (50 §6.2):
 * - [9.1] Auto-RAID: < 3 hosts FTT0 RAID-0; two-node FTT1 RAID-1; 3–5 FTT1 RAID-5 2+1; ≥ 6 FTT2 RAID-6 4+2 [V18][V16].
 * - [9.0] Auto-RAID cannot be used ("Auto-RAID nejde použít na clusterech VCF/ESX 9.0 a starších" [V18]); with auto-policy
 *   management a cluster needs 4 hosts for RAID-5 and 6 for RAID-6 [V17]. RAID-5 width: "If five or fewer … three
 *   components" -> 2+1 [V18]. Fewer than 4 hosts in 9.0: not in the spec -> undefined.
 * TODO(50 §8 OQ5): whether Auto-RAID applies together with fault domains is open; in multi-rack auto policy management
 * must be off (VCF-VSAN-L3MR-REQD-CFG-004).
 */
export function autoRaidPolicy(hostCount: number, version: VcfMinorVersion = '9.1', twoNodeCluster = false): AutoRaidResult {
  if (version === '9.0') {
    const ref = '50 §6.2 [V17][V18]';
    if (hostCount >= 6) return { policy: { ftt: 2, layout: 'raid-6-4+2' }, mechanism: 'auto-policy-management-9.0', note: '[9.0] auto-policy management: RAID-6 needs 6 hosts.', specRef: ref };
    if (hostCount >= 4) return { policy: { ftt: 1, layout: 'raid-5-2+1' }, mechanism: 'auto-policy-management-9.0', note: '[9.0] auto-policy management: RAID-5 needs 4 hosts.', specRef: ref };
    return { mechanism: 'none', note: '[9.0] Auto-RAID is not available on 9.0; the default for fewer than 4 hosts is not in the spec.', specRef: ref };
  }
  const ref = '50 §6.2 [V16][V18][V19]';
  if (twoNodeCluster && hostCount === 2) return { policy: { ftt: 1, layout: 'raid-1' }, mechanism: 'auto-raid-9.1', note: 'Two-node cluster: FTT=1, RAID-1.', specRef: ref };
  if (hostCount < 3) return { policy: { ftt: 0, layout: 'raid-0' }, mechanism: 'auto-raid-9.1', note: 'Fewer than 3 hosts: FTT=0, RAID-0.', specRef: ref };
  if (hostCount <= 5) return { policy: { ftt: 1, layout: 'raid-5-2+1' }, mechanism: 'auto-raid-9.1', note: '3–5 hosts: FTT=1, RAID-5 (2+1).', specRef: ref };
  return { policy: { ftt: 2, layout: 'raid-6-4+2' }, mechanism: 'auto-raid-9.1', note: '6+ hosts: FTT=2, RAID-6 (4+2) – "vSAN automatically configures RAID-6".', specRef: ref };
}

// ===========================================================================
// Multi-rack checklist (VCF-VSAN-L3MR-REQD-CFG-004 / 005, 50 §3.1, §4.2)
// ===========================================================================

/** vSAN cluster settings the multi-rack checklist looks at (state flags set by the player in the vSphere Client). */
export interface VsanClusterSettings {
  /** vSAN ESA Auto-policy Management (Configure > vSAN Services > vSAN ESA). */
  readonly autoPolicyManagement: boolean;
  /** Reserved Capacity (Operations Reserve + Host Rebuild Reserve). */
  readonly reservedCapacity: boolean;
  /** Default storage policy of the vSAN datastore (custom, assigned per 50 §4.2 step 3), if any. */
  readonly defaultPolicy?: VsanStoragePolicy;
  readonly customDefaultPolicyAssigned: boolean;
}

/**
 * Checklist for a cluster that uses vSAN fault domains (50 §3.1, §4.2, §7a bod 5).
 * - VCF-VSAN-L3MR-REQD-CFG-004 "Deactivate vSAN ESA auto policy management." – "not supported with vSAN fault domains".
 * - VCF-VSAN-L3MR-REQD-CFG-005 "Do not enable reserved Capacity in a vSAN HCI multi-rack cluster."
 * - Implication of CFG-004: "it maybe necessary create a default storage policy manually" -> recommendation [V26][V28].
 * - The default policy must fit the usable fault domains (validateStoragePolicy).
 */
export function validateMultiRackChecklist(settings: VsanClusterSettings, usableFaultDomains: number): RackReason[] {
  const out: RackReason[] = [];
  if (settings.autoPolicyManagement)
    out.push(reason(issue('VSAN_AUTO_POLICY_WITH_FAULT_DOMAINS', 'error', '"Deactivate vSAN ESA auto policy management." (VCF-VSAN-L3MR-REQD-CFG-004) – "This feature is not supported with vSAN fault domains." / "You cannot use auto policy management in a multi-rack cluster when using vSAN fault domains."', '50 §3.1, §4.2 krok 2, §5 [V1][V26][V27]', 'autoPolicyManagement'), { kind: 'deactivate-auto-policy-management' }));
  if (settings.reservedCapacity)
    out.push(reason(issue('VSAN_RESERVED_CAPACITY_WITH_FAULT_DOMAINS', 'error', '"Do not enable reserved Capacity in a vSAN HCI multi-rack cluster." (VCF-VSAN-L3MR-REQD-CFG-005) – not supported for "vSAN clusters using fault domains"; "This will require manually calculating vSAN slack space."', '50 §3.1, §5, §6.4 [V1]', 'reservedCapacity'), { kind: 'disable-reserved-capacity' }));
  if (!settings.autoPolicyManagement && !settings.customDefaultPolicyAssigned)
    out.push(reason(issue('VSAN_CUSTOM_DEFAULT_POLICY_MISSING', 'recommendation', '"To align with the number of vSAN fault domains, it maybe necessary create a default storage policy manually." – Create and Assign a New Default Storage Policy (Failures to tolerate per environment, ESA: RAID 5 or RAID 6).', '50 §3.1, §4.2 krok 3 [V1][V26][V28]', 'defaultPolicy'), { kind: 'assign-default-storage-policy' }));
  if (settings.defaultPolicy) out.push(...validateStoragePolicy(settings.defaultPolicy, usableFaultDomains, 'defaultPolicy'));
  return out;
}

// ===========================================================================
// L3 per-rack requirements (VCF-VNI-L3MR-REQD-CFG-001..003, VCF-VSAN-L3MR-REQD-CFG-001)
// ===========================================================================

export interface HostTepPool {
  readonly cidr: string;
  readonly gateway?: string;
  /** Pool range inside the subnet; undefined = whole subnet. */
  readonly range?: IpPool;
  /** Host TEP transport VLAN of the rack. */
  readonly vlanId?: number;
}

/** Per-rack configuration of a Multi-Rack Layer 3 cluster. */
export interface RackL3Config {
  readonly rackId: string;
  /** NSX uplink profile name (VCF-VNI-L3MR-REQD-CFG-001). */
  readonly uplinkProfile?: string;
  /** Host TEP IP pool (VCF-VNI-L3MR-REQD-CFG-002). */
  readonly hostTepPool?: HostTepPool;
  /** NSX host sub transport node profile (VCF-VNI-L3MR-REQD-CFG-003). */
  readonly subTransportNodeProfile?: string;
  /** vSAN gateway of the rack (VCF-VSAN-L3MR-REQD-CFG-001: highly available, answers ICMP – paraphrase). */
  readonly vsanGateway?: { readonly ip: string; readonly highlyAvailable: boolean; readonly respondsToIcmp: boolean };
  /** vSphere HA isolation address used by the hosts of the rack. */
  readonly haIsolationAddress?: string;
}

export interface L3ValidationOptions {
  /**
   * TEP addresses each host takes from the pool. NOT in the spec ([V32] only says "enough IP addresses for the hosts
   * you are adding") – game default 1.
   */
  readonly tepIpsPerHost?: number;
}

function poolCapacity(p: HostTepPool): number | undefined {
  const c = parseCidr(p.cidr);
  if (!c) return undefined;
  if (p.range) {
    const iv = poolToIntervals(p.range);
    return iv ? intervalsSize(iv) : undefined;
  }
  // whole subnet minus network, broadcast and the gateway (generic IPv4, not a VCF fact)
  return Math.max(0, cidrSize(c) - (c.prefix >= 31 ? 0 : 2) - (p.gateway ? 1 : 0));
}

/**
 * Per-rack L3 requirements (50 §3.3, §7.1, §7a bod 7):
 * - VCF-VNI-L3MR-REQD-CFG-001 "Create an uplink profile for each rack." [V10]
 * - VCF-VNI-L3MR-REQD-CFG-002 "Create a host TEP IP pool for each rack with a subnet allocated per rack and a gateway
 *   for the subnet." [V10] (+ [V32] pool must have enough IPs for the hosts – per rack *(derived, 50 §4.5)*)
 * - VCF-VNI-L3MR-REQD-CFG-003 "Create NSX host sub transport node profiles for additional racks." [V10]
 *   (one rack may use the main TNP; every additional rack needs a sub-TNP)
 * - recommendation (page repeats ID VCF-VNI-L3MR-REQD-CFG-001) "Use a separate host TEP transport VLAN ID per rack."
 * - VCF-VSAN-L3MR-REQD-CFG-001 (paraphrase): vSAN gateway of each rack = HA isolation address of its hosts; gateways
 *   highly available and answering ICMP [V1].
 */
export function validateL3RackNetworking(topo: ClusterTopology, configs: readonly RackL3Config[], opts: L3ValidationOptions = {}): RackReason[] {
  const out: RackReason[] = [];
  const perHost = opts.tepIpsPerHost ?? 1;
  const cfgOf = (rackId: string): RackL3Config | undefined => configs.find((c) => c.rackId === rackId);
  const seenProfiles = new Map<string, string>();
  const seenPools: { rackId: string; start: number; end: number }[] = [];
  const seenVlans = new Map<number, string>();
  let mainTnpUsed = false;

  for (const r of topo.racks) {
    const c = cfgOf(r.rackId);
    // --- uplink profile ------------------------------------------------------------------------------------------
    if (!c?.uplinkProfile)
      out.push(reason(issue('NSX_L3_UPLINK_PROFILE_PER_RACK', 'error', `Rack ${r.rackId}: "Create an uplink profile for each rack." (VCF-VNI-L3MR-REQD-CFG-001)`, '50 §3.3 [V10]', r.rackId), { kind: 'create-uplink-profile', rackId: r.rackId }));
    else if (seenProfiles.has(c.uplinkProfile))
      out.push(reason(issue('NSX_L3_UPLINK_PROFILE_PER_RACK', 'error', `Rack ${r.rackId} reuses uplink profile "${c.uplinkProfile}" of rack ${seenProfiles.get(c.uplinkProfile) ?? ''}; "Create an uplink profile for each rack." (VCF-VNI-L3MR-REQD-CFG-001)`, '50 §3.3 [V10]', r.rackId), { kind: 'create-uplink-profile', rackId: r.rackId }));
    else seenProfiles.set(c.uplinkProfile, r.rackId);

    // --- Host TEP pool -------------------------------------------------------------------------------------------
    const pool = c?.hostTepPool;
    const cidr = pool ? parseCidr(pool.cidr) : undefined;
    const gw = pool?.gateway !== undefined ? parseIpv4(pool.gateway) : undefined;
    const tepMsg = '"Create a host TEP IP pool for each rack with a subnet allocated per rack and a gateway for the subnet." (VCF-VNI-L3MR-REQD-CFG-002)';
    if (!pool || !cidr)
      out.push(reason(issue('NSX_L3_HOST_TEP_POOL_PER_RACK', 'error', `Rack ${r.rackId}: ${pool ? `invalid subnet "${pool.cidr}". ` : ''}${tepMsg}`, '50 §3.3 [V10]', r.rackId), { kind: 'create-host-tep-pool', rackId: r.rackId }));
    else {
      if (gw === undefined || !cidrContains(cidr, gw))
        out.push(reason(issue('NSX_L3_HOST_TEP_POOL_PER_RACK', 'error', `Rack ${r.rackId}: the Host TEP pool ${pool.cidr} has ${pool.gateway === undefined ? 'no gateway' : `gateway ${pool.gateway} outside the subnet`}. ${tepMsg}`, '50 §3.3 [V10]', r.rackId), { kind: 'create-host-tep-pool', rackId: r.rackId }));
      const iv = cidrInterval(cidr);
      const clash = seenPools.find((p) => iv.start <= p.end && p.start <= iv.end);
      if (clash)
        out.push(reason(issue('NSX_L3_HOST_TEP_POOL_PER_RACK', 'error', `Rack ${r.rackId}: Host TEP subnet ${pool.cidr} overlaps the subnet of rack ${clash.rackId}; ${tepMsg}`, '50 §3.3 [V10]', r.rackId), { kind: 'create-host-tep-pool', rackId: r.rackId }));
      seenPools.push({ rackId: r.rackId, ...iv });
      const cap = poolCapacity(pool);
      const need = r.hostIds.length * perHost;
      if (cap !== undefined && cap < need)
        out.push(reason(issue('NSX_L3_HOST_TEP_POOL_EXHAUSTED', 'error', `Rack ${r.rackId}: Host TEP pool ${pool.cidr} has ${cap} addresses for ${r.hostIds.length} hosts; the pool "must include enough IP addresses for the hosts you are adding."`, '50 §4.5 [V32] (per rack derived from VCF-VNI-L3MR-REQD-CFG-002)', r.rackId), { kind: 'create-host-tep-pool', rackId: r.rackId }));
      if (pool.vlanId !== undefined) {
        const other = seenVlans.get(pool.vlanId);
        if (other !== undefined)
          out.push(reason(issue('NSX_L3_TEP_VLAN_PER_RACK', 'warning', `Racks ${other} and ${r.rackId} use the same Host TEP transport VLAN ${pool.vlanId}; recommendation: "Use a separate host TEP transport VLAN ID per rack." (the page lists it under ID VCF-VNI-L3MR-REQD-CFG-001).`, '50 §3.3 [V10][V9]', r.rackId)));
        else seenVlans.set(pool.vlanId, r.rackId);
      }
    }

    // --- sub-TNP ("for additional racks") -------------------------------------------------------------------------
    if (!c?.subTransportNodeProfile) {
      if (mainTnpUsed)
        out.push(reason(issue('NSX_L3_SUB_TNP_MISSING', 'error', `Rack ${r.rackId}: "Create NSX host sub transport node profiles for additional racks." (VCF-VNI-L3MR-REQD-CFG-003)`, '50 §3.3 [V10]', r.rackId), { kind: 'create-sub-tnp', rackId: r.rackId }));
      mainTnpUsed = true;
    }

    // --- HA isolation address = vSAN gateway of the rack ---------------------------------------------------------
    const g = c?.vsanGateway;
    const haRef = '50 §3.1, §7.2 [V1]';
    if (!g)
      out.push(reason(issue('VSAN_L3_HA_ISOLATION_ADDRESS', 'error', `Rack ${r.rackId} has no vSAN gateway; for Layer 3 multi-rack the vSAN gateway of each rack is the HA isolation address of its hosts (VCF-VSAN-L3MR-REQD-CFG-001, paraphrase).`, haRef, r.rackId), { kind: 'set-ha-isolation-address', rackId: r.rackId }));
    else {
      if (c?.haIsolationAddress !== g.ip)
        out.push(reason(issue('VSAN_L3_HA_ISOLATION_ADDRESS', 'error', `Rack ${r.rackId}: HA isolation address ${c?.haIsolationAddress ?? '(not set)'} is not the vSAN gateway ${g.ip} of the rack (VCF-VSAN-L3MR-REQD-CFG-001, paraphrase).`, haRef, r.rackId), { kind: 'set-ha-isolation-address', rackId: r.rackId, address: g.ip }));
      if (!g.highlyAvailable || !g.respondsToIcmp)
        out.push(reason(issue('VSAN_L3_HA_ISOLATION_ADDRESS', 'error', `Rack ${r.rackId}: the vSAN gateway ${g.ip} must be highly available and answer ICMP (VCF-VSAN-L3MR-REQD-CFG-001, paraphrase).`, haRef, r.rackId)));
    }
  }
  return out;
}

// ===========================================================================
// 3. Design cluster model vs. physical topology; multi-rack vSAN rules
// ===========================================================================

/** Which cluster the hosts form (00 §6, 05 §4.4–4.5). */
export type ClusterRole = 'management-default' | 'management-additional' | 'workload';

export interface ClusterModelCheckContext {
  readonly role: ClusterRole;
  /** Principal storage choice (05 §4.5 option id: vsan-esa, vsan-osa, multi-rack-vsan, vmfs-fc, nfs-v3 …); undefined = not decided. */
  readonly storage?: string;
}

const VSAN_STORAGES: readonly string[] = ['vsan-esa', 'vsan-osa', 'multi-rack-vsan'];
const isMultiRack = (m: ClusterModel): boolean => m === 'multi-rack-l2' || m === 'multi-rack-l3';

/**
 * Whether the Multi-Rack vSAN storage model rules (VCF-VSAN-L3MR-*) apply: multi-rack cluster model, vSAN (or
 * storage not decided yet) and not the management domain default cluster – there the storage model is "Non
 * Supported" [V5] (50 §8 OQ1: the L2 cluster model itself is supported for the default cluster; the L2 page offers only
 * Single-Rack vSAN for it -> no fault domain rules are enforced there).
 */
export function multiRackVsanApplies(designModel: ClusterModel | undefined, ctx: ClusterModelCheckContext): boolean {
  if (ctx.role === 'management-default') return false;
  if (ctx.storage === 'multi-rack-vsan') return true;
  return designModel !== undefined && isMultiRack(designModel) && (ctx.storage === undefined || VSAN_STORAGES.includes(ctx.storage));
}

/**
 * Multi-Rack vSAN rack rules (50 §3.1, §6.1, §7a bod 2):
 * - VCF-VSAN-L3MR-REQD-CFG-002 "Use a minimum of three (3) racks for the cluster." -> error,
 * - VCF-VSAN-L3MR-RCMD-CFG-001 "Use four (4) Fault domains for vSAN HCI multi-rack" -> warning,
 * - "Assign the same number of hosts to each fault domain." [V12] -> warning (recommendation of the vSAN guide).
 */
export function validateMultiRackVsanRacks(topo: ClusterTopology): RackReason[] {
  const out: RackReason[] = [];
  const n = topo.racks.length;
  const hostCount = topo.hosts.length;
  const rackIds = topo.racks.map((r) => r.rackId);
  const spread = (target: number): RackUnlockAction => ({ kind: 'spread-hosts-across-racks', targetRacks: target, currentRackIds: rackIds, buyHosts: Math.max(0, target - hostCount) });
  if (n < 3)
    out.push(reason(issue('VSAN_MULTI_RACK_TOO_FEW_RACKS', 'error', `Hosts are in ${n} rack(s). "Use a minimum of three (3) racks for the cluster." (VCF-VSAN-L3MR-REQD-CFG-002) – "Requires a minimum of 3 hosts in a cluster, distributed across three (3) racks."`, '50 §3.1, §6.1 [V1]', 'racks'), spread(3)));
  else if (n < 4)
    out.push(reason(issue('VSAN_MULTI_RACK_FOUR_FD_RECOMMENDED', 'warning', '"Use four (4) Fault domains for vSAN HCI multi-rack" (VCF-VSAN-L3MR-RCMD-CFG-001). With three racks the cluster "will provide redundancy, but will not provide automatic rebuild of vSAN components."', '50 §3.1, §6.1 [V1]', 'racks'), spread(4)));
  const counts = topo.racks.map((r) => r.hostIds.length);
  if (n >= 2 && Math.min(...counts) !== Math.max(...counts))
    out.push(reason(issue('VSAN_FD_UNEQUAL_HOSTS', 'warning', `Hosts per rack differ (${topo.racks.map((r) => `${r.rackId}: ${r.hostIds.length}`).join(', ')}); "Assign the same number of hosts to each fault domain."`, '50 §3.1 [V12][V13]', 'racks'), { kind: 'balance-hosts-per-rack', rackIds, targetHostsPerRack: Math.max(...counts) }));
  return out;
}

const mostPopulatedRack = (topo: ClusterTopology): string | undefined => [...topo.racks].sort((a, b) => b.hostIds.length - a.hostIds.length)[0]?.rackId;

/**
 * Design cluster model vs. the derived topology (task 3). Error when a documented requirement / "not supported" is
 * violated, warning otherwise (design.ts severity policy). No issue while no host is mounted.
 */
export function validateClusterModelAgainstTopology(designModel: ClusterModel, topo: ClusterTopology, ctx: ClusterModelCheckContext): RackReason[] {
  const out: RackReason[] = [];
  if (topo.span === 'none') return out;
  const rackIds = topo.racks.map((r) => r.rackId);
  const subject = ctx.role === 'management-default' ? 'mgmt-cluster-model' : ctx.role === 'workload' ? 'wld-cluster-model' : 'cluster-model';

  // 50 §3.2, §5, §7a bod 8 [V6][V9][V10]; 00 §6 [S7]: L3 not supported for the management domain default cluster.
  if (ctx.role === 'management-default' && topo.model === 'multi-rack-l3')
    out.push(reason(
      issue('MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED', 'error', `The hosts form a Multi-Rack Layer 3 topology (ESX management routed between racks ${rackIds.join(', ')}); Multi-Rack L3: "Not supported for primary cluster, additional clusters supported".`, '50 §3.2, §5 [V6][V9][V10]; 00 §6 [S7]', subject),
      { kind: 'stretch-network-across-racks', network: 'esx-management', rackIds },
      { kind: 'consolidate-into-rack', rackId: mostPopulatedRack(topo) ?? '', hostIds: topo.hosts.filter((h) => h.rackId !== mostPopulatedRack(topo)).map((h) => h.hostId) },
    ));

  const mismatch = (msg: string, ref: string, unlock?: RackUnlockAction, alternative?: RackUnlockAction): void => {
    out.push(reason(issue('RACK_CLUSTER_MODEL_MISMATCH', 'warning', msg, ref, subject), unlock, alternative));
  };

  switch (designModel) {
    case 'single-rack': {
      if (topo.span === 'single-rack') break;
      const keep = mostPopulatedRack(topo) ?? '';
      mismatch(
        `Design: Single-Rack ("Single storage fault domain.", "No protection against a rack failure."), but the hosts are in ${topo.span === 'multi-az' ? 'two availability zones' : `${rackIds.length} racks (${rackIds.join(', ')})`}.`,
        '50 §1, §7a bod 1 [V6]',
        { kind: 'consolidate-into-rack', rackId: keep, hostIds: topo.hosts.filter((h) => h.rackId !== keep).map((h) => h.hostId) },
        { kind: 'choose-cluster-model', models: ctx.role === 'management-default' ? ['multi-rack-l2'] : ['multi-rack-l2', 'multi-rack-l3'] },
      );
      break;
    }
    case 'multi-rack-l2':
    case 'multi-rack-l3': {
      const label = designModel === 'multi-rack-l2' ? 'Multi-Rack Layer 2' : 'Multi-Rack Layer 3';
      if (multiRackVsanApplies(designModel, ctx)) out.push(...validateMultiRackVsanRacks(topo));
      else if (topo.span === 'single-rack')
        // derived: "Hosts are installed horizontally across physical racks" [V8][V9]
        mismatch(`Design: ${label}, but all hosts are in rack ${rackIds[0] ?? ''}; the multi-rack models install hosts "horizontally across physical racks" (paraphrase).`, '50 §2, §7a bod 1 [V8][V9]', { kind: 'spread-hosts-across-racks', targetRacks: 2, currentRackIds: rackIds, buyHosts: Math.max(0, 2 - topo.hosts.length) }, { kind: 'choose-cluster-model', models: ['single-rack'] });
      if (topo.span === 'multi-az')
        mismatch(`Design: ${label}, but the hosts are in two availability zones (stretched).`, '50 §2 [V1][V6]', undefined, { kind: 'choose-cluster-model', models: ['stretched'] });
      if (designModel === 'multi-rack-l2' && topo.model === 'multi-rack-l3')
        mismatch('Design: Multi-Rack Layer 2 ("stretched across racks using a single broadcast domain for each network"), but ESX management is routed between racks (Layer 3).', '50 §3.3, §7.1 [V20][V22]', { kind: 'stretch-network-across-racks', network: 'esx-management', rackIds });
      if (designModel === 'multi-rack-l3' && topo.model === 'multi-rack-l2')
        mismatch('Design: Multi-Rack Layer 3 ("isolated to a rack using a separate broadcast domain for each network per rack"; ESX management VMK "Rack Local"), but ESX management shares one broadcast domain across racks (Layer 2).', '50 §3.3, §7.1 [V20][V22]', { kind: 'isolate-network-per-rack', network: 'esx-management', rackIds });
      break;
    }
    case 'stretched':
      if (topo.span !== 'multi-az')
        mismatch('Design: Stretched ("Dual storage fault domains."), but the hosts are not in two availability zones (AZ1 + AZ2 rooms).', '50 §2 [V6]; 10 §3.3');
      break;
  }
  return out;
}

// ===========================================================================
// Umbrella validation
// ===========================================================================

export interface RackAwarenessInput {
  readonly topology: ClusterTopology;
  readonly role: ClusterRole;
  /** Cluster model chosen in the design (05 §4.4); undefined = not decided. */
  readonly designModel?: ClusterModel;
  readonly storage?: string;
  /** Configured vSAN fault domains; undefined = none configured yet. */
  readonly faultDomains?: readonly FaultDomain[];
  readonly vsan?: VsanClusterSettings;
  readonly l3?: readonly RackL3Config[];
  readonly unavailableHostIds?: readonly string[];
  readonly l3Options?: L3ValidationOptions;
}

/**
 * All rack-awareness checks of one cluster:
 * topology problems, design model vs. topology, Multi-Rack vSAN racks, fault domains, multi-rack checklist, storage
 * policy vs. usable FDs, spare FD for rebuild, L3 per-rack requirements, "Non Supported" FDs on the mgmt default cluster.
 */
export function validateRackAwareness(input: RackAwarenessInput): RackReason[] {
  const { topology: topo, role } = input;
  const ctx: ClusterModelCheckContext = { role, ...(input.storage !== undefined ? { storage: input.storage } : {}) };
  const out: RackReason[] = [...topologyIssues(topo)];
  if (input.designModel) out.push(...validateClusterModelAgainstTopology(input.designModel, topo, ctx));
  else if (role === 'management-default' && topo.model === 'multi-rack-l3')
    out.push(...validateClusterModelAgainstTopology('multi-rack-l2', topo, ctx).filter((r) => r.issue.code === 'MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED'));

  const fds = input.faultDomains ?? [];
  const usesFds = fds.some((f) => f.hostIds.length > 0);
  const vsanMultiRack = multiRackVsanApplies(input.designModel, ctx) || (input.designModel === undefined && role !== 'management-default' && (topo.span === 'multi-rack') && (input.storage === undefined || VSAN_STORAGES.includes(input.storage)));

  // 50 §3.2, §6.3 [V5]: Multi-Rack vSAN storage model "Non Supported" for the management domain default cluster.
  // TODO(50 §8 OQ1): the Multi-Rack L2 *cluster* model is supported there; whether fault domains may be configured
  // manually after bring-up is unresolved – the model follows the storage-model table (error).
  if (role === 'management-default' && usesFds)
    out.push(reason(issue('VSAN_MULTI_RACK_MGMT_DEFAULT_UNSUPPORTED', 'error', 'Storage model "Multi-Rack vSAN" (vSAN fault domains across racks) is "Non Supported" for the default cluster of the management domain (Principal only for additional management clusters and workload domains).', '50 §3.2, §6.3 [V5]; §8 OQ1', 'faultDomains')));

  if (fds.length || vsanMultiRack)
    out.push(...validateFaultDomains(fds, topo, { requireRackFaultDomains: vsanMultiRack && topo.span === 'multi-rack', ...(input.unavailableHostIds ? { offlineHostIds: input.unavailableHostIds } : {}) }));

  const eff = effectiveFaultDomains(topo.clusterHostIds, fds, topo, input.unavailableHostIds ?? []);
  const usable = eff.filter((f) => f.usable).length;
  if (input.vsan && (usesFds || vsanMultiRack)) out.push(...validateMultiRackChecklist(input.vsan, usable));
  else if (input.vsan?.defaultPolicy) out.push(...validateStoragePolicy(input.vsan.defaultPolicy, usable, 'defaultPolicy'));

  // Spare FD for rebuild (50 §3.1 [V12], §5 [V13], §6.5): only relevant with rack fault domains.
  if ((usesFds || vsanMultiRack) && input.vsan?.defaultPolicy && esaRaidRow(input.vsan.defaultPolicy)) {
    const req = requiredFaultDomains(input.vsan.defaultPolicy).required;
    if (usable === req)
      out.push(reason(issue('VSAN_FD_NO_REBUILD_CAPACITY', 'warning', `${usable} usable fault domains = exactly what the policy needs; no fault domain is left for rebuild. "Dedicate one fault domain of free capacity for rebuilding data after a failure, if possible."${usable === 3 ? ' "A cluster with three fault domains has the same restrictions that a three host cluster has, such as the inability to reprotect data after a failure".' : ''}`, '50 §3.1, §5 [V12][V13]', 'faultDomains'), { kind: 'add-fault-domains', count: 1 }));
  }

  const l3 = topo.model === 'multi-rack-l3' || (input.designModel === 'multi-rack-l3' && topo.model === 'multi-rack-unknown');
  if (l3 && role !== 'management-default') out.push(...validateL3RackNetworking(topo, input.l3 ?? [], input.l3Options ?? {}));
  return out;
}

// ===========================================================================
// 4. Rack failure simulation (facts only from 50 §2, §5, §6.5)
// ===========================================================================

export type DataAvailability = 'available' | 'at-risk' | 'unavailable';

export interface RackFailureResult {
  readonly rackId: string;
  readonly lostHostIds: readonly string[];
  /** "When a rack fails, all resources including the CPU, memory in the rack become unavailable to the cluster." [V13] */
  readonly lostCores: number;
  readonly lostRamGB: number;
  readonly remainingCores: number;
  readonly remainingRamGB: number;
  readonly faultDomainsBefore: number;
  /** Effective FDs with at least one host in the failed rack. */
  readonly faultDomainsLost: number;
  readonly faultDomainsAfter: number;
  /** FDs map 1:1 to racks (no FD spans racks, no rack split over FDs) – otherwise one rack can take out several FDs [V12]. */
  readonly rackAligned: boolean;
  /**
   * - 'available': lost FDs ≤ FTT ("distributing copies of the data and witness components on nodes in separate racks" [V1]),
   * - 'at-risk': more FDs lost than FTT tolerates, component placement decides (game cannot tell),
   * - 'unavailable': every FD lost.
   */
  readonly dataAvailability: DataAvailability;
  /** vSphere HA restarts VMs on hosts in other racks [V1] (paraphrase) – needs remaining hosts. */
  readonly haRestartOnOtherRacks: boolean;
  /**
   * Re-protect after the failure: needs enough usable FDs for the policy. 3 FDs: "will not provide automatic rebuild of
   * vSAN components" [V1] / "inability to reprotect data after a failure" [V13]; ≥ 4 with free capacity: possible [V1][V12].
   */
  readonly rebuild: 'possible-if-free-capacity' | 'not-possible';
  /** 50 §8 OQ6: CPU/RAM reserve for a rack failure (HA admission control) is NOT documented – never asserted. */
  readonly capacityReserve: { readonly documented: false; readonly note: string };
  readonly notes: readonly string[];
}

/**
 * Simulates the failure of `rackId` for a cluster with the given storage policy. `faultDomains` = configured vSAN FDs
 * (default: none -> every host is a stand-alone FD, so one rack may hold several FDs).
 */
export function simulateRackFailure(topo: ClusterTopology, rackId: string, policy: VsanStoragePolicy, faultDomains: readonly FaultDomain[] = []): RackFailureResult {
  const eff = effectiveFaultDomains(topo.clusterHostIds, faultDomains, topo);
  const lost = topo.hosts.filter((h) => h.rackId === rackId);
  const rest = topo.hosts.filter((h) => h.rackId !== rackId);
  const sum = (hs: readonly { cores: number; ramGB: number }[], k: 'cores' | 'ramGB'): number => hs.reduce((a, h) => a + h[k], 0);
  const lostIds = lost.map((h) => h.hostId);
  const lostFds = eff.filter((f) => f.hostIds.some((h) => lostIds.includes(h)));
  const after = eff.length - lostFds.length;
  const rackAligned = eff.every((f) => f.rackIds.length <= 1) && topo.racks.every((r) => eff.filter((f) => f.hostIds.some((h) => r.hostIds.includes(h))).length <= 1);
  const dataAvailability: DataAvailability =
    lostFds.length === 0 ? 'available' : after === 0 ? 'unavailable' : lostFds.length <= policy.ftt ? 'available' : 'at-risk';
  const req = requiredFaultDomains(policy).required;
  const notes: string[] = [];
  if (!rackAligned) notes.push('Fault domains do not match racks: without rack fault domains vSAN "might store both replicas of an object with hosts in the same rack enclosure" [V12].');
  if (after < req) notes.push(`After the failure ${after} fault domain(s) remain; the policy needs ${req} – objects cannot be re-protected.`);
  if (eff.length === 3) notes.push('"A cluster with three fault domains has the same restrictions that a three host cluster has, such as the inability to reprotect data after a failure" [V13].');
  return {
    rackId,
    lostHostIds: lostIds,
    lostCores: sum(lost, 'cores'),
    lostRamGB: sum(lost, 'ramGB'),
    remainingCores: sum(rest, 'cores'),
    remainingRamGB: sum(rest, 'ramGB'),
    faultDomainsBefore: eff.length,
    faultDomainsLost: lostFds.length,
    faultDomainsAfter: after,
    rackAligned,
    dataAvailability,
    haRestartOnOtherRacks: rest.length > 0 && lost.length > 0,
    rebuild: after >= req && eff.length > 3 ? 'possible-if-free-capacity' : 'not-possible',
    capacityReserve: { documented: false, note: 'CPU/RAM reserve for a rack failure is not documented (50 §8 OQ6); VCF-CLS-RCMD-CFG-001 sizes for one host failure.' },
    notes,
  };
}
