/**
 * Hotové scénáře – read-only views of a fully deployed preset: inventory, VM placement, totals, cluster
 * utilisation, capacity issues and traffic flows. Every number comes from the model (model/deployedInventory.ts =
 * spec 40 §6.3–§6.5, 10 §6.5); this file only maps model results to the snapshot shape and labels what is derived,
 * undocumented or a game choice.
 *
 * Flows: the model's flow engine (computeTrafficFlows) knows documented host-level flows (vCenter <-> managed hosts
 * 20 §7 #19/#20, vSAN between hosts of a cluster 10 §7 #3, NTP, Host Client) and VM endpoints attached to a host
 * (`host-vm`). There are no documented VM <-> VM flows in the model, so the scenario shows host-level management
 * traffic plus each vCenter VM as an endpoint on the host it is placed on. Host networking after deployment
 * ("the installer migrates the hosts to a VDS", 25 §7 [U18]) is applied to a DERIVED copy of the room with the
 * model's applyBringupHostNetworking (per-cluster game VLANs) – the session state is not changed.
 */
import {
  type ClusterUtilisation,
  type DesignChoices,
  type Domain,
  type DocumentedTotals,
  type Fleet,
  type FleetInventory,
  type FleetTotals,
  type HardwareCatalog,
  type HostCapacity,
  type InventoryVm,
  type PhysicalState,
  type PlacementResult,
  type PresetBuild,
  type ResourceTotals,
  type Resources,
  type ScenarioPreset,
  type ServiceEndpoint,
  type SizingProfile,
  type TrafficFlow,
  type Utilisation,
  type ValidationIssue,
  type VmComponent,
  DESIGN_BLUEPRINTS,
  VM_COMPONENT_LABEL,
  aggregateTraffic,
  applyBringupHostNetworking,
  clusterUtilisation,
  computeTrafficFlows,
  hostCapacityFromConfig,
  validateManagementCapacity,
} from '../../model';
import { type FlowsView, type SandboxState, FLOWS_ILLUSTRATIVE_NOTE, derivedEndpoints, flowPairs, trafficV3View } from '../sandbox';
import { type ScenarioRack, SCENARIO_GAME_NETWORK, starterServer } from './build';

// ===========================================================================
// Labels
// ===========================================================================

export const PROFILE_LABEL: Readonly<Record<SizingProfile, string>> = {
  simple: 'Simple',
  'ha-small': 'HA Small',
  'ha-medium': 'HA Medium',
  'ha-large': 'HA Large',
};

// ===========================================================================
// Meta
// ===========================================================================

export interface ScenarioNote {
  readonly text: string;
  /** 'game' = game choice (not documentation); 'spec' = note from the spec (40 §6.5, §8). */
  readonly kind: 'game' | 'spec';
}

export interface ScenarioWldMeta {
  readonly domainId: string;
  readonly name: string;
  readonly instanceId: string;
  readonly vcenterSize: string;
  readonly nsx: { readonly kind: 'dedicated' | 'shared-with-management' | 'shared-with-workload-domain'; readonly label: string; readonly model?: string; readonly applianceSize?: string; readonly sharedWithDomainId?: string };
  readonly supervisor: { readonly nodes: number; readonly size: string } | null;
  readonly connectivity: { readonly kind: 'none' | 'edge' | 'vna'; readonly label: string; readonly nodes?: number; readonly size?: string };
  readonly hosts: number;
  readonly starterConfigId: string;
}

export interface ScenarioInstanceMeta {
  readonly instanceId: string;
  readonly name: string;
  readonly first: boolean;
  readonly profile: SizingProfile;
  readonly profileLabel: string;
  readonly location: 'site' | 'region2';
  readonly roomId: string;
  readonly managementDomainId: string;
  readonly managementHosts: number;
  readonly starterConfigId: string;
  readonly workloadDomains: readonly ScenarioWldMeta[];
}

export interface ScenarioMeta {
  readonly id: string;
  /** Position in the menu (1-based). */
  readonly order: number;
  /** Scenario group of 40 §6.5 / CLAUDE.md (1 nejmenší … 5 více instancí). */
  readonly scenario: number;
  readonly title: string;
  readonly summary: string;
  readonly specRef: string;
  readonly blueprint: { readonly id: string; readonly title: string; readonly url: string; readonly specRef: string } | null;
  readonly layoutId: string;
  /** Profile of the first instance (all presets use one profile per instance). */
  readonly profile: SizingProfile;
  readonly profileLabel: string;
  readonly instances: readonly ScenarioInstanceMeta[];
  readonly instanceCount: number;
  readonly workloadDomainCount: number;
  readonly hostCount: number;
  /** Design choices in effect (blueprint documented choices + profile). */
  readonly designChoices: DesignChoices;
  readonly notes: readonly ScenarioNote[];
  readonly version: string;
}

const nsxLabel = (w: ScenarioPreset['instances'][number]['workloadDomains'][number]): ScenarioWldMeta['nsx'] => {
  switch (w.nsx.kind) {
    case 'dedicated':
      return { kind: 'dedicated', label: `Dedikovaný NSX Manager (${w.nsx.model === 'simple' ? 'Simple, 1 uzel' : 'High Availability, 3 uzly'}, ${w.nsx.applianceSize})`, model: w.nsx.model, applianceSize: w.nsx.applianceSize };
    case 'shared-with-management':
      return { kind: 'shared-with-management', label: 'Sdílí NSX Manager management domény' };
    case 'shared-with-workload-domain':
      return { kind: 'shared-with-workload-domain', label: `Sdílí NSX Manager workload domény ${w.nsx.domainKey}`, sharedWithDomainId: w.nsx.domainKey };
  }
};

const connLabel = (c: ScenarioPreset['instances'][number]['workloadDomains'][number]['connectivity']): ScenarioWldMeta['connectivity'] =>
  c.kind === 'none'
    ? { kind: 'none', label: 'Bez NSX Edge / VNA' }
    : c.kind === 'edge'
      ? { kind: 'edge', label: `Centralized Connectivity – NSX Edge cluster ${c.nodes}× ${c.size}`, nodes: c.nodes, size: c.size }
      : { kind: 'vna', label: `Distributed Connectivity – Virtual Network Appliance ${c.nodes}× ${c.size}`, nodes: c.nodes, size: c.size };

/** Czech one-line summary for the menu. */
export function presetSummary(p: ScenarioPreset): string {
  const wlds = p.instances.reduce((a, i) => a + i.workloadDomains.length, 0);
  const hosts = p.instances.reduce((a, i) => a + i.managementHosts.count + i.workloadDomains.reduce((b, w) => b + w.hosts.count, 0), 0);
  const profiles = [...new Set(p.instances.map((i) => PROFILE_LABEL[i.profile]))].join(' / ');
  const inst = p.instances.length === 1 ? '1 VCF instance' : `${p.instances.length} VCF instance`;
  const wld = wlds === 0 ? 'jen management doména' : wlds === 1 ? '1 workload doména' : `${wlds} workload domény`;
  const hostWord = hosts === 1 ? 'ESX host' : hosts >= 2 && hosts <= 4 ? 'ESX hosty' : 'ESX hostů';
  return `Profil ${profiles} · ${inst} · ${wld} · ${hosts} ${hostWord}`;
}

export const GAME_ROOM_NOTES: readonly string[] = [
  'Rozmístění racků (1 rack na cluster), kabeláž (2 porty NIC na host do ToR), propojení ToR switchů, VLAN, IP adresy a MTU 9000 na ToR jsou herní volby, ne dokumentace.',
  'Rozmístění VM na hosty je herní rozdělení – v reálu rozhoduje vSphere DRS (40 §6.5, placeVms).',
  'Objemy provozu jsou ilustrativní (herní hodnoty); toky a protokoly jsou ze specu (Síťový provoz).',
];

const isGameNote = (t: string): boolean => /\bgame\b/i.test(t);

export function scenarioMeta(
  preset: ScenarioPreset,
  order: number,
  build: PresetBuild,
  rooms: Readonly<Record<string, string>>,
  layoutId: string,
  designChoices: DesignChoices,
  extraGameNotes: readonly string[] = [],
): ScenarioMeta {
  const bp = preset.blueprintId ? DESIGN_BLUEPRINTS[preset.blueprintId] : undefined;
  const instances: ScenarioInstanceMeta[] = preset.instances.map((pi) => {
    const inst = build.fleet.instances.find((i) => i.id === pi.key);
    return {
      instanceId: pi.key,
      name: pi.name,
      first: pi.first,
      profile: pi.profile,
      profileLabel: PROFILE_LABEL[pi.profile],
      location: pi.location,
      roomId: rooms[pi.key] ?? '',
      managementDomainId: inst?.managementDomain.id ?? '',
      managementHosts: pi.managementHosts.count,
      starterConfigId: pi.managementHosts.starterConfigId,
      workloadDomains: pi.workloadDomains.map((w) => ({
        domainId: `${pi.key}-${w.key}`,
        name: w.name,
        instanceId: pi.key,
        vcenterSize: w.vcenterSize,
        nsx: (() => {
          const n = nsxLabel(w);
          return n.sharedWithDomainId ? { ...n, sharedWithDomainId: `${pi.key}-${n.sharedWithDomainId}` } : n;
        })(),
        supervisor: w.supervisor,
        connectivity: connLabel(w.connectivity),
        hosts: w.hosts.count,
        starterConfigId: w.hosts.starterConfigId,
      })),
    };
  });
  const first = preset.instances.find((i) => i.first) ?? preset.instances[0];
  return {
    id: preset.id,
    order,
    scenario: preset.scenario,
    title: preset.title,
    summary: presetSummary(preset),
    specRef: preset.specRef,
    blueprint: bp ? { id: bp.id, title: bp.title, url: bp.url, specRef: bp.specRef } : null,
    layoutId,
    profile: first?.profile ?? 'simple',
    profileLabel: PROFILE_LABEL[first?.profile ?? 'simple'],
    instances,
    instanceCount: instances.length,
    workloadDomainCount: instances.reduce((a, i) => a + i.workloadDomains.length, 0),
    hostCount: Object.keys(build.hostConfigs).length,
    designChoices,
    notes: [
      ...preset.notes.map((text): ScenarioNote => ({ text, kind: isGameNote(text) ? 'game' : 'spec' })),
      ...(preset.blueprintId ? [] : [{ text: 'Scénář nemá Design Blueprint (40 §6.5 scénář 2); herní rozvržení = výchozí malá serverovna.', kind: 'game' as const }]),
      ...[...GAME_ROOM_NOTES, ...extraGameNotes].map((text): ScenarioNote => ({ text, kind: 'game' })),
    ],
    version: build.fleet.instances[0]?.version ?? '',
  };
}

// ===========================================================================
// Inventory + placement
// ===========================================================================

export interface ScenarioVmView extends InventoryVm {
  readonly label: string;
  /** Host (Fleet id) the VM runs on – game placement. */
  readonly hostId?: string;
  /** Physical server of that host (Sandbox room id). */
  readonly serverId?: string;
}

export interface ScenarioInventoryView {
  readonly vms: readonly ScenarioVmView[];
  readonly profiles: FleetInventory['profiles'];
  readonly componentLabels: Readonly<Record<VmComponent, string>>;
  readonly issues: readonly ValidationIssue[];
}

export interface HostLoadView {
  readonly hostId: string;
  readonly fqdn: string;
  readonly serverId: string;
  readonly rackId: string;
  readonly roomId: string;
  readonly clusterId: string;
  readonly domainId: string;
  readonly instanceId: string;
  readonly vmIds: readonly string[];
  readonly load: Resources;
  readonly capacity?: HostCapacity;
  /** Derived: vCPU per physical core, RAM %, disk % of raw capacity of this host. */
  readonly vcpuPerCore?: number;
  readonly ramPct?: number;
  readonly diskPctOfRaw?: number;
}

export interface ScenarioPlacementView {
  readonly vms: readonly { readonly vmId: string; readonly hostId: string; readonly serverId: string; readonly clusterId: string }[];
  readonly hosts: readonly HostLoadView[];
  readonly issues: readonly ValidationIssue[];
  /** Not documented VCF behaviour (DRS decides at runtime). */
  readonly scope: 'game-scope';
}

const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 1000) / 10 : Infinity);
const ratio = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 100) / 100 : Infinity);

export interface HostIndexEntry {
  readonly hostId: string;
  readonly fqdn: string;
  readonly clusterId: string;
  readonly domainId: string;
  readonly instanceId: string;
}

export function hostIndex(fleet: Fleet): HostIndexEntry[] {
  const out: HostIndexEntry[] = [];
  for (const i of fleet.instances)
    for (const d of [i.managementDomain, ...i.workloadDomains])
      for (const c of d.clusters) for (const h of c.hosts) out.push({ hostId: h.id, fqdn: h.fqdn, clusterId: c.id, domainId: d.id, instanceId: i.id });
  return out;
}

export function hostCapacities(catalog: HardwareCatalog, build: PresetBuild): Map<string, HostCapacity> {
  const out = new Map<string, HostCapacity>();
  for (const [hostId, starterId] of Object.entries(build.hostConfigs)) {
    const cap = hostCapacityFromConfig(catalog, hostId, starterServer(catalog, starterId).config);
    if (cap) out.set(hostId, cap);
  }
  return out;
}

export function inventoryView(inv: FleetInventory, placement: PlacementResult, hostServers: Readonly<Record<string, string>>): ScenarioInventoryView {
  const where = new Map(placement.placements.map((p) => [p.vmId, p.hostId]));
  return {
    vms: inv.vms.map((v) => {
      const hostId = where.get(v.id);
      const serverId = hostId ? hostServers[hostId] : undefined;
      return { ...v, label: VM_COMPONENT_LABEL[v.component], ...(hostId ? { hostId } : {}), ...(serverId ? { serverId } : {}) };
    }),
    profiles: inv.profiles,
    componentLabels: VM_COMPONENT_LABEL,
    issues: inv.issues,
  };
}

export function placementView(
  fleet: Fleet,
  placement: PlacementResult,
  hostServers: Readonly<Record<string, string>>,
  racks: readonly ScenarioRack[],
  caps: ReadonlyMap<string, HostCapacity>,
): ScenarioPlacementView {
  const idx = new Map(hostIndex(fleet).map((h) => [h.hostId, h]));
  const rackOf = new Map(racks.map((r) => [r.clusterId, r]));
  return {
    vms: placement.placements.map((p) => ({ vmId: p.vmId, hostId: p.hostId, serverId: hostServers[p.hostId] ?? '', clusterId: p.clusterId })),
    hosts: placement.hosts.map((h): HostLoadView => {
      const e = idx.get(h.hostId);
      const r = rackOf.get(h.clusterId);
      const cap = caps.get(h.hostId);
      return {
        hostId: h.hostId,
        fqdn: e?.fqdn ?? '',
        serverId: hostServers[h.hostId] ?? '',
        rackId: r?.rackId ?? '',
        roomId: r?.roomId ?? '',
        clusterId: h.clusterId,
        domainId: e?.domainId ?? '',
        instanceId: e?.instanceId ?? '',
        vmIds: h.vmIds,
        load: h.load,
        ...(cap
          ? { capacity: cap, vcpuPerCore: ratio(h.load.vcpu, cap.cores), ramPct: pct(h.load.ramGB, cap.ramGB), diskPctOfRaw: pct(h.load.diskGB, cap.rawCapacityTB * 1000) }
          : {}),
      };
    }),
    issues: placement.issues,
    scope: 'game-scope',
  };
}

// ===========================================================================
// Totals
// ===========================================================================

export type TotalsScope = 'management-domain' | 'workload-domain' | 'instance' | 'fleet';

export interface TotalsRow {
  readonly scope: TotalsScope;
  /** Domain id / instance id / fleet id. */
  readonly id: string;
  readonly label: string;
  readonly instanceId?: string;
  readonly vmCount: number;
  /** VMs with undocumented size (License server, 40 §8 q1) – counted, not summed. */
  readonly undocumentedVms: number;
  /** Documented total [W6] – only for a management domain with the full documented component set. */
  readonly documented?: DocumentedTotals;
  /** Sum of per-VM sizes (derived). */
  readonly perVm: Resources;
  /** documented − perVm of the management base (derived; contains the undocumented License server + disk gap). */
  readonly gap?: Resources;
  /** Planning total: documented base + per-VM increments (derived). */
  readonly planning: Resources;
  readonly flags: {
    readonly perVmDerived: true;
    readonly planningDerived: true;
    readonly gapDerived: boolean;
    readonly hasUndocumented: boolean;
  };
}

export interface ScenarioTotalsView {
  /** Model result (totalsForFleet), unchanged. */
  readonly model: FleetTotals;
  readonly rows: readonly TotalsRow[];
  /** Expected numbers of the spec tables (40 §6.5) for cross-checks in the UI. */
  readonly expected: ScenarioPreset['expected'];
  readonly expectedFleetPlanning?: Resources;
}

const flags = (t: ResourceTotals, gap: boolean): TotalsRow['flags'] => ({ perVmDerived: true, planningDerived: true, gapDerived: gap, hasUndocumented: t.undocumentedVms > 0 });

export function totalsView(fleet: Fleet, totals: FleetTotals, preset: ScenarioPreset): ScenarioTotalsView {
  const domName = new Map<string, string>();
  const instName = new Map<string, string>();
  for (const i of fleet.instances) {
    instName.set(i.id, i.name);
    for (const d of [i.managementDomain, ...i.workloadDomains]) domName.set(d.id, d.name);
  }
  const rows: TotalsRow[] = [];
  for (const m of totals.managementDomains) {
    rows.push({
      scope: 'management-domain',
      id: m.domainId,
      label: `Management doména ${domName.get(m.domainId) ?? m.domainId}`,
      instanceId: m.instanceId,
      vmCount: m.all.vmCount,
      undocumentedVms: m.all.undocumentedVms,
      ...(m.documented ? { documented: m.documented } : {}),
      perVm: m.all.perVm,
      ...(m.documentedMinusPerVm ? { gap: m.documentedMinusPerVm } : {}),
      planning: m.planning,
      flags: flags(m.all, m.documentedMinusPerVm !== undefined),
    });
  }
  for (const w of totals.workloadDomains) {
    const all: ResourceTotals = {
      vmCount: w.inCluster.vmCount + w.inManagementDomain.vmCount,
      undocumentedVms: w.inCluster.undocumentedVms + w.inManagementDomain.undocumentedVms,
      perVm: sum(w.inCluster.perVm, w.inManagementDomain.perVm),
    };
    rows.push({
      scope: 'workload-domain',
      id: w.domainId,
      label: `Workload doména ${domName.get(w.domainId) ?? w.domainId} (vlastní cluster + vCenter/NSX v management doméně)`,
      instanceId: w.instanceId,
      vmCount: all.vmCount,
      undocumentedVms: all.undocumentedVms,
      perVm: all.perVm,
      // Planning of the WLD cluster = its per-VM sum (WLD vCenter / NSX are in the management domain planning).
      planning: w.inCluster.perVm,
      flags: flags(all, false),
    });
  }
  for (const i of totals.instances)
    rows.push({ scope: 'instance', id: i.instanceId, label: `VCF instance ${instName.get(i.instanceId) ?? i.instanceId}`, instanceId: i.instanceId, vmCount: i.all.vmCount, undocumentedVms: i.all.undocumentedVms, perVm: i.all.perVm, planning: i.planning, flags: flags(i.all, false) });
  rows.push({ scope: 'fleet', id: fleet.id, label: 'Celá VCF fleet', vmCount: totals.fleet.all.vmCount, undocumentedVms: totals.fleet.all.undocumentedVms, perVm: totals.fleet.all.perVm, planning: totals.fleet.planning, flags: flags(totals.fleet.all, false) });
  return { model: totals, rows, expected: preset.expected, ...(preset.expectedFleetPlanning ? { expectedFleetPlanning: preset.expectedFleetPlanning } : {}) };
}

const sum = (a: Resources, b: Resources): Resources => ({ vcpu: a.vcpu + b.vcpu, ramGB: a.ramGB + b.ramGB, diskGB: a.diskGB + b.diskGB });

// ===========================================================================
// Utilisation + issues
// ===========================================================================

export interface ClusterUtilisationView extends ClusterUtilisation {
  readonly domainId: string;
  readonly domainName: string;
  readonly domainKind: Domain['kind'];
  readonly instanceId: string;
  readonly hostIds: readonly string[];
  /** Which demand the headline numbers use: planning (management primary cluster) or per-VM sum. */
  readonly basis: 'planning' | 'perVm';
  /** = planning ?? perVm. vcpuPerCore(+ N-1), ramPct(+ N-1), diskPctOfRaw. */
  readonly headline: Utilisation;
  /** Capacity recommendations of the model (management clusters only, 10 §6.5; 40 §5). */
  readonly issues: readonly ValidationIssue[];
}

export function utilisationViews(fleet: Fleet, inv: FleetInventory, totals: FleetTotals, caps: ReadonlyMap<string, HostCapacity>): ClusterUtilisationView[] {
  const out: ClusterUtilisationView[] = [];
  for (const i of fleet.instances)
    for (const d of [i.managementDomain, ...i.workloadDomains])
      for (const c of d.clusters) {
        const hosts = c.hosts.map((h) => caps.get(h.id)).filter((x): x is HostCapacity => x !== undefined);
        const u = clusterUtilisation(fleet, inv, totals, c.id, hosts);
        const issues = d.kind === 'management' ? validateManagementCapacity(u, `${d.name} / ${c.name}`) : [];
        out.push({ ...u, domainId: d.id, domainName: d.name, domainKind: d.kind, instanceId: i.id, hostIds: c.hosts.map((h) => h.id), basis: u.planning ? 'planning' : 'perVm', headline: u.planning ?? u.perVm, issues });
      }
  return out;
}

// ===========================================================================
// Flows
// ===========================================================================

export const SCENARIO_FLOWS_NOTE =
  `${FLOWS_ILLUSTRATIVE_NOTE} Síť hostů po nasazení (VDS, vmk vMotion / vSAN / TEP) je odvozená z modelu (applyBringupHostNetworking) s herními VLAN na cluster.`;

export interface ScenarioFlowsView extends FlowsView {
  /** vCenter VM endpoints (one per domain) attached to the host the VM is placed on. */
  readonly vcenterEndpoints: readonly { readonly endpointId: string; readonly domainId: string; readonly vmId: string; readonly hostId: string; readonly serverId: string }[];
  /** Flow level the model supports: host-level flows + vCenter VM endpoints (no documented VM <-> VM flows). */
  readonly level: 'host';
}

/** Room with the deployed host networking (derived copy, per-cluster game VLANs). */
export function deployedPhysical(s: SandboxState, fleet: Fleet, hostServers: Readonly<Record<string, string>>): PhysicalState {
  const N = SCENARIO_GAME_NETWORK;
  let phys = s.room.physical;
  let k = 0;
  for (const i of fleet.instances)
    for (const d of [i.managementDomain, ...i.workloadDomains])
      for (const c of d.clusters) {
        const ids = c.hosts.map((h) => hostServers[h.id]).filter((x): x is string => x !== undefined);
        phys = applyBringupHostNetworking(
          phys,
          ids,
          {
            esxManagement: { vlanId: N.mgmtVlan },
            vmotion: { vlanId: N.vmotionVlanBase + 10 * k, mtu: N.hostNetMtu },
            storage: { vlanId: N.storageVlanBase + 10 * k, mtu: N.hostNetMtu },
            nsxHostOverlay: { vlanId: N.overlayVlanBase + 10 * k, mtu: N.hostNetMtu },
          },
          'vsan-esa',
        );
        k++;
      }
  return phys;
}

export function scenarioFlows(
  s: SandboxState,
  catalog: HardwareCatalog,
  fleet: Fleet,
  inv: FleetInventory,
  placement: PlacementResult,
  hostServers: Readonly<Record<string, string>>,
): ScenarioFlowsView {
  const phys = deployedPhysical(s, fleet, hostServers);
  const baseEps = derivedEndpoints(s);
  const where = new Map(placement.placements.map((p) => [p.vmId, p.hostId]));
  const vcEps: { ep: ServiceEndpoint; domainId: string; vmId: string; hostId: string; serverId: string; managed: string[] }[] = [];
  for (const i of fleet.instances)
    for (const d of [i.managementDomain, ...i.workloadDomains]) {
      const vm = inv.vms.find((v) => v.component === 'vcenter' && v.servesDomainId === d.id);
      const hostId = vm ? where.get(vm.id) : undefined;
      const serverId = hostId ? hostServers[hostId] : undefined;
      if (!vm || !hostId || !serverId) continue;
      const managed = d.clusters.flatMap((c) => c.hosts.map((h) => hostServers[h.id])).filter((x): x is string => x !== undefined);
      vcEps.push({
        ep: { id: `vcenter-${d.id}`, kind: 'vcenter', label: `${d.name} vCenter`, fqdn: `${d.id}-vc01.vcf.example`, attachment: { kind: 'host-vm', serverId, tag: SCENARIO_GAME_NETWORK.mgmtVlan }, mtu: 1500 },
        domainId: d.id,
        vmId: vm.id,
        hostId,
        serverId,
        managed,
      });
    }
  const ctx = (eps: readonly ServiceEndpoint[]) => ({ state: { ...phys, endpoints: [...baseEps, ...eps] }, catalog });
  const flows: TrafficFlow[] = [...computeTrafficFlows(ctx([])).flows];
  // vCenter <-> its own hosts only (20 §7 #19/#20): one call per vCenter so no vCenter talks to foreign hosts.
  for (const v of vcEps)
    flows.push(...computeTrafficFlows(ctx([v.ep]), { vcenterManagedServerIds: v.managed }).flows.filter((f) => f.id.startsWith('vc:') || f.id.startsWith('hb:')));
  const full = ctx(vcEps.map((v) => v.ep));
  return {
    flows,
    ...aggregateTraffic(full, flows),
    ...trafficV3View(full, flows, s.room.companyNetwork),
    pairs: flowPairs(flows),
    activities: [],
    activeClasses: [...new Set(flows.map((f) => f.trafficClass))],
    illustrative: true,
    note: SCENARIO_FLOWS_NOTE,
    vcenterEndpoints: vcEps.map((v) => ({ endpointId: v.ep.id, domainId: v.domainId, vmId: v.vmId, hostId: v.hostId, serverId: v.serverId })),
    level: 'host',
  };
}
