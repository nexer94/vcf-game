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
