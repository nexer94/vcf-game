import { describe, expect, it } from 'vitest';
import type { ClusterModel } from '../architecture';
import {
  type BringupSpec,
  type DeploymentModel,
  type StorageType,
  CONVERGENCE_MIN_HOSTS,
  minManagementDefaultClusterHosts,
  validateBringupSpec,
  validateEsxHostsForBringup,
  validateManagementHostCount,
} from '../bringup';
import { validEnv, validSpec } from './fixtures';

// spec 10 §6.1 – Single-Rack [P9], Multi-Rack L2 [P11], Stretched [P13]; Multi-Rack L3 [P12].
const table: [ClusterModel, DeploymentModel, StorageType, number | undefined][] = [
  ['single-rack', 'simple', 'vsan-esa', 3],
  ['single-rack', 'simple', 'vsan-osa', 3],
  ['single-rack', 'high-availability', 'vsan-esa', 4],
  ['single-rack', 'simple', 'nfs-v3', 2],
  ['single-rack', 'simple', 'vmfs-fc', 2],
  ['single-rack', 'high-availability', 'nfs-v3', 4],
  ['single-rack', 'high-availability', 'vmfs-fc', 4],
  ['multi-rack-l2', 'simple', 'vsan-esa', 3],
  ['multi-rack-l2', 'high-availability', 'vsan-osa', 4],
  ['multi-rack-l2', 'simple', 'vmfs-fc', 2],
  ['multi-rack-l2', 'high-availability', 'nfs-v3', 4],
  ['stretched', 'simple', 'vsan-esa', 6],
  ['stretched', 'high-availability', 'vsan-esa', 8],
  // Not checked: L3 unsupported for the default cluster; stretched vMSC ambiguous (10 §8 q2).
  ['multi-rack-l3', 'simple', 'vsan-esa', undefined],
  ['stretched', 'simple', 'nfs-v3', undefined],
  ['stretched', 'high-availability', 'vmfs-fc', undefined],
];

describe('management domain default cluster host minimums (10 §6.1)', () => {
  it.each(table)('%s / %s / %s -> %s', (cm, model, storage, min) => {
    expect(minManagementDefaultClusterHosts(cm, model, storage)).toBe(min);
  });

  it('greenfield single-rack numbers equal the convergence numbers (20 §6.3)', () => {
    expect(minManagementDefaultClusterHosts('single-rack', 'simple', 'vsan-esa')).toBe(CONVERGENCE_MIN_HOSTS.simpleVsan);
    expect(minManagementDefaultClusterHosts('single-rack', 'simple', 'nfs-v3')).toBe(CONVERGENCE_MIN_HOSTS.simpleExternalStorage);
    expect(minManagementDefaultClusterHosts('single-rack', 'high-availability', 'vsan-esa')).toBe(CONVERGENCE_MIN_HOSTS.ha);
  });

  it('boundary: min hosts pass, min − 1 fails with MGMT_DOMAIN_TOO_FEW_HOSTS', () => {
    for (const [clusterModel, model, storage, min] of table) {
      if (min === undefined) continue;
      expect(validateManagementHostCount(min, { clusterModel, model, storage })).toEqual([]);
      const issues = validateManagementHostCount(min - 1, { clusterModel, model, storage });
      expect(issues.map((i) => [i.code, i.severity])).toEqual([['MGMT_DOMAIN_TOO_FEW_HOSTS', 'error']]);
      expect(issues[0]!.specRef).toMatch(/^10 §6\.1 \[P(9|13)\]/);
    }
  });

  it('undefined minimum is never reported', () => {
    expect(validateManagementHostCount(0, { clusterModel: 'multi-rack-l3', model: 'simple', storage: 'vsan-esa' })).toEqual([]);
  });
});

describe('host minimum is enabled by default in bring-up validators', () => {
  const env = validEnv();

  it('validateEsxHostsForBringup: 3 vSAN hosts ok for Simple, not for HA', () => {
    const three = env.hosts.slice(0, 3);
    const codes = (model: DeploymentModel) =>
      validateEsxHostsForBringup(three, { dns: env.dns, model, storage: 'vsan-esa' }).map((i) => i.code);
    expect(codes('simple')).not.toContain('MGMT_DOMAIN_TOO_FEW_HOSTS');
    expect(codes('high-availability')).toContain('MGMT_DOMAIN_TOO_FEW_HOSTS');
  });

  it('validateEsxHostsForBringup: 2 hosts ok for Simple NFS/FC, not for Simple vSAN', () => {
    const two = env.hosts.slice(0, 2);
    const codes = (storage: StorageType) =>
      validateEsxHostsForBringup(two, { dns: env.dns, model: 'simple', storage }).map((i) => i.code);
    expect(codes('vmfs-fc')).not.toContain('MGMT_DOMAIN_TOO_FEW_HOSTS');
    expect(codes('vsan-esa')).toContain('MGMT_DOMAIN_TOO_FEW_HOSTS');
  });

  it('validateEsxHostsForBringup: stretched cluster model uses the stretched table', () => {
    const issues = validateEsxHostsForBringup(env.hosts, { dns: env.dns, model: 'simple', storage: 'vsan-esa', clusterModel: 'stretched' });
    expect(issues.map((i) => i.code)).toContain('MGMT_DOMAIN_TOO_FEW_HOSTS');
  });

  it('validateBringupSpec counts distinct wizard entries and reports the shortfall once', () => {
    const s = validSpec(); // HA + vSAN ESA, 4 hosts
    expect(validateBringupSpec(s, env).map((i) => i.code)).not.toContain('MGMT_DOMAIN_TOO_FEW_HOSTS');
    const spec: BringupSpec = { ...s, esxHosts: s.esxHosts.slice(0, 3) };
    expect(validateBringupSpec(spec, env).filter((i) => i.code === 'MGMT_DOMAIN_TOO_FEW_HOSTS')).toHaveLength(1);
    // A duplicate entry does not count as an extra host.
    const dup: BringupSpec = { ...spec, esxHosts: [...spec.esxHosts, spec.esxHosts[0]!] };
    expect(validateBringupSpec(dup, env).map((i) => i.code)).toContain('MGMT_DOMAIN_TOO_FEW_HOSTS');
  });

  it('Simple + 3 vSAN hosts passes the spec validation', () => {
    const s = validSpec();
    const spec: BringupSpec = { ...s, model: 'simple', size: 'small', esxHosts: s.esxHosts.slice(0, 3) };
    expect(validateBringupSpec(spec, env).map((i) => i.code)).not.toContain('MGMT_DOMAIN_TOO_FEW_HOSTS');
  });
});
