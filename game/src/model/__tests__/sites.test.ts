import { describe, expect, it } from 'vitest';
import { buildHardwareCatalog } from '../hardwareCatalog';
import { hardwareContext, optionAvailabilityWithHardware } from '../hardwareDesign';
import { type PhysicalState, addRack, addServer, addSwitch, connectCable, emptyPhysicalState, linkStatus, mountDevice, pathBetween } from '../physical';
import {
  DESIGN_BLUEPRINTS,
  LAYOUT_BLUEPRINTS,
  SITE_LAYOUTS,
  SITE_LAYOUT_IDS,
  STRETCHED_INTER_AZ_REQUIREMENTS,
  type SiteLayoutId,
  MULTI_AZ_NETWORK_SPAN,
  STRETCHED_VSAN_BLUEPRINT_MINIMUMS,
  WITNESS_LINK_REQUIREMENTS,
  assignRoomRole,
  availabilityZones,
  checkHostsPerAz,
  checkWitnessFaultDomain,
  checkInterAzLink,
  chooseSiteLayout,
  layoutsSupporting,
  minStretchedHosts,
  moveRackToRoom,
  validateRoomCapacity,
  roomPath,
  setSiteLink,
  siteStateFor,
} from '../sites';
import { DESIGN_DECISIONS, validateDesign } from '../design';
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
const STARTER = 'hpe-dl380g12-med';

/** Layout with roles assigned and `hostsPerRoom` hosts mounted in a rack per listed room. */
function build(layout: SiteLayoutId, roles: Record<string, 'az1' | 'az2' | 'witness' | 'secondary-instance' | null>, hostsPerRoom: Record<string, number> = {}): PhysicalState {
  let s = emptyPhysicalState(layout);
  for (const [room, role] of Object.entries(roles)) s = u(assignRoomRole(s, room, role));
  let k = 0;
  for (const [room, n] of Object.entries(hostsPerRoom)) {
    const rack = `rack-${room}`;
    s = u(addRack(s, catalog, rack, 'rack-generic-42u', room));
    for (let i = 0; i < n; i++) {
      const id = `esx-${String(++k).padStart(2, '0')}`;
      s = u(addServer(s, catalog, id, cfg(STARTER), STARTER));
      s = u(mountDevice(s, catalog, id, rack, 1 + i * 2));
    }
  }
  return s;
}
const fleet = (s: PhysicalState, option: string, choices = {}) => optionAvailabilityWithHardware('fleet-deployment-model', option, choices, hardwareContext(s, catalog));

describe('site layout presets', () => {
  it('every preset is game data with rooms belonging to a site and building; default is small-room', () => {
    expect(emptyPhysicalState().sites.layoutId).toBe('small-room');
    for (const id of SITE_LAYOUT_IDS) {
      const l = SITE_LAYOUTS[id];
      expect(l.gameDefault).toBe(true);
      for (const r of l.rooms) {
        expect(l.sites.map((x) => x.id)).toContain(r.siteId);
        expect(l.buildings.find((b) => b.id === r.buildingId)?.siteId).toBe(r.siteId);
        expect(r.rackSlots).toBeGreaterThan(0);
      }
      for (const k of l.links) expect(k.gameDefault).toBe(true);
      expect(l.defaultAssignment[l.rooms[0]?.id ?? '']).toBe('az1');
    }
    expect(SITE_LAYOUTS['large-room'].rooms[0]?.rackSlots).toBeGreaterThan(SITE_LAYOUTS['small-room'].rooms[0]?.rackSlots ?? 0);
    expect(SITE_LAYOUTS['remote-dr'].sites).toHaveLength(2);
  });

  it('game links: rooms of one building and campus buildings within the stretched limits, remote DR clearly outside', () => {
    expect(STRETCHED_INTER_AZ_REQUIREMENTS).toMatchObject({ minBandwidthGbps: 10, maxRttMsExclusive: 5 });
    const ok = (l: SiteLayoutId, a: string, b: string) => {
      const p = roomPath(siteStateFor(l), a, b);
      return p !== undefined && p.rttMs < 5 && p.bandwidthGbps >= 10;
    };
    expect(ok('two-rooms-one-building', 'room-a1', 'room-a2')).toBe(true);
    expect(ok('two-buildings', 'room-a1', 'room-b1')).toBe(true);
    const wan = roomPath(siteStateFor('remote-dr'), 'room-a1', 'room-b1');
    expect(wan?.rttMs).toBeGreaterThanOrEqual(5 * 4);
    expect(wan?.bandwidthGbps).toBeLessThan(10);
  });

  it('five fleet blueprints from 06 with fleet model, hosts and installer settings; choices use existing option ids', () => {
    const bps = Object.values(DESIGN_BLUEPRINTS);
    expect(bps.map((b) => [b.fleetModel, b.hostGroups.map((h) => h.esxHosts), b.installer.deploymentModel, b.installer.size])).toEqual([
      ['basic', [3], 'simple', 'small'],
      ['basic', [4], 'high-availability', 'medium'],
      ['site-high-availability', [4, 4], 'high-availability', 'medium'],
      ['disaster-recovery', [4, 4], 'high-availability', 'medium'],
      ['fault-domains-and-dr', [4, 4, 4], 'high-availability', 'medium'],
    ]);
    for (const bp of bps) {
      expect(bp.url).toMatch(/^https:\/\/techdocs\.broadcom\.com\/.+9-1\/design\/design-blueprints-for\//);
      expect(bp.specRef).toMatch(/^06 §/);
      expect(bp.documentedChoices['fleet-deployment-model']).toBe(bp.fleetModel);
      for (const [dec, opt] of Object.entries({ ...bp.documentedChoices, ...bp.day2Choices }))
        expect(DESIGN_DECISIONS.find((d) => d.id === dec)?.options.map((o) => o.id)).toContain(opt);
    }
    // Day-0 choices of every blueprint pass the design constraints (stretched mgmt cluster is Day 2 -> day2Choices)
    for (const bp of bps) expect([bp.id, validateDesign(bp.documentedChoices).filter((i) => i.severity === 'error' && i.code !== 'DESIGN_DECISION_MISSING').map((i) => `${i.code}: ${i.message}`)]).toEqual([bp.id, []]);
    expect(DESIGN_BLUEPRINTS['vcf-fleet-multiple-sites-single-region'].day2Choices).toEqual({ 'mgmt-cluster-model': 'stretched' });
  });

  it('layout -> blueprint mapping per 06 §7a; every layout supports its blueprint fleet model', () => {
    expect(Object.fromEntries(SITE_LAYOUT_IDS.map((id) => [id, LAYOUT_BLUEPRINTS[id].blueprintId]))).toEqual({
      'small-room': 'vcf-fleet-single-site-minimal-footprint',
      'large-room': 'vcf-fleet-single-site',
      'two-rooms-one-building': 'vcf-fleet-multiple-sites-single-region',
      'two-buildings': 'vcf-fleet-multiple-sites-single-region',
      'remote-dr': 'vcf-fleet-across-multiple-regions',
      'two-buildings-plus-dr': 'vcf-fleet-single-region-plus-additional-regions',
    });
    const cap = { basic: undefined, 'site-high-availability': 'stretched', 'disaster-recovery': 'secondary-instance', 'fault-domains-and-dr': 'fault-domains-and-dr' } as const;
    for (const id of SITE_LAYOUT_IDS) {
      const c = cap[DESIGN_BLUEPRINTS[LAYOUT_BLUEPRINTS[id].blueprintId].fleetModel];
      if (c) expect(layoutsSupporting(c)).toContain(id);
    }
  });

  it('layout capabilities: stretched needs a linked pair within limits + a third room; FD+DR needs four rooms', () => {
    expect(layoutsSupporting('stretched')).toEqual(['two-rooms-one-building', 'two-buildings', 'two-buildings-plus-dr']);
    expect(layoutsSupporting('secondary-instance')).toEqual(['two-rooms-one-building', 'two-buildings', 'remote-dr', 'two-buildings-plus-dr']);
    expect(layoutsSupporting('fault-domains-and-dr')).toEqual(['two-buildings-plus-dr']);
  });
});

describe('rooms, racks and layout changes', () => {
  it('racks get the first room by default; room capacity is enforced (game)', () => {
    let s = emptyPhysicalState();
    for (let i = 1; i <= 4; i++) s = u(addRack(s, catalog, `r${i}`));
    expect(s.racks.every((r) => r.roomId === 'room-a1')).toBe(true);
    const r = addRack(s, catalog, 'r5');
    expect(r.ok ? undefined : r.error).toMatchObject({ code: 'SITE_ROOM_FULL', scope: 'game-scope' });
    expect(addRack(s, catalog, 'rx', 'rack-generic-42u', 'nope')).toMatchObject({ ok: false, error: { code: 'SITE_ROOM_NOT_FOUND' } });
  });

  it('layout can be chosen only before racks exist; moving racks between rooms', () => {
    let s = u(chooseSiteLayout(emptyPhysicalState(), 'two-buildings'));
    expect(s.sites.rooms).toHaveLength(3);
    s = u(addRack(s, catalog, 'r1'));
    expect(chooseSiteLayout(s, 'small-room')).toMatchObject({ ok: false, error: { code: 'SITE_LAYOUT_INVALID' } });
    s = u(moveRackToRoom(s, 'r1', 'room-b1'));
    expect(s.racks[0]?.roomId).toBe('room-b1');
    s = u(addRack(s, catalog, 'r2', 'rack-generic-42u', 'room-c1'));
    expect(moveRackToRoom(s, 'r1', 'room-c1')).toMatchObject({ ok: false, error: { code: 'SITE_ROOM_FULL' } });
  });

  it('occupiesSlot: racks that take no slot (inventory) are not counted and are not limited (game)', () => {
    const placed = new Set(['r1']);
    const opts = { occupiesSlot: (id: string) => placed.has(id) };
    let s = u(chooseSiteLayout(emptyPhysicalState(), 'two-buildings'));
    s = u(addRack(s, catalog, 'r1', 'rack-generic-42u', 'room-c1', opts)); // room-c1: 1 slot
    s = u(addRack(s, catalog, 'r2', 'rack-generic-42u', 'room-c1', opts)); // inventory rack: no slot
    expect(validateRoomCapacity(s, 'room-c1', 'r3', opts)).toEqual([]);
    placed.add('r3');
    expect(validateRoomCapacity(s, 'room-c1', 'r3', opts).map((i) => i.code)).toEqual(['SITE_ROOM_FULL']);
    s = u(addRack(s, catalog, 'r4', 'rack-generic-42u', 'room-a1', opts));
    placed.add('r4');
    expect(moveRackToRoom(s, 'r4', 'room-c1', opts)).toMatchObject({ ok: false, error: { code: 'SITE_ROOM_FULL' } });
    placed.delete('r1');
    expect(moveRackToRoom(s, 'r4', 'room-c1', opts).ok).toBe(true);
    // default (no predicate): every assigned rack counts
    expect(validateRoomCapacity(s, 'room-c1').map((i) => i.code)).toEqual(['SITE_ROOM_FULL']);
  });

  it('AZ assignment drives availability zones and hosts per AZ', () => {
    const s = build('two-rooms-one-building', { 'room-a2': 'az2', 'room-a3': 'witness' }, { 'room-a1': 2, 'room-a2': 3 });
    const azs = availabilityZones(s);
    expect(azs.map((a) => [a.role, a.roomIds, a.hostIds.length])).toEqual([
      ['az1', ['room-a1'], 2],
      ['az2', ['room-a2'], 3],
      ['witness', ['room-a3'], 0],
    ]);
    expect(assignRoomRole(s, 'room-zz', 'az2')).toMatchObject({ ok: false, error: { code: 'SITE_ROOM_NOT_FOUND' } });
    const un = u(assignRoomRole(s, 'room-a2', null));
    expect(availabilityZones(un).map((a) => a.role)).toEqual(['az1', 'witness']);
  });
});

describe('inter-AZ link vs. documented stretched requirements (10 §3.3 [P13])', () => {
  it('second AZ missing / not linked / ok', () => {
    expect(checkInterAzLink(siteStateFor('small-room'))).toMatchObject({ status: 'no-second-az', issues: [{ code: 'SITE_SECOND_AZ_MISSING', severity: 'error' }] });
    const ok = build('two-buildings', { 'room-b1': 'az2' });
    expect(checkInterAzLink(ok.sites)).toMatchObject({ status: 'ok', rttMs: 1, bandwidthGbps: 100, issues: [] });
  });

  it('remote site as AZ2 violates RTT and bandwidth (errors)', () => {
    const s = build('remote-dr', { 'room-b1': 'az2' });
    const r = checkInterAzLink(s.sites);
    expect(r.status).toBe('outside-limits');
    expect(r.issues.map((i) => [i.code, i.severity])).toEqual([
      ['SITE_INTER_AZ_RTT_TOO_HIGH', 'error'],
      ['SITE_INTER_AZ_BANDWIDTH_TOO_LOW', 'error'],
    ]);
  });

  it('RTT must be strictly below 5 ms; 10 Gbps is enough', () => {
    let s = build('two-buildings', { 'room-b1': 'az2' });
    // the best path may detour via the witness building (2 + 2 ms) – slow those links down first
    s = u(setSiteLink(s, 'link-a1-c1', { rttMs: 20 }));
    s = u(setSiteLink(s, 'link-a1-b1', { rttMs: 5, bandwidthGbps: 10 }));
    expect(checkInterAzLink(s.sites).issues.map((i) => i.code)).toEqual(['SITE_INTER_AZ_RTT_TOO_HIGH']);
    s = u(setSiteLink(s, 'link-a1-b1', { rttMs: 4.9 }));
    expect(checkInterAzLink(s.sites).status).toBe('ok');
    expect(setSiteLink(s, 'link-a1-b1', { bandwidthGbps: 0 })).toMatchObject({ ok: false, error: { code: 'SITE_LINK_INVALID' } });
  });

  it('witness: third location, RTT ≤ 200 ms from every AZ room (06 §6.4 [B11]), linked', () => {
    let s = build('two-buildings-plus-dr', { 'room-b1': 'az2', 'room-r1': 'witness' });
    // remote room as witness: 40 ms via WAN from AZ1, 41 ms from AZ2 – within 200 ms
    expect(checkWitnessFaultDomain(s.sites)).toEqual([]);
    s = u(setSiteLink(s, 'link-a1-r1', { rttMs: 200 }));
    expect(checkWitnessFaultDomain(s.sites).map((i) => [i.code, i.subject])).toEqual([['SITE_WITNESS_RTT_TOO_HIGH', 'room-b1<->room-r1']]);
    s = u(setSiteLink(s, 'link-a1-r1', { rttMs: 250 }));
    expect(checkWitnessFaultDomain(s.sites).map((i) => i.code)).toEqual(['SITE_WITNESS_RTT_TOO_HIGH', 'SITE_WITNESS_RTT_TOO_HIGH']);
    expect(WITNESS_LINK_REQUIREMENTS.maxRttMs).toBe(200);
    expect(checkWitnessFaultDomain(build('remote-dr', { 'room-b1': 'az2' }).sites).map((i) => i.code)).toEqual(['SITE_WITNESS_FAULT_DOMAIN_MISSING']);
  });

  it('game witness links of all presets are within the documented 200 ms', () => {
    for (const id of SITE_LAYOUT_IDS) {
      const st = siteStateFor(id);
      for (const a of st.rooms) for (const b of st.rooms) expect(roomPath(st, a.id, b.id)?.rttMs ?? 0).toBeLessThanOrEqual(WITNESS_LINK_REQUIREMENTS.maxRttMs);
    }
  });

  it('stretched host minimums from 10 §6.1 (per AZ = half)', () => {
    expect(minStretchedHosts('simple', 'vsan-esa')).toMatchObject({ total: 6, perAz: 3, assumed: false });
    expect(minStretchedHosts('high-availability', 'vsan-esa')).toMatchObject({ total: 8, perAz: 4 });
    expect(minStretchedHosts('simple', 'nfs-v3')).toMatchObject({ total: 2, perAz: 1 });
    expect(minStretchedHosts('high-availability', 'vmfs-fc')).toMatchObject({ total: 6, perAz: 3 });
    expect(minStretchedHosts()).toMatchObject({ total: 2, assumed: true });
    // 06 §6.1 [B11]: mgmt initial cluster HA min 8 (Day 2), WLD min 6 (3 per site)
    expect(STRETCHED_VSAN_BLUEPRINT_MINIMUMS).toMatchObject({ managementInitialClusterHa: { total: 8, perAz: 4, day2: true }, workloadDomainCluster: { total: 6, perAz: 3 } });
    expect(MULTI_AZ_NETWORK_SPAN.stretchedL2).toContain('vm-management');
    expect(MULTI_AZ_NETWORK_SPAN.azLocalRouted).toEqual(['esx-management', 'vmotion', 'ip-storage', 'host-tep']);
  });
});

describe('cabling across rooms (game abstraction)', () => {
  function twoRooms(layout: SiteLayoutId, roomB: string): PhysicalState {
    let s = emptyPhysicalState(layout);
    s = u(addRack(s, catalog, 'rA', 'rack-generic-42u', 'room-a1'));
    s = u(addRack(s, catalog, 'rB', 'rack-generic-42u', roomB));
    s = u(addSwitch(s, catalog, 'swA', 'sw-generic-48x25g'));
    s = u(addSwitch(s, catalog, 'swB', 'sw-generic-48x25g'));
    s = u(mountDevice(s, catalog, 'swA', 'rA', 42));
    s = u(mountDevice(s, catalog, 'swB', 'rB', 42));
    s = u(addServer(s, catalog, 'esx-01', cfg(STARTER), STARTER));
    s = u(mountDevice(s, catalog, 'esx-01', 'rA', 1));
    return s;
  }

  it('server cannot be cabled to a switch in another room; switch uplink over the link works', () => {
    let s = twoRooms('two-buildings', 'room-b1');
    const bad = connectCable(s, catalog, { id: 'c1', a: { kind: 'server-nic', serverId: 'esx-01', vmnic: 0 }, b: { kind: 'switch', switchId: 'swB', port: 0 } });
    expect(bad).toMatchObject({ ok: false, error: { code: 'SITE_CROSS_ROOM_CABLE_INVALID', scope: 'game-scope' } });
    s = u(connectCable(s, catalog, { id: 'isl', a: { kind: 'switch', switchId: 'swA', port: 47 }, b: { kind: 'switch', switchId: 'swB', port: 47 } }));
    const isl = s.cables.find((c) => c.id === 'isl');
    expect(isl && linkStatus(s, catalog, isl)).toMatchObject({ up: true, speedGbE: 25, interRoomLinkIds: ['link-a1-b1'] });
  });

  it('uplink over the WAN is capped by the link bandwidth', () => {
    let s = twoRooms('remote-dr', 'room-b1');
    s = u(connectCable(s, catalog, { id: 'isl', a: { kind: 'switch', switchId: 'swA', port: 47 }, b: { kind: 'switch', switchId: 'swB', port: 47 } }));
    const isl = s.cables.find((c) => c.id === 'isl');
    expect(isl && linkStatus(s, catalog, isl).speedGbE).toBe(1);
  });

  it('a cable that ends up crossing unlinked rooms (rack moved) is down and breaks reachability', () => {
    let s = emptyPhysicalState('two-rooms-one-building');
    s = u(setSiteLink(s, 'link-a1-a2', { rttMs: 0.5 }));
    s = u(addRack(s, catalog, 'rA', 'rack-generic-42u', 'room-a1'));
    s = u(addSwitch(s, catalog, 'swA', 'sw-generic-48x25g'));
    s = u(mountDevice(s, catalog, 'swA', 'rA', 42));
    s = u(addServer(s, catalog, 'esx-01', cfg(STARTER), STARTER));
    s = u(mountDevice(s, catalog, 'esx-01', 'rA', 1));
    s = u(addServer(s, catalog, 'esx-02', cfg(STARTER), STARTER));
    s = u(mountDevice(s, catalog, 'esx-02', 'rA', 3));
    s = u(connectCable(s, catalog, { id: 'c1', a: { kind: 'server-nic', serverId: 'esx-01', vmnic: 0 }, b: { kind: 'switch', switchId: 'swA', port: 0 } }));
    s = u(connectCable(s, catalog, { id: 'c2', a: { kind: 'server-nic', serverId: 'esx-02', vmnic: 0 }, b: { kind: 'switch', switchId: 'swA', port: 1 } }));
    const node = (id: string) => ({ kind: 'host-uplinks' as const, serverId: id, tag: null, mtu: 1500 });
    expect(pathBetween({ state: s, catalog }, node('esx-01'), node('esx-02')).reachable).toBe(true);
    // move esx-02 into a rack in another room: its cable to swA now crosses rooms server -> switch => down
    s = u(addRack(s, catalog, 'rB', 'rack-generic-42u', 'room-a2'));
    s = u(mountDevice(s, catalog, 'esx-02', 'rB', 1));
    const c2 = s.cables.find((c) => c.id === 'c2');
    expect(c2 && linkStatus(s, catalog, c2)).toMatchObject({ up: false, reason: 'cross-room-invalid' });
    expect(pathBetween({ state: s, catalog }, node('esx-01'), node('esx-02')).reachable).toBe(false);
  });
});

describe('design availability per layout', () => {
  it('small-room: Basic ok; Site HA / DR / FD+DR blocked with unlock actions', () => {
    const s = emptyPhysicalState();
    expect(fleet(s, 'basic')).toMatchObject({ available: true, site: { status: 'not-site-dependent' } });
    const ha = fleet(s, 'site-high-availability');
    expect(ha.available).toBe(false);
    expect(ha.site.errors.map((e) => e.issue.code)).toEqual(['SITE_SECOND_AZ_MISSING', 'SITE_WITNESS_FAULT_DOMAIN_MISSING']);
    expect(ha.site.errors[0]?.unlock).toEqual({ kind: 'choose-site-layout', layoutIds: ['two-rooms-one-building', 'two-buildings', 'two-buildings-plus-dr'] });
    const dr = fleet(s, 'disaster-recovery');
    expect(dr.site.errors[0]).toMatchObject({ issue: { code: 'SITE_SECONDARY_LOCATION_MISSING' }, unlock: { kind: 'choose-site-layout', layoutIds: ['two-rooms-one-building', 'two-buildings', 'remote-dr', 'two-buildings-plus-dr'] } });
    const fd = fleet(s, 'fault-domains-and-dr');
    expect(fd.available).toBe(false);
    expect(fd.site.errors.map((e) => e.unlock)).toContainEqual({ kind: 'choose-site-layout', layoutIds: ['two-buildings-plus-dr'] });
  });

  it('two rooms in one building: "přiřaď místnost do AZ2" and witness, then Site HA is available', () => {
    let s = emptyPhysicalState('two-rooms-one-building');
    const before = fleet(s, 'site-high-availability');
    expect(before.site.errors.map((e) => e.unlock)).toEqual([
      { kind: 'assign-room-role', role: 'az2', roomIds: ['room-a2', 'room-a3'] },
      { kind: 'assign-room-role', role: 'witness', roomIds: ['room-a2', 'room-a3'] },
    ]);
    s = u(assignRoomRole(s, 'room-a2', 'az2'));
    s = u(assignRoomRole(s, 'room-a3', 'witness'));
    const after = fleet(s, 'site-high-availability');
    expect(after).toMatchObject({ available: true, site: { status: 'ok' } });
    expect(after.site.requirements.map((r) => r.code)).toEqual(['SITE_INTER_AZ_RTT_TOO_HIGH', 'SITE_INTER_AZ_BANDWIDTH_TOO_LOW', 'SITE_WITNESS_RTT_TOO_HIGH', 'SITE_AZ_HOST_COUNT_UNEQUAL', 'SITE_AZ_TOO_FEW_HOSTS']);
    // witness room in the same building as both AZs: warning (dependency on an AZ, [B11] paraphrase), not blocking
    expect(after.site.warnings.map((w) => w.issue.code)).toEqual(['SITE_WITNESS_SHARES_AZ_BUILDING']);
  });

  it('hosts per AZ once hardware exists: minimum (vSAN Simple 3 / AZ) and equal counts – warnings, the mgmt stretch is Day 2', () => {
    const s = build('two-buildings', { 'room-b1': 'az2', 'room-c1': 'witness' }, { 'room-a1': 3, 'room-b1': 2 });
    const r = fleet(s, 'site-high-availability', { 'deployment-model': 'simple', 'principal-storage': 'vsan-esa' });
    expect(r).toMatchObject({ available: true, site: { status: 'ok', errors: [] } });
    expect(r.site.warnings.map((w) => [w.issue.code, w.issue.severity, w.issue.subject, w.unlock])).toEqual([
      ['SITE_AZ_TOO_FEW_HOSTS', 'warning', 'az2', { kind: 'add-hosts-to-az', role: 'az2', roomIds: ['room-b1'], count: 1 }],
      ['SITE_AZ_HOST_COUNT_UNEQUAL', 'warning', 'az2', { kind: 'add-hosts-to-az', role: 'az2', roomIds: ['room-b1'], count: 1 }],
    ]);
    const ha = fleet(build('two-buildings', { 'room-b1': 'az2', 'room-c1': 'witness' }, { 'room-a1': 4, 'room-b1': 4 }), 'site-high-availability', { 'deployment-model': 'high-availability', 'principal-storage': 'vsan-esa' });
    expect(ha.site).toMatchObject({ status: 'ok', warnings: [] });
    const uneven = fleet(build('two-buildings', { 'room-b1': 'az2', 'room-c1': 'witness' }, { 'room-a1': 5, 'room-b1': 4 }), 'site-high-availability', { 'deployment-model': 'high-availability', 'principal-storage': 'vsan-esa' });
    expect(uneven.site.warnings.map((w) => w.issue.code)).toEqual(['SITE_AZ_HOST_COUNT_UNEQUAL']);
  });

  it('checkHostsPerAz is an error by default (REQD)', () => {
    const s = build('two-buildings', { 'room-b1': 'az2' }, { 'room-a1': 4, 'room-b1': 3 });
    expect(checkHostsPerAz(availabilityZones(s), minStretchedHosts('high-availability', 'vsan-esa')).map((i) => [i.code, i.severity])).toEqual([
      ['SITE_AZ_TOO_FEW_HOSTS', 'error'],
      ['SITE_AZ_HOST_COUNT_UNEQUAL', 'error'],
    ]);
  });

  it('remote DR: DR available after assigning the remote room; Site HA with the remote room as AZ2 fails the link check', () => {
    let s = emptyPhysicalState('remote-dr');
    expect(fleet(s, 'disaster-recovery').site.errors[0]?.unlock).toEqual({ kind: 'assign-room-role', role: 'secondary-instance', roomIds: ['room-b1'] });
    s = u(assignRoomRole(s, 'room-b1', 'secondary-instance'));
    expect(fleet(s, 'disaster-recovery')).toMatchObject({ available: true, site: { status: 'ok' } });
    const az2 = u(assignRoomRole(emptyPhysicalState('remote-dr'), 'room-b1', 'az2'));
    const ha = fleet(az2, 'site-high-availability');
    expect(ha.site.errors.map((e) => e.issue.code)).toEqual(['SITE_INTER_AZ_RTT_TOO_HIGH', 'SITE_INTER_AZ_BANDWIDTH_TOO_LOW', 'SITE_WITNESS_FAULT_DOMAIN_MISSING']);
    expect(ha.site.errors[0]?.unlock).toEqual({ kind: 'choose-site-layout', layoutIds: ['two-rooms-one-building', 'two-buildings', 'two-buildings-plus-dr'] });
  });

  it('campus + remote site: Fault Domains and DR reachable (AZ1, AZ2, witness, second instance)', () => {
    let s = emptyPhysicalState('two-buildings-plus-dr');
    expect(fleet(s, 'fault-domains-and-dr').available).toBe(false);
    s = u(assignRoomRole(s, 'room-b1', 'az2'));
    s = u(assignRoomRole(s, 'room-c1', 'witness'));
    const before = fleet(s, 'fault-domains-and-dr');
    expect(before.site.errors).toEqual([expect.objectContaining({ issue: expect.objectContaining({ code: 'SITE_SECONDARY_LOCATION_MISSING' }), unlock: { kind: 'assign-room-role', role: 'secondary-instance', roomIds: ['room-r1'] } })]);
    s = u(assignRoomRole(s, 'room-r1', 'secondary-instance'));
    expect(fleet(s, 'fault-domains-and-dr')).toMatchObject({ available: true, site: { status: 'ok', warnings: [] } });
  });

  it('Stretched cluster model (WLD) is limited by the layout too', () => {
    const small = optionAvailabilityWithHardware('wld-cluster-model', 'stretched', { 'workload-placement': 'workload-domain', 'fleet-deployment-model': 'site-high-availability' }, hardwareContext(emptyPhysicalState(), catalog));
    expect(small.available).toBe(false);
    expect(small.site.errors.map((e) => e.issue.code)).toContain('SITE_SECOND_AZ_MISSING');
    const campus = build('two-buildings', { 'room-b1': 'az2', 'room-c1': 'witness' });
    const r = optionAvailabilityWithHardware('wld-cluster-model', 'stretched', { 'workload-placement': 'workload-domain', 'fleet-deployment-model': 'site-high-availability' }, hardwareContext(campus, catalog));
    expect(r).toMatchObject({ available: true, site: { status: 'ok' } });
    expect(optionAvailabilityWithHardware('wld-cluster-model', 'single-rack', {}, hardwareContext(emptyPhysicalState(), catalog)).site.status).toBe('not-site-dependent');
  });
});
