import { describe, expect, it } from 'vitest';
import { DESIGN_BLUEPRINTS, type BlueprintId, type SiteLayoutId } from '../../../model';
import { oobSwitchId } from '../oob';
import { SandboxSession } from '../session';
import { blueprintDesignChoices } from '../site';
import type { CommandResult, SandboxCommand } from '../types';
import { must } from './workbook';

const FAST = { 'esx-install': 1000, 'mgmt-network-test': 1000 } as const;
const created = (r: CommandResult): string[] => (r.ok ? [...(r.created ?? [])] : []);
const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

function reject(s: SandboxSession, cmd: SandboxCommand) {
  const r = s.dispatch(cmd);
  if (r.ok) throw new Error(`${cmd.type} unexpectedly accepted`);
  return r.rejection;
}

const withBlueprint = (blueprintId: BlueprintId, layoutId: SiteLayoutId, autoBmc = true): SandboxSession => {
  const s = new SandboxSession({ taskDurationsMs: FAST, autoBmc, objectives: true });
  must(s, { type: 'chooseBlueprint', blueprintId, layoutId });
  return s;
};

const placeRack = (s: SandboxSession, roomId: string, gx = 2, gy = 2): string =>
  created(must(s, { type: 'placeRack', itemId: 'rack-generic-42u', tile: { gx, gy }, roomId }))[0]!;

function mountHosts(s: SandboxSession, rackId: string, n: number, item = 'dell-r670-med'): string[] {
  const hosts = created(must(s, { type: 'buyItem', itemId: item, qty: n }));
  for (const h of hosts) must(s, { type: 'mountDevice', deviceId: h, rackId });
  return hosts;
}

const objective = (s: SandboxSession, id: string) =>
  s.snapshot().objectives.groups.flatMap((g) => g.objectives.flatMap((o) => [o, ...(o.subSteps ?? [])])).find((o) => o.id === id);

describe('Sandbox sites – chooseBlueprint', () => {
  it('validates that the layout belongs to the blueprint (LAYOUT_BLUEPRINTS, 06 §7a)', () => {
    const s = new SandboxSession({ objectives: true });
    expect(reject(s, { type: 'chooseBlueprint', blueprintId: 'vcf-fleet-single-site', layoutId: 'two-buildings' })).toMatchObject({ kind: 'flow', reason: 'blueprint-layout-mismatch' });
    expect(reject(s, { type: 'chooseBlueprint', blueprintId: 'nope' as BlueprintId, layoutId: 'small-room' })).toMatchObject({ reason: 'invalid-input' });
    expect(s.snapshot().site.blueprint).toBeUndefined();
    expect(s.snapshot().site.layout.id).toBe('small-room');
  });

  it('records the blueprint, switches the layout and pre-selects the documented design choices', () => {
    const s = withBlueprint('vcf-fleet-multiple-sites-single-region', 'two-buildings');
    const site = s.snapshot().site;
    const bp = DESIGN_BLUEPRINTS['vcf-fleet-multiple-sites-single-region'];
    expect(site.blueprint).toMatchObject({ id: bp.id, url: bp.url, specRef: bp.specRef, hostGroups: bp.hostGroups, totalHosts: 8 });
    expect(site.layout.id).toBe('two-buildings');
    expect(site.layout.rooms.map((r) => r.id)).toEqual(['room-a1', 'room-b1', 'room-c1']);
    expect(site.layout.rooms[0]).toMatchObject({ role: 'az1', rackSlots: 6, gameDefault: true });
    expect(site.layout.links.every((l) => l.gameDefault && l.rttMs >= 0 && l.bandwidthGbps > 0)).toBe(true);
    // only documented choices that exist in the design model
    const defaults = blueprintDesignChoices(bp.id);
    expect(Object.keys(defaults).length).toBeGreaterThan(0);
    expect(s.snapshot().design.choices).toEqual(defaults);
    expect(site.deviations).toEqual([]);
    // the player can still deviate; the deviation is listed (issues come from normal design validation)
    must(s, { type: 'selectDesignOption', decision: 'deployment-size', option: 'small' });
    expect(s.snapshot().site.deviations).toEqual([{ decision: 'deployment-size', blueprintOption: 'medium', currentOption: 'small' }]);
  });

  it('same blueprint again = nothing to do; another layout of the same blueprint keeps the player choices', () => {
    const s = withBlueprint('vcf-fleet-multiple-sites-single-region', 'two-buildings');
    expect(reject(s, { type: 'chooseBlueprint', blueprintId: 'vcf-fleet-multiple-sites-single-region', layoutId: 'two-buildings' })).toMatchObject({ reason: 'nothing-to-do' });
    must(s, { type: 'selectDesignOption', decision: 'deployment-size', option: 'small' });
    must(s, { type: 'chooseBlueprint', blueprintId: 'vcf-fleet-multiple-sites-single-region', layoutId: 'two-rooms-one-building' });
    expect(s.snapshot().site.layout.id).toBe('two-rooms-one-building');
    expect(s.snapshot().design.choices['deployment-size']).toBe('small');
  });

  it('a different layout only before any rack exists (model chooseSiteLayout)', () => {
    const s = withBlueprint('vcf-fleet-single-site-minimal-footprint', 'small-room');
    placeRack(s, 'room-a1');
    const r = reject(s, { type: 'chooseBlueprint', blueprintId: 'vcf-fleet-single-site', layoutId: 'large-room' });
    expect(r.kind === 'validation' && codes(r.issues)).toEqual(['SITE_LAYOUT_INVALID']);
    expect(s.snapshot().site.blueprint?.id).toBe('vcf-fleet-single-site-minimal-footprint');
  });
});

describe('Sandbox sites – room-scoped racks', () => {
  it('tiles collide per room, stay inside the room floor and respect room capacity', () => {
    const s = withBlueprint('vcf-fleet-multiple-sites-single-region', 'two-buildings');
    const a = placeRack(s, 'room-a1', 2, 2);
    const b = placeRack(s, 'room-b1', 2, 2); // same tile, other room
    // [GAME] room layout rules (model validateRackPlacement): issues passed through unchanged
    const occupied = reject(s, { type: 'placeRack', itemId: 'rack-generic-42u', tile: { gx: 2, gy: 2 }, roomId: 'room-a1' });
    expect(occupied.kind === 'validation' && codes(occupied.issues)).toEqual(['ROOM_TILE_OCCUPIED']);
    const outside = reject(s, { type: 'placeRack', itemId: 'rack-generic-42u', tile: { gx: 40, gy: 2 }, roomId: 'room-a1' });
    expect(outside.kind === 'validation' && codes(outside.issues)).toEqual(['ROOM_OUT_OF_BOUNDS']);
    const unknown = reject(s, { type: 'placeRack', itemId: 'rack-generic-42u', tile: { gx: 1, gy: 1 }, roomId: 'room-zz' });
    expect(unknown.kind === 'validation' && codes(unknown.issues)).toEqual(['SITE_ROOM_NOT_FOUND']);
    placeRack(s, 'room-c1', 2, 3); // witness room: 1 rack slot ([GAME])
    const full = reject(s, { type: 'placeRack', itemId: 'rack-generic-42u', tile: { gx: 4, gy: 5 }, roomId: 'room-c1' });
    expect(full.kind === 'validation' && codes(full.issues)).toEqual(['SITE_ROOM_FULL']);
    const rr = s.snapshot().site.layout.rackRooms;
    expect(rr[a]).toBe('room-a1');
    expect(rr[b]).toBe('room-b1');
  });

  it('inventory rack placed into a room; moveRackToRoom keeps the tile unless taken', () => {
    const s = withBlueprint('vcf-fleet-multiple-sites-single-region', 'two-buildings');
    const inv = created(must(s, { type: 'buyItem', itemId: 'rack-generic-42u' }))[0]!;
    must(s, { type: 'placeRack', inventoryId: inv, tile: { gx: 3, gy: 3 }, roomId: 'room-b1' });
    expect(s.snapshot().site.layout.rackRooms[inv]).toBe('room-b1');
    const other = placeRack(s, 'room-a1', 3, 3);
    const taken = reject(s, { type: 'moveRackToRoom', rackId: other, roomId: 'room-b1' });
    expect(taken.kind === 'validation' && codes(taken.issues)).toEqual(['ROOM_TILE_OCCUPIED']);
    must(s, { type: 'moveRackToRoom', rackId: inv, roomId: 'room-c1' });
    expect(s.snapshot().site.layout.rooms.find((r) => r.id === 'room-c1')!.rackIds).toEqual([inv]);
    // room edits are undoable
    must(s, { type: 'undoRoom' });
    expect(s.snapshot().site.layout.rackRooms[inv]).toBe('room-b1');
  });
});

describe('Sandbox sites – AZ roles and site issues', () => {
  it('Site HA: second AZ + witness via assignRoomRole clear the stretched site errors', () => {
    const s = withBlueprint('vcf-fleet-multiple-sites-single-region', 'two-buildings');
    expect(codes(s.snapshot().site.issues.errors).sort()).toEqual(['SITE_SECOND_AZ_MISSING', 'SITE_WITNESS_FAULT_DOMAIN_MISSING']);
    must(s, { type: 'assignRoomRole', roomId: 'room-b1', role: 'az2' });
    must(s, { type: 'assignRoomRole', roomId: 'room-c1', role: 'witness' });
    const site = s.snapshot().site;
    expect(site.issues.errors).toEqual([]);
    expect(site.interAz).toMatchObject({ status: 'ok', rttMs: 1, bandwidthGbps: 100 });
    expect(site.layout.rooms.map((r) => r.role)).toEqual(['az1', 'az2', 'witness']);
    expect(reject(s, { type: 'assignRoomRole', roomId: 'room-b1', role: 'az2' })).toMatchObject({ reason: 'nothing-to-do' });
    expect(reject(s, { type: 'assignRoomRole', roomId: 'room-b1', role: 'bogus' as never })).toMatchObject({ reason: 'invalid-input' });
  });

  it('hosts per AZ: unequal AZs give (Day 2) warnings; AZ summary counts mounted hosts', () => {
    const s = withBlueprint('vcf-fleet-multiple-sites-single-region', 'two-buildings');
    must(s, { type: 'assignRoomRole', roomId: 'room-b1', role: 'az2' });
    must(s, { type: 'assignRoomRole', roomId: 'room-c1', role: 'witness' });
    mountHosts(s, placeRack(s, 'room-a1'), 4);
    const site = s.snapshot().site;
    expect(site.azs.find((a) => a.role === 'az1')!.hostIds).toHaveLength(4);
    expect(codes(site.issues.warnings).sort()).toEqual(['SITE_AZ_HOST_COUNT_UNEQUAL', 'SITE_AZ_TOO_FEW_HOSTS']);
    mountHosts(s, placeRack(s, 'room-b1'), 4);
    expect(s.snapshot().site.issues.warnings).toEqual([]);
  });

  it('DR: only the second-instance check applies; a WAN room as AZ2 is outside the stretched limits', () => {
    const s = withBlueprint('vcf-fleet-across-multiple-regions', 'remote-dr');
    expect(codes(s.snapshot().site.issues.errors)).toEqual(['SITE_SECONDARY_LOCATION_MISSING']);
    must(s, { type: 'assignRoomRole', roomId: 'room-b1', role: 'az2' });
    const site = s.snapshot().site;
    expect(codes(site.checks.interAz).sort()).toEqual(['SITE_INTER_AZ_BANDWIDTH_TOO_LOW', 'SITE_INTER_AZ_RTT_TOO_HIGH']);
    expect(site.checks.stretched).toBe(false);
    must(s, { type: 'assignRoomRole', roomId: 'room-b1', role: 'secondary-instance' });
    expect(s.snapshot().site.issues.errors).toEqual([]);
  });
});

describe('Sandbox sites – design availability follows the layout', () => {
  it('Site HA is blocked in a single room (unlock: choose a layout) and available with AZ2 + witness', () => {
    const small = withBlueprint('vcf-fleet-single-site-minimal-footprint', 'small-room');
    const blocked = small.snapshot().hw.options['fleet-deployment-model']!['site-high-availability']!;
    expect(blocked.site.status).toBe('blocked');
    expect(blocked.available).toBe(false);
    expect(blocked.site.errors.some((e) => e.unlock?.kind === 'choose-site-layout')).toBe(true);

    const campus = withBlueprint('vcf-fleet-multiple-sites-single-region', 'two-buildings');
    const before = campus.snapshot().hw.options['fleet-deployment-model']!['site-high-availability']!;
    expect(before.site.errors.some((e) => e.unlock?.kind === 'assign-room-role')).toBe(true);
    must(campus, { type: 'assignRoomRole', roomId: 'room-b1', role: 'az2' });
    must(campus, { type: 'assignRoomRole', roomId: 'room-c1', role: 'witness' });
    expect(campus.snapshot().hw.options['fleet-deployment-model']!['site-high-availability']!.site.status).toBe('ok');
  });
});

describe('Sandbox sites – objectives per blueprint', () => {
  it('room.host-count target = max(design minimum, blueprint Minimum Requirements hosts)', () => {
    for (const [bp, layout, hosts] of [
      ['vcf-fleet-single-site-minimal-footprint', 'small-room', 3],
      ['vcf-fleet-single-site', 'large-room', 4],
      ['vcf-fleet-multiple-sites-single-region', 'two-buildings', 8],
      ['vcf-fleet-single-region-plus-additional-regions', 'two-buildings-plus-dr', 12],
    ] as const) {
      const s = withBlueprint(bp, layout);
      const min = s.snapshot().planning.hostCount.minimum ?? 1;
      expect(objective(s, 'room.host-count')!.progress?.target).toBe(Math.max(min, hosts));
    }
  });

  it('site objectives only for multi-site blueprints; they complete from the site state', () => {
    expect(new SandboxSession({ objectives: true }).snapshot().objectives.groups.some((g) => g.id === 'L')).toBe(false);
    expect(withBlueprint('vcf-fleet-single-site', 'large-room').snapshot().objectives.groups.some((g) => g.id === 'L')).toBe(false);

    const ha = withBlueprint('vcf-fleet-multiple-sites-single-region', 'two-buildings');
    const ids = ha.snapshot().objectives.groups.find((g) => g.id === 'L')!.objectives.map((o) => o.id);
    expect(ids).toEqual(['site.az2', 'site.witness', 'site.hosts-per-az']);
    expect(objective(ha, 'site.az2')!.state).toBe('pending');
    must(ha, { type: 'assignRoomRole', roomId: 'room-b1', role: 'az2' });
    must(ha, { type: 'assignRoomRole', roomId: 'room-c1', role: 'witness' });
    expect(objective(ha, 'site.az2')!.state).toBe('done');
    expect(objective(ha, 'site.witness')!.state).toBe('done');
    expect(objective(ha, 'site.hosts-per-az')!.progress).toEqual({ current: 0, target: 4 });
    mountHosts(ha, placeRack(ha, 'room-a1'), 4);
    mountHosts(ha, placeRack(ha, 'room-b1'), 4);
    expect(objective(ha, 'site.hosts-per-az')!.state).toBe('done');

    const fd = withBlueprint('vcf-fleet-single-region-plus-additional-regions', 'two-buildings-plus-dr');
    expect(fd.snapshot().objectives.groups.find((g) => g.id === 'L')!.objectives.map((o) => o.id)).toEqual([
      'site.az2', 'site.witness', 'site.hosts-per-az', 'site.secondary-instance', 'site.secondary-hosts',
    ]);
    must(fd, { type: 'assignRoomRole', roomId: 'room-r1', role: 'secondary-instance' });
    expect(objective(fd, 'site.secondary-instance')!.state).toBe('done');
    expect(objective(fd, 'site.secondary-hosts')!.progress).toEqual({ current: 0, target: 4 });
  });
});

describe('Sandbox – pre-wired OOB / BMC network (autoBmc, game scope)', () => {
  it('one wall-mounted OOB switch per room: no rack slot, not in the inventory, not a bought switch', () => {
    const s = withBlueprint('vcf-fleet-multiple-sites-single-region', 'two-buildings');
    const p = s.snapshot().physical;
    const oob = p.switches.filter((x) => x.preinstalledOob);
    expect(oob.map((x) => x.id)).toEqual(['room-a1', 'room-b1', 'room-c1'].map(oobSwitchId));
    expect(oob.every((x) => x.mount === undefined && x.oobOnly)).toBe(true);
    expect(p.inventory.some((i) => i.kind === 'switch')).toBe(false);
    expect(p.autoBmc).toBe(true);
    expect(objective(s, 'room.switch')!.state).not.toBe('done');
    // BMC objectives (group B) hidden while the OOB network is pre-wired
    expect(s.snapshot().objectives.groups.some((g) => g.id === 'B')).toBe(false);
    // player cannot touch it
    expect(reject(s, { type: 'removeItem', id: oobSwitchId('room-a1') })).toMatchObject({ reason: 'preinstalled-oob' });
    expect(reject(s, { type: 'mountDevice', deviceId: oobSwitchId('room-a1'), rackId: placeRack(s, 'room-a1') })).toMatchObject({ reason: 'preinstalled-oob' });
    expect(reject(s, { type: 'setSwitchPort', switchId: oobSwitchId('room-a1'), port: 0, config: { mtu: 9000 } })).toMatchObject({ reason: 'preinstalled-oob' });
  });

  it('mounting a server cables + addresses its BMC; remote install only for documented vendors (25 §10.6)', () => {
    const s = withBlueprint('vcf-fleet-single-site-minimal-footprint', 'small-room');
    const rack = placeRack(s, 'room-a1');
    const [dell] = mountHosts(s, rack, 1);
    const [cisco] = mountHosts(s, rack, 1, 'cisco-c220m8s-med');
    const v = s.snapshot().physical.servers.find((x) => x.id === dell)!;
    expect(v.bmcPort.peer).toMatchObject({ kind: 'switch', switchId: oobSwitchId('room-a1') });
    expect(v.bmc).toMatchObject({ cabled: true, reachableFromAdmin: true, outOfVcfScope: true });
    expect(v.bmc.ipv4).toMatch(/^10\.0\.99\./);
    const ips = s.snapshot().physical.servers.map((x) => x.bmc.ipv4);
    expect(new Set(ips).size).toBe(ips.length);
    // BMC cable is not a ToR uplink for VCF (host still "not connected to any switch")
    expect(codes(v.topology.errors)).toContain('PHYS_HOST_NOT_CONNECTED');
    expect(s.snapshot().flows.flows.filter((f) => f.trafficClass === 'oob').every((f) => f.gameScope)).toBe(true);
    expect(reject(s, { type: 'installEsx', serverId: cisco!, method: 'bmc' })).toMatchObject({ reason: 'bmc-remote-install-not-documented' });
    must(s, { type: 'installEsx', serverId: dell!, method: 'bmc' });
    // unmounting drops the BMC cable; the auto cable cannot be removed by hand
    const cable = s.snapshot().physical.servers.find((x) => x.id === cisco)!.bmcPort.cableId!;
    expect(reject(s, { type: 'disconnectCable', cableId: cable })).toMatchObject({ reason: 'preinstalled-oob' });
    must(s, { type: 'unmountDevice', deviceId: cisco! });
    expect(s.snapshot().physical.servers.find((x) => x.id === cisco)!.bmc.cabled).toBe(false);
  });

  it('moving a rack to another room re-cables the BMCs to that room\'s OOB switch', () => {
    const s = withBlueprint('vcf-fleet-multiple-sites-single-region', 'two-buildings');
    const rack = placeRack(s, 'room-a1');
    const [h] = mountHosts(s, rack, 1);
    must(s, { type: 'moveRackToRoom', rackId: rack, roomId: 'room-b1' });
    const v = s.snapshot().physical.servers.find((x) => x.id === h)!;
    expect(v.bmcPort.peer).toMatchObject({ switchId: oobSwitchId('room-b1') });
    expect(v.bmc.reachableFromAdmin).toBe(true);
  });

  it('switches with the layout; autoBmc off (Career) = no OOB switch, manual BMC objectives', () => {
    const s = new SandboxSession({ objectives: true });
    expect(s.snapshot().physical.switches.map((x) => x.id)).toEqual([oobSwitchId('room-a1')]);
    must(s, { type: 'chooseBlueprint', blueprintId: 'vcf-fleet-across-multiple-regions', layoutId: 'remote-dr' });
    expect(s.snapshot().physical.switches.map((x) => x.id)).toEqual(['room-a1', 'room-b1'].map(oobSwitchId));

    const manual = withBlueprint('vcf-fleet-single-site', 'large-room', false);
    expect(manual.snapshot().physical.switches).toEqual([]);
    const [h] = mountHosts(manual, placeRack(manual, 'room-a1'), 1);
    expect(manual.snapshot().physical.servers.find((x) => x.id === h)!.bmc.cabled).toBe(false);
    expect(manual.snapshot().objectives.groups.some((g) => g.id === 'B')).toBe(true);
  });
});
