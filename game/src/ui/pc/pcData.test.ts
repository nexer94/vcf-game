import { describe, expect, it } from 'vitest';
import { SandboxSession } from '../../modes/sandbox';
import { loadDesignStepData } from '../sandbox/designData';
import { subnetOf, boardInputOf } from '../whiteboard/boardInput';
import { pcDesignFromLocal, pcDesignFromSnapshot, recommendationsOf, unlockOf } from './pcData';

describe('pcData', () => {
  it('unlock texts carry the model numbers', () => {
    expect(unlockOf({ kind: 'buy-hosts', count: 1 })).toEqual({ text: 'Kup ještě 1 server', target: 'shop-servers' });
    expect(unlockOf({ kind: 'buy-hosts', count: 3 }).text).toBe('Kup ještě 3 servery');
  });
  it('★ only for positive documented recommendations', () => {
    const c = (text: string) => ({ kind: 'recommendation', text, quote: true, paraphrased: false, sources: [] });
    expect(recommendationsOf([], [c('Not recommended running virtual machine workloads directly on the vSAN Storage Clusters.')])).toEqual([]);
    expect(recommendationsOf([], [c('This option is recommended for a production VMware Cloud Foundation deployment.')])).toHaveLength(1);
    expect(recommendationsOf([{ id: 'X-REQD-1', kind: 'REQD', text: '', quote: true, relation: 'applies', sources: [] }], [])).toEqual([]);
  });
  it('maps the session snapshot incl. hardware availability', () => {
    const s = new SandboxSession();
    const m = pcDesignFromSnapshot(s.snapshot());
    expect(m.source).toBe('session');
    expect(m.total).toBeGreaterThan(0);
    expect(m.hw?.hostCount).toBe(0);
    for (const d of m.decisions) for (const o of d.options) expect(typeof o.available).toBe('boolean');
  });
  it('maps the local design data', () => {
    const m = pcDesignFromLocal(loadDesignStepData(new Map()), new Set());
    expect(m.source).toBe('local');
    expect(m.done).toBe(0);
    expect(m.decisions.every((d) => d.status === 'pending' || d.status === 'error')).toBe(true);
  });
});

describe('boardInput', () => {
  it('subnet math', () => {
    expect(subnetOf('172.16.10.21', '255.255.255.0')).toBe('172.16.10.0/24');
    expect(subnetOf('10.0.0.1', 'bad')).toBeUndefined();
  });
  it('empty room maps to an empty board', () => {
    const empty = { revision: 0, source: 'local-fallback' as const, catalog: { servers: [], switches: [], racks: [], drives: [], nics: [], datasetFetchedAt: '', datasetRelease: '' }, racks: [], devices: [], cables: [], inventory: [], issues: [], traffic: [], objectives: [], objectivesHidden: false, spent: 0 };
    const b = boardInputOf(empty, new SandboxSession().snapshot());
    expect(b.hosts).toEqual([]);
    expect(b.logical?.hostsInRoom).toBe(0);
  });
});
