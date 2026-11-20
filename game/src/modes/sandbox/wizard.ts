/**
 * Wizard "Deploy a new VCF fleet" (20 §4.2) support for the Sandbox: draft spec, prefill from the
 * design (deriveBringupParams), per-step issue buckets for the UI.
 *
 * All checks call the model's exported sub-validators; the union of the step buckets is compared
 * with validateBringupSpec so that any check the model adds later is still shown (in
 * 'review-validation') rather than silently dropped.
 */
import {
  type BringupEnvironment,
  type BringupSpec,
  type DesignBringupParams,
  type DistributedSwitchSpec,
  type TrafficType,
  type ValidationIssue,
  type VdsProfile,
  type WizardStep,
  DEFAULT_SIZE,
  FIRST_INSTANCE_SIZING,
  MODELLED_VCF_VERSION,
  SERVICES_RUNTIME_INTERNAL_CIDRS_IPV4,
  WIZARD_STEPS,
  sizingProfileOf,
  validateBinariesForDeployment,
  validateBringupSpec,
  validateComponentFqdns,
  validateDeploymentModel,
  validateDistributedSwitches,
  validateExistingComponents,
  validateGeneralConfiguration,
  validateHostEntries,
  validateInstallerCanDeploy,
  validateIpPools,
  validateNetworkConfiguration,
  validateNsxManager,
  validateReachability,
  validateSddcManager,
  validateStorage,
} from '../../model';
import type { WizardSection } from './types';

/** Stable identity of an issue for acknowledgement / de-duplication. */
export const issueKey = (i: ValidationIssue): string => `${i.code}|${i.subject ?? ''}`;

const fullKey = (i: ValidationIssue): string => `${i.code}|${i.subject ?? ''}|${i.message}`;

/** Wizard page on which each spec section is entered (20 §4.2). */
export const WIZARD_SECTION_STEP: Readonly<Record<WizardSection, WizardStep>> = {
  target: 'select-what-to-deploy',
  existing: 'existing-components',
  model: 'deployment-model-and-size',
  size: 'deployment-model-and-size',
  networkConfig: 'network-configuration',
  storage: 'storage-type',
  general: 'general-configuration',
  esxHosts: 'esx-host-details',
  networks: 'network-details',
  components: 'vcf-management-components',
  vcenter: 'vcenter-details',
  storageDetails: 'storage-details',
  vds: 'distributed-switch',
  nsx: 'nsx-manager-details',
  sddcManager: 'sddc-manager-details',
};

/**
 * Spec fields determined by the design phase (deriveBringupParams). The wizard cannot change them;
 * the player changes the design instead.
 */
export const DESIGN_LOCKED_FIELDS = [
  'model',
  'size',
  'storage.type',
  'networkConfig.vcfManagementNetwork',
  'networkConfig.deployOpsAndAutomationToCustomNetwork',
  'networkConfig.vpcNetwork',
  'networkConfig.vpcGatewayConnectivity',
  'vds.profile',
] as const;
export type DesignLockedField = (typeof DESIGN_LOCKED_FIELDS)[number];

function lockedValue(spec: BringupSpec, f: DesignLockedField): string | boolean {
  switch (f) {
    case 'model':
      return spec.model;
    case 'size':
      return spec.size;
    case 'storage.type':
      return spec.storage.type;
    case 'networkConfig.vcfManagementNetwork':
      return spec.networkConfig.vcfManagementNetwork;
    case 'networkConfig.deployOpsAndAutomationToCustomNetwork':
      return spec.networkConfig.deployOpsAndAutomationToCustomNetwork;
    case 'networkConfig.vpcNetwork':
      return spec.networkConfig.vpcNetwork;
    case 'networkConfig.vpcGatewayConnectivity':
      return spec.networkConfig.vpcGatewayConnectivity;
    case 'vds.profile':
      return spec.vds.profile;
  }
}

/** Locked fields whose value differs between two specs. */
export function changedLockedFields(a: BringupSpec, b: BringupSpec): DesignLockedField[] {
  return DESIGN_LOCKED_FIELDS.filter((f) => lockedValue(a, f) !== lockedValue(b, f));
}

/**
 * VMkernel "Recommended MTU Size" for vMotion / vSAN / NFS / Host TEP = 9000 (10 §3.3 [P18]).
 * Used only as the wizard prefill; the player may change it.
 */
export const RECOMMENDED_VMK_MTU = 9000;

const ALL_TRAFFIC: readonly TrafficType[] = ['esx-management', 'vcf-management', 'vm-management', 'vmotion', 'vsan', 'nsx'];

/**
 * ILUSTRATIVNÍ prefill of distributed switches for a wizard profile. Spec 20 §4.2 step 15 gives only
 * profile names and switch counts (Default 1, Storage Traffic Separation 2, NSX Traffic Separation 2);
 * how traffic types are split and the uplink count are game defaults the player can edit.
 * 'custom' keeps the current switches.
 */
export function illustrativeSwitchesFor(profile: VdsProfile, prefix: string, current: readonly DistributedSwitchSpec[]): DistributedSwitchSpec[] {
  const sw = (n: number, trafficTypes: readonly TrafficType[]): DistributedSwitchSpec => ({
    name: `${prefix || 'mgmt'}-vds0${n}`,
    uplinks: 2,
    uplinkMode: 'vds-uplinks',
    trafficTypes,
    // Default load balancing "Route Based on Physical NIC Load" (20 §4.2 step 15 [S14]).
    loadBalancing: 'route-based-on-physical-nic-load',
  });
  switch (profile) {
    case 'default':
      return [sw(1, ALL_TRAFFIC)];
    case 'storage-traffic-separation':
      return [sw(1, ALL_TRAFFIC.filter((t) => t !== 'vsan')), sw(2, ['vsan'])];
    case 'nsx-traffic-separation':
      return [sw(1, ALL_TRAFFIC.filter((t) => t !== 'nsx')), sw(2, ['nsx'])];
    case 'custom':
      return [...current];
  }
}

const emptyHostNet = () => ({ vlanId: 0, cidr: '', gateway: '', mtu: RECOMMENDED_VMK_MTU, inclusionRanges: [] });

/** Empty wizard draft for a new fleet. Only documented defaults are filled in. */
export function initialSpecDraft(): BringupSpec {
  return {
    target: 'new-fleet',
    existing: { existingVcfOperations: false, existingVcenter: false, vcenterRegisteredWithNsx: false, existingVcfAutomationOrDeployLater: false },
    model: 'simple',
    size: DEFAULT_SIZE.simple,
    networkConfig: {
      vmManagementNetwork: 'shared-with-esx-management',
      vcfManagementNetwork: 'shared-with-vm-management',
      dualStack: false,
      vmotionIpScheme: 'ipv4',
      storageIpScheme: 'ipv4',
      deployOpsAndAutomationToCustomNetwork: false,
      vpcNetwork: 'full-stack',
      vpcGatewayConnectivity: 'centralized',
    },
    storage: { type: 'vsan-esa' },
    general: {
      version: MODELLED_VCF_VERSION,
      instanceName: '',
      managementDomainName: '',
      ceip: false,
      dnsServers: [],
      ntpServers: [],
      dnsDomainName: '',
      autogeneratePasswords: false,
    },
    esxHosts: [],
    networks: {
      esxManagement: { vlanId: 0, cidr: '', gateway: '' },
      managementServicesIpPool: { kind: 'addresses', addresses: [] },
      vmotion: emptyHostNet(),
      storage: emptyHostNet(),
      nsxHostOverlay: emptyHostNet(),
    },
    // Default internal cluster CIDR (20 §3.5, §6.5 [S19][S21]).
    components: { internalClusterCidrIpv4: SERVICES_RUNTIME_INTERNAL_CIDRS_IPV4[0] },
    vcenter: { fqdn: '' },
    storageDetails: { datastoreName: '' },
    vds: { profile: 'default', switches: illustrativeSwitchesFor('default', '', []) },
    nsx: { nodeFqdns: [''], vipFqdn: '' },
    sddcManager: { fqdn: '' },
  };
}

/**
 * Writes the design-derived parameters into the wizard draft (05 §4.10 -> 20 §4.2 steps 5, 6, 7, 15):
 * model, size, storage type, design-driven network configuration, VDS profile; resizes the NSX
 * Manager node list to the sizing node count (20 §2.1, §6.4).
 */
export function applyDesignToSpec(spec: BringupSpec, p: DesignBringupParams): BringupSpec {
  const nsxNodes = FIRST_INSTANCE_SIZING[sizingProfileOf(p.model, p.size)].nsx.nodes;
  const nodeFqdns = Array.from({ length: nsxNodes }, (_, i) => spec.nsx.nodeFqdns[i] ?? '');
  const vds =
    spec.vds.profile === p.vdsProfile
      ? spec.vds
      : { profile: p.vdsProfile, switches: illustrativeSwitchesFor(p.vdsProfile, spec.general.managementDomainName, spec.vds.switches) };
  return {
    ...spec,
    model: p.model,
    size: p.size,
    storage: { ...spec.storage, type: p.storage },
    networkConfig: { ...spec.networkConfig, ...p.networkConfig },
    vds,
    nsx: { ...spec.nsx, nodeFqdns },
  };
}

/** 'recommendation' = only documented recommendations (non-blocking hints); 'info' = page without checks. */
export type StepStatus = 'ok' | 'recommendation' | 'warning' | 'error' | 'info';

export interface WizardStepReport {
  readonly step: WizardStep;
  readonly status: StepStatus;
  /** Live pre-check issues of this page (model issues, unchanged). */
  readonly issues: readonly ValidationIssue[];
}

const NSX_FQDN = /^NSX Manager/;

/**
 * Live per-page issue buckets (UI preview; the authoritative result is the timed "Review validation"
 * of the deployment state machine). Pages without checks have status 'info'.
 */
export function wizardStepReports(spec: BringupSpec, env: BringupEnvironment): WizardStepReport[] {
  const fqdnIssues = validateComponentFqdns(spec, env);
  const storage = validateStorage(spec);
  const isStorageDetails = (i: ValidationIssue): boolean => i.code === 'DATASTORE_NAME_MISSING' || i.code === 'NFS_DETAILS_MISSING';
  const buckets: Partial<Record<WizardStep, ValidationIssue[]>> = {
    login: validateInstallerCanDeploy(env.installer),
    'existing-components': validateExistingComponents(spec),
    'deployment-model-and-size': validateDeploymentModel(spec),
    'network-configuration': validateNetworkConfiguration(spec, env.installer),
    'storage-type': storage.filter((i) => !isStorageDetails(i)),
    'general-configuration': validateGeneralConfiguration(spec, env),
    'esx-host-details': validateHostEntries(spec, env),
    'network-details': validateIpPools(spec, env),
    'vcf-management-components': fqdnIssues.filter((i) => i.subject !== 'vCenter FQDN' && i.subject !== 'SDDC Manager FQDN' && !NSX_FQDN.test(i.subject ?? '')),
    'vcenter-details': fqdnIssues.filter((i) => i.subject === 'vCenter FQDN'),
    'storage-details': storage.filter(isStorageDetails),
    'distributed-switch': validateDistributedSwitches(spec, env),
    'nsx-manager-details': [...validateNsxManager(spec), ...fqdnIssues.filter((i) => NSX_FQDN.test(i.subject ?? ''))],
    'sddc-manager-details': [...validateSddcManager(spec, env.installer), ...fqdnIssues.filter((i) => i.subject === 'SDDC Manager FQDN')],
    'review-validation': [...validateReachability(spec, env), ...validateBinariesForDeployment(env.depot)],
  };
  // Anything validateBringupSpec reports that no page bucket covers goes to "Review validation".
  const covered = new Set(Object.values(buckets).flatMap((l) => (l ?? []).map(fullKey)));
  const rest = validateBringupSpec(spec, env).filter((i) => !covered.has(fullKey(i)));
  buckets['review-validation'] = [...(buckets['review-validation'] ?? []), ...rest];

  return WIZARD_STEPS.map((step) => {
    const issues = buckets[step];
    if (issues === undefined) return { step, status: 'info' as const, issues: [] };
    const has = (sev: ValidationIssue['severity']): boolean => issues.some((i) => i.severity === sev);
    const status: StepStatus = has('error') ? 'error' : has('warning') ? 'warning' : issues.length > 0 ? 'recommendation' : 'ok';
    return { step, status, issues };
  });
}
