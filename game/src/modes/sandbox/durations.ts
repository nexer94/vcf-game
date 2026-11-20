import type { SandboxTaskKind } from './types';

/**
 * ILUSTRATIVNÍ trvání úloh v herním čase (ms).
 *
 * The documentation (spec 20) does not publish how long binary downloads, validation or the
 * bring-up deployment take. These are game values only, chosen so that the progress is visible at
 * 1x / 4x / 16x. Every task created with them carries `illustrativeDuration: true` and the UI must
 * label them "ilustrativní".
 */
export const ILLUSTRATIVE_TASK_DURATIONS_MS: Readonly<Record<SandboxTaskKind, number>> = {
  'binary-download': 2 * 60_000,
  'binary-validation': 30_000,
  'bringup-validation': 3 * 60_000,
  'bringup-deployment': 2 * 60 * 60_000,
};

export const ILLUSTRATIVE_DURATION_NOTE =
  'Trvání úloh je ilustrativní herní hodnota – dokumentace délku stahování, validace ani nasazení neuvádí.';
