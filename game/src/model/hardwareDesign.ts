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
 * Site limits (sites.ts, `site` part of the result) for the fleet deployment model and the Stretched cluster model:
 *  - Site HA / Fault Domains and DR / Stretched: AZ1 + AZ2 meeting the stretched inter-AZ requirements (RTT < 5 ms,
 *    ≥ 10 Gbps, 10 §3.3 [P13]), witness in a third fault domain ([P13]; [D11]), hosts per AZ (10 §6.1 [P13][P35]),
 *  - Disaster Recovery / Fault Domains and DR: location of a second VCF Instance (00 §6 [S16]; 05 §4.1 [D11]).
 *
 * Rack limits (rackAwareness.ts, `hardware` part of the result) for the management cluster model, once every host is
 * mounted: design cluster model vs. the physical rack topology (50 §7a bod 1, 8). WLD cluster model: requirements only
 * (WLD hosts are not part of the hardware context).
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
import {
  type AzRole,
  type AzSummary,
  type InterAzLinkCheck,
  type SiteLayoutId,
  type SiteState,
  availabilityZones,
  az2CandidateRooms,
  checkHostsPerAz,
  checkInterAzLink,
  checkSecondaryInstanceLocation,
  checkWitnessFaultDomain,
  layoutsSupporting,
  minStretchedHosts,
  STRETCHED_INTER_AZ_REQUIREMENTS,
  STRETCHED_VSAN_BLUEPRINT_MINIMUMS,
  WITNESS_LINK_REQUIREMENTS,
  sitesOf,
  unassignedRooms,
} from './sites';
import { type ClusterTopology, type RackUnlockAction, deriveClusterTopology, validateClusterModelAgainstTopology } from './rackAwareness';
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
  /** Site layout summary (sites.ts). */
  readonly sites: SitesContext;
  /** Rack topology of the hosts (rackAwareness.ts); set by hardwareContext(). */
  readonly rackTopology?: ClusterTopology;
}

export interface SitesContext {
  readonly layoutId: SiteLayoutId;
  readonly state: SiteState;
  readonly siteCount: number;
  readonly roomCount: number;
  /** AZ / fault-domain roles in use, with the hosts mounted in their rooms. */
  readonly azs: readonly AzSummary[];
  readonly interAz: InterAzLinkCheck;
}

export function sitesContext(state: PhysicalState, serverIds?: readonly string[]): SitesContext {
  const s = sitesOf(state);
  return { layoutId: s.layoutId, state: s, siteCount: s.sites.length, roomCount: s.rooms.length, azs: availabilityZones(state, serverIds), interAz: checkInterAzLink(s) };
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
    sites: sitesContext(state, serverIds),
    rackTopology: deriveClusterTopology(state, servers.map((s) => s.id), catalog),
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
  | { readonly kind: 'use-single-vendor'; readonly vendors: readonly string[] }
  /** Choose a site layout that allows the option (UI: „zvol lokalitu se dvěma místnostmi“). */
  | { readonly kind: 'choose-site-layout'; readonly layoutIds: readonly SiteLayoutId[] }
  /** Assign one of the rooms to an AZ / fault-domain role (UI: „přiřaď místnost do AZ2“). */
  | { readonly kind: 'assign-room-role'; readonly role: AzRole; readonly roomIds: readonly string[] }
  /** Buy / mount hosts into racks of the rooms of an AZ. */
  | { readonly kind: 'add-hosts-to-az'; readonly role: AzRole; readonly roomIds: readonly string[]; readonly count: number }
  /** Rack placement / fault domain actions (rackAwareness.ts). */
  | RackUnlockAction;

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

export interface SiteAvailability {
  /**
   * - 'not-site-dependent': the option has no site limits,
   * - 'ok': the layout and AZ assignment allow the option, 'blocked': at least one error reason.
   * Layout reasons block even before any hardware is bought; hosts-per-AZ reasons only once hosts exist.
   */
  readonly status: 'not-site-dependent' | 'ok' | 'blocked';
  readonly errors: readonly HwReason[];
  readonly warnings: readonly HwReason[];
  /** Documented requirements the option puts on the sites (shown also when satisfied). */
  readonly requirements: readonly ValidationIssue[];
}

export interface OptionAvailabilityWithHardware extends OptionAvailability {
  readonly hardware: HardwareAvailability;
  readonly site: SiteAvailability;
}

const NOT_SITE_DEPENDENT: SiteAvailability = { status: 'not-site-dependent', errors: [], warnings: [], requirements: [] };

/** Site limits of a design option (see header). */
export function siteAvailability(decision: DesignDecisionId, option: string, choices: DesignChoices, hw: HardwareContext): SiteAvailability {
  const next: DesignChoices = { ...choices, [decision]: option };
  const fleet = decision === 'fleet-deployment-model' ? option : undefined;
  const stretched =
    fleet === 'site-high-availability' || fleet === 'fault-domains-and-dr' || ((decision === 'mgmt-cluster-model' || decision === 'wld-cluster-model') && option === 'stretched');
  const secondary = fleet === 'disaster-recovery' || fleet === 'fault-domains-and-dr';
  if (!stretched && !secondary) return NOT_SITE_DEPENDENT;
  const sc = hw.sites;
  const s = sc.state;
  const errors: HwReason[] = [];
  const warnings: HwReason[] = [];
  const requirements: ValidationIssue[] = [];
  const free = unassignedRooms(s);
  const layoutUnlock = (cap: Parameters<typeof layoutsSupporting>[0]): UnlockAction | undefined => {
    const ids = layoutsSupporting(cap).filter((id) => id !== sc.layoutId);
    return ids.length ? { kind: 'choose-site-layout', layoutIds: ids } : undefined;
  };
  const stretchedCap = fleet === 'fault-domains-and-dr' ? 'fault-domains-and-dr' : 'stretched';

  if (stretched) {
    for (const i of checkInterAzLink(s).issues) {
      const cands = az2CandidateRooms(s);
      const unlock: UnlockAction | undefined = cands.length ? { kind: 'assign-room-role', role: 'az2', roomIds: cands } : layoutUnlock(stretchedCap);
      errors.push(unlock ? { issue: i, unlock } : { issue: i });
    }
    for (const i of checkWitnessFaultDomain(s)) {
      // a third room is needed (AZ1, AZ2, witness)
      const unlock: UnlockAction | undefined = free.length && roomsCount(s) >= 3 ? { kind: 'assign-room-role', role: 'witness', roomIds: free } : layoutUnlock(stretchedCap);
      const r = unlock ? { issue: i, unlock } : { issue: i };
      (i.severity === 'error' ? errors : warnings).push(r);
    }
    const wld = decision === 'wld-cluster-model';
    const min = minStretchedHosts(next['deployment-model'], next['principal-storage']);
    const R = STRETCHED_INTER_AZ_REQUIREMENTS;
    requirements.push(issue('SITE_INTER_AZ_RTT_TOO_HIGH', 'error', `Stretched: RTT between availability zones must be below ${R.maxRttMsExclusive} ms ("under 5ms RTT").`, R.specRef, 'inter-az-link'));
    requirements.push(issue('SITE_INTER_AZ_BANDWIDTH_TOO_LOW', 'error', `Stretched: at least ${R.minBandwidthGbps} Gbps between availability zones.`, R.specRef, 'inter-az-link'));
    requirements.push(issue('SITE_WITNESS_RTT_TOO_HIGH', 'error', `vSAN witness in a third site independent of both AZs; RTT from the data sites at most ${WITNESS_LINK_REQUIREMENTS.maxRttMs} ms.`, WITNESS_LINK_REQUIREMENTS.specRef, 'witness'));
    requirements.push(issue('SITE_AZ_HOST_COUNT_UNEQUAL', 'error', 'Both availability zones must have an equal number of ESX hosts (VCF-VSAN-SC-REQD-CFG-001).', '06 §5 [B11]', decision));
    const W = STRETCHED_VSAN_BLUEPRINT_MINIMUMS.workloadDomainCluster;
    requirements.push(
      wld
        ? issue('SITE_AZ_TOO_FEW_HOSTS', 'error', `Stretched workload domain cluster (vSAN): minimum of ${W.total} nodes, ${W.perAz} per site.`, STRETCHED_VSAN_BLUEPRINT_MINIMUMS.specRef, decision)
        : issue('SITE_AZ_TOO_FEW_HOSTS', 'error', `Stretched cluster: at least ${min.total} ESX hosts, ${min.perAz} per availability zone${min.assumed ? ' (lowest documented value, model / storage not decided)' : ''}; the management cluster is stretched on Day 2.`, min.specRef, decision),
    );
    // Hosts per AZ of the management cluster only once hardware exists (UX §3.1). The stretch of the management
    // cluster is Day 2 (06 §2.3 [B11]) -> warnings, not blocking the Day-0 design. WLD hosts are not modelled here.
    if (!wld && hw.hostCount > 0 && sc.azs.some((a) => a.role === 'az1') && sc.azs.some((a) => a.role === 'az2'))
      for (const i of checkHostsPerAz(sc.azs, min, 'warning')) {
        const role = i.subject === 'az2' ? 'az2' : 'az1';
        const az = sc.azs.find((a) => a.role === role);
        const other = sc.azs.find((a) => a.role !== role && (a.role === 'az1' || a.role === 'az2'));
        const have = az?.hostIds.length ?? 0;
        const target = Math.max(min.perAz, other?.hostIds.length ?? 0);
        warnings.push({ issue: i, unlock: { kind: 'add-hosts-to-az', role, roomIds: az?.roomIds ?? [], count: Math.max(1, target - have) } });
      }
  }
  if (secondary)
    for (const i of checkSecondaryInstanceLocation(s)) {
      const reserved = stretched ? 3 : 1; // rooms needed for AZ1 (+ AZ2 + witness)
      const unlock: UnlockAction | undefined = free.length && roomsCount(s) > reserved ? { kind: 'assign-room-role', role: 'secondary-instance', roomIds: free } : layoutUnlock(stretched ? 'fault-domains-and-dr' : 'secondary-instance');
      errors.push(unlock ? { issue: i, unlock } : { issue: i });
    }
  return { status: errors.length ? 'blocked' : 'ok', errors, warnings, requirements };
}

const roomsCount = (s: SiteState): number => s.rooms.length;

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

  // Rack topology vs. cluster model (rackAwareness.ts, 50 §7a bod 1, 8). Only once all hosts are mounted – before that
  // the physical location is unknown and the design is not limited by it. Stretched is covered by the site checks.
  const topo = hw.rackTopology;
  if (decision === 'mgmt-cluster-model' && option !== 'stretched' && topo && hw.hostCount > 0 && topo.unmountedHostIds.length === 0) {
    const storage = next['principal-storage'];
    const reasons = validateClusterModelAgainstTopology(option as ClusterModel, topo, { role: 'management-default', ...(storage !== undefined ? { storage } : {}) });
    if (reasons.length) hwDependent = true;
    for (const r of reasons) (r.issue.severity === 'error' ? errors : warnings).push(r.unlock ? { issue: r.issue, unlock: r.unlock } : { issue: r.issue });
  }
  if (decision === 'wld-cluster-model' && (option === 'multi-rack-l2' || option === 'multi-rack-l3'))
    requirements.push(issue('VSAN_MULTI_RACK_TOO_FEW_RACKS', 'error', 'Multi-Rack vSAN: "Use a minimum of three (3) racks for the cluster." (VCF-VSAN-L3MR-REQD-CFG-002); recommended "Use four (4) Fault domains for vSAN HCI multi-rack" (VCF-VSAN-L3MR-RCMD-CFG-001).', '50 §3.1, §6.1 [V1]', decision));

  // Initial management cluster: single vendor (20 §3.2 [S7]) – relevant for any HW-dependent option.
  if (hwDependent && hw.vendors.length > 1)
    errors.push({
      issue: issue('ESX_MULTIPLE_VENDORS', 'error', `All ESX hosts in the management domain must be from the same hardware vendor (found ${hw.vendors.join(', ')}).`, '20 §3.2 [S7]; 10 §3.4 [P28]', decision),
      unlock: { kind: 'use-single-vendor', vendors: hw.vendors },
    });

  const status: HardwareAvailability['status'] = !hwDependent ? 'not-hw-dependent' : hw.hostCount === 0 ? 'no-hardware-yet' : errors.length ? 'insufficient' : 'ok';
  const blocking = status === 'insufficient';
  const site = siteAvailability(decision, option, choices, hw);
  return {
    available: base.available && !blocking && site.status !== 'blocked',
    site,
    errors: base.errors,
    warnings: base.warnings,
    hardware: { status, errors: status === 'no-hardware-yet' ? [] : errors, warnings: status === 'no-hardware-yet' ? [] : warnings, requirements },
  };
}
