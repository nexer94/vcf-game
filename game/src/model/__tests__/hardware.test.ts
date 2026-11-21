import { describe, expect, it } from 'vitest';
import { BCG_DATASET, parseBcgDataset } from '../bcgDataset';
import {
  type DrivePart,
  type HwFinding,
  type NicPart,
  type PartsLookup,
  type ServerConfig,
  type ServerModel,
  HCI_PROFILE_MINIMA,
  configMetrics,
  deriveEsaProfile,
  nicRequirementForVdsModel,
  resolveServerConfig,
  validateClusterHardware,
  validateNicsForVdsModel,
  validateServerConfig,
  validateVsanNicCount,
} from '../hardware';
import { STARTER_CONFIG_DEFS, buildHardwareCatalog } from '../hardwareCatalog';

const cat = buildHardwareCatalog();
const starter = (id: string) => {
  const s = cat.starterServers.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
};
const esa = (cfg: ServerConfig, lookup: PartsLookup = cat) => validateServerConfig(lookup, cfg, { storage: 'vsan-esa' });
const codes = (fs: readonly HwFinding[]) => fs.map((f) => f.code);
const byCode = (fs: readonly HwFinding[], code: string) => fs.find((f) => f.code === code);

/** Lookup with extra fake parts / models for edge cases the real catalog does not contain. */
function withExtras(extra: { drives?: DrivePart[]; nics?: NicPart[]; models?: ServerModel[] }): PartsLookup {
  return {
    models: new Map([...cat.models, ...(extra.models ?? []).map((m) => [m.id, m] as const)]),
    drives: new Map([...cat.drives, ...(extra.drives ?? []).map((d) => [d.id, d] as const)]),
    nics: new Map([...cat.nics, ...(extra.nics ?? []).map((n) => [n.id, n] as const)]),
  };
}

describe('catalog from the BCG dataset (15 Příloha A/B)', () => {
  it('parses the dataset and builds 247 models without integrity problems', () => {
    expect(parseBcgDataset(BCG_DATASET).readyNodes).toHaveLength(247);
    expect(cat.models.size).toBe(247);
    expect(cat.problems).toEqual([]);
    expect(cat.datasetRelease).toBe('ESXi 9.1 (vSAN 9.1)');
  });

  it('every B.3 starter configuration resolves (model + parts) and has a stable unique id', () => {
    expect(cat.starterServers).toHaveLength(STARTER_CONFIG_DEFS.length);
    expect(STARTER_CONFIG_DEFS).toHaveLength(25); // 15 B.3: 5 per vendor
    for (const s of cat.starterServers) {
      expect(resolveServerConfig(cat, s.config).ok, s.id).toBe(true);
      expect(cat.items.get(s.id)).toBe(s);
    }
  });

  it('every NIC part appears in some ReadyNode BOM; drive families in an ESA / CR BOM', () => {
    for (const [id, ms] of cat.nicModels) expect(ms.length, id).toBeGreaterThan(0);
    expect(cat.nicModels.get('nic-dell-57412-10gbt-2p')).toEqual(expect.arrayContaining([63567, 63566]));
  });

  it('a dataset with a missing model reports problems instead of silently dropping the starter', () => {
    const ds = { ...BCG_DATASET, readyNodes: BCG_DATASET.readyNodes.filter((r) => r.productId !== 63567) };
    expect(buildHardwareCatalog(ds).problems.some((p) => p.includes('dell-r670-sm'))).toBe(true);
  });

  it('switches and racks are generic game items; no prices anywhere', () => {
    for (const id of ['sw-generic-48x25g', 'rack-generic-42u']) expect(cat.items.get(id)).toMatchObject({ gameGeneric: true });
    for (const it of cat.items.values()) expect(JSON.stringify(it)).not.toMatch(/price/i);
  });

  it('models carry BCG facts and the game-default rack height flag', () => {
    const r670 = cat.models.get('bcg-63567');
    expect(r670).toMatchObject({ vendor: 'Dell', maxSockets: 2, maxCoresPerSocket: 86, maxDrives: 20, rackUnitsGameDefault: true, kb393469Note: true });
    expect(r670?.bcgUrl).toContain('productId=63567');
  });
});

describe('B.3 starter configurations validate as the spec says (15 Příloha B.3)', () => {
  for (const def of STARTER_CONFIG_DEFS)
    it(`${def.id} -> ${def.expectedStatus} ${def.expectedProfile ?? ''}`, () => {
      const s = starter(def.id);
      const r = validateServerConfig(cat, s.config, { storage: def.expectedStatus === 'ext' ? 'vmfs-fc' : 'vsan-esa' });
      const req = r.findings.filter((f) => f.hwClass === 'REQ');
      const dev = r.findings.filter((f) => f.hwClass === 'DEV');
      if (def.expectedStatus === 'req') expect(req.length).toBeGreaterThan(0);
      else expect(req).toEqual([]);
      if (def.expectedStatus === 'dev') expect(dev.length).toBeGreaterThan(0);
      if (def.expectedProfile) expect(r.esaProfile?.profile).toBe(def.expectedProfile);
      for (const f of r.findings) expect(f.severity).toBe({ REQ: 'error', DEV: 'warning', RCMD: 'recommendation' }[f.hwClass]);
    });
});

describe('ESA profile derivation (15 §6.1 [SIMPL] over [BCG])', () => {
  it('uses the HCI guidance minima verbatim', () => {
    expect(HCI_PROFILE_MINIMA).toEqual({
      SM: { capacityTB: 3.2, cores: 16, ramGB: 128, networkGbE: 10, baseMaxDevices: 12 },
      MED: { capacityTB: 20, cores: 32, ramGB: 256, networkGbE: 25, baseMaxDevices: 18 },
      LRG: { capacityTB: 50, cores: 48, ramGB: 512, networkGbE: 100, baseMaxDevices: 24 },
    });
  });

  it('caps the profile by BCG certification (R7715 has no vSAN-HCI-LRG)', () => {
    const r7715 = cat.models.get('bcg-63413');
    if (!r7715) throw new Error('model');
    const m = { cores: 64, ramGB: 1024, driveCount: 10, nodeCapacityTB: 64, nicPorts: 4, nodeNetworkGbE: 100, slowestNicGbE: 100 };
    expect(deriveEsaProfile(r7715, m).profile).toBe('vSAN-HCI-MED');
  });

  it('marks network-limited nodes (LRG compute on 25 GbE -> MED)', () => {
    const s = starter('cisco-c240m8e3s-lrg-25g');
    const res = resolveServerConfig(cat, s.config);
    if (!res.ok) throw new Error('resolve');
    const p = deriveEsaProfile(s.model, configMetrics(res.resolved));
    expect(p).toMatchObject({ profile: 'vSAN-HCI-MED', computeProfile: 'vSAN-HCI-LRG', networkLimited: true });
  });

  it('derives Storage Cluster profiles (20 TB / 2 devices minimum)', () => {
    const s = starter('hpe-dl380g12-med');
    const r = validateServerConfig(cat, s.config, { storage: 'vsan-esa', esaFamily: 'SC' });
    // DL380 Gen12 is certified for SC-MED/LRG only (no SC-SM, 15 A.2); 25.6 TB, 32 cores, 256 GB, 25 GbE -> SC-MED
    expect(r.esaProfile?.profile).toBe('vSAN-SC-MED');
  });
});

describe('REQ findings (15 §5)', () => {
  const base = starter('hpe-dl380g12-med').config;

  it('ESA cores / RAM below 16 / 128 (VCF-VSAN-ESA-REQD-CFG-003/004) and below SM', () => {
    const f = esa(starter('dell-r670-undersized').config).findings;
    expect(codes(f)).toEqual(expect.arrayContaining(['HW_ESA_CORES_BELOW_MIN', 'HW_ESA_MEMORY_BELOW_MIN', 'HW_ESA_BELOW_SM_PROFILE']));
    expect(byCode(f, 'HW_ESA_BELOW_SM_PROFILE')?.message).toContain('All ReadyNodes must meet or exceed the vSAN-HCI-SM');
  });

  it('capacity below 3.2 TB with valid single disk -> below SM only', () => {
    expect(codes(esa(starter('smc-122h-onedisk').config).findings)).toEqual(['HW_ESA_BELOW_SM_PROFILE']);
  });

  it('SAS drive in ESA', () => {
    const f = byCode(esa(starter('len-sr650v4-sas').config).findings, 'HW_ESA_DRIVE_NOT_NVME');
    expect(f?.message).toContain('SAS and SATA are not currently planned for vSAN ESA');
  });

  it('Cyber Recovery drive in HCI: CR section + 0.51 DWPD', () => {
    expect(codes(esa(starter('hpe-dl380g12-crdrive').config).findings)).toEqual(expect.arrayContaining(['HW_ESA_DRIVE_CYBER_RECOVERY_ONLY', 'HW_ESA_DRIVE_ENDURANCE']));
  });

  it('drive of another OEM vs. same-OEM drive outside the model BOM', () => {
    expect(codes(esa(starter('hpe-dl380g12-dell-drive').config).findings)).toContain('HW_ESA_DRIVE_OTHER_OEM');
    // Cisco PM1745 E3.S is in the C240-M8E3S BOM but not in the C220-M8S BOM (U.3 7500 only)
    const cfg = { ...starter('cisco-c220m8s-med').config, drives: [{ partId: 'drv-cisco-pm1745-e3s-6400', count: 4 }] };
    expect(codes(esa(cfg).findings)).toContain('HW_ESA_DRIVE_NOT_IN_BOM');
  });

  it('drive < 1.6 TB', () => {
    const small: DrivePart = { kind: 'drive', id: 'x-small', family: 'HPE E3.S MU CM7 [3 DWPD]', oem: 'HPE', interface: 'NVMe', capacityTB: 0.8, capacitySource: 'SIMPL', dwpd: 3, bomSection: 'esa' };
    const f = esa({ ...base, drives: [{ partId: 'x-small', count: 8 }] }, withExtras({ drives: [small] })).findings;
    expect(codes(f)).toContain('HW_ESA_DRIVE_TOO_SMALL');
  });

  it('more drives than maxDrives is physically impossible; > 24 violates the ESA maximum', () => {
    const f = byCode(esa(starter('cisco-c220m8s-9drives').config).findings, 'HW_DRIVES_EXCEED_MODEL_MAX');
    expect(f?.physicallyImpossible).toBe(true);
    const big = { ...(cat.models.get('bcg-63561') as ServerModel), id: 'fake-30', maxDrives: 30 };
    const f2 = esa({ ...base, modelId: 'fake-30', drives: [{ partId: 'drv-hpe-cm7-e3s-3200', count: 25 }] }, withExtras({ models: [big] })).findings;
    expect(codes(f2)).toContain('HW_ESA_TOO_MANY_DRIVES');
    expect(codes(f2)).not.toContain('HW_DRIVES_EXCEED_MODEL_MAX');
  });

  it('sockets / cores / RAM beyond model limits', () => {
    const f = byCode(esa({ ...base, ramGB: 16384 }).findings, 'HW_EXCEEDS_MODEL_LIMIT');
    expect(f).toMatchObject({ hwClass: 'REQ', physicallyImpossible: true });
  });

  it('Tri-Mode controller (VCF-VSAN-REQD-CFG-005)', () => {
    expect(codes(esa(starter('smc-222h-trimode').config).findings)).toEqual(['HW_ESA_TRI_MODE_CONTROLLER']);
  });

  it('NIC below 10GbE for ESA; no NIC at all', () => {
    const one: NicPart = { kind: 'nic', id: 'x-1g', bomName: 'fake 1G', ports: 2, speedsGbE: [1], speedSource: 'SIMPL' };
    expect(codes(esa({ ...base, nics: [{ partId: 'x-1g', count: 1 }] }, withExtras({ nics: [one] })).findings)).toContain('HW_ESA_NIC_BELOW_10GBE');
    expect(codes(validateServerConfig(cat, { ...base, nics: [] }).findings)).toContain('HW_NO_NIC');
  });

  it('not certified for the target release -> "ESX Host is not HCL compatible."', () => {
    const old = { ...(cat.models.get('bcg-63561') as ServerModel), id: 'fake-old', supportedReleases: ['ESXi 8.0 U3 (vSAN  8.0 Update 3)'] };
    const f = byCode(validateServerConfig(withExtras({ models: [old] }), { ...base, modelId: 'fake-old' }).findings, 'HW_NOT_HCL_COMPATIBLE');
    expect(f?.message).toContain('ESX Host is not HCL compatible.');
    // dataset label with double space "ESXi 9.0 (vSAN  9.0)" matches the 9.0 target
    expect(codes(validateServerConfig(cat, base, { release: '9.0' }).findings)).not.toContain('HW_NOT_HCL_COMPATIBLE');
  });

  it('boot < 8 GB blocks upgrade; ESX minimum', () => {
    expect(codes(validateServerConfig(cat, { ...base, boot: { ...base.boot, capacityGB: 4 } }).findings)).toContain('HW_BOOT_TOO_SMALL');
    expect(codes(validateServerConfig(cat, { ...base, sockets: 1, coresPerSocket: 1 }).findings)).toContain('HW_BELOW_ESX_MINIMUM');
  });

  it('VMFS on FC needs an FC HBA', () => {
    expect(codes(validateServerConfig(cat, base, { storage: 'vmfs-fc' }).findings)).toEqual(['HW_FC_HBA_MISSING']);
    expect(validateServerConfig(cat, starter('len-sr630v4-compute').config, { storage: 'vmfs-fc' }).eligible).toBe(true);
  });

  it('unknown part ids are game-scope errors', () => {
    const r = validateServerConfig(cat, { ...base, drives: [{ partId: 'nope', count: 1 }] });
    expect(r.findings[0]).toMatchObject({ code: 'HW_UNKNOWN_PART', scope: 'game-scope' });
  });
});

describe('DEV findings (15 §5)', () => {
  it('10GbE ESA -> compliance check KB 372309 / 75 % KB 372311', () => {
    const f = byCode(esa(starter('dell-r670-sm').config).findings, 'HW_ESA_10GBE_COMPLIANCE');
    expect(f).toMatchObject({ hwClass: 'DEV', severity: 'warning' });
    expect(f?.message).toContain('75 %');
  });

  it('larger node on 10GbE: DEV with both references (15 OQ6)', () => {
    const f = byCode(esa(starter('dell-r670-med-10g').config).findings, 'HW_ESA_LARGER_NODE_10GBE');
    expect(f).toMatchObject({ hwClass: 'DEV', severity: 'warning' });
    expect(f?.documentationConflict?.openQuestion).toBe('15 §8 OQ6');
    expect(f?.documentationConflict?.refs).toHaveLength(2);
    expect(f?.message).toContain('Larger vSAN ESA nodes require 25GbE.');
  });

  it('LRG compute on 25 GbE: guidance deviation', () => {
    const f = byCode(esa(starter('cisco-c240m8e3s-lrg-25g').config).findings, 'HW_ESA_PROFILE_NETWORK_DEVIATION');
    expect(f?.message).toContain('Deviations from recommended specs are supported');
  });

  it('boot below 32 GB is deprecated; USB/SD only -> "Secondary persistent device not found."', () => {
    const base = starter('hpe-dl380g12-med').config;
    expect(byCode(validateServerConfig(cat, { ...base, boot: { ...base.boot, capacityGB: 16 } }).findings, 'HW_BOOT_BELOW_32GB')?.hwClass).toBe('DEV');
    const usb = byCode(validateServerConfig(cat, { ...base, boot: { ...base.boot, capacityGB: 64, kind: 'usb-sd' } }).findings, 'HW_BOOT_NO_PERSISTENT_DEVICE');
    expect(usb?.message).toContain('Secondary persistent device not found.');
  });
});

describe('RCMD findings', () => {
  const base = starter('hpe-dl380g12-med').config;

  it('boot below 128 GB (VCF-ESX-RCMD-CFG-004)', () => {
    expect(byCode(validateServerConfig(cat, { ...base, boot: { ...base.boot, capacityGB: 64 } }).findings, 'HW_BOOT_BELOW_RECOMMENDED')?.hwClass).toBe('RCMD');
  });

  it('single-port NIC -> "Dual-port NICs recommended for redundancy."', () => {
    const one: NicPart = { kind: 'nic', id: 'x-1p', bomName: 'Mellanox MCX631102AS-ADAT Ethernet 10/25Gb 2-port SFP28 Adapter for HPE P42044-B21', ports: 1, speedsGbE: [25], speedSource: 'SIMPL' };
    const f = byCode(esa({ ...base, nics: [{ partId: 'x-1p', count: 1 }] }, withExtras({ nics: [one] })).findings, 'HW_NIC_SINGLE_PORT');
    expect(f?.message).toBe('Dual-port NICs recommended for redundancy.');
  });

  it('NIC outside the model BOM -> game-scope hint; mixed NIC models on one host', () => {
    const f = validateServerConfig(cat, { ...base, nics: [{ partId: 'nic-dell-cx6lx-25g-2p', count: 1 }, { partId: 'nic-hpe-cx6lx-25g-2p', count: 1 }] }).findings;
    expect(byCode(f, 'HW_NIC_NOT_IN_BOM')).toMatchObject({ scope: 'game-scope', severity: 'recommendation' });
    expect(codes(f)).toContain('HW_NIC_UPLINK_MISMATCH');
  });

  it('vSAN OSA is a game-scope note', () => {
    expect(validateServerConfig(cat, base, { storage: 'vsan-osa' }).findings[0]).toMatchObject({ code: 'HW_OSA_NOT_MODELLED', scope: 'game-scope' });
  });
});

describe('cluster level (10 §3.4, 20 §3.2, 15 §3.3)', () => {
  const h = (id: string, starterId: string) => ({ hostId: id, config: starter(starterId).config });

  it('initial management cluster: one vendor, homogeneous config (errors)', () => {
    const f = validateClusterHardware(cat, [h('a', 'dell-r670-med'), h('b', 'hpe-dl380g12-med')], { initialManagementCluster: true });
    expect(codes(f)).toEqual(expect.arrayContaining(['ESX_MULTIPLE_VENDORS', 'HW_CLUSTER_HETEROGENEOUS', 'HW_CLUSTER_PNIC_MISMATCH']));
    expect(byCode(f, 'HW_CLUSTER_HETEROGENEOUS')?.severity).toBe('error');
  });

  it('other clusters: heterogeneity is a recommendation', () => {
    const f = validateClusterHardware(cat, [h('a', 'dell-r670-med'), h('b', 'dell-r670-med-10g')], { initialManagementCluster: false });
    expect(byCode(f, 'HW_CLUSTER_HETEROGENEOUS')?.severity).toBe('recommendation');
  });

  it('identical hosts are fine; mixing 1 and 3 DWPD in ESA is RCMD', () => {
    expect(validateClusterHardware(cat, [h('a', 'dell-r670-med'), h('b', 'dell-r670-med')], { initialManagementCluster: true, storage: 'vsan-esa' })).toEqual([]);
    const ri: DrivePart = { kind: 'drive', id: 'x-ri', family: 'HPE E3.S RI CM7 [1 DWPD]', oem: 'HPE', interface: 'NVMe', capacityTB: 3.84, capacitySource: 'SIMPL', dwpd: 1, bomSection: 'esa' };
    const lookup = withExtras({ drives: [ri] });
    const b = { hostId: 'b', config: { ...starter('hpe-dl380g12-med').config, drives: [{ partId: 'x-ri', count: 8 }] } };
    expect(codes(validateClusterHardware(lookup, [h('a', 'hpe-dl380g12-med'), b], { initialManagementCluster: false, storage: 'vsan-esa' }))).toContain('HW_ESA_MIXED_DWPD');
  });
});

describe('NICs vs. VDS model and vSAN NIC count', () => {
  it('Single VDS = 2 pNIC (warning); Storage and Workload Separation = 6 (error); others not stated', () => {
    expect(validateNicsForVdsModel(1, 'single')[0]?.severity).toBe('warning');
    expect(validateNicsForVdsModel(4, 'storage-and-workload-separation')[0]?.severity).toBe('error');
    expect(validateNicsForVdsModel(6, 'storage-and-workload-separation')).toEqual([]);
    expect(nicRequirementForVdsModel('storage-separation')).toBeUndefined();
  });

  it('vSAN: 2 pNIC small, 4 pNIC large (RCMD)', () => {
    expect(validateVsanNicCount(2, 'vSAN-HCI-SM')).toEqual([]);
    expect(validateVsanNicCount(2, 'vSAN-HCI-LRG')[0]?.severity).toBe('recommendation');
  });
});
