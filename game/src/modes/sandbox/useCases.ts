/**
 * Use cases of the VCF Installer / paths to a 9.1.x environment (docs/spec/25-usecases-and-physical.md §2.1, §4.9).
 *
 * The Sandbox only RECORDS the player's choice (id + spec reference) – no VCF rule depends on it yet. Which use cases
 * the game can actually play through is a GAME-SCOPE fact (`modelled`), not a VCF fact:
 *  - UC-1 "new VCF fleet" = the modelled bring-up (wizard "Deploy a new VCF fleet", workflowType VCF).
 *  - UC-5 / UC-6 convergence: the model reports its own game-scope limitation (CONVERGENCE_NOT_MODELLED via
 *    validateExistingComponents with an existing vCenter) – passed through unchanged.
 *  - the rest: not modelled; the model has no issue code for that yet (reported to the orchestrator), so the view
 *    only carries `modelled: false` + a Czech game note.
 *
 * Pure TypeScript: no DOM, no PixiJS.
 */
import { type BringupSpec, type ValidationIssue, validateExistingComponents } from '../../model';

export const USE_CASE_IDS = ['UC-1', 'UC-2', 'UC-3', 'UC-4', 'UC-5', 'UC-6', 'UC-7', 'UC-8', 'UC-9', 'UC-10'] as const;
export type UseCaseId = (typeof USE_CASE_IDS)[number];

export const isUseCaseId = (v: unknown): v is UseCaseId => typeof v === 'string' && (USE_CASE_IDS as readonly string[]).includes(v);

export interface UseCaseDef {
  readonly id: UseCaseId;
  /** Use case name as in 25 §2.1 (English VCF terms). */
  readonly title: string;
  /** Spec reference of the catalog row. */
  readonly specRef: string;
  /** Official page (techdocs) cited by the spec row. */
  readonly url: string;
  /** GAME SCOPE: the Sandbox can play this path through (not a VCF fact). */
  readonly modelled: boolean;
}

const U1 = 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/overview-of-deploy--converge--and-upgrade.html';
const U4 = 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-a-new-vcf-fleet-or-a-new-vcf-instance.html';

/** Catalog 25 §2.1 (9.1.1). */
export const USE_CASES: readonly UseCaseDef[] = [
  { id: 'UC-1', title: 'New VCF fleet (greenfield)', specRef: '25 §2.1, §4.1 [U4][U3]', url: U4, modelled: true },
  { id: 'UC-2', title: 'New VCF Instance in an existing fleet', specRef: '25 §2.1 [U4]', url: U4, modelled: false },
  {
    id: 'UC-3',
    title: 'New VVF (with VCF management services)',
    specRef: '25 §2.1, §4.2 [U5]',
    url: 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-vmware-vsphere-foundation-using-the-deployment-wizard.html',
    modelled: false,
  },
  {
    id: 'UC-4',
    title: 'VVF 9.1 without VCF management services',
    specRef: '25 §2.1, §4.3 [U6]',
    url: 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-vmware-vsphere-foundation-using-the-deployment-wizard/deploying-vmware-vsphere-foundation-9-1-without-vcf-management-services.html',
    modelled: false,
  },
  {
    id: 'UC-5',
    title: 'Convergence to VCF (new fleet or new instance)',
    specRef: '25 §2.1, §4.4 [U1][U7][U9]',
    url: 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/supported-scenarios-to-converge-to-vcf/converge-your-existing-vcenter-instance-and-esx-hosts.html',
    modelled: false,
  },
  {
    id: 'UC-6',
    title: 'Convergence to VVF 9.1',
    specRef: '25 §2.1, §4.5 [U8]',
    url: 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/converging-your-existing-vsphere-infrastructure-to-a-vcf-or-vvf-platform-/use-existing-vsphere-infrastructure-to-create-a-vmware-vsphere-foundation-environment-using-the-deployment-wizard.html',
    modelled: false,
  },
  {
    id: 'UC-7',
    title: 'Finish the VVF upgrade to 9.1 – deploy VCF management services',
    specRef: '25 §2.1, §4.6 [U14][U2]',
    url: 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-your-vsphere-foundation-to-9-1/install-vcf-management-services-to-vsphere-foundation-environment.html',
    modelled: false,
  },
  {
    id: 'UC-8',
    title: 'Deferred components (custom networking)',
    specRef: '25 §2.1; 20-deployment §4.5 [S17]',
    url: 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploying-vcf-operations-and-vcf-automation-on-custom-networking.html',
    modelled: false,
  },
  {
    id: 'UC-9',
    title: 'Upgrade vSphere 8 (+ Aria Operations 8) to 9.1, converge later',
    specRef: '25 §2.1, §4.7 [U12]',
    url: 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-your-vsphere-foundation-to-9-1/upgrade-to-91-from-vsphere-8-and-aria-8-environments(1).html',
    modelled: false,
  },
  { id: 'UC-10', title: 'Upgrade VCF 5.2.x / 9.0.x and VVF to 9.1.x', specRef: '25 §2.1 [U1][U13]', url: U1, modelled: false },
];

export const useCaseDef = (id: UseCaseId): UseCaseDef => USE_CASES.find((u) => u.id === id) as UseCaseDef;

/** Stored choice (SandboxState.useCase): id + spec reference only. */
export interface UseCaseChoice {
  readonly id: UseCaseId;
  readonly specRef: string;
}

export interface UseCaseView extends UseCaseDef {
  /** Game-scope limitations from the model (scope 'game-scope'), passed through unchanged. */
  readonly limitations: readonly ValidationIssue[];
  /** Czech game note for `modelled: false` (not a VCF fact). */
  readonly gameScopeNote?: string;
}

export const USE_CASE_NOT_MODELLED_NOTE = 'Herní omezení: tuhle cestu hra zatím nesimuluje (není to chyba VCF). Hratelný je zatím jen UC-1 – nová VCF fleet.';

/** Snapshot view of the chosen use case. */
export function useCaseView(choice: UseCaseChoice, spec: BringupSpec): UseCaseView {
  const def = useCaseDef(choice.id);
  // Convergence (existing vCenter): the model's own game-scope limitation.
  const limitations =
    choice.id === 'UC-5' || choice.id === 'UC-6'
      ? validateExistingComponents({ ...spec, target: 'new-fleet', existing: { ...spec.existing, existingVcenter: true } }).filter((i) => i.scope === 'game-scope')
      : [];
  return { ...def, specRef: choice.specRef, limitations, ...(def.modelled ? {} : { gameScopeNote: USE_CASE_NOT_MODELLED_NOTE }) };
}
