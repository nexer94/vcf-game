/**
 * Model follow-ups of Sprint 1: shared host-port MTU / VLAN requirements (10 §3.3 [P18][P19]), the game-scope
 * USE_CASE_NOT_MODELLED limitation (25 §2.1) and the async hardware catalog loader (15 Příloha B).
 */
import { describe, expect, it } from 'vitest';
import { validateUseCaseModelled } from '../bringup';
import { buildHardwareCatalog } from '../hardwareCatalog';
import { loadHardwareCatalog } from '../hardwareCatalogCore';
import { type PlannedHostNetworks, type SwitchPortConfig, hostPortRequirements, plannedHostPortTraffic } from '../physical';

const plan: PlannedHostNetworks = {
  esxManagement: { vlanId: 10 },
  vmotion: { vlanId: 20, mtu: 9000 },
  storage: { vlanId: 30, mtu: 9000 },
  nsxHostOverlay: { vlanId: 40, mtu: 1700 },
};
const trunk = (allowed: SwitchPortConfig['allowedVlans'], mtu = 1500): SwitchPortConfig => ({ mode: 'trunk', accessVlan: 1, allowedVlans: allowed, nativeVlan: 1, mtu });

describe('plannedHostPortTraffic (20 §4.2 step 11; 10 §3.3 [P18])', () => {
  it('management 1500 + vMotion + vSAN + Host TEP from the plan', () => {
    expect(plannedHostPortTraffic(plan, 'vsan-esa')).toEqual([
      { type: 'management', vlanId: 10, mtu: 1500 },
      { type: 'vmotion', vlanId: 20, mtu: 9000 },
      { type: 'vsan', vlanId: 30, mtu: 9000 },
      { type: 'host-tep', vlanId: 40, mtu: 1700 },
    ]);
  });
  it('NFS for nfs-v3, no storage traffic for VMFS on FC', () => {
    expect(plannedHostPortTraffic(plan, 'nfs-v3').map((t) => t.type)).toEqual(['management', 'vmotion', 'nfs', 'host-tep']);
    expect(plannedHostPortTraffic(plan, 'vmfs-fc').map((t) => t.type)).toEqual(['management', 'vmotion', 'host-tep']);
  });
  it('host DCUI VLAN overrides the plan; null = untagged; no plan = management only', () => {
    expect(plannedHostPortTraffic(plan, 'vsan-esa', 11)[0]).toEqual({ type: 'management', vlanId: 11, mtu: 1500 });
    expect(plannedHostPortTraffic(undefined, 'vsan-esa', null)).toEqual([{ type: 'management', vlanId: null, mtu: 1500 }]);
    expect(plannedHostPortTraffic(undefined, 'vsan-esa')).toEqual([]);
  });
});

describe('hostPortRequirements (10 §3.3 [P19] VCF-NET-REQD-SWT-002/003, RCMD-SWT-001/004)', () => {
  const traffic = plannedHostPortTraffic(plan, 'vsan-esa');

  it('without a port: all VLANs, largest MTU, TEP minimum', () => {
    expect(hostPortRequirements(traffic)).toEqual({
      vlans: [10, 20, 30, 40],
      missingVlans: [],
      carried: ['management', 'vmotion', 'vsan', 'host-tep'],
      tepCarried: true,
      maxTrafficMtu: 9000,
      requiredMtu: 9000,
      recommendedMtu: 9000,
    });
  });

  it('minimum 1500 with no / small traffic; recommended 9000', () => {
    expect(hostPortRequirements([])).toMatchObject({ vlans: [], requiredMtu: 1500, recommendedMtu: 9000, tepCarried: false });
    expect(hostPortRequirements([{ type: 'management', vlanId: null, mtu: 1500 }])).toMatchObject({ vlans: [], requiredMtu: 1500 });
  });

  it('a port carrying Host TEP (MTU 1600 planned) needs 1700', () => {
    const r = hostPortRequirements([{ type: 'host-tep', vlanId: 40, mtu: 1600 }], trunk([40]));
    expect(r).toMatchObject({ tepCarried: true, maxTrafficMtu: 1600, requiredMtu: 1700, missingVlans: [] });
  });

  it('with a port: MTU only from carried traffic, missing VLANs listed', () => {
    const r = hostPortRequirements(traffic, trunk([10, 40]));
    expect(r.missingVlans).toEqual([20, 30]);
    expect(r.carried).toEqual(['management', 'host-tep']);
    expect(r.requiredMtu).toBe(1700);
    expect(hostPortRequirements(traffic, trunk('all')).missingVlans).toEqual([]);
  });
});

describe('validateUseCaseModelled (game scope, 25 §2.1)', () => {
  it('modelled use case -> no issue', () => {
    expect(validateUseCaseModelled({ id: 'UC-1', title: 'New VCF fleet', specRef: '25 §2.1', modelled: true })).toEqual([]);
  });
  it('not modelled -> USE_CASE_NOT_MODELLED, game-scope error on the use case id', () => {
    const [i, ...rest] = validateUseCaseModelled({ id: 'UC-4', title: 'VVF 9.1 without VCF management services', specRef: '25 §2.1, §4.3 [U6]', modelled: false });
    expect(rest).toEqual([]);
    expect(i).toMatchObject({ code: 'USE_CASE_NOT_MODELLED', severity: 'error', scope: 'game-scope', subject: 'UC-4', specRef: '25 §2.1, §4.3 [U6] (game scope)' });
  });
});

describe('loadHardwareCatalog (async, dynamic import of the BCG dataset)', () => {
  it('builds the same catalog as the synchronous builder and memoises it', async () => {
    const a = await loadHardwareCatalog();
    const b = await loadHardwareCatalog();
    expect(a).toBe(b);
    const sync = buildHardwareCatalog();
    expect(a.problems).toEqual([]);
    expect([...a.items.keys()]).toEqual([...sync.items.keys()]);
    expect(a.models.size).toBe(sync.models.size);
    expect(a.datasetFetchedAt).toBe(sync.datasetFetchedAt);
  });
});
