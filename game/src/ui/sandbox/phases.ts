/**
 * Sandbox phases (UI flow only). Phase content comes from the spec/model later;
 * these texts are navigation labels, not VCF facts.
 */
export const SANDBOX_PHASES = ['navrh', 'priprava', 'deploy'] as const;
export type SandboxPhaseId = (typeof SANDBOX_PHASES)[number];

export interface SandboxPhaseInfo {
  readonly id: SandboxPhaseId;
  readonly title: string;
  readonly subtitle: string;
}

export const SANDBOX_PHASE_INFO: Readonly<Record<SandboxPhaseId, SandboxPhaseInfo>> = {
  navrh: { id: 'navrh', title: 'Návrh', subtitle: 'Architektura prostředí' },
  priprava: { id: 'priprava', title: 'Příprava', subtitle: 'DNS, IP adresy, sítě, hardware' },
  deploy: { id: 'deploy', title: 'Deploy', subtitle: 'VCF Installer, bring-up, workload domény…' },
};

export function isSandboxPhase(s: string): s is SandboxPhaseId {
  return (SANDBOX_PHASES as readonly string[]).includes(s);
}

/**
 * Phase gate for URL / stepper navigation: a phase that is not enterable cannot be
 * opened by typing its hash. Returns `requested` if enterable, otherwise the furthest
 * enterable phase before it (the first phase is always enterable).
 *
 * TODO(SandboxSession): feed `enterable` from the session snapshot
 * (`snapshot.phases[].enterable`) instead of the UI-side design validation.
 */
export function gatePhase(requested: SandboxPhaseId, enterable: (p: SandboxPhaseId) => boolean): SandboxPhaseId {
  const at = SANDBOX_PHASES.indexOf(requested);
  if (at <= 0 || enterable(requested)) return requested;
  for (let i = at - 1; i > 0; i--) {
    const p = SANDBOX_PHASES[i]!;
    if (enterable(p)) return p;
  }
  return SANDBOX_PHASES[0];
}

/**
 * Sandbox v2 flow as shown to the player (CLAUDE.md "Sandbox"): navigation labels
 * and game blurbs only, no VCF facts. The phase shell above still covers the
 * Návrh → Příprava → Deploy part until the room-based phases exist.
 */
export const SANDBOX_FLOW_V2: readonly { readonly title: string; readonly blurb: string }[] = [
  { title: 'Stavba', blurb: 'kup a postav racky, servery a switche, zapoj kabely.' },
  { title: 'Hosty', blurb: 'připrav hosty a zapoj je do sítě – v místnosti se rozběhne provoz.' },
  { title: 'Use case', blurb: 'vyber, co nasazuješ – stejně jako v průvodci instalace.' },
  { title: 'Návrh', blurb: 'návrhová rozhodnutí s odkazy na dokumentaci.' },
  { title: 'Deploy', blurb: 'nasazení krok za krokem, validace a sledování úloh.' },
];
