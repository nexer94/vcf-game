/**
 * VCF 9.x object hierarchy and component catalogue.
 * Source of truth: docs/spec/00-architektura.md (modelled version VCF 9.1.1).
 * References like "00 §2.1 [S1]" point to sections / sources of that spec file.
 *
 * Pure TypeScript: no DOM, no PixiJS, no randomness, no time.
 */
import { issue, type ValidationIssue } from './validation';

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/**
 * Version parameter used only where spec 00 explicitly marks [9.0] vs [9.1] differences
 * (00 §2.5). Default everywhere is '9.1' (modelled 9.1.1, docs/spec/VERSION.md).
 */
export type VcfMinorVersion = '9.0' | '9.1';
export const MODELLED_VCF_VERSION = '9.1.1';

export type Platform = 'VCF' | 'VVF';

// ---------------------------------------------------------------------------
// Components (00 §2.2, §2.3, §2.6)
// ---------------------------------------------------------------------------

/** Appliance-style components, table "Components in VCF and vSphere Foundation" (00 §2.2 [S2]). */
export type ApplianceKind =
  | 'vcf-installer' // 00 §2.6 [S4]
  | 'vcf-operations'
  | 'cloud-proxy'
  | 'vcf-operations-for-networks'
  | 'vcf-operations-hcx'
  | 'vcf-automation'
  | 'sddc-manager'
  | 'nsx-manager'
  | 'nsx-edge'
  | 'virtual-network-appliance'
  | 'vcenter'
  | 'esx'
  | 'license-server';

/** [9.1] VCF management services (00 §2.3 [S2][S5]). */
export type ManagementServiceKind =
  | 'fleet-lifecycle'
  | 'salt-raas'
  | 'log-management'
  | 'identity-broker'
  | 'software-depot'
  | 'real-time-metrics'
  | 'salt-master'
  | 'sddc-lifecycle'
  | 'telemetry'
  | 'vcf-services-runtime';

export type ComponentKind = ApplianceKind | ManagementServiceKind;

/** Level at which a component lives (00 §2.1 [S1], §2.3 [S5]). */
export type ComponentScope = 'fleet' | 'instance' | 'domain' | 'none';

/**
 * Where a management service is deployed in VCF (00 §2.3, column "Rozsah nasazení (VCF)").
 * - first-instance: only the first VCF Instance
 * - first-instance-day-n: first instance, optional Day-N
 * - first-instance-optional-others: first instance; optionally other instances (Day-N)
 * - every-instance: every VCF Instance
 * - every-instance-day-n: every instance, optional Day-N
 */
export type ServiceDeploymentScope =
  | 'first-instance'
  | 'first-instance-day-n'
  | 'first-instance-optional-others'
  | 'every-instance'
  | 'every-instance-day-n';

export interface ComponentInfo {
  readonly kind: ComponentKind;
  readonly displayName: string;
  readonly platforms: readonly Platform[];
  readonly scope: ComponentScope;
  /** Short role text from the spec. */
  readonly role: string;
  readonly specRef: string;
}

export interface ManagementServiceInfo extends ComponentInfo {
  readonly kind: ManagementServiceKind;
  readonly deployment: ServiceDeploymentScope;
}

/** 00 §2.2 [S2] + 00 §2.6 [S4]. */
export const APPLIANCES: Readonly<Record<ApplianceKind, ComponentInfo>> = {
  'vcf-installer': {
    kind: 'vcf-installer',
    displayName: 'VCF Installer',
    platforms: ['VCF', 'VVF'],
    scope: 'none',
    role: 'Dedicated VM that helps you plan, configure, and deploy VCF and vSphere Foundation components',
    specRef: '00 §2.6 [S4]',
  },
  'vcf-operations': {
    kind: 'vcf-operations',
    displayName: 'VCF Operations',
    platforms: ['VCF', 'VVF'],
    scope: 'fleet',
    role: 'Central operations platform',
    specRef: '00 §2.1, §2.2 [S1][S2]',
  },
  'cloud-proxy': {
    kind: 'cloud-proxy',
    displayName: 'Cloud proxy',
    platforms: ['VCF', 'VVF'],
    scope: 'instance',
    role: 'A part of VCF Operations. Collects and monitors data locally in the platform',
    specRef: '00 §2.2 [S2]',
  },
  'vcf-operations-for-networks': {
    kind: 'vcf-operations-for-networks',
    displayName: 'VCF Operations for networks',
    platforms: ['VCF'],
    scope: 'fleet',
    role: 'Network analytics add-on of VCF Operations',
    // TODO(spec 00): scope level of VCF Operations for networks is not stated explicitly.
    specRef: '00 §2.2 [S2]',
  },
  'vcf-operations-hcx': {
    kind: 'vcf-operations-hcx',
    displayName: 'VCF Operations HCX',
    platforms: ['VCF'],
    scope: 'fleet',
    role: 'Part of VCF Operations - workload migration between vCenters/clusters',
    // TODO(spec 00): scope level of HCX is not stated explicitly.
    specRef: '00 §2.2 [S2]',
  },
  'vcf-automation': {
    kind: 'vcf-automation',
    displayName: 'VCF Automation',
    platforms: ['VCF'],
    scope: 'fleet',
    role: 'The central provisioning console for your VCF fleet',
    specRef: '00 §2.1, §2.10 [S1][S15]',
  },
  'sddc-manager': {
    kind: 'sddc-manager',
    displayName: 'SDDC Manager',
    platforms: ['VCF'],
    scope: 'instance',
    role: 'Lifecycle management for ESX, vCenter, HCX, and NSX; deployment of workload domains; import of vCenter instances as workload domains; configuration of vSAN stretched clusters',
    specRef: '00 §2.1, §2.2 [S1][S2]',
  },
  'nsx-manager': {
    kind: 'nsx-manager',
    displayName: 'NSX Manager',
    platforms: ['VCF'],
    scope: 'domain',
    role: 'NSX networking management (dedicated or shared between domains)',
    specRef: '00 §2.1, §2.9 [S1][S14]',
  },
  'nsx-edge': {
    kind: 'nsx-edge',
    displayName: 'NSX Edge',
    platforms: ['VCF'],
    scope: 'domain',
    role: 'North-south connectivity, east-west, stateful services (LB, DHCP)',
    specRef: '00 §2.1, §2.2 [S1][S2]',
  },
  'virtual-network-appliance': {
    kind: 'virtual-network-appliance',
    displayName: 'Virtual Network Appliance',
    platforms: ['VCF'],
    scope: 'domain',
    role: 'VM-based NAT and load balancer for distributed VPC',
    specRef: '00 §2.1, §2.2 [S1][S2]',
  },
  vcenter: {
    kind: 'vcenter',
    displayName: 'vCenter',
    platforms: ['VCF', 'VVF'],
    scope: 'domain',
    role: 'Management of ESX hosts and clusters; exactly one per VCF domain',
    specRef: '00 §2.1, §2.2 [S1][S2]',
  },
  esx: {
    kind: 'esx',
    displayName: 'ESX',
    platforms: ['VCF', 'VVF'],
    scope: 'domain',
    role: 'Hypervisor',
    specRef: '00 §2.2 [S2]',
  },
  'license-server': {
    kind: 'license-server',
    displayName: 'License server',
    platforms: ['VCF', 'VVF'],
    scope: 'instance',
    role: 'A part of VCF Operations. Provides secure and integrated license management for your platform.',
    specRef: '00 §2.1, §2.2 [S1][S2]',
  },
};

/** [9.1] 00 §2.3 table (scope from [S5], deployment from [S2]). */
export const MANAGEMENT_SERVICES: Readonly<Record<ManagementServiceKind, ManagementServiceInfo>> = {
  'fleet-lifecycle': {
    kind: 'fleet-lifecycle', displayName: 'Fleet lifecycle', platforms: ['VCF', 'VVF'],
    scope: 'fleet', deployment: 'first-instance',
    role: 'Lifecycle orchestration across the fleet', specRef: '00 §2.3 [S2][S5]',
  },
  'salt-raas': {
    kind: 'salt-raas', displayName: 'Salt RaaS', platforms: ['VCF'],
    scope: 'fleet', deployment: 'first-instance',
    role: 'Desired-state configuration and policies', specRef: '00 §2.3 [S2][S5]',
  },
  'log-management': {
    kind: 'log-management', displayName: 'Log management', platforms: ['VCF', 'VVF'],
    scope: 'fleet', deployment: 'first-instance-day-n',
    // TODO(spec 00 §8 q5): unclear whether Log management can also run in other instances.
    role: 'Logs', specRef: '00 §2.3 [S2][S5]',
  },
  'identity-broker': {
    kind: 'identity-broker', displayName: 'Identity broker', platforms: ['VCF'],
    // TODO(spec 00 §8 q4): [S5] lists it as instance-level, but SSO model may be fleet-wide [S13].
    scope: 'instance', deployment: 'first-instance-optional-others',
    role: 'The single broker for VCF Single Sign-On (except SDDC Manager)', specRef: '00 §2.3, §2.7 [S2][S5][S13]',
  },
  'software-depot': {
    kind: 'software-depot', displayName: 'Software depot', platforms: ['VCF', 'VVF'],
    scope: 'instance', deployment: 'first-instance-optional-others',
    role: 'Can operate on the fleet level or optionally on an instance-level.', specRef: '00 §2.3 [S2][S5]',
  },
  'real-time-metrics': {
    kind: 'real-time-metrics', displayName: 'Real-time metrics', platforms: ['VCF'],
    scope: 'instance', deployment: 'every-instance-day-n',
    role: 'High-frequency metrics', specRef: '00 §2.3 [S2][S5]',
  },
  'salt-master': {
    kind: 'salt-master', displayName: 'Salt Master', platforms: ['VCF'],
    scope: 'instance', deployment: 'every-instance',
    role: 'Enforces desired-state configuration of instance components', specRef: '00 §2.3 [S2][S5]',
  },
  'sddc-lifecycle': {
    kind: 'sddc-lifecycle', displayName: 'SDDC lifecycle', platforms: ['VCF', 'VVF'],
    scope: 'instance', deployment: 'every-instance',
    role: 'Installs/updates management components of the instance', specRef: '00 §2.3 [S2][S5]',
  },
  telemetry: {
    kind: 'telemetry', displayName: 'Telemetry', platforms: ['VCF', 'VVF'],
    scope: 'instance', deployment: 'every-instance',
    role: 'Sends telemetry to Broadcom', specRef: '00 §2.3 [S2][S5]',
  },
  'vcf-services-runtime': {
    kind: 'vcf-services-runtime', displayName: 'VCF services runtime', platforms: ['VCF', 'VVF'],
    scope: 'none', deployment: 'every-instance',
    role: 'Container runtime hosting the VCF management services', specRef: '00 §2.3 [S1][S2]',
  },
};

/** 5.2 -> 9.0 -> 9.1 naming map (00 §2.4 [S2]). `null` = N/A. */
export const COMPONENT_NAME_MAP: readonly { readonly v52: string; readonly v90: string | null; readonly v91: string }[] = [
  { v52: 'VMware Cloud Builder', v90: 'VCF Installer', v91: 'VCF Installer' },
  { v52: 'SDDC Manager', v90: 'SDDC Manager', v91: 'SDDC Manager' },
  { v52: 'VMware Aria Operations', v90: 'VCF Operations', v91: 'VCF Operations' },
  { v52: 'VMware Aria Operations for logs', v90: 'VCF Operations for logs', v91: 'Log management' },
  { v52: 'VMware Aria Operations for networks', v90: 'VCF Operations for networks', v91: 'VCF Operations for networks' },
  { v52: 'VMware Aria Suite Lifecycle', v90: 'VCF Operations fleet management', v91: 'Fleet lifecycle + SDDC lifecycle' },
  { v52: 'Workspace ONE Access', v90: 'VCF Identity Broker', v91: 'Identity broker' },
  { v52: 'VMware HCX', v90: 'VCF Operations HCX', v91: 'VCF Operations HCX' },
  { v52: 'VMware Aria Automation', v90: 'VCF Automation', v91: 'VCF Automation' },
  { v52: 'VMware Aria Automation Orchestrator', v90: 'VCF Operations orchestrator', v91: 'VCF Operations orchestrator' },
  { v52: 'VMware Cloud Director', v90: null, v91: 'VCF Automation' },
  { v52: 'vSphere with Tanzu / IaaS Control Plane', v90: 'vSphere Supervisor', v91: 'vSphere Supervisor' },
];

// ---------------------------------------------------------------------------
// Design models (00 §2.7, §2.9, §2.10, §6)
// ---------------------------------------------------------------------------

/** Local NSX Manager models (00 §2.9 [S14]). */
export type NsxManagerModel = 'simple' | 'high-availability' | 'high-availability-external-lb';
export const NSX_MANAGER_NODES: Readonly<Record<NsxManagerModel, number>> = {
  simple: 1,
  'high-availability': 3,
  'high-availability-external-lb': 3,
};

/** VCF Automation models (00 §2.10 [S15]). */
export type VcfAutomationModel = 'simple' | 'high-availability';

/** VCF management services models (00 §6 [S1][S5][S19]). */
export type ManagementServicesModel = 'simple' | 'high-availability';

/** Identity broker SSO models (00 §2.7 [S13]). */
export type SsoModel = 'fleet-wide' | 'cross-instance' | 'single-instance';

/** vSphere cluster models (00 §6 [S7]). */
export type ClusterModel = 'single-rack' | 'multi-rack-l2' | 'multi-rack-l3' | 'stretched';

/** Fleet deployment designs (00 §6 [S16]). */
export type FleetDesign = 'basic' | 'site-high-availability' | 'disaster-recovery' | 'fault-domains-and-dr';

export const FLEET_DESIGN_CLUSTER_MODELS: Readonly<
  Record<FleetDesign, { readonly management: readonly ClusterModel[]; readonly workload: readonly ClusterModel[] }>
> = {
  basic: { management: ['single-rack'], workload: ['single-rack', 'multi-rack-l2', 'multi-rack-l3'] },
  // NOTE: 00 §6 for Basic Design lists workload "single-rack, multi-rack" without L2/L3 split;
  // modelled as both multi-rack variants. TODO(orchestrator): confirm.
  'site-high-availability': {
    management: ['single-rack', 'stretched'],
    workload: ['single-rack', 'multi-rack-l2', 'multi-rack-l3', 'stretched'],
  },
  'disaster-recovery': { management: ['single-rack'], workload: ['single-rack', 'multi-rack-l2', 'multi-rack-l3'] },
  'fault-domains-and-dr': {
    management: ['single-rack', 'stretched'],
    workload: ['single-rack', 'multi-rack-l2', 'multi-rack-l3', 'stretched'],
  },
};

/** VCF management network models (00 §7 [S17]). */
export type ManagementNetworkModel =
  | 'shared-vlan'
  | 'dedicated-vlan'
  | 'dedicated-vlan-nsx-overlay'
  | 'dedicated-vlan-nsx-stretched-overlay';

/** Distributed switch models (00 §7 [S20]). */
export type DistributedSwitchModel =
  | 'single'
  | 'storage-separation'
  | 'workload-separation'
  | 'storage-and-workload-separation'
  | 'dedicated-cluster-for-nsx-edge'
  | 'vsan-storage-cluster-separation';

// ---------------------------------------------------------------------------
// Limits (00 §6)
// ---------------------------------------------------------------------------

/** Max workload domains per VCF Instance: 40 [9.1] (00 §6 [S6]) / 24 [9.0] ([S12]). */
export const MAX_WORKLOAD_DOMAINS_PER_INSTANCE: Readonly<Record<VcfMinorVersion, number>> = {
  '9.0': 24,
  '9.1': 40,
};
// TODO(spec 00 §8 q3): scale limits (instances per fleet, hosts per cluster/domain,
// vCenters per fleet) are not in the spec – not modelled.

// ---------------------------------------------------------------------------
// Object hierarchy (00 §1 [S1])
// ---------------------------------------------------------------------------

export interface DeployedComponent {
  readonly kind: ComponentKind;
  /** Number of nodes/appliances (e.g. NSX 1 or 3). */
  readonly nodes: number;
  /** Size label as in sizing tables (Small/Medium/Large/Default/Standard). */
  readonly size?: string;
  /** FQDNs of the component (if known). */
  readonly fqdns?: readonly string[];
}

export interface Host {
  readonly id: string;
  readonly fqdn: string;
}

export interface Cluster {
  readonly id: string;
  readonly name: string;
  readonly model: ClusterModel;
  /** 00 §1 / §3: "One or more vSphere clusters with vSphere HA and vSphere DRS enabled." [S1] */
  readonly haEnabled: boolean;
  readonly drsEnabled: boolean;
  /** 00 §2.1: "At least one vSphere Distributed Switches per cluster" [S1]. */
  readonly distributedSwitchCount: number;
  readonly hosts: readonly Host[];
}

export type DomainKind = 'management' | 'workload';

/** NSX Manager attachment of a domain: dedicated or shared with another domain (00 §2.1, §2.9 [S1][S6]). */
export type NsxAttachment =
  | { readonly mode: 'dedicated'; readonly model: NsxManagerModel }
  | { readonly mode: 'shared'; readonly sharedWithDomainId: string };

export interface Domain {
  readonly id: string;
  readonly name: string;
  readonly kind: DomainKind;
  /** "One vCenter instance." (00 §2.1 [S1]) */
  readonly vcenter: DeployedComponent;
  readonly nsx: NsxAttachment;
  /** ≥ 1 cluster (00 §6 [S1]). The first one is the default cluster. */
  readonly clusters: readonly Cluster[];
  /** Additional components hosted in this domain (management domain only, 00 §2.1). */
  readonly components: readonly DeployedComponent[];
}

export interface Instance {
  readonly id: string;
  readonly name: string;
  /** The first VCF Instance of a fleet hosts the fleet-level components (00 §2.1 [S1]). */
  readonly isFirstInstance: boolean;
  /** Exactly one management domain per instance (00 §1, §6 [S1]); its version defines the instance version [S8]. */
  readonly managementDomain: Domain;
  readonly workloadDomains: readonly Domain[];
  readonly version: string;
}

export interface StandaloneVcenter {
  readonly id: string;
  readonly fqdn: string;
}

export interface Fleet {
  readonly id: string;
  readonly name: string;
  /** 1..n instances (00 §1 [S1]). */
  readonly instances: readonly Instance[];
  /** 0..n optional standalone vCenter instances (00 §1 [S1]). */
  readonly standaloneVcenters: readonly StandaloneVcenter[];
}

export interface PrivateCloud {
  /** 1..n fleets (00 §1 [S1]). */
  readonly fleets: readonly Fleet[];
}

// ---------------------------------------------------------------------------
// Expected component placement (00 §2.1, §2.3)
// ---------------------------------------------------------------------------

/**
 * Component kinds that the management domain of an instance hosts (00 §2.1 [S1], 00 §2.3 [S2]).
 * Only always-present components; Day-N optional services are excluded.
 * vCenter/NSX are tracked on Domain itself.
 */
export function expectedManagementDomainKinds(isFirstInstance: boolean): ComponentKind[] {
  // Every instance: SDDC Manager + instance-level services (00 §2.1, §2.3 "every-instance").
  const kinds: ComponentKind[] = ['sddc-manager', 'vcf-services-runtime', 'salt-master', 'sddc-lifecycle', 'telemetry'];
  if (isFirstInstance) {
    // "in the first VCF Instance, License server, VCF Operations, VCF management services, and VCF Automation." [S1]
    kinds.push('license-server', 'vcf-operations', 'vcf-automation', 'fleet-lifecycle', 'salt-raas', 'identity-broker', 'software-depot');
  }
  return kinds;
}

// ---------------------------------------------------------------------------
// Architectural validations (00 §3, §5)
// ---------------------------------------------------------------------------

/**
 * Validates a cluster against architectural rules.
 * - 00 §3: every cluster has vSphere HA + DRS and ≥ 1 vSphere Distributed Switch [S1].
 * - 00 §3 / §5: Multi-rack Layer 3 cluster cannot be the management domain default cluster [S7].
 */
export function validateCluster(cluster: Cluster, opts: { readonly isManagementDefaultCluster: boolean }): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!cluster.haEnabled)
    out.push(issue('CLUSTER_HA_DISABLED', 'error', 'vSphere cluster must have vSphere HA enabled.', '00 §3 [S1]', cluster.name));
  if (!cluster.drsEnabled)
    out.push(issue('CLUSTER_DRS_DISABLED', 'error', 'vSphere cluster must have vSphere DRS enabled.', '00 §3 [S1]', cluster.name));
  if (cluster.distributedSwitchCount < 1)
    out.push(issue('CLUSTER_NO_VDS', 'error', 'At least one vSphere Distributed Switch per cluster is required.', '00 §3 [S1]', cluster.name));
  if (opts.isManagementDefaultCluster && cluster.model === 'multi-rack-l3')
    out.push(issue('MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED', 'error', 'Management domain default cluster not supported on a Multi-Rack Layer 3 cluster.', '00 §3, §5 [S7]', cluster.name));
  return out;
}

/** 00 §6: each domain has exactly one vCenter (by type) and ≥ 1 cluster [S1]. */
export function validateDomain(domain: Domain): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (domain.clusters.length < 1)
    out.push(issue('DOMAIN_NO_CLUSTER', 'error', 'A VCF domain contains one or more vSphere clusters.', '00 §1, §6 [S1]', domain.name));
  if (domain.vcenter.kind !== 'vcenter' || domain.vcenter.nodes !== 1)
    out.push(issue('DOMAIN_VCENTER_COUNT', 'error', 'A VCF domain has exactly one vCenter instance.', '00 §2.1, §6 [S1]', domain.name));
  domain.clusters.forEach((c, i) =>
    out.push(...validateCluster(c, { isManagementDefaultCluster: domain.kind === 'management' && i === 0 })),
  );
  return out;
}

/**
 * Validates sharing of NSX Manager by a workload domain.
 * - [9.0] "Workload domains cannot use the NSX Manager cluster for the management domain." (00 §2.5 [S10])
 * - [9.1] sharing with an existing workload domain or the management domain is allowed (00 §2.5 [S1]).
 */
export function validateNsxSharing(
  instance: Instance,
  workloadNsx: NsxAttachment,
  version: VcfMinorVersion = '9.1',
): ValidationIssue[] {
  if (workloadNsx.mode !== 'shared') return [];
  const target =
    instance.managementDomain.id === workloadNsx.sharedWithDomainId
      ? instance.managementDomain
      : instance.workloadDomains.find((d) => d.id === workloadNsx.sharedWithDomainId);
  if (!target)
    return [issue('NSX_SHARE_TARGET_NOT_FOUND', 'error', 'NSX Manager to share must belong to a domain of the same VCF Instance.', '00 §2.5 [S1]', workloadNsx.sharedWithDomainId)];
  if (version === '9.0' && target.kind === 'management')
    return [issue('NSX_SHARE_MGMT_UNSUPPORTED_90', 'error', 'Workload domains cannot use the NSX Manager cluster for the management domain.', '00 §2.5, §5 [S10]', target.name)];
  return [];
}

/**
 * Prerequisites for adding a workload domain to an instance.
 * - 00 §3: workload domain requires an existing management domain [S1][S8] (guaranteed by Instance type).
 * - 00 §6: max. 40 [9.1] / 24 [9.0] workload domains per instance [S6][S12].
 * - 00 §2.5: NSX sharing rules.
 */
export function validateAddWorkloadDomain(
  instance: Instance,
  newDomain: Domain,
  version: VcfMinorVersion = '9.1',
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (newDomain.kind !== 'workload')
    out.push(issue('NOT_A_WORKLOAD_DOMAIN', 'error', 'Each VCF Instance has exactly one management domain.', '00 §1, §6 [S1]', newDomain.name));
  const max = MAX_WORKLOAD_DOMAINS_PER_INSTANCE[version];
  if (instance.workloadDomains.length >= max)
    out.push(issue('MAX_WORKLOAD_DOMAINS', 'error', `Maximum of ${max} workload domains per VCF Instance reached.`, version === '9.1' ? '00 §6 [S6]' : '00 §6 [S12]', instance.name));
  out.push(...validateNsxSharing(instance, newDomain.nsx, version));
  out.push(...validateDomain(newDomain));
  return out;
}

/**
 * Validates an instance structure.
 * - 00 §2.1: fleet components (VCF Operations, VCF Automation, fleet-level services) only in the
 *   management domain of the first instance [S1].
 * - 00 §2.1 / §2.3: management domain hosts SDDC Manager and the instance-level services [S1][S2].
 * - 00 §6: workload domain limit.
 */
export function validateInstance(instance: Instance, version: VcfMinorVersion = '9.1'): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (instance.managementDomain.kind !== 'management')
    out.push(issue('INSTANCE_NO_MGMT_DOMAIN', 'error', 'Every VCF Instance needs a management domain.', '00 §3 [S8]', instance.name));
  const max = MAX_WORKLOAD_DOMAINS_PER_INSTANCE[version];
  if (instance.workloadDomains.length > max)
    out.push(issue('MAX_WORKLOAD_DOMAINS', 'error', `Maximum of ${max} workload domains per VCF Instance exceeded.`, '00 §6 [S6][S12]', instance.name));
  const present = new Set(instance.managementDomain.components.map((c) => c.kind));
  if (version === '9.1') {
    for (const k of expectedManagementDomainKinds(instance.isFirstInstance)) {
      // VCF Automation may be deployed later (20 §2.1 [S4]); VCF Operations, license server and
      // VCF Automation may be deferred to custom networking (20 §4.2 step 6, §4.5 [S14][S17]).
      if (k === 'vcf-automation' || k === 'vcf-operations' || k === 'license-server') continue;
      if (!present.has(k))
        out.push(issue('MGMT_DOMAIN_MISSING_COMPONENT', 'error', `Management domain is missing ${k}.`, '00 §2.1, §2.3 [S1][S2]', instance.name));
    }
  }
  if (!instance.isFirstInstance) {
    const fleetLevel: ComponentKind[] = ['vcf-operations', 'vcf-automation', 'fleet-lifecycle', 'salt-raas'];
    for (const k of fleetLevel)
      if (present.has(k))
        out.push(issue('FLEET_COMPONENT_OUTSIDE_FIRST_INSTANCE', 'error', `${k} runs in the management domain of the first VCF Instance only.`, '00 §2.1, §2.3 [S1][S2]', instance.name));
  }
  out.push(...validateDomain(instance.managementDomain));
  instance.workloadDomains.forEach((d) => out.push(...validateDomain(d)));
  return out;
}

/** 00 §1: a fleet has 1..n instances; exactly one first instance hosting fleet components [S1]. */
export function validateFleet(fleet: Fleet, version: VcfMinorVersion = '9.1'): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (fleet.instances.length < 1)
    out.push(issue('FLEET_NO_INSTANCE', 'error', 'A VCF fleet contains one or more VCF Instances.', '00 §1 [S1]', fleet.name));
  const firsts = fleet.instances.filter((i) => i.isFirstInstance).length;
  if (fleet.instances.length > 0 && firsts !== 1)
    out.push(issue('FLEET_FIRST_INSTANCE', 'error', 'Fleet components run in the management domain of the first VCF Instance; exactly one first instance is required.', '00 §2.1, §3 [S1][S9]', fleet.name));
  const names = new Set<string>();
  for (const i of fleet.instances) {
    if (names.has(i.name))
      out.push(issue('INSTANCE_NAME_NOT_UNIQUE', 'error', 'VCF Instance name must be unique.', '20 §4.2 step 9 [S14]', i.name));
    names.add(i.name);
    out.push(...validateInstance(i, version));
  }
  return out;
}
