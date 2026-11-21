/**
 * Career level definitions (CLAUDE.md "Kariéra"; UX ch. 25). A level = SandboxSession + level data – no new engine:
 *  - `initialCommands` are REPLAYED through the Sandbox reducer (replay.ts), so the prepared world obeys every model
 *    rule; a later "Hotový scénář" (pre-built, fully deployed environment) uses the same mechanism up to a completed
 *    bring-up;
 *  - `objectives` = the level's checklist (objectives loader format + bubble / points / bonus);
 *  - `lockedDecisions` = design decisions fixed by the level (blueprint, UX 25.2 "zamčené … podle blueprintu");
 *  - `success` = criteria of UX 25.4 evaluated by evaluateLevel (evaluate.ts) from the snapshot;
 *  - budget, points, penalties = GAME MECHANICS (fictional, always labelled "herní" in the UI).
 *
 * VCF facts used here come from the model (DESIGN_BLUEPRINTS = spec 06 §2.2 / §6.1). Names, IP addresses and the
 * budget are GAME values (workbook of the fictional company).
 */
import { type BlueprintId, type DesignDecisionId, type DeploymentModel, type DeploymentSize, type SiteLayoutId, type StorageType, DESIGN_BLUEPRINTS } from '../../model';
import type { Difficulty } from '../../scenarios';
import c1l1Objectives from '../../scenarios/career/c1-l1-single-site.objectives.json';
import type { SandboxCommand } from '../sandbox';
import { blueprintDesignChoices } from '../sandbox';

export interface LevelSuccess {
  /** ESX hosts of the management domain (wizard hosts of the bring-up). */
  readonly hosts: number;
  readonly storage: StorageType;
  readonly deploymentModel: DeploymentModel;
  readonly size: DeploymentSize;
  /** One vendor, same configuration (model validateClusterHardware, objectives selector serversHomogeneous). */
  readonly homogeneous: boolean;
  readonly specRef: string;
}

export interface LevelScoring {
  /** "Ukaž" hint (UX 25.3: −2 b). */
  readonly hintPenalty: number;
  /** Opened solution (−10 b). */
  readonly solutionPenalty: number;
  /** Every Review validation round that ended with errors (−10 b, booked on the validation objective). */
  readonly validationErrorPenalty: number;
  /** Star thresholds as a share of max points without bonuses (60 / 80 / 95 %). */
  readonly starThresholds: readonly [number, number, number];
}

/** Workbook of the level (GAME values) – shown to the player, used for DCUI / DNS prefills by the UI. */
export interface LevelWorkbook {
  readonly domain: string;
  readonly gateway: string;
  readonly mask: string;
  readonly dnsServer: string;
  readonly ntpServer: string;
  readonly mgmtVlan: number | null;
  readonly hosts: readonly { readonly fqdn: string; readonly ip: string }[];
  readonly components: readonly { readonly role: string; readonly fqdn: string; readonly ip: string }[];
  readonly gameValues: true;
}

export interface CareerLevelDef {
  readonly id: string;
  readonly campaign: number;
  readonly level: number;
  readonly title: string;
  readonly difficulty: Difficulty;
  /** Briefing lines (Czech). */
  readonly briefing: readonly string[];
  readonly blueprintId: BlueprintId;
  readonly layoutId: SiteLayoutId;
  /** Session options of the level (game layer). */
  readonly session: { readonly autoBmc: boolean; readonly preinstalledTor: boolean };
  readonly initialCommands: readonly SandboxCommand[];
  /** Raw objective set (objectives loader format). */
  readonly objectives: unknown;
  /** Starting budget in game currency (fictional). */
  readonly budget: number;
  readonly lockedDecisions: readonly DesignDecisionId[];
  readonly success: LevelSuccess;
  readonly scoring: LevelScoring;
  readonly workbook: LevelWorkbook;
  /** Spec references of the level design. */
  readonly specRefs: readonly string[];
}

// ===========================================================================
// Kampaň 1 · Level 1 – "Single Site fleet s vSAN na 4 hostech" (UX 25)
// ===========================================================================

const DOMAIN = 'firma.vcfhra.cz';
const fq = (h: string): string => `${h}.${DOMAIN}`;
/** [GAME] addresses in the company network (roomNet COMPANY_NETWORK_GAME_DEFAULTS: gateway .1, DNS .53, NTP .123). */
const C1L1_COMPONENTS: readonly { readonly role: string; readonly fqdn: string; readonly ip: string }[] = [
  { role: 'VCF Installer', fqdn: fq('installer'), ip: '10.0.0.10' },
  { role: 'vCenter', fqdn: fq('vc01'), ip: '10.0.0.20' },
  { role: 'SDDC Manager', fqdn: fq('sddc01'), ip: '10.0.0.21' },
  { role: 'NSX Manager VIP', fqdn: fq('nsx01'), ip: '10.0.0.22' },
  { role: 'NSX Manager node A', fqdn: fq('nsx01a'), ip: '10.0.0.23' },
  { role: 'NSX Manager node B', fqdn: fq('nsx01b'), ip: '10.0.0.24' },
  { role: 'NSX Manager node C', fqdn: fq('nsx01c'), ip: '10.0.0.25' },
  { role: 'VCF Operations primary', fqdn: fq('ops01a'), ip: '10.0.0.30' },
  { role: 'VCF Operations replica', fqdn: fq('ops01b'), ip: '10.0.0.31' },
  { role: 'VCF Operations data', fqdn: fq('ops01c'), ip: '10.0.0.32' },
  { role: 'VCF Operations cloud proxy', fqdn: fq('opscp01'), ip: '10.0.0.33' },
  { role: 'License server', fqdn: fq('lic01'), ip: '10.0.0.34' },
  { role: 'Fleet components', fqdn: fq('fleet01'), ip: '10.0.0.35' },
  { role: 'Instance components', fqdn: fq('inst01'), ip: '10.0.0.36' },
  { role: 'Identity Broker', fqdn: fq('idb01'), ip: '10.0.0.37' },
  { role: 'Services runtime', fqdn: fq('vsp01'), ip: '10.0.0.38' },
  { role: 'VCF Automation', fqdn: fq('auto01'), ip: '10.0.0.39' },
  { role: 'VCF Automation services runtime', fqdn: fq('vsp02'), ip: '10.0.0.40' },
];

const C1L1_WORKBOOK: LevelWorkbook = {
  domain: DOMAIN,
  gateway: '10.0.0.1',
  mask: '255.255.255.0',
  dnsServer: '10.0.0.53',
  ntpServer: '10.0.0.123',
  mgmtVlan: 1610,
  hosts: [1, 2, 3, 4].map((i) => ({ fqdn: fq(`esx0${i}`), ip: `10.0.0.${100 + i}` })),
  components: C1L1_COMPONENTS,
  gameValues: true,
};

const BP_ID: BlueprintId = 'vcf-fleet-single-site';

export const C1_L1: CareerLevelDef = {
  id: 'c1-l1-single-site',
  campaign: 1,
  level: 1,
  title: 'Single Site fleet s vSAN na 4 hostech',
  difficulty: 'tutorial',
  briefing: [
    'Firma chce první privátní cloud v jedné serverovně. Postav ho podle blueprintu VCF Fleet in a Single Site.',
    'Připraveno: rack s ToR switchem, DNS záznamy komponent, VCF Installer se staženými binárkami.',
    'Tvůj úkol: servery → ESX → síť → průvodce → deploy.',
  ],
  blueprintId: BP_ID,
  layoutId: 'large-room',
  session: { autoBmc: true, preinstalledTor: true },
  initialCommands: [
    { type: 'chooseBlueprint', blueprintId: BP_ID, layoutId: 'large-room' },
    { type: 'placeRack', itemId: 'rack-generic-42u', tile: { gx: 5, gy: 4 }, facing: 'S' },
    ...C1L1_COMPONENTS.map((c): SandboxCommand => ({ type: 'addDnsRecord', fqdn: c.fqdn, ip: c.ip })),
    {
      type: 'deployInstaller',
      ovf: {
        vmName: 'vcf-installer',
        placement: 'outside-management',
        datastore: 'other',
        rootPassword: 'Kv8#Tmz!Q4rPx2wa',
        localUserPassword: 'Bz9^Kt4@Lm2!Qw8x',
        hostnameFqdn: fq('installer'),
        ntpServers: [C1L1_WORKBOOK.ntpServer],
        ipVersion: 'ipv4',
        ipv4Address: '10.0.0.10',
        subnetMask: C1L1_WORKBOOK.mask,
        defaultGateway: C1L1_WORKBOOK.gateway,
        dnsDomainName: DOMAIN,
        domainSearchPath: DOMAIN,
        dnsServers: [C1L1_WORKBOOK.dnsServer],
      },
    },
    { type: 'configureDepot', connection: { kind: 'online', input: { activationCode: 'GAME-ACT-0001' } } },
    { type: 'downloadBinaries' },
  ],
  objectives: c1l1Objectives,
  budget: 80_000,
  lockedDecisions: Object.keys(blueprintDesignChoices(BP_ID)) as DesignDecisionId[],
  success: {
    hosts: DESIGN_BLUEPRINTS[BP_ID].hostGroups.reduce((a, g) => a + g.esxHosts, 0),
    storage: DESIGN_BLUEPRINTS[BP_ID].documentedChoices['principal-storage'] as StorageType,
    deploymentModel: DESIGN_BLUEPRINTS[BP_ID].installer.deploymentModel,
    size: DESIGN_BLUEPRINTS[BP_ID].installer.size,
    homogeneous: true,
    specRef: '06-blueprints §2.2, §6.1 [B6][B7]; 20-deployment §4.2 [S14]',
  },
  scoring: { hintPenalty: 2, solutionPenalty: 10, validationErrorPenalty: 10, starThresholds: [0.6, 0.8, 0.95] },
  workbook: C1L1_WORKBOOK,
  specRefs: ['06-blueprints §2.2, §6.1 [B6][B7]', '20-deployment §4.1, §4.2 [S8][S14]', '10-planning §3.3 [P19]'],
};

export const CAREER_LEVELS: readonly CareerLevelDef[] = [C1_L1];

export const careerLevel = (id: string): CareerLevelDef | undefined => CAREER_LEVELS.find((l) => l.id === id);
