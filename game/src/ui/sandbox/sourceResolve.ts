/** Pure resolution of documentation sources for the "Zdroj" popover (UX 21) – no DOM, unit-tested. */
import { resolveSpecRef, sourceLinksForKeys, type SourceLink } from '../../scenarios/sources';

export interface SourceSpec {
  /** Spec reference(s) as used in game data ("10-planning §3.3 [P19]"). */
  readonly specRef?: string | readonly string[];
  /** Explicit registry keys (`ObjectiveBubble.sourceKeys`). */
  readonly keys?: readonly string[];
  /** Extra direct link (e.g. BCG page of a server model) shown first. */
  readonly extra?: { readonly label: string; readonly url: string };
  /** Default spec file for ids without a file prefix. */
  readonly defaultFile?: string;
  /** "Proč to platí" – 1–2 sentences (paraphrase). */
  readonly why?: string;
  /** Rule code (e.g. VCF-NET-REQD-TOR-001). */
  readonly rule?: string;
}

export interface ResolvedSources {
  readonly links: readonly SourceLink[];
  readonly more: number;
  readonly specLine: string;
  readonly unknown: number;
}

export function resolveSources(s: SourceSpec): ResolvedSources {
  const fromRef = s.specRef ? resolveSpecRef(s.specRef, { ...(s.defaultFile ? { defaultFile: s.defaultFile } : {}), max: 99 }) : null;
  const fromKeys = s.keys?.length ? sourceLinksForKeys(s.keys) : null;
  const all: SourceLink[] = [];
  if (s.extra) all.push({ key: `extra:${s.extra.url}`, label: s.extra.label, title: s.extra.label, url: s.extra.url, domain: 'compatibilityguide' });
  for (const l of [...(fromKeys?.links ?? []), ...(fromRef?.links ?? [])]) if (!all.some((x) => x.url === l.url)) all.push(l);
  return {
    links: all.slice(0, 3),
    more: Math.max(0, all.length - 3),
    specLine: fromRef?.specLine ?? '',
    unknown: (fromRef?.unknownKeys.length ?? 0) + (fromKeys?.unknownKeys.length ?? 0),
  };
}

/** True when there is anything to show. */
export const hasSources = (s: SourceSpec): boolean => {
  const r = resolveSources(s);
  return r.links.length > 0 || r.specLine !== '';
};

