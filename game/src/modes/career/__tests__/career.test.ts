import { describe, expect, it } from 'vitest';
import type { CommandResult, SandboxCommand } from '../../sandbox';
import { type CareerEvent, CareerSession, C1_L1, ReplayError, computeScore, evaluateLevel, replayCommands } from '..';
import { SandboxSession, loadObjectiveSet } from '../../sandbox';

const must = (s: CareerSession, cmd: SandboxCommand): CommandResult => {
  const r = s.dispatch(cmd);
  if (!r.ok) throw new Error(`${cmd.type}: ${JSON.stringify(r.rejection)}`);
  return r;
};
const created = (r: CommandResult): string[] => (r.ok ? [...(r.created ?? [])] : []);
const run = (c: CareerSession) => {
  for (let i = 0; i < 100 && c.sandbox.state.tasks.length; i++) c.sandbox.advance(24 * 60 * 60_000);
  expect(c.sandbox.state.tasks).toEqual([]);
};
const WB = C1_L1.workbook;

/** Remaining design decisions of the blueprint that the player decides (not documented by 06 §2.2). Test choices. */
const PLAYER_DESIGN = {
  'wld-nsx-consumption': 'dedicated',
  'wld-network-type': 'ipv4',
  'network-consumption-model': 'vpc',
  'vpc-network-type': 'full-stack',
  'vpc-gateway-connectivity': 'centralized',
  'vcf-automation-placement': 'management-domain',
} as const;

describe('Career – Kampaň 1 Level 1 (UX 25)', () => {
  it('initial state is replayed through the reducer: rack + ToR, component DNS, installer, binaries', () => {
    const c = new CareerSession(C1_L1);
    const snap = c.snapshot();
    const sb = snap.sandbox;
    expect(sb.site.blueprint?.id).toBe('vcf-fleet-single-site');
    expect(sb.physical.racks).toHaveLength(1);
    expect(sb.physical.racks[0]!.tor?.a).toBeDefined();
    expect(sb.physical.companyNetwork?.switchId).toBe(sb.physical.racks[0]!.tor?.a);
    expect(sb.planning.installer.state.mode).not.toBe('not-deployed');
    expect(sb.planning.depot.downloadedCount).toBe(sb.planning.depot.total);
    for (const comp of WB.components) expect(sb.planning.dns.a.some((r) => r.fqdn === comp.fqdn && r.ip === comp.ip)).toBe(true);
    expect(sb.objectives).toMatchObject({ enabled: true, available: true });
    expect(sb.objectives.checklist.active?.id).toBe('l1.servers');
    expect(sb.objectives.checklist.active?.bubble?.text).toMatch(/4/);
    expect(snap.career.budget).toEqual({ total: 80_000, spent: 0, remaining: 80_000, gameCurrency: true });
    expect(snap.career.evaluation.passed).toBe(false);
    expect(snap.career.score).toMatchObject({ points: 0, stars: 0, gameMechanic: true });
    expect(snap.career.score.maxPoints).toBeGreaterThan(0);
    expect(c.objectiveSet.warnings ?? []).toEqual([]);
  });

  it('replay errors name the failing command', () => {
    const s = new SandboxSession();
    expect(() => replayCommands(s, [{ type: 'addDnsRecord', fqdn: 'a.b', ip: 'x' }])).toThrow(ReplayError);
  });

  it('budget (game currency), locked blueprint decisions, hint penalties', () => {
    const c = new CareerSession(C1_L1);
    const lrg = c.dispatch({ type: 'buyItem', itemId: 'dell-r770-lrg', qty: 4 });
    expect(!lrg.ok && lrg.rejection).toMatchObject({ kind: 'flow', reason: 'over-budget' });
    expect(c.sandbox.state.room.physical.servers).toHaveLength(0);
    expect(c.dispatch({ type: 'selectDesignOption', decision: 'deployment-model', option: 'simple' })).toMatchObject({ ok: false, rejection: { reason: 'locked-by-level' } });
    expect(c.dispatch({ type: 'chooseBlueprint', blueprintId: 'vcf-fleet-single-site-minimal-footprint', layoutId: 'small-room' })).toMatchObject({ ok: false, rejection: { reason: 'locked-by-level' } });
    must(c, { type: 'selectDesignOption', decision: 'wld-network-type', option: 'ipv4' });
    const events: CareerEvent[] = [];
    c.subscribe((e) => events.push(e));
    must(c, { type: 'buyItem', itemId: 'dell-r670-med', qty: 4 });
    expect(c.snapshot().career.budget.remaining).toBe(80_000 - c.spent);
    expect(events.some((e) => e.type === 'career/pointsAwarded' && e.objectiveId === 'l1.servers' && e.points === 20)).toBe(true);
    c.useHint('l1.servers', 'show');
    c.useHint('l1.mount', 'solution');
    const score = c.snapshot().career.score;
    expect(score.lines.find((l) => l.objectiveId === 'l1.servers')).toMatchObject({ points: 20, penalty: 2, earned: 18, completed: true });
    expect(score.penalties.hints).toBe(12);
    expect(() => c.useHint('nope', 'show')).toThrow();
  });

  it('score: never below 0 per step, bonus only adds, validation failures booked on the validation step; stars', () => {
    const set = loadObjectiveSet(C1_L1.objectives);
    const all = set.objectives.map((o) => o.id);
    const base = { completed: all, preCompleted: [], hints: {}, failedValidations: 0 };
    const full = computeScore(C1_L1, set, base, true);
    expect(full.stars).toBe(3);
    expect(full.points).toBe(full.maxPoints + full.bonusPoints);
    const bad = computeScore(C1_L1, set, { ...base, failedValidations: 5, hints: { 'l1.mount': { show: 0, solution: 3 } } }, true);
    expect(bad.lines.find((l) => l.objectiveId === 'l1.validation')!.earned).toBe(0);
    expect(bad.lines.find((l) => l.objectiveId === 'l1.mount')!.earned).toBe(0);
    expect(bad.stars).toBeLessThan(3);
    expect(computeScore(C1_L1, set, base, false).stars).toBe(0);
  });

  it('full play-through: servers -> ToR cabling + ports -> ESX via console + batch -> DCUI -> DNS/NTP/cert -> design -> wizard -> bring-up', () => {
    const c = new CareerSession(C1_L1);
    const events: CareerEvent[] = [];
    c.subscribe((e) => events.push(e));
    const sb = () => c.snapshot().sandbox;
    const rack = sb().physical.racks[0]!;
    const tor = rack.tor!.a!;
    const hosts = created(must(c, { type: 'buyItem', itemId: 'dell-r670-med', qty: 4 }));
    for (const h of hosts) must(c, { type: 'mountDevice', inventoryId: h, rackId: rack.id });
    // the wizard's distributed switches need 4 pNICs (validation VDS_UPLINKS_EXCEED_PNICS): second card into slot 2
    for (const h of hosts) must(c, { type: 'addNic', serverId: h, slot: 2, nicPartId: 'nic-dell-cx6lx-25g-2p' });
    hosts.forEach((h, i) => {
      for (let n = 0; n < 4; n++) must(c, { type: 'connectCable', from: { deviceId: h, port: n }, to: { deviceId: tor, port: n * 8 + i } });
    });
    must(c, { type: 'setSwitchPort', switchId: tor, port: Array.from({ length: 48 }, (_, i) => i), config: { mode: 'trunk', vlans: 'all', mtu: 9000 } });
    // ESX: first host in the console, the rest with the same choices
    const h1 = hosts[0]!;
    must(c, { type: 'openConsole', serverId: h1 });
    for (const [k, v] of [['Enter'], ['Enter'], ['Enter', 'boot'], ['Enter'], ['Enter', 'Vmw@re-Lab1x'], ['F11']] as const)
      must(c, { type: 'consoleKey', serverId: h1, key: k, ...(v !== undefined ? { value: v } : {}) });
    run(c);
    must(c, { type: 'installEsxBatch' });
    run(c);
    hosts.forEach((h, i) => {
      const { fqdn, ip } = WB.hosts[i]!;
      must(c, { type: 'configureMgmtNetwork', serverId: h, ip, mask: WB.mask, gw: WB.gateway, vlan: WB.mgmtVlan, dns: [WB.dnsServer], hostname: fqdn });
      must(c, { type: 'addDnsRecord', fqdn, ip });
      must(c, { type: 'configureHostNtp', hostId: h, servers: [WB.ntpServer] });
      must(c, { type: 'setHostSsh', hostId: h, enabled: true });
      must(c, { type: 'regenerateHostCertificate', hostId: h });
      must(c, { type: 'setHostSsh', hostId: h, enabled: false });
    });
    expect(sb().physical.servers.every((x) => x.mgmt.gatewayReachable === true)).toBe(true);
    // design: blueprint choices are pre-selected and locked; the player decides the rest
    for (const [d, o] of Object.entries(PLAYER_DESIGN)) must(c, { type: 'selectDesignOption', decision: d as keyof typeof PLAYER_DESIGN, option: o });
    if (sb().design.gate.unacknowledgedWarnings.length) must(c, { type: 'acknowledgeDesignWarnings' });
    must(c, { type: 'advancePhase' });
    must(c, { type: 'advancePhase' });
    expect(sb().phase).toBe('deploy');
    const spec = c.sandbox.state.spec;
    const comp = (role: string) => WB.components.find((x) => x.role === role)!.fqdn;
    const net = (vlan: number, third: number, last: number) => ({ vlanId: vlan, cidr: `10.0.${third}.0/24`, gateway: `10.0.${third}.1`, mtu: 9000, inclusionRanges: [{ kind: 'range' as const, start: `10.0.${third}.10`, end: `10.0.${third}.${last}` }] });
    must(c, { type: 'setWizardSection', section: 'general', value: { ...spec.general, instanceName: 'firma-m01', managementDomainName: 'firma-m01', dnsServers: [WB.dnsServer], ntpServers: [WB.ntpServer], ceip: false, autogeneratePasswords: true } });
    must(c, { type: 'setWizardSection', section: 'esxHosts', value: WB.hosts.map((h) => ({ fqdn: h.fqdn })) });
    must(c, {
      type: 'setWizardSection',
      section: 'networks',
      value: {
        esxManagement: { vlanId: WB.mgmtVlan!, cidr: '10.0.0.0/24', gateway: WB.gateway },
        managementServicesIpPool: { kind: 'range', start: '10.0.1.10', end: '10.0.1.39' },
        vcfAutomationIpPool: { kind: 'range', start: '10.0.1.100', end: '10.0.1.104' },
        vmotion: net(1611, 2, 30),
        storage: net(1612, 3, 30),
        nsxHostOverlay: net(1613, 4, 40),
      },
    });
    must(c, {
      type: 'setWizardSection',
      section: 'components',
      value: {
        vcfOperationsPrimaryFqdn: comp('VCF Operations primary'),
        vcfOperationsReplicaFqdn: comp('VCF Operations replica'),
        vcfOperationsDataFqdn: comp('VCF Operations data'),
        cloudProxyFqdn: comp('VCF Operations cloud proxy'),
        licenseServerFqdn: comp('License server'),
        fleetComponentsFqdn: comp('Fleet components'),
        instanceComponentsFqdn: comp('Instance components'),
        identityBrokerFqdn: comp('Identity Broker'),
        servicesRuntimeFqdn: comp('Services runtime'),
        internalClusterCidrIpv4: '198.18.0.0/15',
        vcfAutomationFqdn: comp('VCF Automation'),
        vcfAutomationServicesRuntimeFqdn: comp('VCF Automation services runtime'),
      },
    });
    must(c, { type: 'setWizardSection', section: 'vcenter', value: { fqdn: comp('vCenter') } });
    must(c, { type: 'setWizardSection', section: 'storageDetails', value: { datastoreName: 'firma-m01-cl01-ds-vsan01' } });
    must(c, { type: 'setWizardSection', section: 'nsx', value: { ...spec.nsx, nodeFqdns: [comp('NSX Manager node A'), comp('NSX Manager node B'), comp('NSX Manager node C')], vipFqdn: comp('NSX Manager VIP') } });
    must(c, { type: 'setWizardSection', section: 'sddcManager', value: { fqdn: comp('SDDC Manager') } });
    expect(sb().objectives.doneIds).toContain('l1.wizard');
    must(c, { type: 'submitForReview' });
    must(c, { type: 'startValidation' });
    run(c);
    const st = sb().deploy.deployment.status;
    if (st === 'validation-failed') throw new Error(JSON.stringify(sb().deploy.validationResult.errors.map((i) => `${i.code}: ${i.message}`)));
    if (st === 'awaiting-acknowledgement') must(c, { type: 'acknowledgeDeploymentWarnings' });
    must(c, { type: 'deploy' });
    run(c);
    const snap = c.snapshot();
    expect(snap.career.evaluation.criteria.filter((x) => !x.ok)).toEqual([]);
    expect(snap.career.evaluation.passed).toBe(true);
    expect(snap.career.completed).toBe(true);
    expect(snap.career.score.stars).toBeGreaterThanOrEqual(1);
    expect(snap.career.score.points).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === 'career/levelCompleted')).toHaveLength(1);
    expect(evaluateLevel(snap.sandbox, C1_L1).passed).toBe(true);
  });
});
