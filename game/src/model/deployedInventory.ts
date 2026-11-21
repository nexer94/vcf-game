/**
 * Deployed inventory of a VCF fleet: which VMs run where and how many resources they consume.
 * Basis for the "Hotové scénáře" mode (CLAUDE.md) – fully deployed environments with all running VMs.
 *
 * Source of truth: docs/spec/40-workload-domains.md (modelled VCF 9.1.1). References:
 * - "40 §6.3" = per-VM size table (VCF 9.1.1 Planning and Preparation Workbook, sheet "Static Reference Tables",
 *   cell refs `WB SRT Cxx`), "40 §6.4" = node counts / documented totals ([W6] VCF Fleet Sizing Models),
 *   "40 §6.5" = scenario tables 1–5, "40 §2.1/§2.4" = placement rules, "40 §8 qN" = open questions.
 * - "10 §6.5" = vCPU:pCPU guidance for the management domain (10-planning [P14]).
 *
 * Rules kept from the spec:
 * - Documented totals ([W6]) and derived per-VM sums are BOTH reported; documented values are never overwritten.
 * - License server size is not documented (40 §8 q1): the VM is listed with `null` resources and `undocumented: true`;
 *   the documented-vs-sum gap is reported, not attributed.
 * - Worker node counts are the "fits the documented totals" column of 40 §6.4 (spec decision, 40 §8 q2).
 * - VM placement on hosts is a game distribution (`scope: 'game-scope'`), not documented VCF behaviour.
 *
 * Pure TypeScript: no DOM, no PixiJS, no randomness, no time.
 */
import type { ComponentKind, DeployedComponent, Domain, Fleet, Instance } from './architecture';
import { ADDITIONAL_INSTANCE_SIZING, FIRST_INSTANCE_SIZING, type SizingProfile } from './bringup';
import { type PartsLookup, type ServerConfig, configMetrics, resolveServerConfig } from './hardware';
import { type InstanceRole, SERVICES_RUNTIME_CP_NODES as CP_NODES, WORKER_NODE_COUNTS } from './servicesRuntimeNodes';
import type { BlueprintId } from './sites';
import { type ValidationIssue, issue } from './validation';

// ===========================================================================
// Per-VM sizes (40 §6.3)
// ===========================================================================

export interface Resources {
  readonly vcpu: number;
  readonly ramGB: number;
  readonly diskGB: number;
}

const ZERO: Resources = { vcpu: 0, ramGB: 0, diskGB: 0 };
const add = (a: Resources, b: Resources): Resources => ({ vcpu: a.vcpu + b.vcpu, ramGB: a.ramGB + b.ramGB, diskGB: a.diskGB + b.diskGB });
const sub = (a: Resources, b: Resources): Resources => ({ vcpu: a.vcpu - b.vcpu, ramGB: a.ramGB - b.ramGB, diskGB: a.diskGB - b.diskGB });

/** VM types that appear in the deployed inventory (40 §2.1, §2.4, §6.3). */
export type VmComponent =
  | 'sddc-manager'
  | 'vcenter'
  | 'nsx-manager'
  | 'nsx-edge'
  | 'virtual-network-appliance'
  | 'vcf-operations'
  | 'cloud-proxy'
  | 'vcf-automation'
  | 'license-server'
  | 'services-runtime-control-plane'
  | 'services-runtime-worker'
  | 'supervisor-control-plane';

/** Architecture component kind of each VM type (supervisor control plane has none in 00 §2.2). */
export const VM_COMPONENT_KIND: Readonly<Record<VmComponent, ComponentKind | undefined>> = {
  'sddc-manager': 'sddc-manager',
  vcenter: 'vcenter',
  'nsx-manager': 'nsx-manager',
  'nsx-edge': 'nsx-edge',
  'virtual-network-appliance': 'virtual-network-appliance',
  'vcf-operations': 'vcf-operations',
  'cloud-proxy': 'cloud-proxy',
  'vcf-automation': 'vcf-automation',
  'license-server': 'license-server',
  'services-runtime-control-plane': 'vcf-services-runtime',
  'services-runtime-worker': 'vcf-services-runtime',
  'supervisor-control-plane': undefined,
};

export const VM_COMPONENT_LABEL: Readonly<Record<VmComponent, string>> = {
  'sddc-manager': 'SDDC Manager',
  vcenter: 'vCenter',
  'nsx-manager': 'NSX Manager',
  'nsx-edge': 'NSX Edge',
  'virtual-network-appliance': 'Virtual Network Appliance',
  'vcf-operations': 'VCF Operations',
  'cloud-proxy': 'Cloud proxy',
  'vcf-automation': 'VCF Automation',
  'license-server': 'License server',
  'services-runtime-control-plane': 'VCF services runtime – control plane',
  'services-runtime-worker': 'VCF services runtime – worker',
  'supervisor-control-plane': 'Supervisor control plane VM',
};

export interface VmSizeEntry {
  readonly component: VmComponent;
  readonly size: string;
  /** `null` = not documented (License server, 40 §8 q1) or, for disk of workers, documented per profile (see note). */
  readonly vcpu: number | null;
  readonly ramGB: number | null;
  readonly diskGB: number | null;
  /** Workbook cell refs (40 §6.3 "Zdroj (workbook)"). */
  readonly source: string;
  /** TechDocs agreement as listed in 40 §6.3 "Shoda s TechDocs". */
  readonly techDocs: string;
  readonly undocumented?: true;
}

const e = (component: VmComponent, size: string, vcpu: number | null, ramGB: number | null, diskGB: number | null, source: string, techDocs: string): VmSizeEntry => ({
  component,
  size,
  vcpu,
  ramGB,
  diskGB,
  source,
  techDocs,
});

/** 40 §6.3 – values per VM (vCPU / RAM GB / disk GB), workbook 9.1.1 [W28] "Static Reference Tables". */
export const VM_SIZES: readonly VmSizeEntry[] = [
  e('sddc-manager', 'Default', 4, 16, 914, 'WB SRT C33–C35', '= VCF Installer [W24]'),
  e('vcenter', 'Tiny', 2, 14, 619, 'WB SRT C37, C43, C49', '= [W18][W19]'),
  e('vcenter', 'Small', 4, 21, 734, 'WB SRT C38, C44, C54', '= [W18][W19]'),
  e('vcenter', 'Medium', 8, 30, 933, 'WB SRT C39, C45, C59', '= [W18][W19]'),
  e('vcenter', 'Large', 16, 39, 1383, 'WB SRT C40, C46, C64', '= [W18][W19]'),
  e('vcenter', 'XLarge', 24, 58, 2308, 'WB SRT C41, C47, C69', '= [W18][W19]'),
  e('nsx-manager', 'Extra_Small', 2, 8, 300, 'WB SRT C75, C81, C87', 'workbook only'),
  e('nsx-manager', 'Small', 4, 16, 300, 'WB SRT C76, C82, C88', '= [W20] (9.0)'),
  e('nsx-manager', 'Medium', 6, 24, 300, 'WB SRT C77, C83, C89', '= [W20][W21]'),
  e('nsx-manager', 'Large', 12, 48, 300, 'WB SRT C78, C84, C90', '= [W20]'),
  e('nsx-manager', 'XLarge', 24, 96, 400, 'WB SRT C79, C85, C91', '= [W20]'),
  e('nsx-edge', 'Small', 2, 4, 200, 'WB SRT C93–C114', '= [W12]'),
  e('nsx-edge', 'Medium', 4, 8, 200, 'WB SRT C93–C114', '= [W12]'),
  e('nsx-edge', 'Large', 8, 32, 200, 'WB SRT C93–C114', '= [W12]'),
  e('nsx-edge', 'XLarge', 16, 64, 200, 'WB SRT C93–C114', '= [W12]'),
  e('virtual-network-appliance', 'Small', 2, 4, 200, 'WB SRT C97–C118', 'TechDocs gives no numbers; default form factor medium [W13]'),
  e('virtual-network-appliance', 'Medium', 4, 8, 200, 'WB SRT C98, C107, C116', 'TechDocs gives no numbers; default form factor medium [W13]'),
  e('virtual-network-appliance', 'Large', 8, 32, 200, 'WB SRT C97–C118', 'TechDocs gives no numbers [W13]'),
  e('virtual-network-appliance', 'XLarge', 16, 64, 200, 'WB SRT C97–C118', 'TechDocs gives no numbers [W13]'),
  e('vcf-operations', 'Extra Small', 2, 8, 274, 'WB SRT C159–C175', 'CPU/RAM = KB 397782 [W22]; disk workbook only'),
  e('vcf-operations', 'Small', 4, 16, 274, 'WB SRT C159–C175', 'CPU/RAM = KB 397782 [W22]; disk workbook only'),
  e('vcf-operations', 'Medium', 8, 32, 274, 'WB SRT C159–C175', 'CPU/RAM = KB 397782 [W22]; disk workbook only'),
  e('vcf-operations', 'Large', 16, 48, 274, 'WB SRT C159–C175', 'CPU/RAM = KB 397782 [W22]; disk workbook only'),
  e('vcf-operations', 'Extra Large', 24, 128, 274, 'WB SRT C159–C175', 'CPU/RAM = KB 397782 [W22]; disk workbook only'),
  e('cloud-proxy', 'Small', 4, 16, 264, 'WB SRT C177, C181, C185', '= Unified Small [W23]'),
  e('cloud-proxy', 'Standard', 8, 48, 264, 'WB SRT C178, C182, C186', '= Unified Standard [W23]'),
  e('vcf-automation', 'Small', 24, 96, 600, 'WB SRT C135, C139, C143', 'TechDocs gives no numbers'),
  e('vcf-automation', 'Medium', 24, 96, 900, 'WB SRT C136, C140, C144', 'TechDocs gives no numbers'),
  e('vcf-automation', 'Large', 32, 128, 1200, 'WB SRT C137, C141, C145', 'TechDocs gives no numbers'),
  e('services-runtime-control-plane', 'Small', 4, 10, 100, 'WB SRT C317, C322, C327', 'TechDocs gives no numbers'),
  e('services-runtime-control-plane', 'Small HA', 4, 10, 100, 'WB SRT C318, C323, C328', 'TechDocs gives no numbers'),
  e('services-runtime-control-plane', 'Medium', 4, 10, 100, 'WB SRT C319, C324, C329', 'TechDocs gives no numbers'),
  e('services-runtime-control-plane', 'Large', 8, 14, 100, 'WB SRT C320, C325, C330', 'TechDocs gives no numbers'),
  // Worker disk is one value per profile (40 §6.3 note ²) -> WORKER_DISK_TOTAL_GB, not per VM.
  e('services-runtime-worker', 'Simple', 12, 24, null, 'WB SRT C341–C357', 'CPU/RAM = [W6]'),
  e('services-runtime-worker', 'HA-Small', 10, 16, null, 'WB SRT C341–C357', 'CPU/RAM = [W6]'),
  e('services-runtime-worker', 'HA-Medium', 12, 24, null, 'WB SRT C341–C357', 'CPU/RAM = [W6]'),
  e('services-runtime-worker', 'HA-Large', 16, 32, null, 'WB SRT C341–C357', 'CPU/RAM = [W6]'),
  e('supervisor-control-plane', 'Tiny', 2, 8, 48, 'WB SRT C400–C416', 'minimum for VPC 4/16/48 = [W21]'),
  e('supervisor-control-plane', 'Small', 4, 16, 48, 'WB SRT C400–C416', 'minimum for VPC 4/16/48 = [W21]'),
  e('supervisor-control-plane', 'Medium', 8, 24, 48, 'WB SRT C400–C416', 'minimum for VPC 4/16/48 = [W21]'),
  e('supervisor-control-plane', 'Large', 16, 32, 48, 'WB SRT C400–C416', 'minimum for VPC 4/16/48 = [W21]'),
  e('supervisor-control-plane', 'Xlarge', 32, 64, 48, 'WB SRT C400–C416', 'minimum for VPC 4/16/48 = [W21]'),
  { ...e('license-server', 'Default', null, null, null, 'not in workbook SRT nor TechDocs (40 §8 q1)', 'not documented'), undocumented: true },
];

export function vmSize(component: VmComponent, size: string): VmSizeEntry | undefined {
  return VM_SIZES.find((s) => s.component === component && s.size === size);
}

function mustSize(component: VmComponent, size: string): VmSizeEntry {
  const s = vmSize(component, size);
  if (!s) throw new Error(`deployedInventory: no size ${component}/${size} in 40 §6.3`);
  return s;
}

export type VcenterSize = 'Tiny' | 'Small' | 'Medium' | 'Large' | 'XLarge';
export type VcenterStorageSize = 'default' | 'large' | 'xlarge';

/**
 * vCenter disk with "Large" / "XLarge" storage (40 §6.3, WB SRT C50–C73 = [W19]).
 * Large vCenter + large storage: workbook has 4543 (C68) and 4553 (C67); TechDocs [W19] gives 4543 (40 §8 q13).
 */
export const VCENTER_STORAGE_DISK_GB: Readonly<Record<VcenterSize, { readonly large: number; readonly xlarge: number }>> = {
  Tiny: { large: 2059, xlarge: 4319 },
  Small: { large: 2084, xlarge: 4344 },
  Medium: { large: 2233, xlarge: 4493 },
  Large: { large: 2283, xlarge: 4543 },
  XLarge: { large: 2408, xlarge: 4668 },
};

/** NSX Manager appliance sizes offered by the WLD wizard: Medium / Large / Extra Large (40 §4.1 step 10 [W1]). */
export type NsxApplianceSize = 'Medium' | 'Large' | 'XLarge';
export type EdgeSize = 'Small' | 'Medium' | 'Large' | 'XLarge';
export type VnaSize = 'Small' | 'Medium' | 'Large' | 'XLarge';
export type SupervisorSize = 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Xlarge';

/**
 * Hosts / clusters an NSX Manager size supports (40 §6.1, WB SRT B646–C651). Extra_Small "Cloud Service Manager
 * Only", Small "POC only".
 */
export const NSX_MANAGER_CAPACITY: Readonly<Record<NsxApplianceSize, { readonly hosts: number; readonly clusters: number }>> = {
  Medium: { hosts: 128, clusters: 5 },
  Large: { hosts: 1024, clusters: 256 },
  XLarge: { hosts: 2048, clusters: 512 },
};

// ===========================================================================
// Profile composition: node counts per deployment profile (40 §6.4)
// ===========================================================================

export type { InstanceRole } from './servicesRuntimeNodes';
export { WORKER_NODE_COUNTS } from './servicesRuntimeNodes';

export interface NodeGroup {
  readonly nodes: number;
  readonly size: string;
}

export interface ProfileComposition {
  readonly vcenter: VcenterSize;
  readonly nsx: NodeGroup;
  readonly sddcManager: NodeGroup;
  readonly cloudProxy: NodeGroup;
  /** First instance only (40 §2.4 [W5][W6]). */
  readonly vcfOperations?: NodeGroup;
  readonly licenseServer?: NodeGroup;
  readonly vcfAutomation?: NodeGroup;
  readonly runtimeControlPlane: NodeGroup;
  readonly runtimeWorker: NodeGroup & { readonly diskTotalGB: number };
  /** Worker count on the sizing page [W6] vs workbook [WB SRT C332–C339]; `runtimeWorker.nodes` fits the totals (40 §6.4). */
  readonly workerCountSources: { readonly page: number; readonly workbook: number };
}

/** Control plane size label per profile (40 §6.3, WB SRT C317–C330). */
const CP_SIZE: Readonly<Record<SizingProfile, string>> = { simple: 'Small', 'ha-small': 'Small HA', 'ha-medium': 'Medium', 'ha-large': 'Large' };
/** Worker size label per profile (40 §6.3, WB SRT C341–C357). */
const WORKER_SIZE: Readonly<Record<SizingProfile, string>> = { simple: 'Simple', 'ha-small': 'HA-Small', 'ha-medium': 'HA-Medium', 'ha-large': 'HA-Large' };

/** Worker disk, one value per profile = total for all workers (40 §6.3 note ², WB SRT C359–C366, MDS M23). */
export const WORKER_DISK_TOTAL_GB: Readonly<Record<InstanceRole, Readonly<Record<SizingProfile, number>>>> = {
  first: { simple: 2900, 'ha-small': 2800, 'ha-medium': 3300, 'ha-large': 4002 },
  additional: { simple: 1000, 'ha-small': 1000, 'ha-medium': 1202, 'ha-large': 1500 },
};


/**
 * Composition of the management domain base for a profile (40 §6.4 / §6.5 scenario 1, 2, 5).
 * Appliance sizes and counts come from the sizing tables ([W6], bringup.ts FIRST/ADDITIONAL_INSTANCE_SIZING);
 * runtime node counts from WORKER_NODE_COUNTS.used.
 */
export function profileComposition(role: InstanceRole, profile: SizingProfile): ProfileComposition {
  const s = role === 'first' ? FIRST_INSTANCE_SIZING[profile] : ADDITIONAL_INSTANCE_SIZING[profile];
  const w = WORKER_NODE_COUNTS[role][profile];
  const ng = (c: { readonly nodes: number; readonly size: string }): NodeGroup => ({ nodes: c.nodes, size: c.size });
  return {
    vcenter: s.vcenter.size as VcenterSize,
    nsx: ng(s.nsx),
    sddcManager: ng(s.sddcManager),
    cloudProxy: ng(s.cloudProxy),
    ...(role === 'first' && s.vcfOperations ? { vcfOperations: ng(s.vcfOperations) } : {}),
    ...(role === 'first' && s.licenseServer ? { licenseServer: ng(s.licenseServer) } : {}),
    ...(role === 'first' && s.vcfAutomation ? { vcfAutomation: ng(s.vcfAutomation) } : {}),
    runtimeControlPlane: { nodes: CP_NODES[profile], size: CP_SIZE[profile] },
    runtimeWorker: { nodes: w.used, size: WORKER_SIZE[profile], diskTotalGB: WORKER_DISK_TOTAL_GB[role][profile] },
    workerCountSources: { page: w.page, workbook: w.workbook },
  };
}

/** Documented total of the management domain base (40 §6.4 [W6]). */
export function documentedTotals(role: InstanceRole, profile: SizingProfile): Resources {
  const t = (role === 'first' ? FIRST_INSTANCE_SIZING : ADDITIONAL_INSTANCE_SIZING)[profile].totals;
  return { vcpu: t.vcpu, ramGB: t.ramGb, diskGB: t.diskGb };
}

// ===========================================================================
// Inventory types
// ===========================================================================

export interface InventoryVm {
  /** Stable id: `<instanceId>/<domainId>/<component>[-<servedDomain>]-<n>`. */
  readonly id: string;
  readonly name: string;
  readonly component: VmComponent;
  readonly componentKind?: ComponentKind;
  readonly instanceId: string;
  /** Domain whose cluster runs the VM (WLD vCenter / NSX run in the management domain, 40 §2.1 [W1]). */
  readonly domainId: string;
  readonly clusterId: string;
  /** Domain the VM serves (differs from `domainId` for WLD vCenter / NSX Manager). */
  readonly servesDomainId: string;
  readonly size: string;
  /** Node role inside a multi-node component (e.g. VCF Operations primary / replica / data, 40 §6.5 scenario 2). */
  readonly role?: string;
  readonly vcpu: number | null;
  readonly ramGB: number | null;
  readonly diskGB: number | null;
  /** Workbook / TechDocs source of the size. */
  readonly source: string;
  readonly specRef: string;
  /** Size not documented (License server, 40 §8 q1). Excluded from per-VM sums. */
  readonly undocumented?: true;
  /** Disk is a share of the per-profile worker disk total (40 §6.3 note ²) – derived. */
  readonly diskDerived?: true;
  /** Placement of this VM is derived, not stated by documentation (Supervisor CP in WLD cluster, 40 §8 q6). */
  readonly placementDerived?: true;
}

export type WldConnectivity =
  | { readonly kind: 'none' }
  /** Centralized Connectivity – NSX Edge cluster (≥ 2 nodes), deployed after WLD creation (40 §2.1 [W1][W12]). */
  | { readonly kind: 'edge'; readonly nodes: number; readonly size: EdgeSize }
  /** Distributed Connectivity – Virtual Network Appliance, 1 IP/FQDN (2 for a cluster) (40 §2.1, §3.1 [W1][W13]). */
  | { readonly kind: 'vna'; readonly nodes: number; readonly size: VnaSize };

export interface WorkloadDomainOptions {
  /**
   * vCenter size. The 9.1 wizard has no size field [W1]; workbook default input = Medium [WB MDS D44] (40 §6.5,
   * 40 §8 q5). Falls back to `Domain.vcenter.size`, then 'Medium'.
   */
  readonly vcenterSize?: VcenterSize;
  readonly vcenterStorage?: VcenterStorageSize;
  /** Appliance size of a NEW (dedicated) NSX Manager; default Medium (WB MDS I44 for w01, 40 §6.5 B). */
  readonly nsxApplianceSize?: NsxApplianceSize;
  /**
   * vSphere Supervisor: enabled by default with "a single Supervisor control plane VM" [W1]. Size default Small =
   * minimum for VPC [W21] (40 §6.5 C). `null` = disabled.
   */
  readonly supervisor?: { readonly nodes: number; readonly size: SupervisorSize } | null;
  readonly connectivity?: WldConnectivity;
}

export interface InventoryOptions {
  /** Explicit sizing profile per instance id; otherwise inferred from the management domain. */
  readonly profiles?: Readonly<Record<string, SizingProfile>>;
  /** Per workload-domain id. */
  readonly workloadDomains?: Readonly<Record<string, WorkloadDomainOptions>>;
}

export interface FleetInventory {
  readonly vms: readonly InventoryVm[];
  readonly profiles: Readonly<Record<string, SizingProfile>>;
  readonly issues: readonly ValidationIssue[];
}

// ===========================================================================
// Inventory construction
// ===========================================================================

/**
 * Infers the sizing profile from the management domain (vCenter size + NSX model are unique per profile,
 * 40 §6.4 / 00 §6 [S19]).
 */
export function inferProfile(instance: Instance): SizingProfile | undefined {
  const d = instance.managementDomain;
  if (d.nsx.mode === 'dedicated' && d.nsx.model === 'simple') return 'simple';
  switch (d.vcenter.size) {
    case 'Small':
      return 'ha-small';
    case 'Medium':
      return 'ha-medium';
    case 'Large':
      return 'ha-large';
    default:
      return undefined;
  }
}

const VCF_OPS_ROLES = ['primary', 'replica', 'data'] as const;
const pad2 = (n: number): string => String(n).padStart(2, '0');

interface VmCtx {
  readonly instanceId: string;
  readonly domainId: string;
  readonly clusterId: string;
  readonly servesDomainId: string;
}

function makeVms(
  ctx: VmCtx,
  component: VmComponent,
  group: NodeGroup,
  specRef: string,
  namePrefix: string,
  opts: { readonly roles?: readonly string[]; readonly diskTotalGB?: number; readonly diskOverride?: number; readonly placementDerived?: true } = {},
): InventoryVm[] {
  const size = mustSize(component, group.size);
  const out: InventoryVm[] = [];
  const idBase = `${ctx.instanceId}/${ctx.domainId}/${component}${ctx.servesDomainId !== ctx.domainId ? `-${ctx.servesDomainId}` : ''}`;
  for (let i = 0; i < group.nodes; i++) {
    let diskGB = opts.diskOverride ?? size.diskGB;
    let diskDerived = false;
    if (opts.diskTotalGB !== undefined) {
      // Per-profile total split over the nodes; remainder on the first node so the sum stays exact (derived).
      const base = Math.floor(opts.diskTotalGB / group.nodes);
      diskGB = base + (i === 0 ? opts.diskTotalGB - base * group.nodes : 0);
      diskDerived = true;
    }
    const role = opts.roles?.[i];
    out.push({
      id: `${idBase}-${i + 1}`,
      name: group.nodes > 1 ? `${namePrefix} ${role ?? pad2(i + 1)}` : namePrefix,
      component,
      ...(VM_COMPONENT_KIND[component] !== undefined ? { componentKind: VM_COMPONENT_KIND[component] } : {}),
      instanceId: ctx.instanceId,
      domainId: ctx.domainId,
      clusterId: ctx.clusterId,
      servesDomainId: ctx.servesDomainId,
      size: group.size,
      ...(role !== undefined ? { role } : {}),
      vcpu: size.vcpu,
      ramGB: size.ramGB,
      diskGB,
      source: size.source,
      specRef,
      ...(size.undocumented ? { undocumented: true as const } : {}),
      ...(diskDerived ? { diskDerived: true as const } : {}),
      ...(opts.placementDerived ? { placementDerived: true as const } : {}),
    });
  }
  return out;
}

const has = (d: Domain, k: ComponentKind): boolean => d.components.some((c: DeployedComponent) => c.kind === k);

/** VMs of the management domain base (40 §6.5 scenarios 1, 2, 5; 40 §2.4 for additional instances). */
function managementBaseVms(instance: Instance, profile: SizingProfile): InventoryVm[] {
  const d = instance.managementDomain;
  const cl = d.clusters[0]?.id ?? '';
  const role: InstanceRole = instance.isFirstInstance ? 'first' : 'additional';
  const p = profileComposition(role, profile);
  const ctx: VmCtx = { instanceId: instance.id, domainId: d.id, clusterId: cl, servesDomainId: d.id };
  const ref = instance.isFirstInstance ? '40 §6.5 scénář 1/2' : '40 §2.4, §6.5 scénář 5';
  const n = d.name;
  const vms: InventoryVm[] = [];
  vms.push(...makeVms(ctx, 'vcenter', { nodes: 1, size: p.vcenter }, ref, `${n} vCenter`));
  if (d.nsx.mode === 'dedicated') vms.push(...makeVms(ctx, 'nsx-manager', p.nsx, ref, `${n} NSX Manager`));
  if (has(d, 'sddc-manager')) vms.push(...makeVms(ctx, 'sddc-manager', p.sddcManager, ref, 'SDDC Manager'));
  if (p.vcfOperations && has(d, 'vcf-operations'))
    vms.push(...makeVms(ctx, 'vcf-operations', p.vcfOperations, ref, 'VCF Operations', { roles: VCF_OPS_ROLES.slice(0, p.vcfOperations.nodes) }));
  if (has(d, 'cloud-proxy')) vms.push(...makeVms(ctx, 'cloud-proxy', p.cloudProxy, ref, 'Cloud proxy'));
  if (p.licenseServer && has(d, 'license-server')) vms.push(...makeVms(ctx, 'license-server', p.licenseServer, `${ref}; 40 §8 q1`, 'License server'));
  if (p.vcfAutomation && has(d, 'vcf-automation')) vms.push(...makeVms(ctx, 'vcf-automation', p.vcfAutomation, `${ref}; 40 §8 q4`, 'VCF Automation'));
  if (has(d, 'vcf-services-runtime')) {
    vms.push(...makeVms(ctx, 'services-runtime-control-plane', p.runtimeControlPlane, ref, 'VCF services runtime CP'));
    vms.push(...makeVms(ctx, 'services-runtime-worker', p.runtimeWorker, `${ref}; 40 §6.3 pozn. ², 40 §8 q2`, 'VCF services runtime worker', { diskTotalGB: p.runtimeWorker.diskTotalGB }));
  }
  return vms;
}

/** Resolves the dedicated NSX Manager behind a (possibly shared) attachment. */
function nsxOwner(instance: Instance, domain: Domain): Domain | undefined {
  const seen = new Set<string>();
  let cur: Domain | undefined = domain;
  while (cur && cur.nsx.mode === 'shared' && !seen.has(cur.id)) {
    seen.add(cur.id);
    const target: string = cur.nsx.sharedWithDomainId;
    cur = instance.managementDomain.id === target ? instance.managementDomain : instance.workloadDomains.find((w) => w.id === target);
  }
  return cur && cur.nsx.mode === 'dedicated' ? cur : undefined;
}

const DEFAULT_SUPERVISOR = { nodes: 1, size: 'Small' as SupervisorSize };

/** VMs of one workload domain (40 §2.1, §6.5 scénář 3 B + C). */
function workloadDomainVms(instance: Instance, wld: Domain, o: WorkloadDomainOptions, issues: ValidationIssue[]): InventoryVm[] {
  const mgmt = instance.managementDomain;
  const mgmtCluster = mgmt.clusters[0]?.id ?? '';
  const inMgmt: VmCtx = { instanceId: instance.id, domainId: mgmt.id, clusterId: mgmtCluster, servesDomainId: wld.id };
  const vms: InventoryVm[] = [];

  // 40 §2.1 [W1]: "For newly-deployed workload domains, NSX Manager and vCenter are deployed on the management domain
  // primary cluster." For additional instances: that instance's management domain (40 §2.4, derived).
  const vcSize: VcenterSize = o.vcenterSize ?? (isVcenterSize(wld.vcenter.size) ? wld.vcenter.size : 'Medium');
  const storage = o.vcenterStorage ?? 'default';
  const vcDisk = storage === 'default' ? undefined : VCENTER_STORAGE_DISK_GB[vcSize][storage];
  vms.push(
    ...makeVms(inMgmt, 'vcenter', { nodes: 1, size: vcSize }, '40 §2.1 [W1], §6.5 scénář 3 B; 40 §8 q5', `${wld.name} vCenter`, vcDisk !== undefined ? { diskOverride: vcDisk } : {}),
  );
  if (wld.nsx.mode === 'dedicated') {
    // Simple = 1 node, High-Availability = 3 nodes (+VIP) [W1]; 0 new VMs when joining an existing NSX Manager.
    const nodes = wld.nsx.model === 'simple' ? 1 : 3;
    vms.push(...makeVms(inMgmt, 'nsx-manager', { nodes, size: o.nsxApplianceSize ?? 'Medium' }, '40 §2.1, §2.2 [W1], §6.5 scénář 3 B', `${wld.name} NSX Manager`));
  }

  const cluster = wld.clusters[0];
  const sup = o.supervisor === undefined ? DEFAULT_SUPERVISOR : o.supervisor;
  if (!cluster) {
    // Domain infrastructure only (40 §2.3, §5 [W4]).
    if (o.supervisor !== undefined && o.supervisor !== null)
      issues.push(issue('WLD_SUPERVISOR_REQUIRES_CLUSTER', 'error', 'You cannot enable vSphere Supervisor for a workload domain without a vSphere cluster.', '40 §5 [W4]', wld.name));
    if (o.connectivity && o.connectivity.kind !== 'none')
      issues.push(issue('WLD_CONNECTIVITY_REQUIRES_CLUSTER', 'error', 'Edge / Virtual Network Appliance nodes run in a vSphere cluster of the domain; the domain has none.', '40 §2.1 [W1][W12][W13]', wld.name));
    return vms;
  }
  const inWld: VmCtx = { instanceId: instance.id, domainId: wld.id, clusterId: cluster.id, servesDomainId: wld.id };
  if (sup) vms.push(...makeVms(inWld, 'supervisor-control-plane', sup, '40 §2.1 [W1], §6.5 scénář 3 C; 40 §8 q6', `${wld.name} Supervisor CP`, { placementDerived: true }));
  const c = o.connectivity ?? { kind: 'none' };
  if (c.kind === 'edge') {
    if (c.nodes < 2)
      issues.push(issue('WLD_EDGE_CLUSTER_MIN_NODES', 'error', 'A minimum of two Edge Nodes are required to deploy an Edge Cluster.', '40 §5 [W12]', wld.name));
    vms.push(...makeVms(inWld, 'nsx-edge', { nodes: c.nodes, size: c.size }, '40 §2.1 [W12], §6.5 scénář 3 C', `${wld.name} Edge`));
  } else if (c.kind === 'vna') {
    if (c.nodes < 1 || c.nodes > 2)
      issues.push(issue('WLD_VNA_NODE_COUNT', 'error', 'Distributed Connectivity needs 1 IP/FQDN for a Virtual Network Appliance (2 for a cluster).', '40 §2.1, §3.1 [W1][W13]', wld.name));
    vms.push(...makeVms(inWld, 'virtual-network-appliance', { nodes: c.nodes, size: c.size }, '40 §2.1 [W1][W13], §6.5 scénář 3 C', `${wld.name} VNA`));
  }
  return vms;
}

const isVcenterSize = (s: string | undefined): s is VcenterSize => s === 'Tiny' || s === 'Small' || s === 'Medium' || s === 'Large' || s === 'XLarge';

/**
 * All VMs of a deployed fleet (40 §2, §6.5).
 * - management domain per profile (first instance with VCF Operations / Automation / License server; additional
 *   instances without them, 40 §2.4),
 * - per WLD: vCenter (+ dedicated NSX) in the management domain primary cluster, Supervisor CP / Edge / VNA in the
 *   WLD cluster.
 * Components missing from `Domain.components` (e.g. VCF Automation deferred) produce no VM.
 */
export function inventoryForFleet(fleet: Fleet, options: InventoryOptions = {}): FleetInventory {
  const vms: InventoryVm[] = [];
  const issues: ValidationIssue[] = [];
  const profiles: Record<string, SizingProfile> = {};
  for (const inst of fleet.instances) {
    const profile = options.profiles?.[inst.id] ?? inferProfile(inst);
    if (!profile) {
      issues.push(issue('INVENTORY_PROFILE_UNKNOWN', 'error', 'Sizing profile of the management domain cannot be determined (vCenter size / NSX model do not match a profile).', '40 §6.4 [W6]', inst.name, 'game-scope'));
      continue;
    }
    profiles[inst.id] = profile;
    vms.push(...managementBaseVms(inst, profile));
    for (const wld of inst.workloadDomains) {
      if (wld.nsx.mode === 'shared' && !nsxOwner(inst, wld))
        issues.push(issue('NSX_SHARE_TARGET_NOT_FOUND', 'error', 'NSX Manager to share must belong to a domain of the same VCF Instance.', '40 §2.2 [W1]', wld.name));
      vms.push(...workloadDomainVms(inst, wld, options.workloadDomains?.[wld.id] ?? {}, issues));
    }
  }
  return { vms, profiles, issues };
}

// ===========================================================================
// Totals (40 §6.4, §6.5)
// ===========================================================================

export interface ResourceTotals {
  readonly vmCount: number;
  /** Sum of per-VM values (derived); VMs with undocumented size are excluded. */
  readonly perVm: Resources;
  /** VMs whose size is undocumented (License server) – counted in vmCount, not in perVm. */
  readonly undocumentedVms: number;
}

export function sumVms(vms: readonly InventoryVm[]): ResourceTotals {
  let perVm = ZERO;
  let undocumentedVms = 0;
  for (const v of vms) {
    if (v.undocumented) {
      undocumentedVms++;
      continue;
    }
    perVm = add(perVm, { vcpu: v.vcpu ?? 0, ramGB: v.ramGB ?? 0, diskGB: v.diskGB ?? 0 });
  }
  return { vmCount: vms.length, perVm, undocumentedVms };
}

export interface DocumentedTotals {
  readonly resources: Resources;
  readonly source: string;
}

export interface ManagementDomainTotals {
  readonly instanceId: string;
  readonly domainId: string;
  readonly profile: SizingProfile;
  /** Everything running in the management domain (base + WLD vCenters / NSX). */
  readonly all: ResourceTotals;
  /** Management components of the profile only. */
  readonly base: ResourceTotals;
  /** WLD vCenter / NSX Manager VMs hosted here (40 §2.1 [W1]). */
  readonly workloadIncrements: ResourceTotals;
  /**
   * Documented total of the profile ([W6]); present only when the full documented component set is deployed
   * (otherwise the documented number does not describe this domain).
   */
  readonly documented?: DocumentedTotals;
  /** documented − base.perVm (derived). For the first instance it contains the undocumented License server and disk gap (40 §6.4, §8 q1, q3). */
  readonly documentedMinusPerVm?: Resources;
  /**
   * Planning total = documented base + per-VM sum of WLD increments (derived; the "Management domain celkem" column
   * of 40 §6.5 scénář 3/4). Falls back to all.perVm when no documented base applies.
   */
  readonly planning: Resources;
  readonly planningDerived: true;
}

export interface WorkloadDomainTotals {
  readonly instanceId: string;
  readonly domainId: string;
  /** VMs running in the WLD cluster (Supervisor CP, Edge, VNA). Business workloads are not modelled. */
  readonly inCluster: ResourceTotals;
  /** VMs serving this WLD that run in the management domain (vCenter, NSX Manager). */
  readonly inManagementDomain: ResourceTotals;
}

export interface InstanceTotals {
  readonly instanceId: string;
  readonly all: ResourceTotals;
  /** Management domain planning + WLD clusters (derived). */
  readonly planning: Resources;
}

export interface FleetTotals {
  readonly managementDomains: readonly ManagementDomainTotals[];
  readonly workloadDomains: readonly WorkloadDomainTotals[];
  readonly instances: readonly InstanceTotals[];
  readonly fleet: { readonly all: ResourceTotals; readonly planning: Resources };
}

/** Kinds required for the documented [W6] total of a profile to apply. */
function documentedSetDeployed(instance: Instance): boolean {
  const d = instance.managementDomain;
  const need: ComponentKind[] = ['sddc-manager', 'cloud-proxy', 'vcf-services-runtime'];
  if (instance.isFirstInstance) need.push('vcf-operations', 'license-server', 'vcf-automation');
  return d.nsx.mode === 'dedicated' && need.every((k) => has(d, k));
}

export function totalsForFleet(fleet: Fleet, inv: FleetInventory): FleetTotals {
  const managementDomains: ManagementDomainTotals[] = [];
  const workloadDomains: WorkloadDomainTotals[] = [];
  const instances: InstanceTotals[] = [];
  let fleetPlanning = ZERO;
  for (const inst of fleet.instances) {
    const profile = inv.profiles[inst.id];
    if (!profile) continue;
    const mgmtId = inst.managementDomain.id;
    const inInst = inv.vms.filter((v) => v.instanceId === inst.id);
    const inMgmt = inInst.filter((v) => v.domainId === mgmtId);
    const base = sumVms(inMgmt.filter((v) => v.servesDomainId === mgmtId));
    const incr = sumVms(inMgmt.filter((v) => v.servesDomainId !== mgmtId));
    const role: InstanceRole = inst.isFirstInstance ? 'first' : 'additional';
    const documented = documentedSetDeployed(inst)
      ? { resources: documentedTotals(role, profile), source: '[W6] VCF Fleet Sizing Models (40 §6.4)' }
      : undefined;
    const planning = documented ? add(documented.resources, incr.perVm) : add(base.perVm, incr.perVm);
    managementDomains.push({
      instanceId: inst.id,
      domainId: mgmtId,
      profile,
      all: sumVms(inMgmt),
      base,
      workloadIncrements: incr,
      ...(documented ? { documented, documentedMinusPerVm: sub(documented.resources, base.perVm) } : {}),
      planning,
      planningDerived: true,
    });
    let instPlanning = planning;
    for (const w of inst.workloadDomains) {
      const inCluster = sumVms(inInst.filter((v) => v.domainId === w.id));
      workloadDomains.push({ instanceId: inst.id, domainId: w.id, inCluster, inManagementDomain: sumVms(inMgmt.filter((v) => v.servesDomainId === w.id)) });
      instPlanning = add(instPlanning, inCluster.perVm);
    }
    instances.push({ instanceId: inst.id, all: sumVms(inInst), planning: instPlanning });
    fleetPlanning = add(fleetPlanning, instPlanning);
  }
  return { managementDomains, workloadDomains, instances, fleet: { all: sumVms(inv.vms), planning: fleetPlanning } };
}

// ===========================================================================
// Host capacity & utilisation (10 §3.4, §6.4, §6.5)
// ===========================================================================

export interface HostCapacity {
  readonly hostId: string;
  /** Physical cores; SMT not counted (10 §3.4 VCF-ESX-RCMD-CFG-003). */
  readonly cores: number;
  readonly ramGB: number;
  /** Raw node capacity of capacity drives (15 §6.1 "Node Capacity"); vSAN raw capacity, no policy overhead. */
  readonly rawCapacityTB: number;
}

/** Host capacity from a server configuration (hardware.ts). Undefined when the config does not resolve. */
export function hostCapacityFromConfig(lookup: PartsLookup, hostId: string, config: ServerConfig): HostCapacity | undefined {
  const r = resolveServerConfig(lookup, config);
  if (!r.ok) return undefined;
  const m = configMetrics(r.resolved);
  return { hostId, cores: m.cores, ramGB: m.ramGB, rawCapacityTB: m.nodeCapacityTB };
}

/** 10 §6.5 [P14]: management domain vCPU:pCPU ≤ 2:1 ("higher ratios such as 3:1 or 4:1 are supported" with monitoring). */
export const MGMT_VCPU_PER_PCPU_GUIDANCE = 2;

/** Decimal TB -> GB for drive capacities (vendor TB). Derived game conversion. */
export const GB_PER_TB = 1000;

export interface Utilisation {
  readonly demand: Resources;
  /** vCPU per physical core (derived). */
  readonly vcpuPerCore: number;
  /** Same with one host down (10 §6.5: size for host failure / maintenance). Infinity for a 1-host cluster. */
  readonly vcpuPerCoreOneHostDown: number;
  readonly ramPct: number;
  readonly ramPctOneHostDown: number;
  /** Provisioned VM disk vs raw vSAN capacity (no storage policy / overhead modelled, 10 §6.4) – derived. */
  readonly diskPctOfRaw: number;
}

export interface ClusterUtilisation {
  readonly clusterId: string;
  readonly hostCount: number;
  readonly cores: number;
  readonly ramGB: number;
  readonly rawCapacityGB: number;
  /** Based on the per-VM sum (derived). */
  readonly perVm: Utilisation;
  /** Based on the planning total (documented base + increments) – only for a management primary cluster. */
  readonly planning?: Utilisation;
  /** vCPU:pCPU guidance applies (management domain, 10 §6.5); undefined for WLD ("case by case"). */
  readonly cpuGuidanceMaxRatio?: number;
  readonly derived: true;
}

const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 1000) / 10 : Infinity);
const ratio = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 100) / 100 : Infinity);

/** Raw capacity in GB, rounded to whole GB (float artefacts of TB sums). */
const rawGB = (hosts: readonly HostCapacity[]): number => Math.round(hosts.reduce((a, h) => a + h.rawCapacityTB, 0) * GB_PER_TB);

function utilisation(demand: Resources, hosts: readonly HostCapacity[]): Utilisation {
  const cores = hosts.reduce((a, h) => a + h.cores, 0);
  const ram = hosts.reduce((a, h) => a + h.ramGB, 0);
  const raw = rawGB(hosts);
  // One host down: remove the largest host (worst case).
  const maxCores = Math.max(0, ...hosts.map((h) => h.cores));
  const maxRam = Math.max(0, ...hosts.map((h) => h.ramGB));
  return {
    demand,
    vcpuPerCore: ratio(demand.vcpu, cores),
    vcpuPerCoreOneHostDown: ratio(demand.vcpu, cores - maxCores),
    ramPct: pct(demand.ramGB, ram),
    ramPctOneHostDown: pct(demand.ramGB, ram - maxRam),
    diskPctOfRaw: pct(demand.diskGB, raw),
  };
}

/**
 * Utilisation of one cluster. For the management domain primary cluster the planning demand (documented base +
 * WLD increments) is reported besides the per-VM sum; the CPU guidance 2:1 applies (10 §6.5).
 */
export function clusterUtilisation(
  fleet: Fleet,
  inv: FleetInventory,
  totals: FleetTotals,
  clusterId: string,
  hosts: readonly HostCapacity[],
): ClusterUtilisation {
  const vms = inv.vms.filter((v) => v.clusterId === clusterId);
  const perVm = sumVms(vms).perVm;
  const mgmt = fleet.instances.find((i) => i.managementDomain.clusters[0]?.id === clusterId);
  const mt = mgmt ? totals.managementDomains.find((m) => m.domainId === mgmt.managementDomain.id) : undefined;
  const isMgmt = fleet.instances.some((i) => i.managementDomain.clusters.some((c) => c.id === clusterId));
  return {
    clusterId,
    hostCount: hosts.length,
    cores: hosts.reduce((a, h) => a + h.cores, 0),
    ramGB: hosts.reduce((a, h) => a + h.ramGB, 0),
    rawCapacityGB: rawGB(hosts),
    perVm: utilisation(perVm, hosts),
    ...(mt ? { planning: utilisation(mt.planning, hosts) } : {}),
    ...(isMgmt ? { cpuGuidanceMaxRatio: MGMT_VCPU_PER_PCPU_GUIDANCE } : {}),
    derived: true,
  };
}

/**
 * Capacity checks of a management cluster (recommendations only – the documentation gives guidance, not a blocking
 * validation; 10 §8 q4).
 */
export function validateManagementCapacity(u: ClusterUtilisation, subject?: string): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const basis = u.planning ?? u.perVm;
  if (u.cpuGuidanceMaxRatio !== undefined && basis.vcpuPerCore > u.cpuGuidanceMaxRatio)
    out.push(issue('MGMT_CPU_OVERCOMMIT_ABOVE_GUIDANCE', 'recommendation', `Management domain vCPU:pCPU ${basis.vcpuPerCore}:1 is above 2:1. "While higher ratios such as 3:1 or 4:1 are supported, you must closely monitor CPU ready times".`, '10 §6.5 [P14]', subject ?? u.clusterId));
  if (basis.ramPct > 100 || basis.diskPctOfRaw > 100)
    out.push(issue('MGMT_DOMAIN_CAPACITY_EXCEEDED', 'recommendation', 'Management domain demand exceeds host RAM or raw storage. "You may need to expand the resources in the management domain …"', '40 §5 [W1]; 05-design [D9]', subject ?? u.clusterId));
  return out;
}

// ===========================================================================
// VM placement on hosts (GAME distribution)
// ===========================================================================

export interface VmPlacement {
  readonly vmId: string;
  readonly clusterId: string;
  readonly hostId: string;
}

export interface HostLoad {
  readonly hostId: string;
  readonly clusterId: string;
  readonly vmIds: readonly string[];
  /** Per-VM sums of placed VMs (undocumented sizes count as 0). */
  readonly load: Resources;
}

export interface PlacementResult {
  readonly placements: readonly VmPlacement[];
  readonly hosts: readonly HostLoad[];
  readonly issues: readonly ValidationIssue[];
  /** Not documented VCF behaviour: DRS decides at runtime. Spread of multi-node components is a game choice. */
  readonly scope: 'game-scope';
}

/**
 * Deterministic distribution of VMs on the hosts of their cluster ("which VM runs on which host" for the UI).
 * Game rules: nodes of one multi-node component are spread over different hosts where possible (anti-affinity is
 * documented for HA VCF Operations, 20 §4.4, and the HA runtime, 00 §6); otherwise the host with the least
 * allocated RAM, then the lowest index, wins.
 */
export function placeVms(fleet: Fleet, inv: FleetInventory): PlacementResult {
  const hostsByCluster = new Map<string, string[]>();
  for (const i of fleet.instances)
    for (const d of [i.managementDomain, ...i.workloadDomains]) for (const c of d.clusters) hostsByCluster.set(c.id, c.hosts.map((h) => h.id));
  const load = new Map<string, { vmIds: string[]; load: Resources; groups: Set<string> }>();
  const placements: VmPlacement[] = [];
  const issues: ValidationIssue[] = [];
  const missing = new Set<string>();
  for (const vm of inv.vms) {
    const hosts = hostsByCluster.get(vm.clusterId) ?? [];
    if (hosts.length === 0) {
      if (!missing.has(vm.clusterId))
        issues.push(issue('PLACEMENT_CLUSTER_NO_HOSTS', 'error', 'Cluster has no hosts to run its VMs.', '40 §6.5 (game placement)', vm.clusterId, 'game-scope'));
      missing.add(vm.clusterId);
      continue;
    }
    const group = `${vm.servesDomainId}|${vm.component}`;
    const state = (h: string) => {
      let s = load.get(h);
      if (!s) load.set(h, (s = { vmIds: [], load: ZERO, groups: new Set() }));
      return s;
    };
    const free = hosts.filter((h) => !state(h).groups.has(group));
    const pool = free.length > 0 ? free : hosts;
    let best = pool[0] as string;
    for (const h of pool) if (state(h).load.ramGB < state(best).load.ramGB) best = h;
    const s = state(best);
    s.vmIds.push(vm.id);
    s.groups.add(group);
    s.load = add(s.load, { vcpu: vm.vcpu ?? 0, ramGB: vm.ramGB ?? 0, diskGB: vm.diskGB ?? 0 });
    placements.push({ vmId: vm.id, clusterId: vm.clusterId, hostId: best });
  }
  const hostLoads: HostLoad[] = [];
  for (const [clusterId, hosts] of hostsByCluster)
    for (const h of hosts) {
      const s = load.get(h);
      hostLoads.push({ hostId: h, clusterId, vmIds: s?.vmIds ?? [], load: s?.load ?? ZERO });
    }
  return { placements, hosts: hostLoads, issues, scope: 'game-scope' };
}

// ===========================================================================
// Scenario presets (40 §6.5 scénáře 1–5) – pure data the engine can replay
// ===========================================================================

export type PresetNsx =
  | { readonly kind: 'dedicated'; readonly model: 'simple' | 'high-availability'; readonly applianceSize: NsxApplianceSize }
  | { readonly kind: 'shared-with-management' }
  | { readonly kind: 'shared-with-workload-domain'; readonly domainKey: string };

export interface PresetHosts {
  readonly count: number;
  /** Starter configuration id (hardwareCatalogCore STARTER_CONFIG_DEFS, 15 B.3). Choice of config = game. */
  readonly starterConfigId: string;
}

export interface PresetWorkloadDomain {
  readonly key: string;
  readonly name: string;
  readonly vcenterSize: VcenterSize;
  readonly nsx: PresetNsx;
  readonly hosts: PresetHosts;
  readonly supervisor: { readonly nodes: number; readonly size: SupervisorSize } | null;
  readonly connectivity: WldConnectivity;
}

export interface PresetInstance {
  readonly key: string;
  readonly name: string;
  readonly first: boolean;
  readonly profile: SizingProfile;
  /** Blueprint location of the hosts (06 §6.1). */
  readonly location: 'site' | 'region2';
  readonly managementHosts: PresetHosts;
  readonly workloadDomains: readonly PresetWorkloadDomain[];
}

export interface PresetExpectation {
  readonly instanceKey: string;
  /** VMs in the management domain (40 §6.5 "VM v mgmt domain"). */
  readonly mgmtDomainVms: number;
  /** "Součet per-VM" of the management domain base (derived, without License server). */
  readonly basePerVm: Resources;
  /** "Celkem (dokumentováno)" [W6]. */
  readonly documented: Resources;
  /** "Management domain celkem" incl. WLD increments (derived). */
  readonly mgmtPlanning: Resources;
}

export interface ScenarioPreset {
  readonly id: string;
  /** Order in the "Hotové scénáře" menu (CLAUDE.md: 1. nejmenší … 5. více instancí). */
  readonly scenario: 1 | 2 | 3 | 4 | 5;
  readonly title: string;
  readonly blueprintId: BlueprintId | null;
  readonly specRef: string;
  readonly instances: readonly PresetInstance[];
  /** Expected numbers from the spec tables (for tests / UI cross-check). */
  readonly expected: readonly PresetExpectation[];
  /** Expected fleet total (40 §6.5 scénář 5, derived from [W6]). */
  readonly expectedFleetPlanning?: Resources;
  readonly notes: readonly string[];
}

const R = (vcpu: number, ramGB: number, diskGB: number): Resources => ({ vcpu, ramGB, diskGB });
const HOST_CONFIG_NOTE = 'Server configuration is a game choice from the starter catalog (15 B.3); host counts per 10 §6.1 / 06 §6.1.';

const wld = (key: string, name: string, nsx: PresetNsx, extra: Partial<PresetWorkloadDomain> = {}): PresetWorkloadDomain => ({
  key,
  name,
  vcenterSize: 'Medium',
  nsx,
  hosts: { count: 4, starterConfigId: 'dell-r670-med' },
  supervisor: { nodes: 1, size: 'Small' },
  connectivity: { kind: 'none' },
  ...extra,
});

const HA_NSX_MEDIUM: PresetNsx = { kind: 'dedicated', model: 'high-availability', applianceSize: 'Medium' };
const S3_CLUSTER: Partial<PresetWorkloadDomain> = { connectivity: { kind: 'edge', nodes: 2, size: 'Large' } };
const MGMT_HA_MEDIUM_DOC = R(184, 656, 11445);
const MGMT_HA_MEDIUM_PERVM = R(182, 652, 10133);

const mgmtInst = (profile: SizingProfile, hosts: PresetHosts, wlds: readonly PresetWorkloadDomain[] = []): PresetInstance => ({
  key: 'i1',
  name: 'instance-1',
  first: true,
  profile,
  location: 'site',
  managementHosts: hosts,
  workloadDomains: wlds,
});

/** 40 §6.5 – scenarios 1–5 with variants (2: HA Small/Medium/Large; 3: dedicated/shared NSX; 4a–4c). */
export const SCENARIO_PRESETS: readonly ScenarioPreset[] = [
  {
    id: 's1-minimal-simple',
    scenario: 1,
    title: 'Nejmenší nasazení – vše Simple',
    blueprintId: 'vcf-fleet-single-site-minimal-footprint',
    specRef: '40 §6.5 scénář 1; 06 §2.1 [B3][B4]',
    instances: [mgmtInst('simple', { count: 3, starterConfigId: 'dell-r670-med' })],
    expected: [{ instanceKey: 'i1', mgmtDomainVms: 10, basePerVm: R(74, 247, 6086), documented: R(76, 251, 7448), mgmtPlanning: R(76, 251, 7448) }],
    notes: ['Day-N blueprint options (Ops for Networks, Log Management, Supervisor CP) are not in the totals (40 §6.5).', HOST_CONFIG_NOTE],
  },
  {
    id: 's2-ha-small',
    scenario: 2,
    title: 'HA instalace – HA Small',
    blueprintId: null,
    specRef: '40 §6.5 scénář 2',
    instances: [mgmtInst('ha-small', { count: 4, starterConfigId: 'hpe-dl380g12-med' })],
    expected: [{ instanceKey: 'i1', mgmtDomainVms: 16, basePerVm: R(104, 331, 7360), documented: R(106, 335, 8422), mgmtPlanning: R(106, 335, 8422) }],
    notes: ['VCF Automation 1× Medium as on [W6] (40 §8 q4).', HOST_CONFIG_NOTE],
  },
  {
    id: 's2-ha-medium',
    scenario: 2,
    title: 'HA instalace – HA Medium',
    blueprintId: null,
    specRef: '40 §6.5 scénář 2',
    instances: [mgmtInst('ha-medium', { count: 4, starterConfigId: 'hpe-dl380g12-med' })],
    expected: [{ instanceKey: 'i1', mgmtDomainVms: 19, basePerVm: MGMT_HA_MEDIUM_PERVM, documented: MGMT_HA_MEDIUM_DOC, mgmtPlanning: MGMT_HA_MEDIUM_DOC }],
    notes: [HOST_CONFIG_NOTE],
  },
  {
    id: 's2-ha-large',
    scenario: 2,
    title: 'HA instalace – HA Large',
    blueprintId: null,
    specRef: '40 §6.5 scénář 2',
    instances: [mgmtInst('ha-large', { count: 4, starterConfigId: 'hpe-dl380g12-lrg' })],
    expected: [{ instanceKey: 'i1', mgmtDomainVms: 20, basePerVm: R(296, 945, 12185), documented: R(298, 949, 15357), mgmtPlanning: R(298, 949, 15357) }],
    notes: ['4 workers ([W6]); workbook lists 3 (40 §6.5 pozn. ⁴, §8 q2).', HOST_CONFIG_NOTE],
  },
  {
    id: 's3-wld-dedicated-nsx',
    scenario: 3,
    title: 'Management + workload doména (dedikovaný HA NSX)',
    blueprintId: 'vcf-fleet-single-site',
    specRef: '40 §6.5 scénář 3; 06 §2.2 [B6][B7]',
    instances: [mgmtInst('ha-medium', { count: 4, starterConfigId: 'len-sr650v4-lrg' }, [wld('w01', 'wld01', HA_NSX_MEDIUM, S3_CLUSTER)])],
    expected: [{ instanceKey: 'i1', mgmtDomainVms: 23, basePerVm: MGMT_HA_MEDIUM_PERVM, documented: MGMT_HA_MEDIUM_DOC, mgmtPlanning: R(210, 758, 13278) }],
    notes: [
      'WLD cluster = example of 40 §6.5 scénář 3: 1 Supervisor CP Small + 2 Edge Large (20 vCPU / 80 GB / 448 GB).',
      'Blueprint "ESX: 4 nodes" does not split mgmt / WLD (40 §8 q7): 4 mgmt + 4 WLD hosts (vSAN HA minimum, 40 §6.2).',
      'Edge size / count for "Host Fault Tolerant NSX Edge Cluster" not documented (40 §8 q8).',
      HOST_CONFIG_NOTE,
    ],
  },
  {
    id: 's3-wld-shared-nsx',
    scenario: 3,
    title: 'Management + workload doména (NSX sdílený s management doménou)',
    blueprintId: 'vcf-fleet-single-site',
    specRef: '40 §6.5 scénář 3; 40 §2.2 [9.1]',
    instances: [mgmtInst('ha-medium', { count: 4, starterConfigId: 'len-sr650v4-lrg' }, [wld('w01', 'wld01', { kind: 'shared-with-management' }, S3_CLUSTER)])],
    expected: [{ instanceKey: 'i1', mgmtDomainVms: 20, basePerVm: MGMT_HA_MEDIUM_PERVM, documented: MGMT_HA_MEDIUM_DOC, mgmtPlanning: R(192, 686, 12378) }],
    notes: ['[9.1] only – 9.0 does not allow sharing the management NSX (40 §2.2).', HOST_CONFIG_NOTE],
  },
  {
    id: 's4a-two-wld-dedicated-nsx',
    scenario: 4,
    title: 'Dvě workload domény – každá vlastní HA NSX',
    blueprintId: 'vcf-fleet-single-site',
    specRef: '40 §6.5 scénář 4a',
    instances: [mgmtInst('ha-medium', { count: 4, starterConfigId: 'len-sr650v4-lrg' }, [wld('w01', 'wld01', HA_NSX_MEDIUM), wld('w02', 'wld02', HA_NSX_MEDIUM)])],
    expected: [{ instanceKey: 'i1', mgmtDomainVms: 27, basePerVm: MGMT_HA_MEDIUM_PERVM, documented: MGMT_HA_MEDIUM_DOC, mgmtPlanning: R(236, 860, 15111) }],
    notes: ['WLD clusters: default Supervisor (1 CP VM, Small = VPC minimum), no Edge / VNA – scénář 4 lists only the management domain.', HOST_CONFIG_NOTE],
  },
  {
    id: 's4b-two-wld-shared-wld-nsx',
    scenario: 4,
    title: 'Dvě workload domény – sdílený NSX první WLD',
    blueprintId: 'vcf-fleet-single-site',
    specRef: '40 §6.5 scénář 4b',
    instances: [
      mgmtInst('ha-medium', { count: 4, starterConfigId: 'len-sr650v4-lrg' }, [
        wld('w01', 'wld01', HA_NSX_MEDIUM),
        wld('w02', 'wld02', { kind: 'shared-with-workload-domain', domainKey: 'w01' }),
      ]),
    ],
    expected: [{ instanceKey: 'i1', mgmtDomainVms: 24, basePerVm: MGMT_HA_MEDIUM_PERVM, documented: MGMT_HA_MEDIUM_DOC, mgmtPlanning: R(218, 788, 14211) }],
    notes: [HOST_CONFIG_NOTE],
  },
  {
    id: 's4c-two-wld-shared-mgmt-nsx',
    scenario: 4,
    title: 'Dvě workload domény – sdílený NSX management domény',
    blueprintId: 'vcf-fleet-single-site',
    specRef: '40 §6.5 scénář 4c; [9.1]',
    instances: [
      mgmtInst('ha-medium', { count: 4, starterConfigId: 'len-sr650v4-lrg' }, [
        wld('w01', 'wld01', { kind: 'shared-with-management' }),
        wld('w02', 'wld02', { kind: 'shared-with-management' }),
      ]),
    ],
    expected: [{ instanceKey: 'i1', mgmtDomainVms: 21, basePerVm: MGMT_HA_MEDIUM_PERVM, documented: MGMT_HA_MEDIUM_DOC, mgmtPlanning: R(200, 716, 13311) }],
    notes: [HOST_CONFIG_NOTE],
  },
  {
    id: 's5-two-instances',
    scenario: 5,
    title: 'Více VCF instancí (dva regiony)',
    blueprintId: 'vcf-fleet-across-multiple-regions',
    specRef: '40 §6.5 scénář 5; 06 §2.4 [B16][B17]',
    instances: [
      { ...mgmtInst('ha-medium', { count: 4, starterConfigId: 'dell-r670-med' }), name: 'region1-instance' },
      {
        key: 'i2',
        name: 'region2-instance',
        first: false,
        profile: 'ha-medium',
        location: 'region2',
        managementHosts: { count: 4, starterConfigId: 'dell-r670-med' },
        workloadDomains: [],
      },
    ],
    expected: [
      { instanceKey: 'i1', mgmtDomainVms: 19, basePerVm: MGMT_HA_MEDIUM_PERVM, documented: MGMT_HA_MEDIUM_DOC, mgmtPlanning: MGMT_HA_MEDIUM_DOC },
      { instanceKey: 'i2', mgmtDomainVms: 11, basePerVm: R(74, 244, 4513), documented: R(74, 244, 5813), mgmtPlanning: R(74, 244, 5813) },
    ],
    expectedFleetPlanning: R(258, 900, 17258),
    notes: ['Instance 2: 2 workers ([W6]); workbook lists 3 (40 §6.5 pozn. ⁶, §8 q2).', HOST_CONFIG_NOTE],
  },
];

export interface PresetBuild {
  readonly fleet: Fleet;
  readonly options: InventoryOptions;
  /** host id -> starter configuration id. */
  readonly hostConfigs: Readonly<Record<string, string>>;
}

const comp = (kind: ComponentKind, nodes: number, size?: string): DeployedComponent => ({ kind, nodes, ...(size !== undefined ? { size } : {}) });

/** Management-domain components a full deployment of the profile contains (00 §2.1/§2.3, bringup.ts managementDomainComponentsFor). */
function presetMgmtComponents(first: boolean, profile: SizingProfile): DeployedComponent[] {
  const p = profileComposition(first ? 'first' : 'additional', profile);
  const out: DeployedComponent[] = [comp('sddc-manager', 1, p.sddcManager.size), comp('cloud-proxy', 1, p.cloudProxy.size)];
  if (first) {
    if (p.vcfOperations) out.push(comp('vcf-operations', p.vcfOperations.nodes, p.vcfOperations.size));
    if (p.licenseServer) out.push(comp('license-server', 1, p.licenseServer.size));
    if (p.vcfAutomation) out.push(comp('vcf-automation', p.vcfAutomation.nodes, p.vcfAutomation.size));
  }
  out.push(comp('vcf-services-runtime', p.runtimeControlPlane.nodes + p.runtimeWorker.nodes));
  const services: ComponentKind[] = first
    ? ['fleet-lifecycle', 'sddc-lifecycle', 'software-depot', 'identity-broker', 'salt-raas', 'salt-master', 'telemetry']
    : ['sddc-lifecycle', 'salt-master', 'telemetry'];
  for (const k of services) out.push(comp(k, 1));
  return out;
}

/** Builds a Fleet + inventory options from a preset (pure, deterministic ids). */
export function buildPresetFleet(preset: ScenarioPreset): PresetBuild {
  const hostConfigs: Record<string, string> = {};
  const wldOptions: Record<string, WorkloadDomainOptions> = {};
  const profiles: Record<string, SizingProfile> = {};
  const hosts = (clusterId: string, h: PresetHosts) =>
    Array.from({ length: h.count }, (_, i) => {
      const id = `${clusterId}-esx${pad2(i + 1)}`;
      hostConfigs[id] = h.starterConfigId;
      return { id, fqdn: `${id}.vcf.example` };
    });
  const cluster = (id: string, h: PresetHosts) => ({ id, name: id, model: 'single-rack' as const, haEnabled: true, drsEnabled: true, distributedSwitchCount: 1, hosts: hosts(id, h) });
  const instances: Instance[] = preset.instances.map((pi) => {
    const p = profileComposition(pi.first ? 'first' : 'additional', pi.profile);
    const mgmtId = `${pi.key}-m01`;
    profiles[pi.key] = pi.profile;
    const managementDomain: Domain = {
      id: mgmtId,
      name: `${pi.key}-m01`,
      kind: 'management',
      vcenter: comp('vcenter', 1, p.vcenter),
      nsx: { mode: 'dedicated', model: pi.profile === 'simple' ? 'simple' : 'high-availability' },
      clusters: [cluster(`${mgmtId}-cl01`, pi.managementHosts)],
      components: presetMgmtComponents(pi.first, pi.profile),
    };
    const workloadDomains: Domain[] = pi.workloadDomains.map((w) => {
      const id = `${pi.key}-${w.key}`;
      wldOptions[id] = { vcenterSize: w.vcenterSize, supervisor: w.supervisor, connectivity: w.connectivity, ...(w.nsx.kind === 'dedicated' ? { nsxApplianceSize: w.nsx.applianceSize } : {}) };
      return {
        id,
        name: w.name,
        kind: 'workload',
        vcenter: comp('vcenter', 1, w.vcenterSize),
        nsx:
          w.nsx.kind === 'dedicated'
            ? { mode: 'dedicated', model: w.nsx.model }
            : { mode: 'shared', sharedWithDomainId: w.nsx.kind === 'shared-with-management' ? mgmtId : `${pi.key}-${w.nsx.domainKey}` },
        clusters: [cluster(`${id}-cl01`, w.hosts)],
        components: [],
      };
    });
    return { id: pi.key, name: pi.name, isFirstInstance: pi.first, managementDomain, workloadDomains, version: '9.1.1' };
  });
  return {
    fleet: { id: `fleet-${preset.id}`, name: preset.title, instances, standaloneVcenters: [] },
    options: { profiles, workloadDomains: wldOptions },
    hostConfigs,
  };
}

export const presetById = (id: string): ScenarioPreset | undefined => SCENARIO_PRESETS.find((p) => p.id === id);
