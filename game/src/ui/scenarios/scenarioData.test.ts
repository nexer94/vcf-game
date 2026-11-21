import { describe, expect, it } from 'vitest';
import { SCENARIO_PRESETS, presetById } from '../../model/deployedInventory';
import { compareRows, filterVms, gapView, layoutForPreset, scenarioCards, scenarioModel, sortVms, vmSourceRefs } from './scenarioData';
import { hostDeviceMap, loadScenario, overridesOf } from './scenarioSource';

describe('scenario cards', () => {
  it('lists every preset in menu order 1–5 with the numbers of the model', () => {
    const cards = scenarioCards();
    expect(cards.map((c) => c.id)).toEqual(SCENARIO_PRESETS.map((p) => p.id));
    const s1 = cards[0]!;
    expect(s1.scenario).toBe(1);
    expect(s1.vmCount).toBe(10);
    expect(s1.hosts).toBe(3);
    expect(s1.documented[0]!.resources).toEqual({ vcpu: 76, ramGB: 251, diskGB: 7448 });
    expect(s1.blueprint?.title).toBe('VCF Fleet in a Single Site with Minimal Footprint');
    const s5 = cards.find((c) => c.id === 's5-two-instances')!;
    expect(s5.documented).toHaveLength(2);
    expect(s5.planning).toEqual(presetById('s5-two-instances')!.expectedFleetPlanning);
  });

  it('no bracket source ids leak into card texts', () => {
    for (const c of scenarioCards()) expect(`${c.title} ${c.profiles}`).not.toMatch(/\[[A-Z]+\d+\]/);
  });
});

describe('scenario model view', () => {
  it('every VM is placed on a host of its cluster (game placement)', () => {
    for (const p of SCENARIO_PRESETS) {
      const m = scenarioModel(p);
      for (const v of m.vms) {
        const h = m.hosts.find((x) => x.id === v.hostId);
        expect(h?.clusterId).toBe(v.clusterId);
      }
    }
  });

  it('gap explanation: License server for the first instance, disk gap reported', () => {
    const m = scenarioModel(presetById('s1-minimal-simple')!);
    const md = m.totals.managementDomains[0]!;
    const g = gapView(md.documentedMinusPerVm!, md.base.undocumentedVms);
    expect(g.cpuRamText).toContain('License server');
    expect(g.diskText).toContain('1');
  });

  it('compare rows have both sides', () => {
    const rows = compareRows(scenarioModel(SCENARIO_PRESETS[0]!), scenarioModel(SCENARIO_PRESETS[2]!));
    expect(rows.every((r) => r.a && r.b)).toBe(true);
  });

  it('sort / filter / sources', () => {
    const m = scenarioModel(presetById('s2-ha-medium')!);
    const sorted = sortVms(m.vms, 'vcpu', -1, (id) => id ?? '');
    expect((sorted[0]!.vcpu ?? 0) >= (sorted.at(-1)!.vcpu ?? 0)).toBe(true);
    expect(filterVms(m.vms, '', 'nsx-manager').length).toBe(3);
    const vc = m.vms.find((v) => v.component === 'vcenter')!;
    expect(vmSourceRefs(vc)[0]).toContain('[W18]');
  });

  it('layout of a preset follows the blueprint mapping', () => {
    expect(layoutForPreset({ blueprintId: null })).toBeNull();
    expect(layoutForPreset({ blueprintId: 'vcf-fleet-across-multiple-regions' })).toBe('remote-dr');
  });
});

describe('scenario source adapter', () => {
  it('maps engine scenario fields defensively', () => {
    expect(overridesOf(null)).toEqual({});
    expect(overridesOf({ inventory: { nope: 1 } })).toEqual({});
    const map = hostDeviceMap({ scenario: { hostDevices: { h1: 'srv-01' } }, physical: { servers: [{ id: 'h2' }] } }, ['h1', 'h2', 'h3']);
    expect([...map]).toEqual([['h1', 'srv-01'], ['h2', 'h2']]);
  });

  it('every host has a mounted server in the engine room', async () => {
    const src = await loadScenario('s3-wld-dedicated-nsx');
    const st = src.roomState();
    for (const h of src.model.hosts) {
      const d = src.deviceOfHost(h.id);
      expect(d, h.id).toBeTruthy();
      expect(st.devices.find((x) => x.id === d)?.mount?.rackId).toBeTruthy();
      expect(src.hostOfDevice(d!)).toBe(h.id);
    }
    expect(src.model.clusters.every((c) => c.util)).toBe(true);
  }, 20000);

  it('multi-region scenario puts region 2 hosts into another room', async () => {
    const src = await loadScenario('s5-two-instances');
    const rooms = new Set(src.model.hosts.map((h) => src.roomOfRack(src.rackOfHost(h.id) ?? '')));
    expect(rooms.size).toBe(2);
  }, 20000);
});
