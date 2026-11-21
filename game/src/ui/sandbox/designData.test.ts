import { describe, expect, it } from 'vitest';
import { DESIGN_DECISIONS } from '../../model';
import { loadDesignStepData } from './designData';
import { createLocalDesignState } from './designState';

const HA_PRODUCTION: Record<string, string> = {
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

describe('loadDesignStepData (model adapter)', () => {
  it('empty selection: only step 1 unlocked, all applicable decisions missing, cannot proceed', () => {
    const d = loadDesignStepData(new Map());
    expect(d.steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(d.steps.filter((s) => s.unlocked).map((s) => s.step)).toEqual([1]);
    expect(d.issues.missing.length).toBe(d.decisions.length);
    expect(d.canProceed).toBe(false);
  });

  it('every decision and option carries model data and at least one source', () => {
    const d = loadDesignStepData(new Map(Object.entries(HA_PRODUCTION)));
    for (const dec of d.decisions) {
      const def = DESIGN_DECISIONS.find((x) => x.id === dec.id)!;
      expect(dec.title).toBe(def.title);
      expect(dec.sources.length).toBeGreaterThan(0);
      for (const o of dec.options) expect(o.sources.length).toBeGreaterThan(0);
    }
  });

  it('workload-domain decisions appear only when workloads go to a workload domain', () => {
    const mgmt = loadDesignStepData(new Map([['workload-placement', 'management-domain']]));
    expect(mgmt.decisions.some((x) => x.id === 'wld-nsx-consumption')).toBe(false);
    const wld = loadDesignStepData(new Map([['workload-placement', 'workload-domain']]));
    expect(wld.decisions.some((x) => x.id === 'wld-nsx-consumption')).toBe(true);
  });

  it('RCMD deviation is an option warning with the rule, justification and implication', () => {
    const d = loadDesignStepData(new Map([['fleet-deployment-model', 'basic']]));
    const opt = d.decisions.find((x) => x.id === 'workload-placement')!.options.find((o) => o.id === 'management-domain')!;
    expect(opt.disabledReason).toBeUndefined();
    const rule = opt.warnings[0]!.rules.find((r) => r.id === 'VCF-WLD-RCMD-CFG-002')!;
    expect(rule.kind).toBe('RCMD');
    expect(rule.implication).toContain('Requires additional hardware.');
    expect(rule.justification.length).toBeGreaterThan(0);
  });

  it('Simple deployment model disables Medium/Large with a model reason', () => {
    const d = loadDesignStepData(new Map([['deployment-model', 'simple']]));
    const size = d.decisions.find((x) => x.id === 'deployment-size')!;
    expect(size.options.find((o) => o.id === 'small')!.disabledReason).toBeUndefined();
    expect(size.options.find((o) => o.id === 'medium')!.disabledReason).toBeTruthy();
  });

  it('complete valid design without warnings can proceed; summary comes from summarizeDesign', () => {
    const d = loadDesignStepData(new Map(Object.entries(HA_PRODUCTION)));
    expect(d.issues.errors).toEqual([]);
    expect(d.issues.missing).toEqual([]);
    expect(d.steps.every((s) => s.unlocked && s.complete)).toBe(true);
    expect(d.canProceed).toBe(true);
    expect(d.summary.raw.domains).toEqual(['management', 'workload']);
    expect(d.summary.raw.managementDomainMinHosts).toBeTypeOf('number');
  });

  it('warnings block until acknowledged; a later change resets acknowledgement', () => {
    const st = createLocalDesignState();
    for (const [k, v] of Object.entries(HA_PRODUCTION)) st.select(k, v);
    st.select('workload-placement', 'management-domain');
    let d = loadDesignStepData(st.selection(), st.acknowledged());
    expect(d.issues.warnings.length).toBeGreaterThan(0);
    expect(d.canProceed).toBe(false);
    st.acknowledgeWarnings(d.issues.warnings.map((w) => w.key));
    d = loadDesignStepData(st.selection(), st.acknowledged());
    expect(d.canProceed).toBe(true);
    st.select('sso-model', 'single-instance');
    d = loadDesignStepData(st.selection(), st.acknowledged());
    expect(d.warningsAcknowledged).toBe(false);
  });
});
