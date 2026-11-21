import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../../engine';
import { VCF_BINARIES } from '../../../model';
import { SandboxSession } from '../session';
import type { SandboxEvent } from '../types';
import {
  FQDN,
  HA_PRODUCTION,
  MINIMAL_FOOTPRINT,
  completeDesign,
  fillWizard,
  hostFqdn,
  must,
  preparePlanning,
  runUntilIdle,
} from './workbook';

const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

describe('Sandbox – design gate', () => {
  it('blocks leaving the design phase while decisions are missing (model errors)', () => {
    const s = new SandboxSession();
    const r = s.advancePhase();
    expect(r.ok).toBe(false);
    if (r.ok || r.rejection.kind !== 'gate') throw new Error('expected gate rejection');
    expect(r.rejection.target).toBe('planning');
    expect(codes(r.rejection.errors)).toContain('DESIGN_DECISION_MISSING');
    expect(s.snapshot().phase).toBe('design');
    expect(s.snapshot().phases.find((p) => p.id === 'planning')?.enterable).toBe(false);
  });

  it('marks unavailable options with model reasons and sources', () => {
    const s = new SandboxSession({ initialChoices: MINIMAL_FOOTPRINT });
    const d = s.snapshot().design.decisions.find((x) => x.id === 'mgmt-cluster-model')!;
    const l3 = d.options.find((o) => o.id === 'multi-rack-l3')!;
    expect(l3.available).toBe(false);
    expect(codes(l3.errors)).toEqual(['MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED']);
    expect(d.sources.every((x) => x.url.startsWith('https://'))).toBe(true);
    // UI DesignStepData shape: disabledReason carries the model message.
    const stepOpt = s.snapshot().design.stepData.decisions.find((x) => x.id === 'mgmt-cluster-model')!.options.find((o) => o.id === 'multi-rack-l3')!;
    expect(stepOpt.disabledReason).toBe(l3.errors[0]!.message);
    // Workload-domain decisions are not applicable when workloads stay in the management domain.
    expect(s.snapshot().design.decisions.some((x) => x.id === 'wld-cluster-model')).toBe(false);
  });

  it('error choice blocks, RCMD warning needs acknowledgement, then planning opens', () => {
    const s = new SandboxSession();
    for (const [k, v] of Object.entries({ ...MINIMAL_FOOTPRINT, 'mgmt-cluster-model': 'multi-rack-l3' }))
      must(s, { type: 'selectDesignOption', decision: k as keyof typeof MINIMAL_FOOTPRINT, option: v! });
    let r = s.advancePhase();
    expect(!r.ok && r.rejection.kind === 'gate' && codes(r.rejection.errors)).toEqual(['MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED']);
    expect(s.snapshot().design.derived).toBeUndefined();

    must(s, { type: 'selectDesignOption', decision: 'mgmt-cluster-model', option: 'single-rack' });
    r = s.advancePhase();
    if (r.ok || r.rejection.kind !== 'gate') throw new Error('expected gate rejection');
    expect(r.rejection.errors).toEqual([]);
    expect(codes(r.rejection.unacknowledgedWarnings)).toEqual(['DESIGN_WORKLOADS_IN_MGMT_DOMAIN']);
    const w = s.snapshot().design.warnings;
    expect(w.map((x) => x.acknowledged)).toEqual([false]);

    must(s, { type: 'acknowledgeDesignWarnings', keys: [w[0]!.key] });
    expect(s.snapshot().design.warnings[0]!.acknowledged).toBe(true);
    expect(s.advancePhase().ok).toBe(true);
    expect(s.snapshot().phase).toBe('planning');
  });

  it('design changes are only possible in the design phase; acks are pruned when the warning disappears', () => {
    const s = new SandboxSession();
    completeDesign(s, MINIMAL_FOOTPRINT);
    const r = s.selectDesignOption('deployment-model', 'high-availability');
    expect(!r.ok && r.rejection.kind === 'flow' && r.rejection.reason).toBe('wrong-phase');
    must(s, { type: 'goBack' });
    must(s, { type: 'selectDesignOption', decision: 'workload-placement', option: 'workload-domain' });
    expect(s.state.acknowledgedDesignWarnings).toEqual([]);
  });

  it('prefills the wizard from deriveBringupParams and re-derives on design change', () => {
    const s = new SandboxSession();
    completeDesign(s, MINIMAL_FOOTPRINT);
    let spec = s.snapshot().deploy.spec;
    expect([spec.model, spec.size, spec.storage.type, spec.vds.profile, spec.nsx.nodeFqdns.length]).toEqual(['simple', 'small', 'vsan-esa', 'default', 1]);
    must(s, { type: 'goBack' });
    must(s, { type: 'selectDesignOption', decision: 'deployment-model', option: 'high-availability' });
    must(s, { type: 'selectDesignOption', decision: 'vcf-operations-model', option: 'high-availability' });
    must(s, { type: 'selectDesignOption', decision: 'vcf-automation-model', option: 'high-availability' });
    must(s, { type: 'selectDesignOption', decision: 'principal-storage', option: 'nfs-v3' });
    spec = s.snapshot().deploy.spec;
    expect([spec.model, spec.storage.type, spec.nsx.nodeFqdns.length]).toEqual(['high-availability', 'nfs-v3', 3]);
    expect(s.snapshot().planning.hostCount.minimum).toBe(4);
  });
});

describe('Sandbox – happy path Simple minimal footprint', () => {
  it('goes from design (warning ack) through planning and bring-up to a Fleet', () => {
    const s = new SandboxSession();
    const events: SandboxEvent[] = [];
    s.subscribe((e) => events.push(e));

    completeDesign(s, MINIMAL_FOOTPRINT);
    // Deploy phase needs a deployed installer (model validateInstallerCanDeploy).
    const early = s.advancePhase();
    expect(!early.ok && early.rejection.kind === 'gate' && codes(early.rejection.errors)).toEqual(['INSTALLER_NOT_DEPLOYED']);

    preparePlanning(s, { hosts: 3, pnics: 2 });
    const plan = s.snapshot().planning;
    expect(plan.issues.errors).toEqual([]);
    expect(plan.depot.downloadedCount).toBe(VCF_BINARIES.length);
    expect(plan.hostCount).toMatchObject({ count: 3, readyCount: 3, minimum: 3 });
    expect(plan.hosts.every((h) => h.steps.certificateMatchesFqdn && h.ready)).toBe(true);

    must(s, { type: 'advancePhase' });
    expect(s.snapshot().deploy.spec.general.dnsDomainName).toBe('lab.vcfhra.cz'); // prefilled from installer
    fillWizard(s, { hosts: 3, servicesIps: 20 });
    // Design-locked field cannot be changed in the wizard.
    const locked = s.dispatch({ type: 'setWizardSection', section: 'model', value: 'high-availability' });
    expect(!locked.ok && locked.rejection.kind === 'flow' && locked.rejection.reason).toBe('design-locked-field');

    const live = s.snapshot().deploy;
    expect(live.liveIssues.errors).toEqual([]);
    // 20 IPs < recommended 30: the model reports a documented recommendation (not an installer warning).
    expect(live.steps.find((x) => x.step === 'network-details')?.status).toBe('recommendation');

    must(s, { type: 'submitForReview' });
    // Deploy before validation is an illegal state-machine transition (model).
    const tooEarly = s.dispatch({ type: 'deploy' });
    expect(!tooEarly.ok && tooEarly.rejection.kind === 'validation' && codes(tooEarly.rejection.issues)).toEqual(['ILLEGAL_DEPLOYMENT_TRANSITION']);
    must(s, { type: 'startValidation' });
    expect(s.snapshot().deploy.deployment.status).toBe('validating');
    expect(s.snapshot().deploy.validationTask?.illustrativeDuration).toBe(true);
    runUntilIdle(s);
    // A recommendation never requires Acknowledge (model state machine).
    expect(s.snapshot().deploy.deployment.status).toBe('ready-to-deploy');
    expect(codes(s.snapshot().deploy.validationResult.recommendations)).toEqual(['SERVICES_RUNTIME_IPS_BELOW_RECOMMENDED']);

    must(s, { type: 'deploy' });
    expect(s.snapshot().deploy.deploymentTask?.progress).toBe(0);
    runUntilIdle(s);

    const snap = s.snapshot();
    expect(snap.deploy.deployment.status).toBe('completed');
    const fleet = snap.fleet!;
    expect(fleet.instances).toHaveLength(1);
    const mgmt = fleet.instances[0]!.managementDomain;
    expect(mgmt.name).toBe('lab-m01');
    expect(mgmt.nsx).toMatchObject({ model: 'simple' });
    expect(mgmt.clusters[0]!.hosts.map((h) => h.fqdn)).toEqual([0, 1, 2].map((i) => hostFqdn(i)[0]));
    expect(snap.design.deployedChoices).toEqual(MINIMAL_FOOTPRINT);
    expect(events.some((e) => e.type === 'sandbox/fleetCreated')).toBe(true);
    expect(events.filter((e) => e.type === 'sandbox/phaseChanged').map((e) => (e.type === 'sandbox/phaseChanged' ? e.to : ''))).toEqual(['planning', 'deploy']);

    // After bring-up: principal storage is immutable (model validateRedesign), wizard is closed.
    must(s, { type: 'goBack' });
    must(s, { type: 'goBack' });
    const re = s.selectDesignOption('principal-storage', 'vsan-osa');
    expect(!re.ok && re.rejection.kind === 'validation' && codes(re.rejection.issues)).toEqual(['DESIGN_PRINCIPAL_STORAGE_IMMUTABLE']);
    const storageOpt = s.snapshot().design.decisions.find((d) => d.id === 'principal-storage')!.options.find((o) => o.id === 'vsan-osa')!;
    expect(codes(storageOpt.errors)).toContain('DESIGN_PRINCIPAL_STORAGE_IMMUTABLE');
    must(s, { type: 'advancePhase' });
    must(s, { type: 'advancePhase' });
    const edit = s.dispatch({ type: 'setWizardSection', section: 'vcenter', value: { fqdn: 'x.lab.vcfhra.cz' } });
    expect(!edit.ok && edit.rejection.kind === 'flow' && edit.rejection.reason).toBe('deployment-completed');
  });
});

describe('Sandbox – HA production path', () => {
  it('deploys an HA fleet with storage separation and distributed VPC connectivity', () => {
    const s = new SandboxSession();
    completeDesign(s, HA_PRODUCTION);
    expect(s.snapshot().deploy.spec.vds.switches).toHaveLength(2);
    preparePlanning(s, { hosts: 4, pnics: 4 });
    must(s, { type: 'advancePhase' });
    fillWizard(s, { hosts: 4, servicesIps: 30 });
    // Distributed connectivity requires VLAN + gateway CIDR on the NSX page (model check).
    expect(codes(s.snapshot().deploy.steps.find((x) => x.step === 'nsx-manager-details')!.issues)).toEqual(['NSX_DISTRIBUTED_CONNECTIVITY_MISSING']);
    must(s, { type: 'setWizardSection', section: 'nsx', value: { ...s.state.spec.nsx, distributedConnectivity: { vlanId: 1620, gatewayCidrIpv4: '10.20.9.1/24' } } });
    expect(s.snapshot().deploy.liveIssues).toEqual({ errors: [], warnings: [], recommendations: [], gameScope: [] });

    must(s, { type: 'submitForReview' });
    must(s, { type: 'startValidation' });
    runUntilIdle(s);
    expect(s.snapshot().deploy.deployment.status).toBe('ready-to-deploy');
    must(s, { type: 'deploy' });
    runUntilIdle(s);
    const mgmt = s.snapshot().fleet!.instances[0]!.managementDomain;
    expect(mgmt.nsx).toMatchObject({ model: 'high-availability' });
    expect(mgmt.components.find((c) => c.kind === 'vcf-operations')?.nodes).toBe(3);
    expect(mgmt.clusters[0]!.distributedSwitchCount).toBe(2);
  });
});

describe('Sandbox – error paths', () => {
  it('too few hosts for HA: planning shows the model error and validation blocks deploy', () => {
    const s = new SandboxSession();
    completeDesign(s, HA_PRODUCTION);
    preparePlanning(s, { hosts: 3, pnics: 4 });
    expect(codes(s.snapshot().planning.hostCount.issues.errors)).toEqual(['MGMT_DOMAIN_TOO_FEW_HOSTS']);
    must(s, { type: 'advancePhase' });
    fillWizard(s, { hosts: 3, servicesIps: 30 });
    must(s, { type: 'setWizardSection', section: 'nsx', value: { ...s.state.spec.nsx, distributedConnectivity: { vlanId: 1620, gatewayCidrIpv4: '10.20.9.1/24' } } });
    must(s, { type: 'submitForReview' });
    must(s, { type: 'startValidation' });
    runUntilIdle(s);
    expect(s.snapshot().deploy.deployment.status).toBe('validation-failed');
    expect(codes(s.snapshot().deploy.validationResult.errors)).toContain('MGMT_DOMAIN_TOO_FEW_HOSTS');
    expect(s.dispatch({ type: 'deploy' }).ok).toBe(false);

    // Unlimited resources: add a 4th host, prepare it and re-validate.
    const [fqdn, ip] = hostFqdn(3);
    must(s, { type: 'addDnsRecord', fqdn, ip });
    must(s, { type: 'addHost', hw: { hwVendor: 'Vendor A (herní)', hwProfileId: 'hw-a', pnicCount: 4 } });
    const id = s.state.env.hosts[3]!.id;
    must(s, { type: 'installEsx', hostId: id, version: 'esx-per-release-notes' });
    must(s, { type: 'configureHostNetwork', hostId: id, network: { vlanId: 1610, ipv4Address: ip, subnetMask: '255.255.255.0', defaultGateway: '10.20.0.1', dnsServers: ['10.20.0.4'], hostnameFqdn: fqdn, customDnsSuffixes: [] } });
    must(s, { type: 'configureHostNtp', hostId: id, servers: [`ntp.lab.vcfhra.cz`] });
    must(s, { type: 'setHostSsh', hostId: id, enabled: true });
    must(s, { type: 'regenerateHostCertificate', hostId: id });
    must(s, { type: 'setWizardSection', section: 'esxHosts', value: [0, 1, 2, 3].map((i) => ({ fqdn: hostFqdn(i)[0] })) });
    must(s, { type: 'submitForReview' });
    must(s, { type: 'startValidation' });
    runUntilIdle(s);
    expect(s.snapshot().deploy.deployment.status).toBe('ready-to-deploy');
  });

  it('missing PTR record of a host fails validation; fixing DNS and re-validating unblocks deploy', () => {
    const s = new SandboxSession();
    completeDesign(s, MINIMAL_FOOTPRINT);
    preparePlanning(s, { hosts: 3, pnics: 2 });
    must(s, { type: 'advancePhase' });
    fillWizard(s, { hosts: 3, servicesIps: 30 });
    const [fqdn, ip] = hostFqdn(1);
    must(s, { type: 'removeDnsRecord', fqdn, records: 'ptr' });
    const host = s.snapshot().planning.hosts[1]!;
    expect(host.ready).toBe(false);
    expect(host.steps.dns).toEqual({ ok: false, reason: 'no-reverse', ip });

    must(s, { type: 'submitForReview' });
    must(s, { type: 'startValidation' });
    runUntilIdle(s);
    expect(s.snapshot().deploy.deployment.status).toBe('validation-failed');
    const dnsErr = s.snapshot().deploy.validationResult.errors.filter((i) => i.code === 'DNS_RECORD_MISSING');
    expect(dnsErr.length).toBeGreaterThan(0);
    const blocked = s.dispatch({ type: 'deploy' });
    expect(!blocked.ok && blocked.rejection.kind === 'validation' && codes(blocked.rejection.issues)).toEqual(['ILLEGAL_DEPLOYMENT_TRANSITION']);

    must(s, { type: 'addDnsRecord', fqdn, ip, records: 'ptr' });
    must(s, { type: 'startValidation' });
    runUntilIdle(s);
    expect(s.snapshot().deploy.deployment.status).toBe('ready-to-deploy');
  });

  it('passes game-scope issues through unchanged (convergence not modelled)', () => {
    const s = new SandboxSession();
    completeDesign(s, MINIMAL_FOOTPRINT);
    preparePlanning(s, { hosts: 3, pnics: 2 });
    must(s, { type: 'advancePhase' });
    must(s, { type: 'setWizardSection', section: 'existing', value: { ...s.state.spec.existing, existingVcenter: true } });
    const d = s.snapshot().deploy;
    const gs = d.liveIssues.gameScope;
    expect(codes(gs)).toEqual(['CONVERGENCE_NOT_MODELLED']);
    expect(gs[0]!.scope).toBe('game-scope');
    expect(d.steps.find((x) => x.step === 'existing-components')!.issues).toContainEqual(gs[0]);
  });

  it('environment change after a passed validation invalidates it (back to draft)', () => {
    const s = new SandboxSession();
    completeDesign(s, MINIMAL_FOOTPRINT);
    preparePlanning(s, { hosts: 3, pnics: 2 });
    must(s, { type: 'advancePhase' });
    fillWizard(s, { hosts: 3, servicesIps: 30 });
    must(s, { type: 'submitForReview' });
    must(s, { type: 'startValidation' });
    runUntilIdle(s);
    expect(s.state.deployment.status).toBe('ready-to-deploy');
    must(s, { type: 'setInstallerReachability', target: FQDN.ntp[0], reachable: false });
    expect(s.state.deployment.status).toBe('draft');
  });

  it('planning actions call model transitions and pass model errors through', () => {
    const s = new SandboxSession();
    completeDesign(s, MINIMAL_FOOTPRINT);
    must(s, { type: 'addHost', hw: { hwVendor: 'V', hwProfileId: 'p', pnicCount: 2 } });
    const r = s.dispatch({ type: 'regenerateHostCertificate', hostId: 'esx01' });
    expect(!r.ok && r.rejection.kind === 'validation' && codes(r.rejection.issues)).toEqual(['ESX_NOT_INSTALLED']);
    const d = s.dispatch({ type: 'downloadBinaries' });
    expect(!d.ok && d.rejection.kind === 'validation' && codes(d.rejection.issues)).toEqual(['DEPOT_NOT_CONNECTED']);
    const inst = s.dispatch({ type: 'deployInstaller', ovf: { vmName: 'x', placement: 'management-host', datastore: 'other', rootPassword: 'short', localUserPassword: 'short', hostnameFqdn: 'inst.lab.vcfhra.cz', ntpServers: [], ipVersion: 'ipv4', ipv4Address: '10.0.0.1', subnetMask: '255.255.255.0', defaultGateway: '10.0.0.254', dnsDomainName: 'lab.vcfhra.cz', domainSearchPath: '', dnsServers: [] } });
    if (inst.ok || inst.rejection.kind !== 'validation') throw new Error('expected validation rejection');
    expect(codes(inst.rejection.issues)).toEqual(expect.arrayContaining(['PASSWORD_TOO_SHORT', 'DNS_RECORD_MISSING', 'INSTALLER_DATASTORE_NOT_LOCAL']));
    expect(s.snapshot().log.at(-1)?.ok).toBe(false);
  });
});

describe('Sandbox – time', () => {
  it('pausing the engine stops binary downloads; resuming completes them', () => {
    const engine = new GameEngine(1);
    const s = new SandboxSession();
    s.attachTo(engine);
    completeDesign(s, MINIMAL_FOOTPRINT);
    must(s, { type: 'configureDepot', connection: { kind: 'online', input: { activationCode: 'GAME-ACT-0001' } } });
    must(s, { type: 'downloadBinaries', binaries: ['VMware vCenter'] });
    engine.tick(30_000);
    const p1 = s.snapshot().tasks[0]!.progress;
    expect(p1).toBeGreaterThan(0);
    expect(p1).toBeLessThan(1);

    engine.setSpeed(0);
    engine.tick(10 * 60 * 60_000);
    expect(s.snapshot().tasks[0]!.progress).toBe(p1);
    expect(s.state.env.depot.binaries['VMware vCenter']).toBe('downloading');

    engine.setSpeed(16);
    for (let i = 0; i < 10; i++) engine.tick(60_000);
    expect(s.state.env.depot.binaries['VMware vCenter']).toBe('downloaded');
    expect(s.snapshot().planning.depot.binaries.find((b) => b.binary === 'VMware vCenter')?.status).toBe('downloaded');
  });

  it('snapshots are frozen and cached per revision', () => {
    const s = new SandboxSession();
    const a = s.snapshot();
    expect(Object.isFrozen(a)).toBe(true);
    expect(s.snapshot()).toBe(a);
    s.selectDesignOption('deployment-model', 'simple');
    expect(s.snapshot()).not.toBe(a);
    expect(s.snapshot().revision).toBe(a.revision + 1);
  });

  it('snapshots and state are deep-frozen: nested mutation throws and cannot corrupt the session', () => {
    const s = new SandboxSession({ initialChoices: MINIMAL_FOOTPRINT });
    const snap = s.snapshot();
    const nested: unknown[] = [snap.design, snap.design.choices, snap.design.decisions[0], snap.deploy.spec, snap.deploy.spec.general, snap.planning.depot, snap.phases[0], snap.illustrative.taskDurationsMs];
    for (const o of nested) expect(Object.isFrozen(o)).toBe(true);
    expect(() => {
      (snap.deploy.spec.general as { instanceName: string }).instanceName = 'hacked';
    }).toThrow(TypeError);
    expect(() => {
      (s.state.env.dns.forward as Record<string, string>)['evil.lab'] = '1.1.1.1';
    }).toThrow(TypeError);
    expect(() => {
      (s.state.choices as Record<string, string>)['deployment-model'] = 'x';
    }).toThrow(TypeError);
    expect(s.state.spec.general.instanceName).not.toBe('hacked');
    expect(s.state.env.dns.forward['evil.lab']).toBeUndefined();
  });

  it('idle ticks keep revision and snapshot identity (no new state, no events)', () => {
    const engine = new GameEngine(16);
    const s = new SandboxSession();
    s.attachTo(engine);
    const events: SandboxEvent[] = [];
    s.subscribe((e) => events.push(e));
    const st = s.state;
    const snap = s.snapshot();
    for (let i = 0; i < 100; i++) engine.tick(16);
    expect(s.state).toBe(st);
    expect(s.snapshot()).toBe(snap);
    expect(s.snapshot().revision).toBe(snap.revision);
    expect(events).toEqual([]);
    expect(s.timeMs).toBe(100 * 16 * 16);
    // The next command is stamped with the current game time.
    s.selectDesignOption('deployment-model', 'simple');
    expect(s.state.timeMs).toBe(100 * 16 * 16);
    expect(s.snapshot().log.at(-1)?.atMs).toBe(100 * 16 * 16);
  });

  it('progress ticks keep the structural revision and heavy parts; progress events are coalesced', () => {
    const engine = new GameEngine(1);
    const s = new SandboxSession();
    s.attachTo(engine);
    completeDesign(s, MINIMAL_FOOTPRINT);
    must(s, { type: 'configureDepot', connection: { kind: 'online', input: { activationCode: 'GAME-ACT-0001' } } });
    must(s, { type: 'downloadBinaries', binaries: ['VMware vCenter'] });
    const events: SandboxEvent[] = [];
    s.subscribe((e) => events.push(e));
    const a = s.snapshot();
    const duration = a.tasks[0]!.durationMs;
    const frames = 1000;
    for (let i = 0; i < frames; i++) engine.tick(duration / 2 / frames);
    const b = s.snapshot();
    expect(b.revision).toBe(a.revision);
    expect(b.progressRevision).toBeGreaterThan(a.progressRevision);
    expect(b.tasks[0]!.progress).toBeCloseTo(0.5, 5);
    expect(b.planning.depot.binaries.find((x) => x.binary === 'VMware vCenter')?.progress).toBeCloseTo(0.5, 5);
    // Heavy, validation-based parts are reused by identity.
    expect(b.design).toBe(a.design);
    expect(b.phases).toBe(a.phases);
    expect(b.planning.hosts).toBe(a.planning.hosts);
    expect(b.deploy).toBe(a.deploy);
    expect(s.snapshot()).toBe(b);
    // No per-frame stateChanged; progress notifications at most once per whole percent.
    expect(events.filter((e) => e.type === 'sandbox/stateChanged')).toEqual([]);
    const progressed = events.filter((e) => e.type === 'sandbox/tasksProgressed');
    expect(progressed.length).toBeGreaterThanOrEqual(49);
    expect(progressed.length).toBeLessThanOrEqual(51);
    // Completion is structural: revision bumps and stateChanged(tick) fires once.
    engine.setSpeed(16);
    for (let i = 0; i < 10; i++) engine.tick(60_000);
    expect(s.snapshot().revision).toBeGreaterThan(a.revision);
    expect(events.filter((e) => e.type === 'sandbox/stateChanged' && e.cause === 'tick').length).toBeGreaterThanOrEqual(1);
  });
});
