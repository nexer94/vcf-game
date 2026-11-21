import { describe, expect, it } from 'vitest';
import { validateFleet } from '../architecture';
import { STARTER_CONFIG_DEFS, buildHardwareCatalog } from '../hardwareCatalog';
import {
  type FleetInventory,
  type HostCapacity,
  type Resources,
  SCENARIO_PRESETS,
  VM_SIZES,
  WORKER_NODE_COUNTS,
  buildPresetFleet,
  clusterUtilisation,
  documentedTotals,
  hostCapacityFromConfig,
  inventoryForFleet,
  placeVms,
  presetById,
  profileComposition,
  sumVms,
  totalsForFleet,
  validateManagementCapacity,
  vmSize,
} from '../deployedInventory';
import { DESIGN_BLUEPRINTS } from '../sites';
import type { Fleet } from '../architecture';
import { errorsOf } from '../validation';

const R = (vcpu: number, ramGB: number, diskGB: number): Resources => ({ vcpu, ramGB, diskGB });

function build(id: string) {
  const p = presetById(id);
  if (!p) throw new Error(id);
  const b = buildPresetFleet(p);
  const inv = inventoryForFleet(b.fleet, b.options);
  const totals = totalsForFleet(b.fleet, inv);
  return { preset: p, ...b, inv, totals };
}

describe('per-VM size table (40 §6.3)', () => {
  it('has the documented values', () => {
    expect(vmSize('vcenter', 'Medium')).toMatchObject({ vcpu: 8, ramGB: 30, diskGB: 933 });
    expect(vmSize('nsx-manager', 'XLarge')).toMatchObject({ vcpu: 24, ramGB: 96, diskGB: 400 });
    expect(vmSize('vcf-automation', 'Large')).toMatchObject({ vcpu: 32, ramGB: 128, diskGB: 1200 });
    expect(vmSize('services-runtime-control-plane', 'Large')).toMatchObject({ vcpu: 8, ramGB: 14, diskGB: 100 });
    expect(vmSize('virtual-network-appliance', 'Medium')).toMatchObject({ vcpu: 4, ramGB: 8, diskGB: 200 });
    expect(vmSize('supervisor-control-plane', 'Small')).toMatchObject({ vcpu: 4, ramGB: 16, diskGB: 48 });
  });

  it('every entry has a source; License server is undocumented', () => {
    for (const s of VM_SIZES) expect(s.source.length).toBeGreaterThan(0);
    const ls = vmSize('license-server', 'Default');
    expect(ls).toMatchObject({ vcpu: null, ramGB: null, diskGB: null, undocumented: true });
  });

  it('worker counts: used = column fitting the documented totals (40 §6.4)', () => {
    expect(WORKER_NODE_COUNTS.first['ha-large']).toEqual({ page: 4, workbook: 3, used: 4 });
    expect(WORKER_NODE_COUNTS.additional.simple).toEqual({ page: 2, workbook: 1, used: 1 });
    expect(profileComposition('additional', 'ha-medium').runtimeWorker.nodes).toBe(2);
    expect(profileComposition('additional', 'ha-medium').vcfOperations).toBeUndefined();
    expect(profileComposition('additional', 'ha-medium').licenseServer).toBeUndefined();
  });
});

describe('scenario presets (40 §6.5) – totals equal spec tables', () => {
  for (const preset of SCENARIO_PRESETS) {
    it(`${preset.id}`, () => {
      const { fleet, inv, totals } = build(preset.id);
      expect(inv.issues).toEqual([]);
      expect(errorsOf(validateFleet(fleet))).toEqual([]);
      for (const ex of preset.expected) {
        const inst = fleet.instances.find((i) => i.id === ex.instanceKey);
        const mt = totals.managementDomains.find((m) => m.instanceId === ex.instanceKey);
        expect(inst && mt).toBeTruthy();
        expect(mt?.all.vmCount).toBe(ex.mgmtDomainVms);
        expect(mt?.base.perVm).toEqual(ex.basePerVm);
        expect(mt?.documented?.resources).toEqual(ex.documented);
        expect(mt?.planning).toEqual(ex.mgmtPlanning);
      }
      if (preset.expectedFleetPlanning) {
        // Fleet total of scenario 5 = sum of the documented [W6] totals (no WLD).
        expect(totals.fleet.planning).toEqual(preset.expectedFleetPlanning);
      }
    });
  }

  it('first instance: documented − per-VM = 2 vCPU / 4 GB (License server gap) + disk gap', () => {
    const gaps = ['s1-minimal-simple', 's2-ha-small', 's2-ha-medium', 's2-ha-large'].map((id) => build(id).totals.managementDomains[0]?.documentedMinusPerVm);
    expect(gaps).toEqual([R(2, 4, 1362), R(2, 4, 1062), R(2, 4, 1312), R(2, 4, 3172)]);
  });

  it('License server VM is listed but undocumented (first instance only)', () => {
    const { inv } = build('s5-two-instances');
    const ls = inv.vms.filter((v) => v.component === 'license-server');
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ instanceId: 'i1', undocumented: true, vcpu: null });
    expect(inv.vms.filter((v) => v.instanceId === 'i2' && ['vcf-operations', 'vcf-automation', 'license-server'].includes(v.component))).toEqual([]);
  });

  it('scenario 5: 30 VMs in the fleet', () => {
    const { totals } = build('s5-two-instances');
    expect(totals.fleet.all.vmCount).toBe(30);
  });

  it('scenario 3: WLD vCenter + NSX run in the mgmt primary cluster, Supervisor + Edge in the WLD cluster', () => {
    const { fleet, inv, totals } = build('s3-wld-dedicated-nsx');
    const mgmtCluster = fleet.instances[0]?.managementDomain.clusters[0]?.id;
    const wldVms = inv.vms.filter((v) => v.servesDomainId === 'i1-w01');
    const inMgmt = wldVms.filter((v) => v.clusterId === mgmtCluster).map((v) => v.component);
    expect(inMgmt).toEqual(['vcenter', 'nsx-manager', 'nsx-manager', 'nsx-manager']);
    const w = totals.workloadDomains[0];
    expect(w?.inManagementDomain.perVm).toEqual(R(26, 102, 1833));
    // Example cluster of 40 §6.5 scénář 3: 1 Supervisor CP Small + 2 Edge Large.
    expect(w?.inCluster.perVm).toEqual(R(20, 80, 448));
    expect(w?.inCluster.vmCount).toBe(3);
    expect(inv.vms.find((v) => v.component === 'supervisor-control-plane')?.placementDerived).toBe(true);
    expect(totals.instances[0]?.planning).toEqual(R(230, 838, 13726));
  });

  it('scenario 4b: second WLD joins the first WLD NSX – no new NSX VMs', () => {
    const { inv } = build('s4b-two-wld-shared-wld-nsx');
    expect(inv.vms.filter((v) => v.component === 'nsx-manager' && v.servesDomainId === 'i1-w02')).toEqual([]);
    expect(inv.vms.filter((v) => v.component === 'nsx-manager' && v.servesDomainId === 'i1-w01')).toHaveLength(3);
  });

  it('presets reference existing blueprints and starter configs, blueprint host counts', () => {
    const starters = new Set(STARTER_CONFIG_DEFS.map((d) => d.id));
    for (const p of SCENARIO_PRESETS) {
      if (p.blueprintId) expect(DESIGN_BLUEPRINTS[p.blueprintId]).toBeDefined();
      for (const i of p.instances) {
        expect(starters.has(i.managementHosts.starterConfigId)).toBe(true);
        for (const w of i.workloadDomains) expect(starters.has(w.hosts.starterConfigId)).toBe(true);
      }
    }
    const s1 = presetById('s1-minimal-simple');
    expect(s1?.instances[0]?.managementHosts.count).toBe(DESIGN_BLUEPRINTS['vcf-fleet-single-site-minimal-footprint'].hostGroups[0]?.esxHosts);
  });
});

describe('additional instance variants (40 §6.5 scénář 5)', () => {
  const variant = (profile: 'simple' | 'ha-small' | 'ha-large') => {
    const b = buildPresetFleet(presetById('s5-two-instances')!);
    const i2 = b.fleet.instances[1]!;
    const fleet: Fleet = {
      ...b.fleet,
      instances: [
        b.fleet.instances[0]!,
        {
          ...i2,
          managementDomain: {
            ...i2.managementDomain,
            vcenter: { ...i2.managementDomain.vcenter, size: profileComposition('additional', profile).vcenter },
            nsx: { mode: 'dedicated', model: profile === 'simple' ? 'simple' : 'high-availability' },
          },
        },
      ],
    };
    const inv = inventoryForFleet(fleet); // profile inferred from vCenter size / NSX model
    return totalsForFleet(fleet, inv).managementDomains[1]!;
  };

  it('Simple: 6 VMs, 34 / 111 / 3312, documented 34 / 111 / 4562', () => {
    const m = variant('simple');
    expect(m.profile).toBe('simple');
    expect(m.all.vmCount).toBe(6);
    expect(m.base.perVm).toEqual(R(34, 111, 3312));
    expect(m.documented?.resources).toEqual(R(34, 111, 4562));
  });

  it('HA-Small: 11 VMs, 62 / 187 (disk sum 4112 – spec table says 3112, arithmetic), documented 62 / 187 / 5462', () => {
    const m = variant('ha-small');
    expect(m.all.vmCount).toBe(11);
    expect(m.base.perVm).toEqual(R(62, 187, 4112));
    expect(m.documented?.resources).toEqual(R(62, 187, 5462));
  });

  it('HA-Large: 11 VMs, 120 / 353 / 5261, documented 120 / 353 / 8321', () => {
    const m = variant('ha-large');
    expect(m.all.vmCount).toBe(11);
    expect(m.base.perVm).toEqual(R(120, 353, 5261));
    expect(m.documented?.resources).toEqual(R(120, 353, 8321));
  });
});

describe('documented totals are never replaced by derived ones', () => {
  it('deferred VCF Automation -> no documented total, planning = per-VM', () => {
    const b = buildPresetFleet(presetById('s2-ha-medium')!);
    const i1 = b.fleet.instances[0]!;
    const fleet: Fleet = {
      ...b.fleet,
      instances: [{ ...i1, managementDomain: { ...i1.managementDomain, components: i1.managementDomain.components.filter((c) => c.kind !== 'vcf-automation') } }],
    };
    const inv = inventoryForFleet(fleet);
    const m = totalsForFleet(fleet, inv).managementDomains[0]!;
    expect(inv.vms.some((v) => v.component === 'vcf-automation')).toBe(false);
    expect(m.documented).toBeUndefined();
    expect(m.planning).toEqual(R(182 - 72, 652 - 288, 10133 - 2700));
    expect(documentedTotals('first', 'ha-medium')).toEqual(R(184, 656, 11445));
  });
});

describe('workload domain validations (40 §5)', () => {
  const base = () => buildPresetFleet(presetById('s3-wld-dedicated-nsx')!);

  it('Edge cluster with < 2 nodes', () => {
    const b = base();
    const inv = inventoryForFleet(b.fleet, { ...b.options, workloadDomains: { 'i1-w01': { connectivity: { kind: 'edge', nodes: 1, size: 'Medium' } } } });
    expect(inv.issues.map((i) => i.code)).toEqual(['WLD_EDGE_CLUSTER_MIN_NODES']);
  });

  it('VNA node count 1 or 2', () => {
    const b = base();
    const ok = inventoryForFleet(b.fleet, { workloadDomains: { 'i1-w01': { connectivity: { kind: 'vna', nodes: 2, size: 'Medium' } } } });
    expect(ok.issues).toEqual([]);
    expect(ok.vms.filter((v) => v.component === 'virtual-network-appliance')).toHaveLength(2);
    const bad = inventoryForFleet(b.fleet, { workloadDomains: { 'i1-w01': { connectivity: { kind: 'vna', nodes: 3, size: 'Medium' } } } });
    expect(bad.issues.map((i) => i.code)).toEqual(['WLD_VNA_NODE_COUNT']);
  });

  it('Domain infrastructure only: vCenter + NSX only, Supervisor not allowed', () => {
    const b = base();
    const i1 = b.fleet.instances[0]!;
    const w = { ...i1.workloadDomains[0]!, clusters: [] };
    const fleet: Fleet = { ...b.fleet, instances: [{ ...i1, workloadDomains: [w] }] };
    const plain = inventoryForFleet(fleet);
    expect(plain.issues).toEqual([]);
    expect(plain.vms.filter((v) => v.servesDomainId === w.id).map((v) => v.component)).toEqual(['vcenter', 'nsx-manager', 'nsx-manager', 'nsx-manager']);
    const sup = inventoryForFleet(fleet, { workloadDomains: { [w.id]: { supervisor: { nodes: 1, size: 'Small' } } } });
    expect(sup.issues.map((i) => i.code)).toEqual(['WLD_SUPERVISOR_REQUIRES_CLUSTER']);
  });

  it('unknown profile is reported (game-scope)', () => {
    const b = base();
    const i1 = b.fleet.instances[0]!;
    const fleet: Fleet = { ...b.fleet, instances: [{ ...i1, managementDomain: { ...i1.managementDomain, vcenter: { kind: 'vcenter', nodes: 1, size: 'Tiny' } } }] };
    const inv = inventoryForFleet(fleet);
    expect(inv.issues.map((i) => [i.code, i.scope])).toEqual([['INVENTORY_PROFILE_UNKNOWN', 'game-scope']]);
  });

  it('WLD vCenter storage Large uses the [W19] disk', () => {
    const b = base();
    const inv = inventoryForFleet(b.fleet, { workloadDomains: { 'i1-w01': { vcenterStorage: 'large' } } });
    expect(inv.vms.find((v) => v.component === 'vcenter' && v.servesDomainId === 'i1-w01')?.diskGB).toBe(2233);
  });
});

describe('placement (game-scope)', () => {
  for (const preset of SCENARIO_PRESETS) {
    it(`${preset.id}: every VM placed exactly once on a host of its cluster`, () => {
      const { fleet, inv } = build(preset.id);
      const pl = placeVms(fleet, inv);
      expect(pl.scope).toBe('game-scope');
      expect(pl.issues).toEqual([]);
      expect(pl.placements.map((p) => p.vmId).sort()).toEqual(inv.vms.map((v) => v.id).sort());
      const clusterHosts = new Map(fleet.instances.flatMap((i) => [i.managementDomain, ...i.workloadDomains]).flatMap((d) => d.clusters).map((c) => [c.id, new Set(c.hosts.map((h) => h.id))]));
      for (const p of pl.placements) expect(clusterHosts.get(p.clusterId)?.has(p.hostId)).toBe(true);
      // Host loads add up to the per-VM sum.
      const sum = pl.hosts.reduce((a, h) => ({ vcpu: a.vcpu + h.load.vcpu, ramGB: a.ramGB + h.load.ramGB, diskGB: a.diskGB + h.load.diskGB }), R(0, 0, 0));
      expect(sum).toEqual(sumVms(inv.vms).perVm);
    });
  }

  it('spreads the 3 NSX Manager nodes over different hosts and is deterministic', () => {
    const { fleet, inv } = build('s2-ha-medium');
    const pl = placeVms(fleet, inv);
    const nsxHosts = inv.vms.filter((v) => v.component === 'nsx-manager').map((v) => pl.placements.find((p) => p.vmId === v.id)?.hostId);
    expect(new Set(nsxHosts).size).toBe(3);
    expect(placeVms(fleet, inv)).toEqual(pl);
  });

  it('cluster without hosts -> game-scope issue', () => {
    const { fleet, inv } = build('s1-minimal-simple');
    const i1 = fleet.instances[0]!;
    const empty: Fleet = { ...fleet, instances: [{ ...i1, managementDomain: { ...i1.managementDomain, clusters: [{ ...i1.managementDomain.clusters[0]!, hosts: [] }] } }] };
    const pl = placeVms(empty, inv as FleetInventory);
    expect(pl.issues.map((i) => i.code)).toEqual(['PLACEMENT_CLUSTER_NO_HOSTS']);
    expect(pl.placements).toEqual([]);
  });
});

describe('host capacity & utilisation (10 §6.5)', () => {
  const cat = buildHardwareCatalog();
  const caps = (hostConfigs: Readonly<Record<string, string>>, hostIds: readonly string[]): HostCapacity[] =>
    hostIds.map((h) => {
      const starter = cat.starterServers.find((s) => s.id === hostConfigs[h]);
      const c = starter && hostCapacityFromConfig(cat, h, starter.config);
      if (!c) throw new Error(h);
      return c;
    });

  it('host capacity from a starter config (dell-r670-med: 2×16 cores, 256 GB, 8×3.2 TB)', () => {
    const s = cat.starterServers.find((x) => x.id === 'dell-r670-med')!;
    expect(hostCapacityFromConfig(cat, 'h1', s.config)).toEqual({ hostId: 'h1', cores: 32, ramGB: 256, rawCapacityTB: 25.6 });
  });

  it('scenario 1 on 3× dell-r670-med: math of ratios and percentages', () => {
    const { fleet, inv, totals, hostConfigs } = build('s1-minimal-simple');
    const cl = fleet.instances[0]!.managementDomain.clusters[0]!;
    const u = clusterUtilisation(fleet, inv, totals, cl.id, caps(hostConfigs, cl.hosts.map((h) => h.id)));
    expect(u).toMatchObject({ hostCount: 3, cores: 96, ramGB: 768, rawCapacityGB: 76800, cpuGuidanceMaxRatio: 2, derived: true });
    // per-VM: 74 vCPU / 96 cores; 247 / 768 GB; 6086 / 76800 GB
    expect(u.perVm).toMatchObject({ vcpuPerCore: 0.77, vcpuPerCoreOneHostDown: 1.16, ramPct: 32.2, ramPctOneHostDown: 48.2, diskPctOfRaw: 7.9 });
    // planning (documented [W6]): 76 / 251 / 7448
    expect(u.planning).toMatchObject({ demand: R(76, 251, 7448), vcpuPerCore: 0.79, ramPct: 32.7, diskPctOfRaw: 9.7 });
    expect(validateManagementCapacity(u)).toEqual([]);
  });

  it('above 2:1 and over capacity -> recommendations', () => {
    const { fleet, inv, totals } = build('s2-ha-large');
    const cl = fleet.instances[0]!.managementDomain.clusters[0]!;
    const small: HostCapacity[] = cl.hosts.map((h) => ({ hostId: h.id, cores: 16, ramGB: 128, rawCapacityTB: 3.2 }));
    const u = clusterUtilisation(fleet, inv, totals, cl.id, small);
    expect(u.planning?.vcpuPerCore).toBe(4.66); // 298 / 64
    const codes = validateManagementCapacity(u).map((i) => [i.code, i.severity]);
    expect(codes).toEqual([
      ['MGMT_CPU_OVERCOMMIT_ABOVE_GUIDANCE', 'recommendation'],
      ['MGMT_DOMAIN_CAPACITY_EXCEEDED', 'recommendation'],
    ]);
  });

  it('presets fit the 2:1 guidance and RAM with all hosts up', () => {
    for (const p of SCENARIO_PRESETS) {
      const { fleet, inv, totals, hostConfigs } = build(p.id);
      for (const inst of fleet.instances) {
        const cl = inst.managementDomain.clusters[0]!;
        const u = clusterUtilisation(fleet, inv, totals, cl.id, caps(hostConfigs, cl.hosts.map((h) => h.id)));
        expect(validateManagementCapacity(u), `${p.id}/${inst.id}`).toEqual([]);
      }
    }
  });

  it('WLD cluster: no CPU guidance, no planning view', () => {
    const { fleet, inv, totals, hostConfigs } = build('s3-wld-dedicated-nsx');
    const cl = fleet.instances[0]!.workloadDomains[0]!.clusters[0]!;
    const u = clusterUtilisation(fleet, inv, totals, cl.id, caps(hostConfigs, cl.hosts.map((h) => h.id)));
    expect(u.cpuGuidanceMaxRatio).toBeUndefined();
    expect(u.planning).toBeUndefined();
    expect(u.perVm.demand).toEqual(R(20, 80, 448));
  });
});
