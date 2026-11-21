/**
 * Parser of the "Zdroje" (sources) sections of docs/spec/*.md and of spec references used in game data
 * (`specRef: "10-planning §3.3 [P19]"`, `"06 §2.2, §6.1 [B6][B7]"`, `"25 §10.6 [U68]; 20 §4.1.1 [S8]"`) – UX ch. 21.2.
 *
 * Source lines (two formats exist in the spec):
 *   - [ID] Title: https://…
 *   - [ID]: https://… – Title
 * Only lines inside a section whose heading contains "Zdroje" are read; lines without a URL (e.g. "(už výše)") are
 * skipped. IDs are unique per spec file only -> registry key `file:ID` (e.g. `10-planning:P19`).
 *
 * Self-contained (no imports) so that scripts/gen-source-registry.ts can run it with plain Node.
 */

export type SourceDomain = 'techdocs' | 'knowledge' | 'compatibilityguide' | 'developer' | 'ports' | 'other';

export interface SpecSource {
  /** Registry key `file:ID`. */
  readonly key: string;
  /** Spec file name without extension, e.g. "10-planning". */
  readonly file: string;
  /** Source id inside the file, e.g. "P19". */
  readonly id: string;
  /** Page title as written in the spec (may be empty when the spec gives only a URL). */
  readonly title: string;
  readonly url: string;
  readonly domain: SourceDomain;
}

const SOURCE_LINE = /^\s*[-*]\s*\[([A-Z]{1,4}\d+[a-z]?)\]:?\s*(.*)$/;
const URL_RE = /https?:\/\/[^\s)>\]]+/;

export function domainOf(url: string): SourceDomain {
  const host = /^https?:\/\/([^/?#:]+)/.exec(url)?.[1]?.toLowerCase() ?? '';
  if (host === 'techdocs.broadcom.com') return 'techdocs';
  if (host === 'knowledge.broadcom.com') return 'knowledge';
  if (host === 'compatibilityguide.broadcom.com') return 'compatibilityguide';
  if (host === 'developer.broadcom.com') return 'developer';
  if (host === 'ports.broadcom.com') return 'ports';
  return 'other';
}

const clean = (t: string): string =>
  t
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '')
    .replace(/`/g, '')
    .trim();

/** Parses the sources of one spec file (`file` = name without .md). First occurrence of an id wins. */
export function parseSpecSources(file: string, markdown: string): SpecSource[] {
  const out: SpecSource[] = [];
  const seen = new Set<string>();
  let inSources = false;
  for (const line of markdown.split(/\r?\n/)) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      inSources = /zdroj/i.test(h[2] ?? '');
      continue;
    }
    if (!inSources) continue;
    const m = SOURCE_LINE.exec(line);
    if (!m) continue;
    const id = m[1]!;
    const rest = m[2] ?? '';
    const u = URL_RE.exec(rest);
    if (!u || seen.has(id)) continue;
    const url = u[0].replace(/[.,;]+$/, '');
    const before = clean(rest.slice(0, u.index));
    const after = clean(rest.slice(u.index + u[0].length));
    seen.add(id);
    out.push({ key: `${file}:${id}`, file, id, title: before || after, url, domain: domainOf(url) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// specRef parsing
// ---------------------------------------------------------------------------

export interface ParsedSpecRef {
  /** Spec sections mentioned: file (full name when resolvable, else the short "NN") + "§x.y" list. */
  readonly sections: readonly { readonly file: string; readonly section: string }[];
  /** Registry keys `file:ID` in order of appearance (deduplicated). */
  readonly keys: readonly string[];
}

/** Bracket tags that are not source ids (trust levels / markers of the spec). */
const NON_SOURCE = /^(?:[A-Z]+|\d+\.\d+(?:\.\d+)?|9\.\d)$/;

/**
 * Parses a spec reference. `files` = known spec file names (e.g. "10-planning") to resolve short prefixes ("10");
 * `defaultFile` applies to ids before any file prefix.
 */
export function parseSpecRef(ref: string, files: readonly string[], defaultFile?: string): ParsedSpecRef {
  const resolve = (token: string): string => files.find((f) => f === token || f.startsWith(`${token}-`)) ?? token;
  const sections: { file: string; section: string }[] = [];
  const keys: string[] = [];
  let file = defaultFile;
  const tokenRe = /(\b\d{2}(?:-[a-z0-9-]+)?\b)|(§\s?[\d.]+[a-z]?)|\[([^\]]+)\]/g;
  for (const m of ref.matchAll(tokenRe)) {
    if (m[1] !== undefined) {
      // a spec file prefix only when followed (eventually) by § or [ – "06 §2.2", "10-planning §3.3"
      file = resolve(m[1]);
    } else if (m[2] !== undefined) {
      if (file !== undefined) sections.push({ file, section: m[2].replace(/\s/g, '') });
    } else if (m[3] !== undefined) {
      for (const raw of m[3].split(/[,\s]+/)) {
        const id = raw.trim();
        if (!/^[A-Z]{1,4}\d+[a-z]?$/.test(id) || NON_SOURCE.test(id) || file === undefined) continue;
        const k = `${file}:${id}`;
        if (!keys.includes(k)) keys.push(k);
      }
    }
  }
  return { sections, keys };
}

// ---------------------------------------------------------------------------
// Registry build (scripts/gen-source-registry.ts and the sync test)
// ---------------------------------------------------------------------------

export interface SourceRegistryData {
  readonly version: 1;
  /** Spec file names (without .md), sorted. */
  readonly files: readonly string[];
  readonly sources: readonly SpecSource[];
}

/** File system access is injected (no Node imports here – the core tsconfig has no node types). */
export interface FsLike {
  readdirSync(dir: string): string[];
  readFileSync(path: string, enc: 'utf8'): string;
}

export function buildRegistryFromDir(specDir: string, fs: FsLike): SourceRegistryData {
  const files = fs
    .readdirSync(specDir)
    .filter((f) => /^\d{2}-.*\.md$/.test(f))
    .sort();
  const sources = files.flatMap((f) => parseSpecSources(f.replace(/\.md$/, ''), fs.readFileSync(`${specDir}/${f}`, 'utf8')));
  return { version: 1, files: files.map((f) => f.replace(/\.md$/, '')), sources };
}
