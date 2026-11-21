/**
 * Economy – FICTIONAL GAME PRICES (CLAUDE.md "Ekonomika": ceny a rozpočty jsou herní mechanika).
 *
 * Nothing here is a fact from documentation and nothing here is a real-world price. The UI must always show these
 * values as "herní cena" / "herní měna" (`gameCurrency: true`, symbol ¤).
 *
 * Independence from VCF rules: this module only READS catalog data (ids, part capacities / speeds to scale a price).
 * It never calls a model validation and no model rule ever reads a price. Changing the table cannot change what VCF
 * allows (tested in sandbox physical tests).
 *
 * Pure TypeScript: no DOM, no PixiJS.
 */
import type { HardwareCatalog, ServerConfig } from '../../model';

/** Game currency descriptor for the UI. */
export const GAME_CURRENCY = {
  symbol: '¤',
  label: 'herní měna',
  gameCurrency: true,
  note: 'Ceny jsou fiktivní herní hodnoty (herní měna) – nejsou z dokumentace ani z reálného trhu.',
} as const;

/** Catalog id of a generic patch cable (game item; cables are free in the Sandbox, UX §9.1). */
export const CABLE_ITEM_ID = 'cable-generic';

/** Price table in game currency. All numbers are invented game values. */
export interface PriceTable {
  readonly gameCurrency: true;
  /** Chassis of a server (any vendor – the game does not price vendors differently). */
  readonly serverChassis: number;
  readonly perCore: number;
  readonly perRamGB: number;
  readonly perBootGB: number;
  /** Per TB of drive capacity, plus a fixed amount per drive. */
  readonly perDriveTB: number;
  readonly perDrive: number;
  /** NIC card price by its fastest speed (GbE); unknown speeds use `nicDefault`. Per port: `perNicPort`. */
  readonly nicBySpeed: Readonly<Record<number, number>>;
  readonly nicDefault: number;
  readonly perNicPort: number;
  readonly fcHba: number;
  /** Generic switch price by switch model id; unknown switch ids use `switchDefault`. */
  readonly switchById: Readonly<Record<string, number>>;
  readonly switchDefault: number;
  /** Generic rack price by rack model id; unknown rack ids use `rack`. */
  readonly rackById: Readonly<Record<string, number>>;
  /** Fallback rack price (any rack id not in `rackById`). */
  readonly rack: number;
  readonly cable: number;
}

export const DEFAULT_PRICE_TABLE: PriceTable = {
  gameCurrency: true,
  serverChassis: 3000,
  perCore: 90,
  perRamGB: 6,
  perBootGB: 1,
  perDriveTB: 250,
  perDrive: 60,
  nicBySpeed: { 1: 80, 10: 250, 25: 450, 100: 1100 },
  nicDefault: 400,
  perNicPort: 40,
  fcHba: 900,
  switchById: { 'sw-generic-48x10g': 5000, 'sw-generic-48x25g': 8500, 'sw-generic-32x100g': 16000, 'sw-generic-48x1g-oob': 1200 },
  switchDefault: 6000,
  rackById: { 'rack-generic-24u': 900, 'rack-generic-42u': 1500, 'rack-generic-48u': 1900 },
  rack: 1500,
  cable: 15,
};

export interface GamePrice {
  readonly amount: number;
  readonly gameCurrency: true;
}

const round = (n: number): number => Math.max(0, Math.round(n));

/** Price of one NIC card part (game value). */
export function nicPrice(catalog: HardwareCatalog, partId: string, table: PriceTable = DEFAULT_PRICE_TABLE): number | undefined {
  const p = catalog.nics.get(partId);
  if (!p) return undefined;
  const fastest = Math.max(...p.speedsGbE);
  return round((table.nicBySpeed[fastest] ?? table.nicDefault) + p.ports * table.perNicPort);
}

/** Price of one drive part (game value). */
export function drivePrice(catalog: HardwareCatalog, partId: string, table: PriceTable = DEFAULT_PRICE_TABLE): number | undefined {
  const d = catalog.drives.get(partId);
  return d ? round(table.perDrive + d.capacityTB * table.perDriveTB) : undefined;
}

/**
 * Price of a server configuration (game value): chassis + cores + RAM + boot + drives + NICs + FC HBA.
 * Unknown part ids add nothing (the model reports them as HW_UNKNOWN_PART – prices never validate).
 */
export function serverConfigPrice(catalog: HardwareCatalog, config: ServerConfig, table: PriceTable = DEFAULT_PRICE_TABLE): number {
  let sum = table.serverChassis + config.sockets * config.coresPerSocket * table.perCore + config.ramGB * table.perRamGB + config.boot.capacityGB * table.perBootGB;
  for (const d of config.drives) sum += d.count * (drivePrice(catalog, d.partId, table) ?? 0);
  for (const n of config.nics) sum += n.count * (nicPrice(catalog, n.partId, table) ?? 0);
  if (config.fcHba) sum += table.fcHba;
  return round(sum);
}

/**
 * Price of a purchasable catalog item id: starter server (15 B.3 id), drive, NIC, switch, rack, generic cable.
 * Server model ids (`bcg-<productId>`) are priced by `serverConfigPrice` of the configuration actually bought.
 * Returns undefined for unknown ids.
 */
export function itemPrice(catalog: HardwareCatalog, itemId: string, table: PriceTable = DEFAULT_PRICE_TABLE): number | undefined {
  if (itemId === CABLE_ITEM_ID) return table.cable;
  const it = catalog.items.get(itemId);
  if (!it) return undefined;
  switch (it.kind) {
    case 'server':
      return serverConfigPrice(catalog, it.config, table);
    case 'drive':
      return drivePrice(catalog, it.id, table);
    case 'nic':
      return nicPrice(catalog, it.id, table);
    case 'switch':
      return round(table.switchById[it.id] ?? table.switchDefault);
    case 'rack':
      return round(table.rackById[it.id] ?? table.rack);
  }
}

export const gamePrice = (amount: number): GamePrice => ({ amount, gameCurrency: true });
