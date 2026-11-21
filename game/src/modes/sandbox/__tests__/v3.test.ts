import { describe, expect, it } from 'vitest';
import { loadObjectiveSet } from '../objectives';
import { CONSOLE_SCREENS, checkConsoleScreens, checkEsxRootPassword } from '../console';
import { NIC_SLOTS_GAME_DEFAULT } from '../nicSlots';
import { SANDBOX_V3_OPTIONS } from '../reducer';
import { SandboxSession } from '../session';
import type { CommandResult, SandboxCommand } from '../types';

const FAST = { 'esx-install': 1000, 'mgmt-network-test': 1000 } as const;
const v3 = (extra: Partial<ConstructorParameters<typeof SandboxSession>[0]> = {}) => new SandboxSession({ ...SANDBOX_V3_OPTIONS, taskDurationsMs: FAST, ...extra });
const must = (s: SandboxSession, cmd: SandboxCommand): CommandResult => {
  const r = s.dispatch(cmd);
  if (!r.ok) throw new Error(`${cmd.type}: ${JSON.stringify(r.rejection)}`);
  return r;
};
const reject = (s: SandboxSession, cmd: SandboxCommand) => {
  const r = s.dispatch(cmd);
  if (r.ok) throw new Error(`${cmd.type} unexpectedly ok`);
  return r.rejection;
};
const created = (r: CommandResult): string[] => (r.ok ? [...(r.created ?? [])] : []);
const run = (s: SandboxSession) => {
  for (let i = 0; i < 50 && s.state.tasks.length; i++) s.advance(60_000);
};
/** Rack placed with ToR-A + `n` servers mounted. */
function rackWith(s: SandboxSession, n: number, item = 'dell-r670-med') {
  const r = must(s, { type: 'placeRack', itemId: 'rack-generic-42u', tile: { gx: 2, gy: 3 } });
  const [rack, tor] = created(r) as [string, string];
  const hosts = created(must(s, { type: 'buyItem', itemId: item, qty: n }));
  for (const h of hosts) must(s, { type: 'mountDevice', inventoryId: h, rackId: rack });
  return { rack, tor, hosts };
}

describe('Sandbox v3 – pre-installed ToR (UX 19.5)', () => {
  it('first placement puts a free ToR-A in the top U with the company uplink; U below is reserved for ToR-B', () => {
    const s = v3();
    const { rack, tor, hosts } = rackWith(s, 2);
    const snap = s.snapshot();
    const sw = snap.physical.switches.find((x) => x.id === tor)!;
    expect(sw).toMatchObject({ modelId: 'sw-generic-48x25g', mount: { rackId: rack, positionU: 42 }, preinstalledTor: { rackId: rack, position: 'a' } });
    expect(sw.ports.every((p) => p.config.mtu === 1500)).toBe(true);
    expect(snap.physical.companyNetwork).toEqual({ switchId: tor, port: 47 });
    expect(snap.physical.racks[0]!.tor).toEqual({ a: tor, reservedU: 41, companyUplink: true });
    expect(snap.physical.economy.spent).toBe(snap.physical.catalog.items.find((i) => i.id === 'rack-generic-42u')!.price + hosts.reduce((a, h) => a + snap.physical.servers.find((x) => x.id === h)!.price, 0));
    // servers start at the bottom; explicit mount into the reserved U is a game rule rejection
    expect(snap.physical.servers.map((x) => x.mount?.positionU)).toEqual([1, 1 + snap.physical.servers[0]!.rackUnits]);
    const extra = created(must(s, { type: 'buyItem', itemId: 'dell-r670-med' }))[0]!;
    expect(reject(s, { type: 'mountDevice', inventoryId: extra, rackId: rack, u: 41 })).toMatchObject({ kind: 'flow', reason: 'u-reserved' });
    // moving the rack keeps its ToR, no second provisioning
    must(s, { type: 'placeRack', rackId: rack, tile: { gx: 4, gy: 3 } });
    expect(s.snapshot().physical.switches.filter((x) => x.preinstalledTor)).toHaveLength(1);
  });

  it('addTor puts ToR-B into the reserved U (game price); host on two switches; rack removal takes ToR-A along', () => {
    const s = v3();
    const { rack, tor, hosts } = rackWith(s, 1);
    const spent = s.snapshot().physical.economy.spent;
    const b = created(must(s, { type: 'addTor', rackId: rack }))[0]!;
    const snap = s.snapshot();
    expect(snap.physical.switches.find((x) => x.id === b)).toMatchObject({ mount: { positionU: 41 }, preinstalledTor: { position: 'b' } });
    expect(snap.physical.economy.spent).toBeGreaterThan(spent);
    expect(snap.physical.racks[0]!.tor).toEqual({ a: tor, b, companyUplink: true });
    expect(reject(s, { type: 'addTor', rackId: rack })).toMatchObject({ reason: 'nothing-to-do' });
    must(s, { type: 'connectCable', from: { deviceId: hosts[0]!, port: 0 }, to: { deviceId: tor, port: 0 } });
    must(s, { type: 'connectCable', from: { deviceId: hosts[0]!, port: 1 }, to: { deviceId: b, port: 0 } });
    expect(s.snapshot().physical.servers[0]!.nicPorts.filter((n) => n.link?.up).length).toBe(2);
    // empty the rack of servers -> rack back to the inventory; ToR-A disappears, ToR-B goes to the inventory
    must(s, { type: 'unmountDevice', deviceId: hosts[0]! });
    must(s, { type: 'removeItem', id: rack });
    const after = s.snapshot().physical;
    expect(after.switches.some((x) => x.id === tor)).toBe(false);
    expect(after.inventory.some((i) => i.id === b)).toBe(true);
    expect(after.companyNetwork).toBeUndefined();
    // placing it again provisions a new ToR-A; undo restores the previous room
    must(s, { type: 'placeRack', inventoryId: rack, tile: { gx: 2, gy: 3 } });
    expect(s.snapshot().physical.racks[0]!.tor?.a).toBeDefined();
    must(s, { type: 'undoRoom' });
    expect(s.snapshot().physical.racks[0]!.placed).toBe(false);
  });

  it('a 100G ToR can be chosen when placing a rack; NIC options flag speed mismatches (game / physical)', () => {
    const s = v3();
    must(s, { type: 'placeRack', itemId: 'rack-generic-42u', tile: { gx: 2, gy: 3 }, torModelId: 'sw-generic-32x100g' });
    expect(s.snapshot().physical.switches.find((x) => x.preinstalledTor)?.modelId).toBe('sw-generic-32x100g');
    expect(reject(s, { type: 'placeRack', itemId: 'rack-generic-42u', tile: { gx: 6, gy: 3 }, torModelId: 'sw-generic-48x1g-oob' })).toMatchObject({ reason: 'unknown-item' });
    const rack = s.snapshot().physical.racks[0]!.id;
    const h = created(must(s, { type: 'buyItem', itemId: 'dell-r670-med' }))[0]!;
    must(s, { type: 'mountDevice', inventoryId: h, rackId: rack });
    const opts = s.snapshot().physical.servers[0]!.nicOptions;
    expect(opts.length).toBeGreaterThan(0);
    const g25 = opts.find((o) => o.partId === 'nic-dell-cx6lx-25g-2p')!;
    expect(g25.incompatibleTors.map((t) => t.speedsGbE)).toEqual([[100]]);
    expect(opts.find((o) => o.partId === 'nic-dell-cx6dx-100g-2p')!.incompatibleTors).toEqual([]);
  });

  it('without the option (default) racks stay empty – older saves / tests unchanged', () => {
    const s = new SandboxSession();
    must(s, { type: 'placeRack', itemId: 'rack-generic-42u', tile: { gx: 2, gy: 3 } });
    expect(s.snapshot().physical.switches.filter((x) => !x.preinstalledOob)).toEqual([]);
    expect(s.snapshot().physical.autoTor).toBe(false);
  });
});

describe('Sandbox v3 – BMC traffic right after racking (UX 19.6)', () => {
  it('a mounted server gets its BMC cabled + IP and a grey game-scope oob flow immediately', () => {
    const s = v3();
    const { hosts } = rackWith(s, 1);
    const snap = s.snapshot();
    const srv = snap.physical.servers[0]!;
    expect(srv.bmc).toMatchObject({ cabled: true, reachableFromAdmin: true, outOfVcfScope: true });
    const oob = snap.flows.flows.filter((f) => f.trafficClass === 'oob');
    expect(oob.map((f) => f.to)).toContainEqual({ kind: 'server', id: hosts[0] });
    expect(oob.every((f) => f.gameScope === true)).toBe(true);
    expect(snap.flows.flows.some((f) => f.trafficClass !== 'oob')).toBe(false);
  });
});

describe('Sandbox v3 – NIC slots (UX 19.4)', () => {
  it('slots = game value 2; add a certified NIC into the free slot, remove it; locked after ESX', () => {
    const s = v3();
    const { hosts } = rackWith(s, 1);
    const id = hosts[0]!;
    let srv = s.snapshot().physical.servers[0]!;
    expect(srv.nicSlots).toHaveLength(NIC_SLOTS_GAME_DEFAULT);
    expect(srv.nicSlots[0]).toMatchObject({ slot: 1, partId: 'nic-dell-cx6lx-25g-2p', vmnics: [0, 1], gameDefault: true });
    expect(srv.nicSlots[1]!.partId).toBeUndefined();
    expect(reject(s, { type: 'addNic', serverId: id, slot: 2, nicPartId: 'nic-hpe-cx6lx-25g-2p' })).toMatchObject({ reason: 'nic-not-certified' });
    expect(reject(s, { type: 'addNic', serverId: id, slot: 1, nicPartId: 'nic-dell-cx6lx-25g-2p' })).toMatchObject({ reason: 'invalid-input' });
    const spent = s.snapshot().physical.economy.spent;
    must(s, { type: 'addNic', serverId: id, slot: 2, nicPartId: 'nic-dell-57412-10gbt-2p' });
    srv = s.snapshot().physical.servers[0]!;
    expect(srv.nicPorts).toHaveLength(4);
    expect(srv.nicSlots[1]).toMatchObject({ partId: 'nic-dell-57412-10gbt-2p', vmnics: [2, 3] });
    expect(s.snapshot().physical.economy.spent).toBeGreaterThan(spent);
    expect(reject(s, { type: 'addNic', serverId: id, slot: 2, nicPartId: 'nic-dell-57412-10gbt-2p' })).toMatchObject({ reason: 'no-free-slot' });
    must(s, { type: 'removeNic', serverId: id, slot: 1 });
    srv = s.snapshot().physical.servers[0]!;
    expect(srv.nicSlots.map((x) => x.partId)).toEqual(['nic-dell-57412-10gbt-2p', undefined]);
    expect(reject(s, { type: 'removeNic', serverId: id, slot: 2 })).toMatchObject({ reason: 'slot-empty' });
    must(s, { type: 'installEsx', serverId: id, method: 'physical' });
    run(s);
    expect(reject(s, { type: 'removeNic', serverId: id, slot: 1 })).toMatchObject({ reason: 'esx-installed' });
  });
});

describe('Sandbox v3 – shop data and rack height', () => {
  it('servers grouped vendor -> models (✓ / DEV offered, traps separate); rack heights with source flag', () => {
    const cat = v3().snapshot().physical.catalog;
    expect(cat.shopCategoriesV3).toEqual(['rack', 'server']);
    expect(cat.serversByVendor.map((v) => v.vendor)).toEqual(['Dell', 'HPE', 'Lenovo', 'Cisco', 'Supermicro']);
    const dell = cat.serversByVendor[0]!;
    expect(dell.count).toBe(dell.items.length);
    expect(dell.items.every((i) => i.expectedStatus === 'ok' || i.expectedStatus === 'dev')).toBe(true);
    expect(dell.traps.map((t) => t.id)).toContain('dell-r670-undersized');
    for (const i of cat.items) if (i.kind === 'server') expect(i.rackUnitsGameDefault ? i.rackUnitsUrl : i.rackUnitsUrl?.startsWith('https://')).toBe(i.rackUnitsGameDefault ? undefined : true);
  });
});

describe('Sandbox v3 – objectives are a Career feature', () => {
  it('disabled by default; a custom set drives the checklist (one active step, bubble anchor, bonus not counted)', () => {
    expect(new SandboxSession().snapshot().objectives).toMatchObject({ enabled: false, groups: [], checklist: { total: 0 } });
    const set = loadObjectiveSet({
      version: 1,
      groups: [{ id: 'A', title: 'Serverovna' }],
      objectives: [
        { id: 'rack', group: 'A', title: 'Postav rack', kind: 'game-step', selector: 'hasRack', points: 5, bubble: { text: 'Začni rackem.', anchor: 'ui:shop-racks' } },
        { id: 'mount', group: 'A', title: 'Zaracuj servery', kind: 'game-step', selector: 'serversMounted', params: { min: 2 }, bubble: { text: 'Klikni na rack.', anchor: 'object:rack:first' } },
        { id: 'cable', group: 'A', title: 'Zapoj', kind: 'game-step', selector: 'hostsCabledToSwitch', params: { min: 'all' }, bubble: { text: 'Do ToR.', anchor: 'object:tor:first', sourceKeys: ['10-planning:P19'] } },
        { id: 'tor-b', group: 'A', title: 'Druhý ToR', kind: 'game-step', selector: 'hostsOnTwoSwitches', bonus: true, points: 15 },
      ],
    });
    expect(set.loadErrors).toEqual([]);
    const s = v3({ objectives: set });
    let c = s.snapshot().objectives.checklist;
    expect(c).toMatchObject({ total: 3, doneCount: 0, active: { id: 'rack', regressed: false, bubble: { text: 'Začni rackem.', anchor: { kind: 'ui', id: 'shop-racks' } } } });
    expect(c.upcoming.map((x) => x.id)).toEqual(['mount', 'cable']);
    expect(c.recommendation?.id).toBe('tor-b');
    const { rack, tor } = rackWith(s, 1);
    c = s.snapshot().objectives.checklist;
    expect(c.active).toMatchObject({ id: 'mount', progress: { current: 1, target: 2 }, bubble: { anchor: { kind: 'object', objectKind: 'rack', id: rack } } });
    expect(c.recentDone.map((x) => x.id)).toEqual(['rack']);
    const host2 = created(must(s, { type: 'buyItem', itemId: 'dell-r670-med' }))[0]!;
    must(s, { type: 'mountDevice', inventoryId: host2, rackId: rack });
    c = s.snapshot().objectives.checklist;
    expect(c.active?.bubble?.anchor).toEqual({ kind: 'object', objectKind: 'tor', id: tor, raw: 'object:tor:first' });
    expect(c.active?.bubble?.sources[0]).toMatchObject({ key: '10-planning:P19', label: expect.stringMatching(/^Dokumentace: /) });
  });

  it('loader validates bubble / points / bonus; unknown source keys are warnings', () => {
    const bad = loadObjectiveSet({
      version: 1,
      groups: [{ id: 'A', title: 'A' }],
      objectives: [{ id: 'x', group: 'A', title: 'X', kind: 'game-step', selector: 'hasRack', points: -1, bonus: 'yes', bubble: { text: 'T', anchor: 'somewhere' } }],
    });
    expect(bad.loadErrors.join('\n')).toMatch(/points[\s\S]*bonus[\s\S]*anchor|anchor[\s\S]*points/);
    const warn = loadObjectiveSet({ version: 1, groups: [{ id: 'A', title: 'A' }], objectives: [{ id: 'x', group: 'A', title: 'X', kind: 'game-step', selector: 'hasRack', bubble: { text: 'T', anchor: 'avatar', sourceKeys: ['10-planning:P999'] } }] });
    expect(warn.loadErrors).toEqual([]);
    expect(warn.warnings?.[0]).toMatch(/P999/);
  });
});

describe('Sandbox v3 – ESX console (UX 20)', () => {
  it('screen data is consistent and comes with spec references', () => {
    expect(checkConsoleScreens({ installer: CONSOLE_SCREENS.installer, dcui: CONSOLE_SCREENS.dcui, keyboardLayouts: CONSOLE_SCREENS.keyboardLayouts })).toEqual([]);
    for (const sc of [...CONSOLE_SCREENS.installer, ...CONSOLE_SCREENS.dcui]) expect(sc.specRef).toMatch(/^26-esx-install §/);
    expect(checkConsoleScreens({ installer: [{ id: 'a', title: 'A', specRef: 'x', keys: [{ key: 'F9', label: 'x', next: 'zz' }] }], dcui: [], keyboardLayouts: [] }).length).toBeGreaterThan(2);
  });

  it('ESX root password rules of 26 §3.4 [E12]', () => {
    expect(checkEsxRootPassword('xQaT3#A')).toEqual([]);
    expect(checkEsxRootPassword('Xqat3h!1').length).toBeGreaterThan(0); // leading uppercase + trailing digit do not count
    expect(checkEsxRootPassword('short')).not.toEqual([]);
    expect(checkEsxRootPassword('Ab1#root99x')).not.toEqual([]);
  });

  it('installer walkthrough -> installEsx task -> Installation Complete -> DCUI network -> batch on the other hosts', () => {
    const s = v3();
    const { hosts } = rackWith(s, 3);
    const [h1, h2, h3] = hosts as [string, string, string];
    const key = (k: SandboxCommand & { type: 'consoleKey' }) => must(s, k);
    const view = () => s.snapshot().consoles.byServer[h1]!;
    must(s, { type: 'openConsole', serverId: h1 });
    expect(view()).toMatchObject({ flow: 'installer', screen: { id: 'welcome', title: 'Welcome' }, step: { index: 1 } });
    expect(reject(s, { type: 'consoleKey', serverId: h1, key: 'F11' })).toMatchObject({ reason: 'console-key' });
    key({ type: 'consoleKey', serverId: h1, key: 'Enter' });
    expect(view().screen).toMatchObject({ id: 'eula', simplified: true });
    key({ type: 'consoleKey', serverId: h1, key: 'Enter' });
    expect(view().disks?.[0]).toMatchObject({ id: 'boot', kind: 'boot' });
    expect(view().disks!.filter((d) => d.kind === 'data').length).toBeGreaterThan(0);
    key({ type: 'consoleKey', serverId: h1, key: 'Enter', value: 'boot' });
    expect(view().screen.id).toBe('keyboard');
    key({ type: 'consoleKey', serverId: h1, key: 'Enter' });
    key({ type: 'consoleKey', serverId: h1, key: 'Enter', value: 'weak' });
    expect(view()).toMatchObject({ screen: { id: 'root-password' }, message: { level: 'error', specRef: '26-esx-install §3.4 [E12]' } });
    key({ type: 'consoleKey', serverId: h1, key: 'Enter', value: 'Vmw@re-Lab1x' });
    expect(view().screen.id).toBe('confirm-install');
    key({ type: 'consoleKey', serverId: h1, key: 'F11' });
    expect(view()).toMatchObject({ screen: { id: 'installing' } });
    expect(view().taskId).toBeDefined();
    run(s);
    expect(view().screen.id).toBe('complete');
    expect(s.snapshot().physical.servers.find((x) => x.id === h1)!.esx.esxVersion).toBeDefined();
    key({ type: 'consoleKey', serverId: h1, key: 'Enter' });
    expect(view()).toMatchObject({ flow: 'dcui', screen: { id: 'dcui-home' } });
    expect(view().info[1]).toMatch(/DHCP|IP/);
    key({ type: 'consoleKey', serverId: h1, key: 'F2' });
    key({ type: 'consoleKey', serverId: h1, key: 'Enter', value: 'wrong' });
    expect(view().message?.level).toBe('error');
    key({ type: 'consoleKey', serverId: h1, key: 'Enter', value: 'Vmw@re-Lab1x' });
    expect(view()).toMatchObject({ screen: { id: 'dcui-menu' }, loggedIn: true });
    key({ type: 'consoleKey', serverId: h1, key: 'Down' });
    key({ type: 'consoleKey', serverId: h1, key: 'Down' });
    key({ type: 'consoleKey', serverId: h1, key: 'Enter' }); // Configure Management Network
    expect(view().screen.id).toBe('dcui-mgmt');
    key({ type: 'consoleKey', serverId: h1, key: 'Down' });
    key({ type: 'consoleKey', serverId: h1, key: 'Down' });
    key({ type: 'consoleKey', serverId: h1, key: 'Enter' }); // IPv4
    expect(view()).toMatchObject({ screen: { id: 'dcui-ipv4' }, values: { ip: '' } });
    key({ type: 'consoleKey', serverId: h1, key: 'Enter', value: { ip: '10.0.0.101', mask: '255.255.255.0', gw: '10.0.0.1' } });
    key({ type: 'consoleKey', serverId: h1, key: 'Down' });
    key({ type: 'consoleKey', serverId: h1, key: 'Down' });
    key({ type: 'consoleKey', serverId: h1, key: 'Down' });
    key({ type: 'consoleKey', serverId: h1, key: 'Enter' }); // DNS
    key({ type: 'consoleKey', serverId: h1, key: 'Enter', value: { dns1: '10.0.0.53', hostname: 'esx01.lab.example' } });
    key({ type: 'consoleKey', serverId: h1, key: 'Esc' });
    expect(view().screen.id).toBe('dcui-confirm');
    key({ type: 'consoleKey', serverId: h1, key: 'Y' });
    const srv = s.snapshot().physical.servers.find((x) => x.id === h1)!;
    expect(srv).toMatchObject({ status: 'esx-static', esx: { network: { ipv4Address: '10.0.0.101', hostnameFqdn: 'esx01.lab.example' } } });
    // batch: same choices on the other two (same configuration)
    expect(s.snapshot().consoles.batch.candidates).toEqual([
      { serverId: h2, eligible: true },
      { serverId: h3, eligible: true },
    ]);
    expect(JSON.stringify(s.snapshot().consoles.batch)).not.toContain('Vmw@re');
    expect(created(must(s, { type: 'installEsxBatch' }))).toEqual([h2, h3]);
    run(s);
    expect(s.snapshot().physical.servers.every((x) => x.esx.esxVersion !== undefined)).toBe(true);
    // the batch host remembers the template password for the DCUI login
    must(s, { type: 'openConsole', serverId: h2 });
    must(s, { type: 'consoleKey', serverId: h2, key: 'Enter' });
    must(s, { type: 'consoleKey', serverId: h2, key: 'F2' });
    must(s, { type: 'consoleKey', serverId: h2, key: 'Enter', value: 'Vmw@re-Lab1x' });
    expect(s.snapshot().consoles.byServer[h2]!.loggedIn).toBe(true);
    must(s, { type: 'closeConsole', serverId: h2 });
    expect(s.snapshot().consoles.byServer[h2]!.open).toBe(false);
  });

  it('batch skips hosts with a different configuration; no template -> flow', () => {
    const s = v3();
    const { hosts } = rackWith(s, 1);
    expect(reject(s, { type: 'installEsxBatch' })).toMatchObject({ reason: 'no-install-template' });
    const other = created(must(s, { type: 'buyItem', itemId: 'dell-r670-sm' }))[0]!;
    must(s, { type: 'mountDevice', inventoryId: other, rackId: s.snapshot().physical.racks[0]!.id });
    const h = hosts[0]!;
    must(s, { type: 'openConsole', serverId: h });
    for (const [k, v] of [['Enter'], ['Enter'], ['Enter', 'boot'], ['Enter'], ['Enter', 'Vmw@re-Lab1x'], ['F11']] as const)
      must(s, { type: 'consoleKey', serverId: h, key: k, ...(v !== undefined ? { value: v } : {}) });
    expect(s.snapshot().consoles.batch.candidates).toEqual([{ serverId: other, eligible: false, reason: expect.stringContaining('jinou konfiguraci') }]);
    expect(reject(s, { type: 'installEsxBatch' })).toMatchObject({ reason: 'nothing-to-do' });
  });
});
