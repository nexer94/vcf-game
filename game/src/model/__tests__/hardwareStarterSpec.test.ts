/**
 * Regression: every starter configuration of docs/spec/15-hardware.md Příloha B.3 derives EXACTLY the profile and
 * status listed in the spec table (read from the spec file itself, not from the hand-written catalog definitions).
 * Also checks that STARTER_CONFIG_DEFS (hardwareCatalogCore.ts) mirror the B.3 rows.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type EsaProfileId, validateServerConfig } from '../hardware';
import { STARTER_CONFIG_DEFS, type StarterStatus, buildHardwareCatalog } from '../hardwareCatalog';

const specPath = join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/spec/15-hardware.md');
const spec = readFileSync(specPath, 'utf8');

interface B3Row {
  readonly id: string;
  readonly productId: number;
  /** 'below-sm' = „pod HCI-SM“; 'none' = „–“ (spec states no profile); else the listed HCI profile. */
  readonly profile: EsaProfileId | 'below-sm' | 'none';
  /** „(výpočetně MED)“ – compute profile when the network keeps the node lower. */
  readonly computeProfile?: EsaProfileId;
  readonly cores: number;
  readonly sockets?: number;
  readonly coresPerSocket?: number;
  readonly ramGB: number;
  readonly drives: readonly (readonly [string, number])[];
  readonly triMode: boolean;
  readonly capacityTB?: number;
  readonly nics: readonly (readonly [string, number])[];
  readonly fcHba: boolean;
  readonly status: StarterStatus;
  readonly stav: string;
}

function parseB3(md: string): B3Row[] {
  const start = md.indexOf('### B.3');
  const end = md.indexOf('\n### ', start + 1);
  const section = md.slice(start, end < 0 ? undefined : end);
  const rows: B3Row[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const c = line.split('|').slice(1, -1).map((x) => x.trim());
    if (c.length !== 10) throw new Error(`B.3 row with ${c.length} columns: ${line}`);
    const [idC, modelC, profC, coresC, ramC, drivesC, capC, nicC, , stavC] = c as [string, string, string, string, string, string, string, string, string, string];
    const prof = /^HCI-(SM|MED|LRG)(?:\s*\(výpočetně (SM|MED|LRG)\))?/.exec(profC);
    const cores = /^(\d+)(?:\s*\((\d+) × (\d+)\))?/.exec(coresC);
    const cap = /^([\d.]+)\s*TB/.exec(capC);
    const status: StarterStatus = stavC.startsWith('✓') ? 'ok' : stavC.includes('**DEV**') ? 'dev' : stavC.includes('✗') ? 'req' : stavC.startsWith('EXT') ? 'ext' : (() => { throw new Error(`B.3 status: ${stavC}`); })();
    rows.push({
      id: /`([^`]+)`/.exec(idC)![1]!,
      productId: Number(/\((\d+)\)/.exec(modelC)![1]),
      profile: prof ? (`vSAN-HCI-${prof[1]}` as EsaProfileId) : profC === 'pod HCI-SM' ? 'below-sm' : 'none',
      ...(prof?.[2] ? { computeProfile: `vSAN-HCI-${prof[2]}` as EsaProfileId } : {}),
      cores: Number(cores![1]),
      ...(cores?.[2] ? { sockets: Number(cores[2]), coresPerSocket: Number(cores[3]) } : {}),
      ramGB: Number(ramC),
      drives: [...drivesC.matchAll(/(\d+) × `(drv-[^`]+)`/g)].map((m) => [m[2]!, Number(m[1])] as const),
      triMode: drivesC.includes('Tri-Mode'),
      ...(cap ? { capacityTB: Number(cap[1]) } : {}),
      nics: [...nicC.matchAll(/(\d+) × `(nic-[^`]+)`/g)].map((m) => [m[2]!, Number(m[1])] as const),
      fcHba: nicC.includes('FC HBA'),
      status,
      stav: stavC,
    });
  }
  return rows;
}

const rows = parseB3(spec);
const cat = buildHardwareCatalog();

describe('15 Příloha B.3 table (read from the spec)', () => {
  it('has the 25 rows of the catalog, same ids in the same order', () => {
    expect(rows.map((r) => r.id)).toEqual(STARTER_CONFIG_DEFS.map((d) => d.id));
  });

  for (const row of rows)
    it(`${row.id}: catalog definition mirrors the spec row`, () => {
      const def = STARTER_CONFIG_DEFS.find((d) => d.id === row.id)!;
      expect(def.productId).toBe(row.productId);
      expect(def.sockets * def.coresPerSocket).toBe(row.cores);
      if (row.sockets !== undefined) expect([def.sockets, def.coresPerSocket]).toEqual([row.sockets, row.coresPerSocket]);
      expect(def.ramGB).toBe(row.ramGB);
      expect(def.drives).toEqual(row.drives);
      expect(def.nics).toEqual(row.nics);
      expect(def.triModeController === true).toBe(row.triMode);
      expect(def.fcHba === true).toBe(row.fcHba);
      expect(def.expectedStatus).toBe(row.status);
      expect(def.expectedProfile).toBe(row.profile === 'below-sm' || row.profile === 'none' ? undefined : row.profile);
    });
});

describe('every B.3 entry derives exactly the profile / status listed in the spec (15 §6.1, §5)', () => {
  for (const row of rows)
    it(`${row.id} -> ${row.profile} / ${row.status}`, () => {
      const s = cat.starterServers.find((x) => x.id === row.id)!;
      const esa = validateServerConfig(cat, s.config, { storage: 'vsan-esa' });

      // Node capacity column (61.4 / 30.7 TB are rounded in the spec).
      if (row.capacityTB !== undefined) expect(Math.abs((esa.metrics?.nodeCapacityTB ?? -1) - row.capacityTB)).toBeLessThan(0.05);

      // Profile column.
      if (row.profile === 'below-sm') expect(esa.esaProfile?.profile).toBeUndefined();
      else if (row.profile !== 'none') {
        expect(esa.esaProfile?.profile).toBe(row.profile);
        expect(esa.esaProfile?.computeProfile).toBe(row.computeProfile ?? row.profile);
        expect(esa.esaProfile?.networkLimited).toBe(row.computeProfile !== undefined);
      }

      // Status column.
      const r = row.status === 'ext' ? validateServerConfig(cat, s.config, { storage: 'vmfs-fc' }) : esa;
      const req = r.findings.filter((f) => f.hwClass === 'REQ').map((f) => f.code);
      const dev = r.findings.filter((f) => f.hwClass === 'DEV').map((f) => f.code);
      const kb10g = row.stav.includes('KB 372309');
      switch (row.status) {
        case 'ok':
          expect(req).toEqual([]);
          // ✓ rows: the only warning is the documented 10 GbE note of the row (KB 372309/372311).
          expect(dev).toEqual(kb10g ? ['HW_ESA_10GBE_COMPLIANCE'] : []);
          expect(r.eligible).toBe(true);
          break;
        case 'dev':
          expect(req).toEqual([]);
          expect(dev.filter((c) => c !== 'HW_ESA_10GBE_COMPLIANCE').length).toBeGreaterThan(0);
          expect(r.eligible).toBe(true);
          break;
        case 'req':
          expect(req.length).toBeGreaterThan(0);
          expect(r.eligible).toBe(false);
          if (row.profile === 'below-sm') expect(req).toContain('HW_ESA_BELOW_SM_PROFILE');
          break;
        case 'ext':
          expect(req).toEqual([]);
          expect(r.eligible).toBe(true);
          break;
      }
    });
});
