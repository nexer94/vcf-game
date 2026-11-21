import { describe, expect, it } from 'vitest';
import { configureHostNtp } from '../bringup';
import { buildHardwareCatalog } from '../hardwareCatalog';
import {
  type NetContext,
  type PhysicalState,
  type PlannedHostNetworks,
  type ServiceEndpoint,
  ESX_INSTALL_DEFAULTS,
  addEndpoint,
  addRack,
  addServer,
  addSwitch,
  applyBringupHostNetworking,
  bmcReachable,
  bringupPossibleCauseHints,
  computeTrafficFlows,
  configureServerManagementNetwork,
  connectCable,
  emptyPhysicalState,
  firstFreeU,
  installEsxOnServer,
  linkStatus,
  mountDevice,
  pathBetween,
  setBmcHostInterface,
  setHostSwitchMtu,
  setStandardSwitchUplinks,
  setSwitchPortConfig,
  setSwitchPortsConfig,
  setVmkMtu,
  testManagementNetwork,
  unreachableFromInstaller,
  updateServerEsx,
  validateMount,
  validateOobNetwork,
  validatePhysicalNetworkForBringup,
} from '../physical';
import type { TransitionResult } from '../validation';

const catalog = buildHardwareCatalog();
const u = <S>(r: TransitionResult<S>): S => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
};
const cfg = (id: string) => {
  const s = catalog.starterServers.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s.config;
};
const MGMT = 10;
const ISL_PORT = 47;
const hostIds = (n: number) => Array.from({ length: n }, (_, i) => `esx-0${i + 1}`);
const ctxOf = (state: PhysicalState): NetContext => ({ state, catalog });

/** Room with 1 rack, 2 × 25G switches joined by an ISL, n hosts with vmnic0 -> swA, vmnic1 -> swB. */
function room(n: number, starter = 'hpe-dl380g12-med'): PhysicalState {
  let s = emptyPhysicalState();
  s = u(addRack(s, catalog, 'r1'));
  s = u(addSwitch(s, catalog, 'swA', 'sw-generic-48x25g'));
  s = u(addSwitch(s, catalog, 'swB', 'sw-generic-48x25g'));
  s = u(addSwitch(s, catalog, 'swO', 'sw-generic-48x1g-oob'));
  s = u(mountDevice(s, catalog, 'swA', 'r1', 42));
  s = u(mountDevice(s, catalog, 'swB', 'r1', 41));
  s = u(connectCable(s, catalog, { id: 'isl', a: { kind: 'switch', switchId: 'swA', port: ISL_PORT }, b: { kind: 'switch', switchId: 'swB', port: ISL_PORT } }));
  hostIds(n).forEach((id, i) => {
    s = u(addServer(s, catalog, id, cfg(starter), starter));
    s = u(mountDevice(s, catalog, id, 'r1', 1 + i * 2));
    s = u(connectCable(s, catalog, { id: `${id}-n0`, a: { kind: 'server-nic', serverId: id, vmnic: 0 }, b: { kind: 'switch', switchId: 'swA', port: i } }));
    s = u(connectCable(s, catalog, { id: `${id}-n1`, a: { kind: 'server-nic', serverId: id, vmnic: 1 }, b: { kind: 'switch', switchId: 'swB', port: i } }));
  });
  return s;
}

const ep = (id: string, kind: ServiceEndpoint['kind'], sw: string, port: number, tags: (number | null)[], extra: Partial<ServiceEndpoint> = {}): ServiceEndpoint => ({
  id, kind, attachment: { kind: 'switch-port', switchId: sw, port, tags }, mtu: 1500, ...extra,
});

/** Endpoints on swA access ports in the management VLAN (admin, DNS, NTP, installer) + DHCP. */
function withServices(s: PhysicalState, opts: { dhcp?: boolean } = {}): PhysicalState {
  const access = (port: number) => (st: PhysicalState) => u(setSwitchPortConfig(st, catalog, 'swA', port, { mode: 'access', accessVlan: MGMT, allowedVlans: 'all', nativeVlan: 1, mtu: 1500 }));
  for (const p of [40, 41, 42, 43, 44]) s = access(p)(s);
  s = u(addEndpoint(s, ep('admin', 'admin-workstation', 'swA', 40, [null])));
  s = u(addEndpoint(s, ep('dns1', 'dns', 'swA', 41, [null], { ipv4: '10.0.0.4' })));
  s = u(addEndpoint(s, ep('ntp1', 'ntp', 'swA', 42, [null], { ipv4: '10.0.0.5', fqdn: 'ntp.lab.local' })));
  s = u(addEndpoint(s, ep('inst', 'vcf-installer', 'swA', 43, [null])));
  if (opts.dhcp) s = u(addEndpoint(s, ep('dhcp1', 'dhcp', 'swA', 44, [null])));
  return s;
}

const hostPorts = (n: number) => Array.from({ length: n }, (_, i) => i);
const trunkAll = (s: PhysicalState, n: number, mtu = 1500): PhysicalState => {
  for (const sw of ['swA', 'swB']) s = u(setSwitchPortsConfig(s, catalog, sw, [...hostPorts(n), ISL_PORT], (p) => ({ ...p, mode: 'trunk', allowedVlans: 'all', mtu })));
  return s;
};
const install = (s: PhysicalState, n: number): PhysicalState => {
  for (const id of hostIds(n)) s = u(installEsxOnServer(s, id, '9.1.1'));
  return s;
};
const configure = (s: PhysicalState, n: number, vlan: number | undefined = MGMT): PhysicalState => {
  hostIds(n).forEach((id, i) => {
    s = u(configureServerManagementNetwork(s, id, { ...(vlan !== undefined ? { vlanId: vlan } : {}), ipv4Address: `10.0.0.${101 + i}`, subnetMask: '255.255.255.0', defaultGateway: '10.0.0.1', dnsServers: ['10.0.0.4'], hostnameFqdn: `${id}.lab.local`, customDnsSuffixes: [] }));
  });
  return s;
};
const plan9000: PlannedHostNetworks = { esxManagement: { vlanId: MGMT }, vmotion: { vlanId: 20, mtu: 9000 }, storage: { vlanId: 30, mtu: 9000 }, nsxHostOverlay: { vlanId: 40, mtu: 9000 } };

describe('racks (game room rules)', () => {
  it('fits devices by U, rejects overlap and overflow as game-scope', () => {
    let s = u(addRack(emptyPhysicalState(), catalog, 'r1'));
    s = u(addServer(s, catalog, 'a', cfg('dell-r670-sm')));
    s = u(addServer(s, catalog, 'b', cfg('dell-r670-sm')));
    s = u(mountDevice(s, catalog, 'a', 'r1', 1));
    expect(validateMount(s, catalog, 'b', 'r1', 2)[0]).toMatchObject({ code: 'PHYS_RACK_SLOT_OCCUPIED', scope: 'game-scope' });
    expect(validateMount(s, catalog, 'b', 'r1', 42)[0]?.code).toBe('PHYS_RACK_POSITION_INVALID');
    expect(firstFreeU(s, catalog, 'b', 'r1')).toBe(3);
  });
});

describe('cabling and links', () => {
  it('rejects used / missing ports and server-to-server cables', () => {
    const s = room(1);
    const r1 = connectCable(s, catalog, { id: 'x', a: { kind: 'server-nic', serverId: 'esx-01', vmnic: 0 }, b: { kind: 'switch', switchId: 'swA', port: 5 } });
    expect(r1.ok ? '' : r1.error.code).toBe('PHYS_PORT_IN_USE');
    const r2 = connectCable(s, catalog, { id: 'y', a: { kind: 'server-nic', serverId: 'esx-01', vmnic: 9 }, b: { kind: 'switch', switchId: 'swA', port: 5 } });
    expect(r2.ok ? '' : r2.error.code).toBe('PHYS_PORT_NOT_FOUND');
  });

  it('link speed = highest common speed; 100G NIC on a 25G switch stays down', () => {
    let s = room(1);
    expect(linkStatus(s, catalog, s.cables.find((c) => c.id === 'esx-01-n0')!)).toEqual({ up: true, speedGbE: 25 });
    s = u(addServer(s, catalog, 'big', cfg('hpe-dl380g12-lrg')));
    s = u(connectCable(s, catalog, { id: 'big-n0', a: { kind: 'server-nic', serverId: 'big', vmnic: 0 }, b: { kind: 'switch', switchId: 'swA', port: 20 } }));
    expect(linkStatus(s, catalog, s.cables.find((c) => c.id === 'big-n0')!)).toMatchObject({ up: false, reason: 'no-common-speed' });
  });

  it('switch MTU above the generic maximum is a game-scope error', () => {
    const r = setSwitchPortConfig(room(1), catalog, 'swA', 0, { mode: 'trunk', accessVlan: 1, allowedVlans: 'all', nativeVlan: 1, mtu: 9500 });
    expect(r.ok ? undefined : r.error).toMatchObject({ code: 'PHYS_MTU_OUT_OF_RANGE', scope: 'game-scope' });
  });
});

describe('ESX networking after install (25 §6.3)', () => {
  it('vSwitch0 with vmnic0, vmk0 DHCP, MTU 1500 (vmk documented, VSS game default)', () => {
    const s = install(room(1), 1);
    expect(s.servers[0]?.hostNet).toEqual({
      switches: [{ name: 'vSwitch0', kind: 'vss', uplinks: [0], mtu: 1500 }],
      vmks: [{ name: 'vmk0', switchName: 'vSwitch0', service: 'management', tag: null, mtu: 1500, addressing: 'dhcp' }],
    });
    expect(ESX_INSTALL_DEFAULTS.vmk0Mtu.source).toBe('documented');
    expect(ESX_INSTALL_DEFAULTS.vswitch0Mtu.source).toBe('game-default');
  });

  it('documented MTU maxima: VSS 9000, VMkernel 9000', () => {
    const s = install(room(1), 1);
    expect(setHostSwitchMtu(s, 'esx-01', 'vSwitch0', 9001).ok).toBe(false);
    expect(setHostSwitchMtu(s, 'esx-01', 'vSwitch0', 9000).ok).toBe(true);
    expect(setVmkMtu(s, 'esx-01', 'vmk0', 9100).ok).toBe(false);
  });

  it('DCUI VLAN must be 1–4094', () => {
    const r = configureServerManagementNetwork(install(room(1), 1), 'esx-01', { vlanId: 5000, ipv4Address: '10.0.0.1', subnetMask: '255.255.255.0', defaultGateway: '10.0.0.254', dnsServers: [], hostnameFqdn: 'a.lab.local', customDnsSuffixes: [] });
    expect(r.ok ? '' : r.error.code).toBe('PHYS_VLAN_INVALID');
  });
});

describe('traffic flows appear only when cabling + configuration allow it', () => {
  it('no flows in an empty room; no ESX flows before install', () => {
    expect(computeTrafficFlows(ctxOf(emptyPhysicalState())).flows).toEqual([]);
    const s = withServices(room(2));
    expect(computeTrafficFlows(ctxOf(s)).flows.filter((f) => f.trafficClass !== 'oob')).toEqual([]);
  });

  it('OOB is game scope: BMC flow only after the BMC is cabled into the admin network', () => {
    let s = withServices(room(1));
    expect(computeTrafficFlows(ctxOf(s)).flows).toEqual([]);
    // BMC (1G) into a 10/25G ToR port: no common speed, link down, no flow
    s = u(connectCable(s, catalog, { id: 'bmcX', a: { kind: 'server-bmc', serverId: 'esx-01' }, b: { kind: 'switch', switchId: 'swA', port: 30 } }));
    expect(computeTrafficFlows(ctxOf(s)).flows).toEqual([]);
    s = { ...s, cables: s.cables.filter((c) => c.id !== 'bmcX') };
    // BMC into the OOB switch, OOB switch uplinked (10G) to the ToR port in the admin VLAN
    s = u(setSwitchPortConfig(s, catalog, 'swA', 30, { mode: 'access', accessVlan: MGMT, allowedVlans: 'all', nativeVlan: 1, mtu: 1500 }));
    s = u(connectCable(s, catalog, { id: 'bmc1', a: { kind: 'server-bmc', serverId: 'esx-01' }, b: { kind: 'switch', switchId: 'swO', port: 0 } }));
    s = u(connectCable(s, catalog, { id: 'oob-up', a: { kind: 'switch', switchId: 'swO', port: 47 }, b: { kind: 'switch', switchId: 'swA', port: 30 } }));
    const v = computeTrafficFlows(ctxOf(s));
    expect(v.flows).toHaveLength(1);
    expect(v.flows[0]).toMatchObject({ trafficClass: 'oob', gameScope: true, cableIds: ['oob-up', 'bmc1'] });
    expect(v.uplinks.find((x) => x.port.kind === 'server-bmc')).toMatchObject({ label: 'iLO', linkUp: true, speedGbE: 1 });
    expect(bmcReachable(ctxOf(s), 'esx-01')).toBe(true);
    expect(validateOobNetwork(ctxOf(s), ['esx-01'])).toEqual([]);
  });

  it('BMC on the 1G OOB switch: link up at 1G; unreachable BMC is only a game-scope hint', () => {
    let s = withServices(room(1));
    s = u(connectCable(s, catalog, { id: 'bmc1', a: { kind: 'server-bmc', serverId: 'esx-01' }, b: { kind: 'switch', switchId: 'swO', port: 0 } }));
    expect(linkStatus(s, catalog, s.cables.find((c) => c.id === 'bmc1')!)).toEqual({ up: true, speedGbE: 1 });
    expect(validateOobNetwork(ctxOf(s), ['esx-01'])[0]).toMatchObject({ code: 'PHYS_BMC_NOT_REACHABLE', severity: 'recommendation', scope: 'game-scope' });
    // OOB never appears in the bring-up physical validation
    expect(validatePhysicalNetworkForBringup(ctxOf(s), { serverIds: ['esx-01'], plan: plan9000, storage: 'vsan-esa' }).some((i) => i.code.includes('BMC'))).toBe(false);
  });

  it('DHCP flow right after install when a DHCP server shares the untagged VLAN (25 §7 N1)', () => {
    let s = withServices(room(1), { dhcp: true });
    s = u(setSwitchPortConfig(s, catalog, 'swA', 0, { mode: 'access', accessVlan: MGMT, allowedVlans: 'all', nativeVlan: 1, mtu: 1500 }));
    s = install(s, 1);
    const f = computeTrafficFlows(ctxOf(s)).flows;
    expect(f.map((x) => x.id)).toEqual(['dhcp:esx-01:dhcp1']);
    expect(f[0]).toMatchObject({ trafficClass: 'management', fromPort: { kind: 'server-nic', serverId: 'esx-01', vmnic: 0 } });
  });

  it('tagged vmk0 on an access port gets no traffic; trunk port brings management online', () => {
    let s = configure(install(withServices(room(1)), 1), 1);
    expect(computeTrafficFlows(ctxOf(s)).flows).toEqual([]);
    s = trunkAll(s, 1);
    const ids = computeTrafficFlows(ctxOf(s)).flows.map((f) => f.id);
    expect(ids).toEqual(['hostclient:admin:esx-01']);
    expect(testManagementNetwork(ctxOf(s), 'esx-01')).toEqual({ gateway: false, dns: { dns1: true } });
  });

  it('NTP and vCenter flows follow host state (20 §7 #7, #19, #20)', () => {
    let s = trunkAll(configure(install(withServices(room(2)), 2), 2), 2);
    s = u(updateServerEsx(s, 'esx-01', (h) => configureHostNtp(h, ['ntp.lab.local'])));
    s = u(addEndpoint(s, { id: 'vc', kind: 'vcenter', attachment: { kind: 'host-vm', serverId: 'esx-01', tag: MGMT }, mtu: 1500 }));
    const v = computeTrafficFlows(ctxOf(s), { vcenterManagedServerIds: ['esx-01', 'esx-02'] });
    const ids = v.flows.map((f) => f.id);
    expect(ids).toContain('ntp:esx-01:ntp1');
    expect(ids).not.toContain('ntp:esx-02:ntp1');
    expect(ids).toEqual(expect.arrayContaining(['vc:vc:esx-01', 'hb:esx-01:vc', 'vc:vc:esx-02', 'hb:esx-02:vc']));
    expect(v.flows.find((f) => f.id === 'vc:vc:esx-01')?.cableIds).toEqual([]); // VM on the same host & vSwitch
  });

  it('installer validation activity: installer -> hosts, -> DNS, vmkping between hosts', () => {
    const s = trunkAll(configure(install(withServices(room(2)), 2), 2), 2, 9000);
    const v = computeTrafficFlows(ctxOf(s), { activities: [{ kind: 'installer-validation', plan: plan9000 }] });
    const ids = v.flows.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['inst:inst:esx-01', 'inst-dns:inst:dns1', 'vmkping-vmotion:esx-01:esx-02', 'vmkping-vsan:esx-01:esx-02', 'vmkping-tep:esx-01:esx-02']));
    expect(v.flows.every((f) => f.trigger !== 'steady' || f.id.startsWith('hostclient'))).toBe(true);
  });

  it('vSAN flows after bring-up only when the vmk MTU fits the path; aggregates per vmnic', () => {
    const base = configure(install(withServices(room(3)), 3), 3);
    const small = applyBringupHostNetworking(trunkAll(base, 3, 1500), hostIds(3), plan9000, 'vsan-esa');
    expect(computeTrafficFlows(ctxOf(small)).flows.filter((f) => f.trafficClass === 'vsan')).toEqual([]);
    const jumbo = applyBringupHostNetworking(trunkAll(base, 3, 9216), hostIds(3), plan9000, 'vsan-esa');
    const v = computeTrafficFlows(ctxOf(jumbo));
    expect(v.flows.filter((f) => f.trafficClass === 'vsan')).toHaveLength(3);
    const up = v.uplinks.filter((x) => x.serverId === 'esx-01');
    expect(up.map((x) => x.label)).toEqual(['iLO', 'vmnic0', 'vmnic1']);
    const loaded = up.filter((x) => (x.loadGbpsByClass.vsan ?? 0) > 0);
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded[0]).toMatchObject({ linkUp: true, speedGbE: 25 });
    expect(loaded[0]!.utilization).toBeCloseTo(loaded[0]!.totalLoadGbps / 25);
    const link = v.links.find((l) => l.cableId === loaded[0]!.cableId);
    expect(link?.flowIds).toEqual(loaded[0]!.flowIds);
  });
});

describe('reachability and path MTU', () => {
  it('path MTU is the minimum along the path incl. the ISL', () => {
    let s = trunkAll(install(room(2), 2), 2, 9216);
    const node = (id: string) => ({ kind: 'host-uplinks' as const, serverId: id, tag: 20, mtu: 9000 });
    expect(pathBetween(ctxOf(s), node('esx-01'), node('esx-02')).pathMtu).toBe(9000);
    // force the path over the ISL: unplug esx-02 vmnic0 so it only reaches swB
    s = { ...s, cables: s.cables.filter((c) => c.id !== 'esx-02-n0' && c.id !== 'esx-01-n1') };
    s = u(setSwitchPortConfig(s, catalog, 'swA', ISL_PORT, { mode: 'trunk', accessVlan: 1, allowedVlans: 'all', nativeVlan: 1, mtu: 1500 }));
    const p = pathBetween(ctxOf(s), node('esx-01'), node('esx-02'));
    expect(p).toMatchObject({ reachable: true, pathMtu: 1500 });
    expect(p.cableIds).toEqual(['esx-01-n0', 'isl', 'esx-02-n1']);
  });

  it('routes between VLANs only through a gateway endpoint with both interfaces', () => {
    let s = trunkAll(configure(install(room(1), 1), 1), 1);
    s = u(setSwitchPortConfig(s, catalog, 'swA', 41, { mode: 'access', accessVlan: 99, allowedVlans: 'all', nativeVlan: 1, mtu: 1500 }));
    s = u(addEndpoint(s, ep('dns1', 'dns', 'swA', 41, [null])));
    const ctx = () => ctxOf(s);
    expect(pathBetween(ctx(), { kind: 'vmk', serverId: 'esx-01', vmk: 'vmk0' }, { kind: 'endpoint', endpointId: 'dns1' }).reachable).toBe(false);
    s = u(setSwitchPortConfig(s, catalog, 'swA', 45, { mode: 'trunk', accessVlan: 1, allowedVlans: [MGMT, 99], nativeVlan: 1, mtu: 1500 }));
    s = u(addEndpoint(s, ep('gw', 'gateway', 'swA', 45, [MGMT, 99])));
    expect(pathBetween(ctx(), { kind: 'vmk', serverId: 'esx-01', vmk: 'vmk0' }, { kind: 'endpoint', endpointId: 'dns1' })).toMatchObject({ reachable: true, routedVia: 'gw' });
  });

  it('unreachableFromInstaller feeds BringupEnvironment (20 §3.3)', () => {
    let s = configure(install(withServices(room(2)), 2), 2);
    expect(unreachableFromInstaller(ctxOf(s), 'inst').sort()).toEqual(['esx-01.lab.local', 'esx-02.lab.local']);
    s = trunkAll(s, 2);
    expect(unreachableFromInstaller(ctxOf(s), 'inst')).toEqual([]);
  });
});

describe('validatePhysicalNetworkForBringup (10 §3.3; 25 §5.3, §5.4)', () => {
  const V = (s: PhysicalState, extra: Partial<Parameters<typeof validatePhysicalNetworkForBringup>[1]> = {}) =>
    validatePhysicalNetworkForBringup(ctxOf(s), { serverIds: hostIds(2), plan: plan9000, storage: 'vsan-esa', ...extra });
  const codesOf = (xs: { code: string }[]) => [...new Set(xs.map((x) => x.code))];

  it('MTU learning trap: default 1500 ports with a 9000 plan', () => {
    const issues = V(trunkAll(configure(install(room(2), 2), 2), 2));
    const vm = issues.find((i) => i.code === 'PHYS_MTU_PATH_TOO_SMALL' && i.message.includes('VMOTION'));
    expect(vm?.message).toContain('ESX host vmkping from VLAN 20 does not support MTU 9000 for network "VMOTION\'');
    expect(issues.find((i) => i.code === 'PHYS_TEP_PORT_MTU_BELOW_MIN')?.severity).toBe('error');
    expect(issues.find((i) => i.message.includes('fails vmkping'))?.message).toMatch(/ESX Host esx-01\.lab\.local with MTU 9000 fails vmkping\. Ensure that ESX Host esx-02\.lab\.local is responsive\./);
  });

  it('jumbo everywhere: only the documented recommendations remain', () => {
    const issues = V(trunkAll(configure(install(room(2), 2), 2), 2, 9216));
    expect(issues).toEqual([]);
  });

  it('TEP port 1600–1699 is a warning; Host Overlay VDS MTU < 1600 quotes KB 442925', () => {
    const s = trunkAll(configure(install(room(2), 2), 2), 2, 1650);
    const plan = { ...plan9000, vmotion: { vlanId: 20, mtu: 1500 }, storage: { vlanId: 30, mtu: 1500 }, nsxHostOverlay: { vlanId: 40, mtu: 1500 } };
    const issues = V(s, { plan });
    expect(issues.find((i) => i.code === 'PHYS_TEP_PORT_MTU_BELOW_MIN')?.severity).toBe('warning');
    expect(issues.find((i) => i.code === 'PHYS_HOST_OVERLAY_MTU_BELOW_1600')?.message).toBe('The provided MTU for Distributed vSphere Switch which is going to be used for Host Overlay is 1500. Must be at least 1600');
    expect(issues.filter((i) => i.code === 'PHYS_MTU_BELOW_RECOMMENDED')).toHaveLength(3);
  });

  it('access ports, single ToR, LAG, unconnected host', () => {
    let s = configure(install(room(2), 2), 2);
    s = { ...s, cables: s.cables.filter((c) => c.id !== 'esx-01-n1' && !c.id.startsWith('esx-02')) };
    s = u(setSwitchPortConfig(s, catalog, 'swA', 0, { mode: 'access', accessVlan: MGMT, allowedVlans: 'all', nativeVlan: 1, mtu: 1500, lagGroup: 'po1' }));
    const c = codesOf(V(s));
    expect(c).toEqual(expect.arrayContaining(['PHYS_HOST_NOT_CONNECTED', 'PHYS_SINGLE_TOR', 'PHYS_HOST_PORT_IN_LAG', 'PHYS_PORT_NOT_TRUNK']));
  });

  it('vSwitch0 with 2 uplinks (KB 415469 text)', () => {
    let s = trunkAll(configure(install(room(2), 2), 2), 2, 9216);
    s = u(setStandardSwitchUplinks(s, catalog, 'esx-01', [0, 1]));
    expect(V(s).find((i) => i.code === 'PHYS_VSWITCH0_UPLINK_COUNT')?.message).toBe('ESX Host esx-01.lab.local has 2 Physical NICs connected to vSphere Standard Switch vSwitch0 (Expecting 1)');
  });

  it('missing vSwitch0 (host already on VDS) -> "Host does not contain vSphere Standard Switch - vSwitch0"', () => {
    const s = applyBringupHostNetworking(trunkAll(configure(install(room(2), 2), 2), 2, 9216), ['esx-01'], plan9000, 'vsan-esa');
    expect(V(s).find((i) => i.code === 'PHYS_VSWITCH0_MISSING')?.message).toBe('Host does not contain vSphere Standard Switch - vSwitch0');
  });

  it('vMotion VLAN not carried: unreachable (error); vSAN unreachable: warning (KB 431776)', () => {
    let s = configure(install(room(2), 2), 2);
    for (const sw of ['swA', 'swB']) s = u(setSwitchPortsConfig(s, catalog, sw, [0, 1, ISL_PORT], (p) => ({ ...p, mode: 'trunk', allowedVlans: [MGMT, 40], mtu: 9216 })));
    const issues = V(s);
    expect(issues.find((i) => i.code === 'PHYS_NETWORK_UNREACHABLE')?.message).toContain('Failed to validate connectivity of VMOTION network');
    expect(issues.find((i) => i.code === 'PHYS_VSAN_NO_CONNECTIVITY')).toMatchObject({ severity: 'warning' });
    expect(issues.find((i) => i.code === 'PHYS_VSAN_NO_CONNECTIVITY')?.message).toContain('Possible no network connection or not reachable.');
  });

  it('1 Gbit vSwitch0 uplink fails before 9.1.1 only (KB 412127 vs RN 9.1.1)', () => {
    const cat1g = { ...catalog, nics: new Map([...catalog.nics, ['x-1g', { kind: 'nic' as const, id: 'x-1g', bomName: 'fake 1/10G', ports: 2, speedsGbE: [1, 10], speedSource: 'SIMPL' as const }]]) };
    let s = emptyPhysicalState();
    s = u(addSwitch(s, cat1g, 'swO', 'sw-generic-48x1g-oob'));
    s = u(setSwitchPortConfig(s, cat1g, 'swO', 0, { mode: 'trunk', accessVlan: 1, allowedVlans: 'all', nativeVlan: 1, mtu: 9216 }));
    s = u(addServer(s, cat1g, 'h', { ...cfg('hpe-dl380g12-med'), nics: [{ partId: 'x-1g', count: 1 }] }));
    s = u(connectCable(s, cat1g, { id: 'c', a: { kind: 'server-nic', serverId: 'h', vmnic: 0 }, b: { kind: 'switch', switchId: 'swO', port: 0 } }));
    // force 1G: drop 10G from the switch model for this check
    const only1g = { ...cat1g, switches: new Map([...cat1g.switches].map(([k, v]) => [k, k === 'sw-generic-48x1g-oob' ? { ...v, speedsGbE: [1] } : v])) };
    s = u(installEsxOnServer(s, 'h', '9.1.0'));
    const run = (version: string) => validatePhysicalNetworkForBringup({ state: s, catalog: only1g }, { serverIds: ['h'], plan: plan9000, storage: 'vsan-esa', vcfVersion: version });
    expect(run('9.1.0').find((i) => i.code === 'PHYS_VSWITCH0_UPLINK_BELOW_10G')?.message).toContain('vSphere standard switch vSwitch0 must have only one NIC as Uplink.');
    expect(run('9.1.1').some((i) => i.code === 'PHYS_VSWITCH0_UPLINK_BELOW_10G')).toBe(false);
  });

  it('NIC with no common speed: link down is a game-scope error', () => {
    let s = emptyPhysicalState();
    s = u(addSwitch(s, catalog, 'sw', 'sw-generic-32x100g'));
    s = u(addServer(s, catalog, 'h', cfg('hpe-dl380g12-med')));
    s = u(connectCable(s, catalog, { id: 'c', a: { kind: 'server-nic', serverId: 'h', vmnic: 0 }, b: { kind: 'switch', switchId: 'sw', port: 0 } }));
    s = u(installEsxOnServer(s, 'h', '9.1.1'));
    expect(validatePhysicalNetworkForBringup(ctxOf(s), { serverIds: ['h'], plan: plan9000, storage: 'vsan-esa' }).find((i) => i.code === 'PHYS_LINK_DOWN')?.scope).toBe('game-scope');
  });

  it('vSwitchBMC (KB 376173) is only a possible-cause hint', () => {
    let s = room(1);
    s = u(setBmcHostInterface(s, 'esx-01', true));
    s = install(s, 1);
    expect(s.servers[0]?.hostNet?.switches.map((x) => x.name)).toEqual(['vSwitch0', 'vSwitchBMC']);
    expect(bringupPossibleCauseHints(s, ['esx-01'])[0]).toMatchObject({ code: 'PHYS_HINT_VSWITCHBMC', severity: 'recommendation' });
    expect(validatePhysicalNetworkForBringup(ctxOf(s), { serverIds: ['esx-01'], plan: plan9000, storage: 'vsan-esa' }).some((i) => i.code === 'PHYS_HINT_VSWITCHBMC')).toBe(false);
  });
});
