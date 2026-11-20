/**
 * Bring-up of the first VCF Instance (new VCF fleet + management domain) via VCF Installer.
 * Source of truth: docs/spec/20-deployment.md (modelled version VCF 9.1.1).
 * References like "20 §3.2 [S9]" point to sections / sources of that spec file.
 *
 * Scope:
 *  - Preparation phase: ESX host preparation, VCF Installer appliance, depot + binaries (20 §4.1).
 *  - Deployment phase: wizard "Deploy a new VCF fleet" inputs (20 §4.2), validation (20 §5.1),
 *    deployment state machine (20 §4.2 steps 18–20, §5.1).
 *  - Result: Fleet / Instance / management domain objects (00 + 20 §2.1).
 *
 * Not modelled (see report / TODOs): convergence (20 §4.6), upgrade (20 §4.7), VVF wizard,
 * [9.0] wizard differences (20 §4.2 "[9.0] rozdíly"), deferred components (20 §4.5).
 *
 * Pure TypeScript: no DOM, no PixiJS, no randomness, no time. Durations are the engine's job.
 */
import {
  type Cluster,
  type ClusterModel,
  type DeployedComponent,
  type Domain,
  type Fleet,
  type Instance,
  MODELLED_VCF_VERSION,
} from './architecture';
import {
  type DnsRecords,
  type IpPool,
  checkForwardReverse,
  cidrContains,
  expandPool,
  formatIpv4,
  isNetworkOrBroadcast,
  parseCidr,
  parseIpv4,
} from './net';
import { type TransitionResult, type ValidationCode, type ValidationIssue, hasErrors, issue, warningsOf } from './validation';

// ===========================================================================
// Constants from the spec
// ===========================================================================

/** VCF Installer VM resources: 4 vCPU, 16 GB RAM, 914 GB storage (20 §3.3, §6.1 [S6][S35]). */
export const INSTALLER_APPLIANCE_RESOURCES = { vcpu: 4, ramGb: 16, storageGb: 914 } as const;

/** OVA file name pattern (20 §3.3 [S6]). */
export const INSTALLER_OVA_PATTERN = 'VCF-SDDC-Manager-Appliance-<version.build_number>.ova';

/** Minimum installer version for the deployment wizard (20 §3.3 [S14][S15]). */
export const MIN_INSTALLER_VERSION_FOR_WIZARD = '9.1.1';

/** Installer password policy (20 §3.6 [S6]). */
export const INSTALLER_PASSWORD_MIN_LENGTH = 15;
export const INSTALLER_PASSWORD_SPECIAL_CHARS = ['@', '!', '#', '$', '%', '?', '^'] as const;

/** Max DNS servers in the OVF template (20 §4.1.5 step 9, §6.1 [S6]). */
export const INSTALLER_MAX_DNS_SERVERS = 2;

/** Original self-signed certificate CN on a fresh ESX host (20 §3.2 [S11]). */
export const ESX_DEFAULT_CERT_CN = 'localhost.localdomain';

/** VCF services runtime IPs: minimum 12, recommended 30 (20 §3.5, §6.4 [S19]). */
export const SERVICES_RUNTIME_MIN_IPS = 12;
export const SERVICES_RUNTIME_RECOMMENDED_IPS = 30;

/** VCF Automation IP range: 5 IPs (3 for nodes + 2 buffer) (20 §3.5 [S19]). */
export const VCF_AUTOMATION_IPS = 5;

/** VCF services runtime internal cluster CIDR: default + alternatives (20 §3.5, §6.5 [S19][S21]). */
export const SERVICES_RUNTIME_INTERNAL_CIDRS_IPV4 = ['198.18.0.0/15', '240.0.0.0/15', '250.0.0.0/15'] as const;
export const SERVICES_RUNTIME_DEFAULT_INTERNAL_CIDR_IPV6 = 'fd00::/111';

/** Binaries for a new VCF deployment (16) (20 §3.4 [S12]). */
export const VCF_BINARIES = [
  'Cloud proxy',
  'Fleet lifecycle',
  'Identity broker',
  'License server',
  'Migration service engine',
  'Salt master',
  'Salt RaaS',
  'SDDC lifecycle',
  'SDDC Manager',
  'Software depot',
  'Telemetry',
  'VCF Automation',
  'VCF Operations',
  'VCF services runtime',
  'VMware NSX',
  'VMware vCenter',
] as const;
export type VcfBinary = (typeof VCF_BINARIES)[number];

/** Binaries for VVF (8) (20 §3.4 [S12]). Listed for completeness; VVF wizard not modelled. */
export const VVF_BINARIES = [
  'Fleet lifecycle',
  'License server',
  'SDDC lifecycle',
  'Software depot',
  'Telemetry',
  'VCF Operations',
  'VCF services runtime',
  'VMware vCenter',
] as const;

/** Wizard steps "Deploy a new VCF fleet" in documented order (20 §4.2 [S14]), VCF Installer 9.1.x. */
export const WIZARD_STEPS = [
  'login',
  'deployment-wizard-intro',
  'select-what-to-deploy',
  'existing-components',
  'deployment-model-and-size',
  'network-configuration',
  'storage-type',
  'review-prerequisites',
  'general-configuration',
  'esx-host-details',
  'network-details',
  'vcf-management-components',
  'vcenter-details',
  'storage-details',
  'distributed-switch',
  'nsx-manager-details',
  'sddc-manager-details',
  'review-deployment-information',
  'review-validation',
  'deploy',
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Post-deployment steps (20 §4.4 [S14][S15]). */
export const POST_DEPLOYMENT_STEPS = [
  'do-not-move-management-vms', // do not move mgmt services / VCF Automation VMs to another resource pool / folder
  'license-environment',
  'review-passwords',
  'download-json-spec-optional',
  'deploy-remaining-components',
  'file-based-backup',
  'vcf-operations-ha-drs-anti-affinity',
] as const;

/** Order of completing components after bring-up (20 §2.2 [S18]). */
export const COMPLETION_ORDER = [
  'log-management',
  'vcf-operations-for-networks',
  'real-time-metrics',
  'vcf-operations-orchestrator',
  'vcf-operations-hcx-optional',
] as const;

/**
 * Host counts documented only in the convergence context (20 §6.3 [S25]):
 * "Simple: 3 ESX hosts with vSAN or 2 with external storage; HA: 4 ESX hosts".
 * Kept for the convergence workflow; greenfield bring-up uses minManagementDefaultClusterHosts()
 * (spec 10 §6.1), which documents the same 3/2/4 numbers for the first management cluster.
 */
export const CONVERGENCE_MIN_HOSTS = { simpleVsan: 3, simpleExternalStorage: 2, ha: 4 } as const;

// ===========================================================================
// Deployment model & sizing (20 §4.2 step 5, §6.2 [S14][S23])
// ===========================================================================

export type DeploymentModel = 'simple' | 'high-availability';
export type DeploymentSize = 'small' | 'medium' | 'large';
export type SizingProfile = 'simple' | 'ha-small' | 'ha-medium' | 'ha-large';

/** [9.1.1+] Small is default for Simple and HA; Medium and Large only for HA (20 §4.2 step 5 [S14]). */
export const ALLOWED_SIZES: Readonly<Record<DeploymentModel, readonly DeploymentSize[]>> = {
  simple: ['small'],
  'high-availability': ['small', 'medium', 'large'],
};
export const DEFAULT_SIZE: Readonly<Record<DeploymentModel, DeploymentSize>> = {
  simple: 'small',
  'high-availability': 'small',
};
// NOTE: [9.1] (9.1.0) differs: Simple only Small; HA Medium (default) or Large. Not modelled as
// a version parameter because the wizard requires VCF Installer 9.1.1+ (20 §3.3).

export function sizingProfileOf(model: DeploymentModel, size: DeploymentSize): SizingProfile {
  if (model === 'simple') return 'simple';
  return size === 'small' ? 'ha-small' : size === 'medium' ? 'ha-medium' : 'ha-large';
}

export interface ComponentSizing {
  readonly nodes: number;
  readonly size: string;
}

export interface InstanceSizing {
  readonly managementServices: { readonly controlPlaneNodes: number; readonly workerNodes: number };
  readonly sddcManager: ComponentSizing;
  readonly vcenter: ComponentSizing;
  readonly nsx: ComponentSizing;
  readonly vcfOperations?: ComponentSizing;
  readonly licenseServer?: ComponentSizing;
  readonly cloudProxy: ComponentSizing;
  readonly vcfAutomation?: ComponentSizing;
  readonly totals: { readonly vcpu: number; readonly ramGb: number; readonly diskGb: number };
}

/**
 * Sizing for the first VCF Instance (20 §6.2 [S23], same as 00 §6 [S19]).
 * TODO(spec 00 §8 q1): Simple management services: sizing says 1 CP + 2 workers, taxonomy says 3 workers.
 * TODO(spec 00 §8 q2): VCF Automation HA-Small "1x Medium" vs [S15] "Medium -> 3 nodes" vs 20 §2.1 (HA nodes 2/3 = Yes).
 */
export const FIRST_INSTANCE_SIZING: Readonly<Record<SizingProfile, InstanceSizing>> = {
  simple: {
    managementServices: { controlPlaneNodes: 1, workerNodes: 2 },
    sddcManager: { nodes: 1, size: 'Default' },
    vcenter: { nodes: 1, size: 'Small' },
    nsx: { nodes: 1, size: 'Medium' },
    vcfOperations: { nodes: 1, size: 'Small' },
    licenseServer: { nodes: 1, size: 'Default' },
    cloudProxy: { nodes: 1, size: 'Small' },
    vcfAutomation: { nodes: 1, size: 'Small' },
    totals: { vcpu: 76, ramGb: 251, diskGb: 7448 },
  },
  'ha-small': {
    managementServices: { controlPlaneNodes: 3, workerNodes: 3 },
    sddcManager: { nodes: 1, size: 'Default' },
    vcenter: { nodes: 1, size: 'Small' },
    nsx: { nodes: 3, size: 'Medium' },
    vcfOperations: { nodes: 2, size: 'Small' },
    licenseServer: { nodes: 1, size: 'Default' },
    cloudProxy: { nodes: 1, size: 'Small' },
    vcfAutomation: { nodes: 1, size: 'Medium' },
    totals: { vcpu: 106, ramGb: 335, diskGb: 8422 },
  },
  'ha-medium': {
    managementServices: { controlPlaneNodes: 3, workerNodes: 3 },
    sddcManager: { nodes: 1, size: 'Default' },
    vcenter: { nodes: 1, size: 'Medium' },
    nsx: { nodes: 3, size: 'Medium' },
    vcfOperations: { nodes: 3, size: 'Medium' },
    licenseServer: { nodes: 1, size: 'Default' },
    cloudProxy: { nodes: 1, size: 'Standard' },
    vcfAutomation: { nodes: 3, size: 'Medium' },
    totals: { vcpu: 184, ramGb: 656, diskGb: 11445 },
  },
  'ha-large': {
    managementServices: { controlPlaneNodes: 3, workerNodes: 4 },
    sddcManager: { nodes: 1, size: 'Default' },
    vcenter: { nodes: 1, size: 'Large' },
    nsx: { nodes: 3, size: 'Large' },
    vcfOperations: { nodes: 3, size: 'Large' },
    licenseServer: { nodes: 1, size: 'Default' },
    cloudProxy: { nodes: 1, size: 'Standard' },
    vcfAutomation: { nodes: 3, size: 'Large' },
    totals: { vcpu: 298, ramGb: 949, diskGb: 15357 },
  },
};

/** Sizing for an additional VCF Instance (00 §6 [S19], 20 §6.2 [S23]). */
export const ADDITIONAL_INSTANCE_SIZING: Readonly<Record<SizingProfile, InstanceSizing>> = {
  simple: {
    managementServices: { controlPlaneNodes: 1, workerNodes: 2 },
    sddcManager: { nodes: 1, size: 'Default' },
    vcenter: { nodes: 1, size: 'Small' },
    nsx: { nodes: 1, size: 'Medium' },
    cloudProxy: { nodes: 1, size: 'Small' },
    totals: { vcpu: 34, ramGb: 111, diskGb: 4562 },
  },
  'ha-small': {
    managementServices: { controlPlaneNodes: 3, workerNodes: 2 },
    sddcManager: { nodes: 1, size: 'Default' },
    vcenter: { nodes: 1, size: 'Small' },
    nsx: { nodes: 3, size: 'Medium' },
    cloudProxy: { nodes: 1, size: 'Small' },
    totals: { vcpu: 62, ramGb: 187, diskGb: 5462 },
  },
  'ha-medium': {
    managementServices: { controlPlaneNodes: 3, workerNodes: 2 },
    sddcManager: { nodes: 1, size: 'Default' },
    vcenter: { nodes: 1, size: 'Medium' },
    nsx: { nodes: 3, size: 'Medium' },
    cloudProxy: { nodes: 1, size: 'Standard' },
    totals: { vcpu: 74, ramGb: 244, diskGb: 5813 },
  },
  'ha-large': {
    managementServices: { controlPlaneNodes: 3, workerNodes: 2 },
    sddcManager: { nodes: 1, size: 'Default' },
    vcenter: { nodes: 1, size: 'Large' },
    nsx: { nodes: 3, size: 'Large' },
    cloudProxy: { nodes: 1, size: 'Standard' },
    totals: { vcpu: 120, ramGb: 353, diskGb: 8321 },
  },
};
// TODO(10-planning): capacity validation of target hosts against sizing totals ([9.1] planning
// workflow validates CPU/memory/storage, 20 §3.1 [S32]) – host capacity semantics not in spec yet.

// ===========================================================================
// Generic helpers
// ===========================================================================

/** Numeric dotted version compare (e.g. "9.1.0.400" vs "9.1.1"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * FQDN syntax rules for VCF components:
 * - lowercase, not `.local` (20 §3.5, §5.1 [S14][S19]); uppercase in several fleet FQDNs makes the
 *   deployment fail (20 §5.3 #2 [S31]),
 * - top-level domain ASCII letters only (20 §3.5 [S20]).
 */
export function validateFqdnSyntax(fqdn: string, field: string): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!fqdn.includes('.'))
    out.push(issue('FQDN_NOT_FULLY_QUALIFIED', 'error', `${field}: "${fqdn}" is not a fully qualified domain name.`, '20 §3.5 [S20]', field));
  if (fqdn !== fqdn.toLowerCase())
    out.push(issue('FQDN_NOT_LOWERCASE', 'error', `${field}: FQDN must be lowercase.`, '20 §3.5, §5.1, §5.3 #2 [S14][S19][S31]', field));
  if (fqdn.toLowerCase().endsWith('.local'))
    out.push(issue('FQDN_LOCAL_DOMAIN', 'error', `${field}: FQDN must not use the .local domain.`, '20 §3.5, §5.1 [S14][S19]', field));
  const tld = fqdn.split('.').pop() ?? '';
  if (fqdn.includes('.') && !/^[A-Za-z]+$/.test(tld))
    out.push(issue('FQDN_TLD_INVALID', 'error', `${field}: top-level domain may contain only ASCII letters.`, '20 §3.5 [S20]', field));
  return out;
}

/** Forward (A) and reverse (PTR) record check (20 §3.5 [S20]). */
export function validateDnsRecords(dns: DnsRecords, fqdn: string, field: string, expectedIp?: string): ValidationIssue[] {
  const r = checkForwardReverse(dns, fqdn);
  if (!r.ok) {
    const what = r.reason === 'no-forward' ? 'forward (A)' : 'reverse (PTR)';
    return [issue('DNS_RECORD_MISSING', 'error', `${field}: ${fqdn} has no valid ${what} DNS record.`, '20 §3.5 [S20]', field)];
  }
  if (expectedIp !== undefined && r.ip !== expectedIp)
    return [issue('DNS_IP_MISMATCH', 'error', `${field}: ${fqdn} resolves to ${r.ip}, expected ${expectedIp}.`, '20 §3.5 [S20]', field)];
  return [];
}

// ===========================================================================
// VCF Installer appliance (20 §3.3, §4.1.5 [S6])
// ===========================================================================

/**
 * Placement of the appliance (20 §4.1.5 "Umístění installeru" [S6], 00 §2.6 [S4]):
 * - outside-management: installer mode, can deploy multiple platforms,
 * - management-host: on an ESX host of the future management domain – one platform, then SDDC Manager mode.
 */
export type InstallerPlacement = 'outside-management' | 'management-host';

export interface InstallerOvfInput {
  readonly vmName: string;
  readonly placement: InstallerPlacement;
  /** On a management host the appliance must use the local disk (20 §4.1.5 step 6 [S6]). */
  readonly datastore: 'local-disk' | 'other';
  readonly rootPassword: string;
  /** Local user password (for admin@local / vcf). */
  readonly localUserPassword: string;
  /** Becomes the SDDC Manager FQDN on a management host and cannot be changed later. */
  readonly hostnameFqdn: string;
  readonly ntpServers: readonly string[];
  readonly ipVersion: 'ipv4' | 'ipv4-ipv6';
  readonly ipv4Address: string;
  readonly subnetMask: string;
  readonly defaultGateway: string;
  readonly ipv6Address?: string;
  readonly ipv6Prefix?: number;
  readonly ipv6Gateway?: string;
  readonly dnsDomainName: string;
  readonly domainSearchPath: string;
  readonly dnsServers: readonly string[];
}

/** Installer lifecycle: not deployed -> installer mode -> (management host only) SDDC Manager mode (00 §2.6, 20 §1). */
export type InstallerMode = 'not-deployed' | 'installer' | 'sddc-manager';

export interface InstallerState {
  readonly mode: InstallerMode;
  readonly version: string;
  readonly ovf?: InstallerOvfInput;
  /** Number of platforms successfully deployed by this appliance. */
  readonly platformsDeployed: number;
}

export function initialInstallerState(version: string = MODELLED_VCF_VERSION): InstallerState {
  return { mode: 'not-deployed', version, platformsDeployed: 0 };
}

export interface PasswordPolicyOptions {
  /** Usernames the password must not contain (20 §3.6 [S6]). */
  readonly usernames: readonly string[];
  /**
   * Dictionary words the password must not contain (20 §3.6 [S6]).
   * TODO(spec 20 §3.6): the dictionary itself and the exact meaning of "part of a word/username" are not
   * documented – the model checks containment of the supplied words / full usernames only.
   */
  readonly dictionaryWords?: readonly string[];
}

/**
 * VCF Installer root / local user password policy (20 §3.6, §5.2 [S6]):
 * ≥ 15 chars, ≥ 1 upper, ≥ 1 lower, ≥ 1 digit, ≥ 1 special from `@ ! # $ % ? ^`, no dictionary word,
 * no username. "Passwords that don't meet these rules cause the deployment to fail" -> error.
 */
export function validateInstallerPassword(password: string, field: string, opts: PasswordPolicyOptions): ValidationIssue[] {
  const ref = '20 §3.6, §5.2 [S6]';
  const out: ValidationIssue[] = [];
  const fail = (code: ValidationCode, msg: string): void => {
    out.push(issue(code, 'error', `${field}: ${msg}`, ref, field));
  };
  if (password.length < INSTALLER_PASSWORD_MIN_LENGTH) fail('PASSWORD_TOO_SHORT', `must be at least ${INSTALLER_PASSWORD_MIN_LENGTH} characters.`);
  if (!/[A-Z]/.test(password)) fail('PASSWORD_NO_UPPERCASE', 'must contain at least one uppercase letter.');
  if (!/[a-z]/.test(password)) fail('PASSWORD_NO_LOWERCASE', 'must contain at least one lowercase letter.');
  if (!/[0-9]/.test(password)) fail('PASSWORD_NO_DIGIT', 'must contain at least one digit.');
  if (!INSTALLER_PASSWORD_SPECIAL_CHARS.some((c) => password.includes(c)))
    fail('PASSWORD_NO_SPECIAL', `must contain at least one special character (${INSTALLER_PASSWORD_SPECIAL_CHARS.join(' ')}).`);
  const lower = password.toLowerCase();
  if (opts.usernames.some((u) => u.length > 0 && lower.includes(u.toLowerCase())))
    fail('PASSWORD_CONTAINS_USERNAME', 'must not contain the user name.');
  if ((opts.dictionaryWords ?? []).some((w) => w.length > 0 && lower.includes(w.toLowerCase())))
    fail('PASSWORD_CONTAINS_DICTIONARY_WORD', 'must not contain a dictionary word.');
  return out;
}

/**
 * Validates deploying the VCF Installer OVA (20 §3.3, §4.1.5 [S6]).
 * - passwords per policy (root / local user),
 * - max. 2 DNS servers,
 * - static IP; FQDN valid and resolvable (forward + reverse) to that IP,
 * - on a management host: datastore must be the local disk,
 * - dual-stack requires IPv6 address/prefix/gateway.
 */
export function validateDeployInstallerOva(
  state: InstallerState,
  ovf: InstallerOvfInput,
  dns: DnsRecords,
  dictionaryWords: readonly string[] = [],
): ValidationIssue[] {
  const ref = '20 §3.3, §4.1.5 [S6]';
  const out: ValidationIssue[] = [];
  if (state.mode !== 'not-deployed')
    out.push(issue('INSTALLER_ALREADY_DEPLOYED', 'error', 'VCF Installer appliance is already deployed.', ref));
  out.push(...validateInstallerPassword(ovf.rootPassword, 'Root user password', { usernames: ['root'], dictionaryWords }));
  out.push(
    ...validateInstallerPassword(ovf.localUserPassword, 'Local user password', { usernames: ['admin@local', 'vcf'], dictionaryWords }),
  );
  if (ovf.dnsServers.length > INSTALLER_MAX_DNS_SERVERS)
    out.push(issue('INSTALLER_TOO_MANY_DNS_SERVERS', 'error', `Domain Name Servers: maximum ${INSTALLER_MAX_DNS_SERVERS}.`, '20 §4.1.5, §6.1 [S6]', 'dnsServers'));
  if (parseIpv4(ovf.ipv4Address) === undefined)
    out.push(issue('INSTALLER_STATIC_IP_INVALID', 'error', 'VCF Installer requires a valid static IPv4 address.', ref, 'ipv4Address'));
  if (ovf.ipVersion === 'ipv4-ipv6' && (ovf.ipv6Address === undefined || ovf.ipv6Prefix === undefined || ovf.ipv6Gateway === undefined))
    out.push(issue('INSTALLER_IPV6_MISSING', 'error', 'IPv4+IPv6: IPv6 address, prefix and gateway are required.', '20 §4.1.5 step 9 [S6]', 'ipv6Address'));
  out.push(...validateFqdnSyntax(ovf.hostnameFqdn, 'Host Name'));
  out.push(...validateDnsRecords(dns, ovf.hostnameFqdn, 'Host Name', ovf.ipv4Address));
  if (ovf.placement === 'management-host' && ovf.datastore !== 'local-disk')
    out.push(issue('INSTALLER_DATASTORE_NOT_LOCAL', 'error', 'On a management host the VCF Installer must be deployed to the local disk.', '20 §4.1.5 step 6 [S6]', 'datastore'));
  return out;
}

/** Transition: deploy the installer OVA. Rejected on any blocking error. */
export function deployInstallerOva(
  state: InstallerState,
  ovf: InstallerOvfInput,
  dns: DnsRecords,
  dictionaryWords: readonly string[] = [],
): TransitionResult<InstallerState> {
  const errs = validateDeployInstallerOva(state, ovf, dns, dictionaryWords).filter((i) => i.severity === 'error');
  if (errs[0]) return { ok: false, error: errs[0] };
  return { ok: true, state: { ...state, mode: 'installer', ovf } };
}

/**
 * The appliance can start a new platform deployment only in installer mode
 * ("the appliance can no longer work in installer mode", 00 §2.6 [S4], 20 §1 [S6]);
 * on a management host only one platform (20 §4.1.5, §6.1 [S6]).
 */
export function validateInstallerCanDeploy(state: InstallerState): ValidationIssue[] {
  if (state.mode === 'not-deployed')
    return [issue('INSTALLER_NOT_DEPLOYED', 'error', 'VCF Installer appliance is not deployed.', '20 §4.1 [S5]')];
  if (state.mode === 'sddc-manager')
    return [issue('INSTALLER_IN_SDDC_MANAGER_MODE', 'error', 'The appliance was converted to SDDC Manager and can no longer work in installer mode.', '00 §2.6 [S4]; 20 §1 [S6]')];
  if (state.ovf?.placement === 'management-host' && state.platformsDeployed >= 1)
    return [issue('INSTALLER_SINGLE_PLATFORM', 'error', 'An installer on a management host can deploy only one platform.', '20 §4.1.5, §6.1 [S6]')];
  if (compareVersions(state.version, MIN_INSTALLER_VERSION_FOR_WIZARD) < 0)
    return [issue('INSTALLER_VERSION_TOO_OLD', 'error', `The deployment wizard requires VCF Installer ${MIN_INSTALLER_VERSION_FOR_WIZARD} or later.`, '20 §3.3 [S14][S15]')];
  return [];
}

/**
 * Effect of a successful deployment on the appliance (20 §1, §4.1.5 step 6 [S6]):
 * on a management host it is moved by Storage vMotion and switches to SDDC Manager mode;
 * outside management infrastructure it stays an installer.
 */
export function installerAfterDeployment(state: InstallerState): InstallerState {
  const platformsDeployed = state.platformsDeployed + 1;
  if (state.ovf?.placement === 'management-host') return { ...state, mode: 'sddc-manager', platformsDeployed };
  return { ...state, platformsDeployed };
}

// ===========================================================================
// ESX host preparation (20 §3.2, §4.1.1–4.1.4 [S7]–[S11])
// ===========================================================================

export interface EsxHostNetwork {
  readonly vlanId?: number;
  readonly ipv4Address: string;
  readonly subnetMask: string;
  readonly defaultGateway: string;
  readonly ipv6Address?: string;
  readonly dnsServers: readonly string[];
  readonly hostnameFqdn: string;
  /** Must be empty (20 §3.2, §4.1.2 step 6 [S9]). */
  readonly customDnsSuffixes: readonly string[];
}

export interface EsxHost {
  readonly id: string;
  /** Hardware facts (set by scenario / career economy). */
  readonly hwVendor: string;
  readonly hwProfileId: string;
  readonly pnicCount: number;
  /** VCF does not support stateless ESX hosts (20 §3.2 [S7]). */
  readonly stateless: boolean;
  /** Installed ESX version, undefined = not installed. */
  readonly esxVersion?: string;
  /** vmk0 attached to one management NIC on a vSphere Standard Switch (20 §3.2 [S9]). */
  readonly vmk0OnStandardSwitch: boolean;
  readonly network?: EsxHostNetwork;
  readonly ntp: { readonly servers: readonly string[]; readonly enabled: boolean; readonly serviceRunning: boolean };
  readonly sshEnabled: boolean;
  /** CN of the self-signed certificate (20 §3.2 [S11]). */
  readonly certificateCn: string;
}

export function newBareMetalHost(
  id: string,
  hw: { readonly hwVendor: string; readonly hwProfileId: string; readonly pnicCount: number; readonly stateless?: boolean },
): EsxHost {
  return {
    id,
    hwVendor: hw.hwVendor,
    hwProfileId: hw.hwProfileId,
    pnicCount: hw.pnicCount,
    stateless: hw.stateless ?? false,
    vmk0OnStandardSwitch: false,
    ntp: { servers: [], enabled: false, serviceRunning: false },
    sshEnabled: false,
    certificateCn: ESX_DEFAULT_CERT_CN,
  };
}

const notInstalled = (h: EsxHost): ValidationIssue =>
  issue('ESX_NOT_INSTALLED', 'error', `Host ${h.id}: ESX is not installed.`, '20 §4.1.1 [S8]', h.id);

/** Install ESX from ISO (20 §4.1.1 [S8]). Fresh install: vmk0 on the standard switch, default cert CN. */
export function installEsx(host: EsxHost, version: string): TransitionResult<EsxHost> {
  const { network: _n, ...rest } = host;
  void _n;
  return {
    ok: true,
    state: {
      ...rest,
      esxVersion: version,
      vmk0OnStandardSwitch: true,
      ntp: { servers: [], enabled: false, serviceRunning: false },
      sshEnabled: false,
      certificateCn: ESX_DEFAULT_CERT_CN,
    },
  };
}

/** DCUI "Configure Management Network" (20 §4.1.2 [S9]). Requires installed ESX. */
export function configureHostNetwork(host: EsxHost, network: EsxHostNetwork): TransitionResult<EsxHost> {
  if (host.esxVersion === undefined) return { ok: false, error: notInstalled(host) };
  return { ok: true, state: { ...host, network } };
}

/**
 * NTP via VMware Host Client (20 §4.1.3 [S10]). Host Client access needs the management network,
 * the spec notes NTP is configured "after you have configured the Virtual Machine Network port group".
 */
export function configureHostNtp(host: EsxHost, servers: readonly string[]): TransitionResult<EsxHost> {
  if (host.esxVersion === undefined) return { ok: false, error: notInstalled(host) };
  if (!host.network)
    return { ok: false, error: issue('ESX_NETWORK_NOT_CONFIGURED', 'error', `Host ${host.id}: configure the management network first.`, '20 §4.1.3 [S10]', host.id) };
  return { ok: true, state: { ...host, ntp: { servers, enabled: servers.length > 0, serviceRunning: servers.length > 0 } } };
}

/** Host Client: Actions > Services > Enable/Disable Secure Shell (20 §4.1.4 [S11]). */
export function setHostSsh(host: EsxHost, enabled: boolean): TransitionResult<EsxHost> {
  if (host.esxVersion === undefined) return { ok: false, error: notInstalled(host) };
  return { ok: true, state: { ...host, sshEnabled: enabled } };
}

/**
 * `/sbin/generate-certificates` + reboot (20 §4.1.4 [S11]): requires SSH enabled; the new certificate
 * CN is the current hostname (FQDN). If no hostname is set the CN stays localhost.localdomain.
 */
export function regenerateHostCertificate(host: EsxHost): TransitionResult<EsxHost> {
  if (host.esxVersion === undefined) return { ok: false, error: notInstalled(host) };
  if (!host.sshEnabled)
    return { ok: false, error: issue('ESX_SSH_DISABLED', 'error', `Host ${host.id}: enable Secure Shell (SSH) first.`, '20 §4.1.4 [S11]', host.id) };
  return { ok: true, state: { ...host, certificateCn: host.network?.hostnameFqdn ?? ESX_DEFAULT_CERT_CN } };
}

/**
 * Minimum number of ESX hosts in the management domain default (first) vSphere cluster,
 * per cluster model, deployment model and principal storage (spec 10 §6.1).
 *
 * - Single-Rack [P9] (9.0 identical [P10]) and Multi-Rack Layer 2 [P11], column "Mgmt domain –
 *   default cluster": vSAN Simple 3 / HA 4; NFS or VMFS on FC Simple 2 / HA 4. These cells are
 *   unambiguous (10 §8 q2 concerns only the "other clusters / WLD" columns). The same 3/2/4 numbers
 *   appear for convergence (20 §6.3 [P31]) and HA NSX Manager needs "at least four physical hosts" [P23].
 * - Multi-Rack Layer 3 [P12]: not supported for the management domain default cluster -> undefined here;
 *   reported by architecture.validateCluster as MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED.
 * - Stretched [P13]: vSAN Simple 6 / Highly Available 8 ("Mgmt first cluster" column).
 *   TODO(spec 10 §6.1, §8 q2): stretched NFS/FC (vMSC) first cluster points to KB 417356 [P35]
 *   ("Simple min. 2, HA min. 6 … numbers are doubled to account for the 2nd Site") – ambiguous
 *   whether the numbers are already doubled -> undefined (not checked).
 *
 * Returns undefined when the spec gives no unambiguous minimum (= not checked).
 * Other clusters / workload domains are not covered here (10 §8 q2 merged cells; WLD model is area 40).
 */
export function minManagementDefaultClusterHosts(
  clusterModel: ClusterModel,
  model: DeploymentModel,
  storage: StorageType,
): number | undefined {
  const vsan = storage === 'vsan-esa' || storage === 'vsan-osa';
  switch (clusterModel) {
    case 'single-rack': // 10 §6.1 Single-Rack table [P9]
    case 'multi-rack-l2': // 10 §6.1 Multi-Rack Layer 2 table [P11]
      if (model === 'high-availability') return 4;
      return vsan ? 3 : 2;
    case 'multi-rack-l3': // 10 §6.1 [P12]: "Not supported for primary cluster"
      return undefined;
    case 'stretched': // 10 §6.1 Stretched table [P13]
      if (!vsan) return undefined; // TODO(10 §8 q2): vMSC numbers via KB 417356 ambiguous
      return model === 'high-availability' ? 8 : 6;
  }
}

/**
 * Host-count check for the management domain default cluster (spec 10 §6.1 [P9][P11][P13];
 * requirement VCF-ESX-REQD-CFG-001 / VCF-CLS-REQD-CFG-002, 10 §4 step 5 [P14][P9]).
 * Severity error: documented as a minimum / requirement. The documentation gives no message text
 * for greenfield bring-up (10 §5) – the message here is descriptive, not a quote.
 */
export function validateManagementHostCount(
  hostCount: number,
  ctx: { readonly model: DeploymentModel; readonly storage: StorageType; readonly clusterModel: ClusterModel },
): ValidationIssue[] {
  const min = minManagementDefaultClusterHosts(ctx.clusterModel, ctx.model, ctx.storage);
  if (min === undefined || hostCount >= min) return [];
  return [
    issue(
      'MGMT_DOMAIN_TOO_FEW_HOSTS',
      'error',
      `Management domain default cluster (${ctx.clusterModel}, ${ctx.model}, ${ctx.storage}) requires at least ${min} ESX hosts; ${hostCount} provided.`,
      ctx.clusterModel === 'stretched' ? '10 §6.1 [P13]' : '10 §6.1 [P9][P11]',
      'esxHosts',
    ),
  ];
}

/** Configurable rules where the spec has open questions. */
export interface BringupRules {
  /** Required ESX version per VCF Release Notes (20 §3.2 [S7]); undefined = not checked. */
  readonly requiredEsxVersion?: string;
  /** Dictionary used for password checks (20 §3.6 [S6]). */
  readonly dictionaryWords?: readonly string[];
}

/**
 * Validates prepared ESX hosts for the management domain (20 §3.2 [S7]–[S11]).
 * All conditions are documented as hard requirements -> errors.
 */
export function validateEsxHostsForBringup(
  hosts: readonly EsxHost[],
  ctx: {
    readonly dns: DnsRecords;
    readonly model: DeploymentModel;
    readonly storage: StorageType;
    readonly rules?: BringupRules;
    /** Cluster model of the management domain default cluster; default 'single-rack' (10 §6.1 [P9]). */
    readonly clusterModel?: ClusterModel;
    /**
     * Check the minimum host count (10 §6.1). Default true. validateHostEntries passes false and checks
     * the number of wizard entries itself (so a missing host is not reported twice).
     */
    readonly checkHostCount?: boolean;
  },
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (ctx.checkHostCount !== false)
    out.push(...validateManagementHostCount(hosts.length, { model: ctx.model, storage: ctx.storage, clusterModel: ctx.clusterModel ?? 'single-rack' }));

  // Homogeneous HW profile in the first cluster, single vendor (20 §3.2 [S7]).
  if (new Set(hosts.map((h) => h.hwProfileId)).size > 1)
    out.push(issue('ESX_HETEROGENEOUS_CLUSTER', 'error', 'Initial management domain deployment does not support heterogeneous clusters; all hosts must share one hardware profile.', '20 §3.2 [S7]'));
  if (new Set(hosts.map((h) => h.hwVendor)).size > 1)
    out.push(issue('ESX_MULTIPLE_VENDORS', 'error', 'All ESX hosts in the management domain must be from the same hardware vendor.', '20 §3.2 [S7]'));

  for (const h of hosts) {
    if (h.esxVersion === undefined) {
      out.push(notInstalled(h));
      continue;
    }
    if (h.stateless)
      out.push(issue('ESX_STATELESS', 'error', `Host ${h.id}: VCF does not support stateless ESX hosts.`, '20 §3.2 [S7]', h.id));
    const req = ctx.rules?.requiredEsxVersion;
    if (req !== undefined && h.esxVersion !== req)
      out.push(issue('ESX_VERSION_MISMATCH', 'error', `Host ${h.id}: ESX ${h.esxVersion} does not match required ${req} (VCF Release Notes).`, '20 §3.2 [S7]', h.id));
    if (!h.vmk0OnStandardSwitch)
      out.push(issue('ESX_VMK0_NOT_ON_VSS', 'error', `Host ${h.id}: vmk0 must be connected to one management NIC on a vSphere Standard Switch.`, '20 §3.2 [S9]', h.id));
    const n = h.network;
    if (!n) {
      out.push(issue('ESX_NETWORK_NOT_CONFIGURED', 'error', `Host ${h.id}: static IPv4, VLAN, DNS and FQDN hostname must be configured.`, '20 §3.2, §4.1.2 [S9]', h.id));
    } else {
      if (parseIpv4(n.ipv4Address) === undefined)
        out.push(issue('ESX_STATIC_IP_INVALID', 'error', `Host ${h.id}: a static IPv4 address is required.`, '20 §3.2 [S9]', h.id));
      if (n.customDnsSuffixes.length > 0)
        out.push(issue('ESX_CUSTOM_DNS_SUFFIXES', 'error', `Host ${h.id}: "Custom DNS Suffixes" must be empty.`, '20 §3.2, §4.1.2 [S9]', h.id));
      out.push(...validateFqdnSyntax(n.hostnameFqdn, `Host ${h.id} hostname`));
      out.push(...validateDnsRecords(ctx.dns, n.hostnameFqdn, `Host ${h.id}`, n.ipv4Address));
      if (h.certificateCn !== n.hostnameFqdn)
        out.push(issue('ESX_CERT_CN_MISMATCH', 'error', `Host ${h.id}: certificate CN "${h.certificateCn}" does not match FQDN ${n.hostnameFqdn}; regenerate the self-signed certificate after setting the hostname.`, '20 §3.2, §4.1.4, §5.2 [S11]', h.id));
    }
    if (!h.ntp.enabled || h.ntp.servers.length === 0 || !h.ntp.serviceRunning)
      out.push(issue('ESX_NTP_NOT_RUNNING', 'error', `Host ${h.id}: NTP must be configured and the NTP service running.`, '20 §3.2, §4.1.3 [S10]', h.id));
    // Known issue: NFS on hosts with a single pNIC (20 §5.3 #3 [S31]) – quoted message.
    if (ctx.storage === 'nfs-v3' && h.pnicCount < 2)
      out.push(issue('NFS_SINGLE_PNIC_UNSUPPORTED', 'error', `Failed to validate NFS configuration. NFS datastore mount failed on host ${n?.hostnameFqdn ?? h.id}`, '20 §5.3 #3 [S31]', h.id));
  }
  return out;
}

// ===========================================================================
// Depot and binaries (20 §3.4, §4.1.6 [S12][S13])
// ===========================================================================

export type ProxyAuthMethod = 'none' | 'basic' | 'kerberos' | 'ntlmv2';

export interface OnlineDepotInput {
  /** Activation code from the VCF Business Services console (20 §4.1.6 [S13]). */
  readonly activationCode: string;
  readonly proxy?: {
    readonly protocol: 'http' | 'https';
    readonly host: string;
    readonly port: number;
    readonly auth: ProxyAuthMethod;
    /** Proxy performs SSL/TLS interception. */
    readonly sslInterception: boolean;
    /** Proxy CA added to the software depot truststore (KB 442978). */
    readonly proxyCaInTruststore: boolean;
  };
}

export interface OfflineDepotInput {
  readonly url: string;
  /** For an HTTPS depot the server certificate must be imported (keytool) and services restarted. */
  readonly certificateImported: boolean;
  readonly servicesRestarted: boolean;
}

export type DepotConnection =
  | { readonly kind: 'none' }
  | { readonly kind: 'online'; readonly input: OnlineDepotInput }
  | { readonly kind: 'offline'; readonly input: OfflineDepotInput };

/** Download Status lifecycle per binary (20 §4.1.6 "Download Status (stahování + validace)" [S13]). */
export type BinaryStatus = 'not-downloaded' | 'downloading' | 'validating' | 'downloaded' | 'failed';

export interface DepotState {
  readonly connection: DepotConnection;
  readonly binaries: Readonly<Partial<Record<VcfBinary, BinaryStatus>>>;
}

export function initialDepotState(): DepotState {
  return { connection: { kind: 'none' }, binaries: {} };
}

/** Online depot prerequisites (20 §3.4, §4.1.6, §5.2 [S13]). */
export function validateConfigureOnlineDepot(input: OnlineDepotInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (input.activationCode.trim() === '')
    out.push(issue('DEPOT_ACTIVATION_CODE_MISSING', 'error', 'An activation code from the VCF Business Services console is required.', '20 §4.1.6 [S13]', 'activationCode'));
  const p = input.proxy;
  if (p) {
    if (p.auth === 'kerberos' || p.auth === 'ntlmv2')
      out.push(issue('DEPOT_PROXY_AUTH_UNSUPPORTED', 'error', 'Proxy with Kerberos or NTLMv2 authentication is not supported.', '20 §3.4, §5.2 [S13]', 'proxy'));
    if (p.sslInterception && !p.proxyCaInTruststore)
      out.push(issue('DEPOT_SSL_INTERCEPTION', 'error', 'SSL/TLS interception: the installer may not establish a trusted connection to the Broadcom authorization server; add the proxy CA to the software depot truststore (KB 442978).', '20 §3.4, §5.2 [S13]', 'proxy'));
  }
  return out;
}

/** Offline depot prerequisites (20 §4.1.6 [S13]). */
export function validateConfigureOfflineDepot(input: OfflineDepotInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (input.url.trim() === '')
    out.push(issue('DEPOT_URL_MISSING', 'error', 'Offline depot URL is required.', '20 §4.1.6 [S13]', 'url'));
  if (input.url.toLowerCase().startsWith('https://') && !(input.certificateImported && input.servicesRestarted))
    out.push(issue('DEPOT_CERT_NOT_TRUSTED', 'error', 'HTTPS offline depot: import the depot server certificate into the truststore and restart services first.', '20 §4.1.6 [S13]', 'url'));
  return out;
}

/**
 * Only one depot type can be connected; configuring an offline depot deactivates and deletes the
 * online depot configuration (20 §4.1.6 [S13]).
 * TODO(spec): the reverse direction (online over offline) is not documented; modelled symmetrically.
 */
export function configureDepot(
  state: DepotState,
  conn: Exclude<DepotConnection, { kind: 'none' }>,
): TransitionResult<DepotState> {
  const errs = conn.kind === 'online' ? validateConfigureOnlineDepot(conn.input) : validateConfigureOfflineDepot(conn.input);
  const first = errs.find((e) => e.severity === 'error');
  if (first) return { ok: false, error: first };
  return { ok: true, state: { ...state, connection: conn } };
}

const BINARY_TRANSITIONS: Readonly<Record<BinaryStatus, readonly BinaryStatus[]>> = {
  'not-downloaded': ['downloading'],
  downloading: ['validating', 'failed'],
  validating: ['downloaded', 'failed'],
  downloaded: [],
  failed: ['downloading'],
};

/** Moves a binary through Download Status (20 §4.1.6 [S13]); downloading requires a connected depot. */
export function setBinaryStatus(state: DepotState, binary: VcfBinary, next: BinaryStatus): TransitionResult<DepotState> {
  const cur = state.binaries[binary] ?? 'not-downloaded';
  if (next === 'downloading' && state.connection.kind === 'none')
    return { ok: false, error: issue('DEPOT_NOT_CONNECTED', 'error', 'Connect to an online or offline depot before downloading binaries.', '20 §4.1.6 [S13]', binary) };
  if (!BINARY_TRANSITIONS[cur].includes(next))
    return { ok: false, error: issue('ILLEGAL_BINARY_TRANSITION', 'error', `Binary ${binary}: ${cur} -> ${next} is not allowed.`, '20 §4.1.6 [S13]', binary) };
  return { ok: true, state: { ...state, binaries: { ...state.binaries, [binary]: next } } };
}

/**
 * All binaries for a new VCF deployment must be downloaded (20 §3.4 [S12]); VCF Operations and VCF
 * Automation binaries are required even when they are deferred (custom networking).
 * When existing components are reused "not all binaries are needed" – which ones exactly is not
 * documented (TODO); the model then skips the binary of the reused product only.
 */
export function validateBinariesForDeployment(depot: DepotState, reused: readonly VcfBinary[] = []): ValidationIssue[] {
  return VCF_BINARIES.filter((b) => !reused.includes(b) && depot.binaries[b] !== 'downloaded').map((b) =>
    issue('BINARY_NOT_DOWNLOADED', 'error', `Binary "${b}" is not downloaded.`, '20 §3.4, §4.1.6 [S12][S13]', b),
  );
}

// ===========================================================================
// Deployment wizard input (20 §4.2 [S14])
// ===========================================================================

export type DeployTarget = 'new-fleet' | 'new-instance';

/** Step 4 "Select the existing components". */
export interface ExistingComponents {
  readonly existingVcfOperations: boolean;
  readonly existingVcenter: boolean;
  readonly vcenterRegisteredWithNsx: boolean;
  readonly existingVcfAutomationOrDeployLater: boolean;
}

/** Step 6 "Network configuration". */
export interface NetworkConfiguration {
  readonly vmManagementNetwork: 'shared-with-esx-management' | 'dedicated';
  readonly vcfManagementNetwork: 'shared-with-vm-management' | 'dedicated';
  /** Only if the installer itself is dual-stack. */
  readonly dualStack: boolean;
  readonly vmotionIpScheme: 'ipv4' | 'ipv6';
  readonly storageIpScheme: 'ipv4' | 'ipv6';
  /** "Deploy VCF Operations and VCF Automation to a specific vSphere distributed switch or NSX segment". */
  readonly deployOpsAndAutomationToCustomNetwork: boolean;
  /** [9.1.1+] VPC Network Configuration. */
  readonly vpcNetwork: 'full-stack' | 'vlan-backed';
  readonly vpcGatewayConnectivity: 'centralized' | 'distributed';
}

/** Step 7 "Storage type" (principal storage of the default cluster, cannot be changed later). */
export type StorageType = 'vsan-esa' | 'vsan-osa' | 'vmfs-fc' | 'nfs-v3';

export interface StorageConfiguration {
  readonly type: StorageType;
  readonly vsanEsaAllowAutoClaimHclIncompatible?: boolean;
  readonly vsanOsaFailuresToTolerate?: number;
  readonly vsanOsaDedupAndCompression?: boolean;
  readonly vsanDataInTransitEncryption?: { readonly enabled: boolean; readonly rekeyInterval?: number };
  /** VMFS on FC: the datastore must exist and be attached to all hosts (environment fact). */
  readonly vmfsDatastoreAttachedToAllHosts?: boolean;
  /** NFS v3: the NFS server must exist (environment fact). */
  readonly nfsServerExists?: boolean;
  readonly nfsShareNetworkWithEsxManagement?: boolean;
}

/** Step 9 "General configuration". */
export interface GeneralConfiguration {
  readonly version: string;
  /** Unique; adapter name in VCF Operations. */
  readonly instanceName: string;
  /** Prefix of objects. */
  readonly managementDomainName: string;
  readonly ceip: boolean;
  readonly dnsServers: readonly string[];
  readonly ntpServers: readonly string[];
  readonly dnsDomainName: string;
  /** [9.1] Autogenerate passwords. */
  readonly autogeneratePasswords: boolean;
}

/**
 * Step 10 "ESX host details".
 * TODO(spec 20 §8 q5): exact fields are not documented ("Enter the ESX host details"); modelled by FQDN.
 */
export interface EsxHostEntry {
  readonly fqdn: string;
}

/** A host network with IP inclusion ranges (step 11). */
export interface HostNetworkSpec {
  readonly vlanId: number;
  readonly cidr: string;
  readonly gateway: string;
  readonly mtu: number;
  readonly inclusionRanges: readonly IpPool[];
}

/** Step 11 "Network details". */
export interface NetworkDetails {
  readonly esxManagement: { readonly vlanId: number; readonly cidr: string; readonly gateway: string };
  /** Hidden when shared with ESX management. */
  readonly vmManagementPortGroup?: string;
  /** Hidden when shared with VM management. */
  readonly vcfManagementPortGroup?: string;
  readonly managementServicesIpPool: IpPool;
  /** 5 IPs for VCF Automation (20 §3.5 [S19]). */
  readonly vcfAutomationIpPool?: IpPool;
  readonly vmotion: HostNetworkSpec;
  /** vSAN or NFS network. Not used for VMFS on FC. */
  readonly storage?: HostNetworkSpec;
  /** NSX Host Overlay (TEP); [9.1.1+] not needed for VLAN-backed VPC. */
  readonly nsxHostOverlay?: HostNetworkSpec;
}

/** Step 12 "VCF management components" (FQDNs). */
export interface VcfManagementComponents {
  readonly vcfOperationsPrimaryFqdn?: string;
  readonly vcfOperationsReplicaFqdn?: string;
  /** Shown only for HA Medium / Large. */
  readonly vcfOperationsDataFqdn?: string;
  /** Optional, HA only. */
  readonly loadBalancerFqdn?: string;
  readonly cloudProxyFqdn?: string;
  readonly licenseServerFqdn?: string;
  readonly fleetComponentsFqdn?: string;
  readonly instanceComponentsFqdn?: string;
  readonly identityBrokerFqdn?: string;
  readonly servicesRuntimeFqdn?: string;
  readonly internalClusterCidrIpv4: string;
  readonly internalClusterCidrIpv6?: string;
  readonly vcfAutomationFqdn?: string;
  /** Dedicated VCF services runtime FQDN for VCF Automation. */
  readonly vcfAutomationServicesRuntimeFqdn?: string;
}

/** Step 13 "vCenter details". TODO(spec 20 §8 q5): other fields undocumented. */
export interface VcenterDetails {
  readonly fqdn: string;
}

/** Step 14 "Storage details". */
export interface StorageDetails {
  readonly datastoreName: string;
  readonly nfsSharePath?: string;
  readonly nfsServerIpv4?: string;
  readonly nfsVmkernelBinding?: string;
}

/** Step 15 "vSphere Distributed Switch". */
export type VdsProfile = 'default' | 'storage-traffic-separation' | 'nsx-traffic-separation' | 'custom';
export const VDS_PROFILE_SWITCH_COUNT: Readonly<Record<Exclude<VdsProfile, 'custom'>, number>> = {
  default: 1,
  'storage-traffic-separation': 2,
  'nsx-traffic-separation': 2,
};
export type TrafficType = 'esx-management' | 'vcf-management' | 'vm-management' | 'vmotion' | 'vsan' | 'nsx';
export type LoadBalancingPolicy = 'route-based-on-physical-nic-load' | 'other';

export interface DistributedSwitchSpec {
  readonly name: string;
  readonly uplinks: number;
  /** VDS uplinks or VDS LAG (LACP). */
  readonly uplinkMode: 'vds-uplinks' | 'vds-lag';
  readonly trafficTypes: readonly TrafficType[];
  /** Default "Route Based on Physical NIC Load". */
  readonly loadBalancing: LoadBalancingPolicy;
}

export interface VdsConfiguration {
  readonly profile: VdsProfile;
  readonly switches: readonly DistributedSwitchSpec[];
}

/** Step 16 "NSX Manager details". */
export interface NsxManagerDetails {
  readonly nodeFqdns: readonly string[];
  readonly vipFqdn: string;
  /** Required for Distributed connectivity; must match the ToR gateway. */
  readonly distributedConnectivity?: { readonly vlanId: number; readonly gatewayCidrIpv4: string };
}

/** Step 17 "SDDC Manager details". */
export interface SddcManagerDetails {
  readonly fqdn: string;
}

/** Full wizard input = JSON spec content for `workflowType=VCF` (20 §2.5, §4.3 [S15]). */
export interface BringupSpec {
  readonly target: DeployTarget;
  readonly existing: ExistingComponents;
  readonly model: DeploymentModel;
  readonly size: DeploymentSize;
  readonly networkConfig: NetworkConfiguration;
  readonly storage: StorageConfiguration;
  readonly general: GeneralConfiguration;
  readonly esxHosts: readonly EsxHostEntry[];
  readonly networks: NetworkDetails;
  readonly components: VcfManagementComponents;
  readonly vcenter: VcenterDetails;
  readonly storageDetails: StorageDetails;
  readonly vds: VdsConfiguration;
  readonly nsx: NsxManagerDetails;
  readonly sddcManager: SddcManagerDetails;
}

/** JSON `workflowType` values (20 §2.5 [S15]). */
export type WorkflowType = 'VCF' | 'VCF_EXTEND' | 'VCF_COMPLETE' | 'VVF';
export function workflowTypeOf(spec: BringupSpec): WorkflowType {
  return spec.target === 'new-fleet' ? 'VCF' : 'VCF_EXTEND';
}

/** Environment the validation runs against (simulated world). */
export interface BringupEnvironment {
  readonly installer: InstallerState;
  readonly depot: DepotState;
  readonly hosts: readonly EsxHost[];
  readonly dns: DnsRecords;
  /** Existing instance names in the fleet (instance name must be unique). */
  readonly existingInstanceNames?: readonly string[];
  /**
   * FQDNs/IPs not reachable from the installer. The appliance must reach ESX hosts, the VM management
   * network and external services (DNS, NTP) (20 §3.3 [S5][S6]).
   */
  readonly unreachableFromInstaller?: readonly string[];
  /** [9.1] validation pre-checks check physical network readiness for LAG (20 §4.2 [S32]). */
  readonly physicalNetworkLagReady?: boolean;
  readonly rules?: BringupRules;
}

// ---------------------------------------------------------------------------
// Required FQDNs (20 §4.2 step 12, §6.4 [S14][S19])
// ---------------------------------------------------------------------------

export interface FqdnRequirement {
  readonly field: string;
  readonly value: string | undefined;
  readonly required: boolean;
}

export function isVcfAutomationDeployedNow(spec: BringupSpec): boolean {
  return !spec.existing.existingVcfAutomationOrDeployLater && !spec.networkConfig.deployOpsAndAutomationToCustomNetwork;
}

/**
 * Which component FQDN fields apply to the spec (20 §4.2 steps 12–17, §6.4 [S14][S19]).
 * - Custom networking skips VCF Operations, cloud proxy, license server and VCF Automation (20 §4.2 step 6).
 * - Data node FQDN only for HA Medium/Large (20 §2.1 [S14][S19]).
 * - Replica only HA. TODO(spec 20 §8 q10): [S14] does not mark replica as HA-only; in Simple the field
 *   is treated as not required (and not rejected).
 * - Identity broker mandatory only for the primary instance (20 §2.5 [S15]).
 * - TODO: fleet components FQDN for a new instance – not documented; required only for a new fleet.
 */
export function fqdnRequirements(spec: BringupSpec): FqdnRequirement[] {
  const c = spec.components;
  const ha = spec.model === 'high-availability';
  const deferred = spec.networkConfig.deployOpsAndAutomationToCustomNetwork;
  const newOps = !spec.existing.existingVcfOperations && !deferred;
  const automation = isVcfAutomationDeployedNow(spec);
  const req = (field: string, value: string | undefined, required: boolean): FqdnRequirement => ({ field, value, required });
  const list: FqdnRequirement[] = [
    req('vCenter FQDN', spec.vcenter.fqdn, !spec.existing.existingVcenter),
    req('SDDC Manager FQDN', spec.sddcManager.fqdn, true),
    req('NSX Manager VIP FQDN', spec.nsx.vipFqdn, true),
    req('VCF Operations primary node FQDN', c.vcfOperationsPrimaryFqdn, newOps),
    req('VCF Operations replica node FQDN', c.vcfOperationsReplicaFqdn, newOps && ha),
    req('VCF Operations data node FQDN', c.vcfOperationsDataFqdn, newOps && ha && spec.size !== 'small'),
    req('Load balancer FQDN', c.loadBalancerFqdn, false),
    req('Cloud Proxy FQDN', c.cloudProxyFqdn, !deferred),
    req('License Server FQDN', c.licenseServerFqdn, !deferred && !spec.existing.existingVcfOperations),
    req('Fleet components FQDN', c.fleetComponentsFqdn, spec.target === 'new-fleet'),
    req('Instance components FQDN', c.instanceComponentsFqdn, true),
    req('Identity broker FQDN', c.identityBrokerFqdn, spec.target === 'new-fleet'),
    req('VCF services runtime FQDN', c.servicesRuntimeFqdn, true),
    req('VCF Automation FQDN', c.vcfAutomationFqdn, automation),
    req('VCF services runtime FQDN for VCF Automation', c.vcfAutomationServicesRuntimeFqdn, automation),
  ];
  spec.nsx.nodeFqdns.forEach((f, i) => list.push(req(`NSX Manager node ${i + 1} FQDN`, f, true)));
  return list;
}

// ---------------------------------------------------------------------------
// Sub-validations (all return issues; aggregated by validateBringupSpec)
// ---------------------------------------------------------------------------

/** Step 4 rules (20 §2.5, §4.2 step 4 [S14][S28]). */
export function validateExistingComponents(spec: BringupSpec): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const e = spec.existing;
  if (spec.target === 'new-instance' && !e.existingVcfOperations)
    out.push(issue('NEW_INSTANCE_REQUIRES_EXISTING_OPS', 'error', 'Deploying a new VCF Instance requires connecting to the existing VCF Operations.', '20 §2.5 [S14]', 'existingVcfOperations'));
  // [9.1.1+] existing VCF Operations => "I have an existing vCenter instance" always checked.
  // TODO(orchestrator): spec states this for the new-fleet context; applied to new fleet only.
  if (spec.target === 'new-fleet' && e.existingVcfOperations && !e.existingVcenter)
    out.push(issue('EXISTING_OPS_REQUIRES_EXISTING_VCENTER', 'error', 'VCF Operations must be in the management domain of the first VCF Instance; with an existing VCF Operations the existing vCenter option is always selected (convergence).', '20 §2.5 [S14][S28]', 'existingVcenter'));
  if (e.vcenterRegisteredWithNsx && !e.existingVcenter)
    out.push(issue('NSX_REGISTRATION_REQUIRES_EXISTING_VCENTER', 'error', '"vCenter is registered with NSX Manager" applies only to an existing vCenter (convergence).', '20 §4.2 step 4 [S14]', 'vcenterRegisteredWithNsx'));
  if (e.existingVcenter)
    out.push(issue('CONVERGENCE_NOT_MODELLED', 'error', 'Using an existing vCenter is the convergence workflow, which this model does not cover yet.', '20 §4.6 [S28] (model scope)', 'existingVcenter'));
  return out;
}

/** Step 5 (20 §4.2 step 5 [S14]) – [9.1.1+] Simple: Small only; HA: Small/Medium/Large. */
export function validateDeploymentModel(spec: BringupSpec): ValidationIssue[] {
  if (!ALLOWED_SIZES[spec.model].includes(spec.size))
    return [issue('SIZE_NOT_ALLOWED_FOR_MODEL', 'error', `Size "${spec.size}" is not available for the ${spec.model} deployment model.`, '20 §4.2 step 5 [S14]', 'size')];
  return [];
}

/** Step 6 (20 §4.2 step 6 [S14]). */
export function validateNetworkConfiguration(spec: BringupSpec, installer: InstallerState): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const n = spec.networkConfig;
  if (n.dualStack && installer.ovf?.ipVersion !== 'ipv4-ipv6')
    out.push(issue('DUAL_STACK_REQUIRES_DUAL_STACK_INSTALLER', 'error', 'Dual stack networking is available only if the VCF Installer is dual-stack.', '20 §4.2 step 6 [S14]', 'dualStack'));
  if (n.deployOpsAndAutomationToCustomNetwork && spec.target !== 'new-fleet')
    out.push(issue('CUSTOM_NETWORK_ONLY_NEW_FLEET', 'error', 'Deploying VCF Operations and VCF Automation to a specific distributed switch or NSX segment is available only for a new fleet.', '20 §4.2 step 6 [S14]', 'deployOpsAndAutomationToCustomNetwork'));
  if (n.deployOpsAndAutomationToCustomNetwork && spec.existing.existingVcfOperations)
    out.push(issue('CUSTOM_NETWORK_WITH_EXISTING_OPS', 'error', 'Custom networking for VCF Operations / VCF Automation is not available with an existing VCF Operations.', '20 §4.2 step 6 [S14]', 'deployOpsAndAutomationToCustomNetwork'));
  // TODO(spec): "VPC nepodporují IPv6" – how it interacts with the dual-stack switch is not documented.
  return out;
}

/** Step 7 / 14 (20 §4.2 steps 7, 14 [S14]; known issues 20 §5.3 [S31]). */
export function validateStorage(spec: BringupSpec): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const s = spec.storage;
  const isVsan = s.type === 'vsan-esa' || s.type === 'vsan-osa';
  if (s.vsanDataInTransitEncryption?.enabled && !isVsan)
    out.push(issue('DIT_ENCRYPTION_VSAN_ONLY', 'error', 'vSAN data-in-transit encryption applies only to vSAN ESA / OSA.', '20 §4.2 step 7 [S14]', 'storage'));
  if (s.type === 'vmfs-fc' && !s.vmfsDatastoreAttachedToAllHosts)
    out.push(issue('VMFS_DATASTORE_NOT_ON_ALL_HOSTS', 'error', 'VMFS on Fibre Channel: the datastore must exist and be attached to all hosts.', '20 §4.2 step 7 [S14]', 'storage'));
  if (s.type === 'nfs-v3') {
    if (!s.nfsServerExists)
      out.push(issue('NFS_SERVER_MISSING', 'error', 'NFS v3: the NFS server must exist.', '20 §4.2 step 7 [S14]', 'storage'));
    if (!spec.storageDetails.nfsSharePath || !spec.storageDetails.nfsServerIpv4)
      out.push(issue('NFS_DETAILS_MISSING', 'error', 'NFS v3: share path and NFS server IPv4 address are required.', '20 §4.2 step 14 [S14]', 'storageDetails'));
    if (spec.vds.switches.some((sw) => sw.uplinks < 2))
      out.push(issue('NFS_SINGLE_UPLINK_VDS_UNSUPPORTED', 'error', 'SDDC Manager deployment fails with a single-uplink distributed switch and an NFS datastore (unsupported configuration).', '20 §5.3 #16 [S31]', 'vds'));
  }
  if (spec.storageDetails.datastoreName.trim() === '')
    out.push(issue('DATASTORE_NAME_MISSING', 'error', 'Datastore name is required.', '20 §4.2 step 14 [S14]', 'storageDetails.datastoreName'));
  return out;
}

/** Step 9 (20 §4.2 step 9 [S14]). */
export function validateGeneralConfiguration(spec: BringupSpec, env: BringupEnvironment): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const g = spec.general;
  const ref = '20 §4.2 step 9 [S14]';
  if (g.instanceName.trim() === '')
    out.push(issue('INSTANCE_NAME_MISSING', 'error', 'VCF Instance Name is required.', ref, 'general.instanceName'));
  else if ((env.existingInstanceNames ?? []).includes(g.instanceName))
    out.push(issue('INSTANCE_NAME_NOT_UNIQUE', 'error', 'VCF Instance Name must be unique.', ref, 'general.instanceName'));
  if (g.managementDomainName.trim() === '')
    out.push(issue('MGMT_DOMAIN_NAME_MISSING', 'error', 'Management domain name is required.', ref, 'general.managementDomainName'));
  if (g.dnsDomainName.trim() === '')
    out.push(issue('DNS_DOMAIN_MISSING', 'error', 'DNS domain name is required.', ref, 'general.dnsDomainName'));
  if (g.dnsServers.length === 0)
    out.push(issue('DNS_SERVERS_MISSING', 'error', 'DNS servers are required.', ref, 'general.dnsServers'));
  if (g.ntpServers.length === 0)
    out.push(issue('NTP_SERVERS_MISSING', 'error', 'NTP servers are required.', ref, 'general.ntpServers'));
  // Installer must forward- and reverse-resolve every NTP server (20 §4.1.5 "Po nasazení" step 3 [S6]).
  for (const ntp of g.ntpServers)
    if (parseIpv4(ntp) === undefined) out.push(...validateDnsRecords(env.dns, ntp, `NTP server ${ntp}`));
  return out;
}

/** Step 10 – hosts entered in the wizard must be prepared hosts (20 §3.2, §4.2 step 10). */
export function validateHostEntries(spec: BringupSpec, env: BringupEnvironment): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const selected: EsxHost[] = [];
  const seen = new Set<string>();
  for (const e of spec.esxHosts) {
    if (seen.has(e.fqdn))
      out.push(issue('ESX_HOST_DUPLICATE', 'error', `ESX host ${e.fqdn} is entered more than once.`, '20 §4.2 step 10 [S14]', e.fqdn));
    seen.add(e.fqdn);
    const h = env.hosts.find((x) => x.network?.hostnameFqdn === e.fqdn);
    if (!h) {
      // Certificate identity check against the FQDN entered in the wizard (20 §3.2 [S11]).
      const byCn = env.hosts.find((x) => x.certificateCn === e.fqdn);
      out.push(
        byCn
          ? issue('ESX_FQDN_MISMATCH', 'error', `ESX host ${e.fqdn}: configured hostname does not match the FQDN entered in the wizard.`, '20 §3.2 [S11]', e.fqdn)
          : issue('ESX_HOST_NOT_FOUND', 'error', `ESX host ${e.fqdn} is not reachable / not prepared.`, '20 §3.2 [S9]', e.fqdn),
      );
      continue;
    }
    selected.push(h);
  }
  // Host count = distinct hosts entered in the wizard (10 §6.1 [P9][P11]); bring-up builds a
  // single-rack default cluster (stretching the management domain is Day 2, 10 §6.1 [P7]).
  out.push(...validateManagementHostCount(seen.size, { model: spec.model, storage: spec.storage.type, clusterModel: 'single-rack' }));
  out.push(
    ...validateEsxHostsForBringup(selected, {
      dns: env.dns,
      model: spec.model,
      storage: spec.storage.type,
      checkHostCount: false,
      ...(env.rules ? { rules: env.rules } : {}),
    }),
  );
  return out;
}

interface PoolInfo {
  readonly name: string;
  readonly addrs: readonly number[];
}

function poolsOf(spec: BringupSpec): { pools: PoolInfo[]; issues: ValidationIssue[] } {
  const pools: PoolInfo[] = [];
  const issues: ValidationIssue[] = [];
  const add = (name: string, p: IpPool | undefined): void => {
    if (!p) return;
    const a = expandPool(p);
    if (!a) issues.push(issue('IP_POOL_INVALID', 'error', `${name}: invalid IP range or address list.`, '20 §4.2 step 11 [S14]', name));
    else pools.push({ name, addrs: a });
  };
  const n = spec.networks;
  add('VCF Management Services IP Range', n.managementServicesIpPool);
  if (isVcfAutomationDeployedNow(spec)) add('VCF Automation IP Range', n.vcfAutomationIpPool);
  n.vmotion.inclusionRanges.forEach((r) => add('vMotion inclusion range', r));
  n.storage?.inclusionRanges.forEach((r) => add('Storage inclusion range', r));
  if (spec.networkConfig.vpcNetwork === 'full-stack') n.nsxHostOverlay?.inclusionRanges.forEach((r) => add('NSX Host Overlay inclusion range', r));
  return { pools, issues };
}

/**
 * Step 11 IP pools (20 §3.5, §4.2 step 11, §5.1, §6.4 [S14][S19]).
 * - services runtime: ≥ 12 IPs (error), recommended 30 (warning – modelling decision for "recommended"),
 * - VCF Automation: 5 IPs,
 * - internal cluster CIDR: one of the documented values,
 * - inclusion ranges (vMotion / vSAN|NFS / TEP): ≥ number of hosts (TEP: per active uplink),
 *   in the network's subnet ("správná VLAN"), no network/broadcast address, no conflicts.
 */
export function validateIpPools(spec: BringupSpec, env: BringupEnvironment): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const n = spec.networks;
  const { pools, issues } = poolsOf(spec);
  out.push(...issues);

  const svc = pools.find((p) => p.name === 'VCF Management Services IP Range');
  if (svc) {
    if (svc.addrs.length < SERVICES_RUNTIME_MIN_IPS)
      out.push(issue('SERVICES_RUNTIME_IPS_TOO_FEW', 'error', `VCF services runtime requires at least ${SERVICES_RUNTIME_MIN_IPS} IP addresses.`, '20 §3.5, §6.4 [S19]', 'networks.managementServicesIpPool'));
    else if (svc.addrs.length < SERVICES_RUNTIME_RECOMMENDED_IPS)
      out.push(issue('SERVICES_RUNTIME_IPS_BELOW_RECOMMENDED', 'warning', `Reserving ${SERVICES_RUNTIME_RECOMMENDED_IPS} IP addresses for the VCF services runtime is recommended (Day-N services consume IPs from this block).`, '20 §3.5, §6.4 [S19]', 'networks.managementServicesIpPool'));
  }
  if (isVcfAutomationDeployedNow(spec)) {
    const va = pools.find((p) => p.name === 'VCF Automation IP Range');
    if (!n.vcfAutomationIpPool || (va && va.addrs.length < VCF_AUTOMATION_IPS))
      out.push(issue('VCF_AUTOMATION_IPS_TOO_FEW', 'error', `VCF Automation requires ${VCF_AUTOMATION_IPS} IP addresses (3 for nodes, 2 buffer).`, '20 §3.5 [S19]', 'networks.vcfAutomationIpPool'));
  }
  if (!(SERVICES_RUNTIME_INTERNAL_CIDRS_IPV4 as readonly string[]).includes(spec.components.internalClusterCidrIpv4))
    out.push(issue('INTERNAL_CIDR_INVALID', 'error', `Internal cluster CIDR must be one of ${SERVICES_RUNTIME_INTERNAL_CIDRS_IPV4.join(', ')}.`, '20 §3.5, §6.5 [S19][S21]', 'components.internalClusterCidrIpv4'));

  // Host networks.
  const hostCount = spec.esxHosts.length;
  const nsxSwitch = spec.vds.switches.find((s) => s.trafficTypes.includes('nsx'));
  // TODO(spec): "1 IP per active VDS uplink per host" – active/standby uplinks are not modelled;
  // all uplinks of the NSX-carrying switch are treated as active.
  const tepPerHost = nsxSwitch?.uplinks ?? 1;
  const checkNet = (name: string, net: HostNetworkSpec | undefined, perHost: number, field: string): void => {
    if (!net) {
      out.push(issue('HOST_NETWORK_MISSING', 'error', `${name} network is required.`, '20 §4.2 step 11 [S14]', field));
      return;
    }
    const cidr = parseCidr(net.cidr);
    if (!cidr) {
      out.push(issue('NETWORK_CIDR_INVALID', 'error', `${name}: invalid subnet.`, '20 §4.2 step 11 [S14]', field));
      return;
    }
    const addrs = net.inclusionRanges.flatMap((r) => expandPool(r) ?? []);
    if (addrs.length < hostCount * perHost)
      out.push(issue('INCLUSION_RANGE_TOO_SMALL', 'error', `${name}: IP inclusion range must contain at least ${hostCount * perHost} addresses.`, '20 §5.1, §6.4 [S14][S19]', field));
    for (const a of addrs) {
      if (!cidrContains(cidr, a)) {
        out.push(issue('INCLUSION_RANGE_OUTSIDE_SUBNET', 'error', `${name}: ${formatIpv4(a)} is outside ${net.cidr} (VLAN ${net.vlanId}).`, '20 §5.1 [S14][S34]', field));
        break;
      }
      if (isNetworkOrBroadcast(cidr, a)) {
        out.push(issue('INCLUSION_RANGE_NETWORK_OR_BROADCAST', 'error', `${name}: ${formatIpv4(a)} is a network or broadcast address.`, '20 §5.1 [S14][S34]', field));
        break;
      }
    }
  };
  checkNet('vMotion', n.vmotion, 1, 'networks.vmotion');
  if (spec.storage.type !== 'vmfs-fc') checkNet(spec.storage.type === 'nfs-v3' ? 'NFS' : 'vSAN', n.storage, 1, 'networks.storage');
  if (spec.networkConfig.vpcNetwork === 'full-stack') checkNet('NSX Host Overlay', n.nsxHostOverlay, tepPerHost, 'networks.nsxHostOverlay');

  // Conflicts between pools and with host management IPs (20 §5.1 "bez konfliktů").
  const owner = new Map<number, string>();
  const hostIps = env.hosts.map((h) => ({ name: `ESX host ${h.id}`, ip: h.network ? parseIpv4(h.network.ipv4Address) : undefined }));
  for (const h of hostIps) if (h.ip !== undefined) owner.set(h.ip, h.name);
  for (const p of pools) {
    for (const a of p.addrs) {
      const prev = owner.get(a);
      if (prev !== undefined && prev !== p.name) {
        out.push(issue('IP_CONFLICT', 'error', `${p.name}: ${formatIpv4(a)} conflicts with ${prev}.`, '20 §5.1 [S14]', p.name));
        break;
      }
      owner.set(a, p.name);
    }
  }
  return out;
}

/**
 * Step 12–17 FQDNs (20 §3.5, §5.1, §6.4 [S14][S19][S20]): required fields present, syntax,
 * forward+reverse DNS, unique unassigned IP outside the VCF management services ranges.
 */
export function validateComponentFqdns(spec: BringupSpec, env: BringupEnvironment): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const reqs = fqdnRequirements(spec);
  const pools = poolsOf(spec).pools;
  const ipOwner = new Map<string, string>();
  for (const h of env.hosts) if (h.network) ipOwner.set(h.network.ipv4Address, `ESX host ${h.id}`);
  for (const r of reqs) {
    if (r.value === undefined || r.value.trim() === '') {
      if (r.required) out.push(issue('FQDN_REQUIRED', 'error', `${r.field} is required.`, '20 §4.2 step 12, §6.4 [S14][S19]', r.field));
      continue;
    }
    out.push(...validateFqdnSyntax(r.value, r.field));
    out.push(...validateDnsRecords(env.dns, r.value, r.field));
    const ip = env.dns.forward[r.value.toLowerCase()];
    if (ip === undefined) continue;
    const prev = ipOwner.get(ip);
    if (prev !== undefined)
      out.push(issue('FQDN_IP_NOT_UNIQUE', 'error', `${r.field}: IP ${ip} is already assigned to ${prev}.`, '20 §3.5, §5.1 [S14][S19]', r.field));
    else ipOwner.set(ip, r.field);
    const n = parseIpv4(ip);
    const inPool = n === undefined ? undefined : pools.find((p) => p.addrs.includes(n));
    if (inPool)
      out.push(issue('FQDN_IP_IN_RESERVED_RANGE', 'error', `${r.field}: IP ${ip} lies in ${inPool.name}.`, '20 §3.5, §5.1 [S14][S19]', r.field));
  }
  return out;
}

/** Step 16 (20 §4.2 step 16, §6.4 [S14][S19]): NSX nodes 1 (Simple) / 3 (HA) + VIP. */
export function validateNsxManager(spec: BringupSpec): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const expected = FIRST_INSTANCE_SIZING[sizingProfileOf(spec.model, spec.size)].nsx.nodes;
  if (spec.nsx.nodeFqdns.length !== expected)
    out.push(issue('NSX_NODE_COUNT', 'error', `${spec.model} deployment requires ${expected} NSX Manager node FQDN(s).`, '20 §2.1, §6.4 [S4][S19]', 'nsx.nodeFqdns'));
  if (spec.networkConfig.vpcGatewayConnectivity === 'distributed') {
    const d = spec.nsx.distributedConnectivity;
    if (!d || parseCidr(d.gatewayCidrIpv4) === undefined)
      out.push(issue('NSX_DISTRIBUTED_CONNECTIVITY_MISSING', 'error', 'Distributed connectivity: VLAN ID and Gateway CIDR IPv4 address (matching the ToR gateway) are required.', '20 §4.2 steps 6, 16 [S14]', 'nsx.distributedConnectivity'));
  }
  return out;
}

/** Step 15 (20 §4.2 step 15, §6.5 [S14][S32]). */
export function validateDistributedSwitches(spec: BringupSpec, env: BringupEnvironment): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const v = spec.vds;
  if (v.switches.length === 0)
    out.push(issue('VDS_NONE', 'error', 'At least one vSphere Distributed Switch per cluster is required.', '00 §3 [S1]', 'vds'));
  if (v.profile !== 'custom' && v.switches.length !== VDS_PROFILE_SWITCH_COUNT[v.profile])
    out.push(issue('VDS_PROFILE_SWITCH_COUNT', 'error', `Profile ${v.profile} uses ${VDS_PROFILE_SWITCH_COUNT[v.profile]} distributed switch(es).`, '20 §4.2 step 15, §6.5 [S14]', 'vds'));
  for (const s of v.switches)
    if (s.uplinks < 1)
      out.push(issue('VDS_NO_UPLINK', 'error', `Distributed switch ${s.name} needs at least one uplink.`, '20 §4.2 step 15 [S14]', s.name));
  // Model consistency: uplinks are mapped to physical NICs; cannot map more than the hosts have.
  const totalUplinks = v.switches.reduce((a, s) => a + s.uplinks, 0);
  const prepared = env.hosts.filter((h) => spec.esxHosts.some((e) => e.fqdn === h.network?.hostnameFqdn));
  const minPnic = prepared.length ? Math.min(...prepared.map((h) => h.pnicCount)) : undefined;
  if (minPnic !== undefined && totalUplinks > minPnic)
    out.push(issue('VDS_UPLINKS_EXCEED_PNICS', 'error', `Distributed switches need ${totalUplinks} physical NICs per host; hosts have ${minPnic}.`, '20 §4.2 step 15 [S14] (uplink-to-pNIC mapping)', 'vds'));
  if (v.switches.some((s) => s.uplinkMode === 'vds-lag') && env.physicalNetworkLagReady === false)
    out.push(issue('LAG_PHYSICAL_NETWORK_NOT_READY', 'error', 'Physical network is not ready for LAG (LACP).', '20 §4.2 [9.1] [S32]', 'vds'));
  return out;
}

/**
 * Step 17 (20 §4.1.5 step 8, §4.2 step 17 [S6][S14]): with the installer on a management host its
 * hostname becomes the SDDC Manager FQDN and cannot be changed.
 */
export function validateSddcManager(spec: BringupSpec, installer: InstallerState): ValidationIssue[] {
  const ovf = installer.ovf;
  if (ovf?.placement === 'management-host' && ovf.hostnameFqdn !== spec.sddcManager.fqdn)
    return [issue('SDDC_MANAGER_FQDN_FIXED', 'error', `The installer runs on a management host; its FQDN ${ovf.hostnameFqdn} becomes the SDDC Manager FQDN and cannot be changed.`, '20 §4.1.5 step 8, §4.2 step 17 [S6][S14]', 'sddcManager.fqdn')];
  return [];
}

/** Installer must reach hosts, DNS and NTP (20 §3.3 [S5][S6]). */
export function validateReachability(spec: BringupSpec, env: BringupEnvironment): ValidationIssue[] {
  const unreachable = new Set(env.unreachableFromInstaller ?? []);
  const targets = [
    ...spec.esxHosts.map((h) => h.fqdn),
    ...spec.general.dnsServers,
    ...spec.general.ntpServers,
  ];
  return targets
    .filter((t) => unreachable.has(t))
    .map((t) => issue('INSTALLER_CANNOT_REACH', 'error', `VCF Installer cannot reach ${t}.`, '20 §3.3 [S5][S6]', t));
}

/**
 * Step 19 "Review validation" – full pre-deployment validation (20 §4.2 step 19, §5.1 [S14][S15]).
 * Errors block deployment; warnings must be fixed or acknowledged.
 */
export function validateBringupSpec(spec: BringupSpec, env: BringupEnvironment): ValidationIssue[] {
  return [
    ...validateInstallerCanDeploy(env.installer),
    ...validateExistingComponents(spec),
    ...validateDeploymentModel(spec),
    ...validateNetworkConfiguration(spec, env.installer),
    ...validateStorage(spec),
    ...validateGeneralConfiguration(spec, env),
    ...validateHostEntries(spec, env),
    ...validateIpPools(spec, env),
    ...validateComponentFqdns(spec, env),
    ...validateDistributedSwitches(spec, env),
    ...validateNsxManager(spec),
    ...validateSddcManager(spec, env.installer),
    ...validateReachability(spec, env),
    ...validateBinariesForDeployment(env.depot),
  ];
}

// ===========================================================================
// Deployment state machine (20 §4.2 steps 18–20, §4.3, §5.1 [S14][S15])
// ===========================================================================

export type DeploymentStatus =
  | 'draft' // wizard pages / JSON being prepared
  | 'review' // step 18 "Review deployment information" / JSON Summary + Preview
  | 'validating' // step 19 running (duration: engine)
  | 'validation-failed' // errors present -> fix (edit) and re-validate
  | 'awaiting-acknowledgement' // warnings only -> address or Acknowledge
  | 'ready-to-deploy'
  | 'deploying' // step 20 running (duration: engine)
  | 'deployment-failed' // failed task in Tasks panel -> address and retry
  | 'completed';

export type DeploymentEvent =
  | { readonly type: 'submit-for-review' }
  | { readonly type: 'edit' }
  | { readonly type: 'start-validation' }
  | { readonly type: 'validation-finished'; readonly issues: readonly ValidationIssue[] }
  | { readonly type: 'acknowledge-warnings' }
  | { readonly type: 'deploy' }
  | { readonly type: 'task-failed'; readonly task: string }
  | { readonly type: 'retry' }
  | { readonly type: 'deployment-succeeded' };

export interface DeploymentState {
  readonly status: DeploymentStatus;
  /** Wizard or "Deploy Using JSON Spec" (20 §4.2 / §4.3). */
  readonly source: 'wizard' | 'json';
  readonly issues: readonly ValidationIssue[];
  readonly warningsAcknowledged: boolean;
  readonly failedTask?: string;
}

/** Allowed (status, event) pairs. */
export const DEPLOYMENT_TRANSITIONS: Readonly<Record<DeploymentStatus, readonly DeploymentEvent['type'][]>> = {
  draft: ['submit-for-review'],
  review: ['edit', 'start-validation'],
  validating: ['validation-finished'],
  'validation-failed': ['edit', 'start-validation'],
  'awaiting-acknowledgement': ['edit', 'acknowledge-warnings', 'start-validation'],
  'ready-to-deploy': ['edit', 'deploy'],
  deploying: ['task-failed', 'deployment-succeeded'],
  'deployment-failed': ['retry'],
  completed: [],
};

export function initialDeploymentState(source: 'wizard' | 'json' = 'wizard'): DeploymentState {
  return { status: 'draft', source, issues: [], warningsAcknowledged: false };
}

/**
 * Pure transition function of the deployment state machine.
 * - warnings: "either address them or click Acknowledge to proceed" (20 §5.1),
 * - errors: resolve and re-validate; deploy only after resolution (20 §5.1),
 * - failed task: "address the issue(s), and retry the deployment" (20 §5.1).
 */
export function transitionDeployment(state: DeploymentState, event: DeploymentEvent): TransitionResult<DeploymentState> {
  if (!DEPLOYMENT_TRANSITIONS[state.status].includes(event.type))
    return {
      ok: false,
      error: issue('ILLEGAL_DEPLOYMENT_TRANSITION', 'error', `Action "${event.type}" is not allowed in state "${state.status}".`, '20 §4.2 steps 18–20, §5.1 [S14]'),
    };
  const base = { source: state.source };
  switch (event.type) {
    case 'submit-for-review':
      return { ok: true, state: { ...base, status: 'review', issues: [], warningsAcknowledged: false } };
    case 'edit':
      return { ok: true, state: { ...base, status: 'draft', issues: [], warningsAcknowledged: false } };
    case 'start-validation':
      return { ok: true, state: { ...base, status: 'validating', issues: [], warningsAcknowledged: false } };
    case 'validation-finished': {
      const status: DeploymentStatus = hasErrors(event.issues)
        ? 'validation-failed'
        : warningsOf(event.issues).length > 0
          ? 'awaiting-acknowledgement'
          : 'ready-to-deploy';
      return { ok: true, state: { ...base, status, issues: event.issues, warningsAcknowledged: false } };
    }
    case 'acknowledge-warnings':
      return { ok: true, state: { ...state, status: 'ready-to-deploy', warningsAcknowledged: true } };
    case 'deploy':
      return { ok: true, state: { ...state, status: 'deploying' } };
    case 'task-failed':
      return { ok: true, state: { ...state, status: 'deployment-failed', failedTask: event.task } };
    case 'retry': {
      const { failedTask: _f, ...rest } = state;
      void _f;
      return { ok: true, state: { ...rest, status: 'deploying' } };
    }
    case 'deployment-succeeded':
      return { ok: true, state: { ...state, status: 'completed' } };
  }
}
// TODO(spec 20 §8 q6): internal bring-up task names/order (Tasks panel) are not documented;
// `task-failed.task` is free text supplied by the engine/scenario.

// ===========================================================================
// Result: fleet + first instance (00 §1, §2.1; 20 §2.1 [S1][S4][S23])
// ===========================================================================

function comp(kind: DeployedComponent['kind'], nodes: number, size?: string, fqdns?: readonly string[]): DeployedComponent {
  return {
    kind,
    nodes,
    ...(size !== undefined ? { size } : {}),
    ...(fqdns !== undefined ? { fqdns: fqdns.filter((f) => f !== '') } : {}),
  };
}

/**
 * Components deployed by VCF Installer into the management domain of the first instance
 * (20 §2.1 [S4], sizing 20 §6.2 [S23]). VCF Automation is omitted when "existing / deploy later"
 * is selected; VCF Operations, cloud proxy, license server and VCF Automation are omitted when they
 * are deferred to custom networking (20 §4.2 step 6, §4.5).
 */
export function managementDomainComponentsFor(spec: BringupSpec): DeployedComponent[] {
  const s = FIRST_INSTANCE_SIZING[sizingProfileOf(spec.model, spec.size)];
  const c = spec.components;
  const deferred = spec.networkConfig.deployOpsAndAutomationToCustomNetwork;
  const out: DeployedComponent[] = [comp('sddc-manager', s.sddcManager.nodes, s.sddcManager.size, [spec.sddcManager.fqdn])];
  if (!deferred) {
    if (s.vcfOperations)
      out.push(
        comp('vcf-operations', s.vcfOperations.nodes, s.vcfOperations.size, [c.vcfOperationsPrimaryFqdn ?? '', c.vcfOperationsReplicaFqdn ?? '', c.vcfOperationsDataFqdn ?? ''].slice(0, s.vcfOperations.nodes)),
      );
    out.push(comp('cloud-proxy', s.cloudProxy.nodes, s.cloudProxy.size, [c.cloudProxyFqdn ?? '']));
    if (s.licenseServer) out.push(comp('license-server', s.licenseServer.nodes, s.licenseServer.size, [c.licenseServerFqdn ?? '']));
  }
  if (isVcfAutomationDeployedNow(spec) && s.vcfAutomation)
    out.push(comp('vcf-automation', s.vcfAutomation.nodes, s.vcfAutomation.size, [c.vcfAutomationFqdn ?? '']));
  const ms = s.managementServices;
  out.push(comp('vcf-services-runtime', ms.controlPlaneNodes + ms.workerNodes, undefined, [c.servicesRuntimeFqdn ?? '']));
  for (const k of ['fleet-lifecycle', 'sddc-lifecycle', 'software-depot', 'identity-broker', 'salt-raas', 'salt-master', 'telemetry'] as const)
    out.push(comp(k, 1));
  return out;
}

/**
 * Builds the resulting Fleet with its first VCF Instance and management domain after a successful
 * bring-up. `clusterModel` is passed in because the wizard pages in the spec do not expose it
 * (Basic design management cluster = single-rack, 00 §6 [S16]).
 */
export function buildFleetFromBringup(
  spec: BringupSpec,
  ids: { readonly fleetId: string; readonly fleetName: string; readonly instanceId: string; readonly domainId: string; readonly clusterId: string },
  clusterModel: ClusterModel,
): Fleet {
  const s = FIRST_INSTANCE_SIZING[sizingProfileOf(spec.model, spec.size)];
  const cluster: Cluster = {
    id: ids.clusterId,
    name: `${spec.general.managementDomainName}-cl01`,
    model: clusterModel,
    haEnabled: true,
    drsEnabled: true,
    distributedSwitchCount: spec.vds.switches.length,
    hosts: spec.esxHosts.map((h, i) => ({ id: `${ids.clusterId}-host-${i + 1}`, fqdn: h.fqdn })),
  };
  const domain: Domain = {
    id: ids.domainId,
    name: spec.general.managementDomainName,
    kind: 'management',
    vcenter: comp('vcenter', 1, s.vcenter.size, [spec.vcenter.fqdn]),
    nsx: { mode: 'dedicated', model: spec.model === 'simple' ? 'simple' : 'high-availability' },
    clusters: [cluster],
    components: managementDomainComponentsFor(spec),
  };
  const instance: Instance = {
    id: ids.instanceId,
    name: spec.general.instanceName,
    isFirstInstance: spec.target === 'new-fleet',
    managementDomain: domain,
    workloadDomains: [],
    version: spec.general.version,
  };
  return { id: ids.fleetId, name: ids.fleetName, instances: [instance], standaloneVcenters: [] };
}
