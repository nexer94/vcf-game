/**
 * Sites of the physical layer: site layout presets (sites -> buildings -> rooms), links between rooms, assignment
 * of rooms to availability zones (AZ) / fault domains, and the VCF rules that follow from them.
 *
 * Sources (VCF facts – only these):
 *  - 00 §6 [S16] fleet deployment models (Basic / Site HA / DR / Fault Domains and DR) and cluster models per model,
 *  - 05 §4.1 [D11] Site HA: "Designed for a single VCF fleet instance across two availability zones.", "Witness node
 *    for split-brain avoidance."; DR: second VCF Instance in another AZ / region, VMware Live Recovery,
 *  - 10 §3.3 [P13][P20] stretched: between AZs ≥ 10 Gbps and RTT < 5 ms ("under 5ms RTT"); "vSAN witness musí být
 *    ve třetí nezávislé fault doméně"; 10 §6.2 table row "Stretched inter-AZ ≥ 10 Gbps, RTT < 5 ms – requirement",
 *  - 10 §6.1 [P13][P35] stretched host minimums (vSAN Simple 6 / HA 8; vMSC Simple 1 + 1, HA first mgmt cluster
 *    3 per site); hosts are added in pairs, one to each AZ (10 §6.x VCF-CLS-RCMD-CFG-008 paragraph),
 *  - 06 (Design Blueprints 9.1): the five fleet blueprints (§2.1–2.5, §6.1), layout mapping (§7a), Site HA rules of
 *    the Stretched vSAN model [B11]: equal hosts in both AZs (VCF-VSAN-SC-REQD-CFG-001), witness not co-located with
 *    the AZ hosts and without dependency on either AZ (CFG-009), data sites <-> witness RTT ≤ 200 ms (CFG-003),
 *    inter-AZ RTT < 5 ms / ≥ 10 GbE (CFG-002/004), stretched management cluster Day 2 with HA minimum 8 nodes,
 *    workload domain cluster minimum 6 (3 per site) – 06 §2.3, §5, §6.1, §6.4.
 *
 * GAME values (`gameDefault: true`, illustrative, NOT from the documentation): the layouts themselves, room rack
 * slots, link RTT / bandwidth, room / building / site names. They are chosen so that rooms in one building and
 * buildings of a campus are within the documented stretched limits (RTT < 5 ms, ≥ 10 Gbps) and the remote DR site
 * clearly outside them (see SITE_LAYOUTS).
 *
 * GAME abstractions (scope 'game-scope'): RTT of a multi-hop room path = sum of link RTTs, bandwidth = minimum;
 * cabling between rooms is allowed only switch <-> switch (uplink / ISL carried over the inter-room link) and only
 * when the rooms are linked; rack capacity of a room.
 *
 * Open questions (not modelled): witness bandwidth (no minimum, sized by VM count, 06 §6.4 / §8 q5), DR link
 * requirements ("must meet VMware's requirements" – no numbers, 06 §6.4 / §8 q4).
 *
 * Pure TypeScript: no DOM, no PixiJS.
 */
import type { FleetDesign } from './architecture';
import type { DesignChoices } from './design';
import type { PhysicalState } from './physical';
import { type TransitionResult, type ValidationIssue, issue } from './validation';

// ===========================================================================
// Types
// ===========================================================================

export type SiteLayoutId = 'small-room' | 'large-room' | 'two-rooms-one-building' | 'two-buildings' | 'remote-dr' | 'two-buildings-plus-dr';
export const SITE_LAYOUT_IDS: readonly SiteLayoutId[] = ['small-room', 'large-room', 'two-rooms-one-building', 'two-buildings', 'remote-dr', 'two-buildings-plus-dr'];
export const DEFAULT_SITE_LAYOUT: SiteLayoutId = 'small-room';

/**
 * Role of a room for the VCF design:
 *  - 'az1' / 'az2': availability zones of the (first) VCF Instance; Site HA spans two AZs [D11][S16],
 *  - 'witness': third independent fault domain for the vSAN witness / witness node (10 §3.3 [P13]; 05 §4.1 [D11]),
 *  - 'secondary-instance': location of the second VCF Instance of the DR models ("druhá instance v jiné AZ/regionu",
 *    00 §6 [S16]; 05 §4.1 [D11]).
 */
export type AzRole = 'az1' | 'az2' | 'witness' | 'secondary-instance';
export const AZ_ROLES: readonly AzRole[] = ['az1', 'az2', 'witness', 'secondary-instance'];

export interface SiteDef {
  readonly id: string;
  readonly label: string;
  readonly gameDefault: true;
}

export interface BuildingDef {
  readonly id: string;
  readonly siteId: string;
  readonly label: string;
  readonly gameDefault: true;
}

export interface RoomDef {
  readonly id: string;
  readonly siteId: string;
  readonly buildingId: string;
  readonly label: string;
  /** [GAME] number of racks the room holds. */
  readonly rackSlots: number;
  readonly gameDefault: true;
}

export type SiteLinkKind = 'intra-building' | 'campus' | 'wan';

/** Link between two rooms. [GAME] illustrative RTT / bandwidth. */
export interface SiteLink {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly kind: SiteLinkKind;
  /** Round-trip time in ms (game value). */
  readonly rttMs: number;
  /** Bandwidth in Gbit/s (game value). */
  readonly bandwidthGbps: number;
  readonly gameDefault: true;
}

// ---------------------------------------------------------------------------
// Design Blueprints (spec 06 §1, §2.1–2.5, §6.1, §7a)
// ---------------------------------------------------------------------------

export type BlueprintId =
  | 'vcf-fleet-single-site-minimal-footprint'
  | 'vcf-fleet-single-site'
  | 'vcf-fleet-multiple-sites-single-region'
  | 'vcf-fleet-across-multiple-regions'
  | 'vcf-fleet-single-region-plus-additional-regions';

/** Where hosts of the blueprint's Minimum Requirements live (06 §6.1). */
export interface BlueprintHostGroup {
  /** Region 1 / 2 and AZ as named on the Minimum Requirements page. */
  readonly location: 'site' | 'az1' | 'az2' | 'region2';
  /** ESX hosts listed in the DNS section of Minimum Requirements (06 §8 q1: not split into mgmt / WLD). */
  readonly esxHosts: number;
}

export interface BlueprintDef {
  readonly id: BlueprintId;
  readonly title: string;
  readonly url: string;
  readonly specRef: string;
  /** Fleet deployment model the blueprint corresponds to ("Infrastructure Blueprint Selection", 06 §1 [B21]). */
  readonly fleetModel: FleetDesign;
  readonly topologyCounts: {
    readonly regions: number;
    readonly availabilityZones: number;
    readonly vcfInstances: number;
    /** Third independent location for the vSAN witness (06 §2.3, §2.5 [B11]). */
    readonly witnessSite: boolean;
  };
  readonly hostGroups: readonly BlueprintHostGroup[];
  /** VCF Installer deployment model / size (06 §6.1). */
  readonly installer: { readonly deploymentModel: 'simple' | 'high-availability'; readonly size: 'small' | 'medium' };
  /**
   * Day-0 design choices documented by the blueprint (option ids of design.ts). Only selections that map 1:1 onto an
   * existing option; selections differing per region or paraphrased in 06 are in `notes`.
   */
  readonly documentedChoices: DesignChoices;
  /** Documented choices that are Day 2 (e.g. stretching the management cluster, 06 §2.3 [B11]). */
  readonly day2Choices?: DesignChoices;
  readonly notes: readonly string[];
}

const BP = 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization';

/** The five fleet blueprints with physical topology (06 §1, §2.1–2.5). */
export const DESIGN_BLUEPRINTS: Readonly<Record<BlueprintId, BlueprintDef>> = {
  'vcf-fleet-single-site-minimal-footprint': {
    id: 'vcf-fleet-single-site-minimal-footprint',
    title: 'VCF Fleet in a Single Site with Minimal Footprint',
    url: `${BP}/vcf-fleet-in-a-single-site-with-minimal-footprint-blueprint.html`,
    specRef: '06 §2.1, §6.1 [B3][B4][B5]',
    fleetModel: 'basic',
    topologyCounts: { regions: 1, availabilityZones: 1, vcfInstances: 1, witnessSite: false },
    hostGroups: [{ location: 'site', esxHosts: 3 }],
    installer: { deploymentModel: 'simple', size: 'small' },
    documentedChoices: {
      'fleet-deployment-model': 'basic',
      'workload-placement': 'management-domain',
      'deployment-model': 'simple',
      'deployment-size': 'small',
      'mgmt-cluster-model': 'single-rack',
      'principal-storage': 'vsan-esa',
      'distributed-switch-model': 'single',
      'management-network-model': 'shared-vlan',
      'vcf-operations-model': 'simple',
      'vcf-automation-model': 'simple',
      'identity-broker-model': 'instance',
      'sso-model': 'fleet-wide',
    },
    notes: ['All management and workload components are deployed in a single vSphere cluster. [B3]', 'Simple NSX Manager; Single-Rack Network Fabric. [B3]'],
  },
  'vcf-fleet-single-site': {
    id: 'vcf-fleet-single-site',
    title: 'VCF Fleet in a Single Site',
    url: `${BP}/vcf-fleet-in-a-single-site-blueprint.html`,
    specRef: '06 §2.2, §6.1 [B6][B7]',
    fleetModel: 'basic',
    topologyCounts: { regions: 1, availabilityZones: 1, vcfInstances: 1, witnessSite: false },
    hostGroups: [{ location: 'site', esxHosts: 4 }],
    installer: { deploymentModel: 'high-availability', size: 'medium' },
    documentedChoices: {
      'fleet-deployment-model': 'basic',
      'workload-placement': 'workload-domain',
      'deployment-model': 'high-availability',
      'deployment-size': 'medium',
      'mgmt-cluster-model': 'single-rack',
      'wld-cluster-model': 'single-rack',
      'principal-storage': 'vsan-esa',
      'distributed-switch-model': 'storage-separation',
      'management-network-model': 'shared-vlan',
      'vcf-operations-model': 'high-availability',
      'vcf-automation-model': 'high-availability',
      'identity-broker-model': 'instance',
      'sso-model': 'fleet-wide',
    },
    notes: ['HA NSX Manager; Host Fault Tolerant NSX Edge Cluster; Single-Rack Network Fabric. [B6]', '06 §8 q1: "4 nodes" does not distinguish management and workload domain hosts.'],
  },
  'vcf-fleet-multiple-sites-single-region': {
    id: 'vcf-fleet-multiple-sites-single-region',
    title: 'VCF Fleet with Multiple Sites in a Single Region',
    url: `${BP}/vcf-fleet-with-multiple-sites-in-a-single-region-blueprint.html`,
    specRef: '06 §2.3, §6.1 [B8]–[B15]',
    fleetModel: 'site-high-availability',
    topologyCounts: { regions: 1, availabilityZones: 2, vcfInstances: 1, witnessSite: true },
    hostGroups: [{ location: 'az1', esxHosts: 4 }, { location: 'az2', esxHosts: 4 }],
    installer: { deploymentModel: 'high-availability', size: 'medium' },
    documentedChoices: {
      'fleet-deployment-model': 'site-high-availability',
      'workload-placement': 'workload-domain',
      'deployment-model': 'high-availability',
      'deployment-size': 'medium',
      'wld-cluster-model': 'stretched',
      'distributed-switch-model': 'storage-separation',
      'management-network-model': 'shared-vlan',
      'vcf-operations-model': 'high-availability',
      'vcf-automation-model': 'high-availability',
      'identity-broker-model': 'instance',
      'sso-model': 'fleet-wide',
    },
    // Bring-up in AZ1, the management cluster is stretched on Day 2 (+4 hosts in AZ2) [B11].
    day2Choices: { 'mgmt-cluster-model': 'stretched' },
    notes: [
      'Principal storage: Stretched vSAN Storage Model (no 1:1 option in the design phase). [B8][B11]',
      'Multi Availability Zone Network Fabric; Dual Availability Zone Design Based on NSX Edge Node HA. [B8][B12][B13]',
    ],
  },
  'vcf-fleet-across-multiple-regions': {
    id: 'vcf-fleet-across-multiple-regions',
    title: 'VCF Fleet with Multiple Sites Across Multiple Regions',
    url: `${BP}/vcf-fleet-with-multiple-sites-across-multiple-regions-blueprint.html`,
    specRef: '06 §2.4, §6.1 [B16][B17][B18]',
    fleetModel: 'disaster-recovery',
    topologyCounts: { regions: 2, availabilityZones: 1, vcfInstances: 2, witnessSite: false },
    hostGroups: [{ location: 'site', esxHosts: 4 }, { location: 'region2', esxHosts: 4 }],
    installer: { deploymentModel: 'high-availability', size: 'medium' },
    documentedChoices: {
      'fleet-deployment-model': 'disaster-recovery',
      'workload-placement': 'workload-domain',
      'deployment-model': 'high-availability',
      'deployment-size': 'medium',
      'mgmt-cluster-model': 'single-rack',
      'wld-cluster-model': 'single-rack',
      'principal-storage': 'vsan-esa',
      'distributed-switch-model': 'workload-separation',
      'management-network-model': 'shared-vlan',
      'vcf-operations-model': 'high-availability',
      'vcf-automation-model': 'high-availability',
      'sso-model': 'fleet-wide',
    },
    notes: [
      'Region 2: own VCF Instance (vCenter, SDDC Manager, NSX Manager); VCF Operations only in Region 1, cloud proxy in Region 2. [B17]',
      'Region 1 <-> Region 2 latency / bandwidth "must meet VMware\'s requirements" – no numbers (06 §8 q4). [B21]',
    ],
  },
  'vcf-fleet-single-region-plus-additional-regions': {
    id: 'vcf-fleet-single-region-plus-additional-regions',
    title: 'VCF Fleet with Multiple Sites in a Single Region plus Additional Region(s)',
    url: `${BP}/vcf-fleet-with-multiple-sites-in-a-single-region-plus-additional-region-blueprint.html`,
    specRef: '06 §2.5, §6.1 [B19][B20]',
    fleetModel: 'fault-domains-and-dr',
    topologyCounts: { regions: 2, availabilityZones: 2, vcfInstances: 2, witnessSite: true },
    hostGroups: [{ location: 'az1', esxHosts: 4 }, { location: 'az2', esxHosts: 4 }, { location: 'region2', esxHosts: 4 }],
    installer: { deploymentModel: 'high-availability', size: 'medium' },
    documentedChoices: {
      'fleet-deployment-model': 'fault-domains-and-dr',
      'workload-placement': 'workload-domain',
      'deployment-model': 'high-availability',
      'deployment-size': 'medium',
      'management-network-model': 'shared-vlan',
      'vcf-operations-model': 'high-availability',
      'vcf-automation-model': 'high-availability',
    },
    notes: [
      'Region A: Stretched vSphere Cluster, Stretched vSAN, Storage Separation VDS, Multi-AZ Network Fabric. [B19]',
      'Region B: Single-Rack vSphere Cluster, Single-Rack vSAN ESA, Workload Separation VDS, Single-Rack Network Fabric. [B19]',
      'Identity: HA VCF Identity Broker + Single VCF Instance SSO (paraphrase, 06 §8 q6). [B19]',
    ],
  },
};

export interface LayoutBlueprintMapping {
  readonly blueprintId: BlueprintId;
  readonly specRef: string;
}

/** Layout -> blueprint ("Blueprint -> herní lokalita", 06 §7a – proposed game mapping, documented conditions). */
export const LAYOUT_BLUEPRINTS: Readonly<Record<SiteLayoutId, LayoutBlueprintMapping>> = {
  'small-room': { blueprintId: 'vcf-fleet-single-site-minimal-footprint', specRef: '06 §7a' },
  'large-room': { blueprintId: 'vcf-fleet-single-site', specRef: '06 §7a' },
  'two-rooms-one-building': { blueprintId: 'vcf-fleet-multiple-sites-single-region', specRef: '06 §7a; [B11] "two data halls"' },
  'two-buildings': { blueprintId: 'vcf-fleet-multiple-sites-single-region', specRef: '06 §7a; [B11] "metro distance"' },
  'remote-dr': { blueprintId: 'vcf-fleet-across-multiple-regions', specRef: '06 §7a' },
  'two-buildings-plus-dr': { blueprintId: 'vcf-fleet-single-region-plus-additional-regions', specRef: '06 §7a' },
};

/**
 * Which networks are L2-stretched between AZs and which stay AZ-local (routed) in the Multi-AZ fabric
 * (06 §7 #4, #5 [B10][B12][B13]). Data for later areas (51-nsx, 50-vsan); no rule uses it yet.
 */
export const MULTI_AZ_NETWORK_SPAN = {
  stretchedL2: ['vm-management', 'edge-management', 'workload-vlan'],
  azLocalRouted: ['esx-management', 'vmotion', 'ip-storage', 'host-tep'],
  notStretched: ['nsx-edge-node-networks'],
  firstHopGateway: 'HA first-hop gateway between AZs (HSRP / VRRP / AnyCast)',
  specRef: '06 §7 #4, #5 [B10][B12][B13]',
} as const;

export interface SiteLayout {
  readonly id: SiteLayoutId;
  readonly label: string;
  readonly description: string;
  readonly sites: readonly SiteDef[];
  readonly buildings: readonly BuildingDef[];
  readonly rooms: readonly RoomDef[];
  readonly links: readonly SiteLink[];
  /** [GAME] initial AZ assignment (first room = AZ1). */
  readonly defaultAssignment: Readonly<Record<string, AzRole>>;
  readonly blueprint: LayoutBlueprintMapping;
  readonly gameDefault: true;
}

/** Sites part of PhysicalState. Rooms and links are copied from the layout (links can be edited, game scope). */
export interface SiteState {
  readonly layoutId: SiteLayoutId;
  readonly sites: readonly SiteDef[];
  readonly buildings: readonly BuildingDef[];
  readonly rooms: readonly RoomDef[];
  readonly links: readonly SiteLink[];
  /** Room id -> role; rooms without an entry are unassigned. */
  readonly azAssignment: Readonly<Record<string, AzRole>>;
}

// ===========================================================================
// Documented limits
// ===========================================================================

/**
 * Stretched cluster between AZs: "≥ 10 Gbps a RTT < 5 ms" (10 §3.3 [P13]), AZs "geographically close with low
 * latency (under 5ms RTT)" [P20]; 10 §6.2 row "Stretched inter-AZ | ≥ 10 Gbps, RTT < 5 ms | requirement".
 */
export const STRETCHED_INTER_AZ_REQUIREMENTS = {
  minBandwidthGbps: 10,
  /** RTT must be strictly below this value. */
  maxRttMsExclusive: 5,
  specRef: '10 §3.3, §6.2 [P13][P20]; 06 §6.4 [B11] (VCF-VSAN-SC-REQD-CFG-002/004)',
} as const;

/** Data sites <-> vSAN witness: "RTT ≤ 200 ms (100 ms one way)"; no bandwidth minimum (06 §6.4 [B11], CFG-003/005). */
export const WITNESS_LINK_REQUIREMENTS = {
  /** RTT must be at most this value (inclusive). */
  maxRttMs: 200,
  specRef: '06 §5, §6.4 [B11] (VCF-VSAN-SC-REQD-CFG-003)',
} as const;

// ===========================================================================
// Layout presets ([GAME] data)
// ===========================================================================

const site = (id: string, label: string): SiteDef => ({ id, label, gameDefault: true });
const bldg = (id: string, siteId: string, label: string): BuildingDef => ({ id, siteId, label, gameDefault: true });
const room = (id: string, siteId: string, buildingId: string, label: string, rackSlots: number): RoomDef => ({ id, siteId, buildingId, label, rackSlots, gameDefault: true });
const link = (id: string, a: string, b: string, kind: SiteLinkKind, rttMs: number, bandwidthGbps: number): SiteLink => ({ id, a, b, kind, rttMs, bandwidthGbps, gameDefault: true });

/**
 * [GAME] link numbers vs. documented stretched limits (RTT < 5 ms, ≥ 10 Gbps, 10 §3.3 [P13]):
 *  - intra-building room <-> room: 0.5 ms / 100 Gbps (within), to the small witness room 0.5 ms / 25 Gbps,
 *  - campus building <-> building: 1 ms / 100 Gbps (within), to the witness building 2 ms / 10 Gbps,
 *  - remote DR site (WAN): 40 ms / 1 Gbps (clearly outside both limits).
 * Witness links vs. the documented witness limit (RTT ≤ 200 ms, 06 §6.4 [B11]): 0.5–2 ms (within).
 */
export const SITE_LAYOUTS: Readonly<Record<SiteLayoutId, SiteLayout>> = {
  'small-room': {
    id: 'small-room', label: 'Malá serverovna', description: 'Jedna místnost s místem na pár racků.',
    sites: [site('site-a', 'Primární lokalita')],
    buildings: [bldg('bldg-a', 'site-a', 'Budova A')],
    rooms: [room('room-a1', 'site-a', 'bldg-a', 'Serverovna', 4)],
    links: [],
    defaultAssignment: { 'room-a1': 'az1' },
    blueprint: LAYOUT_BLUEPRINTS['small-room'],
    gameDefault: true,
  },
  'large-room': {
    id: 'large-room', label: 'Větší serverovna', description: 'Jedna větší místnost s více racky.',
    sites: [site('site-a', 'Primární lokalita')],
    buildings: [bldg('bldg-a', 'site-a', 'Budova A')],
    rooms: [room('room-a1', 'site-a', 'bldg-a', 'Velká serverovna', 12)],
    links: [],
    defaultAssignment: { 'room-a1': 'az1' },
    blueprint: LAYOUT_BLUEPRINTS['large-room'],
    gameDefault: true,
  },
  'two-rooms-one-building': {
    id: 'two-rooms-one-building', label: 'Dvě místnosti v jedné budově',
    description: 'Dvě serverovny v jedné budově a malá místnost (např. pro witness).',
    sites: [site('site-a', 'Primární lokalita')],
    buildings: [bldg('bldg-a', 'site-a', 'Budova A')],
    rooms: [
      room('room-a1', 'site-a', 'bldg-a', 'Serverovna 1', 6),
      room('room-a2', 'site-a', 'bldg-a', 'Serverovna 2', 6),
      room('room-a3', 'site-a', 'bldg-a', 'Malá místnost', 1),
    ],
    links: [
      link('link-a1-a2', 'room-a1', 'room-a2', 'intra-building', 0.5, 100),
      link('link-a1-a3', 'room-a1', 'room-a3', 'intra-building', 0.5, 25),
      link('link-a2-a3', 'room-a2', 'room-a3', 'intra-building', 0.5, 25),
    ],
    defaultAssignment: { 'room-a1': 'az1' },
    blueprint: LAYOUT_BLUEPRINTS['two-rooms-one-building'],
    gameDefault: true,
  },
  'two-buildings': {
    id: 'two-buildings', label: 'Dvě budovy (kampus)',
    description: 'Serverovny ve dvou budovách kampusu a malá místnost ve třetí budově (např. pro witness).',
    sites: [site('site-a', 'Kampus')],
    buildings: [bldg('bldg-a', 'site-a', 'Budova A'), bldg('bldg-b', 'site-a', 'Budova B'), bldg('bldg-c', 'site-a', 'Budova C')],
    rooms: [
      room('room-a1', 'site-a', 'bldg-a', 'Serverovna A', 6),
      room('room-b1', 'site-a', 'bldg-b', 'Serverovna B', 6),
      room('room-c1', 'site-a', 'bldg-c', 'Malá místnost C', 1),
    ],
    links: [
      link('link-a1-b1', 'room-a1', 'room-b1', 'campus', 1, 100),
      link('link-a1-c1', 'room-a1', 'room-c1', 'campus', 2, 10),
      link('link-b1-c1', 'room-b1', 'room-c1', 'campus', 2, 10),
    ],
    defaultAssignment: { 'room-a1': 'az1' },
    blueprint: LAYOUT_BLUEPRINTS['two-buildings'],
    gameDefault: true,
  },
  'remote-dr': {
    id: 'remote-dr', label: 'Vzdálená lokalita pro DR',
    description: 'Primární serverovna a vzdálená lokalita (WAN) pro druhou VCF Instance.',
    sites: [site('site-a', 'Primární lokalita'), site('site-b', 'Vzdálená lokalita')],
    buildings: [bldg('bldg-a', 'site-a', 'Budova A'), bldg('bldg-b', 'site-b', 'Vzdálená budova')],
    rooms: [room('room-a1', 'site-a', 'bldg-a', 'Primární serverovna', 8), room('room-b1', 'site-b', 'bldg-b', 'Vzdálená serverovna', 8)],
    links: [link('link-a1-b1', 'room-a1', 'room-b1', 'wan', 40, 1)],
    defaultAssignment: { 'room-a1': 'az1' },
    blueprint: LAYOUT_BLUEPRINTS['remote-dr'],
    gameDefault: true,
  },
  // 06 §7a: "3 nebo 4 + 5" – campus with two AZs and a witness location plus a remote region.
  'two-buildings-plus-dr': {
    id: 'two-buildings-plus-dr', label: 'Kampus + vzdálená lokalita',
    description: 'Dvě budovy kampusu, malá místnost ve třetí budově (např. pro witness) a vzdálená lokalita pro druhou VCF Instance.',
    sites: [site('site-a', 'Kampus'), site('site-b', 'Vzdálená lokalita')],
    buildings: [bldg('bldg-a', 'site-a', 'Budova A'), bldg('bldg-b', 'site-a', 'Budova B'), bldg('bldg-c', 'site-a', 'Budova C'), bldg('bldg-r', 'site-b', 'Vzdálená budova')],
    rooms: [
      room('room-a1', 'site-a', 'bldg-a', 'Serverovna A', 6),
      room('room-b1', 'site-a', 'bldg-b', 'Serverovna B', 6),
      room('room-c1', 'site-a', 'bldg-c', 'Malá místnost C', 1),
      room('room-r1', 'site-b', 'bldg-r', 'Vzdálená serverovna', 6),
    ],
    links: [
      link('link-a1-b1', 'room-a1', 'room-b1', 'campus', 1, 100),
      link('link-a1-c1', 'room-a1', 'room-c1', 'campus', 2, 10),
      link('link-b1-c1', 'room-b1', 'room-c1', 'campus', 2, 10),
      link('link-a1-r1', 'room-a1', 'room-r1', 'wan', 40, 1),
    ],
    defaultAssignment: { 'room-a1': 'az1' },
    blueprint: LAYOUT_BLUEPRINTS['two-buildings-plus-dr'],
    gameDefault: true,
  },
};

export function siteStateFor(layoutId: SiteLayoutId = DEFAULT_SITE_LAYOUT): SiteState {
  const l = SITE_LAYOUTS[layoutId];
  return { layoutId, sites: l.sites, buildings: l.buildings, rooms: l.rooms, links: l.links, azAssignment: { ...l.defaultAssignment } };
}

/** Sites of a physical state (defensive: states without `sites` behave as the default layout). */
export function sitesOf(state: Pick<PhysicalState, 'sites'> | { readonly sites?: SiteState }): SiteState {
  return state.sites ?? siteStateFor(DEFAULT_SITE_LAYOUT);
}

export const isSiteLayoutId = (x: string): x is SiteLayoutId => (SITE_LAYOUT_IDS as readonly string[]).includes(x);

// ===========================================================================
// Lookups
// ===========================================================================

export const roomById = (sites: SiteState, roomId: string): RoomDef | undefined => sites.rooms.find((r) => r.id === roomId);
export const defaultRoomId = (sites: SiteState): string | undefined => sites.rooms[0]?.id;

/** Room of a rack (racks without a known room fall back to the first room). */
export function roomOfRack(state: PhysicalState, rackId: string): string | undefined {
  const s = sitesOf(state);
  const rack = state.racks.find((r) => r.id === rackId);
  if (!rack) return undefined;
  return roomById(s, rack.roomId) ? rack.roomId : defaultRoomId(s);
}

/** Room of a mounted device (server / switch); undefined when not mounted. */
export function roomOfDevice(state: PhysicalState, deviceId: string): string | undefined {
  const d = state.servers.find((x) => x.id === deviceId) ?? state.switches.find((x) => x.id === deviceId);
  return d?.mount ? roomOfRack(state, d.mount.rackId) : undefined;
}

export const roleOfRoom = (sites: SiteState, roomId: string): AzRole | undefined => sites.azAssignment[roomId];
export const roomsWithRole = (sites: SiteState, role: AzRole): string[] => sites.rooms.filter((r) => sites.azAssignment[r.id] === role).map((r) => r.id);
export const unassignedRooms = (sites: SiteState): string[] => sites.rooms.filter((r) => sites.azAssignment[r.id] === undefined).map((r) => r.id);

export function racksInRoom(state: PhysicalState, roomId: string): string[] {
  return state.racks.filter((r) => roomOfRack(state, r.id) === roomId).map((r) => r.id);
}

// ===========================================================================
// Room paths over links ([GAME] abstraction: RTT additive, bandwidth = bottleneck)
// ===========================================================================

export interface RoomPath {
  readonly rttMs: number;
  readonly bandwidthGbps: number;
  readonly linkIds: readonly string[];
}

/** Lowest-RTT path between two rooms over the inter-room links. Same room: RTT 0, unlimited bandwidth. */
export function roomPath(sites: SiteState, from: string, to: string): RoomPath | undefined {
  if (!roomById(sites, from) || !roomById(sites, to)) return undefined;
  if (from === to) return { rttMs: 0, bandwidthGbps: Infinity, linkIds: [] };
  const best = new Map<string, RoomPath>([[from, { rttMs: 0, bandwidthGbps: Infinity, linkIds: [] }]]);
  const done = new Set<string>();
  for (;;) {
    let cur: string | undefined;
    for (const [k, v] of best) if (!done.has(k) && (cur === undefined || v.rttMs < (best.get(cur)?.rttMs ?? Infinity))) cur = k;
    if (cur === undefined) return undefined;
    const p = best.get(cur);
    if (!p) return undefined;
    if (cur === to) return p;
    done.add(cur);
    for (const l of sites.links) {
      const other = l.a === cur ? l.b : l.b === cur ? l.a : undefined;
      if (other === undefined || done.has(other)) continue;
      const rtt = p.rttMs + l.rttMs;
      if (rtt < (best.get(other)?.rttMs ?? Infinity)) best.set(other, { rttMs: rtt, bandwidthGbps: Math.min(p.bandwidthGbps, l.bandwidthGbps), linkIds: [...p.linkIds, l.id] });
    }
  }
}

export const roomsLinked = (sites: SiteState, a: string, b: string): boolean => roomPath(sites, a, b) !== undefined;

/** Path meets the documented stretched inter-AZ requirements (10 §3.3 [P13]). */
export const meetsStretchedRequirements = (p: RoomPath | undefined): boolean =>
  p !== undefined && p.rttMs < STRETCHED_INTER_AZ_REQUIREMENTS.maxRttMsExclusive && p.bandwidthGbps >= STRETCHED_INTER_AZ_REQUIREMENTS.minBandwidthGbps;

// ===========================================================================
// Transitions
// ===========================================================================

const fail = <S>(i: ValidationIssue): TransitionResult<S> => ({ ok: false, error: i });

/**
 * Chooses the site layout. [GAME] allowed only while no rack exists (the room is chosen at the start, CLAUDE.md
 * "Výběr lokality na startu").
 */
export function chooseSiteLayout(state: PhysicalState, layoutId: SiteLayoutId): TransitionResult<PhysicalState> {
  if (!isSiteLayoutId(layoutId)) return fail(issue('SITE_LAYOUT_INVALID', 'error', `Unknown site layout ${String(layoutId)}.`, 'game: site layouts', String(layoutId), 'game-scope'));
  if (state.racks.length > 0 && sitesOf(state).layoutId !== layoutId)
    return fail(issue('SITE_LAYOUT_INVALID', 'error', 'The site layout can be changed only before any rack is placed.', 'game: site layouts', layoutId, 'game-scope'));
  return { ok: true, state: { ...state, sites: siteStateFor(layoutId) } };
}

/** Assigns a room to an AZ / fault-domain role (null = unassign). Several rooms may share one AZ. */
export function assignRoomRole(state: PhysicalState, roomId: string, role: AzRole | null): TransitionResult<PhysicalState> {
  const s = sitesOf(state);
  if (!roomById(s, roomId)) return fail(issue('SITE_ROOM_NOT_FOUND', 'error', `Room ${roomId} does not exist in layout ${s.layoutId}.`, 'game: site layouts', roomId, 'game-scope'));
  if (role !== null && !AZ_ROLES.includes(role)) return fail(issue('SITE_LAYOUT_INVALID', 'error', `Unknown room role ${String(role)}.`, 'game: site layouts', roomId, 'game-scope'));
  const azAssignment: Record<string, AzRole> = { ...s.azAssignment };
  if (role === null) delete azAssignment[roomId];
  else azAssignment[roomId] = role;
  return { ok: true, state: { ...state, sites: { ...s, azAssignment } } };
}

/** [GAME] edit the illustrative numbers of an inter-room link (e.g. "rozbíjet" in the Sandbox). */
export function setSiteLink(state: PhysicalState, linkId: string, patch: { readonly rttMs?: number; readonly bandwidthGbps?: number }): TransitionResult<PhysicalState> {
  const s = sitesOf(state);
  const l = s.links.find((x) => x.id === linkId);
  const rtt = patch.rttMs ?? l?.rttMs ?? -1;
  const bw = patch.bandwidthGbps ?? l?.bandwidthGbps ?? -1;
  if (!l || !(rtt >= 0) || !(bw > 0) || !Number.isFinite(rtt) || !Number.isFinite(bw))
    return fail(issue('SITE_LINK_INVALID', 'error', `Link ${linkId}: RTT must be ≥ 0 ms and bandwidth > 0 Gbit/s.`, 'game: site layouts', linkId, 'game-scope'));
  return { ok: true, state: { ...state, sites: { ...s, links: s.links.map((x) => (x.id === linkId ? { ...x, rttMs: rtt, bandwidthGbps: bw } : x)) } } };
}

/**
 * [GAME] which racks take a slot of a room. Default: every rack assigned to the room. A caller with an inventory
 * (Sandbox: racks without a floor tile) passes a predicate so that only placed racks count – racks waiting in the
 * inventory take no slot, and adding / moving such a rack is not limited by the room capacity.
 */
export interface RoomCapacityOptions {
  readonly occupiesSlot?: (rackId: string) => boolean;
}

/**
 * [GAME] room rack capacity check for adding / moving `rackId` into `roomId` (`rackId` itself is not counted).
 * With `occupiesSlot`, a rack that takes no slot passes and only slot-taking racks of the room are counted.
 */
export function validateRoomCapacity(state: PhysicalState, roomId: string, rackId?: string, opts: RoomCapacityOptions = {}): ValidationIssue[] {
  const s = sitesOf(state);
  const r = roomById(s, roomId);
  if (!r) return [issue('SITE_ROOM_NOT_FOUND', 'error', `Room ${roomId} does not exist in layout ${s.layoutId}.`, 'game: site layouts', roomId, 'game-scope')];
  const occupies = opts.occupiesSlot ?? (() => true);
  if (rackId !== undefined && !occupies(rackId)) return [];
  const used = racksInRoom(state, roomId).filter((id) => id !== rackId && occupies(id)).length;
  return used >= r.rackSlots ? [issue('SITE_ROOM_FULL', 'error', `${r.label} has room for ${r.rackSlots} rack(s) only.`, 'game: site layouts', roomId, 'game-scope')] : [];
}

/** Moves a rack (with its devices) to another room. Cables to other rooms are then subject to the room rules. */
export function moveRackToRoom(state: PhysicalState, rackId: string, roomId: string, opts: RoomCapacityOptions = {}): TransitionResult<PhysicalState> {
  const rack = state.racks.find((r) => r.id === rackId);
  if (!rack) return fail(issue('PHYS_DEVICE_INVALID', 'error', `Unknown rack ${rackId}.`, 'game: room rules', rackId, 'game-scope'));
  const cap = validateRoomCapacity(state, roomId, rackId, opts)[0];
  if (cap) return fail(cap);
  return { ok: true, state: { ...state, racks: state.racks.map((r) => (r.id === rackId ? { ...r, roomId } : r)) } };
}

// ===========================================================================
// Cabling across rooms ([GAME] abstraction)
// ===========================================================================

export interface CableEnds {
  readonly a: { readonly kind: string; readonly serverId?: string; readonly switchId?: string };
  readonly b: { readonly kind: string; readonly serverId?: string; readonly switchId?: string };
}

const deviceOf = (p: CableEnds['a']): string | undefined => (p.kind === 'switch' ? p.switchId : p.serverId);

/**
 * Cable between devices in different rooms: [GAME] only switch <-> switch (uplink / ISL carried over the inter-room
 * link) and only when the rooms are linked. Devices that are not mounted have no room (no rule applies).
 * Returns the room path the cable uses (undefined = same room / not mounted) or an issue.
 */
export function crossRoomCable(state: PhysicalState, cable: CableEnds): { readonly path?: RoomPath; readonly issue?: ValidationIssue } {
  const da = deviceOf(cable.a);
  const db = deviceOf(cable.b);
  const ra = da !== undefined ? roomOfDevice(state, da) : undefined;
  const rb = db !== undefined ? roomOfDevice(state, db) : undefined;
  if (ra === undefined || rb === undefined || ra === rb) return {};
  const s = sitesOf(state);
  if (cable.a.kind !== 'switch' || cable.b.kind !== 'switch')
    return { issue: issue('SITE_CROSS_ROOM_CABLE_INVALID', 'error', `${da} (${ra}) and ${db} (${rb}) are in different rooms: between rooms only switch-to-switch uplinks over an inter-room link are possible.`, 'game: site layouts', `${da}<->${db}`, 'game-scope') };
  const path = roomPath(s, ra, rb);
  if (!path) return { issue: issue('SITE_CROSS_ROOM_CABLE_INVALID', 'error', `Rooms ${ra} and ${rb} are not connected by any inter-room link.`, 'game: site layouts', `${da}<->${db}`, 'game-scope') };
  return { path };
}

// ===========================================================================
// Derivation: AZs, hosts per AZ, inter-AZ link
// ===========================================================================

export interface AzSummary {
  readonly role: AzRole;
  readonly roomIds: readonly string[];
  readonly siteIds: readonly string[];
  /** Servers mounted in racks of the rooms of this role. */
  readonly hostIds: readonly string[];
}

/** AZ / fault-domain summary from the layout and the AZ assignment. Roles with no room are omitted. */
export function availabilityZones(state: PhysicalState, serverIds?: readonly string[]): AzSummary[] {
  const s = sitesOf(state);
  const servers = serverIds ? state.servers.filter((x) => serverIds.includes(x.id)) : state.servers;
  return AZ_ROLES.map((role) => {
    const roomIds = roomsWithRole(s, role);
    return {
      role,
      roomIds,
      siteIds: [...new Set(roomIds.map((id) => roomById(s, id)?.siteId).filter((x): x is string => x !== undefined))],
      hostIds: servers.filter((x) => x.mount && roomIds.includes(roomOfRack(state, x.mount.rackId) ?? '')).map((x) => x.id),
    };
  }).filter((a) => a.roomIds.length > 0);
}

export interface InterAzLinkCheck {
  /** 'no-second-az': AZ1 or AZ2 has no room; 'not-linked': no link path; 'outside-limits' / 'ok'. */
  readonly status: 'no-second-az' | 'not-linked' | 'outside-limits' | 'ok';
  /** Worst (highest RTT / lowest bandwidth) room pair between AZ1 and AZ2. */
  readonly rttMs?: number;
  readonly bandwidthGbps?: number;
  readonly issues: readonly ValidationIssue[];
}

/**
 * Inter-AZ link vs. the documented stretched requirements (10 §3.3, §6.2 [P13][P20]): ≥ 10 Gbps and RTT < 5 ms.
 * Documented as a requirement -> severity error. Messages are descriptive (no documented message text).
 */
export function checkInterAzLink(sites: SiteState): InterAzLinkCheck {
  const az1 = roomsWithRole(sites, 'az1');
  const az2 = roomsWithRole(sites, 'az2');
  const R = STRETCHED_INTER_AZ_REQUIREMENTS;
  if (!az1.length || !az2.length)
    return { status: 'no-second-az', issues: [issue('SITE_SECOND_AZ_MISSING', 'error', 'A stretched design needs two availability zones ("Designed for a single VCF fleet instance across two availability zones."); assign rooms to AZ1 and AZ2.', '05 §4.1 [D11]; 00 §6 [S16]', 'az2')] };
  let rtt = 0;
  let bw = Infinity;
  for (const a of az1)
    for (const b of az2) {
      const p = roomPath(sites, a, b);
      if (!p) return { status: 'not-linked', issues: [issue('SITE_AZ_NOT_LINKED', 'error', `AZ1 room ${a} and AZ2 room ${b} are not connected by any link; a stretched L2 network between the AZs is required.`, '10 §3.3 [P13][P20]', `${a}<->${b}`)] };
      rtt = Math.max(rtt, p.rttMs);
      bw = Math.min(bw, p.bandwidthGbps);
    }
  const issues: ValidationIssue[] = [];
  if (!(rtt < R.maxRttMsExclusive))
    issues.push(issue('SITE_INTER_AZ_RTT_TOO_HIGH', 'error', `Inter-AZ RTT ${rtt} ms: a stretched cluster requires RTT < ${R.maxRttMsExclusive} ms between availability zones ("under 5ms RTT").`, R.specRef, 'inter-az-link'));
  if (bw < R.minBandwidthGbps)
    issues.push(issue('SITE_INTER_AZ_BANDWIDTH_TOO_LOW', 'error', `Inter-AZ bandwidth ${bw} Gbit/s: a stretched cluster requires at least ${R.minBandwidthGbps} Gbps between availability zones.`, R.specRef, 'inter-az-link'));
  return { status: issues.length ? 'outside-limits' : 'ok', rttMs: rtt, bandwidthGbps: bw, issues };
}

/**
 * Witness in a third independent fault domain (10 §3.3 [P13]; "Witness node for split-brain avoidance." [D11]):
 *  - a room with the witness role exists; it is never an AZ room by construction ("not co-located to the ESX hosts
 *    in any of the availability zones", VCF-VSAN-SC-REQD-CFG-009, 06 §2.3 [B11]),
 *  - RTT from every AZ room to the witness ≤ 200 ms (VCF-VSAN-SC-REQD-CFG-003, 06 §6.4 [B11]) -> error,
 *  - witness in the same building as an AZ room -> warning: the third site "must not have a logical or physical
 *    dependency on either availability zone" (paraphrase, 06 §2.3 [B11]); whether a shared building is such a
 *    dependency is a game judgement.
 */
export function checkWitnessFaultDomain(sites: SiteState): ValidationIssue[] {
  const witness = roomsWithRole(sites, 'witness');
  if (!witness.length)
    return [issue('SITE_WITNESS_FAULT_DOMAIN_MISSING', 'error', 'The vSAN witness must be in a third independent fault domain ("Witness node for split-brain avoidance."); assign a room outside AZ1 and AZ2 as the witness location.', '10 §3.3 [P13]; 05 §4.1 [D11]; 06 §2.3 [B11]', 'witness')];
  const out: ValidationIssue[] = [];
  const azRooms = [...roomsWithRole(sites, 'az1'), ...roomsWithRole(sites, 'az2')];
  for (const w of witness)
    for (const a of azRooms) {
      const p = roomPath(sites, a, w);
      if (!p) out.push(issue('SITE_WITNESS_NOT_LINKED', 'error', `Witness room ${w} is not reachable from AZ room ${a} (no inter-room link).`, WITNESS_LINK_REQUIREMENTS.specRef, `${a}<->${w}`));
      else if (p.rttMs > WITNESS_LINK_REQUIREMENTS.maxRttMs)
        out.push(issue('SITE_WITNESS_RTT_TOO_HIGH', 'error', `RTT ${p.rttMs} ms between ${a} and the witness ${w}: data sites to witness must be at most ${WITNESS_LINK_REQUIREMENTS.maxRttMs} ms RTT (VCF-VSAN-SC-REQD-CFG-003).`, WITNESS_LINK_REQUIREMENTS.specRef, `${a}<->${w}`));
    }
  const azBuildings = new Set(azRooms.map((r) => roomById(sites, r)?.buildingId));
  for (const w of witness)
    if (azBuildings.has(roomById(sites, w)?.buildingId))
      out.push(issue('SITE_WITNESS_SHARES_AZ_BUILDING', 'warning', `Witness room ${w} is in the same building as an availability zone; the witness site must not have a logical or physical dependency on either availability zone (VCF-VSAN-SC-REQD-CFG-009, paraphrase).`, '06 §2.3 [B11] (paraphrase); game: building as dependency', w));
  return out;
}

/** DR models: second VCF Instance in another AZ / region (00 §6 [S16]; 05 §4.1 [D11]). */
export function checkSecondaryInstanceLocation(sites: SiteState): ValidationIssue[] {
  return roomsWithRole(sites, 'secondary-instance').length
    ? []
    : [issue('SITE_SECONDARY_LOCATION_MISSING', 'error', 'Disaster Recovery needs a second VCF Instance in another availability zone or region (VMware Live Recovery); assign a room as the location of the second instance.', '00 §6 [S16]; 05 §4.1 [D11]', 'secondary-instance')];
}

// ---------------------------------------------------------------------------
// Stretched host minimums per AZ (10 §6.1 [P13][P35])
// ---------------------------------------------------------------------------

export interface StretchedHostMinimum {
  readonly total: number;
  readonly perAz: number;
  readonly specRef: string;
  /** True when model or storage was not decided and the lowest documented value is used. */
  readonly assumed: boolean;
}

/**
 * Minimum hosts of a stretched (first management) cluster: vSAN Simple 6 / HA 8 [P13]; NFS / FC (vMSC, KB 417356)
 * Simple 2 (1 per site) / HA 6 (3 per site) [P35]. Per AZ = total / 2 – hosts are added in pairs, one to each AZ
 * (10 §6.x, VCF-CLS-RCMD-CFG-008 paragraph). Undecided model / storage -> lowest documented value (`assumed`).
 */
export function minStretchedHosts(model?: string, storage?: string): StretchedHostMinimum {
  const vsanCase = (m: string): number => (m === 'high-availability' ? 8 : 6);
  const vmscCase = (m: string): number => (m === 'high-availability' ? 6 : 2);
  const vsan = storage === 'vsan-esa' || storage === 'vsan-osa';
  const vmsc = storage === 'nfs-v3' || storage === 'vmfs-fc';
  const models = model === 'simple' || model === 'high-availability' ? [model] : ['simple', 'high-availability'];
  const candidates = models.flatMap((m) => (vsan ? [vsanCase(m)] : vmsc ? [vmscCase(m)] : [vsanCase(m), vmscCase(m)]));
  const total = Math.min(...candidates);
  return { total, perAz: Math.ceil(total / 2), specRef: vsan ? '10 §6.1 [P13]; 06 §6.1 [B11]' : '10 §6.1 [P13][P35] (KB 417356)', assumed: candidates.length > 1 };
}

/**
 * Stretched vSAN minimums of the blueprint's Stretched vSAN Storage Model (06 §2.3, §6.1 [B11]): management domain
 * initial cluster (HA) "Minimum of eight (8) nodes" – stretched on Day 2, adding 4 hosts in the second AZ; workload
 * domain cluster "Minimum of six (6) nodes" (3 per site).
 */
export const STRETCHED_VSAN_BLUEPRINT_MINIMUMS = {
  managementInitialClusterHa: { total: 8, perAz: 4, day2: true },
  workloadDomainCluster: { total: 6, perAz: 3 },
  specRef: '06 §2.3, §6.1 [B11]',
} as const;

/**
 * Hosts per AZ for a stretched cluster: minimum per AZ (above) and "an equal number of ESX hosts" in both AZs
 * (VCF-VSAN-SC-REQD-CFG-001, 06 §5 [B11]). Both are REQD -> 'error' by default; the design phase passes 'warning'
 * because the management cluster is stretched only on Day 2 (06 §2.3 [B11]).
 */
export function checkHostsPerAz(azs: readonly AzSummary[], min: StretchedHostMinimum, severity: 'error' | 'warning' = 'error'): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const count = (role: AzRole): number => azs.find((a) => a.role === role)?.hostIds.length ?? 0;
  const day2 = severity === 'warning' ? ' (needed for the Day 2 stretch of the management cluster)' : '';
  for (const role of ['az1', 'az2'] as const) {
    const n = count(role);
    if (n < min.perAz)
      out.push(issue('SITE_AZ_TOO_FEW_HOSTS', severity, `${role.toUpperCase()} has ${n} ESX host(s); a stretched cluster needs at least ${min.total} hosts (${min.perAz} per availability zone, hosts are added in pairs, one to each AZ)${day2}.`, min.specRef, role));
  }
  if (count('az1') !== count('az2'))
    out.push(issue('SITE_AZ_HOST_COUNT_UNEQUAL', severity, `AZ1 has ${count('az1')} and AZ2 ${count('az2')} ESX hosts; both availability zones must have an equal number of ESX hosts (VCF-VSAN-SC-REQD-CFG-001)${day2}.`, '06 §5 [B11]', count('az1') < count('az2') ? 'az1' : 'az2'));
  return out;
}

// ===========================================================================
// Layout capabilities (for unlock actions)
// ===========================================================================

/** Layout offers three distinct rooms where two meet the stretched requirements (AZ1, AZ2 + witness). */
export function layoutSupportsStretched(sites: Pick<SiteState, 'rooms' | 'links'> & Partial<SiteState>): boolean {
  const s = sites as SiteState;
  if (s.rooms.length < 3) return false;
  return s.rooms.some((a) => s.rooms.some((b) => a.id !== b.id && meetsStretchedRequirements(roomPath({ ...s, azAssignment: {} }, a.id, b.id))));
}

export const layoutSupportsSecondaryInstance = (sites: Pick<SiteState, 'rooms'>): boolean => sites.rooms.length >= 2;

/** Fault Domains and DR: stretched (3 rooms) plus a fourth room for the second instance. */
export const layoutSupportsFaultDomainsAndDr = (sites: Pick<SiteState, 'rooms' | 'links'>): boolean => sites.rooms.length >= 4 && layoutSupportsStretched(sites);

export function layoutsSupporting(cap: 'stretched' | 'secondary-instance' | 'fault-domains-and-dr'): SiteLayoutId[] {
  return SITE_LAYOUT_IDS.filter((id) => {
    const l = SITE_LAYOUTS[id];
    return cap === 'stretched' ? layoutSupportsStretched(l) : cap === 'secondary-instance' ? layoutSupportsSecondaryInstance(l) : layoutSupportsFaultDomainsAndDr(l);
  });
}

/** Rooms that could become AZ2: not AZ1, and the path to every AZ1 room meets the stretched requirements. */
export function az2CandidateRooms(sites: SiteState): string[] {
  const az1 = roomsWithRole(sites, 'az1');
  return sites.rooms
    .filter((r) => sites.azAssignment[r.id] !== 'az1' && sites.azAssignment[r.id] !== 'az2' && az1.length > 0 && az1.every((a) => meetsStretchedRequirements(roomPath(sites, a, r.id))))
    .map((r) => r.id);
}
