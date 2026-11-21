/**
 * Objectives tracker of the Sandbox (UX §8 "Tracker úkolů"; CLAUDE.md: checkpointy jsou volitelné, nic nezamykají).
 *
 * - Objectives are DATA (scenarios/objectives/sandbox.json, authored by scenario-designer).
 * - Completion is DERIVED from the snapshot by named selectors (registry below, pure functions) – never from
 *   one-off events – so undo, selling, loading a save or doing things out of order all work.
 * - VCF facts (e.g. the minimum host count for the chosen design) come from the model via the snapshot; the JSON
 *   never contains them as numbers.
 * - Player preferences (skipped ids, ids ever seen done, hidden) live in SandboxState.objectives.
 *
 * Pure TypeScript: no DOM, no PixiJS.
 */
import { type DistributedSwitchModelId, type DnsRecords, type HostPortTraffic, type SwitchPortConfig, hostPortRequirements, nicRequirementForVdsModel, plannedHostPortTraffic, validateDnsRecords } from '../../model';
import sandboxObjectivesJson from '../../scenarios/objectives/sandbox.json';
import type { SandboxSnapshotBase } from './snapshot';
import type { ObjectivesPrefs, SandboxPhase } from './types';

// ===========================================================================
// Definitions
// ===========================================================================

export const OBJECTIVES_SCHEMA_VERSION = 1;

/**
 * - `doc-required`: requirement of the documentation (why + spec ref mandatory),
 * - `doc-recommended`: documented recommendation (★),
 * - `game-step`: game step without a VCF fact (e.g. "Postav rack"),
 * - `game-optional`: optional step OUT OF VCF SCOPE (BMC, UX §15) – not counted in group progress.
 */
export type ObjectiveKind = 'doc-required' | 'doc-recommended' | 'game-step' | 'game-optional';
export const OBJECTIVE_KINDS: readonly ObjectiveKind[] = ['doc-required', 'doc-recommended', 'game-step', 'game-optional'];

export interface ObjectiveWhy {
  /** Spec reference, e.g. "10-planning §3.3 [P19]". */
  readonly specRef: string;
  /** Official documentation page (techdocs / knowledge / compatibilityguide / developer.broadcom.com). */
  readonly url: string;
  readonly paraphrase?: string;
  readonly ruleId?: string;
  readonly quote?: string;
}

export type ObjectiveParamValue = string | number | boolean;
export type ObjectiveParams = Readonly<Record<string, ObjectiveParamValue>>;

export interface ObjectiveDef {
  readonly id: string;
  readonly group: string;
  /** Imperative, Czech, ≤ 48 characters recommended (UX §8.6). */
  readonly title: string;
  readonly kind: ObjectiveKind;
  readonly why?: ObjectiveWhy;
  /** Selector name from SELECTORS. */
  readonly selector: string;
  readonly params?: ObjectiveParams;
  readonly subSteps?: readonly ObjectiveDef[];
  /** Recommended order (not a lock, UX §8.5). */
  readonly after?: readonly string[];
  /** UI hint for "Ukaž mi" (opaque for the engine). */
  readonly showMe?: Readonly<Record<string, string>>;
  readonly onActivateTip?: string;
  /** Content waiting for the spec – shown as 'blocked-spec', hidden in the player build. */
  readonly featureFlag?: string;
}

export interface ObjectiveGroupDef {
  readonly id: string;
  readonly title: string;
}

export interface ObjectiveSet {
  readonly version: number;
  readonly groups: readonly ObjectiveGroupDef[];
  readonly objectives: readonly ObjectiveDef[];
  /** Top-level and sub-step ids. */
  readonly byId: ReadonlyMap<string, ObjectiveDef>;
  /** Non-empty = the file was rejected (UX §8.8: "Úkoly nejsou k dispozici"), objectives are empty. */
  readonly loadErrors: readonly string[];
}

// ===========================================================================
// Selectors (pure functions over the snapshot)
// ===========================================================================

/** Snapshot data the selectors read (everything except the objectives view itself). */
export type ObjectiveInput = Omit<SandboxSnapshotBase, 'objectives'>;

export interface SelectorResult {
  readonly done: boolean;
  /** Counter for "n / N" (UX §8.3). */
  readonly current?: number;
  readonly target?: number;
}

/**
 * - `count`: positive integer | 'all' | 'design' (see targetOf),
 * - `nics`: positive integer | 'design' (= pNIC count of the chosen Distributed Switch model, model
 *   nicRequirementForVdsModel; 1 without a choice or for models without a documented count – VCF-NET-REQD-TOR-001),
 * - `flag`: boolean.
 */
type ParamKind = 'count' | 'phase' | 'decision' | 'nics' | 'flag';

export interface SelectorDef {
  readonly description: string;
  readonly params: Readonly<Record<string, ParamKind>>;
  readonly evaluate: (snap: ObjectiveInput, params: ObjectiveParams) => SelectorResult;
}

/**
 * `min` (count) param: a positive integer, 'all' (= every bought server, at least 1) or 'design' (= minimum hosts
 * of the management domain default cluster from the model for the current design, 10 §6.1; 1 when no design yet).
 */
function targetOf(snap: ObjectiveInput, min: ObjectiveParamValue | undefined, fallback = 1): number {
  if (min === 'all') return Math.max(1, snap.physical.servers.length);
  if (min === 'design') return snap.planning.hostCount.minimum ?? 1;
  return typeof min === 'number' && Number.isInteger(min) && min > 0 ? min : fallback;
}

const counter = (current: number, target: number): SelectorResult => ({ done: current >= target, current: Math.min(current, target), target });

function countServers(pred: (srv: ObjectiveInput['physical']['servers'][number]) => boolean) {
  return (snap: ObjectiveInput, params: ObjectiveParams): SelectorResult => counter(snap.physical.servers.filter(pred).length, targetOf(snap, params['min']));
}

const flag = (done: boolean): SelectorResult => ({ done });

const PHASE_ORDER: readonly SandboxPhase[] = ['design', 'planning', 'deploy'];

type ServerIn = ObjectiveInput['physical']['servers'][number];

/** Switch port configs the server's NICs are cabled to (host-facing ports, 10 §3.3). */
function hostFacingConfigs(snap: ObjectiveInput, srv: ServerIn): SwitchPortConfig[] {
  const out: SwitchPortConfig[] = [];
  for (const n of srv.nicPorts) {
    if (n.peer?.kind !== 'switch') continue;
    const { switchId, port } = n.peer;
    const cfg = snap.physical.switches.find((x) => x.id === switchId)?.ports[port]?.config;
    if (cfg) out.push(cfg);
  }
  return out;
}

/**
 * Traffic types KNOWN so far for a host (snapshot data only), built by the model (plannedHostPortTraffic):
 *  - ESX management: the host's DCUI VLAN (untagged = no VLAN to carry), else the wizard's ESX management VLAN;
 *  - vMotion, vSAN / NFS (not for VMFS on FC) and Host TEP: from the wizard plan (Network details, 20 §4.2 step 11)
 *    once entered.
 * Before the plan exists only management is known – the objective can be done early and regress (UX §8.3 "problém")
 * when the plan adds VLANs the switch does not carry yet.
 */
function trafficOf(snap: ObjectiveInput, srv: ServerIn): HostPortTraffic[] {
  const mgmt = srv.esx.network ? (srv.esx.network.vlanId ?? null) : undefined;
  return plannedHostPortTraffic(snap.physical.plan, snap.deploy.spec.storage.type, mgmt);
}

/** Host ports trunk (VCF-NET-RCMD-SWT-001) and carry every known traffic VLAN (model hostPortRequirements). */
function trunksTrafficVlans(snap: ObjectiveInput, srv: ServerIn): boolean {
  const ports = hostFacingConfigs(snap, srv);
  const traffic = trafficOf(snap, srv);
  return ports.length > 0 && ports.every((cfg) => cfg.mode === 'trunk' && hostPortRequirements(traffic, cfg).missingVlans.length === 0);
}

/** Port MTU ≥ the model's required (or, with `recommended`, recommended) MTU for the traffic it carries (10 §3.3 [P19]). */
function portsMtuOk(snap: ObjectiveInput, srv: ServerIn, recommended: boolean): boolean {
  const ports = hostFacingConfigs(snap, srv);
  const traffic = trafficOf(snap, srv);
  return (
    ports.length > 0 &&
    ports.every((cfg) => {
      const req = hostPortRequirements(traffic, cfg);
      return cfg.mtu >= (recommended ? req.recommendedMtu : req.requiredMtu);
    })
  );
}

/** pNIC uplinks a host needs: number, or 'design' = Distributed Switch model requirement (model), else 1. */
function nicsTarget(snap: ObjectiveInput, nics: ObjectiveParamValue | undefined): number {
  if (typeof nics === 'number' && Number.isInteger(nics) && nics > 0) return nics;
  const model = snap.design.choices['distributed-switch-model'] as DistributedSwitchModelId | undefined;
  return (model ? nicRequirementForVdsModel(model)?.minPorts : undefined) ?? 1;
}

const uplinkCount = (srv: ServerIn): number => srv.nicPorts.filter((n) => n.link?.up === true && n.peer?.kind === 'switch').length;

/** DNS server content rebuilt from the snapshot's DNS view (planning.dns). */
function dnsOf(snap: ObjectiveInput): DnsRecords {
  return {
    forward: Object.fromEntries(snap.planning.dns.a.map((r) => [r.fqdn, r.ip])),
    reverse: Object.fromEntries(snap.planning.dns.ptr.map((r) => [r.ip, r.fqdn])),
  };
}

/** Model codes of the initial management cluster homogeneity rules (10 §3.4 [P28], 20 §3.2 [S7]). */
const HOMOGENEITY_CODES: readonly string[] = ['ESX_MULTIPLE_VENDORS', 'HW_CLUSTER_HETEROGENEOUS'];

export const SELECTORS: Readonly<Record<string, SelectorDef>> = {
  hasRack: {
    description: 'Racks standing in the room (placed on a tile) ≥ min (default 1).',
    params: { min: 'count' },
    evaluate: (snap, p) => counter(snap.physical.racks.filter((r) => r.placed).length, targetOf(snap, p['min'])),
  },
  serversBought: {
    description: 'Servers bought (mounted or not) ≥ min.',
    params: { min: 'count' },
    evaluate: countServers(() => true),
  },
  certifiedServerBought: {
    description: 'Servers whose model BCG lists for "ESXi 9.1 (vSAN 9.1)" ≥ min (15 B.1).',
    params: { min: 'count' },
    evaluate: countServers((x) => x.certified91),
  },
  serversForDesign: {
    description: 'Servers bought vs. the model minimum of the management domain default cluster for the design (10 §6.1); without a design 1.',
    params: {},
    evaluate: (snap) => counter(snap.physical.servers.length, targetOf(snap, 'design')),
  },
  serversMounted: {
    description: 'Servers mounted in a rack ≥ min.',
    params: { min: 'count' },
    evaluate: countServers((x) => x.mount !== undefined),
  },
  switchesBought: {
    description: 'Switches bought ≥ min.',
    params: { min: 'count' },
    evaluate: (snap, p) => counter(snap.physical.switches.length, targetOf(snap, p['min'])),
  },
  switchesMounted: {
    description: 'Switches mounted in a rack ≥ min.',
    params: { min: 'count' },
    evaluate: (snap, p) => counter(snap.physical.switches.filter((x) => x.mount !== undefined).length, targetOf(snap, p['min'])),
  },
  companyNetworkConnected: {
    description: 'A switch uplink port is connected to the company network (game abstraction).',
    params: {},
    evaluate: (snap) => flag(snap.physical.companyNetwork !== undefined),
  },
  hostsCabledToSwitch: {
    description: 'Servers with at least one NIC cabled to a switch with link up ≥ min.',
    params: { min: 'count' },
    evaluate: countServers((x) => x.nicPorts.some((n) => n.link?.up === true && n.peer?.kind === 'switch')),
  },
  hostsOnTwoSwitches: {
    description: 'Servers with NIC links (up) to two or more different switches ≥ min.',
    params: { min: 'count' },
    evaluate: countServers((x) => new Set(x.nicPorts.filter((n) => n.link?.up === true && n.peer?.kind === 'switch').map((n) => (n.peer?.kind === 'switch' ? n.peer.switchId : ''))).size >= 2),
  },
  bmcCabled: {
    description: 'Servers with the BMC port cabled with link up ≥ min (out of VCF scope – game).',
    params: { min: 'count' },
    evaluate: countServers((x) => x.bmcPort.link?.up === true),
  },
  bmcConfigured: {
    description: 'Servers whose BMC is cabled, has an IP and is reachable from the admin workstation ≥ min (game).',
    params: { min: 'count' },
    evaluate: countServers((x) => x.bmc.reachableFromAdmin),
  },
  esxInstalled: {
    description: 'Servers with ESX installed ≥ min.',
    params: { min: 'count' },
    evaluate: countServers((x) => x.esx.esxVersion !== undefined),
  },
  mgmtNetworkConfigured: {
    description: 'Hosts with the DCUI management network configured (static IPv4, FQDN, DNS) ≥ min.',
    params: { min: 'count' },
    evaluate: countServers((x) => x.mgmt.configured && x.mgmt.staticIp),
  },
  mgmtNetworkUp: {
    description: 'Hosts with the management network configured whose vmk0 reaches the gateway over the cabling ≥ min.',
    params: { min: 'count' },
    evaluate: countServers((x) => x.mgmt.configured && x.mgmt.staticIp && x.mgmt.gatewayReachable === true),
  },
  mgmtNetworkTested: {
    description: 'Hosts whose last DCUI "Test Management Network" reached the gateway ≥ min.',
    params: { min: 'count' },
    evaluate: countServers((x) => x.mgmt.lastTest?.gateway === true),
  },
  mgmtTrafficFlowing: {
    description: 'At least one management-class traffic flow is visible.',
    params: {},
    evaluate: (snap) => flag(snap.flows.flows.some((f) => f.trafficClass === 'management')),
  },
  ntpConfigured: {
    description: 'Hosts with NTP enabled and running ≥ min.',
    params: { min: 'count' },
    evaluate: countServers((x) => x.esx.ntp.enabled && x.esx.ntp.serviceRunning && x.esx.ntp.servers.length > 0),
  },
  certificateRegenerated: {
    description: 'Hosts whose certificate CN equals their FQDN ≥ min.',
    params: { min: 'count' },
    evaluate: countServers((x) => x.esx.network !== undefined && x.esx.certificateCn === x.esx.network.hostnameFqdn),
  },
  hostDnsRecordsValid: {
    description: 'Hosts whose DCUI FQDN has a forward (A) record to the vmk0 IP and a matching reverse (PTR) record ≥ min (model validateDnsRecords; 10 §3.1, 20 §3.5).',
    params: { min: 'count' },
    evaluate: (snap, p) => {
      const dns = dnsOf(snap);
      return counter(
        snap.physical.servers.filter((x) => x.esx.network !== undefined && validateDnsRecords(dns, x.esx.network.hostnameFqdn, x.id, x.esx.network.ipv4Address).length === 0).length,
        targetOf(snap, p['min']),
      );
    },
  },
  switchPortsTrunkVlans: {
    description: 'Hosts whose every cabled switch port is an 802.1Q trunk carrying the VLANs of all known traffic types (management from DCUI; vMotion / vSAN / NFS / Host TEP from the wizard plan) ≥ min.',
    params: { min: 'count' },
    evaluate: (snap, p) => counter(snap.physical.servers.filter((x) => trunksTrafficVlans(snap, x)).length, targetOf(snap, p['min'])),
  },
  switchMtuForTraffic: {
    description: 'Hosts whose every cabled switch port has MTU ≥ the largest MTU of the traffic it carries, min. 1500, Host TEP min. 1700 (10 §3.3); `recommended`: ≥ 9000 ≥ min.',
    params: { min: 'count', recommended: 'flag' },
    evaluate: (snap, p) => counter(snap.physical.servers.filter((x) => portsMtuOk(snap, x, p['recommended'] === true)).length, targetOf(snap, p['min'])),
  },
  hostsWithUplinks: {
    description: 'Hosts with ≥ `nics` NIC uplinks cabled to a switch (link up) ≥ min; nics "design" = pNIC count of the chosen Distributed Switch model (model; 1 without a choice).',
    params: { min: 'count', nics: 'nics' },
    evaluate: (snap, p) => {
      const need = nicsTarget(snap, p['nics']);
      return counter(snap.physical.servers.filter((x) => uplinkCount(x) >= need).length, targetOf(snap, p['min']));
    },
  },
  serversHomogeneous: {
    description: 'At least one server and no homogeneity finding of the initial management cluster (one vendor, same configuration – model validateClusterHardware).',
    params: {},
    evaluate: (snap) => flag(snap.physical.servers.length > 0 && !snap.physical.clusterIssues.findings.some((f) => HOMOGENEITY_CODES.includes(f.code))),
  },
  useCaseChosen: {
    description: 'A use case / path (25 §2.1: UC-1 … UC-10) is chosen.',
    params: {},
    evaluate: (snap) => flag(snap.useCase !== undefined),
  },
  designDecided: {
    description: 'With `decision`: that design decision is chosen; without: the design gate passes (no errors, warnings acknowledged).',
    params: { decision: 'decision' },
    evaluate: (snap, p) => {
      const d = p['decision'];
      if (typeof d === 'string') return flag(snap.design.choices[d as keyof typeof snap.design.choices] !== undefined);
      const total = snap.design.decisions.length;
      return { done: snap.design.gate.ok, current: snap.design.decisions.filter((x) => x.selected !== undefined).length, target: total };
    },
  },
  phaseReached: {
    description: 'The Sandbox phase `phase` (design | planning | deploy) was reached.',
    params: { phase: 'phase' },
    evaluate: (snap, p) => {
      const want = PHASE_ORDER.indexOf(p['phase'] as SandboxPhase);
      const furthest = Math.max(...snap.phases.map((x, i) => (x.visited ? i : -1)));
      return flag(want >= 0 && furthest >= want);
    },
  },
  installerDeployed: {
    description: 'The VCF Installer appliance is deployed.',
    params: {},
    evaluate: (snap) => flag(snap.planning.installer.state.mode !== 'not-deployed'),
  },
  binariesDownloaded: {
    description: 'All binaries needed for the deployment are downloaded and validated.',
    params: {},
    evaluate: (snap) => counter(snap.planning.depot.downloadedCount, snap.planning.depot.total),
  },
  validationPassed: {
    description: 'Review validation finished without errors (warnings acknowledged or none).',
    params: {},
    evaluate: (snap) => flag(['ready-to-deploy', 'deploying', 'completed'].includes(snap.deploy.deployment.status)),
  },
  deploymentCompleted: {
    description: 'The bring-up finished and the VCF fleet exists.',
    params: {},
    evaluate: (snap) => flag(snap.fleet !== undefined),
  },
};

// ===========================================================================
// Loader
// ===========================================================================

const ALLOWED_DOC_HOSTS = ['techdocs.broadcom.com', 'knowledge.broadcom.com', 'compatibilityguide.broadcom.com', 'developer.broadcom.com'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function checkUrl(url: string): boolean {
  const m = /^https:\/\/([^/?#:]+)(?:[/?#]|$)/.exec(url);
  return m?.[1] !== undefined && ALLOWED_DOC_HOSTS.includes(m[1].toLowerCase());
}

function checkParams(errs: string[], where: string, selector: string, params: unknown): void {
  if (params === undefined) return;
  const def = SELECTORS[selector];
  if (!isObj(params)) {
    errs.push(`${where}: params must be an object`);
    return;
  }
  for (const [k, v] of Object.entries(params)) {
    const kind = def?.params[k];
    if (!kind) {
      errs.push(`${where}: selector ${selector} has no param "${k}"`);
      continue;
    }
    if (kind === 'count' && !(v === 'all' || v === 'design' || (typeof v === 'number' && Number.isInteger(v) && v > 0)))
      errs.push(`${where}: param ${k} must be a positive integer, "all" or "design"`);
    if (kind === 'phase' && !PHASE_ORDER.includes(v as SandboxPhase)) errs.push(`${where}: param ${k} must be one of ${PHASE_ORDER.join(', ')}`);
    if (kind === 'decision' && !isStr(v)) errs.push(`${where}: param ${k} must be a design decision id`);
    if (kind === 'nics' && !(v === 'design' || (typeof v === 'number' && Number.isInteger(v) && v > 0))) errs.push(`${where}: param ${k} must be a positive integer or "design"`);
    if (kind === 'flag' && typeof v !== 'boolean') errs.push(`${where}: param ${k} must be true or false`);
  }
}

function parseObjective(errs: string[], raw: unknown, where: string, groupIds: ReadonlySet<string>, inheritedGroup?: string): ObjectiveDef | undefined {
  if (!isObj(raw)) {
    errs.push(`${where}: objective must be an object`);
    return undefined;
  }
  const id = raw['id'];
  const at = isStr(id) ? `${where} (${id})` : where;
  if (!isStr(id)) errs.push(`${where}: missing id`);
  const group = inheritedGroup ?? raw['group'];
  if (!isStr(group) || !groupIds.has(group)) errs.push(`${at}: unknown group ${String(group)}`);
  if (!isStr(raw['title'])) errs.push(`${at}: missing title`);
  else if ((raw['title'] as string).length > 64) errs.push(`${at}: title longer than 64 characters`);
  const kind = raw['kind'];
  if (!OBJECTIVE_KINDS.includes(kind as ObjectiveKind)) errs.push(`${at}: kind must be one of ${OBJECTIVE_KINDS.join(', ')}`);
  const selector = raw['selector'];
  if (!isStr(selector) || !SELECTORS[selector]) errs.push(`${at}: unknown selector ${String(selector)}`);
  else checkParams(errs, at, selector, raw['params']);
  const why = raw['why'];
  if (why !== undefined || kind === 'doc-required' || kind === 'doc-recommended' || kind === 'game-optional') {
    if (!isObj(why) || !isStr(why['specRef']) || !isStr(why['url'])) errs.push(`${at}: why {specRef, url} is required for kind ${String(kind)}`);
    else if (!checkUrl(why['url'] as string)) errs.push(`${at}: why.url must be an https link to ${ALLOWED_DOC_HOSTS.join(' / ')}`);
  }
  for (const k of ['after'] as const) {
    const v = raw[k];
    if (v !== undefined && !(Array.isArray(v) && v.every(isStr))) errs.push(`${at}: ${k} must be a list of objective ids`);
  }
  const subs: ObjectiveDef[] = [];
  if (raw['subSteps'] !== undefined) {
    if (!Array.isArray(raw['subSteps'])) errs.push(`${at}: subSteps must be a list`);
    else
      raw['subSteps'].forEach((sub, i) => {
        if (isObj(sub) && sub['subSteps'] !== undefined) errs.push(`${at}: sub-steps have one level only (UX §8.4)`);
        const d = parseObjective(errs, sub, `${at}.subSteps[${i}]`, groupIds, typeof group === 'string' ? group : undefined);
        if (d) subs.push(d);
      });
  }
  if (!isStr(id) || !isStr(group) || !isStr(raw['title']) || !isStr(selector)) return undefined;
  return { ...(raw as unknown as ObjectiveDef), group, ...(subs.length ? { subSteps: subs } : {}) };
}

/** Validates and loads an objectives file. Invalid file -> empty set with `loadErrors` (UX §8.8). */
export function loadObjectiveSet(raw: unknown): ObjectiveSet {
  const errs: string[] = [];
  const empty = (e: string[]): ObjectiveSet => ({ version: OBJECTIVES_SCHEMA_VERSION, groups: [], objectives: [], byId: new Map(), loadErrors: e });
  if (!isObj(raw)) return empty(['objectives file must be an object']);
  if (raw['version'] !== OBJECTIVES_SCHEMA_VERSION) errs.push(`version must be ${OBJECTIVES_SCHEMA_VERSION}`);
  const groupsRaw = raw['groups'];
  const groups: ObjectiveGroupDef[] = [];
  if (!Array.isArray(groupsRaw) || groupsRaw.length === 0) errs.push('groups must be a non-empty list');
  else
    for (const g of groupsRaw) {
      if (!isObj(g) || !isStr(g['id']) || !isStr(g['title'])) errs.push('group needs id and title');
      else if (groups.some((x) => x.id === g['id'])) errs.push(`duplicate group ${String(g['id'])}`);
      else groups.push({ id: g['id'] as string, title: g['title'] as string });
    }
  const groupIds = new Set(groups.map((g) => g.id));
  const objRaw = raw['objectives'];
  const objectives: ObjectiveDef[] = [];
  if (!Array.isArray(objRaw)) errs.push('objectives must be a list');
  else objRaw.forEach((o, i) => {
    const d = parseObjective(errs, o, `objectives[${i}]`, groupIds);
    if (d) objectives.push(d);
  });
  const byId = new Map<string, ObjectiveDef>();
  for (const o of objectives)
    for (const d of [o, ...(o.subSteps ?? [])]) {
      if (byId.has(d.id)) errs.push(`duplicate objective id ${d.id}`);
      byId.set(d.id, d);
    }
  for (const d of byId.values()) for (const a of d.after ?? []) if (!byId.has(a)) errs.push(`${d.id}: after refers to unknown objective ${a}`);
  if (errs.length) return empty(errs);
  return { version: OBJECTIVES_SCHEMA_VERSION, groups, objectives, byId, loadErrors: [] };
}

let defaultSet: ObjectiveSet | undefined;
/** Objectives of the Sandbox (scenarios/objectives/sandbox.json). */
export function defaultObjectiveSet(): ObjectiveSet {
  defaultSet ??= loadObjectiveSet(sandboxObjectivesJson);
  return defaultSet;
}

// ===========================================================================
// Evaluation
// ===========================================================================

/**
 * - pending: not started, `in-progress`: counter > 0, `done`: selector satisfied,
 * - `regressed`: a doc-required objective seen done earlier is no longer satisfied (UX §8.3 "problém"),
 * - `skipped`: skipped by the player and not satisfied (turns into `done` once the state satisfies it),
 * - `blocked-spec`: content waits for the spec (`featureFlag`).
 */
export type ObjectiveState = 'pending' | 'in-progress' | 'done' | 'regressed' | 'skipped' | 'blocked-spec';

export interface ObjectiveView {
  readonly id: string;
  readonly group: string;
  readonly title: string;
  readonly kind: ObjectiveKind;
  readonly state: ObjectiveState;
  readonly progress?: { readonly current: number; readonly target: number };
  readonly why?: ObjectiveWhy;
  /** Counted in the group's n / N (false for game-optional and blocked-spec). */
  readonly counted: boolean;
  readonly subSteps?: readonly ObjectiveView[];
  readonly after?: readonly string[];
  readonly showMe?: Readonly<Record<string, string>>;
  readonly onActivateTip?: string;
  readonly featureFlag?: string;
}

export interface ObjectiveGroupView {
  readonly id: string;
  readonly title: string;
  readonly state: 'done' | 'current' | 'future';
  readonly done: number;
  readonly total: number;
  readonly objectives: readonly ObjectiveView[];
}

export interface ObjectivesView {
  readonly hidden: boolean;
  /** False when the objectives file was rejected (UX §8.8). */
  readonly available: boolean;
  readonly loadErrors: readonly string[];
  readonly groups: readonly ObjectiveGroupView[];
  /** "Další krok" (UX §8.5). */
  readonly next?: { readonly id: string; readonly title: string; readonly group: string };
  /** Done objectives in groups after the next step's group ("+2 hotovo napřed"). */
  readonly aheadCount: number;
  readonly allDone: boolean;
  /** Ids (incl. sub-steps) currently satisfied. */
  readonly doneIds: readonly string[];
  /** Ids (incl. sub-steps) currently regressed. */
  readonly regressedIds: readonly string[];
}

function evalOne(snap: ObjectiveInput, def: ObjectiveDef, prefs: ObjectivesPrefs): ObjectiveView {
  const sel = SELECTORS[def.selector];
  const r: SelectorResult = sel ? sel.evaluate(snap, def.params ?? {}) : { done: false };
  const subSteps = def.subSteps?.map((d) => evalOne(snap, d, prefs));
  const counted = def.kind !== 'game-optional' && def.featureFlag === undefined;
  let state: ObjectiveState;
  if (def.featureFlag !== undefined) state = 'blocked-spec';
  else if (r.done) state = 'done';
  else if (def.kind === 'doc-required' && prefs.everDone.includes(def.id)) state = 'regressed';
  else if (prefs.skipped.includes(def.id)) state = 'skipped';
  else if ((r.current ?? 0) > 0 || subSteps?.some((x) => x.state === 'done')) state = 'in-progress';
  else state = 'pending';
  return {
    id: def.id,
    group: def.group,
    title: def.title,
    kind: def.kind,
    state,
    ...(r.target !== undefined ? { progress: { current: r.current ?? 0, target: r.target } } : {}),
    ...(def.why ? { why: def.why } : {}),
    counted,
    ...(subSteps ? { subSteps } : {}),
    ...(def.after ? { after: def.after } : {}),
    ...(def.showMe ? { showMe: def.showMe } : {}),
    ...(def.onActivateTip !== undefined ? { onActivateTip: def.onActivateTip } : {}),
    ...(def.featureFlag !== undefined ? { featureFlag: def.featureFlag } : {}),
  };
}

const finished = (v: ObjectiveView): boolean => v.state === 'done' || v.state === 'skipped';

/** Pure evaluation of the tracker over the snapshot (UX §8.5 – §8.6). */
export function evaluateObjectives(snap: ObjectiveInput, set: ObjectiveSet, prefs: ObjectivesPrefs): ObjectivesView {
  const all = set.objectives.map((d) => evalOne(snap, d, prefs));
  const flat = all.flatMap((v) => [v, ...(v.subSteps ?? [])]);
  const byId = new Map(flat.map((v) => [v.id, v]));
  const candidates = all.filter((v) => v.counted && !finished(v));
  const ordered = set.groups.flatMap((g) => candidates.filter((v) => v.group === g.id));
  const afterOk = (v: ObjectiveView): boolean => (v.after ?? []).every((a) => {
    const x = byId.get(a);
    return x === undefined || finished(x);
  });
  const nextView = (() => {
    const firstGroup = ordered[0]?.group;
    const inGroup = ordered.filter((v) => v.group === firstGroup);
    return inGroup.find(afterOk) ?? inGroup[0];
  })();
  const nextGroupIdx = nextView ? set.groups.findIndex((g) => g.id === nextView.group) : set.groups.length;
  const groups = set.groups.map((g, i): ObjectiveGroupView => {
    const objectives = all.filter((v) => v.group === g.id);
    const counted = objectives.filter((v) => v.counted);
    const done = counted.filter((v) => v.state === 'done').length;
    const complete = counted.every(finished);
    return { id: g.id, title: g.title, state: complete && i !== nextGroupIdx ? 'done' : i === nextGroupIdx ? 'current' : 'future', done, total: counted.length, objectives };
  });
  const aheadCount = all.filter((v) => v.counted && v.state === 'done' && set.groups.findIndex((g) => g.id === v.group) > nextGroupIdx).length;
  return {
    hidden: prefs.hidden,
    available: set.loadErrors.length === 0,
    loadErrors: set.loadErrors,
    groups,
    ...(nextView ? { next: { id: nextView.id, title: nextView.title, group: nextView.group } } : {}),
    aheadCount,
    allDone: set.objectives.length > 0 && candidates.length === 0,
    doneIds: flat.filter((v) => v.state === 'done').map((v) => v.id),
    regressedIds: flat.filter((v) => v.state === 'regressed').map((v) => v.id),
  };
}
