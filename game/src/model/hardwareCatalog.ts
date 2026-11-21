/**
 * Synchronous hardware catalog with the repository BCG dataset (spec 15 Příloha B, [H9]).
 *
 * Statically imports the BCG JSON (~360 kB) through './bcgDataset'. Code that wants the dataset in a lazy chunk uses
 * `loadHardwareCatalog()` from './hardwareCatalogCore' instead and must not import this module (or './bcgDataset')
 * statically. Everything else (types, parts, starter definitions, `buildHardwareCatalogFrom`, `loadHardwareCatalog`)
 * is re-exported from the core.
 */
import { BCG_DATASET, type BcgDataset } from './bcgDataset';
import { type HardwareCatalog, buildHardwareCatalogFrom } from './hardwareCatalogCore';

export * from './hardwareCatalogCore';

/** Builds the catalog from a BCG dataset (default: the repository dataset). Pure. */
export function buildHardwareCatalog(dataset: BcgDataset = BCG_DATASET): HardwareCatalog {
  return buildHardwareCatalogFrom(dataset);
}
