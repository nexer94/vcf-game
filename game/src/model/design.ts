/**
 * Sandbox design phase ("Návrh") – VCF 9.1.1.
 * Source of truth: docs/spec/05-design.md (references like "05 §4.5 [D13]" point to sections / sources there).
 * Host minimums come from docs/spec/10-planning.md §6.1 (via bringup.minManagementDefaultClusterHosts),
 * fleet topology tables from docs/spec/00-architektura.md §6.
 *
 * What this module provides:
 *  - DESIGN_DECISIONS: ordered design decisions (order = 05 §4.10, a game order, not a documented one –
 *    05 §4: "Dokumentace nedefinuje závazné pořadí"), their options, applicable design requirement /
 *    recommendation IDs (05 §6.2) and documented consequences.
 *  - DESIGN_CONSTRAINTS: dependencies between decisions as pure checks.
 *  - validateDesign(), optionAvailability(), validateRedesign().
 *  - deriveBringupParams(): inputs for the bring-up model (validateManagementHostCount, wizard steps 5–7, 15).
 *  - summarizeDesign(): minimum hosts, domains, component node counts, collected consequences.
 *
 * Severity policy (05 §5 column "Typ (pro hru)", 20 §5.1 semantics in validation.ts):
 *  - error   = requirement (REQD) violated, documented as "Non Supported"/not available, or not possible
 *              at Day 0 (marked "Day 2"). Blocks proceeding.
 *  - warning = deviation from a documented recommendation with an ID (RCMD / RECD). The player may accept it;
 *              the message names the recommendation and its documented justification / implication.
 *  - Recommendations without an ID (e.g. "High Availability is recommended for production environments.")
 *    are NOT issues; they are listed as consequences of kind 'recommendation'.
 *
 * Text conventions: quotes from the documentation are English and marked `quote: true`. Items the spec marks
 * *(parafráze)* carry `paraphrased: true`. Czech texts are game descriptions of documented facts.
 *
 * Pure TypeScript: no DOM, no PixiJS, no randomness, no time.
 */
import {
  type ClusterModel,
  type DistributedSwitchModel,
  type FleetDesign,
  type ManagementNetworkModel,
  type NsxManagerModel,
  type SsoModel,
  type VcfMinorVersion,
  FLEET_DESIGN_CLUSTER_MODELS,
  NSX_MANAGER_NODES,
} from './architecture';
import {
  type DeploymentModel,
  type DeploymentSize,
  type NetworkConfiguration,
  type StorageType,
  type VdsProfile,
  ALLOWED_SIZES,
  minManagementDefaultClusterHosts,
} from './bringup';
import { type ValidationIssue, hasErrors, issue } from './validation';

// ===========================================================================
// Sources (05 §9; extra keys from 00 §9 and 10 §9 where 05 refers to them)
// ===========================================================================

export interface DesignSource {
  readonly title: string;
  readonly url: string;
  /** Spec file that lists the source. */
  readonly spec: '05-design' | '10-planning' | '00-architektura';
}

const TD = 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later';

export const DESIGN_SOURCES = {
  D1: { spec: '05-design', title: 'Design (9.1)', url: `${TD}/9-1/design.html` },
  D2: { spec: '05-design', title: 'Architectural Options in VMware Cloud Foundation (9.1)', url: `${TD}/9-1/design/vmware-cloud-foundation-concepts.html` },
  D5: { spec: '05-design', title: 'Management Domain Model (9.1)', url: `${TD}/9-1/design/design-library/workload-domain-deployment-models/management-domain-deployment-model.html` },
  D6: { spec: '05-design', title: 'Workload Domain Model (9.1)', url: `${TD}/9-1/design/design-library/workload-domain-deployment-models/workload-domain-deployment-model.html` },
  D7: { spec: '05-design', title: 'Management Domain Model (9.0)', url: `${TD}/9-0/design/design-library/workload-domain-deployment-models/management-domain-deployment-model.html` },
  D9: { spec: '05-design', title: 'VCF Domain Models (9.1)', url: `${TD}/9-1/design/vmware-cloud-foundation-concepts/design-guide-vmware-cloud-foundation-architecture-models.html` },
  D10: { spec: '05-design', title: 'VCF Domain Models (9.0)', url: `${TD}/9-0/design/vmware-cloud-foundation-concepts/design-guide-vmware-cloud-foundation-architecture-models.html` },
  D11: { spec: '05-design', title: 'VCF Fleet Deployment Models (9.1)', url: `${TD}/9-1/design/vmware-cloud-foundation-concepts/vcf-operations-deployment-models.html` },
  D12: { spec: '05-design', title: 'VCF Fleet Sizing Models (9.1)', url: `${TD}/9-1/design/vmware-cloud-foundation-concepts/vcf-fleet-sizing-models-9-x.html` },
  D13: { spec: '05-design', title: 'Storage Models (9.1)', url: `${TD}/9-1/design/vmware-cloud-foundation-concepts/storage-models.html` },
  D14: { spec: '05-design', title: 'Network Consumption Models (9.1)', url: `${TD}/9-1/design/vmware-cloud-foundation-concepts/network-backing-models.html` },
  D15: { spec: '05-design', title: 'Distributed Switch Models (9.1)', url: `${TD}/9-1/design/vmware-cloud-foundation-concepts/cluster-network-deployment-models.html` },
  D16: { spec: '05-design', title: 'VCF Management Network Models (9.1)', url: `${TD}/9-1/design/vmware-cloud-foundation-concepts/fleet-level-component-backing-networking-models.html` },
  D17: { spec: '05-design', title: 'VCF Operations Models (9.1)', url: `${TD}/9-1/design/vmware-cloud-foundation-concepts/vcf-operations.html` },
  D18: { spec: '05-design', title: 'Single-Rack vSphere Cluster Model (9.1)', url: `${TD}/9-1/design/design-library/cluster-models/single-instance-single-availability-zone.html` },
  D19: { spec: '05-design', title: 'Simple NSX Manager Model (9.1)', url: `${TD}/9-1/design/design-library/nsx-management-and-control-plane-detailed-design/simple-nsx-manager-model.html` },
  D20: { spec: '05-design', title: 'High Availability NSX Manager Model (9.1)', url: `${TD}/9-1/design/design-library/nsx-management-and-control-plane-detailed-design/high-availability-nsx-manager-model.html` },
  D22: { spec: '05-design', title: 'Simple VCF Management Services Model (9.1)', url: `${TD}/9-1/design/design-library/vcf-management-services-availabilty-detailed-design/vcf-management-services-simple-deployment-model.html` },
  D23: { spec: '05-design', title: 'High Availability VCF Management Services Model (9.1)', url: `${TD}/9-1/design/design-library/vcf-management-services-availabilty-detailed-design/vcf-management-services-high-availability-deployment-model.html` },
  D24: { spec: '05-design', title: 'Simple VCF Operations Model (9.1)', url: `${TD}/9-1/design/design-library/vcf-operations-design/simple-vcf-operations-model1.html` },
  D25: { spec: '05-design', title: 'High Availability VCF Operations Model (9.1)', url: `${TD}/9-1/design/design-library/vcf-operations-design/vcf-operations-ha-model.html` },
  D26: { spec: '05-design', title: 'VCF Operations Detailed Design (9.1)', url: `${TD}/9-1/design/design-library/vcf-operations-design.html` },
  D27: { spec: '05-design', title: 'Simple VCF Automation Model (9.1)', url: `${TD}/9-1/design/design-library/vcf-automation-deployment-models-9-x/vcf-automation-simple-deployment-model.html` },
  D28: { spec: '05-design', title: 'High Availability VCF Automation Model (9.1)', url: `${TD}/9-1/design/design-library/vcf-automation-deployment-models-9-x/vcf-automation-high-availability-deployment-model.html` },
  D29: { spec: '05-design', title: 'VCF Automation Detailed Design (9.1)', url: `${TD}/9-1/design/design-library/vcf-automation-deployment-models-9-x.html` },
  D30: { spec: '05-design', title: 'VCF Single Sign-On Detailed Design (9.1)', url: `${TD}/9-1/design/design-library/single-sign-on-models.html` },
  D31: { spec: '05-design', title: 'Identity Broker Detailed Design (9.1)', url: `${TD}/9-1/design/design-library/single-sign-on-instance-models.html` },
  D32: { spec: '05-design', title: 'Embedded Identity Broker Model (9.1)', url: `${TD}/9-1/design/design-library/single-sign-on-instance-models/embedded-vidb.html` },
  D33: { spec: '05-design', title: 'Instance Identity Broker Model (9.1)', url: `${TD}/9-1/design/design-library/single-sign-on-instance-models/external-vidb.html` },
  D35: { spec: '05-design', title: 'VCF Fleet in a Single Site with Minimal Footprint (9.1)', url: `${TD}/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-with-minimal-footprint-blueprint.html` },
  D38: { spec: '05-design', title: 'VCF Fleet in a Single Site (9.1)', url: `${TD}/9-1/design/design-blueprints-for/infrastructure-modernization/vcf-fleet-in-a-single-site-blueprint.html` },
  D39: { spec: '05-design', title: 'Deploy a New VCF Fleet or a New VCF Instance (9.1)', url: `${TD}/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-a-new-vcf-fleet-or-a-new-vcf-instance.html` },
  D40: { spec: '05-design', title: 'KB 459019 – Migrating VCF Automation 9.0.x from Workload Domain to Management Domain after VCF Operations 9.1 Upgrade', url: 'https://knowledge.broadcom.com/external/article/459019' },
  D41: { spec: '05-design', title: 'VCF Taxonomy (9.1)', url: `${TD}/9-1/overview-of-vmware-cloud-foundation-9/workload-domains-in-vmware-cloud-foundation.html` },
  D42: { spec: '05-design', title: 'VCF Taxonomy (9.0)', url: `${TD}/9-0/overview-of-vmware-cloud-foundation-9/workload-domains-in-vmware-cloud-foundation.html` },
  D43: { spec: '05-design', title: 'vSphere Cluster Detailed Design (9.1)', url: `${TD}/9-1/design/design-library/cluster-models.html` },
  // 00-architektura [S7] – vSphere Cluster Models (referenced by 05 §2.1 / §4.4 via "00 6").
  S7: { spec: '00-architektura', title: 'vSphere Cluster Models (9.1)', url: `${TD}/9-1/design/vmware-cloud-foundation-concepts/vsphere-cluster-models.html` },
  // 10-planning [P11]–[P13] – cluster model host minimums (referenced by 05 §4.4 via "10 6.1").
  P11: { spec: '10-planning', title: 'Multi-Rack Layer 2 vSphere Cluster Model (9.1)', url: `${TD}/9-1/design/design-library/cluster-models/multi-rack-cluster-detailed-design/layer-2-multi-rack-cluster.html` },
  P12: { spec: '10-planning', title: 'Multi-Rack Layer 3 vSphere Cluster Model (9.1)', url: `${TD}/9-1/design/design-library/cluster-models/layer-3-multi-rack-cluster.html` },
  P13: { spec: '10-planning', title: 'Stretched vSphere Cluster Model (9.1)', url: `${TD}/9-1/design/design-library/cluster-models/single-instance-multiple-availability-zones.html` },
} as const satisfies Record<string, DesignSource>;

export type DesignSourceId = keyof typeof DESIGN_SOURCES;

/** {title, url} for a source – directly usable as the UI `DocRef`. */
export function docRefOf(id: DesignSourceId): { readonly title: string; readonly url: string } {
  const s = DESIGN_SOURCES[id];
  return { title: s.title, url: s.url };
}

// ===========================================================================
// Design requirements / recommendations (05 §6.2; VCF-CLS-MR-… from 10 §6.1)
// ===========================================================================

/** `REQD` = Design Requirement, `RCMD` = Design Recommendation, `RECD` = RCMD variant on VCF Operations pages (05 §6.2). */
export type DesignRuleKind = 'REQD' | 'RCMD' | 'RECD';

export interface DesignRule {
  readonly id: string;
  readonly kind: DesignRuleKind;
  /** Verbatim text unless `paraphrased` / `truncated`. */
  readonly text: string;
  readonly versions: readonly VcfMinorVersion[];
  readonly sources: readonly DesignSourceId[];
  readonly paraphrased?: true;
  /** The spec shows the text shortened ("…", "zkráceno"). */
  readonly truncated?: true;
  /** Documented justification / implication relevant to the game (quotes). */
  readonly justification?: readonly string[];
  readonly implication?: readonly string[];
}

/** Parses the kind from an ID of the form VCF-<area>-<REQD|RCMD|RECD>-<category>-<NNN> (05 §6.2). */
export function ruleKindOf(id: string): DesignRuleKind | undefined {
  const m = /-(REQD|RCMD|RECD)-/.exec(id);
  return m ? (m[1] as DesignRuleKind) : undefined;
}

type RuleInput = Omit<DesignRule, 'id' | 'kind'>;
const rule = (id: string, r: RuleInput): DesignRule => {
  const kind = ruleKindOf(id);
  if (!kind) throw new Error(`Invalid design rule id ${id}`);
  return { id, kind, ...r };
};
const V91: readonly VcfMinorVersion[] = ['9.1'];
const V90_91: readonly VcfMinorVersion[] = ['9.0', '9.1'];

const RULE_LIST: readonly DesignRule[] = [
  rule('VCF-WLD-REQD-CFG-001', {
    text: 'Deploy a management domain to host all management components for the VCF Instance.',
    versions: V90_91, sources: ['D5', 'D7'],
    justification: ['Enables the use of dedicated physical compute, network, and storage separately from those used for additional workloads.'],
    implication: ['The management components for all greenfield VCF domains are deployed to the same cluster, and share the same subnet.'],
  }),
  rule('VCF-WLD-RCMD-CFG-001', {
    text: 'If running business workloads in the management domain, configure the following vSphere resource pools … to control resource usage by management and business workloads.',
    versions: ['9.0'], sources: ['D7'], truncated: true,
    implication: ['You must manually create the vSphere resource pools and manage their settings over time.'],
  }),
  rule('VCF-WLD-RCMD-CFG-002', {
    text: 'Use workload domains for customer workloads.',
    versions: V90_91, sources: ['D6'],
    justification: [
      'Aligns with the VMware best practice of separating management workloads from customer workloads.',
      'Provides better long-term flexibility and expansion options.',
    ],
    implication: ['Requires additional hardware.'],
  }),
  rule('VCF-MGMT-RCMD-NSX-001', { text: 'Use a dedicated NSX Manager instance for the management domain.', versions: V91, sources: ['D5'] }),
  rule('VCF-WLD-RCMD-NSX-002', { text: 'Use a dedicated or shared NSX Manager instance for the workload domain.', versions: V91, sources: ['D6'] }),
  rule('VCF-CLS-REQD-CFG-001', { text: 'Create a vSphere cluster in each VCF domain for the initial set of ESX hosts.', versions: V91, sources: ['D18'] }),
  rule('VCF-CLS-REQD-CFG-002', { text: 'Allocate the minimum number of ESX hosts according to the vSphere cluster type being deployed.', versions: V91, sources: ['D18'] }),
  rule('VCF-CLS-REQD-CFG-003', { text: 'Use vSphere Lifecycle Manager images as the lifecycle management method for all vSphere clusters.', versions: V91, sources: ['D18'] }),
  rule('VCF-CLS-REQD-CFG-004', { text: 'Use vSphere HA to protect all virtual machines against failures.', versions: V91, sources: ['D18'] }),
  rule('VCF-CLS-RCMD-CFG-001', { text: 'Configure admission control for one (1) ESX host failure and percentage-based failover capacity.', versions: V91, sources: ['D18'] }),
  rule('VCF-CLS-RCMD-CFG-002', { text: 'Enable VM Monitoring for each vSphere cluster.', versions: V91, sources: ['D18'] }),
  rule('VCF-CLS-RCMD-CFG-003', { text: 'Enable vSphere DRS on all vSphere clusters, using the default fully automated mode with medium threshold.', versions: V91, sources: ['D18'] }),
  rule('VCF-CLS-RCMD-CFG-004', { text: 'Enable Enhanced vMotion Compatibility on all vSphere clusters in the management domain.', versions: V91, sources: ['D18'] }),
  rule('VCF-CLS-RCMD-CFG-006', { text: 'Set the Enhanced vMotion Compatibility mode on a vSphere cluster to the highest available baseline …', versions: V91, sources: ['D18'], truncated: true }),
  // 10 §6.1 [P11]: "Doporučeno: vSAN ESA jako principal storage (VCF-CLS-MR-RCMD-CFG-002)" – paraphrase.
  rule('VCF-CLS-MR-RCMD-CFG-002', { text: '(paraphrase) Use vSAN ESA as principal storage for the Multi-Rack Layer 2 vSphere cluster model.', versions: V91, sources: ['P11'], paraphrased: true }),
  rule('VCF-NSX-LM-REQD-CFG-001', { text: 'Place the appliances of the NSX Manager cluster on the VM management network in the management domain.', versions: V91, sources: ['D19', 'D20'] }),
  rule('VCF-NSX-LM-REQD-CFG-004', { text: 'Deploy a single NSX Manager node in the management domain default vSphere cluster …', versions: V91, sources: ['D19'], truncated: true }),
  rule('VCF-NSX-LM-REQD-CFG-005', { text: 'Deploy three (3) NSX Manager nodes in the management domain default vSphere cluster…', versions: V91, sources: ['D20'], truncated: true }),
  rule('VCF-NSX-LM-RCMD-CFG-003', { text: 'Apply VM-VM anti-affinity rules in vSphere DRS to the NSX Manager appliances.', versions: V91, sources: ['D20'] }),
  rule('VCF-MS-REQD-COM-001', { text: 'Allocate a sufficient IP range for the required number of control plane and worker nodes for your chosen deployment type.', versions: V91, sources: ['D22', 'D23'] }),
  rule('VCF-MS-REQD-COM-002', { text: 'Use Kubernetes Cluster API Provider vSphere (CAPV) node anti-affinity to ensure the nodes run on different ESX hosts.', versions: V91, sources: ['D22', 'D23'] }),
  rule('VCF-MS-REQD-COM-003', { text: 'Protect the VCF management services nodes by using vSphere HA.', versions: V91, sources: ['D22', 'D23'] }),
  rule('VCF-MS-REQD-SIM-001', {
    text: 'Deploy VCF management services with a single control plane node and three worker nodes in the default management vSphere cluster.',
    versions: V91, sources: ['D22'],
    implication: ['Loss of the single control plane node would result in a need to redeploy the cluster and restore from backup.'],
  }),
  rule('VCF-MS-REQD-HA-001', { text: 'Deploy VCF management services in high availability mode with three (3) control plane nodes and the corresponding number of worker nodes in the default management vSphere cluster.', versions: V91, sources: ['D23'] }),
  rule('VCF-OPS-REQD-SIM-001', { text: 'Deploy VCF Operations as a single node in the default management vSphere cluster.', versions: V91, sources: ['D24'] }),
  rule('VCF-OPS-REQD-COM-001', { text: 'Deploy the fleet management component in the VCF management services in default management cluster.', versions: V91, sources: ['D24'] }),
  rule('VCF-OPS-REQD-COM-003', { text: 'Deploy a single cloud proxy appliance in the default management vSphere cluster.', versions: V91, sources: ['D24'] }),
  rule('VCF-OPS-REQD-HA-001', { text: '(paraphrase) Three-node VCF Operations cluster in the default management vSphere cluster.', versions: V91, sources: ['D25'], paraphrased: true }),
  rule('VCF-OPS-REQD-HA-003', { text: '(paraphrase) DRS anti-affinity for VCF Operations nodes – requires at least 4 ESX hosts in the default management cluster.', versions: V91, sources: ['D25'], paraphrased: true }),
  rule('VCF-AUTO-REQD-SIM-001', { text: 'Deploy VCF Automation as a single node in the default management domain vSphere cluster.', versions: V91, sources: ['D27'] }),
  rule('VCF-AUTO-REQD-SIM-002', { text: 'Protect the VCF Automation node using vSphere HA.', versions: V91, sources: ['D27'] }),
  rule('VCF-AUTO-REQD-HA-001', { text: 'Deploy VCF Automation as a three node cluster.', versions: V91, sources: ['D28'] }),
  rule('VCF-AUTO-REQD-HA-003', { text: 'Protect all VCF Automation nodes using vSphere HA.', versions: V91, sources: ['D28'] }),
  rule('VCF-SSO-REQD-EMB-001', { text: 'Use the embedded identity broker in the first management domain vCenter.', versions: V91, sources: ['D32'] }),
  rule('VCF-SSO-REQD-EMB-002', { text: 'Connect the embedded identity broker to your corporate IdP.', versions: V91, sources: ['D32'] }),
  rule('VCF-SSO-REQD-EXT-001', { text: 'Deploy additional identity broker instances as a Day N operation as needed.', versions: V91, sources: ['D33'] }),
  rule('VCF-SSO-REQD-EXT-002', { text: 'Connect the identity broker service to your corporate IdP.', versions: V91, sources: ['D33'] }),
];

export const DESIGN_RULES: Readonly<Record<string, DesignRule>> = Object.fromEntries(RULE_LIST.map((r) => [r.id, r]));

// ===========================================================================
// Decisions and options
// ===========================================================================

export const DESIGN_DECISION_IDS = [
  'fleet-deployment-model',
  'workload-placement',
  'wld-nsx-consumption',
  'deployment-model',
  'deployment-size',
  'mgmt-cluster-model',
  'wld-cluster-model',
  'principal-storage',
  'distributed-switch-model',
  'management-network-model',
  'wld-network-type',
  'network-consumption-model',
  'vpc-network-type',
  'vpc-gateway-connectivity',
  'vcf-operations-model',
  'vcf-automation-model',
  'vcf-automation-placement',
  'identity-broker-model',
  'sso-model',
] as const;
export type DesignDecisionId = (typeof DESIGN_DECISION_IDS)[number];

export type ConsequenceKind =
  | 'benefit'
  | 'implication'
  | 'requirement'
  | 'recommendation'
  | 'hardware'
  | 'day2'
  | 'irreversible'
  | 'limit';

export interface DesignConsequence {
  readonly kind: ConsequenceKind;
  readonly text: string;
  /** True = verbatim English quote from the documentation (may be shortened with "…"). */
  readonly quote: boolean;
  readonly sources: readonly DesignSourceId[];
  readonly paraphrased?: true;
  /** Open question in the spec (e.g. "05 §8 q4") – the UI should show it as unverified. */
  readonly openQuestion?: string;
}

export interface DesignRuleRef {
  readonly id: string;
  /** 'applies' = part of this option's design; 'deviates' = choosing the option does not follow the rule. */
  readonly relation: 'applies' | 'deviates';
}

export interface DesignOptionDef {
  readonly id: string;
  /** VCF term (English) – may be shown as is. */
  readonly label: string;
  /** Czech description for the UI. */
  readonly description: string;
  readonly sources: readonly DesignSourceId[];
  readonly rules: readonly DesignRuleRef[];
  readonly consequences: readonly DesignConsequence[];
  /** Option is documented as Day 2 (not selectable for the Day 0 design). */
  readonly day2?: true;
  /** Description/facts rest on spec text marked *(parafráze)*. */
  readonly paraphrased?: true;
  readonly openQuestions?: readonly string[];
}

export interface DesignDecisionDef {
  readonly id: DesignDecisionId;
  /** Game step 1–8 per 05 §4.10. */
  readonly step: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  readonly specRef: string;
  /** Czech title, VCF terms in English. */
  readonly title: string;
  readonly help: string;
  readonly scope: 'fleet' | 'management-domain' | 'workload-domain' | 'instance';
  readonly sources: readonly DesignSourceId[];
  readonly rules: readonly DesignRuleRef[];
  /** Decision-level consequences (regardless of option). */
  readonly consequences: readonly DesignConsequence[];
  readonly options: readonly DesignOptionDef[];
}

const q = (kind: ConsequenceKind, text: string, sources: readonly DesignSourceId[], extra: Partial<DesignConsequence> = {}): DesignConsequence =>
  ({ kind, text, quote: true, sources, ...extra });
const d = (kind: ConsequenceKind, text: string, sources: readonly DesignSourceId[], extra: Partial<DesignConsequence> = {}): DesignConsequence =>
  ({ kind, text, quote: false, sources, ...extra });
const applies = (...ids: string[]): DesignRuleRef[] => ids.map((id) => ({ id, relation: 'applies' as const }));
const deviates = (...ids: string[]): DesignRuleRef[] => ids.map((id) => ({ id, relation: 'deviates' as const }));
const P = { paraphrased: true } as const;

// --- shared consequence sets ---

const DEDICATED_NSX: readonly DesignConsequence[] = [
  q('implication', 'Higher footprint as each workload domain requires a dedicated NSX Manager cluster.', ['D9']),
  q('benefit', 'Each workload domain can be scaled independently based on its own requirements.', ['D9']),
  q('benefit', 'Upgrades and patching can be performed independently per workload domain.', ['D9']),
];
const SHARED_NSX: readonly DesignConsequence[] = [
  d('benefit', 'Menší footprint – jeden NSX Manager cluster pro více domén.', ['D9'], P),
  q('implication', 'A single NSX management and control plane shared across workload domains increases the blast radius.', ['D9']),
  q('implication', 'Scalability can be constrained as the NSX instance is shared across workload domains.', ['D9']),
  q('implication', 'Upgrades and patching impact all included workload domains.', ['D9']),
];
const VSAN_ONLY_FEATURES = q(
  'benefit',
  'Provides a Full SDDC Solution · Storage Policy Based Management · Automated Deployment and Scale · Automated LCM, Patching, and Upgrades · Compute Only Clusters',
  ['D13'],
);
const CONVERGENCE_ONLY = q(
  'requirement',
  'Principal Storage marked with an asterisk can be achieved by converging existing virtual infrastructure … for a management domain or importing an existing virtual infrastructure … for a workload domain.',
  ['D13'],
);
const MGMT_DEFAULT_NON_SUPPORTED = d('requirement', 'Storage Models: pro default cluster management domain „Non Supported“; principal jen pro další clustery management domain a pro WLD.', ['D13']);

const clusterOptions = (forMgmt: boolean): DesignOptionDef[] => [
  {
    id: 'single-rack', label: 'Single-Rack vSphere Cluster Model',
    description: 'Cluster v jednom racku, jedna storage fault domain, L2 mezi hosty. Bez ochrany proti výpadku racku.',
    sources: ['S7', 'D18'], rules: [],
    consequences: [q('implication', 'vSphere clusters are configured allowing for the failure of a single ESX host while still having enough resources to run all vSphere cluster workloads.', ['D18'])],
  },
  {
    id: 'multi-rack-l2', label: 'Multi-Rack Layer 2 vSphere Cluster Model',
    description: 'Cluster přes více racků s L2 sítí mezi hosty, více storage fault domains.',
    sources: ['S7', 'P11'], rules: [],
    consequences: [d('recommendation', 'Doporučeno vSAN ESA jako principal storage (VCF-CLS-MR-RCMD-CFG-002).', ['P11'], P)],
  },
  {
    id: 'multi-rack-l3', label: 'Multi-Rack Layer 3 vSphere Cluster Model',
    description: forMgmt
      ? 'Cluster přes více racků s L3 mezi hosty. Pro první (default) cluster management domain nepodporován.'
      : 'Cluster přes více racků s L3 mezi hosty. Nelze jako vSAN storage cluster, nelze stretchnout.',
    sources: ['S7', 'P12'], rules: [],
    consequences: [d('limit', 'Nepodporováno pro primární cluster management domain; jen jedna AZ.', ['P12'])],
  },
  {
    id: 'stretched', label: 'Stretched vSphere Cluster Model',
    description: 'Cluster roztažený přes dvě availability zones – ochrana proti výpadku AZ.',
    sources: ['S7', 'P13', 'D5'], rules: [],
    ...(forMgmt ? { day2: true as const } : {}),
    consequences: forMgmt
      ? [d('day2', 'Stretched cluster v management domain je Day 2 – při bring-upu nelze.', ['D5'])]
      : [d('requirement', 'Stretched management domain je prerekvizitou stretched clusteru ve WLD; stretch management domain je Day 2.', ['P13', 'D5'])],
  },
];

export const DESIGN_DECISIONS: readonly DesignDecisionDef[] = [
  // ---- 05 §4.1 -------------------------------------------------------------
  {
    id: 'fleet-deployment-model', step: 1, specRef: '05 §4.1', scope: 'fleet',
    title: 'Fleet deployment model (topologie)',
    help: 'Topologie VCF fleet. Určuje počet availability zones / sites a které cluster modely přicházejí v úvahu.',
    sources: ['D11'], rules: [],
    consequences: [
      q('implication', 'Uses a single VCF Operations instance to manage the environment.', ['D11']),
      d('implication', 'Více fleet je možné („one fleet per region“) za cenu „More management overhead“.', ['D11']),
    ],
    options: [
      {
        id: 'basic', label: 'Basic', description: 'Jedna fleet v jedné availability zone / regionu.',
        sources: ['D11'], rules: [],
        consequences: [q('implication', 'Any failure at the availability zone or region level could result in downtime for the entire VCF fleet.', ['D11'])],
      },
      {
        id: 'site-high-availability', label: 'Site High Availability',
        description: 'Jedna VCF Instance přes dvě availability zones (stretched cluster, witness).',
        sources: ['D11'], rules: [],
        consequences: [
          q('benefit', 'Designed for a single VCF fleet instance across two availability zones.', ['D11']),
          q('requirement', 'Requires stretched Layer 2 networks or advanced routing.', ['D11']),
          q('requirement', 'Witness node for split-brain avoidance.', ['D11']),
          q('requirement', 'The design requires IP addresses to be stretched between the two availability zones.', ['D11']),
          d('day2', 'Stretched management cluster je povolený, ale stretch je Day 2.', ['D5', 'D11']),
        ],
      },
      {
        id: 'disaster-recovery', label: 'Disaster Recovery',
        description: 'Druhá VCF Instance v jiné AZ / regionu; DR mechanismus je VMware Live Recovery.',
        sources: ['D11'], rules: [],
        consequences: [
          q('implication', 'Longer recovery time …', ['D11']),
          q('implication', 'Data loss risk depending on the Recovery Point Objective (RPO) …', ['D11']),
          q('hardware', 'Significant investment in a secondary site …', ['D11']),
        ],
      },
      {
        id: 'fault-domains-and-dr', label: 'Fault Domains and DR',
        description: 'Kombinace Site High Availability a Disaster Recovery.',
        sources: ['D11'], rules: [],
        consequences: [
          q('hardware', 'Requires significant investment in both redundant infrastructure (HA) and a secondary site (DR).', ['D11']),
          d('day2', 'Stretched management cluster je povolený, ale stretch je Day 2.', ['D5', 'D11']),
        ],
      },
    ],
  },
  // ---- 05 §4.2 -------------------------------------------------------------
  {
    id: 'workload-placement', step: 2, specRef: '05 §4.2', scope: 'instance',
    title: 'Kde poběží business workloady',
    help: 'Management domain je povinná (VCF-WLD-REQD-CFG-001). Workloady v ní běžet smějí, doporučená je ale samostatná workload domain (VCF-WLD-RCMD-CFG-002).',
    sources: ['D5', 'D6', 'D9'], rules: applies('VCF-WLD-REQD-CFG-001'),
    consequences: [],
    options: [
      {
        id: 'management-domain', label: 'Business workloads v management domain',
        description: 'Workloady běží v management domain spolu s management komponentami (jako blueprint „VCF Fleet in a Single Site with Minimal Footprint“). Sdílené prostředky a společný lifecycle s managementem.',
        sources: ['D5', 'D9', 'D35'], rules: deviates('VCF-WLD-RCMD-CFG-002'),
        consequences: [
          q('benefit', 'Can also run business workloads.', ['D5', 'D9']),
          q('implication', 'All management and workload components are deployed in a single vSphere cluster.', ['D35']),
          q('requirement', 'You must carefully size the management domain to accommodate planned deployments of additional workload domains and management components.', ['D5']),
          q('implication', 'You may need to expand the resources in the management domain to accommodate future deployments of additional workload domains and management components.', ['D9']),
        ],
        // TODO(spec 05 §8 q1): 9.1 page has no resource-pool recommendation; only modelled as the 9.0 rule.
        openQuestions: ['05 §8 q1'],
      },
      {
        id: 'workload-domain', label: 'Samostatná workload domain',
        description: 'Workloady běží v dedikované workload domain (vlastní vCenter a SSO doména). WLD se přidává po management domain ve VCF Operations.',
        sources: ['D6', 'D9', 'D38', 'D41'], rules: applies('VCF-WLD-RCMD-CFG-002'),
        consequences: [
          q('hardware', 'Requires additional hardware.', ['D6']),
          q('benefit', 'Aligns with the VMware best practice of separating management workloads from customer workloads.', ['D6']),
          q('benefit', 'Provides better long-term flexibility and expansion options.', ['D6']),
          q('benefit', 'Has a dedicated vCenter and vCenter Single Sign-On domain.', ['D9']),
          q('limit', 'Scales up to 40 workload domains per VCF Instance.', ['D9']),
          d('day2', 'Workload domain se vytváří ve VCF Operations až po nasazení management domain.', ['D41']),
          d('implication', 'vCenter (a případně NSX Manager) WLD se nasazuje do management domain.', ['D41', 'D19']),
        ],
      },
    ],
  },
  {
    id: 'wld-nsx-consumption', step: 2, specRef: '05 §4.2 bod 3–4', scope: 'workload-domain',
    title: 'NSX Consumption Model workload domain',
    help: 'Dedikovaný NSX Manager pro WLD, nebo sdílený s jinou doménou. [9.1] smí sdílet i NSX management domain, [9.0] ne.',
    sources: ['D6', 'D9'], rules: applies('VCF-WLD-RCMD-NSX-002'),
    consequences: [],
    options: [
      {
        id: 'dedicated', label: 'Dedicated NSX instance', description: 'WLD dostane vlastní NSX Manager cluster.',
        sources: ['D6', 'D9'], rules: [], consequences: DEDICATED_NSX,
      },
      {
        id: 'shared-with-management-domain', label: 'Shared NSX instance – management domain',
        description: 'WLD sdílí NSX Manager management domain. [9.1] podporováno, [9.0] ne.',
        sources: ['D6', 'D9', 'D42'], rules: deviates('VCF-MGMT-RCMD-NSX-001'), consequences: SHARED_NSX,
      },
      {
        id: 'shared-with-workload-domain', label: 'Shared NSX instance – jiná workload domain',
        description: 'WLD sdílí NSX Manager jiné workload domain (při sdílení i NSX Edge clustery).',
        sources: ['D6', 'D9'], rules: [], consequences: SHARED_NSX, paraphrased: true,
      },
    ],
  },
  // ---- 05 §4.3 -------------------------------------------------------------
  {
    id: 'deployment-model', step: 3, specRef: '05 §4.3', scope: 'instance',
    title: 'Deployment model (Simple / High Availability)',
    help: 'Volba v průvodci VCF Installeru. Určuje modely VCF management services, NSX Manageru, VCF Operations a VCF Automation.',
    sources: ['D39', 'D12'], rules: applies('VCF-MS-REQD-COM-001', 'VCF-MS-REQD-COM-002', 'VCF-MS-REQD-COM-003', 'VCF-NSX-LM-REQD-CFG-001'),
    consequences: [
      q('recommendation', 'High Availability is recommended for production environments.', ['D39']),
      d('implication', 'Volba platí jen pro nově nasazené appliance.', ['D39']),
    ],
    options: [
      {
        id: 'simple', label: 'Simple',
        description: 'Jeden uzel NSX Manageru, VCF Operations a VCF Automation; VCF management services s jedním control plane uzlem.',
        sources: ['D22', 'D19', 'D24', 'D27'],
        rules: applies('VCF-MS-REQD-SIM-001', 'VCF-NSX-LM-REQD-CFG-004', 'VCF-OPS-REQD-SIM-001', 'VCF-AUTO-REQD-SIM-001'),
        consequences: [
          q('implication', 'Loss of the single control plane node would result in a need to redeploy the cluster and restore from backup.', ['D22']),
          d('recommendation', 'Simple VCF management services jsou doporučené pro proof of concept a lab.', ['D22'], P),
          q('implication', 'Scale out to a medium or large high availability deployment model is supported.', ['D22'], { openQuestion: '05 §8 q6' }),
        ],
      },
      {
        id: 'high-availability', label: 'High Availability',
        description: 'Tři uzly NSX Manageru, VCF Operations (Primary, Replica, Data) a VCF Automation; VCF management services se třemi control plane uzly.',
        sources: ['D23', 'D20', 'D25', 'D28'],
        rules: applies('VCF-MS-REQD-HA-001', 'VCF-NSX-LM-REQD-CFG-005', 'VCF-NSX-LM-RCMD-CFG-003', 'VCF-OPS-REQD-HA-001', 'VCF-OPS-REQD-HA-003', 'VCF-AUTO-REQD-HA-001'),
        consequences: [
          d('hardware', 'Anti-affinity NSX Manageru chce „at least four physical hosts“; DRS anti-affinity VCF Operations vyžaduje ≥ 4 ESX hosty v default management clusteru.', ['D20', 'D25'], P),
        ],
      },
    ],
  },
  {
    id: 'deployment-size', step: 3, specRef: '05 §4.3; 20 §4.2 krok 5', scope: 'instance',
    title: 'Velikost (sizing profil)',
    help: '[9.1.1+] Small je výchozí pro Simple i HA; Medium a Large jen pro HA. Profily vCPU/RAM/disk viz VCF Fleet Sizing Models.',
    sources: ['D39', 'D12'], rules: [], consequences: [],
    options: [
      {
        id: 'small', label: 'Small', description: 'Jediná velikost pro Simple; [9.1.1+] i pro HA.',
        sources: ['D39', 'D12'], rules: [], consequences: [
          q('limit', 'In VCF 9.1, this is the only available option for the simple deployment model.', ['D39']),
          d('implication', 'HA VCF management services: stránka HA modelu uvádí jen „Medium, Large“, průvodce 9.1.1 dovoluje Small i pro HA.', ['D23', 'D39'], { openQuestion: '05 §8 q4' }),
        ],
        // TODO(spec 05 §8 q4): HA + Small allowed per wizard 9.1.1 (20 §4.2), relation to [D23] unresolved.
        openQuestions: ['05 §8 q4'],
      },
      { id: 'medium', label: 'Medium', description: 'Jen High Availability.', sources: ['D39', 'D12'], rules: [], consequences: [] },
      { id: 'large', label: 'Large', description: 'Jen High Availability.', sources: ['D39', 'D12'], rules: [], consequences: [] },
    ],
  },
  // ---- 05 §4.4 -------------------------------------------------------------
  {
    id: 'mgmt-cluster-model', step: 4, specRef: '05 §4.4', scope: 'management-domain',
    title: 'vSphere cluster model – první cluster management domain',
    help: 'Pro první cluster management domain: Single-Rack, Multi-Rack Layer 2, Stretched (Day 2). Další clustery mohou použít všechny modely.',
    sources: ['D5', 'D43', 'S7'],
    rules: applies('VCF-CLS-REQD-CFG-001', 'VCF-CLS-REQD-CFG-002', 'VCF-CLS-REQD-CFG-003', 'VCF-CLS-REQD-CFG-004', 'VCF-CLS-RCMD-CFG-001', 'VCF-CLS-RCMD-CFG-002', 'VCF-CLS-RCMD-CFG-003', 'VCF-CLS-RCMD-CFG-004', 'VCF-CLS-RCMD-CFG-006'),
    consequences: [],
    options: clusterOptions(true),
  },
  {
    id: 'wld-cluster-model', step: 4, specRef: '05 §4.4', scope: 'workload-domain',
    title: 'vSphere cluster model – workload domain',
    help: 'Workload domain: Single-Rack, Multi-Rack Layer 2, Multi-Rack Layer 3, Stretched.',
    sources: ['D6', 'D43', 'S7'],
    rules: applies('VCF-CLS-REQD-CFG-001', 'VCF-CLS-REQD-CFG-002', 'VCF-CLS-REQD-CFG-003', 'VCF-CLS-REQD-CFG-004', 'VCF-CLS-RCMD-CFG-001', 'VCF-CLS-RCMD-CFG-002', 'VCF-CLS-RCMD-CFG-003'),
    consequences: [],
    options: clusterOptions(false),
  },
  // ---- 05 §4.5 -------------------------------------------------------------
  {
    id: 'principal-storage', step: 5, specRef: '05 §4.5', scope: 'management-domain',
    title: 'Principal storage – default cluster management domain',
    help: 'Principal storage se volí při vytvoření domény / clusteru a nelze ho později změnit. Supplemental storage lze přidat později.',
    sources: ['D13', 'D39'], rules: [],
    consequences: [
      q('irreversible', 'the principal storage type for a cluster cannot be changed', ['D39']),
      d('implication', 'Do management domain lze později přidat clustery s jiným principal storage.', ['D39']),
    ],
    options: [
      {
        id: 'vsan-esa', label: 'vSAN ESA', description: 'Single-Rack vSAN ESA Storage Model (volba v průvodci VCF Installeru).',
        sources: ['D13', 'D39'], rules: [],
        consequences: [VSAN_ONLY_FEATURES, q('hardware', 'All other vSAN ESA nodes require 25GbE or greater.', ['D13']), d('hardware', 'Výjimka: ReadyNode profil „vSAN-ESA-AF-0“ (10GbE).', ['D13'])],
      },
      {
        id: 'vsan-osa', label: 'vSAN OSA', description: 'Single-Rack vSAN OSA Storage Model (volba v průvodci VCF Installeru).',
        sources: ['D13', 'D39'], rules: [], consequences: [VSAN_ONLY_FEATURES],
      },
      {
        id: 'vmfs-fc', label: 'VMFS on Fibre Channel', description: 'Externí FC storage; datastore musí existovat a být připojen na všech hostech.',
        sources: ['D13', 'D39'], rules: [], consequences: [d('implication', 'Bez funkcí, které má jen vSAN (Storage Policy Based Management, automatizované LCM storage …).', ['D13'])],
      },
      {
        id: 'nfs-v3', label: 'NFS v3', description: 'Externí NFS v3 storage; NFS server musí existovat.',
        sources: ['D13', 'D39'], rules: [], consequences: [d('implication', 'Bez funkcí, které má jen vSAN (Storage Policy Based Management, automatizované LCM storage …).', ['D13'])],
      },
      {
        id: 'vsan-storage-cluster', label: 'Single-Rack vSAN Storage Cluster', description: 'Dedikovaný vSAN storage cluster.',
        sources: ['D13'], rules: [],
        consequences: [MGMT_DEFAULT_NON_SUPPORTED, q('requirement', 'Requires vSAN ESA.', ['D13']), q('recommendation', 'Not recommended running virtual machine workloads directly on the vSAN Storage Clusters.', ['D13'])],
      },
      {
        id: 'vsan-compute-cluster', label: 'Single-Rack vSAN Compute Cluster', description: 'Compute cluster, který konzumuje vSAN storage cluster.',
        sources: ['D13'], rules: [],
        consequences: [MGMT_DEFAULT_NON_SUPPORTED, q('requirement', 'Must be co-located in the same workload domain as its corresponding vSAN Storage cluster.', ['D13'])],
      },
      { id: 'multi-rack-vsan', label: 'Multi-Rack vSAN', description: 'vSAN přes více racků.', sources: ['D13'], rules: [], consequences: [MGMT_DEFAULT_NON_SUPPORTED] },
      { id: 'multi-rack-vsan-compute', label: 'Multi-Rack vSAN Compute Cluster', description: 'Compute cluster pro multi-rack vSAN.', sources: ['D13'], rules: [], consequences: [MGMT_DEFAULT_NON_SUPPORTED] },
      { id: 'nfs-v41', label: 'NFSv4.1', description: 'Principal jen konvergencí (mgmt) nebo importem (WLD); jinak supplemental.', sources: ['D13'], rules: [], consequences: [CONVERGENCE_ONLY] },
      { id: 'iscsi', label: 'iSCSI', description: 'Principal jen konvergencí (mgmt) nebo importem (WLD); jinak supplemental.', sources: ['D13'], rules: [], consequences: [CONVERGENCE_ONLY] },
      { id: 'nvme-tcp', label: 'NVMe/TCP', description: 'Principal jen konvergencí (mgmt) nebo importem (WLD); jinak supplemental.', sources: ['D13'], rules: [], consequences: [CONVERGENCE_ONLY] },
      { id: 'nvme-fc', label: 'NVMe/FC', description: 'Principal jen konvergencí (mgmt) nebo importem (WLD); jinak supplemental.', sources: ['D13'], rules: [], consequences: [CONVERGENCE_ONLY] },
      { id: 'nvme-rdma', label: 'NVMe/RDMA', description: 'Principal jen konvergencí (mgmt) nebo importem (WLD); jinak supplemental.', sources: ['D13'], rules: [], consequences: [CONVERGENCE_ONLY] },
    ],
  },
  // ---- 05 §4.6 -------------------------------------------------------------
  {
    id: 'distributed-switch-model', step: 6, specRef: '05 §4.6 bod 1', scope: 'management-domain',
    title: 'Distributed Switch model',
    help: 'Rozložení provozu na vSphere Distributed Switche a fyzické NIC. Profily průvodce: Default / Storage Traffic Separation / NSX Traffic Separation / Custom.',
    sources: ['D15', 'D39'], rules: [],
    consequences: [q('implication', 'Starting with VCF 9.1.1 for greenfield deployments it is now supported to share a vSphere Distributed Switch between clusters in a VCF domain.', ['D15'])],
    options: [
      {
        id: 'single', label: 'Single Distributed Switch', description: 'Veškerý provoz na jednom VDS.',
        sources: ['D15'], rules: [],
        consequences: [q('implication', 'Does not provide network traffic separation to another physical network fabric.', ['D15'])],
      },
      { id: 'storage-separation', label: 'Storage Separation', description: 'Storage provoz na samostatném VDS.', sources: ['D15'], rules: [], consequences: [] },
      { id: 'workload-separation', label: 'Workload Separation', description: 'Workload provoz na samostatném VDS.', sources: ['D15'], rules: [], consequences: [] },
      {
        id: 'storage-and-workload-separation', label: 'Storage and Workload Separation', description: 'Storage i workload provoz na samostatných VDS.',
        sources: ['D15'], rules: [], consequences: [q('hardware', 'minimum of six (6) with redundancy', ['D15'])],
      },
      { id: 'dedicated-cluster-for-nsx-edge', label: 'Dedicated vSphere Cluster for NSX Edge Node', description: 'NSX Edge uzly ve vlastním clusteru.', sources: ['D15'], rules: [], consequences: [] },
      {
        id: 'vsan-storage-cluster-separation', label: 'vSAN Storage Cluster Separation', description: 'Model pro vSAN storage cluster se dvěma VDS.',
        sources: ['D15'], rules: [], consequences: [d('implication', '2 VDS.', ['D15'])],
        // TODO(orchestrator): spec does not state whether this model is usable in the mgmt default cluster
        // (vSAN storage cluster model itself is Non Supported there) – no constraint modelled.
      },
    ],
  },
  {
    id: 'management-network-model', step: 6, specRef: '05 §4.6 bod 2', scope: 'management-domain',
    title: 'VCF Management Network model',
    help: 'Na které síti běží VCF Operations, VCF Automation a VCF management services.',
    sources: ['D16'], rules: [],
    consequences: [
      d('requirement', 'VCF management services vždy na vSphere distributed port group; cloud proxy vždy na VM management network.', ['D16'], P),
      d('limit', 'Overlay segmenty jen pro VCF Operations, VCF Automation, License Server a VCF Operations for networks.', ['D16'], P),
    ],
    options: [
      { id: 'shared-vlan', label: 'Shared VLAN (VM management network)', description: 'VCF management komponenty sdílejí VM management network.', sources: ['D16', 'D35'], rules: [], consequences: [] },
      { id: 'dedicated-vlan', label: 'Dedicated VLAN (VCF management network)', description: 'VCF Operations / Automation / management services na samostatné VLAN; cloud proxy zůstává na VM management.', sources: ['D16'], rules: [], consequences: [] },
      {
        id: 'dedicated-vlan-nsx-overlay', label: 'Dedicated VLAN and NSX Overlay Segment', description: 'VCF Operations a VCF Automation na NSX overlay segmentu.',
        sources: ['D16', 'D39'], rules: [], paraphrased: true,
        consequences: [
          d('day2', 'Nasazení VCF Operations a VCF Automation se odloží (deferred); sítě se musí připravit po VCF Installeru.', ['D16'], P),
          d('limit', 'Custom networking jen pro novou fleet a ne s existující VCF Operations.', ['D39']),
        ],
      },
      {
        id: 'dedicated-vlan-nsx-stretched-overlay', label: 'Dedicated VLAN and NSX Stretched Overlay Segment', description: 'Jako overlay model, segment je stretched.',
        sources: ['D16', 'D39'], rules: [], paraphrased: true,
        consequences: [
          d('day2', 'Nasazení VCF Operations a VCF Automation se odloží (deferred); sítě se musí připravit po VCF Installeru.', ['D16'], P),
          d('limit', 'Custom networking jen pro novou fleet a ne s existující VCF Operations.', ['D39']),
        ],
      },
    ],
  },
  {
    id: 'wld-network-type', step: 6, specRef: '05 §4.6 bod 4', scope: 'workload-domain',
    title: 'Workload Network Type (workload domain)',
    help: 'IP verze sítí pro workloady ve workload domain.',
    sources: ['D6'], rules: [], consequences: [],
    options: [
      { id: 'ipv4', label: 'IPv4', description: 'Workload sítě IPv4.', sources: ['D6'], rules: [], consequences: [] },
      { id: 'ipv6', label: 'IPv6', description: 'Workload sítě IPv6. VPC nepodporují IPv6.', sources: ['D6', 'D39'], rules: [], consequences: [d('limit', 'VPC nepodporují IPv6.', ['D39'])] },
    ],
  },
  {
    id: 'network-consumption-model', step: 6, specRef: '05 §4.6 bod 3', scope: 'instance',
    title: 'Network Consumption model (workloady)',
    help: 'Jak workloady konzumují sítě.',
    sources: ['D14'], rules: [],
    consequences: [d('limit', 'Federace (centralizovaná security policy, L2/L3 extension) nefunguje u All Apps Orgs ani u VPC.', ['D14'], P)],
    options: [
      { id: 'all-apps-orgs', label: 'VCF Automation All Apps Orgs', description: 'Sítě konzumované přes organizace VCF Automation.', sources: ['D14'], rules: [], consequences: [] },
      {
        id: 'vpc', label: 'Virtual Private Cloud (VPC)', description: 'NSX VPC.',
        sources: ['D14'], rules: [], consequences: [q('limit', 'VPC model cannot be consumed via NSX Global Manager.', ['D14'])],
      },
      { id: 'nsx-segment', label: 'NSX Segment', description: 'Klasické NSX segmenty.', sources: ['D14'], rules: [], consequences: [] },
      {
        id: 'vlan', label: 'VLAN Networking', description: 'VLAN-backed sítě bez NSX overlay.',
        sources: ['D14'], rules: [], consequences: [q('implication', 'supported in VMware Cloud Foundation and may be appropriate for specific use cases', ['D14'])],
      },
    ],
  },
  {
    id: 'vpc-network-type', step: 6, specRef: '20 §4.2 krok 6 (05 §4.6 bod 3)', scope: 'management-domain',
    title: 'VPC Network Configuration (průvodce VCF Installeru)',
    help: '[9.1.1+] Volba v kroku „Network configuration“ průvodce VCF Installeru.',
    sources: ['D39'], rules: [], consequences: [],
    options: [
      { id: 'full-stack', label: 'Full Stack VPC', description: 'VPC s TEP overlay; Distributed nebo Centralized connectivity.', sources: ['D39'], rules: [], consequences: [] },
      {
        id: 'vlan-backed', label: 'VLAN-Backed VPC', description: 'VPC bez TEP (TEP-less).',
        sources: ['D39'], rules: [], consequences: [d('implication', 'NSX Host Overlay Network (VLAN pro TEP) není potřeba.', ['D39'])],
      },
    ],
  },
  {
    id: 'vpc-gateway-connectivity', step: 6, specRef: '20 §4.2 krok 6', scope: 'management-domain',
    title: 'VPC Gateway Connectivity',
    help: 'Volba v kroku „Network configuration“ průvodce VCF Installeru.',
    sources: ['D39'], rules: [], consequences: [d('limit', 'VPC nepodporují IPv6.', ['D39'])],
    options: [
      { id: 'centralized', label: 'Centralized', description: 'Přes NSX Edge; konfigurace až po vytvoření domény.', sources: ['D39'], rules: [], consequences: [d('day2', 'Konfigurace až po vytvoření domény.', ['D39'])] },
      { id: 'distributed', label: 'Distributed', description: 'Transit Gateway; konfigurace na stránce NSX Manager průvodce.', sources: ['D39'], rules: [], consequences: [] },
    ],
  },
  // ---- 05 §4.7 -------------------------------------------------------------
  {
    id: 'vcf-operations-model', step: 7, specRef: '05 §4.7', scope: 'fleet',
    title: 'VCF Operations model',
    help: 'Odvozeno z deployment modelu (Simple / High Availability). Continuous Availability je Day 2.',
    sources: ['D17', 'D26', 'D39'], rules: applies('VCF-OPS-REQD-COM-001', 'VCF-OPS-REQD-COM-003'),
    consequences: [q('implication', 'VCF Operations is always deployed in the management domain of the first VCF Instance in the VCF fleet.', ['D39'])],
    options: [
      {
        id: 'simple', label: 'Simple', description: 'Jeden uzel VCF Operations.',
        sources: ['D17', 'D24'], rules: applies('VCF-OPS-REQD-SIM-001'),
        consequences: [
          q('implication', 'Single node for VCF Operations.', ['D17']),
          q('implication', 'Slower recovery from failure.', ['D17']),
          q('implication', 'Can be scaled-out to be highly available.', ['D17']),
        ],
      },
      {
        id: 'high-availability', label: 'High Availability', description: 'Primary, Replica a Data node.',
        sources: ['D17', 'D25'], rules: applies('VCF-OPS-REQD-HA-001', 'VCF-OPS-REQD-HA-003'), consequences: [],
      },
      {
        id: 'continuous-availability', label: 'Continuous Availability', description: 'Páry uzlů přes dvě availability zones, witness ve třetí AZ.',
        sources: ['D17', 'D26'], rules: [], day2: true,
        consequences: [
          q('implication', 'A cluster with a pair of nodes, across two availability zones', ['D17']),
          q('implication', 'Manual operations after the initial installation', ['D17']),
          d('requirement', 'Dvě AZ pro repliky a třetí AZ pro witness, latence mezi AZ max. 10 ms.', ['D17'], P),
          d('day2', 'Není mezi options Management Domain Modelu; ve hře Day 2.', ['D5'], { openQuestion: '05 §8 q3' }),
        ],
        // TODO(spec 05 §8 q3): relation of CA to Site HA fleet model and whether it is a Day 2 transformation.
        openQuestions: ['05 §8 q3'],
      },
    ],
  },
  // ---- 05 §4.8 -------------------------------------------------------------
  {
    id: 'vcf-automation-model', step: 7, specRef: '05 §4.8', scope: 'fleet',
    title: 'VCF Automation model',
    help: 'Odvozeno z deployment modelu: Simple (1 uzel, Small) nebo High Availability (3 uzly).',
    sources: ['D29', 'D27', 'D28'], rules: [],
    consequences: [
      q('implication', 'Uses the VM management distributed port group by default', ['D29']),
      q('implication', 'Allows for custom network configurations.', ['D29']),
    ],
    options: [
      {
        id: 'simple', label: 'Simple', description: 'Jeden uzel VCF Automation (Small).',
        sources: ['D27'], rules: applies('VCF-AUTO-REQD-SIM-001', 'VCF-AUTO-REQD-SIM-002'),
        consequences: [q('implication', 'Scale-up to a larger node size and scale-out to three nodes at the same time.', ['D27'])],
      },
      {
        id: 'high-availability', label: 'High Availability', description: 'Tři uzly VCF Automation.',
        sources: ['D28'], rules: applies('VCF-AUTO-REQD-HA-001', 'VCF-AUTO-REQD-HA-003'), consequences: [],
      },
    ],
  },
  {
    id: 'vcf-automation-placement', step: 7, specRef: '05 §3, §4.8, §5', scope: 'fleet',
    title: 'Umístění VCF Automation',
    help: '[9.1] VCF Automation smí být jen v management domain. [9.0] mohla být ve workload domain.',
    sources: ['D40'], rules: [], consequences: [],
    options: [
      {
        id: 'management-domain', label: 'Management domain', description: 'VCF Automation v management domain.',
        sources: ['D40'], rules: [],
        consequences: [q('requirement', 'Starting with VCF 9.1, VCF Automation is required to be deployed in the Management Domain only.', ['D40'])],
      },
      {
        id: 'workload-domain', label: 'Workload domain ([9.0])', description: 'VCF Automation ve workload domain – jen 9.0.',
        sources: ['D40'], rules: [],
        consequences: [
          q('implication', 'VCF Automation is supported to be deployed in a Workload Domain.', ['D40']),
          q('limit', 'This placement model is enforced by VCF Operations 9.1 and Fleet Management.', ['D40']),
        ],
        // TODO(spec 05 §8 q12): how the 9.0 UI offered this placement is unverified.
        openQuestions: ['05 §8 q12'],
      },
    ],
  },
  // ---- 05 §4.9 -------------------------------------------------------------
  {
    id: 'identity-broker-model', step: 8, specRef: '05 §4.9 bod 1', scope: 'instance',
    title: 'Identity broker deployment model',
    help: 'Embedded (ve vCenteru) nebo Instance (na VCF management services). Instance model je doporučený pro produkci.',
    sources: ['D31'], rules: [], consequences: [],
    options: [
      {
        id: 'embedded', label: 'Embedded', description: 'Embedded identity broker v prvním vCenteru management domain.',
        sources: ['D31', 'D32'], rules: applies('VCF-SSO-REQD-EMB-001', 'VCF-SSO-REQD-EMB-002'),
        consequences: [
          q('recommendation', 'This deployment model is intended for VMware Cloud Foundation lab environments or proof-of-concept (POC) use cases.', ['D31']),
          q('limit', 'One identity broker per VCF Instance.', ['D32']),
          q('implication', 'maintenance tasks performed on the vCenter instance also impact your ability to authenticate', ['D32']),
          q('implication', 'Migration from embedded to the instance model is performed via a streamlined wizard in VCF Operations.', ['D32']),
        ],
      },
      {
        id: 'instance', label: 'Instance', description: 'Identity broker jako služba na VCF management services, automaticky v první management domain.',
        sources: ['D31', 'D33'], rules: applies('VCF-SSO-REQD-EXT-001', 'VCF-SSO-REQD-EXT-002'),
        consequences: [
          q('recommendation', 'This option is recommended for a production VMware Cloud Foundation deployment.', ['D31']),
          d('day2', 'Další identity brokery jsou Day N.', ['D33']),
        ],
      },
    ],
  },
  {
    id: 'sso-model', step: 8, specRef: '05 §4.9 bod 2', scope: 'fleet',
    title: 'VCF Single Sign-On model',
    help: 'Kolik identity brokerů obsluhuje instance ve fleet.',
    sources: ['D30'], rules: [],
    consequences: [
      q('requirement', 'all components belonging to a single VCF instance must belong to the same SSO realm.', ['D30']),
      d('limit', 'Split-SSO není podporováno.', ['D30'], P),
      q('limit', 'restoring an identity broker to a VCF instance in a different SSO realm is not supported.', ['D30']),
    ],
    options: [
      { id: 'fleet-wide', label: 'Fleet-Wide', description: 'Jeden identity broker pro celou fleet.', sources: ['D30'], rules: [], consequences: [q('implication', 'each VCF fleet contains a single identity broker deployment', ['D30'])] },
      { id: 'cross-instance', label: 'Cross VCF Instance', description: 'Broker obsluhuje podmnožinu instancí.', sources: ['D30'], rules: [], consequences: [q('implication', 'Each identity broker instance serves a defined set of VCF instances in the same VCF fleet.', ['D30'])] },
      { id: 'single-instance', label: 'Single VCF Instance', description: 'Každá instance má vlastní broker.', sources: ['D30'], rules: [], consequences: [q('implication', 'each VCF Instance will utilize its own dedicated identity broker.', ['D30'])] },
      {
        id: 'none', label: 'Bez VCF SSO', description: 'Autentizace per komponenta – SSO není povinné.',
        sources: ['D30'], rules: [], paraphrased: true, consequences: [d('implication', 'SSO není povinné – lze zůstat u autentizace per komponenta.', ['D30'], P)],
      },
    ],
  },
  // TODO(spec 05 §8 q8, q11): vSphere Supervisor, Load Balancer, NSX Edge cluster, VCF Operations for Networks,
  // Log management, Recovery options – not processed in spec 05, not modelled.
  // TODO(spec 05 §8 q2, q7): Minimal Footprint host minimum / blueprint layer pages – not modelled beyond 10 §6.1.
];

const DECISION_BY_ID: ReadonlyMap<DesignDecisionId, DesignDecisionDef> = new Map(DESIGN_DECISIONS.map((x) => [x.id, x]));

export function decisionDef(id: DesignDecisionId): DesignDecisionDef {
  const def = DECISION_BY_ID.get(id);
  if (!def) throw new Error(`Unknown design decision ${id}`);
  return def;
}

export function optionDef(decision: DesignDecisionId, option: string): DesignOptionDef | undefined {
  return decisionDef(decision).options.find((o) => o.id === option);
}

// ===========================================================================
// Selection and applicability
// ===========================================================================

/** Player choices: decision id -> option id. Unset = not decided yet. */
export type DesignChoices = Readonly<Partial<Record<DesignDecisionId, string>>>;

export interface DesignContext {
  /** VCF minor version the rules are evaluated for (default '9.1' = modelled 9.1.1). */
  readonly version?: VcfMinorVersion;
  /**
   * The design uses NSX Federation (NSX Global Manager). Not a decision of this phase (NSX federation
   * belongs to area 51-nsx, 05 §8 q8) – provided by the scenario. Default false.
   */
  readonly nsxFederation?: boolean;
}

interface Ctx {
  readonly version: VcfMinorVersion;
  readonly nsxFederation: boolean;
}
const ctxOf = (c: DesignContext): Ctx => ({ version: c.version ?? '9.1', nsxFederation: c.nsxFederation ?? false });

/** Converts the UI's ReadonlyMap<string,string> into DesignChoices (unknown decision ids are dropped). */
export function choicesFromMap(map: ReadonlyMap<string, string>): DesignChoices {
  const out: Partial<Record<DesignDecisionId, string>> = {};
  for (const id of DESIGN_DECISION_IDS) {
    const v = map.get(id);
    if (v !== undefined) out[id] = v;
  }
  return out;
}

/**
 * Whether a decision is relevant given the other choices.
 * Workload-domain decisions apply only when business workloads go to a separate workload domain (05 §4.2).
 */
export function isDecisionApplicable(id: DesignDecisionId, choices: DesignChoices): boolean {
  if (decisionDef(id).scope === 'workload-domain') return choices['workload-placement'] === 'workload-domain';
  return true;
}

export function applicableDecisions(choices: DesignChoices): DesignDecisionDef[] {
  return DESIGN_DECISIONS.filter((x) => isDecisionApplicable(x.id, choices));
}

/** Choices restricted to applicable decisions and known option ids. */
function effectiveChoices(choices: DesignChoices): DesignChoices {
  const out: Partial<Record<DesignDecisionId, string>> = {};
  for (const def of DESIGN_DECISIONS) {
    const v = choices[def.id];
    if (v !== undefined && isDecisionApplicable(def.id, choices) && def.options.some((o) => o.id === v)) out[def.id] = v;
  }
  return out;
}

// ===========================================================================
// Constraints (dependencies between decisions)
// ===========================================================================

/**
 * Basis of a constraint – decides severity:
 * - 'requirement' (REQD), 'unsupported' (documented as not supported / not an option), 'day2' (documented
 *   as Day 2, not part of Day 0 design), 'derived' (the choice is determined by an earlier decision) -> error
 * - 'recommendation' (RCMD/RECD with ID), 'documentation-discrepancy' (spec files disagree) and 'limitation'
 *   (documented loss of features, not "unsupported") -> warning
 */
export type ConstraintBasis =
  | 'requirement'
  | 'unsupported'
  | 'day2'
  | 'derived'
  | 'recommendation'
  | 'documentation-discrepancy'
  | 'limitation';

export interface DesignConstraint {
  readonly id: string;
  /** Decision the issue is attached to (issue.subject); the "later" decision in 05 §4.10 order. */
  readonly decision: DesignDecisionId;
  readonly basis: ConstraintBasis;
  /** Design rule ID if the constraint comes from one. */
  readonly ruleId?: string;
  readonly specRef: string;
  /** Czech one-line description for docs/UI. */
  readonly description: string;
  readonly paraphrased?: true;
  check(c: DesignChoices, ctx: Ctx): ValidationIssue[];
}

export const severityOfBasis = (b: ConstraintBasis): 'error' | 'warning' =>
  b === 'recommendation' || b === 'documentation-discrepancy' || b === 'limitation' ? 'warning' : 'error';

const NONE: ValidationIssue[] = [];
const MGMT_NON_SUPPORTED_STORAGE = ['vsan-storage-cluster', 'vsan-compute-cluster', 'multi-rack-vsan', 'multi-rack-vsan-compute'];
const CONVERGENCE_ONLY_STORAGE = ['nfs-v41', 'iscsi', 'nvme-tcp', 'nvme-fc', 'nvme-rdma'];
const MULTI_AZ_FLEETS: readonly string[] = ['site-high-availability', 'fault-domains-and-dr'];

export const DESIGN_CONSTRAINTS: readonly DesignConstraint[] = [
  {
    // 05 §5 row "Multi-Rack L3 jako první cluster management domain" [D5]; 10 §6.1 [P12]; 00 §6 [S7].
    id: 'mgmt-cluster-not-l3', decision: 'mgmt-cluster-model', basis: 'unsupported', specRef: '05 §4.4, §5 [D5]; 10 §6.1 [P12]',
    description: 'Multi-Rack Layer 3 není podporován pro první cluster management domain.',
    check: (c) => c['mgmt-cluster-model'] === 'multi-rack-l3'
      ? [issue('MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED', 'error', 'Multi-Rack Layer 3 is not an option for the first cluster of the management domain (options: Single-Rack, Multi-Rack Layer 2, Stretched (Day 2)).', '05 §4.4, §5 [D5]; 10 §6.1 [P12]', 'mgmt-cluster-model')]
      : NONE,
  },
  {
    // 05 §5 row "Stretched management cluster při bring-upu" – "(Day 2)" [D5].
    id: 'mgmt-cluster-stretched-day2', decision: 'mgmt-cluster-model', basis: 'day2', specRef: '05 §4.4, §5 [D5]',
    description: 'Stretched cluster v management domain je Day 2 – nelze v designu Day 0.',
    check: (c) => c['mgmt-cluster-model'] === 'stretched'
      ? [issue('DESIGN_DAY2_ONLY', 'error', 'Stretched vSphere Cluster Model for the management domain first cluster is a Day 2 operation; start with Single-Rack or Multi-Rack Layer 2.', '05 §4.4, §5 [D5]', 'mgmt-cluster-model')]
      : NONE,
  },
  {
    // 00 §6 fleet topology table [S16] lists only single-rack (+ stretched) for the management domain, while
    // 05 §2.3 [D5] lists Multi-Rack Layer 2 as an option. Discrepancy -> warning only.
    // TODO(orchestrator): resolve 00 §6 vs 05 §2.3 for Multi-Rack L2 management cluster per fleet model.
    id: 'mgmt-cluster-fleet-topology', decision: 'mgmt-cluster-model', basis: 'documentation-discrepancy', specRef: '00 §6 [S16]; 05 §2.3 [D5]',
    description: 'Cluster model management domain není v tabulce topologií zvoleného fleet modelu (rozpor 00 §6 vs 05 §2.3).',
    check: (c) => {
      const fleet = c['fleet-deployment-model'] as FleetDesign | undefined;
      const cm = c['mgmt-cluster-model'] as ClusterModel | undefined;
      if (!fleet || cm !== 'multi-rack-l2') return NONE;
      if (FLEET_DESIGN_CLUSTER_MODELS[fleet].management.includes(cm)) return NONE;
      return [issue('DESIGN_CLUSTER_MODEL_NOT_IN_FLEET_TOPOLOGY', 'warning', `The fleet deployment model "${fleet}" lists only ${FLEET_DESIGN_CLUSTER_MODELS[fleet].management.join(', ')} for the management domain, while the Management Domain Model allows Multi-Rack Layer 2 for the first cluster. Documentation discrepancy (unresolved).`, '00 §6 [S16]; 05 §2.3 [D5]', 'mgmt-cluster-model')];
    },
  },
  {
    // 00 §6 [S16]: stretched only in Site HA / Fault Domains and DR (two AZs). 05 §4.1 [D11].
    id: 'wld-stretched-needs-multi-az', decision: 'wld-cluster-model', basis: 'unsupported', specRef: '00 §6 [S16]; 05 §4.1 [D11]',
    description: 'Stretched cluster WLD vyžaduje fleet model se dvěma AZ (Site High Availability / Fault Domains and DR).',
    check: (c) => {
      const fleet = c['fleet-deployment-model'];
      if (c['wld-cluster-model'] !== 'stretched' || fleet === undefined || MULTI_AZ_FLEETS.includes(fleet)) return NONE;
      return [issue('DESIGN_STRETCHED_REQUIRES_MULTI_AZ_FLEET', 'error', `Stretched vSphere Cluster Model is not part of the "${fleet}" fleet deployment model; it requires Site High Availability or Fault Domains and DR (two availability zones).`, '00 §6 [S16]; 05 §4.1 [D11]', 'wld-cluster-model')];
    },
  },
  {
    // 05 §3, §5: Simple + Medium/Large; [9.1.1+] ALLOWED_SIZES (20 §4.2 step 5) [D39].
    id: 'size-for-deployment-model', decision: 'deployment-size', basis: 'requirement', specRef: '05 §4.3, §5 [D39]; 20 §4.2 krok 5',
    description: 'Simple deployment model jen s velikostí Small.',
    check: (c) => {
      const model = c['deployment-model'] as DeploymentModel | undefined;
      const size = c['deployment-size'] as DeploymentSize | undefined;
      if (!model || !size || ALLOWED_SIZES[model].includes(size)) return NONE;
      return [issue('SIZE_NOT_ALLOWED_FOR_MODEL', 'error', `Size "${size}" is not available for the ${model} deployment model ("In VCF 9.1, this is the only available option for the simple deployment model." – Small).`, '05 §4.3, §5 [D39]', 'deployment-size')];
    },
  },
  {
    // 05 §4.5 table, §5 [D13]: "Non Supported" for the management domain default cluster.
    id: 'storage-not-in-mgmt-default', decision: 'principal-storage', basis: 'unsupported', specRef: '05 §4.5, §5 [D13]',
    description: 'vSAN Storage / Compute Cluster a Multi-Rack vSAN nejsou podporované v default clusteru management domain.',
    check: (c) => {
      const s = c['principal-storage'];
      if (s === undefined || !MGMT_NON_SUPPORTED_STORAGE.includes(s)) return NONE;
      return [issue('DESIGN_STORAGE_UNSUPPORTED_MGMT_DEFAULT', 'error', `Storage model "${s}" is "Non Supported" for the management domain default cluster (only for additional clusters and workload domains).`, '05 §4.5, §5 [D13]', 'principal-storage')];
    },
  },
  {
    // 05 §4.5 table (asterisk), §5 [D13].
    id: 'storage-convergence-only', decision: 'principal-storage', basis: 'unsupported', specRef: '05 §4.5, §5 [D13]',
    description: 'NFSv4.1 / iSCSI / NVMe jako principal storage jen konvergencí nebo importem, ne v greenfieldu.',
    check: (c) => {
      const s = c['principal-storage'];
      if (s === undefined || !CONVERGENCE_ONLY_STORAGE.includes(s)) return NONE;
      return [issue('DESIGN_STORAGE_CONVERGENCE_ONLY', 'error', `"${s}" can be principal storage of the management domain only by converging existing virtual infrastructure, not in a greenfield deployment.`, '05 §4.5, §5 [D13]', 'principal-storage')];
    },
  },
  {
    // 10 §6.1 [P11]: VCF-CLS-MR-RCMD-CFG-002 (paraphrase) – vSAN ESA recommended for Multi-Rack L2.
    id: 'multi-rack-vsan-esa', decision: 'principal-storage', basis: 'recommendation', ruleId: 'VCF-CLS-MR-RCMD-CFG-002', specRef: '10 §6.1 [P11]', paraphrased: true,
    description: 'Multi-Rack Layer 2: doporučeno vSAN ESA jako principal storage.',
    check: (c) => c['mgmt-cluster-model'] === 'multi-rack-l2' && c['principal-storage'] !== undefined && c['principal-storage'] !== 'vsan-esa'
      ? [issue('DESIGN_MULTI_RACK_VSAN_ESA_RECOMMENDED', 'warning', 'Deviates from VCF-CLS-MR-RCMD-CFG-002 (paraphrase): vSAN ESA is the recommended principal storage for the Multi-Rack Layer 2 vSphere cluster model.', '10 §6.1 [P11]', 'principal-storage')]
      : NONE,
  },
  {
    // 05 §4.2 (A), §5 row "Workloady v management domain" [D5][D6]: deviation from VCF-WLD-RCMD-CFG-002 -> warning.
    id: 'workloads-in-mgmt-domain', decision: 'workload-placement', basis: 'recommendation', ruleId: 'VCF-WLD-RCMD-CFG-002', specRef: '05 §4.2, §5 [D5][D6]',
    description: 'Business workloady v management domain – odchylka od VCF-WLD-RCMD-CFG-002.',
    check: (c) => c['workload-placement'] === 'management-domain'
      ? [issue('DESIGN_WORKLOADS_IN_MGMT_DOMAIN', 'warning', 'Business workloads in the management domain are allowed ("Can also run business workloads.") but deviate from VCF-WLD-RCMD-CFG-002 "Use workload domains for customer workloads." (justification: "Aligns with the VMware best practice of separating management workloads from customer workloads."). Implication of VCF-WLD-REQD-CFG-001: "You must carefully size the management domain to accommodate planned deployments of additional workload domains and management components."', '05 §4.2, §5 [D5][D6]', 'workload-placement')]
      : NONE,
  },
  {
    // 05 §1 bod 6, §4.2 (A) [D7]: [9.0] VCF-WLD-RCMD-CFG-001 resource pools. 05 §8 q1: model only as 9.0 rule.
    // TODO(spec 05 §8 q1): whether 9.1 dropped or moved the recommendation is open.
    id: 'workloads-in-mgmt-resource-pools-90', decision: 'workload-placement', basis: 'recommendation', ruleId: 'VCF-WLD-RCMD-CFG-001', specRef: '05 §1, §4.2, §8 q1 [D7]',
    description: '[9.0] Workloady v management domain – doporučené resource pooly (VCF-WLD-RCMD-CFG-001).',
    check: (c, ctx) => ctx.version === '9.0' && c['workload-placement'] === 'management-domain'
      ? [issue('DESIGN_MGMT_RESOURCE_POOLS_90', 'warning', '[9.0] VCF-WLD-RCMD-CFG-001: configure vSphere resource pools (cluster-name-rp-sddc-mgmt, cluster-name-rp-sddc-edge, cluster-name-rp-user-edge, cluster-name-rp-user-vm) to control resource usage by management and business workloads. Implication: "You must manually create the vSphere resource pools and manage their settings over time."', '05 §1, §4.2 [D7]', 'workload-placement')]
      : NONE,
  },
  {
    // 05 §3, §4.2 bod 4, §5 [D42]: [9.0] "Workload domains cannot use the NSX Manager cluster for the management domain."
    id: 'nsx-share-mgmt-90', decision: 'wld-nsx-consumption', basis: 'unsupported', specRef: '05 §4.2, §5 [D42]',
    description: '[9.0] WLD nesmí sdílet NSX Manager management domain.',
    check: (c, ctx) => ctx.version === '9.0' && c['wld-nsx-consumption'] === 'shared-with-management-domain'
      ? [issue('NSX_SHARE_MGMT_UNSUPPORTED_90', 'error', 'Workload domains cannot use the NSX Manager cluster for the management domain.', '05 §4.2, §5 [D42]', 'wld-nsx-consumption')]
      : NONE,
  },
  {
    // 05 §4.2 bod 3 [D5]: VCF-MGMT-RCMD-NSX-001 (9.1). Sharing the management domain NSX with a WLD means the
    // management domain NSX instance is no longer dedicated -> deviation (model interpretation of the rule text).
    id: 'nsx-share-mgmt-rcmd', decision: 'wld-nsx-consumption', basis: 'recommendation', ruleId: 'VCF-MGMT-RCMD-NSX-001', specRef: '05 §4.2 [D5][D9]',
    description: '[9.1] Sdílení NSX management domain s WLD – odchylka od VCF-MGMT-RCMD-NSX-001.',
    check: (c, ctx) => ctx.version === '9.1' && c['wld-nsx-consumption'] === 'shared-with-management-domain'
      ? [issue('DESIGN_MGMT_NSX_NOT_DEDICATED', 'warning', 'Deviates from VCF-MGMT-RCMD-NSX-001 "Use a dedicated NSX Manager instance for the management domain." Shared NSX: "A single NSX management and control plane shared across workload domains increases the blast radius." and "Upgrades and patching impact all included workload domains."', '05 §4.2 [D5][D9]', 'wld-nsx-consumption')]
      : NONE,
  },
  {
    // 05 §4.3 table, §4.10 bod 7 ("odvozené z 3") [D24][D25][D39].
    id: 'ops-model-from-deployment-model', decision: 'vcf-operations-model', basis: 'derived', specRef: '05 §4.3, §4.10 [D24][D25][D39]',
    description: 'VCF Operations model musí odpovídat deployment modelu (Simple → 1 uzel, HA → 3 uzly).',
    check: (c) => {
      const m = c['deployment-model'];
      const ops = c['vcf-operations-model'];
      if (!m || !ops || ops === 'continuous-availability' || ops === m) return NONE;
      return [issue('DESIGN_COMPONENT_MODEL_MISMATCH', 'error', `VCF Operations model "${ops}" does not match the deployment model "${m}" chosen in VCF Installer (Simple: VCF-OPS-REQD-SIM-001, HA: VCF-OPS-REQD-HA-001).`, '05 §4.3, §4.10 [D24][D25][D39]', 'vcf-operations-model')];
    },
  },
  {
    // 05 §4.7, §4.10 [D17][D5]: Continuous Availability is Day 2 in the game; not an option of the Management Domain Model.
    // TODO(spec 05 §8 q3).
    id: 'ops-ca-day2', decision: 'vcf-operations-model', basis: 'day2', specRef: '05 §4.7, §4.10, §8 q3 [D17][D5]',
    description: 'Continuous Availability VCF Operations je Day 2.',
    check: (c) => c['vcf-operations-model'] === 'continuous-availability'
      ? [issue('DESIGN_DAY2_ONLY', 'error', 'Continuous Availability for VCF Operations is not an option of the Management Domain Model at deployment; it is a Day 2 topic (open question 05 §8 q3).', '05 §4.7, §4.10 [D17][D5]', 'vcf-operations-model')]
      : NONE,
  },
  {
    // 05 §4.3 table, §4.10 bod 7 [D27][D28][D39].
    id: 'automation-model-from-deployment-model', decision: 'vcf-automation-model', basis: 'derived', specRef: '05 §4.3, §4.10 [D27][D28][D39]',
    description: 'VCF Automation model musí odpovídat deployment modelu.',
    check: (c) => {
      const m = c['deployment-model'];
      const a = c['vcf-automation-model'];
      if (!m || !a || a === m) return NONE;
      return [issue('DESIGN_COMPONENT_MODEL_MISMATCH', 'error', `VCF Automation model "${a}" does not match the deployment model "${m}" chosen in VCF Installer (Simple: VCF-AUTO-REQD-SIM-001, HA: VCF-AUTO-REQD-HA-001).`, '05 §4.3, §4.10 [D27][D28][D39]', 'vcf-automation-model')];
    },
  },
  {
    // 05 §3, §4.8, §5 [D40]: [9.1] "VCF Automation is required to be deployed in the Management Domain only."
    id: 'automation-mgmt-domain-only-91', decision: 'vcf-automation-placement', basis: 'requirement', specRef: '05 §3, §4.8, §5 [D40]',
    description: '[9.1] VCF Automation jen v management domain.',
    check: (c, ctx) => ctx.version === '9.1' && c['vcf-automation-placement'] === 'workload-domain'
      ? [issue('DESIGN_VCF_AUTOMATION_MGMT_DOMAIN_ONLY', 'error', 'Starting with VCF 9.1, VCF Automation is required to be deployed in the Management Domain only.', '05 §3, §4.8, §5 [D40]', 'vcf-automation-placement')]
      : NONE,
  },
  {
    // 05 §4.8 [D40] ([9.0] WLD placement) + §4.2: placement in a WLD needs a workload domain in the design.
    id: 'automation-wld-needs-wld-90', decision: 'vcf-automation-placement', basis: 'requirement', specRef: '05 §4.2, §4.8 [D40]',
    description: '[9.0] VCF Automation ve WLD vyžaduje, aby design obsahoval workload domain.',
    check: (c, ctx) => ctx.version === '9.0' && c['vcf-automation-placement'] === 'workload-domain' && c['workload-placement'] === 'management-domain'
      ? [issue('DESIGN_NO_WORKLOAD_DOMAIN', 'error', 'VCF Automation placement "workload domain" requires a workload domain, but the design runs business workloads in the management domain without a workload domain.', '05 §4.2, §4.8 [D40]', 'vcf-automation-placement')]
      : NONE,
  },
  {
    // 05 §4.6 bod 3, §5 [D14]: "VPC model cannot be consumed via NSX Global Manager."
    id: 'vpc-not-via-global-manager', decision: 'network-consumption-model', basis: 'unsupported', specRef: '05 §4.6, §5 [D14]',
    description: 'VPC nelze konzumovat přes NSX Global Manager.',
    check: (c, ctx) => ctx.nsxFederation && c['network-consumption-model'] === 'vpc'
      ? [issue('DESIGN_VPC_NSX_GLOBAL_MANAGER', 'error', 'VPC model cannot be consumed via NSX Global Manager.', '05 §4.6, §5 [D14]', 'network-consumption-model')]
      : NONE,
  },
  {
    // 05 §4.6 bod 3 [D14] (paraphrase): federation features do not work with All Apps Orgs.
    // Capability limitation, not a documented "unsupported" -> warning.
    id: 'federation-all-apps-orgs', decision: 'network-consumption-model', basis: 'limitation', specRef: '05 §4.6 [D14]', paraphrased: true,
    description: 'Federace nefunguje u All Apps Orgs (parafráze).',
    check: (c, ctx) => ctx.nsxFederation && c['network-consumption-model'] === 'all-apps-orgs'
      ? [issue('DESIGN_FEDERATION_FEATURES_UNAVAILABLE', 'warning', '(paraphrase) Federation features (centralized security policy, L2/L3 extension) do not work with VCF Automation All Apps Orgs.', '05 §4.6 [D14]', 'network-consumption-model')]
      : NONE,
  },
  {
    // 20 §4.2 krok 6 [D39]: "VPC nepodporují IPv6."
    id: 'vpc-no-ipv6', decision: 'network-consumption-model', basis: 'unsupported', specRef: '20 §4.2 krok 6 [D39]',
    description: 'VPC nepodporují IPv6.',
    check: (c) => c['network-consumption-model'] === 'vpc' && c['wld-network-type'] === 'ipv6'
      ? [issue('DESIGN_VPC_IPV6_UNSUPPORTED', 'error', 'VPCs do not support IPv6; choose IPv4 workload networks or another network consumption model.', '20 §4.2 krok 6 [D39]', 'network-consumption-model')]
      : NONE,
  },
];

// TODO(orchestrator): constraints NOT modelled because spec 05 does not state them:
//  - identity broker Embedded vs. SSO model Fleet-Wide / Cross-Instance with several instances,
//  - Distributed Switch model vs. principal storage (e.g. Storage Separation with VMFS on FC),
//  - NSX stretched overlay management network vs. fleet model,
//  - Simple deployment model vs. Site HA / DR fleet models.

// ===========================================================================
// Validation
// ===========================================================================

/**
 * Validates the whole design (05 §3, §5): missing decisions, unknown options, constraints.
 * Every issue has `subject` = decision id so the UI can attach it to the right fieldset.
 */
export function validateDesign(choices: DesignChoices, context: DesignContext = {}): ValidationIssue[] {
  const ctx = ctxOf(context);
  const out: ValidationIssue[] = [];
  for (const def of applicableDecisions(choices)) {
    const v = choices[def.id];
    if (v === undefined)
      out.push(issue('DESIGN_DECISION_MISSING', 'error', `Design decision "${def.id}" has not been made.`, def.specRef, def.id));
    else if (!def.options.some((o) => o.id === v))
      out.push(issue('DESIGN_OPTION_UNKNOWN', 'error', `Unknown option "${v}" for design decision "${def.id}".`, def.specRef, def.id));
  }
  const eff = effectiveChoices(choices);
  for (const c of DESIGN_CONSTRAINTS) out.push(...c.check(eff, ctx));
  return out;
}

export interface OptionAvailability {
  /** False when choosing the option yields an error on this decision (UI: disabled + reason). */
  readonly available: boolean;
  readonly errors: readonly ValidationIssue[];
  /** RCMD deviations the player may accept. */
  readonly warnings: readonly ValidationIssue[];
}

/**
 * What happens if `option` is chosen for `decision`, given the other current choices.
 * Only constraint issues attached to this decision are reported (missing other decisions are ignored).
 */
export function optionAvailability(
  decision: DesignDecisionId,
  option: string,
  choices: DesignChoices,
  context: DesignContext = {},
): OptionAvailability {
  const ctx = ctxOf(context);
  const eff = effectiveChoices({ ...choices, [decision]: option });
  const issues = DESIGN_CONSTRAINTS.filter((c) => c.decision === decision).flatMap((c) => c.check(eff, ctx));
  const errors = issues.filter((i) => i.severity === 'error');
  return { available: errors.length === 0, errors, warnings: issues.filter((i) => i.severity === 'warning') };
}

/**
 * Changing a design decision after the management domain has been deployed (05 §4.5, §5 [D39]):
 * "the principal storage type for a cluster cannot be changed".
 * TODO(spec 05 §8 q6): Simple -> HA for the whole instance is undocumented; other decisions are not checked.
 */
export function validateRedesign(
  previous: DesignChoices,
  next: DesignChoices,
  phase: 'design' | 'deployed',
): ValidationIssue[] {
  if (phase !== 'deployed') return [];
  if (previous['principal-storage'] !== undefined && next['principal-storage'] !== previous['principal-storage'])
    return [issue('DESIGN_PRINCIPAL_STORAGE_IMMUTABLE', 'error', 'The principal storage type for a cluster cannot be changed. Add a new cluster with a different principal storage instead.', '05 §4.5, §5 [D39]', 'principal-storage')];
  return [];
}

// ===========================================================================
// Derived bring-up parameters (05 §4.10: steps 3, 5, 6 = VCF Installer wizard steps 5, 6, 7, 15 [D39])
// ===========================================================================

export interface DesignBringupParams {
  /** Wizard step 5. */
  readonly model: DeploymentModel;
  readonly size: DeploymentSize;
  /** Wizard step 7 (principal storage of the default cluster). */
  readonly storage: StorageType;
  /** First management cluster model (input of validateManagementHostCount). */
  readonly clusterModel: ClusterModel;
  /** NSX Manager model for the management domain (05 §4.3 table [D19][D20]). */
  readonly nsxManagerModel: NsxManagerModel;
  /** Wizard step 6 – fields determined by the design; the rest (VM management network, IP schemes) is planning. */
  readonly networkConfig: Pick<NetworkConfiguration, 'vcfManagementNetwork' | 'deployOpsAndAutomationToCustomNetwork' | 'vpcNetwork' | 'vpcGatewayConnectivity'>;
  /** Wizard step 15 profile suggested by the Distributed Switch model (see mapping note). */
  readonly vdsProfile: VdsProfile;
  readonly distributedSwitchModel: DistributedSwitchModel;
  readonly managementNetworkModel: ManagementNetworkModel;
  readonly ssoModel: SsoModel | 'none';
}

export type DeriveResult =
  | { readonly ok: true; readonly params: DesignBringupParams; readonly warnings: readonly ValidationIssue[] }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * Derives the bring-up inputs from a valid design. Fails if validateDesign reports errors.
 *
 * Mapping notes (model inference, not documented 1:1 – TODO(orchestrator) confirm):
 *  - management network model -> wizard step 6: shared-vlan = VCF management network shared with VM management;
 *    dedicated-vlan = dedicated; NSX overlay variants = dedicated + "Deploy VCF Operations and VCF Automation to a
 *    specific vSphere distributed switch or NSX segment" (05 §4.6 bod 2 [D16], 20 §4.2 krok 6).
 *  - Distributed Switch model -> wizard profile: single = Default Configuration (1 switch), storage-separation =
 *    Storage Traffic Separation; all other models = Custom Switch Configuration (20 §4.2 krok 15).
 */
export function deriveBringupParams(choices: DesignChoices, context: DesignContext = {}): DeriveResult {
  const issues = validateDesign(choices, context);
  if (hasErrors(issues)) return { ok: false, issues };
  const c = effectiveChoices(choices);
  const model = c['deployment-model'] as DeploymentModel;
  const mnm = c['management-network-model'] as ManagementNetworkModel;
  const vds = c['distributed-switch-model'] as DistributedSwitchModel;
  const overlay = mnm === 'dedicated-vlan-nsx-overlay' || mnm === 'dedicated-vlan-nsx-stretched-overlay';
  const sso = c['sso-model'] as SsoModel | 'none';
  return {
    ok: true,
    warnings: issues,
    params: {
      model,
      size: c['deployment-size'] as DeploymentSize,
      storage: c['principal-storage'] as StorageType,
      clusterModel: c['mgmt-cluster-model'] as ClusterModel,
      nsxManagerModel: model === 'simple' ? 'simple' : 'high-availability',
      networkConfig: {
        vcfManagementNetwork: mnm === 'shared-vlan' ? 'shared-with-vm-management' : 'dedicated',
        deployOpsAndAutomationToCustomNetwork: overlay,
        vpcNetwork: c['vpc-network-type'] as NetworkConfiguration['vpcNetwork'],
        vpcGatewayConnectivity: c['vpc-gateway-connectivity'] as NetworkConfiguration['vpcGatewayConnectivity'],
      },
      vdsProfile: vds === 'single' ? 'default' : vds === 'storage-separation' ? 'storage-traffic-separation' : 'custom',
      distributedSwitchModel: vds,
      managementNetworkModel: mnm,
      ssoModel: sso,
    },
  };
}

// ===========================================================================
// Summary of consequences
// ===========================================================================

export interface WorkloadDomainHostMinimum {
  /** Minimum hosts per WLD cluster with vSAN / with NFS or FC (10 §6.1); undefined = not in the spec. */
  readonly vsan?: number;
  readonly nfsOrFc?: number;
  readonly specRef: string;
  /** 10 §6.1 footnote ¹: values for WLD assumed from merged table cells. */
  readonly openQuestion: '10 §8 q2';
}

/**
 * Minimum hosts per workload domain cluster (10 §6.1 [P9][P11][P12][P13]). The WLD principal storage is not a
 * decision of this phase, so both values are returned.
 */
export function minWorkloadDomainClusterHosts(clusterModel: ClusterModel, model: DeploymentModel): WorkloadDomainHostMinimum {
  const oq = '10 §8 q2' as const;
  switch (clusterModel) {
    case 'single-rack':
      return { vsan: model === 'simple' ? 3 : 4, nfsOrFc: model === 'simple' ? 2 : 4, specRef: '10 §6.1 [P9]', openQuestion: oq };
    case 'multi-rack-l2':
      return { vsan: 3, nfsOrFc: 2, specRef: '10 §6.1 [P11]', openQuestion: oq };
    case 'multi-rack-l3':
      return { vsan: 3, nfsOrFc: 2, specRef: '10 §6.1 [P12]', openQuestion: oq };
    case 'stretched':
      // vSAN Simple 6; vMSC Simple min. 1 + 1; HA values unclear from extraction.
      return model === 'simple'
        ? { vsan: 6, nfsOrFc: 2, specRef: '10 §6.1 [P13]', openQuestion: oq }
        : { specRef: '10 §6.1 [P13]', openQuestion: oq };
  }
}

export interface DesignConsequenceEntry extends DesignConsequence {
  readonly decision: DesignDecisionId;
  /** undefined = decision-level consequence. */
  readonly option?: string;
}

export interface DesignSummary {
  readonly domains: readonly ('management' | 'workload')[];
  /** DR / Fault Domains and DR need a second VCF Instance (05 §3 [D11]). */
  readonly instances: 1 | 2 | undefined;
  /** Site HA / Fault Domains and DR span two availability zones with a witness (05 §4.1 [D11]). */
  readonly twoAvailabilityZones: boolean | undefined;
  /** Management domain default cluster minimum (10 §6.1 via minManagementDefaultClusterHosts); undefined = unknown. */
  readonly managementDomainMinHosts: number | undefined;
  readonly workloadDomainMinHosts: WorkloadDomainHostMinimum | undefined;
  /** NSX Manager clusters to deploy: management domain + dedicated WLD NSX if chosen. */
  readonly nsxManagers: readonly { readonly domain: 'management' | 'workload'; readonly nodes: number }[];
  readonly componentNodes: {
    readonly vcfOperations?: number;
    readonly vcfAutomation?: number;
    /** 05 §4.3 [D22][D23]; Simple workers: 3 per [D22] vs 2 per sizing (05 §8 q5). HA workers: "corresponding number". */
    readonly managementServicesControlPlane?: number;
    readonly managementServicesWorkersOpenQuestion: '05 §8 q5';
  };
  readonly appliedRules: readonly string[];
  readonly deviatedRules: readonly string[];
  readonly consequences: readonly DesignConsequenceEntry[];
  /** Day 2 follow-ups implied by the design (consequences of kind 'day2'). */
  readonly dayTwo: readonly DesignConsequenceEntry[];
}

/** Summary of a (possibly partial) design. Pure; uses only decided, applicable choices. */
export function summarizeDesign(choices: DesignChoices): DesignSummary {
  const c = effectiveChoices(choices);
  const model = c['deployment-model'] as DeploymentModel | undefined;
  const wld = c['workload-placement'] === 'workload-domain';
  const fleet = c['fleet-deployment-model'];
  const storage = c['principal-storage'];
  const installerStorage = storage === 'vsan-esa' || storage === 'vsan-osa' || storage === 'vmfs-fc' || storage === 'nfs-v3';
  const cm = c['mgmt-cluster-model'] as ClusterModel | undefined;
  const wcm = c['wld-cluster-model'] as ClusterModel | undefined;

  const consequences: DesignConsequenceEntry[] = [];
  const applied = new Set<string>();
  const deviated = new Set<string>();
  for (const def of applicableDecisions(c)) {
    const v = c[def.id];
    if (v === undefined) continue;
    for (const k of def.consequences) consequences.push({ ...k, decision: def.id });
    for (const r of def.rules) (r.relation === 'applies' ? applied : deviated).add(r.id);
    const opt = def.options.find((o) => o.id === v);
    if (!opt) continue;
    for (const k of opt.consequences) consequences.push({ ...k, decision: def.id, option: opt.id });
    for (const r of opt.rules) (r.relation === 'applies' ? applied : deviated).add(r.id);
  }

  const nsxNodes = model ? NSX_MANAGER_NODES[model === 'simple' ? 'simple' : 'high-availability'] : undefined;
  const nsxManagers: { domain: 'management' | 'workload'; nodes: number }[] = [];
  if (nsxNodes !== undefined) {
    nsxManagers.push({ domain: 'management', nodes: nsxNodes });
    // WLD NSX Manager model (Simple/HA) is a separate WLD option (05 §2.4) – assumed equal to the deployment model.
    // TODO(area 40-workload-domains): model WLD NSX Manager sizing separately.
    if (wld && c['wld-nsx-consumption'] === 'dedicated') nsxManagers.push({ domain: 'workload', nodes: nsxNodes });
  }

  return {
    domains: wld ? ['management', 'workload'] : ['management'],
    instances: fleet === undefined ? undefined : fleet === 'disaster-recovery' || fleet === 'fault-domains-and-dr' ? 2 : 1,
    twoAvailabilityZones: fleet === undefined ? undefined : MULTI_AZ_FLEETS.includes(fleet),
    managementDomainMinHosts: model && cm && installerStorage ? minManagementDefaultClusterHosts(cm, model, storage) : undefined,
    workloadDomainMinHosts: wld && wcm && model ? minWorkloadDomainClusterHosts(wcm, model) : undefined,
    nsxManagers,
    componentNodes: {
      ...(model ? { vcfOperations: model === 'simple' ? 1 : 3 } : {}),
      ...(model ? { vcfAutomation: model === 'simple' ? 1 : 3 } : {}),
      ...(model ? { managementServicesControlPlane: model === 'simple' ? 1 : 3 } : {}),
      managementServicesWorkersOpenQuestion: '05 §8 q5',
    },
    appliedRules: [...applied],
    deviatedRules: [...deviated],
    consequences,
    dayTwo: consequences.filter((k) => k.kind === 'day2'),
  };
}
