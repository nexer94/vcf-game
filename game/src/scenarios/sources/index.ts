/**
 * Readable documentation sources for the UI (UX ch. 21 "Zdroj" popover): instead of `[P13]` the player sees the page
 * title with a domain prefix ("Dokumentace: Physical Data Center Network Design (9.1)").
 *
 * Data: sourceRegistry.json, generated from the "Zdroje" sections of docs/spec/*.md (`npm run gen:sources`; a test
 * fails when it is out of date). Pure module – no DOM, no PixiJS.
 */
import registryJson from './sourceRegistry.json';
import { type ParsedSpecRef, type SourceDomain, type SourceRegistryData, type SpecSource, parseSpecRef } from './specSources';

export type { ParsedSpecRef, SourceDomain, SourceRegistryData, SpecSource } from './specSources';
export { domainOf, parseSpecRef, parseSpecSources } from './specSources';

export const SOURCE_REGISTRY: SourceRegistryData = registryJson as SourceRegistryData;
const BY_KEY: ReadonlyMap<string, SpecSource> = new Map(SOURCE_REGISTRY.sources.map((s) => [s.key, s]));

/** Czech prefix of a source title by its domain (UX 21.1). */
export const SOURCE_DOMAIN_PREFIX: Readonly<Record<SourceDomain, string>> = {
  techdocs: 'Dokumentace',
  knowledge: 'Znalostní báze',
  compatibilityguide: 'Broadcom Compatibility Guide',
  developer: 'API',
  ports: 'Porty a protokoly',
  other: 'Odkaz',
};

/** Source by registry key `file:ID` (e.g. "10-planning:P19"). */
export const sourceByKey = (key: string): SpecSource | undefined => BY_KEY.get(key);

export interface SourceLink {
  readonly key: string;
  /** "Dokumentace: <title>" – never contains the bracket id. */
  readonly label: string;
  readonly title: string;
  readonly url: string;
  readonly domain: SourceDomain;
}

export function sourceLink(s: SpecSource): SourceLink {
  const title = s.title || s.url;
  return { key: s.key, label: `${SOURCE_DOMAIN_PREFIX[s.domain]}: ${title}`, title, url: s.url, domain: s.domain };
}

export interface ResolvedSpecRef {
  /** Readable links (first `max`, default 3 – UX 21.1). */
  readonly links: readonly SourceLink[];
  /** Links beyond `max` ("+2 další v Knihovně"). */
  readonly more: number;
  /** Small grey line for verification, without bracket ids: "spec 06 §2.2 · 10 §3.3". */
  readonly specLine: string;
  /** Keys not found in the registry (dev build: red badge "chybí zdroj"; player build: omit). */
  readonly unknownKeys: readonly string[];
  readonly parsed: ParsedSpecRef;
}

const shortFile = (f: string): string => /^(\d{2})/.exec(f)?.[1] ?? f;

/**
 * Resolves a spec reference string (or several) to readable links. `defaultFile` = spec file of ids without a file
 * prefix (e.g. when the ref is "[U68]" inside data about 25-usecases-and-physical).
 */
export function resolveSpecRef(ref: string | readonly string[], opts: { readonly defaultFile?: string; readonly max?: number } = {}): ResolvedSpecRef {
  const refs = typeof ref === 'string' ? [ref] : ref;
  const sections: { file: string; section: string }[] = [];
  const keys: string[] = [];
  for (const r of refs) {
    const p = parseSpecRef(r, SOURCE_REGISTRY.files, opts.defaultFile);
    sections.push(...p.sections);
    for (const k of p.keys) if (!keys.includes(k)) keys.push(k);
  }
  const found = keys.map((k) => BY_KEY.get(k)).filter((s): s is SpecSource => s !== undefined);
  const unknownKeys = keys.filter((k) => !BY_KEY.has(k));
  const max = opts.max ?? 3;
  const links = found.slice(0, max).map(sourceLink);
  const bySpec = new Map<string, string[]>();
  for (const s of sections) bySpec.set(shortFile(s.file), [...(bySpec.get(shortFile(s.file)) ?? []), s.section]);
  const specLine = bySpec.size ? `spec ${[...bySpec.entries()].map(([f, secs]) => `${f} ${[...new Set(secs)].join(', ')}`).join(' · ')}` : '';
  return { links, more: Math.max(0, found.length - max), specLine, unknownKeys, parsed: { sections, keys } };
}

/** Links for explicit registry keys (`ObjectiveBubble.sourceKeys`). */
export function sourceLinksForKeys(keys: readonly string[]): { readonly links: readonly SourceLink[]; readonly unknownKeys: readonly string[] } {
  return { links: keys.map((k) => BY_KEY.get(k)).filter((s): s is SpecSource => s !== undefined).map(sourceLink), unknownKeys: keys.filter((k) => !BY_KEY.has(k)) };
}

/** Removes bracket source ids ("[P19]", "[B6][B7]") from a text shown to the player (UX P5). */
export const stripSourceIds = (text: string): string => text.replace(/\s*\[[A-Z]{1,4}\d+[a-z]?\]/g, '').replace(/\s{2,}/g, ' ').trim();
