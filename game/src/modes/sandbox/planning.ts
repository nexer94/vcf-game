/**
 * Planning phase helpers: DNS environment edits and the preparation checklist view.
 * Readiness is always decided by model validations (validateEsxHostsForBringup,
 * validateManagementHostCount, validateInstallerCanDeploy, validateBinariesForDeployment).
 */
import {
  type BinaryStatus,
  type BringupEnvironment,
  type DesignBringupParams,
  type DnsCheck,
  type DnsRecords,
  type EsxHost,
  type InstallerState,
  type ValidationIssue,
  type VcfBinary,
  VCF_BINARIES,
  checkForwardReverse,
  minManagementDefaultClusterHosts,
  validateBinariesForDeployment,
  validateEsxHostsForBringup,
  validateInstallerCanDeploy,
  validateManagementHostCount,
} from '../../model';
import { type IssueGroups, groupIssues } from './design';
import type { DnsRecordKind, SandboxEnvironment, SandboxTask } from './types';

// ---------------------------------------------------------------------------
// DNS environment actions
// ---------------------------------------------------------------------------

/** Adds A and/or PTR records. Forward keys are lowercase (lookup in net.checkForwardReverse is lowercase). */
export function addDnsRecord(dns: DnsRecords, fqdn: string, ip: string, kind: DnsRecordKind = 'a+ptr'): DnsRecords {
  const forward = { ...dns.forward };
  const reverse = { ...dns.reverse };
  if (kind !== 'ptr') forward[fqdn.toLowerCase()] = ip;
  if (kind !== 'a') reverse[ip] = fqdn;
  return { forward, reverse };
}

/** Removes the A record of `fqdn` and/or PTR records pointing to it. */
export function removeDnsRecord(dns: DnsRecords, fqdn: string, kind: DnsRecordKind = 'a+ptr'): DnsRecords {
  const key = fqdn.toLowerCase();
  const forward = { ...dns.forward };
  const reverse: Record<string, string> = {};
  if (kind !== 'ptr') delete forward[key];
  for (const [ip, name] of Object.entries(dns.reverse)) {
    if (kind !== 'a' && name.toLowerCase() === key) continue;
    reverse[ip] = name;
  }
  return { forward, reverse };
}

export interface DnsView {
  /** A records with the model's forward + reverse check (net.checkForwardReverse). */
  readonly a: readonly { readonly fqdn: string; readonly ip: string; readonly check: DnsCheck }[];
  /** PTR records (IP -> FQDN). */
  readonly ptr: readonly { readonly ip: string; readonly fqdn: string }[];
}

export function dnsView(dns: DnsRecords): DnsView {
  return {
    a: Object.entries(dns.forward)
      .map(([fqdn, ip]) => ({ fqdn, ip, check: checkForwardReverse(dns, fqdn) }))
      .sort((x, y) => x.fqdn.localeCompare(y.fqdn)),
    ptr: Object.entries(dns.reverse)
      .map(([ip, fqdn]) => ({ ip, fqdn }))
      .sort((x, y) => x.fqdn.localeCompare(y.fqdn)),
  };
}

// ---------------------------------------------------------------------------
// Checklist view
// ---------------------------------------------------------------------------

export interface HostPrepView {
  readonly host: EsxHost;
  /** Facts of the host state (UI ticks); readiness is `issues`. */
  readonly steps: {
    readonly esxInstalled: boolean;
    readonly managementNetworkConfigured: boolean;
    readonly ntpRunning: boolean;
    readonly sshEnabled: boolean;
    readonly certificateCn: string;
    readonly certificateMatchesFqdn: boolean;
    readonly dns?: DnsCheck;
  };
  /** validateEsxHostsForBringup for this host (host count excluded). */
  readonly issues: IssueGroups;
  readonly ready: boolean;
  /** Host is part of the deployed management domain (prep actions locked). */
  readonly inDeployedDomain: boolean;
}

export interface BinaryView {
  readonly binary: VcfBinary;
  readonly status: BinaryStatus;
  /** Running task progress [0, 1] (illustrative duration). */
  readonly progress?: number;
}

export interface PlanningView {
  readonly installer: { readonly state: InstallerState; readonly canDeployIssues: readonly ValidationIssue[] };
  readonly depot: {
    readonly connection: SandboxEnvironment['depot']['connection'];
    readonly binaries: readonly BinaryView[];
    readonly issues: IssueGroups;
    readonly downloadedCount: number;
    readonly total: number;
  };
  readonly hosts: readonly HostPrepView[];
  readonly hostCount: {
    readonly count: number;
    readonly readyCount: number;
    /** Minimum from the model (10 §6.1); undefined = not documented unambiguously. */
    readonly minimum?: number;
    readonly issues: IssueGroups;
  };
  readonly dns: DnsView;
  readonly unreachableFromInstaller: readonly string[];
  readonly physicalNetworkLagReady?: boolean;
  /** All planning issues together (installer + binaries + host count + hosts). */
  readonly issues: IssueGroups;
}

export function planningView(
  env: SandboxEnvironment,
  bringupEnv: BringupEnvironment,
  params: DesignBringupParams | undefined,
  tasks: readonly SandboxTask[],
  deployedHostFqdns: ReadonlySet<string>,
): PlanningView {
  const model = params?.model ?? 'simple';
  const storage = params?.storage ?? 'vsan-esa';
  const hosts = env.hosts.map((h): HostPrepView => {
    const issues = validateEsxHostsForBringup([h], {
      dns: env.dns,
      model,
      storage,
      checkHostCount: false,
      ...(bringupEnv.rules ? { rules: bringupEnv.rules } : {}),
    });
    const fqdn = h.network?.hostnameFqdn;
    return {
      host: h,
      steps: {
        esxInstalled: h.esxVersion !== undefined,
        managementNetworkConfigured: h.network !== undefined,
        ntpRunning: h.ntp.enabled && h.ntp.serviceRunning && h.ntp.servers.length > 0,
        sshEnabled: h.sshEnabled,
        certificateCn: h.certificateCn,
        certificateMatchesFqdn: fqdn !== undefined && h.certificateCn === fqdn,
        ...(fqdn !== undefined ? { dns: checkForwardReverse(env.dns, fqdn) } : {}),
      },
      issues: groupIssues(issues),
      ready: !issues.some((i) => i.severity === 'error'),
      inDeployedDomain: fqdn !== undefined && deployedHostFqdns.has(fqdn),
    };
  });
  const countIssues = params
    ? validateManagementHostCount(env.hosts.length, { model: params.model, storage: params.storage, clusterModel: params.clusterModel })
    : [];
  const minimum = params ? minManagementDefaultClusterHosts(params.clusterModel, params.model, params.storage) : undefined;
  const binIssues = validateBinariesForDeployment(env.depot);
  const binaries = VCF_BINARIES.map((b): BinaryView => ({ binary: b, status: env.depot.binaries[b] ?? 'not-downloaded' }));
  const installerIssues = validateInstallerCanDeploy(env.installer);
  const view: PlanningView = {
    installer: { state: env.installer, canDeployIssues: installerIssues },
    depot: {
      connection: env.depot.connection,
      binaries,
      issues: groupIssues(binIssues),
      downloadedCount: binaries.filter((b) => b.status === 'downloaded').length,
      total: VCF_BINARIES.length,
    },
    hosts,
    hostCount: {
      count: env.hosts.length,
      readyCount: hosts.filter((h) => h.ready).length,
      ...(minimum !== undefined ? { minimum } : {}),
      issues: groupIssues(countIssues),
    },
    dns: dnsView(env.dns),
    unreachableFromInstaller: env.unreachableFromInstaller,
    ...(env.physicalNetworkLagReady !== undefined ? { physicalNetworkLagReady: env.physicalNetworkLagReady } : {}),
    issues: groupIssues([...installerIssues, ...binIssues, ...countIssues, ...hosts.flatMap((h) => [...h.issues.errors, ...h.issues.warnings, ...h.issues.recommendations])]),
  };
  return withBinaryProgress(view, tasks);
}

/**
 * Overlays running binary task progress onto a planning view. Cheap (no validation), so the session
 * can keep the heavy view cached while only progress changes. Returns `view` itself when no binary
 * task runs.
 */
export function withBinaryProgress(view: PlanningView, tasks: readonly SandboxTask[]): PlanningView {
  const progress = new Map<string, number>();
  for (const t of tasks)
    if (t.payload.kind === 'binary-download' || t.payload.kind === 'binary-validation') progress.set(t.payload.binary, Math.min(1, t.elapsedMs / t.durationMs));
  if (progress.size === 0) return view;
  const binaries = view.depot.binaries.map((b): BinaryView => {
    const p = progress.get(b.binary);
    return p === undefined ? b : { ...b, progress: p };
  });
  return { ...view, depot: { ...view.depot, binaries } };
}
