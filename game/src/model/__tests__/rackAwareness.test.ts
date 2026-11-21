import { describe, expect, it } from 'vitest';
import { buildHardwareCatalog } from '../hardwareCatalog';
import { hardwareContext, optionAvailabilityWithHardware } from '../hardwareDesign';
import {
  type PhysicalState,
  addEndpoint,
  addRack,
  addServer,
  addSwitch,
  configureServerManagementNetwork,
  connectCable,
  emptyPhysicalState,
  installEsxOnServer,
  mountDevice,
  setSwitchPortConfig,
} from '../physical';
import {
  type ClusterTopology,
  type FaultDomain,
  type RackL3Config,
  type VsanClusterSettings,
  autoRaidPolicy,
  deriveClusterTopology,
  effectiveFaultDomains,
  rackUnlockLabel,
  requiredFaultDomains,
  simulateRackFailure,
  topologyIssues,
  validateClusterModelAgainstTopology,
  validateFaultDomains,
  validateL3RackNetworking,
  validateMultiRackChecklist,
  validateRackAwareness,
  validateStoragePolicy,
} from '../rackAwareness';
import { assignRoomRole } from '../sites';
import type { SiteLayoutId } from '../sites';
import type { TransitionResult } from '../validation';

const catalog = buildHardwareCatalog();
const u = <S>(r: TransitionResult<S>): S => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
};
const STARTER = 'hpe-dl380g12-med';
const cfg = () => {
  const s = catalog.starterServers.find((x) => x.id === STARTER);
  if (!s) throw new Error(STARTER);
  return s.config;
};
const codes = (rs: readonly { issue: { code: string } }[]) => rs.map((r) => r.issue.code);

interface BuildOpts {
  /** hosts per rack, e.g. [2, 2, 2] */
  readonly hosts: readonly number[];
  readonly layout?: SiteLayoutId;
  /** rooms per rack (default first room) */
  readonly rooms?: readonly string[];
  /** 'l2': one VLAN everywhere + spine; 'l3': VLAN per rack, routed by a gateway on the spine; 'none': no spine. */
  readonly fabric?: 'l2' | 'l3' | 'none';
  /** configure static management IPs (DCUI) */
  readonly mgmt?: boolean;
  /** omit the ToR of these racks (hosts are cabled to the ToR of the first rack) */
  readonly noTorIn?: readonly string[];
  /** second NIC to a second ToR in the rack */
  readonly dualTor?: boolean;
  readonly unmounted?: readonly string[];
}

const SPINE_PORT = (i: number) => 40 + i;
const UPLINK = 47;

/** Racks r01.., ToR tor-rNN (+ tor-rNN-b), spine in r01, hosts esx-<rack>-<n>. */
function build(o: BuildOpts): { state: PhysicalState; hostIds: string[] } {
  let s = emptyPhysicalState(o.layout ?? 'large-room');
  const fabric = o.fabric ?? 'l2';
  const rackIds = o.hosts.map((_, i) => `r0${i + 1}`);
  rackIds.forEach((r, i) => (s = u(addRack(s, catalog, r, 'rack-generic-42u', o.rooms?.[i]))));
  if (fabric !== 'none') {
    s = u(addSwitch(s, catalog, 'spine', 'sw-generic-48x25g'));
    s = u(mountDevice(s, catalog, 'spine', 'r01', 40));
  }
  const torOf = (r: string) => (o.noTorIn?.includes(r) ? 'tor-r01' : `tor-${r}`);
  rackIds.forEach((r, i) => {
    if (o.noTorIn?.includes(r)) return;
    s = u(addSwitch(s, catalog, `tor-${r}`, 'sw-generic-48x25g'));
    s = u(mountDevice(s, catalog, `tor-${r}`, r, 42));
    if (o.dualTor) {
      s = u(addSwitch(s, catalog, `tor-${r}-b`, 'sw-generic-48x25g'));
      s = u(mountDevice(s, catalog, `tor-${r}-b`, r, 41));
    }
    if (fabric === 'none') return;
    const vlan = fabric === 'l3' ? 101 + i : 1;
    s = u(connectCable(s, catalog, { id: `isl-${r}`, a: { kind: 'switch', switchId: `tor-${r}`, port: UPLINK }, b: { kind: 'switch', switchId: 'spine', port: SPINE_PORT(i) } }));
    if (fabric === 'l3') {
      s = u(setSwitchPortConfig(s, catalog, `tor-${r}`, UPLINK, { mode: 'access', accessVlan: vlan, allowedVlans: 'all', nativeVlan: 1, mtu: 9000 }));
      s = u(setSwitchPortConfig(s, catalog, 'spine', SPINE_PORT(i), { mode: 'access', accessVlan: vlan, allowedVlans: 'all', nativeVlan: 1, mtu: 9000 }));
    }
  });
  if (fabric === 'l3') {
    s = u(setSwitchPortConfig(s, catalog, 'spine', 0, { mode: 'trunk', accessVlan: 1, allowedVlans: 'all', nativeVlan: 999, mtu: 9000 }));
    s = u(addEndpoint(s, { id: 'gw', kind: 'gateway', attachment: { kind: 'switch-port', switchId: 'spine', port: 0, tags: rackIds.map((_, i) => 101 + i) }, mtu: 1500 }));
  }
  const hostIds: string[] = [];
  let port = 0;
  rackIds.forEach((r, ri) => {
    for (let n = 0; n < (o.hosts[ri] ?? 0); n++) {
      const id = `esx-${r}-${n + 1}`;
      hostIds.push(id);
      s = u(addServer(s, catalog, id, cfg(), STARTER));
      if (o.unmounted?.includes(id)) continue;
      s = u(mountDevice(s, catalog, id, r, 1 + n * 2));
      const tor = torOf(r);
      const p = port++;
      s = u(connectCable(s, catalog, { id: `${id}-n0`, a: { kind: 'server-nic', serverId: id, vmnic: 0 }, b: { kind: 'switch', switchId: tor, port: p } }));
      if (fabric === 'l3') s = u(setSwitchPortConfig(s, catalog, tor, p, { mode: 'access', accessVlan: 101 + ri, allowedVlans: 'all', nativeVlan: 1, mtu: 9000 }));
      if (o.dualTor) s = u(connectCable(s, catalog, { id: `${id}-n1`, a: { kind: 'server-nic', serverId: id, vmnic: 1 }, b: { kind: 'switch', switchId: `${tor}-b`, port: p } }));
      s = u(installEsxOnServer(s, id, '9.1.1'));
      if (o.mgmt) {
        const subnet = fabric === 'l3' ? `10.1.${ri + 1}` : '10.0.0';
        s = u(configureServerManagementNetwork(s, id, { ipv4Address: `${subnet}.${10 + hostIds.length}`, subnetMask: '255.255.255.0', defaultGateway: `${subnet}.1`, dnsServers: [], hostnameFqdn: `${id}.example.test`, customDnsSuffixes: [] }));
      }
    }
  });
  return { state: s, hostIds };
}

const topoOf = (o: BuildOpts): ClusterTopology => {
  const b = build(o);
  return deriveClusterTopology(b.state, b.hostIds, catalog);
};

// ===========================================================================
// 1. Topology
// ===========================================================================

describe('deriveClusterTopology', () => {
  it('no mounted host -> none', () => {
    const t = deriveClusterTopology(emptyPhysicalState(), [], catalog);
    expect(t.model).toBe('none');
    expect(t.span).toBe('none');
  });

  it('all hosts in one rack -> single-rack, ToR detected, CPU/RAM from config', () => {
    const t = topoOf({ hosts: [4], mgmt: true });
    expect(t.model).toBe('single-rack');
    expect(t.racks).toHaveLength(1);
    expect(t.racks[0]).toMatchObject({ rackId: 'r01', torSwitchIds: ['tor-r01'], remoteSwitchIds: [], mgmtSubnets: ['10.0.0.0/24'] });
    const c = cfg();
    expect(t.hosts[0]).toMatchObject({ cores: c.sockets * c.coresPerSocket, ramGB: c.ramGB, rackId: 'r01', switchIds: ['tor-r01'] });
  });

  it('racks sharing the ESX management VLAN and subnet -> multi-rack-l2 [V20]', () => {
    const t = topoOf({ hosts: [1, 1, 1], mgmt: true });
    expect(t.networkScope).toBe('l2');
    expect(t.model).toBe('multi-rack-l2');
    expect(t.pairs.every((p) => p.scope === 'l2')).toBe(true);
  });

  it('VLAN + subnet per rack, routed by a gateway -> multi-rack-l3 [V20][V22]', () => {
    const t = topoOf({ hosts: [1, 1, 1], fabric: 'l3', mgmt: true });
    expect(t.pairs.map((p) => p.scope)).toEqual(['l3', 'l3', 'l3']);
    expect(t.pairs[0]?.routedVia).toBe('gw');
    expect(t.model).toBe('multi-rack-l3');
    expect(t.racks.map((r) => r.mgmtSubnets[0])).toEqual(['10.1.1.0/24', '10.1.2.0/24', '10.1.3.0/24']);
  });

  it('multi-rack without management configuration -> multi-rack-unknown', () => {
    const t = topoOf({ hosts: [1, 1, 1], fabric: 'none' });
    expect(t.model).toBe('multi-rack-unknown');
    expect(t.networkScope).toBe('unknown');
  });

  it('configured but unreachable racks -> inconsistent (racks-not-connected) with connect-racks unlock', () => {
    const t = topoOf({ hosts: [1, 1], fabric: 'none', mgmt: true });
    expect(t.model).toBe('inconsistent');
    expect(t.inconsistencies[0]?.kind).toBe('racks-not-connected');
    const r = topologyIssues(t).find((x) => x.issue.code === 'RACK_NETWORK_DISCONNECTED');
    expect(r?.issue.severity).toBe('error');
    expect(r?.unlock).toEqual({ kind: 'connect-racks', rackIds: ['r01', 'r02'] });
  });

  it('unmounted host -> inconsistent with mount-hosts unlock (game scope)', () => {
    const b = build({ hosts: [3], unmounted: ['esx-r01-3'] });
    const t = deriveClusterTopology(b.state, b.hostIds, catalog);
    expect(t.model).toBe('inconsistent');
    expect(t.unmountedHostIds).toEqual(['esx-r01-3']);
    const r = topologyIssues(t).find((x) => x.issue.code === 'RACK_HOST_NOT_MOUNTED');
    expect(r).toMatchObject({ issue: { scope: 'game-scope' }, unlock: { kind: 'mount-hosts', hostIds: ['esx-r01-3'] } });
  });

  it('unknown host id -> inconsistent (PHYS_DEVICE_INVALID)', () => {
    const b = build({ hosts: [1] });
    const t = deriveClusterTopology(b.state, [...b.hostIds, 'ghost'], catalog);
    expect(t.missingHostIds).toEqual(['ghost']);
    expect(codes(topologyIssues(t))).toContain('PHYS_DEVICE_INVALID');
  });

  it('hosts cabled to the ToR of another rack: remote switch + RACK_NO_TOR with add-tor unlock; single switch = PHYS_SINGLE_TOR', () => {
    const t = topoOf({ hosts: [1, 1, 1], noTorIn: ['r02'], mgmt: true });
    expect(t.racks[1]).toMatchObject({ rackId: 'r02', torSwitchIds: [], remoteSwitchIds: ['tor-r01'] });
    const issues = topologyIssues(t);
    const noTor = issues.find((r) => r.issue.code === 'RACK_NO_TOR');
    expect(noTor?.issue.severity).toBe('recommendation');
    expect(noTor?.unlock).toEqual({ kind: 'add-tor-to-rack', rackId: 'r02', hostIds: ['esx-r02-1'] });
    expect(rackUnlockLabel(noTor!.unlock!)).toBe('Přidej ToR switch do racku r02');
    expect(issues.filter((r) => r.issue.code === 'PHYS_SINGLE_TOR')).toHaveLength(3);
  });

  it('two ToRs per host -> no PHYS_SINGLE_TOR', () => {
    const t = topoOf({ hosts: [2], dualTor: true });
    expect(t.racks[0]?.torSwitchIds).toEqual(['tor-r01', 'tor-r01-b']);
    expect(codes(topologyIssues(t))).not.toContain('PHYS_SINGLE_TOR');
  });

  it('hosts in AZ1 and AZ2 rooms -> stretched', () => {
    let { state, hostIds } = build({ hosts: [2, 2], layout: 'two-buildings', rooms: ['room-a1', 'room-b1'], fabric: 'none' });
    state = u(assignRoomRole(state, 'room-b1', 'az2'));
    const t = deriveClusterTopology(state, hostIds, catalog);
    expect(t.span).toBe('multi-az');
    expect(t.model).toBe('stretched');
    expect(t.azRoles).toEqual(['az1', 'az2']);
  });
});

// ===========================================================================
// 2. Fault domains, policy, checklist
// ===========================================================================

describe('fault domains', () => {
  const t = topoOf({ hosts: [2, 2, 2, 2], mgmt: true });
  const perRack: FaultDomain[] = t.racks.map((r) => ({ name: `fd-${r.rackId}`, rackId: r.rackId, hostIds: r.hostIds }));

  it('documented messages: empty FD, duplicate name [V14]', () => {
    const rs = validateFaultDomains([{ name: 'a', hostIds: [] }, { name: 'b', hostIds: ['esx-r01-1'] }, { name: 'b', hostIds: ['esx-r02-1'] }], t);
    expect(rs.map((r) => r.issue.message)).toEqual([
      'A fault domain cannot be empty. You must select at least one host to include in the fault domain.',
      'vSAN does not support duplicate fault domain names in a cluster.',
    ]);
  });

  it('host offline / not in cluster / in two FDs', () => {
    const rs = validateFaultDomains([{ name: 'a', hostIds: ['esx-r01-1', 'nope'] }, { name: 'b', hostIds: ['esx-r01-1'] }], t, { offlineHostIds: ['esx-r01-1'] });
    expect(codes(rs)).toEqual(['VSAN_FD_HOST_OFFLINE', 'VSAN_FD_HOST_INVALID', 'VSAN_FD_HOST_INVALID', 'VSAN_FD_HOST_OFFLINE']);
  });

  it('one FD per rack satisfies VCF-VSAN-L3MR-REQD-CFG-003', () => {
    expect(validateFaultDomains(perRack, t, { requireRackFaultDomains: true })).toEqual([]);
  });

  it('racks with >1 host and no FD -> VSAN_FD_NOT_CONFIGURED [V29]; FD across racks -> VSAN_FD_NOT_PER_RACK', () => {
    expect(codes(validateFaultDomains([], t, { requireRackFaultDomains: true }))).toEqual(Array(4).fill('VSAN_FD_NOT_CONFIGURED'));
    const mixed: FaultDomain[] = [{ name: 'x', hostIds: ['esx-r01-1', 'esx-r02-1'] }, ...perRack.slice(2)];
    const c = codes(validateFaultDomains(mixed, t, { requireRackFaultDomains: true }));
    expect(c).toContain('VSAN_FD_NOT_PER_RACK');
  });

  it('racks with a single host need no FD ("with more than one ESX node per rack")', () => {
    const t1 = topoOf({ hosts: [1, 1, 1, 1], mgmt: true });
    expect(validateFaultDomains([], t1, { requireRackFaultDomains: true })).toEqual([]);
  });

  it('effective FDs: unassigned hosts are stand-alone FDs [V12]; unavailable hosts reduce usable FDs [V33]', () => {
    const eff = effectiveFaultDomains(t.clusterHostIds, perRack.slice(0, 2), t, ['esx-r03-1', 'esx-r03-2']);
    expect(eff).toHaveLength(2 + 4);
    expect(eff.filter((f) => f.standalone)).toHaveLength(4);
    expect(eff.filter((f) => f.usable)).toHaveLength(4);
  });
});

describe('storage policy vs. fault domains', () => {
  it('2n+1 and ESA table minimums (RAID-1 3/5/7, RAID-5 3/6, RAID-6 6)', () => {
    expect(requiredFaultDomains({ ftt: 1, layout: 'raid-1' }).required).toBe(3);
    expect(requiredFaultDomains({ ftt: 2, layout: 'raid-1' }).required).toBe(5);
    expect(requiredFaultDomains({ ftt: 3, layout: 'raid-1' }).required).toBe(7);
    expect(requiredFaultDomains({ ftt: 1, layout: 'raid-5-2+1' })).toMatchObject({ required: 3, openQuestionAlternative: { required: 4 } });
    expect(requiredFaultDomains({ ftt: 1, layout: 'raid-5-4+1' }).required).toBe(6);
    expect(requiredFaultDomains({ ftt: 2, layout: 'raid-6-4+2' })).toMatchObject({ required: 6, formula2n1: 5, esaTableMinHosts: 6 });
  });

  it('too few usable FDs -> documented KB message with "more" count', () => {
    const [r] = validateStoragePolicy({ ftt: 1, layout: 'raid-1' }, 2);
    expect(r?.issue).toMatchObject({ code: 'VSAN_POLICY_TOO_FEW_FAULT_DOMAINS', severity: 'error', message: 'There are currently 2 usable fault domains. The operation requires 1 more usable fault domain.' });
    expect(r?.unlock).toEqual({ kind: 'add-fault-domains', count: 1 });
    expect(validateStoragePolicy({ ftt: 2, layout: 'raid-6-4+2' }, 4)[0]?.issue.message).toBe('There are currently 4 usable fault domains. The operation requires 2 more usable fault domain.');
    expect(validateStoragePolicy({ ftt: 1, layout: 'raid-1' }, 3)).toEqual([]);
  });

  it('erasure coding with FTT=3 is invalid [V18]', () => {
    expect(validateStoragePolicy({ ftt: 3, layout: 'raid-6-4+2' }, 10)[0]?.issue.message).toBe('RAID 5 or RAID 6 erasure coding does not support a Failures to tolerate value of 3.');
    expect(validateStoragePolicy({ ftt: 2, layout: 'raid-5-2+1' }, 10)[0]?.issue.code).toBe('VSAN_POLICY_INVALID');
  });

  it('Auto-RAID 9.1 and the 9.0 difference', () => {
    expect(autoRaidPolicy(2).policy).toEqual({ ftt: 0, layout: 'raid-0' });
    expect(autoRaidPolicy(2, '9.1', true).policy).toEqual({ ftt: 1, layout: 'raid-1' });
    expect(autoRaidPolicy(3).policy).toEqual({ ftt: 1, layout: 'raid-5-2+1' });
    expect(autoRaidPolicy(5).policy).toEqual({ ftt: 1, layout: 'raid-5-2+1' });
    expect(autoRaidPolicy(6).policy).toEqual({ ftt: 2, layout: 'raid-6-4+2' });
    expect(autoRaidPolicy(3, '9.0')).toMatchObject({ mechanism: 'none' });
    expect(autoRaidPolicy(3, '9.0').policy).toBeUndefined();
    expect(autoRaidPolicy(4, '9.0').policy).toEqual({ ftt: 1, layout: 'raid-5-2+1' });
    expect(autoRaidPolicy(6, '9.0').policy).toEqual({ ftt: 2, layout: 'raid-6-4+2' });
  });
});

describe('multi-rack checklist (REQD-CFG-004/005)', () => {
  const bad: VsanClusterSettings = { autoPolicyManagement: true, reservedCapacity: true, customDefaultPolicyAssigned: false };
  it('auto policy management and reserved capacity are errors with unlock actions', () => {
    const rs = validateMultiRackChecklist(bad, 4);
    expect(codes(rs)).toEqual(['VSAN_AUTO_POLICY_WITH_FAULT_DOMAINS', 'VSAN_RESERVED_CAPACITY_WITH_FAULT_DOMAINS']);
    expect(rs.map((r) => r.unlock?.kind)).toEqual(['deactivate-auto-policy-management', 'disable-reserved-capacity']);
  });
  it('auto policy off without own default policy -> recommendation; default policy checked against FDs', () => {
    const rs = validateMultiRackChecklist({ autoPolicyManagement: false, reservedCapacity: false, customDefaultPolicyAssigned: false }, 4);
    expect(rs.map((r) => [r.issue.code, r.issue.severity])).toEqual([['VSAN_CUSTOM_DEFAULT_POLICY_MISSING', 'recommendation']]);
    const ok = validateMultiRackChecklist({ autoPolicyManagement: false, reservedCapacity: false, customDefaultPolicyAssigned: true, defaultPolicy: { ftt: 2, layout: 'raid-6-4+2' } }, 4);
    expect(codes(ok)).toEqual(['VSAN_POLICY_TOO_FEW_FAULT_DOMAINS']);
  });
});

// ===========================================================================
// L3 per-rack requirements
// ===========================================================================

describe('L3 per-rack requirements (VCF-VNI-L3MR-REQD-CFG-001..003, VCF-VSAN-L3MR-REQD-CFG-001)', () => {
  const t = topoOf({ hosts: [2, 2, 2], fabric: 'l3', mgmt: true });
  const good: RackL3Config[] = t.racks.map((r, i) => ({
    rackId: r.rackId,
    uplinkProfile: `up-${r.rackId}`,
    hostTepPool: { cidr: `10.15.${14 + i}.0/24`, gateway: `10.15.${14 + i}.1`, vlanId: 1514 + i },
    ...(i > 0 ? { subTransportNodeProfile: `subtnp-${r.rackId}` } : {}),
    vsanGateway: { ip: `10.20.${i}.1`, highlyAvailable: true, respondsToIcmp: true },
    haIsolationAddress: `10.20.${i}.1`,
  }));

  it('complete config passes; first rack may use the main TNP', () => {
    expect(validateL3RackNetworking(t, good)).toEqual([]);
  });

  it('missing config per rack -> every requirement with unlock', () => {
    const rs = validateL3RackNetworking(t, []);
    const c = codes(rs);
    expect(c.filter((x) => x === 'NSX_L3_UPLINK_PROFILE_PER_RACK')).toHaveLength(3);
    expect(c.filter((x) => x === 'NSX_L3_HOST_TEP_POOL_PER_RACK')).toHaveLength(3);
    expect(c.filter((x) => x === 'NSX_L3_SUB_TNP_MISSING')).toHaveLength(2);
    expect(c.filter((x) => x === 'VSAN_L3_HA_ISOLATION_ADDRESS')).toHaveLength(3);
    expect(rs.find((r) => r.issue.code === 'NSX_L3_SUB_TNP_MISSING')?.unlock).toEqual({ kind: 'create-sub-tnp', rackId: 'r02' });
  });

  it('shared uplink profile, overlapping TEP subnet, same TEP VLAN, small pool, wrong HA isolation address', () => {
    const [a, b, c] = good;
    const bad: RackL3Config[] = [
      a!,
      { ...b!, uplinkProfile: a!.uplinkProfile!, hostTepPool: { cidr: '10.15.14.0/24', gateway: '10.15.14.1', vlanId: 1514 } },
      { ...c!, hostTepPool: { cidr: '10.15.99.0/24', gateway: '10.15.99.1', range: { kind: 'range', start: '10.15.99.10', end: '10.15.99.10' } }, haIsolationAddress: '8.8.8.8', vsanGateway: { ip: '10.20.2.1', highlyAvailable: false, respondsToIcmp: true } },
    ];
    const rs = validateL3RackNetworking(t, bad);
    expect(rs.map((r) => [r.issue.code, r.issue.severity, r.issue.subject])).toEqual([
      ['NSX_L3_UPLINK_PROFILE_PER_RACK', 'error', 'r02'],
      ['NSX_L3_HOST_TEP_POOL_PER_RACK', 'error', 'r02'],
      ['NSX_L3_TEP_VLAN_PER_RACK', 'warning', 'r02'],
      ['NSX_L3_HOST_TEP_POOL_EXHAUSTED', 'error', 'r03'],
      ['VSAN_L3_HA_ISOLATION_ADDRESS', 'error', 'r03'],
      ['VSAN_L3_HA_ISOLATION_ADDRESS', 'error', 'r03'],
    ]);
    expect(rs[4]?.unlock).toEqual({ kind: 'set-ha-isolation-address', rackId: 'r03', address: '10.20.2.1' });
  });
});

// ===========================================================================
// 3. Design model vs. topology
// ===========================================================================

describe('design cluster model vs. derived topology', () => {
  it('WLD Multi-Rack vSAN: 2 racks -> REQD-CFG-002 error "rozmísti hosty do 3 racků"; 3 racks -> RCMD 4 FD warning; unequal hosts warning', () => {
    const two = validateClusterModelAgainstTopology('multi-rack-l2', topoOf({ hosts: [2, 2], mgmt: true }), { role: 'workload', storage: 'vsan-esa' });
    expect(two[0]).toMatchObject({ issue: { code: 'VSAN_MULTI_RACK_TOO_FEW_RACKS', severity: 'error' }, unlock: { kind: 'spread-hosts-across-racks', targetRacks: 3, currentRackIds: ['r01', 'r02'], buyHosts: 0 } });
    expect(rackUnlockLabel(two[0]!.unlock!)).toBe('Rozmísti hosty do 3 racků');
    const three = validateClusterModelAgainstTopology('multi-rack-l2', topoOf({ hosts: [2, 1, 1], mgmt: true }), { role: 'workload', storage: 'vsan-esa' });
    expect(three.map((r) => [r.issue.code, r.issue.severity])).toEqual([
      ['VSAN_MULTI_RACK_FOUR_FD_RECOMMENDED', 'warning'],
      ['VSAN_FD_UNEQUAL_HOSTS', 'warning'],
    ]);
    expect(validateClusterModelAgainstTopology('multi-rack-l2', topoOf({ hosts: [1, 1, 1, 1], mgmt: true }), { role: 'workload' })).toEqual([]);
  });

  it('single rack with Multi-Rack design: buy hosts when fewer than 3', () => {
    const r = validateClusterModelAgainstTopology('multi-rack-l3', topoOf({ hosts: [2] }), { role: 'workload' });
    expect(r[0]?.unlock).toEqual({ kind: 'spread-hosts-across-racks', targetRacks: 3, currentRackIds: ['r01'], buyHosts: 1 });
  });

  it('L2 design on an L3 fabric and vice versa -> mismatch warnings with network unlocks', () => {
    const l2OnL3 = validateClusterModelAgainstTopology('multi-rack-l2', topoOf({ hosts: [1, 1, 1, 1], fabric: 'l3', mgmt: true }), { role: 'workload' });
    expect(l2OnL3.map((r) => r.issue.code)).toEqual(['RACK_CLUSTER_MODEL_MISMATCH']);
    expect(l2OnL3[0]?.unlock?.kind).toBe('stretch-network-across-racks');
    const l3OnL2 = validateClusterModelAgainstTopology('multi-rack-l3', topoOf({ hosts: [1, 1, 1, 1], mgmt: true }), { role: 'workload' });
    expect(l3OnL2[0]?.unlock?.kind).toBe('isolate-network-per-rack');
  });

  it('management default cluster on an L3 topology -> MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED (reused code)', () => {
    const r = validateClusterModelAgainstTopology('multi-rack-l2', topoOf({ hosts: [1, 1, 1], fabric: 'l3', mgmt: true }), { role: 'management-default', storage: 'vsan-esa' });
    expect(r[0]).toMatchObject({ issue: { code: 'MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED', severity: 'error' }, unlock: { kind: 'stretch-network-across-racks' } });
  });

  it('management default L2 with vSAN: no multi-rack vSAN rack rules (storage model Non Supported, OQ1); single rack -> mismatch warning', () => {
    const multi = validateClusterModelAgainstTopology('multi-rack-l2', topoOf({ hosts: [2, 2], mgmt: true }), { role: 'management-default', storage: 'vsan-esa' });
    expect(multi).toEqual([]);
    const single = validateClusterModelAgainstTopology('multi-rack-l2', topoOf({ hosts: [4], mgmt: true }), { role: 'management-default', storage: 'vsan-esa' });
    expect(single.map((r) => [r.issue.code, r.issue.severity])).toEqual([['RACK_CLUSTER_MODEL_MISMATCH', 'warning']]);
  });

  it('Single-Rack design with hosts in several racks -> warning, consolidate or choose multi-rack', () => {
    const r = validateClusterModelAgainstTopology('single-rack', topoOf({ hosts: [3, 1], mgmt: true }), { role: 'management-default' });
    expect(r[0]).toMatchObject({ issue: { code: 'RACK_CLUSTER_MODEL_MISMATCH', severity: 'warning' }, unlock: { kind: 'consolidate-into-rack', rackId: 'r01', hostIds: ['esx-r02-1'] }, alternative: { kind: 'choose-cluster-model', models: ['multi-rack-l2'] } });
    expect(validateClusterModelAgainstTopology('single-rack', topoOf({ hosts: [3] }), { role: 'management-default' })).toEqual([]);
  });

  it('stretched design without two AZs -> mismatch', () => {
    expect(codes(validateClusterModelAgainstTopology('stretched', topoOf({ hosts: [4] }), { role: 'workload' }))).toEqual(['RACK_CLUSTER_MODEL_MISMATCH']);
  });
});

describe('validateRackAwareness (umbrella)', () => {
  it('WLD L3 multi-rack vSAN: FDs missing, checklist, L3 per rack', () => {
    const t = topoOf({ hosts: [2, 2, 2, 2], fabric: 'l3', mgmt: true });
    const vsan: VsanClusterSettings = { autoPolicyManagement: true, reservedCapacity: false, customDefaultPolicyAssigned: false, defaultPolicy: { ftt: 1, layout: 'raid-5-2+1' } };
    const c = codes(validateRackAwareness({ topology: t, role: 'workload', designModel: 'multi-rack-l3', storage: 'vsan-esa', vsan }));
    expect(c).toEqual(expect.arrayContaining(['VSAN_FD_NOT_CONFIGURED', 'VSAN_AUTO_POLICY_WITH_FAULT_DOMAINS', 'NSX_L3_UPLINK_PROFILE_PER_RACK', 'NSX_L3_SUB_TNP_MISSING', 'VSAN_L3_HA_ISOLATION_ADDRESS']));
  });

  it('per-rack FDs + FTT1 RAID-1 on 3 racks -> no-rebuild warning (three FD restriction)', () => {
    const t = topoOf({ hosts: [2, 2, 2], mgmt: true });
    const fds = t.racks.map((r) => ({ name: r.rackId, hostIds: r.hostIds }));
    const vsan: VsanClusterSettings = { autoPolicyManagement: false, reservedCapacity: false, customDefaultPolicyAssigned: true, defaultPolicy: { ftt: 1, layout: 'raid-1' } };
    const rs = validateRackAwareness({ topology: t, role: 'workload', designModel: 'multi-rack-l2', storage: 'vsan-esa', faultDomains: fds, vsan });
    expect(codes(rs)).toEqual(['PHYS_SINGLE_TOR', 'PHYS_SINGLE_TOR', 'PHYS_SINGLE_TOR', 'PHYS_SINGLE_TOR', 'PHYS_SINGLE_TOR', 'PHYS_SINGLE_TOR', 'VSAN_MULTI_RACK_FOUR_FD_RECOMMENDED', 'VSAN_FD_NO_REBUILD_CAPACITY']);
    expect(rs.at(-1)?.issue.message).toContain('three fault domains');
  });

  it('fault domains on the management default cluster -> Non Supported [V5]', () => {
    const t = topoOf({ hosts: [2, 2], mgmt: true, dualTor: true });
    const rs = validateRackAwareness({ topology: t, role: 'management-default', designModel: 'multi-rack-l2', storage: 'vsan-esa', faultDomains: [{ name: 'a', hostIds: ['esx-r01-1'] }] });
    expect(codes(rs)).toEqual(['VSAN_MULTI_RACK_MGMT_DEFAULT_UNSUPPORTED']);
  });

  it('L3 racks inside the AZs of a stretched cluster -> RACK_L3_CANNOT_STRETCH [V6]', () => {
    let { state, hostIds } = build({ hosts: [1, 1, 1, 1], layout: 'two-buildings', rooms: ['room-a1', 'room-a1', 'room-b1', 'room-b1'], fabric: 'l3', mgmt: true });
    state = u(assignRoomRole(state, 'room-b1', 'az2'));
    const t = deriveClusterTopology(state, hostIds, catalog);
    expect(t.span).toBe('multi-az');
    expect(t.pairs.map((p) => [p.rackA, p.rackB, p.scope])).toEqual([['r01', 'r02', 'l3'], ['r03', 'r04', 'l3']]);
    expect(t.model).toBe('inconsistent');
    const r = topologyIssues(t).find((x) => x.issue.code === 'RACK_L3_CANNOT_STRETCH');
    expect(r?.issue).toMatchObject({ severity: 'error', message: 'Layer 3 multi-rack vSphere clusters cannot be stretched.' });
  });
});

// ===========================================================================
// 4. Rack failure simulation
// ===========================================================================

describe('simulateRackFailure', () => {
  const c = cfg();
  it('4 racks, FD per rack, FTT1: data available, HA restart, rebuild possible with free capacity; CPU/RAM lost', () => {
    const t = topoOf({ hosts: [2, 2, 2, 2], mgmt: true });
    const fds = t.racks.map((r) => ({ name: r.rackId, hostIds: r.hostIds }));
    const r = simulateRackFailure(t, 'r02', { ftt: 1, layout: 'raid-1' }, fds);
    expect(r).toMatchObject({
      lostHostIds: ['esx-r02-1', 'esx-r02-2'],
      lostCores: 2 * c.sockets * c.coresPerSocket,
      lostRamGB: 2 * c.ramGB,
      remainingRamGB: 6 * c.ramGB,
      faultDomainsBefore: 4,
      faultDomainsLost: 1,
      faultDomainsAfter: 3,
      rackAligned: true,
      dataAvailability: 'available',
      haRestartOnOtherRacks: true,
      rebuild: 'possible-if-free-capacity',
      capacityReserve: { documented: false },
    });
  });

  it('3 racks: redundancy but no rebuild [V1][V13]', () => {
    const t = topoOf({ hosts: [1, 1, 1], mgmt: true });
    const r = simulateRackFailure(t, 'r01', { ftt: 1, layout: 'raid-1' });
    expect(r.dataAvailability).toBe('available');
    expect(r.rebuild).toBe('not-possible');
    expect(r.notes.join(' ')).toContain('three fault domains');
  });

  it('no FDs with 2 hosts per rack: rack takes out 2 stand-alone FDs -> at risk with FTT1', () => {
    const t = topoOf({ hosts: [2, 2, 2], mgmt: true });
    const r = simulateRackFailure(t, 'r01', { ftt: 1, layout: 'raid-1' });
    expect(r.rackAligned).toBe(false);
    expect(r.faultDomainsLost).toBe(2);
    expect(r.dataAvailability).toBe('at-risk');
  });

  it('single rack: everything lost', () => {
    const t = topoOf({ hosts: [3] });
    const fds = [{ name: 'r01', hostIds: t.racks[0]!.hostIds }];
    const r = simulateRackFailure(t, 'r01', { ftt: 1, layout: 'raid-1' }, fds);
    expect(r.dataAvailability).toBe('unavailable');
    expect(r.haRestartOnOtherRacks).toBe(false);
    expect(r.remainingCores).toBe(0);
  });

  it('6 FDs with RAID-6: no re-protect after a rack failure', () => {
    const t = topoOf({ hosts: [1, 1, 1, 1, 1, 1], mgmt: true });
    expect(simulateRackFailure(t, 'r01', { ftt: 2, layout: 'raid-6-4+2' }).rebuild).toBe('not-possible');
  });
});

// ===========================================================================
// hardwareDesign hook
// ===========================================================================

describe('optionAvailabilityWithHardware – rack topology', () => {
  it('hardwareContext carries the rack topology; Multi-Rack L2 with all hosts in one rack -> warning with spread unlock', () => {
    const b = build({ hosts: [4], mgmt: true });
    const hw = hardwareContext(b.state, catalog);
    expect(hw.rackTopology?.model).toBe('single-rack');
    const r = optionAvailabilityWithHardware('mgmt-cluster-model', 'multi-rack-l2', { 'deployment-model': 'high-availability', 'principal-storage': 'vsan-esa' }, hw);
    expect(r.available).toBe(true);
    expect(r.hardware.warnings.find((w) => w.issue.code === 'RACK_CLUSTER_MODEL_MISMATCH')?.unlock?.kind).toBe('spread-hosts-across-racks');
  });

  it('L3 fabric blocks management cluster options with the L3 error', () => {
    const b = build({ hosts: [2, 1, 1], fabric: 'l3', mgmt: true });
    const r = optionAvailabilityWithHardware('mgmt-cluster-model', 'single-rack', { 'deployment-model': 'high-availability', 'principal-storage': 'vsan-esa' }, hardwareContext(b.state, catalog));
    expect(r.available).toBe(false);
    expect(r.hardware.errors.map((e) => e.issue.code)).toContain('MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED');
  });

  it('unmounted hosts: no rack reasons yet', () => {
    const b = build({ hosts: [3], unmounted: ['esx-r01-3'] });
    const r = optionAvailabilityWithHardware('mgmt-cluster-model', 'multi-rack-l2', {}, hardwareContext(b.state, catalog));
    expect(r.hardware.warnings).toEqual([]);
  });

  it('WLD multi-rack shows the 3-rack requirement', () => {
    const r = optionAvailabilityWithHardware('wld-cluster-model', 'multi-rack-l3', { 'workload-placement': 'workload-domain' }, hardwareContext(emptyPhysicalState(), catalog));
    expect(r.hardware.requirements.map((i) => i.code)).toContain('VSAN_MULTI_RACK_TOO_FEW_RACKS');
  });
});
