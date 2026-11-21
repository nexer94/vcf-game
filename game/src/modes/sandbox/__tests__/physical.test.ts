import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../../engine';
import { DEFAULT_PRICE_TABLE, type PriceTable } from '../../economy';
import { SELECTORS, loadObjectiveSet } from '../objectives';
import { SandboxSession } from '../session';
import type { CommandResult, SandboxCommand, SandboxEvent } from '../types';
import { MINIMAL_FOOTPRINT, must } from './workbook';

const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);
const created = (r: CommandResult): string[] => (r.ok ? [...(r.created ?? [])] : []);

const FAST = { 'esx-install': 1000, 'mgmt-network-test': 1000 } as const;
const session = (prices?: PriceTable) => new SandboxSession({ taskDurationsMs: FAST, ...(prices ? { context: { prices } } : {}) });

function reject(s: SandboxSession, cmd: SandboxCommand) {
  const r = s.dispatch(cmd);
  if (r.ok) throw new Error(`${cmd.type} unexpectedly accepted`);
  return r.rejection;
}

/** Rack + switch (25G) placed / mounted; returns ids. */
function room(s: SandboxSession, servers = 4, item = 'dell-r670-med') {
  const rack = created(must(s, { type: 'placeRack', itemId: 'rack-generic-42u', tile: { gx: 2, gy: 3 } }))[0]!;
  const sw = created(must(s, { type: 'buyItem', itemId: 'sw-generic-48x25g' }))[0]!;
  must(s, { type: 'mountDevice', inventoryId: sw, rackId: rack, u: 42 });
  const hosts = servers > 0 ? created(must(s, { type: 'buyItem', itemId: item, qty: servers })) : [];
  for (const h of hosts) must(s, { type: 'mountDevice', deviceId: h, rackId: rack });
  return { rack, sw, hosts };
}

function cableAll(s: SandboxSession, sw: string, hosts: readonly string[]) {
  hosts.forEach((h, i) => must(s, { type: 'connectCable', from: { deviceId: h, port: 0 }, to: { deviceId: sw, port: i } }));
}

const run = (s: SandboxSession) => {
  for (let i = 0; i < 10 && s.state.tasks.length; i++) s.advance(60_000);
};

describe('Sandbox room – shop and economy', () => {
  it('buyItem adds to the inventory and records spent game currency (money unlimited)', () => {
    const s = session();
    const ids = created(must(s, { type: 'buyItem', itemId: 'dell-r670-med', qty: 2 }));
    expect(ids).toEqual(['esx01', 'esx02']);
    const snap = s.snapshot();
    expect(snap.physical.inventory.map((x) => x.id)).toEqual(['esx01', 'esx02']);
    expect(snap.physical.economy.moneyUnlimited).toBe(true);
    expect(snap.physical.economy.currency.gameCurrency).toBe(true);
    const price = snap.physical.catalog.items.find((x) => x.id === 'dell-r670-med')!.price;
    expect(snap.physical.economy.spent).toBe(2 * price);
    expect(snap.physical.spent).toBe(2 * price);
    expect(snap.physical.catalog.items.every((x) => x.gameCurrency)).toBe(true);
    expect(snap.physical.catalog.serverModels.length).toBeGreaterThan(100);
  });

  it('rejects unknown items, bad quantities and cables (free in the Sandbox) as flow', () => {
    const s = session();
    expect(reject(s, { type: 'buyItem', itemId: 'nope' })).toMatchObject({ kind: 'flow', reason: 'unknown-item' });
    expect(reject(s, { type: 'buyItem', itemId: 'dell-r670-med', qty: 0 })).toMatchObject({ kind: 'flow', reason: 'invalid-input' });
    expect(reject(s, { type: 'buyItem', itemId: 'cable-generic' })).toMatchObject({ kind: 'flow', reason: 'nothing-to-do' });
  });

  it('bare BCG model ids can be bought (custom build) and parts go to the parts stock', () => {
    const s = session();
    const model = s.snapshot().physical.catalog.serverModels[0]!;
    must(s, { type: 'buyItem', itemId: model.id });
    const part = created(must(s, { type: 'buyItem', itemId: 'nic-dell-cx6lx-25g-2p' }))[0]!;
    expect(s.snapshot().physical.inventory.find((x) => x.id === part)).toMatchObject({ kind: 'nic', itemId: 'nic-dell-cx6lx-25g-2p' });
  });

  it('prices never change VCF results: same commands with another price table give identical issues and flows', () => {
    const cheap: PriceTable = { ...DEFAULT_PRICE_TABLE, serverChassis: 1, perCore: 0, perRamGB: 0, rack: 0, switchDefault: 0, switchById: {} };
    const runAll = (s: SandboxSession) => {
      const { sw, hosts } = room(s, 3);
      cableAll(s, sw, hosts);
      must(s, { type: 'buyItem', itemId: 'dell-r670-undersized' });
      return s.snapshot();
    };
    const a = runAll(session());
    const b = runAll(session(cheap));
    const strip = (x: typeof a) => ({
      servers: x.physical.servers.map((v) => ({ hw: v.hw, topology: v.topology, status: v.status })),
      cluster: x.physical.clusterIssues,
      flows: x.flows.flows,
      hw: x.hw,
      design: x.design.issues,
    });
    expect(strip(b)).toEqual(strip(a));
    expect(b.physical.economy.spent).not.toBe(a.physical.economy.spent);
  });
});

describe('Sandbox room – placement', () => {
  it('places racks, mounts at the lowest free U, rejects overlaps with the model issue unchanged', () => {
    const s = session();
    const { rack, hosts } = room(s, 2);
    const v = s.snapshot().physical.racks.find((r) => r.id === rack)!;
    expect(v.placed).toBe(true);
    expect(v.tile).toEqual({ gx: 2, gy: 3 });
    expect(v.uMap[0]).toBe(hosts[0]);
    expect(v.uMap[2]).toBe(hosts[1]);
    expect(v.uMap[41]).toBe('sw01');
    const extra = created(must(s, { type: 'buyItem', itemId: 'dell-r670-med' }))[0]!;
    const r = reject(s, { type: 'mountDevice', inventoryId: extra, rackId: rack, u: 2 });
    expect(r.kind === 'validation' && codes(r.issues)).toEqual(['PHYS_RACK_SLOT_OCCUPIED']);
    expect(r.kind === 'validation' && r.issues[0]!.scope).toBe('game-scope');
  });

  it('a rack in the inventory cannot take devices; a non-empty rack cannot be removed', () => {
    const s = session();
    const rack = created(must(s, { type: 'buyItem', itemId: 'rack-generic-42u' }))[0]!;
    const srv = created(must(s, { type: 'buyItem', itemId: 'dell-r670-med' }))[0]!;
    expect(reject(s, { type: 'mountDevice', inventoryId: srv, rackId: rack })).toMatchObject({ reason: 'rack-not-placed' });
    must(s, { type: 'placeRack', inventoryId: rack, tile: { gx: 0, gy: 0 } });
    must(s, { type: 'mountDevice', inventoryId: srv, rackId: rack });
    expect(reject(s, { type: 'removeItem', id: rack })).toMatchObject({ reason: 'rack-not-empty' });
  });

  it('removeItem: mounted device -> inventory (cables gone), inventory device -> sold with full refund', () => {
    const s = session();
    const { sw, hosts } = room(s, 1);
    cableAll(s, sw, hosts);
    const spent = s.snapshot().physical.economy.spent;
    const price = s.snapshot().physical.servers[0]!.price;
    must(s, { type: 'removeItem', id: hosts[0]! });
    expect(s.snapshot().physical.cables).toEqual([]);
    expect(s.snapshot().physical.inventory.map((x) => x.id)).toContain(hosts[0]);
    must(s, { type: 'removeItem', id: hosts[0]! });
    expect(s.snapshot().physical.servers).toEqual([]);
    expect(s.snapshot().physical.economy.spent).toBe(spent - price);
  });

  it('unmountDevice disconnects cables and the company network of a switch', () => {
    const s = session();
    const { sw, hosts } = room(s, 1);
    cableAll(s, sw, hosts);
    must(s, { type: 'connectCompanyNetwork', switchId: sw });
    must(s, { type: 'unmountDevice', deviceId: sw });
    const p = s.snapshot().physical;
    expect(p.cables).toEqual([]);
    expect(p.companyNetwork).toBeUndefined();
    expect(reject(s, { type: 'unmountDevice', deviceId: sw })).toMatchObject({ reason: 'not-mounted' });
  });
});

describe('Sandbox room – cabling and switch ports', () => {
  it('connects / disconnects; model cabling issues pass through unchanged', () => {
    const s = session();
    const { sw, hosts } = room(s, 2);
    const c = created(must(s, { type: 'connectCable', from: { deviceId: hosts[0]!, port: 0 }, to: { deviceId: sw, port: 0 }, color: 'yellow', label: 'A' }))[0]!;
    let r = reject(s, { type: 'connectCable', from: { deviceId: hosts[1]!, port: 0 }, to: { deviceId: sw, port: 0 } });
    expect(r.kind === 'validation' && codes(r.issues)).toEqual(['PHYS_PORT_IN_USE']);
    r = reject(s, { type: 'connectCable', from: { deviceId: hosts[1]!, port: 0 }, to: { deviceId: hosts[0]!, port: 1 } });
    expect(r.kind === 'validation' && codes(r.issues)).toEqual(['PHYS_CABLE_INVALID']);
    r = reject(s, { type: 'connectCable', from: { deviceId: hosts[1]!, port: 9 }, to: { deviceId: sw, port: 5 } });
    expect(r.kind === 'validation' && codes(r.issues)).toEqual(['PHYS_PORT_NOT_FOUND']);
    const v = s.snapshot().physical;
    expect(v.cables[0]).toMatchObject({ id: c, color: 'yellow', label: 'A', link: { up: true, speedGbE: 25 }, aLabel: `${hosts[0]}/vmnic0` });
    expect(v.servers[0]!.nicPorts[0]).toMatchObject({ label: 'NIC 1', cableId: c, link: { up: true } });
    expect(v.switches[0]!.ports[0]!.peer).toEqual({ kind: 'server-nic', serverId: hosts[0], vmnic: 0 });
    must(s, { type: 'disconnectCable', cableId: c });
    expect(s.snapshot().physical.cables).toEqual([]);
    expect(reject(s, { type: 'disconnectCable', cableId: c })).toMatchObject({ reason: 'unknown-cable' });
  });

  it('unmounted devices cannot be cabled; the company uplink port is reserved', () => {
    const s = session();
    const { sw, hosts } = room(s, 1);
    const loose = created(must(s, { type: 'buyItem', itemId: 'dell-r670-med' }))[0]!;
    expect(reject(s, { type: 'connectCable', from: { deviceId: loose, port: 0 }, to: { deviceId: sw, port: 3 } })).toMatchObject({ reason: 'not-mounted' });
    must(s, { type: 'connectCompanyNetwork', switchId: sw, port: 47 });
    expect(reject(s, { type: 'connectCable', from: { deviceId: hosts[0]!, port: 0 }, to: { deviceId: sw, port: 47 } })).toMatchObject({ reason: 'port-reserved' });
    expect(s.snapshot().physical.switches[0]!.ports[47]!.companyUplink).toBe(true);
  });

  it('setSwitchPort validates through the model (MTU range is game scope, VLAN 1–4094 documented)', () => {
    const s = session();
    const { sw } = room(s, 0);
    must(s, { type: 'setSwitchPort', switchId: sw, port: [0, 1], config: { mode: 'trunk', vlans: [10, 20], nativeVlan: 1, mtu: 9216 } });
    expect(s.snapshot().physical.switches[0]!.ports[1]!.config).toMatchObject({ mode: 'trunk', allowedVlans: [10, 20], mtu: 9216 });
    let r = reject(s, { type: 'setSwitchPort', switchId: sw, port: 0, config: { mtu: 10000 } });
    expect(r.kind === 'validation' && r.issues[0]).toMatchObject({ code: 'PHYS_MTU_OUT_OF_RANGE', scope: 'game-scope' });
    r = reject(s, { type: 'setSwitchPort', switchId: sw, port: 0, config: { vlan: 5000 } });
    expect(r.kind === 'validation' && codes(r.issues)).toEqual(['PHYS_VLAN_INVALID']);
  });

  it('per-host topology issues (A9) come from the model: single ToR recommendation, access port', () => {
    const s = session();
    const { sw, hosts } = room(s, 1);
    expect(codes(s.snapshot().physical.servers[0]!.topology.errors)).toEqual(['PHYS_HOST_NOT_CONNECTED']);
    cableAll(s, sw, hosts);
    const t = s.snapshot().physical.servers[0]!.topology;
    expect(t.errors).toEqual([]);
    expect(codes(t.recommendations).sort()).toEqual(['PHYS_PORT_NOT_TRUNK', 'PHYS_SINGLE_TOR']);
  });
});

describe('Sandbox room – server hardware', () => {
  it('configureServer: physically impossible configs are rejected by the model; changes are charged', () => {
    const s = session();
    const srv = created(must(s, { type: 'buyItem', itemId: 'dell-r670-med' }))[0]!;
    const cfg = s.snapshot().physical.servers[0]!.config;
    const r = reject(s, { type: 'configureServer', serverId: srv, config: { ...cfg, ramGB: 999_999 } });
    expect(r.kind === 'validation' && codes(r.issues)).toEqual(['HW_EXCEEDS_MODEL_LIMIT']);
    const before = s.snapshot().physical.economy.spent;
    must(s, { type: 'configureServer', serverId: srv, config: { ...cfg, nics: [{ partId: 'nic-dell-cx6lx-25g-2p', count: 2 }] } });
    const v = s.snapshot().physical.servers[0]!;
    expect(v.nicPorts).toHaveLength(4);
    expect(v.esx.pnicCount).toBe(4);
    expect(s.snapshot().physical.economy.spent).toBeGreaterThan(before);
    // removed part goes to the spare stock
    must(s, { type: 'configureServer', serverId: srv, config: { ...cfg } });
    expect(s.snapshot().physical.inventory.filter((x) => x.kind === 'nic')).toHaveLength(1);
  });

  it('HW findings per server grouped by class; cluster issues on mixed vendors', () => {
    const s = session();
    must(s, { type: 'selectDesignOption', decision: 'principal-storage', option: 'vsan-esa' });
    must(s, { type: 'buyItem', itemId: 'dell-r670-undersized' });
    must(s, { type: 'buyItem', itemId: 'hpe-dl380g12-med' });
    const p = s.snapshot().physical;
    expect(p.servers[0]!.hw.eligible).toBe(false);
    expect(codes(p.servers[0]!.hw.byClass.REQ)).toContain('HW_ESA_CORES_BELOW_MIN');
    expect(codes(p.clusterIssues.groups.errors)).toContain('ESX_MULTIPLE_VENDORS');
  });

  it('hw design view: options limited by hardware with unlock actions', () => {
    const s = session();
    must(s, { type: 'selectDesignOption', decision: 'deployment-model', option: 'simple' });
    let o = s.snapshot().hw.options['principal-storage']!['vsan-esa']!;
    expect(o.hardware.status).toBe('no-hardware-yet');
    must(s, { type: 'buyItem', itemId: 'dell-r670-undersized', qty: 2 });
    o = s.snapshot().hw.options['principal-storage']!['vsan-esa']!;
    expect(o.hardware.status).toBe('insufficient');
    expect(o.available).toBe(false);
    expect(o.hardware.errors.map((e) => e.unlock?.kind)).toEqual(expect.arrayContaining(['buy-hosts', 'fix-host-config']));
    expect(s.snapshot().hw.context.hostCount).toBe(2);
  });

  it('configureServer is locked after ESX install', () => {
    const s = session();
    const { hosts } = room(s, 1);
    must(s, { type: 'installEsx', serverId: hosts[0]!, method: 'physical' });
    expect(reject(s, { type: 'configureServer', serverId: hosts[0]!, config: s.snapshot().physical.servers[0]!.config })).toMatchObject({ reason: 'device-busy' });
    run(s);
    expect(reject(s, { type: 'configureServer', serverId: hosts[0]!, config: s.snapshot().physical.servers[0]!.config })).toMatchObject({ reason: 'esx-installed' });
  });
});

describe('Sandbox room – ESX install, DCUI, BMC', () => {
  it('installEsx is a timed task with illustrative duration; requires a mounted server', () => {
    const s = session();
    const loose = created(must(s, { type: 'buyItem', itemId: 'dell-r670-med' }))[0]!;
    expect(reject(s, { type: 'installEsx', serverId: loose, method: 'physical' })).toMatchObject({ reason: 'not-mounted' });
    const { hosts } = room(s, 1);
    must(s, { type: 'installEsx', serverId: hosts[0]!, method: 'physical' });
    const snap = s.snapshot();
    expect(snap.physical.servers.find((x) => x.id === hosts[0])!.status).toBe('installing');
    expect(snap.tasks[0]).toMatchObject({ kind: 'esx-install', serverId: hosts[0], illustrativeDuration: true });
    run(s);
    const v = s.snapshot().physical.servers.find((x) => x.id === hosts[0])!;
    expect(v.status).toBe('esx-dhcp');
    expect(v.hostNet?.switches[0]).toMatchObject({ name: 'vSwitch0', uplinks: [0] });
    expect(v.nicPorts[0]!.label).toBe('vmnic0');
    expect(v.nicPorts[0]!.onStandardSwitch).toBe(true);
  });

  it('BMC path: not documented for Cisco (25 §10.6), needs a configured reachable BMC otherwise', () => {
    const s = session();
    const { rack, sw, hosts } = room(s, 1, 'dell-r670-med');
    const cisco = created(must(s, { type: 'buyItem', itemId: 'cisco-c220m8s-med' }))[0]!;
    must(s, { type: 'mountDevice', deviceId: cisco, rackId: rack });
    expect(reject(s, { type: 'installEsx', serverId: cisco, method: 'bmc' })).toMatchObject({ reason: 'bmc-remote-install-not-documented' });
    const dell = hosts[0]!;
    expect(reject(s, { type: 'installEsx', serverId: dell, method: 'bmc' })).toMatchObject({ reason: 'bmc-not-ready' });
    // 1 GbE BMC port + 25G switch: no common speed -> link down (model linkStatus)
    must(s, { type: 'connectCable', from: { deviceId: dell, port: 'bmc' }, to: { deviceId: sw, port: 10 } });
    expect(s.snapshot().physical.servers.find((x) => x.id === dell)!.bmcPort.link).toEqual({ up: false, reason: 'no-common-speed' });
    must(s, { type: 'disconnectCable', cableId: s.snapshot().physical.cables[0]!.id });
    const oob = created(must(s, { type: 'buyItem', itemId: 'sw-generic-48x1g-oob' }))[0]!;
    must(s, { type: 'mountDevice', deviceId: oob, rackId: rack });
    must(s, { type: 'connectCable', from: { deviceId: oob, port: 47 }, to: { deviceId: sw, port: 46 } }); // ISL at 10G
    must(s, { type: 'connectCable', from: { deviceId: dell, port: 'bmc' }, to: { deviceId: oob, port: 0 } });
    must(s, { type: 'connectCompanyNetwork', switchId: sw });
    must(s, { type: 'configureBmc', serverId: dell, ip: '10.0.99.11' });
    const v = s.snapshot().physical.servers.find((x) => x.id === dell)!;
    expect(v.bmc).toMatchObject({ cabled: true, reachableFromAdmin: true, remoteInstallDocumented: true, outOfVcfScope: true, ipv4: '10.0.99.11' });
    // BMC traffic is game-scope only (never a VCF flow)
    expect(s.snapshot().flows.flows.filter((f) => f.trafficClass === 'oob').every((f) => f.gameScope)).toBe(true);
    must(s, { type: 'installEsx', serverId: dell, method: 'bmc' });
    run(s);
    expect(s.snapshot().physical.servers.find((x) => x.id === dell)!.esx.esxVersion).toBeDefined();
  });

  it('configureMgmtNetwork before ESX: model issue ESX_NOT_INSTALLED unchanged', () => {
    const s = session();
    const { hosts } = room(s, 1);
    const r = reject(s, { type: 'configureMgmtNetwork', serverId: hosts[0]!, ip: '10.0.0.11', mask: '255.255.255.0', gw: '10.0.0.1', dns: ['10.0.0.53'], hostname: 'esx01.lab.example' });
    expect(r.kind === 'validation' && codes(r.issues)).toEqual(['ESX_NOT_INSTALLED']);
  });

  it('legacy host prep commands map onto physical servers in any phase', () => {
    const s = session();
    const { hosts } = room(s, 1);
    const id = hosts[0]!;
    must(s, { type: 'installEsx', serverId: id, method: 'physical' });
    run(s);
    must(s, { type: 'configureMgmtNetwork', serverId: id, ip: '10.0.0.11', mask: '255.255.255.0', gw: '10.0.0.1', dns: ['10.0.0.53'], hostname: 'esx01.lab.example' });
    expect(s.snapshot().phase).toBe('design');
    must(s, { type: 'configureHostNtp', hostId: id, servers: ['10.0.0.123'] });
    must(s, { type: 'setHostSsh', hostId: id, enabled: true });
    must(s, { type: 'regenerateHostCertificate', hostId: id });
    expect(s.snapshot().physical.servers[0]!.esx.certificateCn).toBe('esx01.lab.example');
    expect(reject(s, { type: 'installEsx', hostId: id, version: 'x' })).toMatchObject({ reason: 'invalid-input' });
    // physical servers are part of the planning view (bring-up environment)
    expect(s.snapshot().planning.hosts.map((h) => h.host.id)).toContain(id);
  });
});

describe('Sandbox room – undo / redo', () => {
  it('undo / redo room edits; irreversible host changes clear the history', () => {
    const s = session();
    const { sw, hosts } = room(s, 1);
    cableAll(s, sw, hosts);
    must(s, { type: 'undoRoom' });
    expect(s.snapshot().physical.cables).toEqual([]);
    must(s, { type: 'redoRoom' });
    expect(s.snapshot().physical.cables).toHaveLength(1);
    must(s, { type: 'installEsx', serverId: hosts[0]!, method: 'physical' });
    expect(reject(s, { type: 'undoRoom' })).toMatchObject({ reason: 'task-in-progress' });
    run(s);
    expect(s.snapshot().physical.undo.canUndo).toBe(false);
    expect(reject(s, { type: 'undoRoom' })).toMatchObject({ reason: 'nothing-to-do' });
  });
});

describe('Sandbox – full path to management traffic', () => {
  it('buy 4 servers + switch + rack -> mount -> cable -> install ESX -> DCUI -> management flows', () => {
    const engine = new GameEngine();
    const s = session();
    s.attachTo(engine);
    const { sw, hosts } = room(s, 4);
    cableAll(s, sw, hosts);
    must(s, { type: 'connectCompanyNetwork', switchId: sw });
    expect(s.snapshot().flows.flows.filter((f) => f.trafficClass === 'management')).toEqual([]);
    for (const h of hosts) must(s, { type: 'installEsx', serverId: h, method: 'physical' });
    engine.setSpeed(16);
    for (let i = 0; i < 200 && s.state.tasks.length; i++) engine.tick(100);
    expect(s.state.tasks).toEqual([]);
    // DHCP right after install (25 §7 N1)
    expect(s.snapshot().flows.flows.filter((f) => f.id.startsWith('dhcp:'))).toHaveLength(4);
    hosts.forEach((h, i) =>
      must(s, { type: 'configureMgmtNetwork', serverId: h, ip: `10.0.0.${11 + i}`, mask: '255.255.255.0', gw: '10.0.0.1', dns: ['10.0.0.53'], hostname: `esx0${i + 1}.lab.example` }),
    );
    const snap = s.snapshot();
    const mgmt = snap.flows.flows.filter((f) => f.trafficClass === 'management');
    expect(mgmt.filter((f) => f.id.startsWith('hostclient:'))).toHaveLength(4);
    expect(snap.flows.flows.some((f) => f.id.startsWith('dhcp:'))).toBe(false);
    expect(snap.physical.servers.every((x) => x.status === 'esx-static' && x.mgmt.gatewayReachable === true)).toBe(true);
    // per-uplink aggregates: only vmnic0 carries traffic before bring-up (25 §3.5)
    const up = snap.flows.uplinks.filter((u) => u.serverId === hosts[0]);
    expect(up.find((u) => u.label === 'vmnic0')!.totalLoadGbps).toBeGreaterThan(0);
    expect(up.find((u) => u.label === 'vmnic1')!.totalLoadGbps).toBe(0);
    expect(snap.flows.pairs.some((p) => p.trafficClass === 'management')).toBe(true);
    expect(snap.flows.illustrative).toBe(true);
    // DCUI test: activity flows while the task runs, result stored afterwards
    must(s, { type: 'testManagementNetwork', serverId: hosts[0]! });
    expect(s.snapshot().flows.flows.some((f) => f.id.startsWith('dcui-gw:'))).toBe(true);
    for (let i = 0; i < 50 && s.state.tasks.length; i++) engine.tick(100);
    const t = s.snapshot();
    expect(t.flows.flows.some((f) => f.trigger === 'activity')).toBe(false);
    expect(t.physical.servers[0]!.mgmt.lastTest).toMatchObject({ gateway: true, dns: { 'corp-dns': true } });
    // NTP flow after NTP config
    must(s, { type: 'configureHostNtp', hostId: hosts[0]!, servers: ['10.0.0.123'] });
    expect(s.snapshot().flows.flows.some((f) => f.id === `ntp:${hosts[0]}:corp-ntp`)).toBe(true);
  });

  it('a tagged management VLAN needs a trunk on the host port and the uplink', () => {
    const s = session();
    const { sw, hosts } = room(s, 1);
    cableAll(s, sw, hosts);
    must(s, { type: 'connectCompanyNetwork', switchId: sw });
    must(s, { type: 'installEsx', serverId: hosts[0]!, method: 'physical' });
    run(s);
    must(s, { type: 'configureMgmtNetwork', serverId: hosts[0]!, ip: '10.0.0.11', mask: '255.255.255.0', gw: '10.0.0.1', dns: ['10.0.0.53'], hostname: 'esx01.lab.example', vlan: 1610 });
    expect(s.snapshot().physical.servers[0]!.mgmt.gatewayReachable).toBe(false);
    expect(s.snapshot().flows.flows.filter((f) => f.trafficClass === 'management')).toEqual([]);
    must(s, { type: 'setSwitchPort', switchId: sw, port: [0, 47], config: { mode: 'trunk', vlans: [1610], nativeVlan: 1 } });
    expect(s.snapshot().physical.servers[0]!.mgmt.gatewayReachable).toBe(true);
    expect(s.snapshot().flows.flows.some((f) => f.id.startsWith('hostclient:'))).toBe(true);
  });
});

/** Objective view by id (top level or sub-step), independent of group order. */
function objective(s: SandboxSession, id: string) {
  const all = s.snapshot().objectives.groups.flatMap((g) => g.objectives.flatMap((o) => [o, ...(o.subSteps ?? [])]));
  const o = all.find((x) => x.id === id);
  if (!o) throw new Error(`objective ${id} not found`);
  return o;
}
/** Group view containing the objective `id`. */
function groupOf(s: SandboxSession, id: string) {
  const g = s.snapshot().objectives.groups.find((x) => x.objectives.some((o) => o.id === id));
  if (!g) throw new Error(`group of ${id} not found`);
  return g;
}

describe('Sandbox – objectives tracker', () => {
  it('loads the bundled objectives file without errors', () => {
    const v = new SandboxSession().snapshot().objectives;
    expect(v.available).toBe(true);
    expect(v.loadErrors).toEqual([]);
    expect(v.groups.map((g) => g.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(v.next?.id).toBe('room.rack');
  });

  it('loader rejects bad files (UX §8.8)', () => {
    const bad = loadObjectiveSet({
      version: 1,
      groups: [{ id: 'A', title: 'x' }],
      objectives: [
        { id: 'a', group: 'A', title: 't', kind: 'doc-required', selector: 'hasRack' },
        { id: 'a', group: 'Z', title: 't', kind: 'game-step', selector: 'nope' },
        { id: 'b', group: 'A', title: 't', kind: 'doc-required', selector: 'hasRack', params: { min: -1 }, why: { specRef: 'x', url: 'https://example.com/x' } },
      ],
    });
    expect(bad.objectives).toEqual([]);
    expect(bad.loadErrors.join('\n')).toMatch(/why|unknown group|unknown selector|duplicate|positive integer|https/);
    expect(bad.loadErrors.length).toBeGreaterThanOrEqual(5);
  });

  it('progress, done, skip / unskip, next step and game-optional not counted', () => {
    const s = session();
    must(s, { type: 'skipObjective', id: 'room.rack' });
    expect(objective(s, 'room.rack').state).toBe('skipped');
    expect(reject(s, { type: 'skipObjective', id: 'nope' })).toMatchObject({ reason: 'unknown-objective' });
    must(s, { type: 'unskipObjective', id: 'room.rack' });
    const { sw, hosts } = room(s, 2);
    expect(objective(s, 'room.rack').state).toBe('done');
    expect(objective(s, 'room.second-switch').state).toBe('in-progress');
    must(s, { type: 'connectCable', from: { deviceId: hosts[0]!, port: 0 }, to: { deviceId: sw, port: 0 } });
    expect(objective(s, 'cabling.each-host-to-switch')).toMatchObject({ state: 'in-progress', progress: { current: 1, target: 2 } });
    // BMC: game-optional (out of VCF scope) – never counted, its group has nothing to count
    const bmc = objective(s, 'cabling.bmc');
    expect(bmc.counted).toBe(false);
    const b = groupOf(s, 'cabling.bmc');
    expect(b.total).toBe(0);
    expect(s.snapshot().objectives.next?.id).not.toBe('cabling.bmc');
    // group total counts only counted objectives
    const a = groupOf(s, 'cabling.each-host-to-switch');
    expect(a.total).toBe(a.objectives.filter((o) => o.counted).length);
    must(s, { type: 'setObjectivesHidden', hidden: true });
    expect(s.snapshot().objectives.hidden).toBe(true);
  });

  it('regression after disconnect and after undo; completion / regression events', () => {
    const s = session();
    const events: SandboxEvent[] = [];
    s.subscribe((e) => events.push(e));
    const { sw, hosts } = room(s, 1);
    cableAll(s, sw, hosts);
    const done = () => objective(s, 'cabling.each-host-to-switch').state;
    expect(done()).toBe('done');
    expect(events.some((e) => e.type === 'sandbox/objectiveCompleted' && e.id === 'cabling.each-host-to-switch')).toBe(true);
    expect(s.state.objectives.everDone).toContain('cabling.each-host-to-switch');
    must(s, { type: 'undoRoom' });
    expect(done()).toBe('regressed');
    expect(events.some((e) => e.type === 'sandbox/objectiveRegressed' && e.id === 'cabling.each-host-to-switch')).toBe(true);
    must(s, { type: 'redoRoom' });
    expect(done()).toBe('done');
    must(s, { type: 'disconnectCable', cableId: s.snapshot().physical.cables[0]!.id });
    expect(done()).toBe('regressed');
    // unmounting the server keeps it regressed
    must(s, { type: 'removeItem', id: hosts[0]! });
    expect(done()).toBe('regressed');
    // game-step objectives never regress: empty the rack and take it back to the inventory
    must(s, { type: 'unmountDevice', deviceId: sw });
    must(s, { type: 'removeItem', id: s.snapshot().physical.racks[0]!.id });
    expect(objective(s, 'room.rack').state).toBe('pending');
  });

  it('designDecided / serversForDesign take the host minimum from the model', () => {
    const s = session();
    for (const [k, v] of Object.entries(MINIMAL_FOOTPRINT)) must(s, { type: 'selectDesignOption', decision: k as keyof typeof MINIMAL_FOOTPRINT, option: v! });
    must(s, { type: 'acknowledgeDesignWarnings' });
    must(s, { type: 'advancePhase' });
    const o = objective(s, 'room.host-count');
    expect(o.progress).toEqual({ current: 0, target: 3 }); // vSAN Simple single-rack: 3 (10 §6.1, model)
  });
});

describe('Sandbox – objectives: DNS, switch ports, uplinks, homogeneity, use case', () => {
  /** One host cabled (vmnic0 -> p1), company network, ESX installed, DCUI management with VLAN 1610. */
  function mgmtHost(s: SandboxSession) {
    const { sw, hosts } = room(s, 1);
    cableAll(s, sw, hosts);
    must(s, { type: 'connectCompanyNetwork', switchId: sw });
    must(s, { type: 'installEsx', serverId: hosts[0]!, method: 'physical' });
    run(s);
    must(s, { type: 'configureMgmtNetwork', serverId: hosts[0]!, ip: '10.0.0.11', mask: '255.255.255.0', gw: '10.0.0.1', dns: ['10.0.0.53'], hostname: 'esx01.lab.example', vlan: 1610 });
    return { sw, host: hosts[0]! };
  }

  it('hostDnsRecordsValid: A + PTR to the vmk0 IP (model validateDnsRecords), DNS editable before the design', () => {
    const s = session();
    mgmtHost(s);
    expect(s.state.phase).toBe('design');
    expect(objective(s, 'hosts.dns-records')).toMatchObject({ state: 'pending', progress: { current: 0, target: 1 } });
    must(s, { type: 'addDnsRecord', fqdn: 'esx01.lab.example', ip: '10.0.0.11', records: 'a' });
    expect(objective(s, 'hosts.dns-records').state).toBe('pending'); // PTR missing
    must(s, { type: 'addDnsRecord', fqdn: 'esx01.lab.example', ip: '10.0.0.11', records: 'ptr' });
    expect(objective(s, 'hosts.dns-records').state).toBe('done');
    // A record pointing elsewhere = DNS_IP_MISMATCH in the model -> not satisfied
    must(s, { type: 'addDnsRecord', fqdn: 'esx01.lab.example', ip: '10.0.0.99' });
    expect(objective(s, 'hosts.dns-records').state).toBe('regressed');
  });

  it('switchPortsTrunkVlans / switchMtuForTraffic: management VLAN first, wizard plan VLANs and MTU later', () => {
    const s = session();
    const { sw } = mgmtHost(s);
    expect(objective(s, 'network.trunk-vlans').state).toBe('pending'); // access port
    expect(objective(s, 'network.mtu').state).toBe('done'); // management only: 1500
    expect(objective(s, 'network.mtu-9000').state).toBe('pending');
    must(s, { type: 'setSwitchPort', switchId: sw, port: 0, config: { mode: 'trunk', vlans: [1610], nativeVlan: 1 } });
    expect(objective(s, 'network.trunk-vlans').state).toBe('done');

    // wizard plan (Network details): vMotion 9000, Host TEP 1700
    const plan = { esxManagement: { vlanId: 1610 }, vmotion: { vlanId: 1611, mtu: 9000 }, storage: { vlanId: 1612, mtu: 9000 }, nsxHostOverlay: { vlanId: 1613, mtu: 1700 } };
    const withPlan = () => {
      const snap = s.snapshot();
      return { ...snap, physical: { ...snap.physical, plan } };
    };
    const trunk = () => SELECTORS['switchPortsTrunkVlans']!.evaluate(withPlan(), { min: 'all' }).done;
    const mtu = () => SELECTORS['switchMtuForTraffic']!.evaluate(withPlan(), { min: 'all' }).done;
    const mtu9000 = () => SELECTORS['switchMtuForTraffic']!.evaluate(withPlan(), { min: 'all', recommended: true }).done;
    expect(trunk()).toBe(false);
    must(s, { type: 'setSwitchPort', switchId: sw, port: 0, config: { vlans: [1610, 1611, 1612, 1613] } });
    expect(trunk()).toBe(true);
    expect(mtu()).toBe(false); // carries vMotion / vSAN 9000
    must(s, { type: 'setSwitchPort', switchId: sw, port: 0, config: { mtu: 1700 } });
    expect(mtu()).toBe(false);
    must(s, { type: 'setSwitchPort', switchId: sw, port: 0, config: { mtu: 9000 } });
    expect(mtu()).toBe(true);
    expect(mtu9000()).toBe(true);
    // TEP only (no jumbo planned): 1700 is the documented minimum for TEP ports
    const tepOnly = { ...plan, vmotion: { vlanId: 1611, mtu: 1500 }, storage: { vlanId: 1612, mtu: 1500 } };
    const tepMtuOk = () => {
      const x = s.snapshot();
      return SELECTORS['switchMtuForTraffic']!.evaluate({ ...x, physical: { ...x.physical, plan: tepOnly } }, { min: 'all' }).done;
    };
    must(s, { type: 'setSwitchPort', switchId: sw, port: 0, config: { mtu: 1600 } });
    expect(tepMtuOk()).toBe(false);
    must(s, { type: 'setSwitchPort', switchId: sw, port: 0, config: { mtu: 1700 } });
    expect(tepMtuOk()).toBe(true);
  });

  it('hostsWithUplinks: 1 without a VDS model, 2 for Single Distributed Switch (model nicRequirementForVdsModel)', () => {
    const s = session();
    const { sw, hosts } = room(s, 1);
    cableAll(s, sw, hosts);
    expect(objective(s, 'network.uplinks')).toMatchObject({ state: 'done', progress: { current: 1, target: 1 } });
    must(s, { type: 'selectDesignOption', decision: 'distributed-switch-model', option: 'single' });
    expect(objective(s, 'network.uplinks').state).toBe('regressed');
    expect(SELECTORS['hostsWithUplinks']!.evaluate(s.snapshot(), { min: 'all', nics: 'design' })).toMatchObject({ done: false, current: 0, target: 1 });
    must(s, { type: 'connectCable', from: { deviceId: hosts[0]!, port: 1 }, to: { deviceId: sw, port: 1 } });
    expect(objective(s, 'network.uplinks').state).toBe('done');
    expect(SELECTORS['hostsWithUplinks']!.evaluate(s.snapshot(), { min: 'all', nics: 3 }).done).toBe(false);
  });

  it('serversHomogeneous: one vendor, same configuration (model validateClusterHardware)', () => {
    const s = session();
    expect(objective(s, 'room.homogeneous').state).toBe('pending');
    must(s, { type: 'buyItem', itemId: 'dell-r670-med', qty: 2 });
    expect(objective(s, 'room.homogeneous').state).toBe('done');
    const odd = created(must(s, { type: 'buyItem', itemId: 'dell-r670-undersized' }))[0]!;
    expect(objective(s, 'room.homogeneous').state).toBe('regressed');
    must(s, { type: 'removeItem', id: odd });
    expect(objective(s, 'room.homogeneous').state).toBe('done');
  });

  it('chooseUseCase records id + spec ref, exposes useCase in the snapshot, game-scope limits from the model', () => {
    const s = session();
    expect(s.snapshot().useCase).toBeUndefined();
    expect(objective(s, 'design.use-case').state).toBe('pending');
    must(s, { type: 'chooseUseCase', useCaseId: 'UC-1' });
    expect(s.state.useCase).toEqual({ id: 'UC-1', specRef: '25 §2.1, §4.1 [U4][U3]' });
    expect(s.snapshot().useCase).toMatchObject({ id: 'UC-1', modelled: true, limitations: [] });
    expect(s.snapshot().useCase?.gameScopeNote).toBeUndefined();
    expect(objective(s, 'design.use-case').state).toBe('done');
    expect(reject(s, { type: 'chooseUseCase', useCaseId: 'UC-1' })).toMatchObject({ kind: 'flow', reason: 'nothing-to-do' });
    must(s, { type: 'chooseUseCase', useCaseId: 'UC-5' });
    const uc5 = s.snapshot().useCase!;
    expect(uc5.modelled).toBe(false);
    expect(uc5.gameScopeNote).toMatch(/Herní omezení/);
    expect(uc5.limitations.map((i) => [i.code, i.scope])).toEqual([['CONVERGENCE_NOT_MODELLED', 'game-scope']]);
    must(s, { type: 'chooseUseCase', useCaseId: 'UC-4' });
    expect(s.snapshot().useCase).toMatchObject({ id: 'UC-4', modelled: false, limitations: [] });
    expect(reject(s, { type: 'chooseUseCase', useCaseId: 'UC-99' as never })).toMatchObject({ kind: 'flow', reason: 'invalid-input' });
    must(s, { type: 'chooseUseCase', useCaseId: null });
    expect(s.state.useCase).toBeUndefined();
    expect(reject(s, { type: 'chooseUseCase', useCaseId: null })).toMatchObject({ kind: 'flow', reason: 'nothing-to-do' });
  });

  it('loader validates the new param kinds (nics, flag)', () => {
    const bad = loadObjectiveSet({
      version: 1,
      groups: [{ id: 'A', title: 'x' }],
      objectives: [
        { id: 'a', group: 'A', title: 't', kind: 'game-step', selector: 'hostsWithUplinks', params: { nics: 'all' } },
        { id: 'b', group: 'A', title: 't', kind: 'game-step', selector: 'switchMtuForTraffic', params: { recommended: 'yes' } },
      ],
    });
    expect(bad.loadErrors.join('\n')).toMatch(/positive integer or "design"/);
    expect(bad.loadErrors.join('\n')).toMatch(/true or false/);
  });
});
