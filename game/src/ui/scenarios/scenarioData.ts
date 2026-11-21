/**
 * "Hotové scénáře" – pure view data (no DOM, unit-tested).
 *
 * Every number comes from the model (model/deployedInventory.ts = docs/spec/40-workload-domains.md §6.3–§6.5 and
 * 10 §6.5) or – when engine-dev's scenario session is loaded – from its read-only `snapshot.scenario` (same model
 * functions). This file only groups, labels and formats; it never decides a VCF rule.
 *
 *  - documented totals ([W6] VCF Fleet Sizing Models) and derived per-VM sums are both shown, never mixed,
 *  - License server has no documented size (40 §8 q1) -> "nedoloženo",
 *  - VM -> host placement is a game distribution (placeVms, scope game-scope).
 */
import type { Fleet } from '../../model/architecture';
import type { SizingProfile } from '../../model/bringup';
import {
  type ClusterUtilisation,
  type FleetInventory,
  type FleetTotals,
  type HostCapacity,
  type InventoryVm,
  type PlacementResult,
  type Resources,
  type ScenarioPreset,
  type VmComponent,
  type VmSizeEntry,
  SCENARIO_PRESETS,
  VM_COMPONENT_LABEL,
  buildPresetFleet,
  clusterUtilisation,
  inventoryForFleet,
  placeVms,
  totalsForFleet,
  vmSize,
} from '../../model/deployedInventory';
import { DESIGN_BLUEPRINTS, LAYOUT_BLUEPRINTS, SITE_LAYOUT_IDS, type SiteLayoutId } from '../../model/sites';
import type { ValidationIssue } from '../../model/validation';

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Profile names as in the sizing table of 40 §6.4 ([W6] VCF Fleet Sizing Models). */
export const PROFILE_LABEL: Readonly<Record<SizingProfile, string>> = {
  simple: 'Simple',
  'ha-small': 'HA – Small',
  'ha-medium': 'HA – Medium',
  'ha-large': 'HA – Large',
};

/** Scenario groups in menu order (CLAUDE.md "Hotové scénáře": 1. nejmenší … 5. více instancí). */
export const SCENARIO_GROUP_TITLE: Readonly<Record<1 | 2 | 3 | 4 | 5, string>> = {
  1: 'Nejmenší nasazení, vše Simple',
  2: 'HA instalace',
  3: 'Management + workload doména',
  4: 'Více workload domén',
  5: 'Více VCF instancí',
};

/** Spec reference of the documented totals (40 §6.4 [W6] VCF Fleet Sizing Models). */
export const DOCUMENTED_TOTALS_REF = '40 §6.4 [W6]';
/** Spec reference of the per-VM size table (40 §6.3, workbook 9.1.1 [W28]). */
export const PER_VM_TABLE_REF = '40 §6.3, §6.5';
/** Management vCPU:pCPU guidance (10 §6.5 [P14]). */
export const CPU_GUIDANCE_REF = '10-planning §6.5 [P14]';
/**
 * Planning and Preparation Workbook 9.1.1 – the source of the per-VM sizes (40 §9 [W28]; its "Zdroje" line spans two
 * lines, so the registry does not parse it – the link is taken from the spec here).
 */
export const WORKBOOK_LINK = {
  label: 'Dokumentace: VCF 9.1.1 Planning and Preparation Workbook',
  url: 'https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/assets/vmware-cis/vcf/vcf-9.1.1-planning-and-preparation-workbook.xlsx',
} as const;

const ZERO: Resources = { vcpu: 0, ramGB: 0, diskGB: 0 };
const add = (a: Resources, b: Resources): Resources => ({ vcpu: a.vcpu + b.vcpu, ramGB: a.ramGB + b.ramGB, diskGB: a.diskGB + b.diskGB });

const nf = new Intl.NumberFormat('cs-CZ');
export const num = (n: number): string => nf.format(n);
export const fmtRes = (r: Resources): string => `${num(r.vcpu)} vCPU · ${num(r.ramGB)} GB RAM · ${num(r.diskGB)} GB disk`;
export const fmtResShort = (r: Resources): string => `${num(r.vcpu)} / ${num(r.ramGB)} GB / ${num(r.diskGB)} GB`;

/** Bracket ids of a "Shoda s TechDocs" cell ("= [W18][W19]") -> "[W18][W19]". */
export function techDocsIds(e: VmSizeEntry | undefined): string {
  return e ? (e.techDocs.match(/\[[A-Z]{1,4}\d+[a-z]?\]/g) ?? []).join('') : '';
}

/** Spec references for the "Zdroj" popover of one VM component (size table + where it runs). */
export function vmSourceRefs(vm: Pick<InventoryVm, 'component' | 'size' | 'specRef'>): string[] {
  const ids = techDocsIds(vmSize(vm.component, vm.size));
  return [`40-workload-domains §6.3 ${ids}`.trim(), vm.specRef.startsWith('40') ? vm.specRef.replace(/^40\b/, '40-workload-domains') : vm.specRef];
}

// ---------------------------------------------------------------------------
// Layout of a preset (which game site layout the room uses)
// ---------------------------------------------------------------------------

/** First game site layout of the preset's blueprint (06 §7a mapping); null blueprint = the classic single room. */
export function layoutForPreset(p: Pick<ScenarioPreset, 'blueprintId'>): SiteLayoutId | null {
  if (!p.blueprintId) return null;
  return SITE_LAYOUT_IDS.find((l) => LAYOUT_BLUEPRINTS[l].blueprintId === p.blueprintId) ?? null;
}

// ---------------------------------------------------------------------------
// Scenario model view
// ---------------------------------------------------------------------------

export interface DomainView {
  readonly id: string;
  readonly name: string;
  readonly kind: 'management' | 'workload';
  readonly instanceId: string;
  readonly clusterIds: readonly string[];
}

export interface InstanceView {
  readonly id: string;
  readonly name: string;
  readonly first: boolean;
  readonly profile?: SizingProfile;
  readonly location: 'site' | 'region2';
  readonly domains: readonly DomainView[];
}

export interface HostView {
  readonly id: string;
  /** Short label ("esx01"). */
  readonly label: string;
  readonly clusterId: string;
  readonly domainId: string;
  readonly instanceId: string;
  /** Starter configuration id (game choice from the 15 B.3 catalog). */
  readonly configId: string;
  readonly capacity?: HostCapacity;
  readonly load: Resources;
  readonly vmIds: readonly string[];
}

export interface VmView extends InventoryVm {
  readonly componentLabel: string;
  readonly hostId?: string;
}

export interface ClusterView {
  readonly id: string;
  readonly name: string;
  readonly domainId: string;
  readonly domainName: string;
  readonly instanceId: string;
  readonly management: boolean;
  readonly hostIds: readonly string[];
  readonly util?: ClusterUtilisation;
}

export interface ScenarioModelView {
  readonly preset: ScenarioPreset;
  readonly fleet: Fleet;
  readonly instances: readonly InstanceView[];
  readonly vms: readonly VmView[];
  readonly hosts: readonly HostView[];
  readonly clusters: readonly ClusterView[];
  readonly totals: FleetTotals;
  readonly issues: readonly ValidationIssue[];
  readonly placementScope: 'game-scope';
}

/** Read-only results of engine-dev's ScenarioSession (`snapshot.scenario`); any missing part is computed from the model. */
export interface ScenarioOverrides {
  readonly inventory?: FleetInventory;
  readonly placement?: PlacementResult;
  readonly totals?: FleetTotals;
  readonly utilisation?: readonly ClusterUtilisation[];
  readonly issues?: readonly ValidationIssue[];
}

export type CapacityOf = (hostId: string, configId: string) => HostCapacity | undefined;

const shortHost = (id: string): string => /esx\d+$/.exec(id)?.[0] ?? id;

export function scenarioModel(preset: ScenarioPreset, capacityOf: CapacityOf = () => undefined, o: ScenarioOverrides = {}): ScenarioModelView {
  const build = buildPresetFleet(preset);
  const fleet = build.fleet;
  const inventory = o.inventory ?? inventoryForFleet(fleet, build.options);
  const totals = o.totals ?? totalsForFleet(fleet, inventory);
  const placement = o.placement ?? placeVms(fleet, inventory);
  const hostOf = new Map(placement.placements.map((p) => [p.vmId, p.hostId]));
  const loadOf = new Map(placement.hosts.map((h) => [h.hostId, h]));

  const instances: InstanceView[] = [];
  const hosts: HostView[] = [];
  const clusters: ClusterView[] = [];
  fleet.instances.forEach((inst, i) => {
    const pi = preset.instances[i];
    const domains = [inst.managementDomain, ...inst.workloadDomains];
    const profile = inventory.profiles[inst.id];
    instances.push({
      id: inst.id,
      name: inst.name,
      first: inst.isFirstInstance,
      ...(profile ? { profile } : {}),
      location: pi?.location ?? 'site',
      domains: domains.map((d) => ({ id: d.id, name: d.name, kind: d.kind === 'management' ? 'management' : 'workload', instanceId: inst.id, clusterIds: d.clusters.map((c) => c.id) })),
    });
    for (const d of domains)
      for (const c of d.clusters) {
        const hs: HostView[] = c.hosts.map((hh) => {
          const configId = build.hostConfigs[hh.id] ?? '';
          const cap = capacityOf(hh.id, configId);
          const l = loadOf.get(hh.id);
          return { id: hh.id, label: shortHost(hh.id), clusterId: c.id, domainId: d.id, instanceId: inst.id, configId, ...(cap ? { capacity: cap } : {}), load: l?.load ?? ZERO, vmIds: l?.vmIds ?? [] };
        });
        hosts.push(...hs);
        const caps = hs.map((x) => x.capacity).filter((x): x is HostCapacity => !!x);
        const util = o.utilisation?.find((u) => u.clusterId === c.id) ?? (caps.length === hs.length && caps.length > 0 ? clusterUtilisation(fleet, inventory, totals, c.id, caps) : undefined);
        clusters.push({ id: c.id, name: c.name, domainId: d.id, domainName: d.name, instanceId: inst.id, management: d.kind === 'management', hostIds: hs.map((x) => x.id), ...(util ? { util } : {}) });
      }
  });
  const vms: VmView[] = inventory.vms.map((v) => {
    const hostId = hostOf.get(v.id);
    return { ...v, componentLabel: VM_COMPONENT_LABEL[v.component], ...(hostId ? { hostId } : {}) };
  });
  return {
    preset,
    fleet,
    instances,
    vms,
    hosts,
    clusters,
    totals,
    issues: o.issues ?? [...inventory.issues, ...placement.issues],
    placementScope: 'game-scope',
  };
}

// ---------------------------------------------------------------------------
// Cards (menu list) and compare
// ---------------------------------------------------------------------------

export interface ScenarioCardView {
  readonly id: string;
  readonly scenario: 1 | 2 | 3 | 4 | 5;
  readonly title: string;
  readonly blueprint: { readonly title: string; readonly url: string; readonly specRef: string } | null;
  /** "HA – Medium" or "instance-1: HA – Medium · instance-2: …". */
  readonly profiles: string;
  readonly hosts: number;
  readonly vmCount: number;
  readonly documented: readonly { readonly label: string; readonly resources: Resources }[];
  readonly planning: Resources;
  readonly specRef: string;
}

const instName = (m: ScenarioModelView, id: string): string => m.instances.find((i) => i.id === id)?.name ?? id;

export function scenarioCard(m: ScenarioModelView): ScenarioCardView {
  const p = m.preset;
  const bp = p.blueprintId ? DESIGN_BLUEPRINTS[p.blueprintId] : null;
  const multi = m.instances.length > 1;
  return {
    id: p.id,
    scenario: p.scenario,
    title: p.title,
    blueprint: bp ? { title: bp.title, url: bp.url, specRef: bp.specRef } : null,
    profiles: m.instances.map((i) => `${multi ? `${i.name}: ` : ''}${i.profile ? PROFILE_LABEL[i.profile] : '?'}`).join(' · '),
    hosts: m.hosts.length,
    vmCount: m.vms.length,
    documented: m.totals.managementDomains
      .filter((d) => d.documented)
      .map((d) => ({ label: multi ? `Management doména ${instName(m, d.instanceId)}` : 'Management doména', resources: d.documented!.resources })),
    planning: m.totals.fleet.planning,
    specRef: p.specRef.replace(/^40\b/, '40-workload-domains'),
  };
}

let cardsCache: readonly ScenarioCardView[] | null = null;
/** All preset cards in menu order (1–5, variants in spec order). */
export function scenarioCards(): readonly ScenarioCardView[] {
  cardsCache ??= [...SCENARIO_PRESETS].sort((a, b) => a.scenario - b.scenario).map((p) => scenarioCard(scenarioModel(p)));
  return cardsCache;
}

export interface CompareRow {
  readonly label: string;
  readonly kind: 'documented' | 'derived' | 'count';
  readonly a: string;
  readonly b: string;
}

const sumDoc = (m: ScenarioModelView): Resources | null => {
  const d = m.totals.managementDomains.filter((x) => x.documented);
  return d.length ? d.reduce((s, x) => add(s, x.documented!.resources), ZERO) : null;
};

/** Side-by-side comparison of two scenarios (totals only). */
export function compareRows(a: ScenarioModelView, b: ScenarioModelView): CompareRow[] {
  const ca = scenarioCard(a);
  const cb = scenarioCard(b);
  const res = (r: Resources | null): string => (r ? fmtResShort(r) : '—');
  const mgmtPerVm = (m: ScenarioModelView): Resources => m.totals.managementDomains.reduce((s, x) => add(s, x.base.perVm), ZERO);
  const wld = (m: ScenarioModelView): Resources => m.totals.workloadDomains.reduce((s, x) => add(s, x.inCluster.perVm), ZERO);
  return [
    { label: 'Profil', kind: 'count', a: ca.profiles, b: cb.profiles },
    { label: 'VCF instance', kind: 'count', a: String(a.instances.length), b: String(b.instances.length) },
    { label: 'Workload domény', kind: 'count', a: String(a.totals.workloadDomains.length), b: String(b.totals.workloadDomains.length) },
    { label: 'ESX hosty', kind: 'count', a: String(ca.hosts), b: String(cb.hosts) },
    { label: 'VM celkem', kind: 'count', a: String(ca.vmCount), b: String(cb.vmCount) },
    { label: 'Management doména – dokumentováno', kind: 'documented', a: res(sumDoc(a)), b: res(sumDoc(b)) },
    { label: 'Management doména – součet per-VM', kind: 'derived', a: res(mgmtPerVm(a)), b: res(mgmtPerVm(b)) },
    { label: 'vCenter / NSX workload domén v management doméně', kind: 'derived', a: res(a.totals.managementDomains.reduce((s, x) => add(s, x.workloadIncrements.perVm), ZERO)), b: res(b.totals.managementDomains.reduce((s, x) => add(s, x.workloadIncrements.perVm), ZERO)) },
    { label: 'Clustery workload domén (Supervisor, Edge…)', kind: 'derived', a: res(wld(a)), b: res(wld(b)) },
    { label: 'Fleet celkem (plán)', kind: 'derived', a: res(a.totals.fleet.planning), b: res(b.totals.fleet.planning) },
  ];
}

// ---------------------------------------------------------------------------
// Gap explanation (documented vs per-VM, 40 §6.4)
// ---------------------------------------------------------------------------

export interface GapView {
  readonly gap: Resources;
  /** CPU / RAM part of the gap and whether an undocumented VM (License server) can explain it. */
  readonly cpuRamText: string | null;
  readonly diskText: string | null;
}

/** Czech explanation of documented − per-VM for one management domain (paraphrase of 40 §6.4). */
export function gapView(gap: Resources, undocumentedVms: number): GapView {
  const cpuRam = gap.vcpu !== 0 || gap.ramGB !== 0;
  return {
    gap,
    cpuRamText: cpuRam
      ? undocumentedVms > 0
        ? `Rozdíl ${num(gap.vcpu)} vCPU / ${num(gap.ramGB)} GB RAM nejspíš připadá na License server – jeho velikost dokumentace neuvádí (odvozeno z rozdílu, nedoloženo).`
        : `Rozdíl ${num(gap.vcpu)} vCPU / ${num(gap.ramGB)} GB RAM – specifikace ho nevysvětluje.`
      : 'vCPU a RAM: součet per-VM přesně odpovídá dokumentovanému součtu.',
    diskText:
      gap.diskGB !== 0
        ? `Disk: součet per-VM je o ${num(gap.diskGB)} GB ${gap.diskGB > 0 ? 'menší' : 'větší'} než dokumentovaný disk. Rozdíl dokumentace nevysvětluje – hra počítá s dokumentovaným diskem jako celkem (otevřená otázka specifikace).`
        : null,
  };
}

// ---------------------------------------------------------------------------
// VM table helpers
// ---------------------------------------------------------------------------

export type VmSortKey = 'name' | 'component' | 'vcpu' | 'ramGB' | 'diskGB' | 'host';

export function sortVms(vms: readonly VmView[], key: VmSortKey, dir: 1 | -1, hostLabel: (id: string | undefined) => string): VmView[] {
  const val = (v: VmView): string | number => {
    switch (key) {
      case 'name':
        return v.name;
      case 'component':
        return v.componentLabel;
      case 'host':
        return hostLabel(v.hostId);
      default:
        return v[key] ?? -1;
    }
  };
  return [...vms].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'cs');
    return c * dir || a.id.localeCompare(b.id);
  });
}

export function filterVms(vms: readonly VmView[], q: string, component: VmComponent | ''): VmView[] {
  const s = q.trim().toLowerCase();
  return vms.filter((v) => (!component || v.component === component) && (!s || `${v.name} ${v.componentLabel} ${v.size}`.toLowerCase().includes(s)));
}

/** Percentage for a load bar (0 when capacity is unknown). */
export const pctOf = (used: number, cap: number | undefined): number => (cap && cap > 0 ? Math.round((used / cap) * 1000) / 10 : 0);
