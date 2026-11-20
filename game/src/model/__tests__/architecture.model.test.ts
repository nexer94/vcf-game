import { describe, expect, it } from 'vitest';
import {
  type Cluster,
  type Domain,
  type Fleet,
  type Instance,
  APPLIANCES,
  MANAGEMENT_SERVICES,
  MAX_WORKLOAD_DOMAINS_PER_INSTANCE,
  expectedManagementDomainKinds,
  validateAddWorkloadDomain,
  validateCluster,
  validateFleet,
  validateInstance,
  validateNsxSharing,
} from '../architecture';
import { buildFleetFromBringup } from '../bringup';
import { validSpec } from './fixtures';

const ids = { fleetId: 'f1', fleetName: 'fleet', instanceId: 'i1', domainId: 'd1', clusterId: 'c1' };
const fleet = (): Fleet => buildFleetFromBringup(validSpec(), ids, 'single-rack');
const firstInstance = (): Instance => fleet().instances[0]!;

const cluster = (over: Partial<Cluster> = {}): Cluster => ({
  id: 'c',
  name: 'cl',
  model: 'single-rack',
  haEnabled: true,
  drsEnabled: true,
  distributedSwitchCount: 1,
  hosts: [{ id: 'h', fqdn: 'esx.example.io' }],
  ...over,
});

const wld = (id: string, over: Partial<Domain> = {}): Domain => ({
  id,
  name: id,
  kind: 'workload',
  vcenter: { kind: 'vcenter', nodes: 1 },
  nsx: { mode: 'dedicated', model: 'high-availability' },
  clusters: [cluster()],
  components: [],
  ...over,
});

describe('component catalogue', () => {
  it('SDDC Manager is VCF-only, vCenter is VCF+VVF', () => {
    expect(APPLIANCES['sddc-manager'].platforms).toEqual(['VCF']);
    expect(APPLIANCES.vcenter.platforms).toEqual(['VCF', 'VVF']);
  });
  it('management services deployment scopes (00 §2.3)', () => {
    expect(MANAGEMENT_SERVICES['fleet-lifecycle'].deployment).toBe('first-instance');
    expect(MANAGEMENT_SERVICES['sddc-lifecycle'].deployment).toBe('every-instance');
    expect(MANAGEMENT_SERVICES['real-time-metrics'].deployment).toBe('every-instance-day-n');
  });
  it('first instance hosts fleet components, others do not', () => {
    expect(expectedManagementDomainKinds(true)).toContain('vcf-operations');
    expect(expectedManagementDomainKinds(false)).not.toContain('vcf-operations');
    expect(expectedManagementDomainKinds(false)).toContain('sddc-manager');
  });
});

describe('architecture validations', () => {
  it('bring-up result is a valid fleet', () => {
    expect(validateFleet(fleet())).toEqual([]);
  });

  it.each([
    ['CLUSTER_HA_DISABLED', { haEnabled: false }],
    ['CLUSTER_DRS_DISABLED', { drsEnabled: false }],
    ['CLUSTER_NO_VDS', { distributedSwitchCount: 0 }],
  ] as const)('%s', (code, over) => {
    expect(validateCluster(cluster(over), { isManagementDefaultCluster: false }).map((i) => i.code)).toEqual([code]);
  });

  it('Multi-rack L3 cannot be the management default cluster', () => {
    const c = cluster({ model: 'multi-rack-l3' });
    expect(validateCluster(c, { isManagementDefaultCluster: true }).map((i) => i.code)).toEqual(['MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED']);
    expect(validateCluster(c, { isManagementDefaultCluster: false })).toEqual([]);
  });

  it('domain without clusters is rejected', () => {
    expect(validateAddWorkloadDomain(firstInstance(), wld('w', { clusters: [] })).map((i) => i.code)).toContain('DOMAIN_NO_CLUSTER');
  });

  it('max workload domains: 40 in 9.1, 24 in 9.0', () => {
    expect(MAX_WORKLOAD_DOMAINS_PER_INSTANCE).toEqual({ '9.0': 24, '9.1': 40 });
    const base = firstInstance();
    const at24: Instance = { ...base, workloadDomains: Array.from({ length: 24 }, (_, i) => wld(`w${i}`)) };
    expect(validateAddWorkloadDomain(at24, wld('new'), '9.1')).toEqual([]);
    expect(validateAddWorkloadDomain(at24, wld('new'), '9.0').map((i) => i.code)).toEqual(['MAX_WORKLOAD_DOMAINS']);
    const at40: Instance = { ...base, workloadDomains: Array.from({ length: 40 }, (_, i) => wld(`w${i}`)) };
    expect(validateAddWorkloadDomain(at40, wld('new'), '9.1').map((i) => i.code)).toEqual(['MAX_WORKLOAD_DOMAINS']);
  });

  it('adding a second management domain is rejected', () => {
    expect(validateAddWorkloadDomain(firstInstance(), wld('m2', { kind: 'management' })).map((i) => i.code)).toContain('NOT_A_WORKLOAD_DOMAIN');
  });

  it('NSX sharing with management domain: allowed in 9.1, rejected in 9.0', () => {
    const inst = firstInstance();
    const shared = { mode: 'shared', sharedWithDomainId: inst.managementDomain.id } as const;
    expect(validateNsxSharing(inst, shared, '9.1')).toEqual([]);
    expect(validateNsxSharing(inst, shared, '9.0').map((i) => i.code)).toEqual(['NSX_SHARE_MGMT_UNSUPPORTED_90']);
    expect(validateNsxSharing(inst, { mode: 'shared', sharedWithDomainId: 'nope' }).map((i) => i.code)).toEqual(['NSX_SHARE_TARGET_NOT_FOUND']);
  });

  it('fleet components outside the first instance are rejected', () => {
    const inst: Instance = { ...firstInstance(), isFirstInstance: false };
    expect(validateInstance(inst).map((i) => i.code)).toContain('FLEET_COMPONENT_OUTSIDE_FIRST_INSTANCE');
  });

  it('missing SDDC Manager in management domain is rejected', () => {
    const inst = firstInstance();
    const md = { ...inst.managementDomain, components: inst.managementDomain.components.filter((c) => c.kind !== 'sddc-manager') };
    expect(validateInstance({ ...inst, managementDomain: md }).map((i) => i.code)).toContain('MGMT_DOMAIN_MISSING_COMPONENT');
  });

  it('fleet needs exactly one first instance and unique instance names', () => {
    const f = fleet();
    const i1 = f.instances[0]!;
    expect(validateFleet({ ...f, instances: [] }).map((i) => i.code)).toEqual(['FLEET_NO_INSTANCE']);
    const dup = { ...f, instances: [i1, { ...i1, id: 'i2' }] };
    const c = validateFleet(dup).map((i) => i.code);
    expect(c).toContain('FLEET_FIRST_INSTANCE');
    expect(c).toContain('INSTANCE_NAME_NOT_UNIQUE');
  });
});
