import { describe, expect, it } from 'vitest';
import { SCENARIO_PRESETS, buildPresetFleet, inventoryForFleet, totalsForFleet } from '../../../model';
import { type ScenarioEvent, ScenarioSession, listScenarios } from '..';

const sessions = new Map<string, ScenarioSession>();
const session = (id: string): ScenarioSession => {
  let s = sessions.get(id);
  if (!s) sessions.set(id, (s = new ScenarioSession(id)));
  return s;
};

describe('Hotové scénáře – listScenarios', () => {
  it('lists every preset in menu order with title / summary', () => {
    const list = listScenarios();
    expect(list.map((x) => x.id)).toEqual(SCENARIO_PRESETS.map((p) => p.id));
    expect(list.map((x) => x.order)).toEqual(list.map((_, i) => i + 1));
    const groups = list.map((x) => x.scenario);
    expect([...groups].sort((a, b) => a - b)).toEqual(groups);
    for (const x of list) {
      expect(x.title).not.toBe('');
      expect(x.summary).toMatch(/^Profil .* ESX host(y|ů)?$/);
    }
    expect(list[0]!.summary).toContain('3 ESX hosty');
    expect(list.find((x) => x.id === 's5-two-instances')!.summary).toContain('2 VCF instance');
  });
});

describe.each(SCENARIO_PRESETS.map((p) => p.id))('Hotové scénáře – %s', (id) => {
  it('builds the room by replay: racks, ToR, servers with ESX configured, no running tasks', () => {
    const s = session(id);
    const snap = s.snapshot();
    const hosts = Object.keys(s.build.hostConfigs);
    expect(Object.keys(snap.scenario.hostServers).sort()).toEqual([...hosts].sort());
    const servers = snap.sandbox.physical.servers;
    expect(servers).toHaveLength(hosts.length);
    for (const srv of servers) {
      expect(srv.status).toBe('esx-static');
      expect(srv.mgmt.gatewayReachable).toBe(true);
    }
    // one rack per cluster, each with its pre-installed ToR
    const clusters = s.build.fleet.instances.flatMap((i) => [i.managementDomain, ...i.workloadDomains].flatMap((d) => d.clusters));
    expect(snap.scenario.racks).toHaveLength(clusters.length);
    for (const r of snap.sandbox.physical.racks) expect(r.tor?.a).toBeDefined();
    expect(s.sandbox.state.tasks).toEqual([]);
    // host FQDNs = fleet host FQDNs, DNS A records present
    for (const h of s.build.fleet.instances.flatMap((i) => [i.managementDomain, ...i.workloadDomains].flatMap((d) => d.clusters.flatMap((c) => c.hosts)))) {
      const srv = servers.find((x) => x.id === snap.scenario.hostServers[h.id])!;
      expect(srv).toBeDefined();
      expect(snap.sandbox.planning.dns.a.some((r) => r.fqdn === h.fqdn)).toBe(true);
    }
  });

  it('design choices = blueprint documented choices + preset profile', () => {
    const s = session(id);
    const { meta } = s.snapshot().scenario;
    const ch = meta.designChoices;
    expect(ch['deployment-model']).toBe(meta.profile === 'simple' ? 'simple' : 'high-availability');
    expect(ch['deployment-size']).toBe({ simple: 'small', 'ha-small': 'small', 'ha-medium': 'medium', 'ha-large': 'large' }[meta.profile]);
    if (s.preset.blueprintId) {
      expect(meta.blueprint?.id).toBe(s.preset.blueprintId);
      expect(s.snapshot().sandbox.site.blueprint?.id).toBe(s.preset.blueprintId);
    } else expect(meta.blueprint).toBeNull();
  });

  it('totals equal the model (totalsForFleet) and the spec tables (40 §6.5)', () => {
    const s = session(id);
    const b = buildPresetFleet(s.preset);
    const inv = inventoryForFleet(b.fleet, b.options);
    const totals = totalsForFleet(b.fleet, inv);
    const view = s.snapshot().scenario;
    expect(view.totals.model).toEqual(totals);
    expect(view.inventory.vms.map((v) => v.id)).toEqual(inv.vms.map((v) => v.id));
    for (const exp of s.preset.expected) {
      const m = totals.managementDomains.find((x) => x.instanceId === exp.instanceKey)!;
      const row = view.totals.rows.find((r) => r.scope === 'management-domain' && r.id === m.domainId)!;
      expect(row.documented?.resources).toEqual(exp.documented);
      expect(row.planning).toEqual(exp.mgmtPlanning);
      expect(row.vmCount).toBe(exp.mgmtDomainVms);
      expect(row.gap).toEqual({ vcpu: exp.documented.vcpu - exp.basePerVm.vcpu, ramGB: exp.documented.ramGB - exp.basePerVm.ramGB, diskGB: exp.documented.diskGB - exp.basePerVm.diskGB });
      expect(row.flags).toMatchObject({ perVmDerived: true, planningDerived: true, gapDerived: true });
    }
    const fleetRow = view.totals.rows.find((r) => r.scope === 'fleet')!;
    expect(fleetRow.planning).toEqual(totals.fleet.planning);
    expect(fleetRow.perVm).toEqual(totals.fleet.all.perVm);
    if (s.preset.expectedFleetPlanning) expect(fleetRow.planning).toEqual(s.preset.expectedFleetPlanning);
    expect(view.totals.rows.filter((r) => r.scope === 'instance')).toHaveLength(totals.instances.length);
    expect(view.totals.rows.filter((r) => r.scope === 'workload-domain')).toHaveLength(totals.workloadDomains.length);
    // License server (first instance): undocumented, counted but not summed (40 §8 q1)
    const lic = view.inventory.vms.filter((v) => v.component === 'license-server');
    for (const v of lic) expect(v).toMatchObject({ undocumented: true, vcpu: null });
  });

  it('placement: every VM on a host of its cluster, mapped to a physical server', () => {
    const view = session(id).snapshot().scenario;
    expect(view.placement.scope).toBe('game-scope');
    expect(view.placement.vms).toHaveLength(view.inventory.vms.length);
    for (const p of view.placement.vms) {
      const h = view.placement.hosts.find((x) => x.hostId === p.hostId)!;
      expect(h.clusterId).toBe(p.clusterId);
      expect(p.serverId).toBe(view.hostServers[p.hostId]);
      expect(h.vmIds).toContain(p.vmId);
    }
    for (const v of view.inventory.vms) expect(v.serverId).toBeDefined();
    for (const h of view.placement.hosts) {
      expect(h.capacity).toBeDefined();
      expect(h.rackId).not.toBe('');
    }
  });

  it('utilisation per cluster incl. N-1; capacity issues from the model', () => {
    const view = session(id).snapshot().scenario;
    expect(view.utilisation.length).toBe(view.racks.length);
    for (const u of view.utilisation) {
      expect(u.hostCount).toBe(u.hostIds.length);
      expect(u.headline.vcpuPerCore).toBeGreaterThan(0);
      expect(u.headline.vcpuPerCoreOneHostDown).toBeGreaterThan(u.headline.vcpuPerCore);
      expect(u.headline.ramPctOneHostDown).toBeGreaterThan(u.headline.ramPct);
      expect(u.headline.diskPctOfRaw).toBeGreaterThanOrEqual(0);
      if (u.domainKind === 'management') expect(u.headline.diskPctOfRaw).toBeGreaterThan(0);
      expect(u.basis).toBe(u.domainKind === 'management' ? 'planning' : 'perVm');
      if (u.domainKind === 'management') expect(u.cpuGuidanceMaxRatio).toBe(2);
    }
    expect(view.issues).toEqual(expect.arrayContaining(view.utilisation.flatMap((u) => u.issues)));
    for (const i of view.issues) expect(['error', 'warning', 'recommendation', 'info']).toContain(i.severity);
  });

  it('flows: vCenter VMs manage only their own hosts; vSAN stays inside a cluster', () => {
    const view = session(id).snapshot().scenario;
    const f = view.flows;
    expect(f.illustrative).toBe(true);
    expect(f.level).toBe('host');
    const serverCluster = new Map(view.placement.hosts.map((h) => [h.serverId, h.clusterId]));
    const vcFlows = f.flows.filter((x) => x.id.startsWith('vc:'));
    expect(vcFlows.length).toBe(view.placement.hosts.filter((h) => view.fleet.instances.some((i) => [i.managementDomain, ...i.workloadDomains].some((d) => d.clusters.some((c) => c.id === h.clusterId)))).length);
    for (const ep of f.vcenterEndpoints) {
      const dom = view.fleet.instances.flatMap((i) => [i.managementDomain, ...i.workloadDomains]).find((d) => d.id === ep.domainId)!;
      const own = new Set(dom.clusters.flatMap((c) => c.hosts.map((h) => view.hostServers[h.id])));
      const mine = vcFlows.filter((x) => x.from.kind === 'endpoint' && x.from.id === ep.endpointId);
      expect(mine.length).toBe(own.size);
      for (const x of mine) expect(own.has(x.to.id)).toBe(true);
    }
    const vsan = f.flows.filter((x) => x.trafficClass === 'vsan');
    expect(vsan.length).toBeGreaterThan(0);
    for (const x of vsan) expect(serverCluster.get(x.from.id)).toBe(serverCluster.get(x.to.id));
    expect(f.links.some((l) => l.totalLoadGbps > 0)).toBe(true);
    expect(f.pairs.length).toBeGreaterThan(0);
  });
});

describe('Hotové scénáře – read-only and snapshot shape', () => {
  it('rejects every Sandbox command as flow read-only-scenario; state unchanged', () => {
    const s = session('s1-minimal-simple');
    const before = s.sandbox.state;
    const events: ScenarioEvent[] = [];
    const off = s.subscribe((e) => events.push(e));
    const srv = Object.values(s.snapshot().scenario.hostServers)[0]!;
    for (const cmd of [
      { type: 'buyItem', itemId: 'dell-r670-med' },
      { type: 'unmountDevice', deviceId: srv },
      { type: 'selectDesignOption', decision: 'deployment-model', option: 'high-availability' },
      { type: 'advancePhase' },
      { type: 'openConsole', serverId: srv },
    ] as const) {
      expect(s.dispatch(cmd)).toMatchObject({ ok: false, rejection: { kind: 'flow', reason: 'read-only-scenario' } });
    }
    expect(s.sandbox.state).toBe(before);
    expect(events.filter((e) => e.type === 'scenario/commandRejected')).toHaveLength(5);
    off();
  });

  it('inspect / camera are accepted and appear in the snapshot', () => {
    const s = new ScenarioSession('s5-two-instances');
    const snap0 = s.snapshot();
    expect(s.snapshot()).toBe(snap0);
    const vm = snap0.scenario.inventory.vms[0]!;
    expect(s.dispatch({ type: 'inspect', target: { kind: 'vm', id: vm.id } })).toMatchObject({ ok: true });
    expect(s.snapshot().scenario.selection).toEqual({ kind: 'vm', id: vm.id });
    expect(s.dispatch({ type: 'inspect', target: { kind: 'vm', id: 'nope' } })).toMatchObject({ ok: false, rejection: { reason: 'invalid-input' } });
    expect(s.dispatch({ type: 'inspect', target: null })).toMatchObject({ ok: true });
    expect(s.snapshot().scenario.selection).toBeNull();
    const r2 = snap0.scenario.racks.find((r) => r.instanceId === 'i2')!;
    expect(r2.roomId).not.toBe(snap0.scenario.racks[0]!.roomId);
    expect(s.dispatch({ type: 'camera', roomId: r2.roomId, rackId: r2.rackId })).toMatchObject({ ok: true });
    expect(s.snapshot().scenario.focus).toEqual({ roomId: r2.roomId, rackId: r2.rackId });
    expect(s.dispatch({ type: 'camera', roomId: 'nope' })).toMatchObject({ ok: false });
    // second instance room has the secondary-instance role (06 §2.4)
    expect(s.snapshot().sandbox.site.layout.rooms.find((r) => r.id === r2.roomId)?.role).toBe('secondary-instance');
  });

  it('snapshot shape used by the viewer; deep-frozen', () => {
    const s = session('s3-wld-dedicated-nsx');
    const snap = s.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.scenario.inventory.vms)).toBe(true);
    const sc = snap.scenario;
    expect(Object.keys(sc)).toEqual(expect.arrayContaining(['meta', 'inventory', 'placement', 'totals', 'utilisation', 'issues', 'flows', 'fleet', 'readOnly', 'selection', 'focus']));
    expect(sc.readOnly).toBe(true);
    expect(sc.meta).toMatchObject({ id: 's3-wld-dedicated-nsx', order: 5, scenario: 3, instanceCount: 1, workloadDomainCount: 1, hostCount: 8, profile: 'ha-medium', profileLabel: 'HA Medium' });
    expect(sc.meta.blueprint?.url).toMatch(/^https:\/\/techdocs\.broadcom\.com\//);
    const w = sc.meta.instances[0]!.workloadDomains[0]!;
    expect(w.nsx.kind).toBe('dedicated');
    expect(w.connectivity).toMatchObject({ kind: 'edge', nodes: 2, size: 'Large' });
    expect(sc.meta.notes.some((n) => n.kind === 'game')).toBe(true);
    expect(sc.meta.notes.some((n) => n.kind === 'spec')).toBe(true);
    const vm = sc.inventory.vms.find((v) => v.component === 'vcenter' && v.servesDomainId !== v.domainId)!;
    expect(vm).toMatchObject({ label: 'vCenter', size: 'Medium', vcpu: 8, ramGB: 30 });
    expect(vm.source).not.toBe('');
  });

  it('readOnly: false opens the environment as a lab (Sandbox rules apply)', () => {
    const s = new ScenarioSession('s1-minimal-simple', { readOnly: false });
    expect(s.dispatch({ type: 'buyItem', itemId: 'dell-r670-med' })).toMatchObject({ ok: true });
    expect(s.snapshot().scenario.readOnly).toBe(false);
  });

  it('unknown preset throws', () => {
    expect(() => new ScenarioSession('nope')).toThrow();
  });
});
