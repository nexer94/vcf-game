import { describe, expect, it } from 'vitest';
import { validateManagementHostCount } from '../bringup';
import {
  type DesignChoices,
  type DesignContext,
  DESIGN_CONSTRAINTS,
  DESIGN_DECISIONS,
  DESIGN_DECISION_IDS,
  DESIGN_RULES,
  DESIGN_SOURCES,
  choicesFromMap,
  deriveBringupParams,
  docRefOf,
  isDecisionApplicable,
  minWorkloadDomainClusterHosts,
  optionAvailability,
  ruleKindOf,
  severityOfBasis,
  summarizeDesign,
  validateDesign,
  validateRedesign,
} from '../design';
import { errorsOf, warningsOf } from '../validation';

/** Blueprint "VCF Fleet in a Single Site" (05 §2.7 [D38]) – HA production, workloads in a separate WLD. */
const HA_PRODUCTION: DesignChoices = {
  'fleet-deployment-model': 'basic',
  'workload-placement': 'workload-domain',
  'wld-nsx-consumption': 'dedicated',
  'deployment-model': 'high-availability',
  'deployment-size': 'medium',
  'mgmt-cluster-model': 'single-rack',
  'wld-cluster-model': 'single-rack',
  'principal-storage': 'vsan-esa',
  'distributed-switch-model': 'storage-separation',
  'management-network-model': 'shared-vlan',
  'wld-network-type': 'ipv4',
  'network-consumption-model': 'vpc',
  'vpc-network-type': 'full-stack',
  'vpc-gateway-connectivity': 'distributed',
  'vcf-operations-model': 'high-availability',
  'vcf-automation-model': 'high-availability',
  'vcf-automation-placement': 'management-domain',
  'identity-broker-model': 'instance',
  'sso-model': 'fleet-wide',
};

/** Blueprint "VCF Fleet in a Single Site with Minimal Footprint" (05 §2.7 [D35][D36]). */
const MINIMAL_FOOTPRINT: DesignChoices = {
  'fleet-deployment-model': 'basic',
  'workload-placement': 'management-domain',
  'deployment-model': 'simple',
  'deployment-size': 'small',
  'mgmt-cluster-model': 'single-rack',
  'principal-storage': 'vsan-esa',
  'distributed-switch-model': 'single',
  'management-network-model': 'shared-vlan',
  'network-consumption-model': 'nsx-segment',
  'vpc-network-type': 'full-stack',
  'vpc-gateway-connectivity': 'centralized',
  'vcf-operations-model': 'simple',
  'vcf-automation-model': 'simple',
  'vcf-automation-placement': 'management-domain',
  'identity-broker-model': 'instance',
  'sso-model': 'fleet-wide',
};

const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

describe('design catalogue (05 §4, §6.2, §9)', () => {
  it('has every decision id exactly once, in 05 §4.10 step order', () => {
    expect(DESIGN_DECISIONS.map((d) => d.id)).toEqual([...DESIGN_DECISION_IDS]);
    const steps = DESIGN_DECISIONS.map((d) => d.step);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it.each(DESIGN_DECISIONS.map((d) => [d.id, d] as const))('%s has sources, options with sources, unique option ids', (_id, d) => {
    expect(d.sources.length).toBeGreaterThan(0);
    expect(d.options.length).toBeGreaterThanOrEqual(2);
    expect(new Set(d.options.map((o) => o.id)).size).toBe(d.options.length);
    for (const o of d.options) {
      expect(o.sources.length, `${d.id}/${o.id}`).toBeGreaterThan(0);
      for (const k of o.consequences) expect(k.sources.length).toBeGreaterThan(0);
    }
    for (const k of d.consequences) expect(k.sources.length).toBeGreaterThan(0);
  });

  it('all sources point to techdocs / knowledge.broadcom.com', () => {
    for (const s of Object.values(DESIGN_SOURCES))
      expect(s.url).toMatch(/^https:\/\/(techdocs\.broadcom\.com|knowledge\.broadcom\.com)\//);
    expect(docRefOf('D5')).toEqual({ title: DESIGN_SOURCES.D5.title, url: DESIGN_SOURCES.D5.url });
  });

  it('every referenced rule id exists and has a REQD/RCMD/RECD kind', () => {
    const refs = DESIGN_DECISIONS.flatMap((d) => [...d.rules, ...d.options.flatMap((o) => o.rules)]).map((r) => r.id);
    const ruleIds = DESIGN_CONSTRAINTS.flatMap((c) => (c.ruleId ? [c.ruleId] : []));
    for (const id of [...refs, ...ruleIds]) {
      expect(DESIGN_RULES[id], id).toBeDefined();
      expect(ruleKindOf(id)).toBe(DESIGN_RULES[id]?.kind);
    }
    expect(DESIGN_RULES['VCF-WLD-RCMD-CFG-002']?.implication).toEqual(['Requires additional hardware.']);
    expect(DESIGN_RULES['VCF-WLD-RCMD-CFG-001']?.versions).toEqual(['9.0']);
  });

  it('flags paraphrased items and open questions', () => {
    expect(DESIGN_RULES['VCF-OPS-REQD-HA-003']?.paraphrased).toBe(true);
    const ca = DESIGN_DECISIONS.find((d) => d.id === 'vcf-operations-model')?.options.find((o) => o.id === 'continuous-availability');
    expect(ca?.day2).toBe(true);
    expect(ca?.openQuestions).toContain('05 §8 q3');
  });

  it('principal storage decision is marked irreversible', () => {
    const d = DESIGN_DECISIONS.find((x) => x.id === 'principal-storage');
    expect(d?.consequences.some((k) => k.kind === 'irreversible' && k.text === 'the principal storage type for a cluster cannot be changed')).toBe(true);
  });
});

describe('applicability', () => {
  it('workload-domain decisions apply only with a separate workload domain', () => {
    expect(isDecisionApplicable('wld-nsx-consumption', MINIMAL_FOOTPRINT)).toBe(false);
    expect(isDecisionApplicable('wld-nsx-consumption', HA_PRODUCTION)).toBe(true);
    expect(isDecisionApplicable('wld-cluster-model', {})).toBe(false);
  });

  it('choicesFromMap keeps known decisions only', () => {
    const m = new Map([['deployment-model', 'simple'], ['bogus', 'x']]);
    expect(choicesFromMap(m)).toEqual({ 'deployment-model': 'simple' });
  });
});

/** One triggering case per constraint. */
const FIRES: Record<string, { choices: DesignChoices; ctx?: DesignContext; code: string }> = {
  'mgmt-cluster-not-l3': { choices: { ...HA_PRODUCTION, 'mgmt-cluster-model': 'multi-rack-l3' }, code: 'MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED' },
  'mgmt-cluster-stretched-day2': { choices: { ...HA_PRODUCTION, 'fleet-deployment-model': 'site-high-availability', 'mgmt-cluster-model': 'stretched' }, code: 'DESIGN_DAY2_ONLY' },
  'mgmt-cluster-fleet-topology': { choices: { ...HA_PRODUCTION, 'mgmt-cluster-model': 'multi-rack-l2' }, code: 'DESIGN_CLUSTER_MODEL_NOT_IN_FLEET_TOPOLOGY' },
  'wld-stretched-needs-multi-az': { choices: { ...HA_PRODUCTION, 'wld-cluster-model': 'stretched' }, code: 'DESIGN_STRETCHED_REQUIRES_MULTI_AZ_FLEET' },
  'size-for-deployment-model': { choices: { ...MINIMAL_FOOTPRINT, 'deployment-size': 'medium' }, code: 'SIZE_NOT_ALLOWED_FOR_MODEL' },
  'storage-not-in-mgmt-default': { choices: { ...HA_PRODUCTION, 'principal-storage': 'vsan-storage-cluster' }, code: 'DESIGN_STORAGE_UNSUPPORTED_MGMT_DEFAULT' },
  'storage-convergence-only': { choices: { ...HA_PRODUCTION, 'principal-storage': 'iscsi' }, code: 'DESIGN_STORAGE_CONVERGENCE_ONLY' },
  'multi-rack-vsan-esa': { choices: { ...HA_PRODUCTION, 'mgmt-cluster-model': 'multi-rack-l2', 'principal-storage': 'nfs-v3' }, code: 'DESIGN_MULTI_RACK_VSAN_ESA_RECOMMENDED' },
  'workloads-in-mgmt-domain': { choices: MINIMAL_FOOTPRINT, code: 'DESIGN_WORKLOADS_IN_MGMT_DOMAIN' },
  'workloads-in-mgmt-resource-pools-90': { choices: MINIMAL_FOOTPRINT, ctx: { version: '9.0' }, code: 'DESIGN_MGMT_RESOURCE_POOLS_90' },
  'nsx-share-mgmt-90': { choices: { ...HA_PRODUCTION, 'wld-nsx-consumption': 'shared-with-management-domain', 'vcf-automation-placement': 'management-domain' }, ctx: { version: '9.0' }, code: 'NSX_SHARE_MGMT_UNSUPPORTED_90' },
  'nsx-share-mgmt-rcmd': { choices: { ...HA_PRODUCTION, 'wld-nsx-consumption': 'shared-with-management-domain' }, code: 'DESIGN_MGMT_NSX_NOT_DEDICATED' },
  'ops-model-from-deployment-model': { choices: { ...HA_PRODUCTION, 'vcf-operations-model': 'simple' }, code: 'DESIGN_COMPONENT_MODEL_MISMATCH' },
  'ops-ca-day2': { choices: { ...HA_PRODUCTION, 'vcf-operations-model': 'continuous-availability' }, code: 'DESIGN_DAY2_ONLY' },
  'automation-model-from-deployment-model': { choices: { ...MINIMAL_FOOTPRINT, 'vcf-automation-model': 'high-availability' }, code: 'DESIGN_COMPONENT_MODEL_MISMATCH' },
  'automation-mgmt-domain-only-91': { choices: { ...HA_PRODUCTION, 'vcf-automation-placement': 'workload-domain' }, code: 'DESIGN_VCF_AUTOMATION_MGMT_DOMAIN_ONLY' },
  'automation-wld-needs-wld-90': { choices: { ...MINIMAL_FOOTPRINT, 'vcf-automation-placement': 'workload-domain' }, ctx: { version: '9.0' }, code: 'DESIGN_NO_WORKLOAD_DOMAIN' },
  'vpc-not-via-global-manager': { choices: HA_PRODUCTION, ctx: { nsxFederation: true }, code: 'DESIGN_VPC_NSX_GLOBAL_MANAGER' },
  'federation-all-apps-orgs': { choices: { ...HA_PRODUCTION, 'network-consumption-model': 'all-apps-orgs' }, ctx: { nsxFederation: true }, code: 'DESIGN_FEDERATION_FEATURES_UNAVAILABLE' },
  'vpc-no-ipv6': { choices: { ...HA_PRODUCTION, 'wld-network-type': 'ipv6' }, code: 'DESIGN_VPC_IPV6_UNSUPPORTED' },
};

describe('constraints (05 §3, §5)', () => {
  it('every constraint has a firing case', () => {
    expect(Object.keys(FIRES).sort()).toEqual(DESIGN_CONSTRAINTS.map((c) => c.id).sort());
  });

  it.each(DESIGN_CONSTRAINTS.map((c) => [c.id, c] as const))('%s fires with severity per basis and subject = decision', (id, c) => {
    const f = FIRES[id];
    if (!f) throw new Error(`missing case ${id}`);
    const hits = validateDesign(f.choices, f.ctx).filter((i) => i.code === f.code && i.subject === c.decision);
    expect(hits.length, id).toBe(1);
    expect(hits[0]?.severity).toBe(severityOfBasis(c.basis));
    expect(c.specRef.length).toBeGreaterThan(0);
  });

  it('REQD / unsupported -> error, RCMD -> warning', () => {
    for (const c of DESIGN_CONSTRAINTS) {
      if (c.ruleId) {
        const kind = ruleKindOf(c.ruleId);
        expect(severityOfBasis(c.basis), c.id).toBe(kind === 'REQD' ? 'error' : 'warning');
      }
    }
    expect(severityOfBasis('requirement')).toBe('error');
    expect(severityOfBasis('unsupported')).toBe('error');
    expect(severityOfBasis('day2')).toBe('error');
    expect(severityOfBasis('recommendation')).toBe('warning');
  });

  it('version-specific rules do not fire in the other version', () => {
    expect(codes(validateDesign(MINIMAL_FOOTPRINT))).not.toContain('DESIGN_MGMT_RESOURCE_POOLS_90');
    const sharedMgmt = { ...HA_PRODUCTION, 'wld-nsx-consumption': 'shared-with-management-domain' };
    expect(codes(validateDesign(sharedMgmt))).not.toContain('NSX_SHARE_MGMT_UNSUPPORTED_90');
    expect(codes(validateDesign(sharedMgmt, { version: '9.0' }))).not.toContain('DESIGN_MGMT_NSX_NOT_DEDICATED');
    const autoWld = { ...HA_PRODUCTION, 'vcf-automation-placement': 'workload-domain' };
    expect(validateDesign(autoWld, { version: '9.0' })).toEqual([]);
  });

  it('VPC without federation and with IPv4 is fine', () => {
    expect(validateDesign(HA_PRODUCTION, { nsxFederation: false })).toEqual([]);
  });
});

describe('validateDesign – complete designs', () => {
  it('full HA production design (blueprint Single Site) has no issues', () => {
    expect(validateDesign(HA_PRODUCTION)).toEqual([]);
  });

  it('minimal-footprint design: workloads in mgmt domain -> warning only', () => {
    const issues = validateDesign(MINIMAL_FOOTPRINT);
    expect(errorsOf(issues)).toEqual([]);
    expect(codes(warningsOf(issues))).toEqual(['DESIGN_WORKLOADS_IN_MGMT_DOMAIN']);
    expect(issues[0]?.message).toContain('VCF-WLD-RCMD-CFG-002');
  });

  it('reports missing decisions (only applicable ones) and unknown options', () => {
    const empty = validateDesign({});
    const missing = empty.filter((i) => i.code === 'DESIGN_DECISION_MISSING').map((i) => i.subject);
    expect(missing).toContain('workload-placement');
    expect(missing).not.toContain('wld-nsx-consumption');
    const { 'wld-nsx-consumption': _omit, ...noNsx } = HA_PRODUCTION;
    expect(codes(validateDesign(noNsx))).toEqual(['DESIGN_DECISION_MISSING']);
    expect(codes(validateDesign({ ...HA_PRODUCTION, 'principal-storage': 'tape' }))).toEqual(['DESIGN_OPTION_UNKNOWN']);
  });

  it('ignores choices of non-applicable decisions', () => {
    expect(codes(validateDesign({ ...MINIMAL_FOOTPRINT, 'wld-cluster-model': 'stretched', 'wld-network-type': 'ipv6' }))).toEqual([
      'DESIGN_WORKLOADS_IN_MGMT_DOMAIN',
    ]);
  });
});

describe('optionAvailability', () => {
  it('disables options blocked by earlier choices and explains why', () => {
    expect(optionAvailability('deployment-size', 'medium', { 'deployment-model': 'simple' }).available).toBe(false);
    expect(optionAvailability('deployment-size', 'medium', { 'deployment-model': 'high-availability' }).available).toBe(true);
    expect(optionAvailability('deployment-size', 'small', { 'deployment-model': 'high-availability' }).available).toBe(true);
    const l3 = optionAvailability('mgmt-cluster-model', 'multi-rack-l3', {});
    expect(l3.available).toBe(false);
    expect(l3.errors[0]?.code).toBe('MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED');
    expect(optionAvailability('principal-storage', 'nvme-tcp', {}).available).toBe(false);
    expect(optionAvailability('principal-storage', 'nfs-v3', {}).available).toBe(true);
    expect(optionAvailability('vcf-operations-model', 'high-availability', { 'deployment-model': 'simple' }).available).toBe(false);
  });

  it('RCMD deviations stay available with a warning', () => {
    const a = optionAvailability('workload-placement', 'management-domain', {});
    expect(a.available).toBe(true);
    expect(codes(a.warnings)).toEqual(['DESIGN_WORKLOADS_IN_MGMT_DOMAIN']);
  });

  it('does not report issues of other decisions', () => {
    const a = optionAvailability('deployment-model', 'simple', { 'deployment-size': 'large' });
    expect(a.errors).toEqual([]);
  });
});

describe('validateRedesign (05 §4.5 [D39])', () => {
  it('principal storage cannot be changed after deployment', () => {
    const next = { ...HA_PRODUCTION, 'principal-storage': 'nfs-v3' };
    expect(codes(validateRedesign(HA_PRODUCTION, next, 'deployed'))).toEqual(['DESIGN_PRINCIPAL_STORAGE_IMMUTABLE']);
    expect(validateRedesign(HA_PRODUCTION, next, 'design')).toEqual([]);
    expect(validateRedesign(HA_PRODUCTION, { ...HA_PRODUCTION, 'sso-model': 'single-instance' }, 'deployed')).toEqual([]);
  });
});

describe('deriveBringupParams -> bring-up model', () => {
  it('HA production feeds validateManagementHostCount (min 4)', () => {
    const r = deriveBringupParams(HA_PRODUCTION);
    if (!r.ok) throw new Error('expected ok');
    expect(r.params).toMatchObject({ model: 'high-availability', size: 'medium', storage: 'vsan-esa', clusterModel: 'single-rack', nsxManagerModel: 'high-availability', vdsProfile: 'storage-traffic-separation' });
    expect(r.params.networkConfig).toEqual({
      vcfManagementNetwork: 'shared-with-vm-management',
      deployOpsAndAutomationToCustomNetwork: false,
      vpcNetwork: 'full-stack',
      vpcGatewayConnectivity: 'distributed',
    });
    expect(codes(validateManagementHostCount(3, r.params))).toEqual(['MGMT_DOMAIN_TOO_FEW_HOSTS']);
    expect(validateManagementHostCount(4, r.params)).toEqual([]);
  });

  it('minimal footprint: Simple vSAN needs 3 hosts; Simple NFS needs 2', () => {
    const r = deriveBringupParams(MINIMAL_FOOTPRINT);
    if (!r.ok) throw new Error('expected ok');
    expect(codes(r.warnings)).toEqual(['DESIGN_WORKLOADS_IN_MGMT_DOMAIN']);
    expect(r.params.vdsProfile).toBe('default');
    expect(validateManagementHostCount(3, r.params)).toEqual([]);
    expect(codes(validateManagementHostCount(2, r.params))).toEqual(['MGMT_DOMAIN_TOO_FEW_HOSTS']);
    const nfs = deriveBringupParams({ ...MINIMAL_FOOTPRINT, 'principal-storage': 'nfs-v3' });
    if (!nfs.ok) throw new Error('expected ok');
    expect(validateManagementHostCount(2, nfs.params)).toEqual([]);
  });

  it('overlay management network -> custom network deployment of VCF Operations / Automation', () => {
    const r = deriveBringupParams({ ...HA_PRODUCTION, 'management-network-model': 'dedicated-vlan-nsx-overlay', 'distributed-switch-model': 'workload-separation' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.params.networkConfig.vcfManagementNetwork).toBe('dedicated');
    expect(r.params.networkConfig.deployOpsAndAutomationToCustomNetwork).toBe(true);
    expect(r.params.vdsProfile).toBe('custom');
  });

  it('fails on an invalid design', () => {
    const r = deriveBringupParams({ ...HA_PRODUCTION, 'principal-storage': 'iscsi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(codes(r.issues)).toContain('DESIGN_STORAGE_CONVERGENCE_ONLY');
  });
});

describe('summarizeDesign', () => {
  it('HA production: two domains, 4 mgmt hosts, two 3-node NSX Managers', () => {
    const s = summarizeDesign(HA_PRODUCTION);
    expect(s.domains).toEqual(['management', 'workload']);
    expect(s.instances).toBe(1);
    expect(s.twoAvailabilityZones).toBe(false);
    expect(s.managementDomainMinHosts).toBe(4);
    expect(s.workloadDomainMinHosts).toMatchObject({ vsan: 4, nfsOrFc: 4, openQuestion: '10 §8 q2' });
    expect(s.nsxManagers).toEqual([{ domain: 'management', nodes: 3 }, { domain: 'workload', nodes: 3 }]);
    expect(s.componentNodes).toMatchObject({ vcfOperations: 3, vcfAutomation: 3, managementServicesControlPlane: 3 });
    expect(s.appliedRules).toContain('VCF-WLD-RCMD-CFG-002');
    expect(s.deviatedRules).toEqual([]);
    expect(s.consequences.some((k) => k.text === 'Requires additional hardware.')).toBe(true);
  });

  it('minimal footprint: one domain, 3 hosts, deviation recorded', () => {
    const s = summarizeDesign(MINIMAL_FOOTPRINT);
    expect(s.domains).toEqual(['management']);
    expect(s.managementDomainMinHosts).toBe(3);
    expect(s.workloadDomainMinHosts).toBeUndefined();
    expect(s.nsxManagers).toEqual([{ domain: 'management', nodes: 1 }]);
    expect(s.deviatedRules).toContain('VCF-WLD-RCMD-CFG-002');
  });

  it('DR fleet needs a second instance; Site HA lists Day 2 stretch', () => {
    expect(summarizeDesign({ 'fleet-deployment-model': 'disaster-recovery' }).instances).toBe(2);
    const ha = summarizeDesign({ 'fleet-deployment-model': 'site-high-availability' });
    expect(ha.twoAvailabilityZones).toBe(true);
    expect(ha.dayTwo.length).toBeGreaterThan(0);
  });

  it('WLD host minimums (10 §6.1)', () => {
    expect(minWorkloadDomainClusterHosts('single-rack', 'simple')).toMatchObject({ vsan: 3, nfsOrFc: 2 });
    expect(minWorkloadDomainClusterHosts('multi-rack-l3', 'high-availability')).toMatchObject({ vsan: 3, nfsOrFc: 2 });
    expect(minWorkloadDomainClusterHosts('stretched', 'high-availability').vsan).toBeUndefined();
  });
});
