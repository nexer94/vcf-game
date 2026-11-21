/**
 * Physical hardware of ESX hosts: BCG ReadyNode server models, parts, server configurations,
 * vSAN ESA profile derivation and HW validation (spec docs/spec/15-hardware.md, VCF 9.1.1).
 *
 * Trust levels (15 §0): rules come only from [T] (techdocs / KB) and [BCG] (official BCG data / guidance).
 * Values the game chooses itself are marked `[SIMPL]` in comments and carry `gameDefault: true` / a
 * `source: 'SIMPL'` field in data.
 *
 * Finding classes (15 §5, column "Třída"):
 *   REQ  -> severity 'error'          (configuration invalid / unsupported for the use)
 *   DEV  -> severity 'warning'        (supported deviation with impact on performance / availability)
 *   RCMD -> severity 'recommendation' (documented recommendation only)
 *
 * Prices are NOT part of this module (economy is a game layer); every catalog item has a stable `id`.
 * Pure TypeScript: no DOM, no PixiJS, no randomness, no time.
 */
import type { BcgDataset, BcgReadyNodeRecord } from './bcgDataset';
import type { StorageType } from './bringup';
import { type ValidationIssue, issue } from './validation';

// ===========================================================================
// Basic types
// ===========================================================================

/** Server vendors of the game (CLAUDE.md; 15 §1). */
export const HW_VENDORS = ['Dell', 'HPE', 'Lenovo', 'Cisco', 'Supermicro'] as const;
export type HwVendor = (typeof HW_VENDORS)[number];
export const isHwVendor = (v: string): v is HwVendor => (HW_VENDORS as readonly string[]).includes(v);

export type EsaProfileFamily = 'HCI' | 'SC' | 'CR';
export type EsaProfileSize = 'SM' | 'MED' | 'LRG';
/** Profile names as used in BCG ReadyNode records (15 §1, §6.1 [H2][H9][BCG]). */
export type EsaProfileId = `vSAN-${EsaProfileFamily}-${EsaProfileSize}`;
const PROFILE_RE = /^vSAN-(HCI|SC|CR)-(SM|MED|LRG)$/;
export const isEsaProfileId = (s: string): s is EsaProfileId => PROFILE_RE.test(s);
export const PROFILE_SIZES: readonly EsaProfileSize[] = ['SM', 'MED', 'LRG'];
const sizeRank = (s: EsaProfileSize): number => PROFILE_SIZES.indexOf(s);

/** BCG Supported Release labels (15 B.1). Dataset strings may contain double spaces – compare normalised. */
export const BCG_RELEASE = { '9.1': 'ESXi 9.1 (vSAN 9.1)', '9.0': 'ESXi 9.0 (vSAN 9.0)' } as const;
export type TargetRelease = keyof typeof BCG_RELEASE;
export const normalizeRelease = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** A drive family entry in a ReadyNode BOM, e.g. "Dell E3.S PS1030 [3 DWPD]" (15 §2.2 [H9]). */
export interface BomDriveFamily {
  /** Exact BOM string (includes the DWPD suffix). */
  readonly name: string;
  readonly dwpd: number | undefined;
}

export function parseBomDriveFamily(name: string): BomDriveFamily {
  const m = /\[([\d.]+)\s*DWPD\]/i.exec(name);
  return { name, dwpd: m?.[1] !== undefined ? Number(m[1]) : undefined };
}

/** Certified server model = BCG vSAN ESA ReadyNode record (15 §2.2, Příloha A [H9][BCG]). */
export interface ServerModel {
  /** Stable catalog id `bcg-<productId>`. */
  readonly id: string;
  readonly productId: number;
  readonly vendor: HwVendor;
  readonly model: string;
  readonly cpuGeneration: string;
  readonly supportedReleases: readonly string[];
  /** Certified ReadyNode profiles (cap for the derived profile, 15 §6.1). */
  readonly profiles: readonly EsaProfileId[];
  readonly maxSockets: number;
  readonly maxCoresPerSocket: number;
  readonly maxMemoryGB: number;
  readonly maxDrives: number;
  readonly esaDrives: readonly BomDriveFamily[];
  readonly cyberRecoveryDrives: readonly BomDriveFamily[];
  readonly nics: readonly string[];
  readonly bootDevice: string;
  readonly pcieSwitch: string;
  readonly notes: string;
  readonly bcgUrl: string;
  /** BCG note refers to KB 393469 (Granite Rapids vSAN performance; "resolved in VCF 9.1", 15 §3.6 [H23]). */
  readonly kb393469Note: boolean;
  /**
   * Rack height in U. [SIMPL] The BCG dataset does not contain form factors; the game uses 2U for every
   * server (`rackUnitsGameDefault`).
   */
  readonly rackUnits: number;
  readonly rackUnitsGameDefault: true;
}

export const SERVER_RACK_UNITS_GAME_DEFAULT = 2;

export function serverModelFromRecord(r: BcgReadyNodeRecord): ServerModel | undefined {
  if (!isHwVendor(r.vendor)) return undefined;
  return {
    id: `bcg-${r.productId}`,
    productId: r.productId,
    vendor: r.vendor,
    model: r.model,
    cpuGeneration: r.cpuGeneration,
    supportedReleases: r.supportedReleases,
    profiles: r.profiles.filter(isEsaProfileId),
    maxSockets: r.maxSockets,
    maxCoresPerSocket: r.maxCoresPerSocket,
    maxMemoryGB: r.maxMemoryGB,
    maxDrives: r.maxDrives,
    esaDrives: r.esaDrives.map(parseBomDriveFamily),
    cyberRecoveryDrives: r.cyberRecoveryDrives.map(parseBomDriveFamily),
    nics: r.nics,
    bootDevice: r.bootDevice,
    pcieSwitch: r.pcieSwitch,
    notes: r.notes,
    bcgUrl: r.bcgUrl,
    kb393469Note: r.notes.includes('393469'),
    rackUnits: SERVER_RACK_UNITS_GAME_DEFAULT,
    rackUnitsGameDefault: true,
  };
}

export function serverModelsFromDataset(ds: BcgDataset): ServerModel[] {
  return ds.readyNodes.map(serverModelFromRecord).filter((m): m is ServerModel => m !== undefined);
}

export const isCertifiedFor = (m: ServerModel, release: TargetRelease): boolean =>
  m.supportedReleases.some((r) => normalizeRelease(r) === BCG_RELEASE[release]);

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

export type DriveInterface = 'NVMe' | 'SAS' | 'SATA';
export type ValueSource = 'BCG' | 'BCG-data' | 'SIMPL';

export interface DrivePart {
  readonly kind: 'drive';
  /** Stable part id from 15 Příloha B.2 (e.g. `drv-dell-ps1030-e3s-1600`). */
  readonly id: string;
  /** BOM family string (ESA / CR) or export model name (OSA). */
  readonly family: string;
  /** OEM channel the drive is certified under (15 §3.3 KB 326717: "disky jen v rámci stejného OEM"). */
  readonly oem: HwVendor;
  readonly interface: DriveInterface;
  readonly capacityTB: number;
  readonly capacitySource: ValueSource;
  /** From the BOM family suffix; undefined = not stated by data (15 §6.4 note). */
  readonly dwpd?: number;
  /** BOM section the family belongs to (15 §2.2). */
  readonly bomSection: 'esa' | 'cyber-recovery' | 'osa';
  /** NAND type only when the data states it (SAS TLC from export); CR P5430 = not stated (15 B.2). */
  readonly cell?: 'TLC' | 'QLC';
  /** Performance class F/G – not in the data (15 §6.4); undefined = not checked. */
  readonly performanceClass?: 'F' | 'G';
  readonly osaTiers?: readonly string[];
  readonly bcgDataUrl?: string;
}

export interface NicPart {
  readonly kind: 'nic';
  readonly id: string;
  /** Name exactly as in ReadyNode BOMs (15 B.2 [BCG]). */
  readonly bomName: string;
  /** Ports per card. [SIMPL] from the name (15 B.2). */
  readonly ports: number;
  /** Supported link speeds in GbE. [SIMPL] from the name ("10/25" -> [10, 25]). */
  readonly speedsGbE: readonly number[];
  readonly bcgDataUrl?: string;
  /** Ports / speed interpreted from the name, not from BCG fields. */
  readonly speedSource: 'SIMPL';
}

export const nicMaxSpeed = (n: NicPart): number => Math.max(...n.speedsGbE);

/** Boot device of a configuration (15 §3.1 [H12]; device string from BCG `bootDevice` [H9]). */
export interface BootDevice {
  readonly description: string;
  readonly capacityGB: number;
  /** 'BCG' when the size is parsed from the BOM string, 'SIMPL' otherwise. */
  readonly capacitySource: ValueSource;
  /** 'usb-sd' = USB/SD only, no persistent OSDATA device (deprecated in 9.1, 15 §3.1). */
  readonly kind: 'persistent' | 'usb-sd';
}

/** [SIMPL] boot size used when the BOM string does not state a capacity (15 Příloha B.3 "≥ 480 GB" class). */
export const BOOT_CAPACITY_GAME_DEFAULT_GB = 480;

export function bootDeviceOf(model: ServerModel): BootDevice {
  const m = /(\d+)\s*GB/i.exec(model.bootDevice);
  return m?.[1] !== undefined
    ? { description: model.bootDevice, capacityGB: Number(m[1]), capacitySource: 'BCG', kind: 'persistent' }
    : { description: model.bootDevice, capacityGB: BOOT_CAPACITY_GAME_DEFAULT_GB, capacitySource: 'SIMPL', kind: 'persistent' };
}

/**
 * BMC display labels (labels only, no rule depends on them). Names from 25 §10.2.1 [U68][U75][U80]: Dell DRAC/iDRAC,
 * HPE iLO, Lenovo XClarity Controller (XCC), Cisco IMC; Supermicro has no BMC in the sources -> generic "BMC".
 */
export const BMC_LABEL: Readonly<Record<HwVendor, string>> = {
  Dell: 'iDRAC',
  HPE: 'iLO',
  Lenovo: 'XCC',
  Cisco: 'Cisco IMC',
  Supermicro: 'BMC',
};

/** BMC port speed of every server – game value (OOB is game scope, 25 §10). */
export const BMC_PORT_SPEEDS_GBE: readonly number[] = [1];

// ---------------------------------------------------------------------------
// Server configuration
// ---------------------------------------------------------------------------

export interface PartCount {
  readonly partId: string;
  readonly count: number;
}

export interface ServerConfig {
  /** `ServerModel.id` (bcg-<productId>). */
  readonly modelId: string;
  readonly sockets: number;
  readonly coresPerSocket: number;
  readonly ramGB: number;
  readonly drives: readonly PartCount[];
  readonly nics: readonly PartCount[];
  readonly boot: BootDevice;
  /** NVMe drives behind a Tri-Mode controller. [SIMPL] attribute (15 B.3). */
  readonly triModeController: boolean;
  /** FC HBA present. [SIMPL] attribute (15 B.3 `len-sr630v4-compute`). */
  readonly fcHba: boolean;
}

/** Everything a validation needs to resolve ids. */
export interface PartsLookup {
  readonly models: ReadonlyMap<string, ServerModel>;
  readonly drives: ReadonlyMap<string, DrivePart>;
  readonly nics: ReadonlyMap<string, NicPart>;
}

export interface ResolvedConfig {
  readonly config: ServerConfig;
  readonly model: ServerModel;
  readonly drives: readonly { readonly part: DrivePart; readonly count: number }[];
  readonly nics: readonly { readonly part: NicPart; readonly count: number }[];
}

export type ResolveResult = { readonly ok: true; readonly resolved: ResolvedConfig } | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export function resolveServerConfig(lookup: PartsLookup, config: ServerConfig): ResolveResult {
  const issues: ValidationIssue[] = [];
  const model = lookup.models.get(config.modelId);
  if (!model) issues.push(issue('HW_UNKNOWN_PART', 'error', `Unknown server model ${config.modelId}.`, '15 Příloha B', config.modelId, 'game-scope'));
  const drives: { part: DrivePart; count: number }[] = [];
  for (const d of config.drives) {
    const part = lookup.drives.get(d.partId);
    if (!part) issues.push(issue('HW_UNKNOWN_PART', 'error', `Unknown drive part ${d.partId}.`, '15 Příloha B.2', d.partId, 'game-scope'));
    else if (d.count > 0) drives.push({ part, count: d.count });
  }
  const nics: { part: NicPart; count: number }[] = [];
  for (const n of config.nics) {
    const part = lookup.nics.get(n.partId);
    if (!part) issues.push(issue('HW_UNKNOWN_PART', 'error', `Unknown NIC part ${n.partId}.`, '15 Příloha B.2', n.partId, 'game-scope'));
    else if (n.count > 0) nics.push({ part, count: n.count });
  }
  if (!model || issues.length > 0) return { ok: false, issues };
  return { ok: true, resolved: { config, model, drives, nics } };
}

export interface ConfigMetrics {
  /** Physical cores (SMT not counted, 10 §3.4 VCF-ESX-RCMD-CFG-003). */
  readonly cores: number;
  readonly ramGB: number;
  readonly driveCount: number;
  /** Sum of drive capacities (raw node capacity, 15 §6.1 "Node Capacity"). */
  readonly nodeCapacityTB: number;
  readonly nicPorts: number;
  /** [SIMPL] network speed of the node = fastest installed NIC (15 §6.1 rule applies per node). */
  readonly nodeNetworkGbE: number;
  readonly slowestNicGbE: number;
}

export function configMetrics(r: ResolvedConfig): ConfigMetrics {
  const speeds = r.nics.map((n) => nicMaxSpeed(n.part));
  return {
    cores: r.config.sockets * r.config.coresPerSocket,
    ramGB: r.config.ramGB,
    driveCount: r.drives.reduce((a, d) => a + d.count, 0),
    nodeCapacityTB: Math.round(r.drives.reduce((a, d) => a + d.count * d.part.capacityTB, 0) * 1000) / 1000,
    nicPorts: r.nics.reduce((a, n) => a + n.count * n.part.ports, 0),
    nodeNetworkGbE: speeds.length ? Math.max(...speeds) : 0,
    slowestNicGbE: speeds.length ? Math.min(...speeds) : 0,
  };
}

/** Homogeneity fingerprint: equal string = identical configuration (10 §3.4, 20 §3.2). */
export function configFingerprint(c: ServerConfig): string {
  const parts = (xs: readonly PartCount[]): string =>
    xs.filter((x) => x.count > 0).map((x) => `${x.partId}x${x.count}`).sort().join('+');
  return [c.modelId, `${c.sockets}x${c.coresPerSocket}`, `${c.ramGB}GB`, parts(c.drives), parts(c.nics), c.triModeController ? 'trimode' : '', c.fcHba ? 'fc' : ''].join('|');
}

// ===========================================================================
// vSAN ESA profiles (15 §6.1 [H2][BCG])
// ===========================================================================

export interface HciProfileMinima {
  readonly capacityTB: number;
  readonly cores: number;
  readonly ramGB: number;
  readonly networkGbE: number;
  /** "Max Storage Devices for base configuration" – base config only, not a limit (15 §6.1). */
  readonly baseMaxDevices: number;
}

/** vSAN ESA HCI ReadyNode Hardware Guidance table (15 §6.1 [H2][BCG], verbatim numbers). */
export const HCI_PROFILE_MINIMA: Readonly<Record<EsaProfileSize, HciProfileMinima>> = {
  SM: { capacityTB: 3.2, cores: 16, ramGB: 128, networkGbE: 10, baseMaxDevices: 12 },
  MED: { capacityTB: 20, cores: 32, ramGB: 256, networkGbE: 25, baseMaxDevices: 18 },
  LRG: { capacityTB: 50, cores: 48, ramGB: 512, networkGbE: 100, baseMaxDevices: 24 },
};

export interface ScProfileMinima {
  readonly cores: number;
  readonly ramGB: number;
  readonly nodesPerCluster: number;
  readonly eastWestGbE: number;
  readonly northSouthGbE: number;
  readonly baseMaxDevices: number;
}

/** vSAN ESA Storage Cluster ReadyNode Hardware Guidance (15 §6.1 [H2][BCG]). */
export const SC_PROFILE_MINIMA: Readonly<Record<EsaProfileSize, ScProfileMinima>> = {
  SM: { cores: 16, ramGB: 128, nodesPerCluster: 4, eastWestGbE: 25, northSouthGbE: 10, baseMaxDevices: 12 },
  MED: { cores: 32, ramGB: 192, nodesPerCluster: 6, eastWestGbE: 25, northSouthGbE: 25, baseMaxDevices: 18 },
  LRG: { cores: 48, ramGB: 256, nodesPerCluster: 6, eastWestGbE: 100, northSouthGbE: 25, baseMaxDevices: 24 },
};
/** "Min Capacity per Node: 20 TB", "Min Devices per Host Supported: 2" (all SC profiles, 15 §3.3 [H2]). */
export const SC_MIN_CAPACITY_TB = 20;
export const SC_MIN_DEVICES = 2;

/** Other ESA numbers (15 §3.3, §6.3 [H6][T][H2][BCG]). */
export const ESA_LIMITS = {
  minDriveCapacityTB: 1.6,
  minDwpd: 1,
  minDevicesHci: 1,
  maxDevicesPerHost: 24,
  minNicGbE: 10,
  minCores: 16,
  minRamGB: 128,
} as const;

/** ESX 9.1 general minimum (15 §3.1 [H12][T]). */
export const ESX_HW_MINIMUM = { cores: 2, ramGB: 8, recommendedRamGB: 12, bootMinGB: 32, bootRecommendedGB: 128, bootUpgradeBlockedBelowGB: 8 } as const;

export interface DerivedEsaProfile {
  readonly family: 'HCI' | 'SC';
  /** Highest certified profile whose all minima are met; undefined = below SM (15 §6.1 "pod HCI-SM"). */
  readonly profile: EsaProfileId | undefined;
  /** Highest certified profile met when the network minimum is ignored (compute + capacity). */
  readonly computeProfile: EsaProfileId | undefined;
  /** True when the network keeps the node below its compute profile (DEV, 15 §6.1). */
  readonly networkLimited: boolean;
  /** Config meets SM minima but the model is not BCG certified for the family's SM profile. */
  readonly smNotCertified: boolean;
}

/**
 * Profile derivation – [SIMPL] rule stated in 15 §6.1 "Odvození profilu (pro model)" over [BCG] numbers:
 * profile = highest profile whose ALL minima (node capacity, cores, RAM, network) are met AND for which
 * the model is certified (`profiles`). If compute + capacity meet a higher profile but the network does not,
 * the node is listed in the lower profile with a DEV warning.
 * SC: [SIMPL] the node network speed is used for both E/W and N/S minima.
 */
export function deriveEsaProfile(model: ServerModel, m: ConfigMetrics, family: 'HCI' | 'SC' = 'HCI'): DerivedEsaProfile {
  const certified = (s: EsaProfileSize): boolean => model.profiles.includes(`vSAN-${family}-${s}`);
  const meets = (s: EsaProfileSize, withNetwork: boolean): boolean => {
    if (family === 'HCI') {
      const p = HCI_PROFILE_MINIMA[s];
      return m.nodeCapacityTB >= p.capacityTB && m.cores >= p.cores && m.ramGB >= p.ramGB && (!withNetwork || m.nodeNetworkGbE >= p.networkGbE);
    }
    const p = SC_PROFILE_MINIMA[s];
    return (
      m.nodeCapacityTB >= SC_MIN_CAPACITY_TB && m.driveCount >= SC_MIN_DEVICES && m.cores >= p.cores && m.ramGB >= p.ramGB &&
      (!withNetwork || (m.nodeNetworkGbE >= p.eastWestGbE && m.nodeNetworkGbE >= p.northSouthGbE))
    );
  };
  const highest = (withNetwork: boolean): EsaProfileSize | undefined =>
    [...PROFILE_SIZES].reverse().find((s) => certified(s) && meets(s, withNetwork));
  const p = highest(true);
  const c = highest(false);
  return {
    family,
    profile: p ? `vSAN-${family}-${p}` : undefined,
    computeProfile: c ? `vSAN-${family}-${c}` : undefined,
    networkLimited: c !== undefined && (p === undefined || sizeRank(c) > sizeRank(p)),
    smNotCertified: !certified('SM') && meets('SM', true),
  };
}

// ===========================================================================
// HW findings (15 §5)
// ===========================================================================

export type HwClass = 'REQ' | 'DEV' | 'RCMD';

export interface HwFinding extends ValidationIssue {
  readonly hwClass: HwClass;
  /** Physically / certification-wise impossible configuration – the shop must not sell it (15 §5, B.3 note). */
  readonly physicallyImpossible?: true;
  /**
   * Documented conflict between sources (15 OQ6: BCG guidance = supported deviation vs. Design Library
   * VCF-VSAN-NET-REQD-CFG-001). Both references are listed; the game shows DEV, not a block.
   */
  readonly documentationConflict?: { readonly openQuestion: string; readonly refs: readonly string[] };
}

const SEVERITY_OF: Readonly<Record<HwClass, ValidationIssue['severity']>> = { REQ: 'error', DEV: 'warning', RCMD: 'recommendation' };

function cls(i: ValidationIssue, hwClass: HwClass, extra: Partial<Pick<HwFinding, 'physicallyImpossible' | 'documentationConflict'>> = {}): HwFinding {
  if (i.severity !== SEVERITY_OF[hwClass]) throw new Error(`severity ${i.severity} does not match class ${hwClass} (${i.code})`);
  return { ...i, hwClass, ...extra };
}

export interface ServerValidationContext {
  /** Target VCF release (BCG Supported Release, 15 B.1). Default '9.1'. */
  readonly release?: TargetRelease;
  /** Intended principal storage use; undefined = generic host checks only. */
  readonly storage?: StorageType;
  /** ESA cluster type; default 'HCI'. */
  readonly esaFamily?: 'HCI' | 'SC';
  /** Subject for issues (host id); default = model id. */
  readonly subject?: string;
}

export interface ServerValidationResult {
  readonly findings: readonly HwFinding[];
  readonly metrics?: ConfigMetrics;
  readonly esaProfile?: DerivedEsaProfile;
  /** No REQ finding for the given use. */
  readonly eligible: boolean;
}

/**
 * Validates one server configuration (15 §5, B.1). Generic checks always; vSAN ESA checks when
 * `ctx.storage === 'vsan-esa'`; FC HBA presence when 'vmfs-fc'. vSAN OSA HW rules are not modelled
 * (OSA ReadyNodes for 9.1 not downloaded, 15 OQ7) -> game-scope note.
 */
export function validateServerConfig(lookup: PartsLookup, config: ServerConfig, ctx: ServerValidationContext = {}): ServerValidationResult {
  const res = resolveServerConfig(lookup, config);
  if (!res.ok) return { findings: res.issues.map((i) => cls(i, 'REQ')), eligible: false };
  const r = res.resolved;
  const model = r.model;
  const m = configMetrics(r);
  const subj = ctx.subject ?? model.id;
  const release = ctx.release ?? '9.1';
  const out: HwFinding[] = [];

  // --- certification for target release (15 §5 row 1, B.1 [H10][T][H9][BCG]) ---
  if (!isCertifiedFor(model, release))
    out.push(cls(issue('HW_NOT_HCL_COMPATIBLE', 'error', `ESX Host is not HCL compatible. (${model.model} is not listed for "${BCG_RELEASE[release]}" in BCG.)`, '15 §5, B.1 [H10][H9]', subj), 'REQ'));

  // --- model limits (15 B.1 [H9][BCG]) – physically impossible ---
  if (config.sockets < 1 || config.sockets > model.maxSockets || config.coresPerSocket > model.maxCoresPerSocket || config.ramGB > model.maxMemoryGB)
    out.push(cls(issue('HW_EXCEEDS_MODEL_LIMIT', 'error', `${model.model}: max ${model.maxSockets} socket(s) × ${model.maxCoresPerSocket} cores and ${model.maxMemoryGB} GB RAM (BCG); configured ${config.sockets} × ${config.coresPerSocket}, ${config.ramGB} GB.`, '15 B.1 [H9]', subj), 'REQ', { physicallyImpossible: true }));
  if (m.driveCount > model.maxDrives)
    out.push(cls(issue('HW_DRIVES_EXCEED_MODEL_MAX', 'error', `${model.model}: ${m.driveCount} drives exceed the model's Maximum Drives = ${model.maxDrives} (BCG).`, '15 §5, B.3 [H9]', subj), 'REQ', { physicallyImpossible: true }));

  // --- ESX general minimum (15 §3.1 [H12][T]) ---
  if (m.cores < ESX_HW_MINIMUM.cores || m.ramGB < ESX_HW_MINIMUM.ramGB)
    out.push(cls(issue('HW_BELOW_ESX_MINIMUM', 'error', `ESX requires at least ${ESX_HW_MINIMUM.cores} CPU cores and ${ESX_HW_MINIMUM.ramGB} GB RAM.`, '15 §3.1 [H12]', subj), 'REQ'));
  else if (m.ramGB < ESX_HW_MINIMUM.recommendedRamGB)
    out.push(cls(issue('HW_ESX_RAM_BELOW_RECOMMENDED', 'recommendation', 'Provide at least 12 GB of RAM (typical production use).', '15 §3.1 [H12]', subj), 'RCMD'));

  // --- NIC (15 §3.1, §3.3, §5 [H12][H6][T][H2][BCG]) ---
  if (r.nics.length === 0)
    out.push(cls(issue('HW_NO_NIC', 'error', 'ESX needs one or more Gigabit or faster Ethernet controllers.', '15 §3.1 [H12]', subj), 'REQ'));
  for (const n of r.nics)
    if (!model.nics.includes(n.part.bomName))
      // KB 326717: "No separate NIC certification" (IOVP qualified NICs); KB 452580: verify NIC in BCG I/O Devices.
      // The game has no I/O Devices data for cross-model checks -> hint, game scope.
      out.push(cls(issue('HW_NIC_NOT_IN_BOM', 'recommendation', `NIC "${n.part.bomName}" is not in the BCG BOM of ${model.model}. ReadyNode NIC changes are allowed with IOVP-qualified NICs; verify it in BCG I/O Devices (not modelled by the game).`, '15 §2.1, §3.3 [H1][H6]', subj, 'game-scope'), 'RCMD'));
  if (r.nics.length > 0 && (m.nicPorts < 2 || r.nics.some((n) => n.part.ports < 2)))
    out.push(cls(issue('HW_NIC_SINGLE_PORT', 'recommendation', 'Dual-port NICs recommended for redundancy.', '15 §5 [H2]', subj), 'RCMD'));
  if (new Set(r.nics.map((n) => n.part.id)).size > 1)
    out.push(cls(issue('HW_NIC_UPLINK_MISMATCH', 'recommendation', 'Uplinks of one vSphere Distributed Switch should have the same speed, model and performance (VCF-VDS-COM-RCMD-CFG-004).', '10 §3.3 [P17]', subj), 'RCMD'));

  // --- boot (15 §3.1, §5 [H12][T]; 10 §3.4 VCF-ESX-RCMD-CFG-004) ---
  const b = config.boot;
  if (b.capacityGB < ESX_HW_MINIMUM.bootUpgradeBlockedBelowGB)
    out.push(cls(issue('HW_BOOT_TOO_SMALL', 'error', `Boot device ${b.capacityGB} GB < 8 GB: upgrade is blocked.`, '15 §5 [H12]', subj), 'REQ'));
  else if (b.capacityGB < ESX_HW_MINIMUM.bootMinGB)
    out.push(cls(issue('HW_BOOT_BELOW_32GB', 'warning', `Boot device ${b.capacityGB} GB: system devices smaller than 32 GB are deprecated in ESX 9.1 (minimum 32 GB persistent storage).`, '15 §3.1 [H12]', subj), 'DEV'));
  else if (b.capacityGB < ESX_HW_MINIMUM.bootRecommendedGB)
    out.push(cls(issue('HW_BOOT_BELOW_RECOMMENDED', 'recommendation', `Boot device ${b.capacityGB} GB: a high-endurance boot device of at least 128 GB is recommended (VCF-ESX-RCMD-CFG-004).`, '10 §3.4 [P14]; 15 §3.1 [H12]', subj), 'RCMD'));
  if (b.kind === 'usb-sd')
    out.push(cls(issue('HW_BOOT_NO_PERSISTENT_DEVICE', 'warning', 'Secondary persistent device not found. (USB/SD-only boot without a persistent OSDATA device is deprecated in 9.1.)', '15 §3.1, §5 [H12]', subj), 'DEV'));

  // --- principal storage specific ---
  let esaProfile: DerivedEsaProfile | undefined;
  if (ctx.storage === 'vsan-esa') {
    esaProfile = deriveEsaProfile(model, m, ctx.esaFamily ?? 'HCI');
    out.push(...validateEsa(r, m, esaProfile, subj));
  } else if (ctx.storage === 'vmfs-fc' && !config.fcHba) {
    out.push(cls(issue('HW_FC_HBA_MISSING', 'error', 'VMFS on FC principal storage needs an FC HBA in every host (host -> FC fabric / array).', '15 §2.3, §7 #7; 10 §3.5', subj), 'REQ'));
  } else if (ctx.storage === 'vsan-osa') {
    out.push(cls(issue('HW_OSA_NOT_MODELLED', 'recommendation', 'vSAN OSA hardware (I/O controller, cache + capacity disk groups, OSA ReadyNodes for 9.1) is not validated by the game yet.', '15 §3.4, §8 OQ7', subj, 'game-scope'), 'RCMD'));
  }

  return { findings: out, metrics: m, ...(esaProfile ? { esaProfile } : {}), eligible: !out.some((f) => f.hwClass === 'REQ') };
}

function validateEsa(r: ResolvedConfig, m: ConfigMetrics, prof: DerivedEsaProfile, subj: string): HwFinding[] {
  const out: HwFinding[] = [];
  const model = r.model;
  const famRef = prof.family === 'HCI' ? 'vSAN-HCI-SM' : 'vSAN-SC-SM';

  // Cores / RAM – VCF-VSAN-ESA-REQD-CFG-003/004 (15 §3.5, §5 [H4][T]); message not documented (15 OQ11).
  if (m.cores < ESA_LIMITS.minCores)
    out.push(cls(issue('HW_ESA_CORES_BELOW_MIN', 'error', `vSAN ESA node needs at least 16 physical cores (VCF-VSAN-ESA-REQD-CFG-003); configured ${m.cores}.`, '15 §3.5, §5 [H4]', subj), 'REQ'));
  if (m.ramGB < ESA_LIMITS.minRamGB)
    out.push(cls(issue('HW_ESA_MEMORY_BELOW_MIN', 'error', `vSAN ESA node needs at least 128 GB RAM (VCF-VSAN-ESA-REQD-CFG-004); configured ${m.ramGB} GB.`, '15 §3.5, §5 [H4]', subj), 'REQ'));

  // Devices per host (KB 326717 min 1 / SC 2, max 24; VCF-VSAN-ESA-REQD-CFG-002).
  const minDevices = prof.family === 'SC' ? SC_MIN_DEVICES : ESA_LIMITS.minDevicesHci;
  if (m.driveCount < minDevices)
    out.push(cls(issue('HW_ESA_TOO_FEW_DRIVES', 'error', `vSAN ESA ${prof.family === 'SC' ? 'Storage Cluster ' : ''}ReadyNode minimum # devices per host: ${minDevices}; configured ${m.driveCount}.`, '15 §3.3 [H6][H2]', subj), 'REQ'));
  if (m.driveCount > ESA_LIMITS.maxDevicesPerHost)
    out.push(cls(issue('HW_ESA_TOO_MANY_DRIVES', 'error', `vSAN ESA and vSAN SC Maximum # Device/Host: 24; configured ${m.driveCount}.`, '15 §3.3, §3.5 [H6][H4]', subj), 'REQ'));

  // Per drive part (15 §3.3, §5 [H2][H6][H9]).
  for (const { part } of r.drives) {
    if (part.interface !== 'NVMe') {
      out.push(cls(issue('HW_ESA_DRIVE_NOT_NVME', 'error', `${part.family}: ${part.interface} drive in a vSAN ESA ReadyNode – "SAS and SATA are not currently planned for vSAN ESA." / "Changing the device type is not permitted."`, '15 §3.3, §5 [H6][H2]', subj), 'REQ'));
      continue;
    }
    const inCr = part.bomSection === 'cyber-recovery' || part.cell === 'QLC' || model.cyberRecoveryDrives.some((f) => f.name === part.family);
    if (inCr) {
      out.push(cls(issue('HW_ESA_DRIVE_CYBER_RECOVERY_ONLY', 'error', `${part.family}: drive from the Cyber Recovery BOM section – QLC is "not supported for vSAN HCI or Storage Cluster workloads".`, '15 §3.3, §5 [H2][H9]', subj), 'REQ'));
    } else if (!model.esaDrives.some((f) => f.name === part.family)) {
      if (part.oem !== model.vendor)
        out.push(cls(issue('HW_ESA_DRIVE_OTHER_OEM', 'error', `${part.family}: drive of another OEM (${part.oem}) in a ${model.vendor} ReadyNode – drives only within the same OEM, make/model from the ESA ReadyNode BOM. "VCF automated workflows may block cluster creation."`, '15 §3.3, §5 [H6][H4]', subj), 'REQ'));
      else
        out.push(cls(issue('HW_ESA_DRIVE_NOT_IN_BOM', 'error', `${part.family}: not in the ESA ReadyNode BOM of ${model.model}. "VCF automated workflows may block cluster creation."`, '15 §5 [H4][H6][H9]', subj), 'REQ'));
    }
    if (part.capacityTB < ESA_LIMITS.minDriveCapacityTB)
      out.push(cls(issue('HW_ESA_DRIVE_TOO_SMALL', 'error', `${part.family} ${part.capacityTB} TB: vSAN ESA devices must be ≥ 1.6 TB (VCF-VSAN-ESA-REQD-CFG-002).`, '15 §3.3, §5 [H4][H6]', subj), 'REQ'));
    if (part.dwpd !== undefined && part.dwpd < ESA_LIMITS.minDwpd)
      out.push(cls(issue('HW_ESA_DRIVE_ENDURANCE', 'error', `${part.family}: ${part.dwpd} DWPD < "Endurance Class: ≥ 1 DWPD".`, '15 §3.3, §5 [H2][H6]', subj), 'REQ'));
  }

  // Tri-Mode (VCF-VSAN-REQD-CFG-005; KB 409486 ESA disk check fails).
  if (r.config.triModeController)
    out.push(cls(issue('HW_ESA_TRI_MODE_CONTROLLER', 'error', 'NVMe devices behind a Tri-Mode controller are not supported for vSAN (VCF-VSAN-REQD-CFG-005); the installer ESA disk check fails (KB 409486).', '15 §3.5, §5 [H4][H10]', subj), 'REQ'));

  // Network minimum 10GbE (KB 326717; VCF-VSAN-NET-REQD-CFG-001).
  if (m.nodeNetworkGbE < ESA_LIMITS.minNicGbE)
    out.push(cls(issue('HW_ESA_NIC_BELOW_10GBE', 'error', 'vSAN ESA ReadyNode NIC minimum is 10GbE.', '15 §3.3 [H6]; 10 §3.3 [P15]', subj), 'REQ'));

  // Below SM (15 §5 "Konfigurace pod vSAN-HCI-SM" [H2]).
  if (prof.profile === undefined) {
    const why = prof.smNotCertified ? ` (${model.model} is not BCG certified for ${famRef})` : '';
    out.push(cls(issue('HW_ESA_BELOW_SM_PROFILE', 'error', `Configuration is below ${famRef}${why}: "All ReadyNodes must meet or exceed the vSAN-HCI-SM (or vSAN-SC-SM) configuration for VMware Global Services (GS) support."`, '15 §5, §6.1 [H2]', subj), 'REQ'));
  }

  // 10GbE on ESA – compliance check (KB 372309) + 75 % capacity rule (KB 372311) (15 §5 [H4][H16][H17]).
  if (m.nodeNetworkGbE >= ESA_LIMITS.minNicGbE && m.nodeNetworkGbE < 25)
    out.push(cls(issue('HW_ESA_10GBE_COMPLIANCE', 'warning', 'vSAN ESA on 10GbE triggers the vSAN cluster compliance check (KB 372309); with 10Gb networking keep used + reserved capacity ≤ 75 % (KB 372311).', '15 §5 [H4][H16][H17]; 10 §5', subj), 'DEV'));

  // Larger node on 10GbE: BCG = supported deviation, Design Library = REQD 25GbE (15 §5, OQ6) -> DEV + conflict.
  const computeAboveSm = prof.computeProfile !== undefined && !prof.computeProfile.endsWith('-SM');
  if (prof.networkLimited && computeAboveSm && m.nodeNetworkGbE < 25) {
    out.push(cls(issue('HW_ESA_LARGER_NODE_10GBE', 'warning', `Node meets ${prof.computeProfile} compute/capacity but has 10GbE networking. BCG: "Deviations from recommended specs are supported but may affect performance and availability." VCF Design Library: "Larger vSAN ESA nodes require 25GbE." (VCF-VSAN-NET-REQD-CFG-001).`, '15 §5, §8 OQ6 [H2][H4]', subj), 'DEV', {
      documentationConflict: { openQuestion: '15 §8 OQ6', refs: ['15 §5 [H2][BCG] (deviation supported)', '15 §3.5 [H4][T] VCF-VSAN-NET-REQD-CFG-001 (25GbE required)'] },
    }));
  } else if (prof.networkLimited && prof.profile !== undefined) {
    out.push(cls(issue('HW_ESA_PROFILE_NETWORK_DEVIATION', 'warning', `Node meets ${prof.computeProfile} compute/capacity but its ${m.nodeNetworkGbE} GbE network only meets ${prof.profile}: "Deviations from recommended specs are supported but may affect performance and availability."`, '15 §1, §5, §6.1 [H2]', subj), 'DEV'));
  }
  return out;
}

// ===========================================================================
// Cluster level (homogeneity etc.)
// ===========================================================================

export interface ClusterHwInput {
  readonly hostId: string;
  readonly config: ServerConfig;
}

/**
 * Host set checks for one cluster (10 §3.4 [P14][P28], 20 §3.2, 15 §3.3, §5).
 * - initial management cluster: one vendor and homogeneous configuration (error) – 20 §3.2 [S7] / 10 §3.4 [P28];
 *   other clusters: homogeneity is a recommendation (VCF-ESX-RCMD-CFG-002 / "Use hosts with a homogeneous configuration").
 *   Hosts of the same model but different derived profile count as heterogeneous (15 OQ9: game "no").
 * - pNIC same speed / vendor / model in the cluster [P14] -> recommendation.
 * - vSAN ESA: mixing 1 DWPD and 3 DWPD drives in a cluster is not recommended (KB 326717) -> RCMD.
 */
export function validateClusterHardware(
  lookup: PartsLookup,
  hosts: readonly ClusterHwInput[],
  ctx: { readonly initialManagementCluster: boolean; readonly storage?: StorageType },
): HwFinding[] {
  const out: HwFinding[] = [];
  if (hosts.length < 2) return out;
  const vendors = new Set(hosts.map((h) => lookup.models.get(h.config.modelId)?.vendor ?? '?'));
  if (vendors.size > 1 && ctx.initialManagementCluster)
    out.push(cls(issue('ESX_MULTIPLE_VENDORS', 'error', `All ESX hosts in the management domain must be from the same hardware vendor (found ${[...vendors].join(', ')}).`, '20 §3.2 [S7]; 10 §3.4 [P28]'), 'REQ'));
  if (new Set(hosts.map((h) => configFingerprint(h.config))).size > 1) {
    out.push(
      ctx.initialManagementCluster
        ? cls(issue('HW_CLUSTER_HETEROGENEOUS', 'error', 'The initial management domain does not support a heterogeneous cluster: all hosts need the same configuration.', '10 §3.4 [P28]; 20 §3.2 [S7]; 15 §8 OQ9'), 'REQ')
        : cls(issue('HW_CLUSTER_HETEROGENEOUS', 'recommendation', 'Use hosts with a homogeneous configuration (VCF-ESX-RCMD-CFG-002).', '10 §3.4 [P14]'), 'RCMD'),
    );
  }
  const nicSig = new Set(hosts.map((h) => h.config.nics.filter((n) => n.count > 0).map((n) => n.partId).sort().join('+')));
  if (nicSig.size > 1)
    out.push(cls(issue('HW_CLUSTER_PNIC_MISMATCH', 'recommendation', 'Physical NICs should have the same speed, vendor and model across the cluster.', '10 §3.4 [P14]'), 'RCMD'));
  if (ctx.storage === 'vsan-esa') {
    const dwpd = new Set<number>();
    for (const h of hosts) for (const d of h.config.drives) {
      const p = lookup.drives.get(d.partId);
      if (p?.dwpd !== undefined && d.count > 0 && p.dwpd >= 1) dwpd.add(p.dwpd);
    }
    if (dwpd.size > 1)
      out.push(cls(issue('HW_ESA_MIXED_DWPD', 'recommendation', 'Mixing 1 DWPD and 3 DWPD drives in a vSAN ESA cluster is not recommended (KB 326717).', '15 §3.3, §5 [H6]'), 'RCMD'));
  }
  return out;
}

// ===========================================================================
// NICs vs. Distributed Switch model (05 §4.6, 10 §3.3, 15 §3.5)
// ===========================================================================

/** Design option ids of 'distributed-switch-model' (design.ts). */
export type DistributedSwitchModelId =
  | 'single'
  | 'storage-separation'
  | 'workload-separation'
  | 'storage-and-workload-separation'
  | 'dedicated-cluster-for-nsx-edge'
  | 'vsan-storage-cluster-separation';

export interface NicRequirement {
  readonly minPorts: number;
  readonly severity: 'error' | 'warning';
  readonly specRef: string;
  readonly text: string;
}

/**
 * Documented pNIC counts per VDS model:
 *  - Single Distributed Switch: "2 fyzické NIC na hosta (odolnost vůči výpadku jedné NIC)" (10 §3.3 [P17]) –
 *    described as the model, no documented installer error -> warning.
 *  - Storage and Workload Separation: "minimum of six (6) with redundancy" (05 §4.6 [D15], 00 §6 [S20]) -> error.
 *  - other models: pNIC count not stated in the spec -> no requirement.
 */
export function nicRequirementForVdsModel(model: DistributedSwitchModelId): NicRequirement | undefined {
  switch (model) {
    case 'single':
      return { minPorts: 2, severity: 'warning', specRef: '10 §3.3, §6.2 [P17]', text: 'Single Distributed Switch model = 2 physical NICs per host.' };
    case 'storage-and-workload-separation':
      return { minPorts: 6, severity: 'error', specRef: '05 §4.6, §6.1 [D15]; 00 §6 [S20]', text: 'Storage and Workload Separation: "minimum of six (6) with redundancy" physical NICs.' };
    default:
      return undefined;
  }
}

export function validateNicsForVdsModel(nicPorts: number, model: DistributedSwitchModelId, subject?: string): ValidationIssue[] {
  const req = nicRequirementForVdsModel(model);
  if (!req || nicPorts >= req.minPorts) return [];
  return [
    req.severity === 'error'
      ? issue('HW_VDS_MODEL_NIC_COUNT', 'error', `${req.text} Host has ${nicPorts}.`, req.specRef, subject)
      : issue('HW_VDS_MODEL_NIC_COUNT', 'warning', `${req.text} Host has ${nicPorts}.`, req.specRef, subject),
  ];
}

/**
 * vSAN pNIC recommendation: 2 pNIC for small, 4 pNIC for large-scale / IO intensive (VCF-VSAN-NET-RCMD-CFG-002/003,
 * 15 §3.5 [H4]). [SIMPL] "large" = derived profile MED or LRG.
 */
export function validateVsanNicCount(nicPorts: number, profile: EsaProfileId | undefined, subject?: string): ValidationIssue[] {
  const large = profile !== undefined && !profile.endsWith('-SM');
  const want = large ? 4 : 2;
  if (nicPorts >= want) return [];
  return [issue('HW_VSAN_NIC_COUNT_RCMD', 'recommendation', `vSAN: ${want} physical NICs recommended for ${large ? 'large-scale / IO intensive' : 'small-scale'} nodes (VCF-VSAN-NET-RCMD-CFG-00${large ? 3 : 2}); host has ${nicPorts}.`, '15 §3.5 [H4]; 10 §3.3 [P15]', subject)];
}
