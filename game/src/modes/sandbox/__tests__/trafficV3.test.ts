import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../../engine';
import { ILLUSTRATIVE_LOAD_GBPS, SCENARIO_PRESETS, type Cable, type TrafficFlow } from '../../../model';
import { ScenarioSession } from '../../scenarios';
import { SandboxSession } from '../session';
import {
  DemoVolumeSampler,
  FlowVolumeSampler,
  ILLUSTRATIVE_BREATHING_AMPLITUDE,
  type LinkVolumeView,
  breatheLinkVolume,
  breathingFactor,
  cableDirections,
  rackVolumesOf,
} from '../trafficV3';
import type { CommandResult, SandboxEvent } from '../types';
import { must } from './workbook';

const created = (r: CommandResult): string[] => (r.ok ? [...(r.created ?? [])] : []);
const FAST = { 'esx-install': 1000, 'mgmt-network-test': 1000 } as const;
const session = (autoBmc = false) => new SandboxSession({ taskDurationsMs: FAST, autoBmc, objectives: false });
const run = (s: SandboxSession) => {
  for (let i = 0; i < 10 && s.state.tasks.length; i++) s.advance(60_000);
};
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

/** Rack + 25G switch + n hosts, cabled vmnic0 -> port i, company network on the switch. */
function room(s: SandboxSession, n = 2) {
  const rack = created(must(s, { type: 'placeRack', itemId: 'rack-generic-42u', tile: { gx: 2, gy: 3 } }))[0]!;
  const sw = created(must(s, { type: 'buyItem', itemId: 'sw-generic-48x25g' }))[0]!;
  must(s, { type: 'mountDevice', inventoryId: sw, rackId: rack, u: 42 });
  const hosts = created(must(s, { type: 'buyItem', itemId: 'dell-r670-med', qty: n }));
  for (const h of hosts) must(s, { type: 'mountDevice', deviceId: h, rackId: rack });
  return { rack, sw, hosts };
}

/** Hosts online with static management IP + NTP on host 0 (steady management flows incl. one-way NTP). */
function online(s: SandboxSession, n = 2) {
  const r = room(s, n);
  r.hosts.forEach((h, i) => must(s, { type: 'connectCable', from: { deviceId: h, port: 0 }, to: { deviceId: r.sw, port: i } }));
  must(s, { type: 'connectCompanyNetwork', switchId: r.sw });
  for (const h of r.hosts) must(s, { type: 'installEsx', serverId: h, method: 'physical' });
  run(s);
  r.hosts.forEach((h, i) =>
    must(s, { type: 'configureMgmtNetwork', serverId: h, ip: `10.0.0.${11 + i}`, mask: '255.255.255.0', gw: '10.0.0.1', dns: ['10.0.0.53'], hostname: `esx0${i + 1}.lab.example` }),
  );
  must(s, { type: 'configureHostNtp', hostId: r.hosts[0]!, servers: ['10.0.0.123'] });
  return r;
}

describe('Provoz v3 – E-T1 per-link, per-direction, per-class volumes', () => {
  it('cableDirections follows the ordered hops (from -> to) on both ends of a switch', () => {
    const cables = new Map<string, Cable>([
      ['c1', { id: 'c1', a: { kind: 'server-nic', serverId: 'h1', vmnic: 0 }, b: { kind: 'switch', switchId: 'sw', port: 0 } }],
      ['c2', { id: 'c2', a: { kind: 'switch', switchId: 'sw', port: 1 }, b: { kind: 'server-nic', serverId: 'h2', vmnic: 0 } }],
      ['c3', { id: 'c3', a: { kind: 'server-nic', serverId: 'h3', vmnic: 0 }, b: { kind: 'switch', switchId: 'sw', port: 2 } }],
    ]);
    const hops: TrafficFlow['hops'] = [{ kind: 'cable', cableId: 'c1' }, { kind: 'switch', switchId: 'sw' }, { kind: 'cable', cableId: 'c2' }];
    expect([...cableDirections(cables, { hops })].map(([id, d]) => [id, [...d]])).toEqual([['c1', ['ab']], ['c2', ['ab']]]);
    const back: TrafficFlow['hops'] = [{ kind: 'cable', cableId: 'c2' }, { kind: 'switch', switchId: 'sw' }, { kind: 'cable', cableId: 'c3' }];
    expect([...cableDirections(cables, { hops: back })].map(([id, d]) => [id, [...d]])).toEqual([['c2', ['ba']], ['c3', ['ba']]]);
  });

  it('linkVolumes: one entry per cable, totals equal the model aggregate, one-way NTP only in its direction', () => {
    const s = session();
    const { sw, hosts } = online(s);
    const f = s.snapshot().flows;
    expect(f.linkVolumes.map((l) => l.cableId)).toEqual(f.links.map((l) => l.cableId));
    for (const l of f.linkVolumes) {
      const m = f.links.find((x) => x.cableId === l.cableId)!;
      close(l.totalGbps, m.totalLoadGbps);
      close(l.abGbps + l.baGbps, l.totalGbps);
      close(l.utilization, m.utilization);
      expect(l.illustrative).toBe(true);
    }
    const ntp = f.flows.find((x) => x.id === `ntp:${hosts[0]}:corp-ntp`)!;
    expect(ntp.bidirectional).toBe(false);
    const l0 = f.linkVolumes.find((l) => l.cableId === ntp.cableIds[0])!;
    expect(l0).toMatchObject({ kind: 'host-data', up: true, speedGbE: 25 });
    const hostIsA = l0.aDeviceId === hosts[0];
    expect(hostIsA ? l0.bDeviceId : l0.aDeviceId).toBe(sw);
    const m = l0.byClass.management!;
    // two-way flows are split half / half; the one-way NTP flow travels host -> switch only
    close((hostIsA ? m.ab - m.ba : m.ba - m.ab), ILLUSTRATIVE_LOAD_GBPS['ntp']!);
    expect(l0.flowIds).toContain(ntp.id);
    expect(l0.vcfGbps).toBeGreaterThan(0);
    expect(l0.gameScopeOnly).toBe(false);
  });

  it('attachmentVolumes: Síť firmy port carries the endpoint traffic, NTP outward', () => {
    const s = session();
    const { sw, hosts } = online(s);
    const att = s.snapshot().flows.attachmentVolumes.find((a) => a.companyNetwork)!;
    expect(att).toMatchObject({ switchId: sw, companyNetwork: true, illustrative: true, gameScopeOnly: false });
    expect(att.endpointIds).toContain('corp-ntp');
    expect(att.flowIds).toContain(`ntp:${hosts[0]}:corp-ntp`);
    const m = att.byClass.management!;
    close(m.ab - m.ba, ILLUSTRATIVE_LOAD_GBPS['ntp']!);
  });

  it('BMC cables carry only oob (gameScopeOnly, vcfGbps 0) and never count in rack / device Gb/s', () => {
    const s = session(true);
    const { rack, hosts } = room(s, 1);
    const f = s.snapshot().flows;
    const bmc = f.linkVolumes.find((l) => l.kind === 'bmc' && (l.aDeviceId === hosts[0] || l.bDeviceId === hosts[0]))!;
    expect(bmc.byClass.oob!.total).toBeGreaterThan(0);
    expect(bmc).toMatchObject({ gameScopeOnly: true, vcfGbps: 0 });
    const rv = f.rackVolumes.find((r) => r.rackId === rack)!;
    expect(rv.internalGbps + rv.externalGbps).toBe(0);
    expect(rv.bmcCables).toBeGreaterThan(0);
    expect(f.deviceVolumes.find((d) => d.deviceId === hosts[0])?.totalGbps ?? 0).toBe(0);
  });
});

describe('Provoz v3 – E-T4 device -> rack, flow -> endpoints', () => {
  it('maps devices to racks and resolves flow ends (switch-port endpoint behind Síť firmy, server)', () => {
    const s = session();
    const { rack, sw, hosts } = online(s);
    const f = s.snapshot().flows;
    expect(f.deviceRacks).toMatchObject({ [sw]: rack, [hosts[0]!]: rack, [hosts[1]!]: rack });
    const hc = f.flowEnds.find((e) => e.flowId === `hostclient:admin-ws:${hosts[0]}`)!;
    expect(hc.from).toMatchObject({ node: { kind: 'endpoint', id: 'admin-ws' }, deviceId: sw, rackId: rack, via: 'switch-port', companyNetwork: true });
    expect(hc.to).toMatchObject({ node: { kind: 'server', id: hosts[0] }, deviceId: hosts[0], rackId: rack, via: 'device', companyNetwork: false });
    expect(hc).toMatchObject({ switchIds: [sw], rackIds: [rack], sameRack: true, trafficClass: 'management', gameScope: false });
    expect(f.flowEnds).toHaveLength(f.flows.length);
  });

  it('rack / device aggregates: in-rack traffic is internal, per device sums exclude oob', () => {
    const s = session();
    const { rack, hosts } = online(s);
    const f = s.snapshot().flows;
    const rv = f.rackVolumes.find((r) => r.rackId === rack)!;
    expect(rv.internalGbps).toBeGreaterThan(0);
    expect(rv.externalGbps).toBe(0);
    const d0 = f.deviceVolumes.find((d) => d.deviceId === hosts[0])!;
    close(d0.totalGbps, f.linkVolumes.filter((l) => l.aDeviceId === hosts[0] || l.bDeviceId === hosts[0]).reduce((x, l) => x + l.vcfGbps, 0));
    // pure helper: cable across two racks counts as external on both
    const l = { ...f.linkVolumes.find((x) => x.vcfGbps > 0)! };
    const split = rackVolumesOf([l], { [l.aDeviceId]: 'r1', [l.bDeviceId]: 'r2' });
    expect(split.map((r) => [r.rackId, r.internalGbps, r.externalGbps])).toEqual([['r1', 0, l.vcfGbps], ['r2', 0, l.vcfGbps]]);
  });
});

describe('Provoz v3 – E-T2 trafficRevision', () => {
  it('bumps only when the traffic picture changes', () => {
    const s = session();
    const { sw, hosts } = room(s, 1);
    const r0 = s.snapshot().trafficRevision;
    must(s, { type: 'buyItem', itemId: 'dell-r670-med' });
    expect(s.snapshot().trafficRevision).toBe(r0);
    expect(s.snapshot().revision).toBeGreaterThan(0);
    must(s, { type: 'connectCable', from: { deviceId: hosts[0]!, port: 0 }, to: { deviceId: sw, port: 0 } });
    const r1 = s.snapshot().trafficRevision;
    expect(r1).toBe(r0 + 1);
    must(s, { type: 'connectCompanyNetwork', switchId: sw });
    must(s, { type: 'installEsx', serverId: hosts[0]!, method: 'physical' });
    const r2 = s.snapshot().trafficRevision;
    s.advance(100); // progress only
    expect(s.snapshot().trafficRevision).toBe(r2);
    run(s); // ESX installed -> DHCP flow appears
    expect(s.snapshot().trafficRevision).toBeGreaterThan(r2);
  });
});

describe('Provoz v3 – E-T3 activities with timing', () => {
  it('DCUI test: activity with startedAt, duration, progress and its flows; TaskView.startedAtMs', () => {
    const engine = new GameEngine();
    const s = session();
    s.attachTo(engine);
    const { hosts } = online(s);
    engine.setSpeed(1);
    engine.tick(5000);
    must(s, { type: 'testManagementNetwork', serverId: hosts[0]! });
    const a = s.snapshot().trafficActivities;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'dcui-test-management-network', taskKind: 'mgmt-network-test', serverId: hosts[0], durationMs: 1000, progress: 0, illustrativeDuration: true, gameScope: false });
    expect(a[0]!.startedAtMs).toBe(s.timeMs);
    expect(s.snapshot().tasks[0]!.startedAtMs).toBe(a[0]!.startedAtMs);
    expect(a[0]!.flowIds.length).toBeGreaterThan(0);
    expect(a[0]!.flowIds.every((id) => id.startsWith('dcui-'))).toBe(true);
    expect(a[0]!.cableIds.length).toBeGreaterThan(0);
    engine.tick(500);
    expect(s.snapshot().trafficActivities[0]!.progress).toBeCloseTo(0.5);
    engine.tick(600);
    expect(s.snapshot().trafficActivities).toEqual([]);
  });

  it('ESX install over BMC = game-scope iso-transfer on the BMC cable; physical install = none', () => {
    const s = session(true);
    const { hosts } = room(s, 2);
    must(s, { type: 'installEsx', serverId: hosts[0]!, method: 'bmc' });
    must(s, { type: 'installEsx', serverId: hosts[1]!, method: 'physical' });
    const a = s.snapshot().trafficActivities;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'iso-transfer', serverId: hosts[0], gameScope: true, flowIds: [] });
    const bmcCable = s.state.room.physical.cables.find((c) => c.a.kind === 'server-bmc' && c.a.serverId === hosts[0] || c.b.kind === 'server-bmc' && c.b.serverId === hosts[0])!;
    expect(a[0]!.cableIds).toEqual([bmcCable.id]);
  });
});

describe('Provoz v3 – E-T5 link up / down events', () => {
  it('emits sandbox/linkUp with cable / port ids, linkDown on disconnect, nothing for a link without common speed', () => {
    const s = session();
    const { sw, hosts } = room(s, 1);
    const ev: SandboxEvent[] = [];
    s.subscribe((e) => ev.push(e));
    const links = () => ev.filter((e) => e.type === 'sandbox/linkUp' || e.type === 'sandbox/linkDown');
    // 1 GbE BMC port vs 25G switch: no common speed -> no link up
    must(s, { type: 'connectCable', from: { deviceId: hosts[0]!, port: 'bmc' }, to: { deviceId: sw, port: 10 } });
    expect(links()).toEqual([]);
    must(s, { type: 'connectCable', from: { deviceId: hosts[0]!, port: 0 }, to: { deviceId: sw, port: 0 } });
    const up = links();
    expect(up).toHaveLength(1);
    const cable = s.state.room.physical.cables.find((c) => c.a.kind === 'server-nic' || c.b.kind === 'server-nic')!;
    expect(up[0]).toMatchObject({ type: 'sandbox/linkUp', cableId: cable.id, a: cable.a, b: cable.b, speedGbE: 25 });
    expect(new Set([(up[0] as { aDeviceId: string }).aDeviceId, (up[0] as { bDeviceId: string }).bDeviceId])).toEqual(new Set([hosts[0], sw]));
    must(s, { type: 'disconnectCable', cableId: cable.id });
    expect(links()[1]).toMatchObject({ type: 'sandbox/linkDown', cableId: cable.id });
  });
});

describe('Provoz v3 – E-T7 breathing and E-T6 samplers', () => {
  const link = (over: Partial<LinkVolumeView> = {}): LinkVolumeView => ({
    cableId: 'c1',
    a: { kind: 'server-nic', serverId: 'h1', vmnic: 0 },
    b: { kind: 'switch', switchId: 'sw', port: 0 },
    aDeviceId: 'h1',
    bDeviceId: 'sw',
    kind: 'host-data',
    up: true,
    speedGbE: 25,
    byClass: { vsan: { ab: 2, ba: 2, total: 4 }, oob: { ab: 0.005, ba: 0.005, total: 0.01 } },
    abGbps: 2.005,
    baGbps: 2.005,
    totalGbps: 4.01,
    vcfGbps: 4,
    utilization: 4.01 / 25,
    peakDirectionUtilization: 2.005 / 25,
    flowIds: ['f'],
    gameScopeOnly: false,
    illustrative: true,
    ...over,
  });

  it('breathing is deterministic, within ±10 %, keeps oob and idle links', () => {
    expect(ILLUSTRATIVE_BREATHING_AMPLITUDE).toBe(0.1);
    for (let t = 0; t < 60_000; t += 1234) {
      const k = breathingFactor('c1', 'vsan', t);
      expect(k).toBeGreaterThanOrEqual(0.9);
      expect(k).toBeLessThanOrEqual(1.1);
      expect(breathingFactor('c1', 'vsan', t)).toBe(k);
    }
    expect(breathingFactor('c1', 'vsan', 0, 5)).toBeLessThanOrEqual(1.1); // amplitude capped
    const b = breatheLinkVolume(link(), 7000);
    expect(b.variation).toBe('breathing');
    expect(b.byClass.oob).toEqual({ ab: 0.005, ba: 0.005, total: 0.01 });
    close(b.byClass.vsan!.total, 4 * breathingFactor('c1', 'vsan', 7000));
    close(b.utilization, b.totalGbps / 25);
    const idle = link({ byClass: {}, vcfGbps: 0, totalGbps: 0, abGbps: 0, baGbps: 0 });
    expect(breatheLinkVolume(idle, 7000)).toBe(idle);
  });

  it('FlowVolumeSampler: static by default, breathing on request (cached per game time)', () => {
    const l = link();
    const st = new FlowVolumeSampler([l]);
    expect(st.sample(0).get('c1')).toBe(l);
    expect(st.sample(9999)).toBe(st.sample(0));
    const br = new FlowVolumeSampler([l], { breathing: true });
    const s1 = br.sample(3000);
    expect(br.sample(3000)).toBe(s1);
    const values = [0, 2000, 4000, 6000].map((t) => br.sample(t).get('c1')!.vcfGbps);
    expect(new Set(values).size).toBeGreaterThan(1);
    expect(br.illustrative).toBe(true);
    expect(br.demo).toBe(false);
  });

  it('DemoVolumeSampler: illustrative demo through the same contract (room + rack), oob of the base kept', () => {
    const base = link({ byClass: { oob: { ab: 0.005, ba: 0.005, total: 0.01 } }, vcfGbps: 0, totalGbps: 0.01, abGbps: 0.005, baGbps: 0.005, gameScopeOnly: true });
    const d = new DemoVolumeSampler(
      [
        { cableId: 'c1', trafficClass: 'vsan', mean: 5, amp: 0, periodS: 10 },
        { cableId: 'c1', trafficClass: 'management', mean: 1, amp: 0, periodS: 10, direction: 'ab' },
        { cableId: 'x9', trafficClass: 'vmotion', mean: 2, amp: 0, periodS: 10, burst: { cycleS: 20, from: 5, to: 15, gbps: 10 } },
      ],
      [base],
    );
    const m = d.sample(1000);
    const c1 = m.get('c1')!;
    expect(c1).toMatchObject({ variation: 'demo', illustrative: true, speedGbE: 25, gameScopeOnly: false });
    expect(c1.byClass.vsan).toEqual({ ab: 2.5, ba: 2.5, total: 5 });
    expect(c1.byClass.management).toEqual({ ab: 1, ba: 0, total: 1 });
    expect(c1.byClass.oob).toEqual(base.byClass.oob);
    close(c1.vcfGbps, 6);
    const x9 = m.get('x9')!;
    expect(x9.speedGbE).toBe(10);
    expect(x9.byClass.vmotion!.total).toBe(2);
    expect(d.sample(10_000).get('x9')!.byClass.vmotion!.total).toBeGreaterThan(2); // burst window
    expect(d.sample(1000)).toBe(d.sample(1000));
    expect(d.demo).toBe(true);
  });
});

describe('Provoz v3 – scenario sessions', () => {
  it('scenario flows carry the same v3 data; heartbeats travel host -> vCenter', () => {
    const sc = new ScenarioSession(SCENARIO_PRESETS[0]!.id);
    const f = sc.snapshot().scenario.flows;
    expect(f.linkVolumes.length).toBe(f.links.length);
    for (const l of f.linkVolumes) close(l.totalGbps, f.links.find((x) => x.cableId === l.cableId)!.totalLoadGbps);
    expect(f.flowEnds.some((e) => e.to.via === 'host-vm' || e.from.via === 'host-vm')).toBe(true);
    expect(Object.keys(f.deviceRacks).length).toBeGreaterThan(0);
    expect(f.rackVolumes.some((r) => r.internalGbps > 0)).toBe(true);
    const hb = f.flows.filter((x) => x.id.startsWith('hb:') && x.cableIds.length > 0);
    expect(hb.length).toBeGreaterThan(0);
    for (const x of hb) {
      expect(x.from.kind).toBe('server');
      expect(x.fromPort && 'serverId' in x.fromPort ? x.fromPort.serverId : undefined).toBe(x.from.id);
    }
    expect(sc.snapshot().sandbox.trafficRevision).toBe(sc.snapshot().sandbox.trafficRevision);
  });
});
