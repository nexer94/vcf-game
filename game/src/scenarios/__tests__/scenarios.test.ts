import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLEET_DESIGN_CLUSTER_MODELS, MODELLED_VCF_VERSION, validateFleet } from '../../model/architecture';
import * as bringupModule from '../../model/bringup';
import {
  type BringupEnvironment,
  type BringupSpec,
  type EsxHost,
  type InstallerOvfInput,
  type InstallerState,
  type OfflineDepotInput,
  type OnlineDepotInput,
  buildFleetFromBringup,
  validateBinariesForDeployment,
  validateBringupSpec,
  validateConfigureOfflineDepot,
  validateConfigureOnlineDepot,
  validateDeployInstallerOva,
  validateEsxHostsForBringup,
  validateInstallerCanDeploy,
} from '../../model/bringup';
import { VALIDATION_CODES, type ValidationIssue, errorsOf } from '../../model/validation';
import {
  type CheckContext,
  type Mission,
  type SpecRef,
  type ValidationCheckId,
  DIFFICULTIES,
  MODEL_ACTIONS,
  checkMissionShape,
  leafConditions,
  referencedCodes,
} from '../schema';

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const scenariosDir = join(here, '..');
const bringupDir = join(scenariosDir, 'bringup');
const specDir = join(scenariosDir, '..', '..', '..', 'docs', 'spec');

const files = readdirSync(bringupDir)
  .filter((f) => f.endsWith('.json'))
  .sort();
const raw = files.map((file) => ({ file, json: JSON.parse(readFileSync(join(bringupDir, file), 'utf8')) as unknown }));
const missions = raw.map((r) => r.json as Mission);

/** All validation codes the model can produce (typed registry exported by the model). */
const modelCodes: ReadonlySet<string> = new Set<string>(VALIDATION_CODES);

const specCache = new Map<string, string>();
function specText(spec: string): string {
  let t = specCache.get(spec);
  if (t === undefined) {
    t = readFileSync(join(specDir, `${spec}.md`), 'utf8');
    specCache.set(spec, t);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Running model validators against a mission world
// ---------------------------------------------------------------------------

interface RunCtx {
  readonly env: BringupEnvironment;
  readonly installerBefore: InstallerState;
  readonly spec: BringupSpec | undefined;
  readonly ovf: InstallerOvfInput | undefined;
  readonly online: OnlineDepotInput | undefined;
  readonly offline: OfflineDepotInput | undefined;
}

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`missing ${what}`);
  return v;
}

function runCheck(check: ValidationCheckId, ctx: RunCtx, context: CheckContext | undefined): ValidationIssue[] {
  const env = ctx.env;
  switch (check) {
    case 'validateDeployInstallerOva':
      return validateDeployInstallerOva(ctx.installerBefore, need(ctx.ovf, 'installer OVF'), env.dns, env.rules?.dictionaryWords ?? []);
    case 'validateInstallerCanDeploy':
      return validateInstallerCanDeploy(env.installer);
    case 'validateEsxHostsForBringup': {
      const ids = context?.hosts;
      const hosts = ids ? env.hosts.filter((h) => ids.includes(h.id)) : env.hosts;
      return validateEsxHostsForBringup(hosts, {
        dns: env.dns,
        model: need(context?.model, 'context.model'),
        storage: need(context?.storage, 'context.storage'),
        ...(env.rules ? { rules: env.rules } : {}),
      });
    }
    case 'validateConfigureOnlineDepot':
      return validateConfigureOnlineDepot(need(ctx.online, 'online depot input'));
    case 'validateConfigureOfflineDepot':
      return validateConfigureOfflineDepot(need(ctx.offline, 'offline depot input'));
    case 'validateBinariesForDeployment':
      return validateBinariesForDeployment(env.depot);
    case 'validateBringupSpec':
      return validateBringupSpec(need(ctx.spec, 'spec'), env);
    case 'validateFleet':
      return validateFleet(
        buildFleetFromBringup(
          need(ctx.spec, 'spec'),
          { fleetId: 'fleet-1', fleetName: 'fleet', instanceId: 'inst-1', domainId: 'dom-1', clusterId: 'cl-1' },
          context?.clusterModel ?? 'single-rack',
        ),
      );
    case 'transition':
      throw new Error('transition errors cannot be evaluated statically');
  }
}

function initialEnv(m: Mission): BringupEnvironment {
  const i = m.initial;
  return {
    installer: i.installer,
    depot: i.depot,
    hosts: i.hosts,
    dns: i.dns,
    ...(i.existingInstanceNames ? { existingInstanceNames: i.existingInstanceNames } : {}),
    ...(i.unreachableFromInstaller ? { unreachableFromInstaller: i.unreachableFromInstaller } : {}),
    ...(i.physicalNetworkLagReady !== undefined ? { physicalNetworkLagReady: i.physicalNetworkLagReady } : {}),
    ...(i.rules ? { rules: i.rules } : {}),
  };
}

function initialCtx(m: Mission): RunCtx {
  const env = initialEnv(m);
  return {
    env,
    installerBefore: env.installer,
    spec: m.initial.spec,
    ovf: m.initial.drafts?.installerOvf,
    online: m.initial.drafts?.onlineDepot,
    offline: m.initial.drafts?.offlineDepot,
  };
}

function solvedCtx(m: Mission): RunCtx {
  const s = need(m.referenceSolution, 'referenceSolution');
  const base = initialEnv(m);
  const hosts = base.hosts.map((h): EsxHost => {
    const p = s.hostPatches?.find((x) => x.id === h.id);
    return p ? { ...h, ...p.patch } : h;
  });
  const dns = {
    forward: { ...base.dns.forward, ...s.dnsPatch?.forward },
    reverse: { ...base.dns.reverse, ...s.dnsPatch?.reverse },
  };
  const installer: InstallerState = s.installerOvf ? { ...base.installer, mode: 'installer', ovf: s.installerOvf } : base.installer;
  const depot = s.depot ?? base.depot;
  return {
    env: { ...base, hosts, dns, installer, depot },
    installerBefore: base.installer,
    spec: s.spec ?? m.initial.spec,
    ovf: s.installerOvf ?? m.initial.drafts?.installerOvf,
    online: depot.connection.kind === 'online' ? depot.connection.input : undefined,
    offline: depot.connection.kind === 'offline' ? depot.connection.input : undefined,
  };
}

const codesOf = (issues: readonly ValidationIssue[]): string[] => [...new Set(issues.map((i) => i.code))].sort();
const fmt = (issues: readonly ValidationIssue[]): string[] => issues.map((i) => `${i.code} (${i.subject ?? '-'})`);

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function allSpecRefs(m: Mission): SpecRef[] {
  return [
    ...m.specRefs,
    ...m.tasks.flatMap((t) => t.specRefs),
    ...m.traps.flatMap((t) => t.specRefs),
    ...m.hints.map((h) => h.specRef),
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bring-up campaign missions', () => {
  it('has 4–6 mission files', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files.length).toBeLessThanOrEqual(6);
  });

  it.each(raw.map((r): [string, unknown] => [r.file, r.json]))('%s conforms to the schema', (_file, json) => {
    expect(checkMissionShape(json)).toEqual([]);
  });

  it('missions form one campaign with unique, increasing order and valid unlocks', () => {
    const ids = new Set(missions.map((m) => m.id));
    expect(ids.size).toBe(missions.length);
    expect(new Set(missions.map((m) => m.campaign.id)).size).toBe(1);
    const sorted = [...missions].sort((a, b) => a.order - b.order);
    expect(sorted.map((m) => m.order)).toEqual(sorted.map((_, i) => i + 1));
    for (const m of missions)
      for (const r of m.requires) {
        const req = missions.find((x) => x.id === r);
        expect(req, `${m.id} requires unknown ${r}`).toBeDefined();
        expect(req!.order).toBeLessThan(m.order);
      }
    // Difficulty never decreases and the campaign covers the whole ladder.
    const levels = sorted.map((m) => DIFFICULTIES.indexOf(m.difficulty));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(sorted.map((m) => m.difficulty))).toEqual(new Set(DIFFICULTIES));
  });

  it('uses the modelled VCF version', () => {
    for (const m of missions) expect(m.vcfVersion).toBe(MODELLED_VCF_VERSION);
  });

  it('every referenced validation code exists in the model', () => {
    expect(modelCodes.size).toBeGreaterThan(50);
    for (const m of missions) {
      const unknown = referencedCodes(m).filter((c) => !modelCodes.has(c));
      expect(unknown, m.id).toEqual([]);
    }
  });

  it('every model action maps to an exported model function', () => {
    const mod = bringupModule as unknown as Record<string, unknown>;
    for (const fn of Object.values(MODEL_ACTIONS)) expect(typeof mod[fn], fn).toBe('function');
  });

  it('every spec reference points to an existing section and source; hint links are spec sources', () => {
    for (const m of missions) {
      for (const r of allSpecRefs(m)) {
        const text = specText(r.spec);
        const num = r.section.slice(1).replace(/\./g, '\\.');
        expect(new RegExp(`^#{2,4} ${num}(\\.|\\s)`, 'm').test(text), `${m.id}: ${r.spec} ${r.section}`).toBe(true);
        for (const s of r.sources) expect(new RegExp(`^(- )?\\[${s}\\][: ]`, 'm').test(text), `${m.id}: ${r.spec} [${s}]`).toBe(true);
      }
      for (const h of m.hints) expect(specText(h.specRef.spec).includes(h.doc.url), `${m.id}/${h.id}: ${h.doc.url}`).toBe(true);
    }
  });

  it('budget, when present, is marked as a game mechanic', () => {
    for (const m of missions) if (m.budget) expect(m.budget.gameMechanic).toBe(true);
  });

  describe.each(missions.map((m): [string, Mission] => [m.id, m]))('%s – model self-check', (_id, m) => {
    it('initial world produces the expected validation issues', () => {
      for (const e of m.expectedInitialIssues ?? []) {
        const actual = codesOf(runCheck(e.check, initialCtx(m), e.context));
        if (e.exact) expect(actual, e.check).toEqual([...new Set(e.codes)].sort());
        else for (const c of e.codes) expect(actual, e.check).toContain(c);
      }
    });

    it('initial-state traps are actually present in the initial world', () => {
      const ctx = initialCtx(m);
      for (const t of m.traps.filter((x) => x.armed === 'initial-state')) {
        const found = t.detectedBy
          .filter((d) => d !== 'transition')
          .flatMap((d) => {
            try {
              return codesOf(runCheck(d, ctx, { model: 'simple', storage: 'vsan-esa' }));
            } catch {
              return [];
            }
          });
        const hit = t.codes.some((c) => found.includes(c));
        // A trap may be latent only behind a host without ESX (the validator skips such hosts until
        // they are installed, e.g. the missing PTR of esx04 in mission 2); otherwise it must be visible.
        if (!hit) {
          const hosts = m.initial.hosts.filter((h) => h.esxVersion === undefined).length;
          expect(hosts, `${m.id}/${t.id} not detectable in initial world`).toBeGreaterThan(0);
        }
      }
    });

    it('reference solution passes all its checks', () => {
      if (!m.referenceSolution) return;
      const ctx = solvedCtx(m);
      for (const c of m.referenceSolution.checks) {
        const issues = runCheck(c.check, ctx, c.context);
        expect(fmt(errorsOf(issues)), c.check).toEqual([]);
        if (!c.allowWarnings) expect(fmt(issues), c.check).toEqual([]);
      }
    });

    it('reference solution satisfies spec-field and design-choice conditions', () => {
      const sol = m.referenceSolution;
      if (!sol) return;
      const spec = sol.spec ?? m.initial.spec;
      const choices: Record<string, string | undefined> = {
        'cluster-model': sol.designChoices?.clusterModel,
        'fleet-design': sol.designChoices?.fleetDesign,
        'installer-placement': sol.designChoices?.installerPlacement,
      };
      for (const t of m.tasks)
        for (const c of leafConditions(t.completion)) {
          if (c.kind === 'spec-field' && spec) expect(c.oneOf, `${t.id}: ${c.path}`).toContain(getPath(spec, c.path));
          if (c.kind === 'design-choice') {
            const v = choices[c.choice];
            if (v !== undefined) expect(c.oneOf, `${t.id}: ${c.choice}`).toContain(v);
          }
        }
      const d = sol.designChoices;
      if (d?.fleetDesign && d.clusterModel) expect(FLEET_DESIGN_CLUSTER_MODELS[d.fleetDesign].management).toContain(d.clusterModel);
    });
  });
});
