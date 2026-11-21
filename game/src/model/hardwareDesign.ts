/**
 * Adapter: physical server room -> bring-up model (bringup.ts) and design phase (design.ts).
 *
 * - toBringupHosts(): EsxHost[] for validateEsxHostsForBringup (vendor, HW profile fingerprint, pNIC count,
 *   vmk0 on a standard switch derived from the host networking).
 * - hardwareContext(): summary of the purchased hardware (host count, vendors, ESA eligibility, NIC ports…).
 * - optionAvailabilityWithHardware(): design.optionAvailability + HW limits with the action that would unlock
 *   the option (data only; the UI formats it).
 *
 * HW limits used (all from the spec):
 *  - host minimums of the management domain default cluster (10 §6.1 via minManagementDefaultClusterHosts),
 *  - vSAN ESA requires ESA-eligible hosts (15 §5 REQ findings),
 *  - VMFS on FC needs an FC HBA (15 §2.3, §7 #7), NFS v3 known issue with a single pNIC (20 §5.3 #3 [S31]),
 *  - pNIC count per Distributed Switch model (05 §4.6 [D15], 10 §3.3 [P17]),
 *  - homogeneity / single vendor of the initial management cluster (10 §3.4, 20 §3.2).
 *
 * Pure TypeScript: no DOM, no PixiJS.
 */
import type { ClusterModel } from './architecture';
import { type DeploymentModel, type EsxHost, type StorageType, minManagementDefaultClusterHosts } from './bringup';
import { type DesignChoices, type DesignContext, type DesignDecisionId, type OptionAvailability, optionAvailability } from './design';
import {
  type DistributedSwitchModelId,
  type EsaProfileId,
  type HwFinding,
  type HwVendor,
  nicRequirementForVdsModel,
  validateClusterHardware,
  validateNicsForVdsModel,
  validateServerConfig,
  validateVsanNicCount,
} from './hardware';
import type { HardwareCatalog } from './hardwareCatalog';
import { type PhysicalServer, type PhysicalState, serverNicPorts, serverNodeSpeed } from './physical';
import { type ValidationIssue, issue } from './validation';

// ===========================================================================
// Bring-up adapter
// ===========================================================================

/** EsxHost records of the servers (default: all servers). vmk0OnStandardSwitch is derived from host networking. */
export function toBringupHosts(state: PhysicalState, serverIds?: readonly string[]): EsxHost[] {
  const pick = serverIds ? state.servers.filter((s) => serverIds.includes(s.id)) : state.servers;
  return pick.map((s) => {
    const vmk0 = s.hostNet?.vmks.find((v) => v.name === 'vmk0');
    const onVss = s.hostNet?.switches.some((sw) => sw.name === vmk0?.switchName && sw.kind === 'vss') === true;
    return { ...s.esx, vmk0OnStandardSwitch: s.esx.esxVersion !== undefined && onVss };
  });
}

// ===========================================================================
// Hardware context
// ===========================================================================

export interface HostHwSummary {
  readonly serverId: string;
  readonly vendor: HwVendor | undefined;
  readonly nicPorts: number;
  readonly nodeNetworkGbE: number;
  readonly fcHba: boolean;
  /** Findings for vSAN ESA HCI use (15 §5). */
  readonly esaFindings: readonly HwFinding[];
  readonly esaEligible: boolean;
  readonly esaProfile: EsaProfileId | undefined;
}

export interface HardwareContext {
  readonly hostCount: number;
  readonly hosts: readonly HostHwSummary[];
  readonly vendors: readonly HwVendor[];
  readonly esaEligibleHostIds: readonly string[];
  readonly minNicPorts: number;
  readonly fcHbaHostIds: readonly string[];
}

export function hardwareContext(state: PhysicalState, catalog: HardwareCatalog, serverIds?: readonly string[]): HardwareContext {
  const servers = serverIds ? state.servers.filter((s) => serverIds.includes(s.id)) : state.servers;
  const hosts = servers.map((s): HostHwSummary => {
    const r = validateServerConfig(catalog, s.config, { storage: 'vsan-esa', subject: s.id });
    return {
      serverId: s.id,
      vendor: catalog.models.get(s.config.modelId)?.vendor,
      nicPorts: serverNicPorts(catalog, s).length,
      nodeNetworkGbE: serverNodeSpeed(catalog, s),
      fcHba: s.config.fcHba,
      esaFindings: r.findings,
      esaEligible: r.eligible,
      esaProfile: r.esaProfile?.profile,
    };
  });
  return {
    hostCount: hosts.length,
    hosts,
    vendors: [...new Set(hosts.map((h) => h.vendor).filter((v): v is HwVendor => v !== undefined))],
    esaEligibleHostIds: hosts.filter((h) => h.esaEligible).map((h) => h.serverId),
    minNicPorts: hosts.length ? Math.min(...hosts.map((h) => h.nicPorts)) : 0,
    fcHbaHostIds: hosts.filter((h) => h.fcHba).map((h) => h.serverId),
  };
}

/** All HW findings for the hosts of the initial management cluster (per host + cluster level). */
export function validateManagementClusterHardware(state: PhysicalState, catalog: HardwareCatalog, serverIds: readonly string[], storage: StorageType): HwFinding[] {
  const servers = state.servers.filter((s) => serverIds.includes(s.id));
  const out: HwFinding[] = [];
  for (const s of servers) out.push(...validateServerConfig(catalog, s.config, { storage, subject: s.id }).findings);
  out.push(...validateClusterHardware(catalog, servers.map((s: PhysicalServer) => ({ hostId: s.id, config: s.config })), { initialManagementCluster: true, storage }));
  return out;
}

// ===========================================================================
// Design option availability limited by hardware
// ===========================================================================

export type UnlockAction =
  | { readonly kind: 'buy-hosts'; readonly count: number }
  | { readonly kind: 'add-nic-ports'; readonly hostIds: readonly string[]; readonly minPortsPerHost: number }
  | { readonly kind: 'fix-host-config'; readonly hostIds: readonly string[]; readonly codes: readonly string[] }
  | { readonly kind: 'add-fc-hba'; readonly hostIds: readonly string[] }
  | { readonly kind: 'use-single-vendor'; readonly vendors: readonly string[] };

export interface HwReason {
  readonly issue: ValidationIssue;
  /** Action that removes the reason; undefined when nothing in the room helps. */
  readonly unlock?: UnlockAction;
}

export interface HardwareAvailability {
  /**
   * - 'no-hardware-yet': nothing bought; requirements are shown neutrally (UX §3.1),
   * - 'ok': HW allows the option, 'insufficient': at least one error reason,
   * - 'not-hw-dependent': the option has no HW limits in the model.
   */
  readonly status: 'no-hardware-yet' | 'ok' | 'insufficient' | 'not-hw-dependent';
  readonly errors: readonly HwReason[];
  readonly warnings: readonly HwReason[];
  /** Documented requirement the option puts on HW (shown also before purchase), e.g. min hosts. */
  readonly requirements: readonly ValidationIssue[];
}

export interface OptionAvailabilityWithHardware extends OptionAvailability {
  readonly hardware: HardwareAvailability;
}

const INSTALLER_STORAGES: readonly string[] = ['vsan-esa', 'vsan-osa', 'vmfs-fc', 'nfs-v3'];

function minHostsFor(choices: DesignChoices): { min: number; storageAssumed: boolean } | undefined {
  const model = choices['deployment-model'] as DeploymentModel | undefined;
  const storage = choices['principal-storage'];
  const cm = (choices['mgmt-cluster-model'] as ClusterModel | undefined) ?? 'single-rack';
  if (!model) return undefined;
  if (storage !== undefined && INSTALLER_STORAGES.includes(storage)) {
    const m = minManagementDefaultClusterHosts(cm, model, storage as StorageType);
    return m === undefined ? undefined : { min: m, storageAssumed: false };
  }
  // storage not decided yet: lowest minimum over installer storages (10 §6.1)
  const all = INSTALLER_STORAGES.map((s) => minManagementDefaultClusterHosts(cm, model, s as StorageType)).filter((n): n is number => n !== undefined);
  return all.length ? { min: Math.min(...all), storageAssumed: true } : undefined;
}

/**
 * design.optionAvailability + hardware limits. HW errors make the option unavailable (UI: greyed with reason
 * and unlock action) – except when no hardware was bought yet (neutral requirement, UX §3.1).
 */
export function optionAvailabilityWithHardware(
  decision: DesignDecisionId,
  option: string,
  choices: DesignChoices,
  hw: HardwareContext,
  context: DesignContext = {},
): OptionAvailabilityWithHardware {
  const base = optionAvailability(decision, option, choices, context);
  const next: DesignChoices = { ...choices, [decision]: option };
  const errors: HwReason[] = [];
  const warnings: HwReason[] = [];
  const requirements: ValidationIssue[] = [];
  let hwDependent = false;

  const hostCountCheck = (subject: DesignDecisionId): void => {
    const mh = minHostsFor(next);
    if (!mh) return;
    hwDependent = true;
    const cm = (next['mgmt-cluster-model'] as string | undefined) ?? 'single-rack';
    const msg = `Management domain default cluster (${cm}, ${String(next['deployment-model'])}, ${mh.storageAssumed ? 'any principal storage' : String(next['principal-storage'])}) requires at least ${mh.min} ESX hosts; ${hw.hostCount} available.`;
    const req = issue('MGMT_DOMAIN_TOO_FEW_HOSTS', 'error', msg, cm === 'stretched' ? '10 §6.1 [P13]' : '10 §6.1 [P9][P11]', subject);
    requirements.push(req);
    if (hw.hostCount < mh.min) errors.push({ issue: req, unlock: { kind: 'buy-hosts', count: mh.min - hw.hostCount } });
  };

  if (decision === 'deployment-model' || decision === 'mgmt-cluster-model') hostCountCheck(decision);

  if (decision === 'principal-storage') {
    hostCountCheck(decision);
    if (option === 'vsan-esa') {
      hwDependent = true;
      const bad = hw.hosts.filter((h) => !h.esaEligible);
      if (bad.length) {
        const codes = [...new Set(bad.flatMap((h) => h.esaFindings.filter((f) => f.hwClass === 'REQ').map((f) => f.code)))];
        errors.push({
          issue: issue('HW_HOSTS_NOT_ESA_ELIGIBLE', 'error', `vSAN ESA: ${bad.length} host(s) do not meet the vSAN ESA ReadyNode requirements (${codes.join(', ')}).`, '15 §5; 10 §3.4', decision),
          unlock: { kind: 'fix-host-config', hostIds: bad.map((h) => h.serverId), codes },
        });
      }
      const seen = new Set<string>();
      for (const h of hw.hosts)
        for (const f of h.esaFindings)
          if (f.hwClass === 'DEV' && !seen.has(f.code)) {
            seen.add(f.code);
            warnings.push({ issue: f });
          }
    } else if (option === 'vmfs-fc') {
      hwDependent = true;
      const missing = hw.hosts.filter((h) => !h.fcHba).map((h) => h.serverId);
      if (missing.length)
        errors.push({ issue: issue('HW_FC_HBA_MISSING', 'error', `VMFS on FC: ${missing.length} host(s) have no FC HBA.`, '15 §2.3, §7 #7; 10 §3.5', decision), unlock: { kind: 'add-fc-hba', hostIds: missing } });
    } else if (option === 'nfs-v3') {
      hwDependent = true;
      const single = hw.hosts.filter((h) => h.nicPorts < 2).map((h) => h.serverId);
      if (single.length)
        errors.push({
          issue: issue('NFS_SINGLE_PNIC_UNSUPPORTED', 'error', `Failed to validate NFS configuration. NFS datastore mount failed on host ${single.join(', ')}`, '20 §5.3 #3 [S31]', decision),
          unlock: { kind: 'add-nic-ports', hostIds: single, minPortsPerHost: 2 },
        });
    } else if (option === 'vsan-osa') {
      hwDependent = true;
      warnings.push({ issue: issue('HW_OSA_NOT_MODELLED', 'recommendation', 'vSAN OSA hardware rules are not validated by the game yet (OSA ReadyNodes for 9.1 not in the dataset).', '15 §3.4, §8 OQ7', decision, 'game-scope') });
    }
  }

  if (decision === 'distributed-switch-model') {
    const per = hw.hosts.flatMap((h) => validateNicsForVdsModel(h.nicPorts, option as DistributedSwitchModelId, h.serverId).map((i) => ({ i, h })));
    const probe = validateNicsForVdsModel(0, option as DistributedSwitchModelId, decision)[0];
    if (probe) {
      hwDependent = true;
      requirements.push(probe);
    }
    const errHosts = per.filter((x) => x.i.severity === 'error');
    const warnHosts = per.filter((x) => x.i.severity === 'warning');
    const minPorts = nicRequirementForVdsModel(option as DistributedSwitchModelId)?.minPorts ?? 0;
    const unlock = (hs: typeof per): UnlockAction => ({ kind: 'add-nic-ports', hostIds: hs.map((x) => x.h.serverId), minPortsPerHost: minPorts });
    if (errHosts[0]) errors.push({ issue: errHosts[0].i, unlock: unlock(errHosts) });
    if (warnHosts[0]) warnings.push({ issue: warnHosts[0].i, unlock: unlock(warnHosts) });
    if (next['principal-storage'] === 'vsan-esa')
      for (const h of hw.hosts) {
        const r = validateVsanNicCount(h.nicPorts, h.esaProfile, h.serverId)[0];
        if (r) {
          warnings.push({ issue: r, unlock: { kind: 'add-nic-ports', hostIds: [h.serverId], minPortsPerHost: h.esaProfile && !h.esaProfile.endsWith('-SM') ? 4 : 2 } });
          break;
        }
      }
  }

  // Initial management cluster: single vendor (20 §3.2 [S7]) – relevant for any HW-dependent option.
  if (hwDependent && hw.vendors.length > 1)
    errors.push({
      issue: issue('ESX_MULTIPLE_VENDORS', 'error', `All ESX hosts in the management domain must be from the same hardware vendor (found ${hw.vendors.join(', ')}).`, '20 §3.2 [S7]; 10 §3.4 [P28]', decision),
      unlock: { kind: 'use-single-vendor', vendors: hw.vendors },
    });

  const status: HardwareAvailability['status'] = !hwDependent ? 'not-hw-dependent' : hw.hostCount === 0 ? 'no-hardware-yet' : errors.length ? 'insufficient' : 'ok';
  const blocking = status === 'insufficient';
  return {
    available: base.available && !blocking,
    errors: base.errors,
    warnings: base.warnings,
    hardware: { status, errors: status === 'no-hardware-yet' ? [] : errors, warnings: status === 'no-hardware-yet' ? [] : warnings, requirements },
  };
}
