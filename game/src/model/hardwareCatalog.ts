/**
 * Game hardware catalog built from the BCG dataset (spec 15 Příloha B).
 *
 * - Server models: every ReadyNode of docs/spec/data/bcg-vsan-esa-readynodes-esxi91.json ([H9][BCG]).
 * - Drive / NIC parts: 15 Příloha B.2 (part ids, BOM names, [BCG-data] capacities and links; [SIMPL] capacities
 *   where marked).
 * - Starter server configurations: 15 Příloha B.3 (ids, models, cores, RAM, drives, NICs; expected status).
 * - Switches and racks: generic "no-name" items – GAME VALUES, not from documentation (CLAUDE.md, UX §2.3).
 *
 * No prices: every item has a stable `id` the economy layer can price.
 * `buildHardwareCatalog` cross-checks the hand-written B.2/B.3 data against the dataset and reports problems
 * (e.g. a BOM name that no longer exists after a dataset refresh).
 */
import { BCG_DATASET, type BcgDataset } from './bcgDataset';
import {
  type BootDevice,
  type DrivePart,
  type EsaProfileId,
  type HwVendor,
  type NicPart,
  type PartsLookup,
  type ServerConfig,
  type ServerModel,
  bootDeviceOf,
  serverModelsFromDataset,
} from './hardware';

// ===========================================================================
// Drives (15 Příloha B.2)
// ===========================================================================

const SSD = (id: number): string => `https://compatibilityguide.broadcom.com/detail?program=ssd&productId=${id}&persona=live`;
const RDMA = (id: number): string => `https://compatibilityguide.broadcom.com/detail?program=rdmanic&productId=${id}&persona=live`;

function esaDrive(id: string, family: string, oem: HwVendor, tb: number, source: 'BCG-data' | 'SIMPL', link?: string): DrivePart {
  const m = /\[([\d.]+)\s*DWPD\]/.exec(family);
  return {
    kind: 'drive', id, family, oem, interface: 'NVMe', capacityTB: tb, capacitySource: source, bomSection: 'esa',
    ...(m?.[1] !== undefined ? { dwpd: Number(m[1]) } : {}),
    ...(link !== undefined ? { bcgDataUrl: link } : {}),
  };
}

export const DRIVE_PARTS: readonly DrivePart[] = [
  // [BCG-data] capacities (15 B.2 first table)
  esaDrive('drv-dell-ps1030-e3s-1600', 'Dell E3.S PS1030 [3 DWPD]', 'Dell', 1.6, 'BCG-data', SSD(62524)),
  esaDrive('drv-dell-ps1030-e3s-3200', 'Dell E3.S PS1030 [3 DWPD]', 'Dell', 3.2, 'BCG-data', SSD(62526)),
  esaDrive('drv-dell-ps1030-e3s-6400', 'Dell E3.S PS1030 [3 DWPD]', 'Dell', 6.4, 'BCG-data', SSD(62528)),
  esaDrive('drv-hpe-cm7-u3-1600', 'HPE U.3 MU CM7 [3 DWPD]', 'HPE', 1.6, 'BCG-data', SSD(57501)),
  esaDrive('drv-hpe-cm7-e3s-3200', 'HPE E3.S MU CM7 [3 DWPD]', 'HPE', 3.2, 'BCG-data', SSD(56417)),
  esaDrive('drv-hpe-9550-e3s-6400', 'HPE E3.S MU 9550 [3 DWPD]', 'HPE', 6.4, 'BCG-data', SSD(63347)),
  esaDrive('drv-cisco-7500-1600', 'Cisco U.3 7500 [3 DWPD]', 'Cisco', 1.6, 'BCG-data', SSD(64569)),
  esaDrive('drv-cisco-7500-3200', 'Cisco U.3 7500 [3 DWPD]', 'Cisco', 3.2, 'BCG-data', SSD(64570)),
  esaDrive('drv-cisco-7500-6400', 'Cisco U.3 7500 [3 DWPD]', 'Cisco', 6.4, 'BCG-data', SSD(64571)),
  // [SIMPL] capacities (15 B.2 second table, OQ1)
  esaDrive('drv-len-7500max-u3-1600', 'ThinkSystem U.3 7500 MAX [3 DWPD]', 'Lenovo', 1.6, 'SIMPL'),
  esaDrive('drv-len-7500max-u3-3200', 'ThinkSystem U.3 7500 MAX [3 DWPD]', 'Lenovo', 3.2, 'SIMPL'),
  esaDrive('drv-len-7500max-u3-6400', 'ThinkSystem U.3 7500 MAX [3 DWPD]', 'Lenovo', 6.4, 'SIMPL'),
  esaDrive('drv-cisco-pm1745-e3s-3200', 'Cisco E3.S PM1745 [3 DWPD]', 'Cisco', 3.2, 'SIMPL'),
  esaDrive('drv-cisco-pm1745-e3s-6400', 'Cisco E3.S PM1745 [3 DWPD]', 'Cisco', 6.4, 'SIMPL'),
  esaDrive('drv-smc-kioxia-cm7v-u2-1600', 'Kioxia U.2 CM7-V Series [3 DWPD]', 'Supermicro', 1.6, 'SIMPL'),
  esaDrive('drv-smc-kioxia-cm7v-u2-3200', 'Kioxia U.2 CM7-V Series [3 DWPD]', 'Supermicro', 3.2, 'SIMPL'),
  esaDrive('drv-smc-kioxia-cm7v-u2-6400', 'Kioxia U.2 CM7-V Series [3 DWPD]', 'Supermicro', 6.4, 'SIMPL'),
  esaDrive('drv-smc-solidigm-p5620-u2-3200', 'Solidigm U.2 D7-P5620 [3 DWPD]', 'Supermicro', 3.2, 'SIMPL'),
  esaDrive('drv-smc-solidigm-p5620-u2-6400', 'Solidigm U.2 D7-P5620 [3 DWPD]', 'Supermicro', 6.4, 'SIMPL'),
  // Cyber Recovery BOM drive (trap). 15.36 TB = QLC capacity from guidance [SIMPL]; data do not say P5430 is QLC.
  {
    kind: 'drive', id: 'drv-hpe-p5430-cr', family: 'HPE E3.S VRO P5430 [0.51 DWPD]', oem: 'HPE', interface: 'NVMe',
    capacityTB: 15.36, capacitySource: 'SIMPL', dwpd: 0.51, bomSection: 'cyber-recovery',
  },
  // vSAN OSA SAS drives [BCG-data] (for the "SAS in ESA" trap and OSA scenarios). DWPD not in export (15 §6.4).
  { kind: 'drive', id: 'drv-hpe-pm1655a-sas-1600', family: 'DRV, 1.6TB SAS MU SFF PM1655a SSD-SAM', oem: 'HPE', interface: 'SAS', cell: 'TLC', capacityTB: 1.6, capacitySource: 'BCG-data', bomSection: 'osa', osaTiers: ['AF-Cache', 'AF-Cap'], bcgDataUrl: SSD(62573) },
  { kind: 'drive', id: 'drv-hpe-pm1653a-sas-3840', family: 'DRV, 3.84TB SAS RI SFF PM1653a SSD-SAM', oem: 'HPE', interface: 'SAS', cell: 'TLC', capacityTB: 3.84, capacitySource: 'BCG-data', bomSection: 'osa', osaTiers: ['AF-Cache', 'AF-Cap'], bcgDataUrl: SSD(62566) },
  { kind: 'drive', id: 'drv-len-pm1635a-sas-1600', family: 'PM1635a 1600GB', oem: 'Lenovo', interface: 'SAS', cell: 'TLC', capacityTB: 1.6, capacitySource: 'BCG-data', bomSection: 'osa', osaTiers: ['AF-Cache', 'AF-Cap', 'HY-Cache'], bcgDataUrl: SSD(41881) },
  { kind: 'drive', id: 'drv-len-pm1633a-sas-3840', family: 'PM1633a 3840GB', oem: 'Lenovo', interface: 'SAS', cell: 'TLC', capacityTB: 3.84, capacitySource: 'BCG-data', bomSection: 'osa', osaTiers: ['AF-Cache', 'AF-Cap', 'HY-Cache'], bcgDataUrl: SSD(41887) },
];

// ===========================================================================
// NICs (15 Příloha B.2; ports / speeds from the name = [SIMPL])
// ===========================================================================

const nic = (id: string, bomName: string, speedsGbE: number[], ports: number, link?: string): NicPart => ({
  kind: 'nic', id, bomName, ports, speedsGbE, speedSource: 'SIMPL', ...(link !== undefined ? { bcgDataUrl: link } : {}),
});

export const NIC_PARTS: readonly NicPart[] = [
  nic('nic-dell-57412-10gbt-2p', 'Broadcom 57412 10G BT Dual Port', [10], 2),
  nic('nic-dell-cx6lx-25g-2p', 'NVIDIA ConnectX-6 LX Dual Port 25 GbE SFP OCP3.0 Network Adapter', [25], 2),
  nic('nic-dell-cx6dx-100g-2p', 'NVIDIA ConnectX-6 Dx Dual Port 100GbE QSFP56', [100], 2, RDMA(59418)),
  nic('nic-hpe-57414-25g-2p', 'Broadcom BCM57414 Ethernet 10/25Gb 2-port SFP28 Adapter for HPE P26262-B21', [10, 25], 2),
  nic('nic-hpe-cx6lx-25g-2p', 'Mellanox MCX631102AS-ADAT Ethernet 10/25Gb 2-port SFP28 Adapter for HPE P42044-B21', [10, 25], 2),
  nic('nic-hpe-cx6-100g-2p', 'Mellanox MCX623106AS-CDAT Ethernet 100Gb 2-port QSFP56 Adapter for HPE P25960-B21', [100], 2, RDMA(52038)),
  nic('nic-len-cx6lx-25g-2p', 'Lenovo-4XC7A62582-ThinkSystem Mellanox ConnectX-6 Lx 10/25GbE SFP28 2-port OCP Ethernet Adapter', [10, 25], 2),
  nic('nic-len-57414-25g-2p-ocp', 'ThinkSystem Broadcom 57414 10/25GbE SFP28 2-port OCP Ethernet Adapter(4XC7A08237)', [10, 25], 2),
  nic('nic-len-57508-100g-2p', 'ThinkSystem Broadcom 57508 100GbE QSFP56 2-Port OCP Ethernet Adapter (4XC7A08243)', [100], 2, RDMA(63572)),
  nic('nic-cisco-x710t2lg-10g-2p', 'Cisco(R) X710T2LG 2x10 GbE RJ45 PCIe NIC', [10], 2),
  nic('nic-cisco-cx6lx-25g-2p', 'Cisco-NVDA MCX631102AS-ADAT CX6 Lx 2x25G SFP28 x8 PCIe', [25], 2, RDMA(64422)),
  nic('nic-cisco-cx7-25g-4p', 'Cisco-NVDA MCX713104AS-ADAT 4x25GbE SFP56 Gen4 x16 PCIe NIC', [25], 4, RDMA(64652)),
  nic('nic-cisco-cx6-100g-2p', 'Cisco-MLNX MCX623106AS-CDAT 2x100GbE QSFP56 PCIe NIC', [100], 2, RDMA(64367)),
  nic('nic-smc-a25g-m2sm', 'AOC-A25G-m2SM', [25], 2, RDMA(52102)), // ports not in the name -> 2 [SIMPL]
  nic('nic-smc-a25g-i2sm', 'AOC-A25G-i2SM', [25], 2),
  nic('nic-smc-a100g-m2cm', 'AOC-A100G-m2CM', [100], 2),
];

// ===========================================================================
// Generic switches and racks – GAME VALUES (not documentation)
// ===========================================================================

export interface SwitchModel {
  readonly kind: 'switch';
  readonly id: string;
  readonly label: string;
  readonly ports: number;
  /** Port speeds (GbE) the generic switch supports. Game value. */
  readonly speedsGbE: readonly number[];
  /**
   * Maximum port MTU. Game value; 9216 is the vendor example named by KB 434502 for jumbo frames
   * ("9128 or vendor equivalent, e.g. 9216", 25 §5.4 [U46]).
   */
  readonly maxMtu: number;
  /** Default port MTU 1500 – game default (UX §2.6: generic switch has no documented default). */
  readonly defaultPortMtu: number;
  /** Dedicated 1G management-only switch for the OOB network (game scope). */
  readonly oobOnly: boolean;
  readonly rackUnits: number;
  readonly gameGeneric: true;
}

export const SWITCH_MODELS: readonly SwitchModel[] = [
  { kind: 'switch', id: 'sw-generic-48x10g', label: 'Generic ToR 48× 10G', ports: 48, speedsGbE: [10], maxMtu: 9216, defaultPortMtu: 1500, oobOnly: false, rackUnits: 1, gameGeneric: true },
  { kind: 'switch', id: 'sw-generic-48x25g', label: 'Generic ToR 48× 25G', ports: 48, speedsGbE: [10, 25], maxMtu: 9216, defaultPortMtu: 1500, oobOnly: false, rackUnits: 1, gameGeneric: true },
  { kind: 'switch', id: 'sw-generic-32x100g', label: 'Generic ToR 32× 100G', ports: 32, speedsGbE: [100], maxMtu: 9216, defaultPortMtu: 1500, oobOnly: false, rackUnits: 1, gameGeneric: true },
  { kind: 'switch', id: 'sw-generic-48x1g-oob', label: 'Generic OOB 48× 1G (10G uplink capable)', ports: 48, speedsGbE: [1, 10], maxMtu: 9216, defaultPortMtu: 1500, oobOnly: true, rackUnits: 1, gameGeneric: true },
];

export interface RackModel {
  readonly kind: 'rack';
  readonly id: string;
  readonly label: string;
  readonly heightU: number;
  readonly gameGeneric: true;
}

export const RACK_MODELS: readonly RackModel[] = [{ kind: 'rack', id: 'rack-generic-42u', label: 'Rack 42U', heightU: 42, gameGeneric: true }];

export { BMC_PORT_SPEEDS_GBE } from './hardware';

// ===========================================================================
// Starter configurations (15 Příloha B.3)
// ===========================================================================

/** "Stav" column of 15 B.3: ✓ / DEV / ✗ (REQ) / EXT (external storage host). */
export type StarterStatus = 'ok' | 'dev' | 'req' | 'ext';

export interface StarterConfigDef {
  readonly id: string;
  readonly productId: number;
  readonly sockets: number;
  readonly coresPerSocket: number;
  readonly ramGB: number;
  readonly drives: readonly (readonly [string, number])[];
  readonly nics: readonly (readonly [string, number])[];
  readonly triModeController?: true;
  readonly fcHba?: true;
  /** Expected HCI profile per 15 B.3 (undefined = "pod HCI-SM" or "–"). */
  readonly expectedProfile?: EsaProfileId;
  readonly expectedStatus: StarterStatus;
  readonly note: string;
}

export const STARTER_CONFIG_DEFS: readonly StarterConfigDef[] = [
  // Dell
  { id: 'dell-r670-sm', productId: 63567, sockets: 1, coresPerSocket: 16, ramGB: 128, drives: [['drv-dell-ps1030-e3s-1600', 4]], nics: [['nic-dell-57412-10gbt-2p', 1]], expectedProfile: 'vSAN-HCI-SM', expectedStatus: 'ok', note: '10 GbE -> KB 372309/372311' },
  { id: 'dell-r670-med', productId: 63567, sockets: 2, coresPerSocket: 16, ramGB: 256, drives: [['drv-dell-ps1030-e3s-3200', 8]], nics: [['nic-dell-cx6lx-25g-2p', 1]], expectedProfile: 'vSAN-HCI-MED', expectedStatus: 'ok', note: '' },
  { id: 'dell-r770-lrg', productId: 63566, sockets: 2, coresPerSocket: 24, ramGB: 512, drives: [['drv-dell-ps1030-e3s-6400', 8]], nics: [['nic-dell-cx6dx-100g-2p', 2]], expectedProfile: 'vSAN-HCI-LRG', expectedStatus: 'ok', note: '' },
  { id: 'dell-r670-med-10g', productId: 63567, sockets: 2, coresPerSocket: 16, ramGB: 256, drives: [['drv-dell-ps1030-e3s-3200', 8]], nics: [['nic-dell-57412-10gbt-2p', 1]], expectedProfile: 'vSAN-HCI-SM', expectedStatus: 'dev', note: 'compute MED on 10 GbE (15 OQ6)' },
  { id: 'dell-r670-undersized', productId: 63567, sockets: 1, coresPerSocket: 12, ramGB: 96, drives: [['drv-dell-ps1030-e3s-1600', 2]], nics: [['nic-dell-cx6lx-25g-2p', 1]], expectedStatus: 'req', note: '< 16 cores, < 128 GB' },
  // HPE
  { id: 'hpe-dl360g12-sm', productId: 63562, sockets: 1, coresPerSocket: 16, ramGB: 128, drives: [['drv-hpe-cm7-u3-1600', 2]], nics: [['nic-hpe-57414-25g-2p', 1]], expectedProfile: 'vSAN-HCI-SM', expectedStatus: 'ok', note: '3.2 TB = minimum' },
  { id: 'hpe-dl380g12-med', productId: 63561, sockets: 2, coresPerSocket: 16, ramGB: 256, drives: [['drv-hpe-cm7-e3s-3200', 8]], nics: [['nic-hpe-cx6lx-25g-2p', 1]], expectedProfile: 'vSAN-HCI-MED', expectedStatus: 'ok', note: '' },
  { id: 'hpe-dl380g12-lrg', productId: 63561, sockets: 2, coresPerSocket: 24, ramGB: 512, drives: [['drv-hpe-9550-e3s-6400', 8]], nics: [['nic-hpe-cx6-100g-2p', 2]], expectedProfile: 'vSAN-HCI-LRG', expectedStatus: 'ok', note: '' },
  { id: 'hpe-dl380g12-crdrive', productId: 63561, sockets: 2, coresPerSocket: 16, ramGB: 256, drives: [['drv-hpe-p5430-cr', 4]], nics: [['nic-hpe-cx6lx-25g-2p', 1]], expectedStatus: 'req', note: 'Cyber Recovery drive in HCI' },
  { id: 'hpe-dl380g12-dell-drive', productId: 63561, sockets: 2, coresPerSocket: 16, ramGB: 256, drives: [['drv-dell-ps1030-e3s-3200', 8]], nics: [['nic-hpe-cx6lx-25g-2p', 1]], expectedStatus: 'req', note: 'drive of another OEM' },
  // Lenovo
  { id: 'len-sr630v4-sm', productId: 63600, sockets: 1, coresPerSocket: 16, ramGB: 128, drives: [['drv-len-7500max-u3-1600', 4]], nics: [['nic-len-cx6lx-25g-2p', 1]], expectedProfile: 'vSAN-HCI-SM', expectedStatus: 'ok', note: '' },
  { id: 'len-sr650v4-med', productId: 63599, sockets: 2, coresPerSocket: 16, ramGB: 256, drives: [['drv-len-7500max-u3-3200', 8]], nics: [['nic-len-57414-25g-2p-ocp', 1]], expectedProfile: 'vSAN-HCI-MED', expectedStatus: 'ok', note: '' },
  { id: 'len-sr650v4-lrg', productId: 63599, sockets: 2, coresPerSocket: 24, ramGB: 512, drives: [['drv-len-7500max-u3-6400', 8]], nics: [['nic-len-57508-100g-2p', 2]], expectedProfile: 'vSAN-HCI-LRG', expectedStatus: 'ok', note: '' },
  { id: 'len-sr650v4-sas', productId: 63599, sockets: 2, coresPerSocket: 16, ramGB: 256, drives: [['drv-len-pm1633a-sas-3840', 8]], nics: [['nic-len-57414-25g-2p-ocp', 1]], expectedStatus: 'req', note: 'SAS in ESA' },
  { id: 'len-sr630v4-compute', productId: 63600, sockets: 2, coresPerSocket: 16, ramGB: 512, drives: [], nics: [['nic-len-cx6lx-25g-2p', 1]], fcHba: true, expectedStatus: 'ext', note: 'NFS / FC principal storage host' },
  // Cisco
  { id: 'cisco-c220m8s-sm', productId: 64247, sockets: 1, coresPerSocket: 16, ramGB: 128, drives: [['drv-cisco-7500-1600', 2]], nics: [['nic-cisco-x710t2lg-10g-2p', 1]], expectedProfile: 'vSAN-HCI-SM', expectedStatus: 'ok', note: '10 GbE -> KB 372309/372311' },
  { id: 'cisco-c220m8s-med', productId: 64247, sockets: 2, coresPerSocket: 16, ramGB: 256, drives: [['drv-cisco-7500-6400', 4]], nics: [['nic-cisco-cx6lx-25g-2p', 1]], expectedProfile: 'vSAN-HCI-MED', expectedStatus: 'ok', note: '' },
  { id: 'cisco-c240m8e3s-lrg', productId: 63932, sockets: 2, coresPerSocket: 24, ramGB: 512, drives: [['drv-cisco-pm1745-e3s-3200', 16]], nics: [['nic-cisco-cx6-100g-2p', 2]], expectedProfile: 'vSAN-HCI-LRG', expectedStatus: 'ok', note: 'single boot SSD' },
  { id: 'cisco-c240m8e3s-lrg-25g', productId: 63932, sockets: 2, coresPerSocket: 24, ramGB: 512, drives: [['drv-cisco-pm1745-e3s-3200', 16]], nics: [['nic-cisco-cx7-25g-4p', 1]], expectedProfile: 'vSAN-HCI-MED', expectedStatus: 'dev', note: '25 Gb instead of 100 Gb on LRG (guidance example)' },
  { id: 'cisco-c220m8s-9drives', productId: 64247, sockets: 2, coresPerSocket: 16, ramGB: 256, drives: [['drv-cisco-7500-3200', 9]], nics: [['nic-cisco-cx6lx-25g-2p', 1]], expectedStatus: 'req', note: 'more drives than maxDrives = 8' },
  // Supermicro
  { id: 'smc-122h-sm', productId: 64010, sockets: 1, coresPerSocket: 16, ramGB: 128, drives: [['drv-smc-kioxia-cm7v-u2-1600', 2]], nics: [['nic-smc-a25g-m2sm', 1]], expectedProfile: 'vSAN-HCI-SM', expectedStatus: 'ok', note: '' },
  { id: 'smc-222h-med', productId: 63933, sockets: 2, coresPerSocket: 16, ramGB: 256, drives: [['drv-smc-kioxia-cm7v-u2-3200', 8]], nics: [['nic-smc-a25g-i2sm', 1]], expectedProfile: 'vSAN-HCI-MED', expectedStatus: 'ok', note: '' },
  { id: 'smc-222h-lrg', productId: 63933, sockets: 2, coresPerSocket: 24, ramGB: 512, drives: [['drv-smc-solidigm-p5620-u2-6400', 8]], nics: [['nic-smc-a100g-m2cm', 2]], expectedProfile: 'vSAN-HCI-LRG', expectedStatus: 'ok', note: '' },
  { id: 'smc-122h-onedisk', productId: 64010, sockets: 1, coresPerSocket: 16, ramGB: 128, drives: [['drv-smc-kioxia-cm7v-u2-1600', 1]], nics: [['nic-smc-a25g-m2sm', 1]], expectedStatus: 'req', note: 'node capacity < 3.2 TB' },
  { id: 'smc-222h-trimode', productId: 63933, sockets: 2, coresPerSocket: 16, ramGB: 256, drives: [['drv-smc-kioxia-cm7v-u2-3200', 6]], nics: [['nic-smc-a25g-i2sm', 1]], triModeController: true, expectedStatus: 'req', note: 'Tri-Mode controller' },
];

// ===========================================================================
// Catalog
// ===========================================================================

export interface StarterServer {
  readonly kind: 'server';
  /** Stable catalog id = 15 B.3 id. */
  readonly id: string;
  readonly model: ServerModel;
  readonly config: ServerConfig;
  readonly def: StarterConfigDef;
}

export type CatalogItem = StarterServer | DrivePart | NicPart | SwitchModel | RackModel;

export interface HardwareCatalog extends PartsLookup {
  readonly datasetFetchedAt: string;
  readonly datasetRelease: string;
  readonly starterServers: readonly StarterServer[];
  readonly switches: ReadonlyMap<string, SwitchModel>;
  readonly racks: ReadonlyMap<string, RackModel>;
  /** Every purchasable item by stable id (economy prices these ids). */
  readonly items: ReadonlyMap<string, CatalogItem>;
  /** ReadyNode models whose BOM lists the NIC part (derived from the dataset). */
  readonly nicModels: ReadonlyMap<string, readonly number[]>;
  /** Data integrity problems between 15 B.2/B.3 and the dataset (empty = consistent). */
  readonly problems: readonly string[];
}

function toConfig(def: StarterConfigDef, model: ServerModel, boot: BootDevice): ServerConfig {
  return {
    modelId: model.id,
    sockets: def.sockets,
    coresPerSocket: def.coresPerSocket,
    ramGB: def.ramGB,
    drives: def.drives.map(([partId, count]) => ({ partId, count })),
    nics: def.nics.map(([partId, count]) => ({ partId, count })),
    boot,
    triModeController: def.triModeController === true,
    fcHba: def.fcHba === true,
  };
}

/** Builds the catalog from a BCG dataset (default: the repository dataset). Pure. */
export function buildHardwareCatalog(dataset: BcgDataset = BCG_DATASET): HardwareCatalog {
  const problems: string[] = [];
  const modelList = serverModelsFromDataset(dataset);
  const models = new Map(modelList.map((m) => [m.id, m]));
  const byProduct = new Map(modelList.map((m) => [m.productId, m]));
  const drives = new Map(DRIVE_PARTS.map((d) => [d.id, d]));
  const nics = new Map(NIC_PARTS.map((n) => [n.id, n]));

  // B.2 parts must exist in some BOM of the dataset (ESA / CR sections; OSA drives come from the export only).
  for (const d of DRIVE_PARTS) {
    if (d.bomSection === 'osa') continue;
    const section = (m: ServerModel) => (d.bomSection === 'esa' ? m.esaDrives : m.cyberRecoveryDrives);
    if (!modelList.some((m) => section(m).some((f) => f.name === d.family))) problems.push(`drive ${d.id}: family "${d.family}" not in any ${d.bomSection} BOM`);
  }
  const nicModels = new Map<string, number[]>();
  for (const n of NIC_PARTS) {
    const ms = modelList.filter((m) => m.nics.includes(n.bomName)).map((m) => m.productId);
    if (ms.length === 0) problems.push(`nic ${n.id}: "${n.bomName}" not in any BOM`);
    nicModels.set(n.id, ms);
  }

  const starterServers: StarterServer[] = [];
  for (const def of STARTER_CONFIG_DEFS) {
    const model = byProduct.get(def.productId);
    if (!model) {
      problems.push(`starter ${def.id}: productId ${def.productId} not in dataset`);
      continue;
    }
    for (const [p] of def.drives) if (!drives.has(p)) problems.push(`starter ${def.id}: unknown drive ${p}`);
    for (const [p] of def.nics) if (!nics.has(p)) problems.push(`starter ${def.id}: unknown nic ${p}`);
    starterServers.push({ kind: 'server', id: def.id, model, config: toConfig(def, model, bootDeviceOf(model)), def });
  }

  const switches = new Map(SWITCH_MODELS.map((s) => [s.id, s]));
  const racks = new Map(RACK_MODELS.map((r) => [r.id, r]));
  const items = new Map<string, CatalogItem>();
  for (const it of [...starterServers, ...DRIVE_PARTS, ...NIC_PARTS, ...SWITCH_MODELS, ...RACK_MODELS]) {
    if (items.has(it.id)) problems.push(`duplicate catalog id ${it.id}`);
    items.set(it.id, it);
  }
  return {
    datasetFetchedAt: dataset.meta.fetchedAt,
    datasetRelease: dataset.meta.release,
    models,
    drives,
    nics,
    starterServers,
    switches,
    racks,
    items,
    nicModels,
    problems,
  };
}

/** Server configuration of a ReadyNode model with no drives / NICs yet (custom builds start here). */
export function emptyConfigFor(model: ServerModel): ServerConfig {
  return { modelId: model.id, sockets: 1, coresPerSocket: Math.min(16, model.maxCoresPerSocket), ramGB: Math.min(128, model.maxMemoryGB), drives: [], nics: [], boot: bootDeviceOf(model), triModeController: false, fcHba: false };
}
