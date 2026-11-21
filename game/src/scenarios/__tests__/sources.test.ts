import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SOURCE_REGISTRY, parseSpecRef, parseSpecSources, resolveSpecRef, sourceByKey, sourceLinksForKeys, stripSourceIds } from '../sources';
import { buildRegistryFromDir } from '../sources/specSources';

const specDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/spec');

describe('source registry (UX 21.2)', () => {
  it('is in sync with the "Zdroje" sections of docs/spec (run `npm run gen:sources` when this fails)', () => {
    const fresh = buildRegistryFromDir(specDir, { readdirSync: (d) => readdirSync(d), readFileSync: (p, e) => readFileSync(p, e) });
    expect(SOURCE_REGISTRY).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it('parses both line formats; only inside Zdroje sections; first id wins', () => {
    const md = [
      '## 1. Text',
      '- [S1] Not a source line: https://techdocs.broadcom.com/x.html',
      '## 9. Zdroje',
      '- [S1] Deploy VCF Installer (9.1): https://techdocs.broadcom.com/a.html',
      '- [S2]: https://knowledge.broadcom.com/external/article/1 – KB title',
      '- [S3] (už výše) without url',
      '- [S1] duplicate: https://techdocs.broadcom.com/dup.html',
    ].join('\n');
    expect(parseSpecSources('20-deployment', md)).toEqual([
      { key: '20-deployment:S1', file: '20-deployment', id: 'S1', title: 'Deploy VCF Installer (9.1)', url: 'https://techdocs.broadcom.com/a.html', domain: 'techdocs' },
      { key: '20-deployment:S2', file: '20-deployment', id: 'S2', title: 'KB title', url: 'https://knowledge.broadcom.com/external/article/1', domain: 'knowledge' },
    ]);
  });

  it('every spec file contributes sources, keys are unique', () => {
    const keys = SOURCE_REGISTRY.sources.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of SOURCE_REGISTRY.files) expect(SOURCE_REGISTRY.sources.some((s) => s.file === f), f).toBe(true);
  });

  it('resolves spec refs to readable titles without bracket ids', () => {
    const p = parseSpecRef('06 §2.2, §6.1 [B6][B7]; 10-planning §3.3 [P19] [SIMPL]', SOURCE_REGISTRY.files);
    expect(p.keys).toEqual(['06-blueprints:B6', '06-blueprints:B7', '10-planning:P19']);
    const r = resolveSpecRef('06 §2.2, §6.1 [B6][B7]; 10-planning §3.3 [P19]', { max: 2 });
    expect(r.links.map((l) => l.label)).toEqual(['Dokumentace: VCF Fleet in a Single Site', 'Dokumentace: Minimum Requirements for VCF Fleet in a Single Site']);
    expect(r.more).toBe(1);
    expect(r.specLine).toBe('spec 06 §2.2, §6.1 · 10 §3.3');
    expect(r.specLine).not.toMatch(/\[/);
    expect(resolveSpecRef('[U68]', { defaultFile: '25-usecases-and-physical' }).links[0]?.key).toBe('25-usecases-and-physical:U68');
    expect(resolveSpecRef('10 §3.3 [P999]').unknownKeys).toEqual(['10-planning:P999']);
    expect(sourceByKey('15-hardware:H1')?.domain).toBe('knowledge');
    expect(sourceLinksForKeys(['15-hardware:H1']).links[0]!.label).toMatch(/^Znalostní báze: /);
    expect(stripSourceIds('Host musí být na ToR [P19][P17].')).toBe('Host musí být na ToR.');
  });
});
