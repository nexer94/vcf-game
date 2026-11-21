import { describe, expect, it } from 'vitest';
import { SandboxSession } from '../../modes/sandbox';
import { dcuiPrefill, formatVlanList, hostIpInPlan, hostNetBands, parseVlanList, resolveShowMe, splitList, tabForObjective } from './panelData';

function built(): { s: SandboxSession; rack: string; srv: string; sw: string } {
  const s = new SandboxSession();
  const created = (cmd: Parameters<SandboxSession['dispatch']>[0]): string => {
    const r = s.dispatch(cmd);
    if (!r.ok) throw new Error(JSON.stringify(r.rejection));
    return r.created?.[0] ?? '';
  };
  const rack = created({ type: 'buyItem', itemId: 'rack-generic-42u' });
  s.dispatch({ type: 'placeRack', inventoryId: rack, tile: { gx: 2, gy: 2 } });
  const srv = created({ type: 'buyItem', itemId: 'dell-r670-med' });
  const sw = created({ type: 'buyItem', itemId: 'sw-generic-48x25g' });
  s.dispatch({ type: 'mountDevice', inventoryId: srv, rackId: rack });
  s.dispatch({ type: 'mountDevice', inventoryId: sw, rackId: rack, positionU: 42 });
  s.dispatch({ type: 'connectCable', from: { deviceId: srv, port: 0 }, to: { deviceId: sw, port: 0 } });
  return { s, rack, srv, sw };
}

describe('panel data helpers', () => {
  it('parses and formats VLAN lists (form input only)', () => {
    expect(parseVlanList('all')).toBe('all');
    expect(parseVlanList('')).toBe('all');
    expect(parseVlanList('10, 20-22')).toEqual([10, 20, 21, 22]);
    expect(parseVlanList('x')).toBeNull();
    expect(formatVlanList([10, 11, 12, 20])).toBe('10-12, 20');
    expect(formatVlanList('all')).toBe('all');
    expect(splitList(' a, b;c ')).toEqual(['a', 'b', 'c']);
    expect(hostIpInPlan('10.0.0.1', 12)).toBe('10.0.0.12');
  });

  it('DCUI prefill: game defaults + documented "no VLAN" before configuration, current values after', () => {
    const { s, srv, sw } = built();
    s.dispatch({ type: 'connectCompanyNetwork', switchId: sw });
    const p = dcuiPrefill(s.snapshot(), srv);
    expect(p.sources.ip.kind).toBe('game-default');
    expect(p.sources.vlan.kind).toBe('documented');
    expect(p.draft.vlan).toBe('');
    const gw = s.snapshot().physical.endpoints.find((e) => e.kind === 'gateway')?.ipv4;
    expect(p.draft.gw).toBe(gw);
    expect(p.draft.ip.startsWith(gw!.split('.').slice(0, 3).join('.'))).toBe(true);
    s.dispatch({ type: 'installEsx', serverId: srv, method: 'physical' });
    expect(s.snapshot().tasks.some((t) => t.serverId === srv)).toBe(true);
  });

  it('host bands: vmnic cards follow the server NICs and the switch port', () => {
    const { s, srv } = built();
    const b = hostNetBands(s.snapshot(), srv)!;
    expect(b.cards.length).toBe(s.snapshot().physical.servers[0]!.nicPorts.length);
    expect(b.cards[0]!.port?.index).toBe(0);
    expect(b.cards[0]!.cabled).toBe(true);
    expect(b.vmks.find((v) => v.service === 'management')?.vmk).toBeUndefined();
  });

  it('showMe resolves views, panels and inventory tabs', () => {
    const { s, rack, srv, sw } = built();
    const snap = s.snapshot();
    expect(resolveShowMe({ view: 'rack' }, snap)).toEqual({ kind: 'view', view: { kind: 'rack', rackId: rack } });
    expect(resolveShowMe({ view: 'pc/navrh' }, snap)).toEqual({ kind: 'view', view: { kind: 'pc', app: 'navrh' } });
    expect(resolveShowMe({ view: 'pc/use-case' }, snap)).toEqual({ kind: 'view', view: { kind: 'pc', app: 'use-case' } });
    expect(resolveShowMe({ view: 'room' }, snap)).toEqual({ kind: 'view', view: { kind: 'room' } });
    expect(resolveShowMe({ panel: 'dns' }, snap)).toEqual({ kind: 'dns' });
    expect(resolveShowMe({ panel: 'switch' }, snap)).toEqual({ kind: 'switch', switchId: sw, rackId: rack });
    expect(resolveShowMe({ panel: 'host' }, snap, 'hosts.esx')).toEqual({ kind: 'server', serverId: srv, rackId: rack, tab: 'esx' });
    expect(resolveShowMe({ inventory: 'servers' }, snap)).toEqual({ kind: 'inventory', tab: 'servers' });
    expect(resolveShowMe({ inventory: 'nope' }, snap).kind).toBe('none');
    expect(tabForObjective('hosts.mgmt-network')).toBe('dcui');
  });
});
