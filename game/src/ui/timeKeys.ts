/** Pure helpers for the time shortcuts (no DOM - testable in Node). */
import type { GameSpeed } from '../engine';

const SPEEDS: readonly GameSpeed[] = [1, 4, 16];

/** Next speed for ',' (dir -1) / '.' (dir +1); from pause it resumes at 1×. Pure. */
export function stepSpeed(current: GameSpeed, dir: 1 | -1): GameSpeed {
  if (current === 0) return 1;
  const i = SPEEDS.indexOf(current);
  const at = i < 0 ? 0 : i;
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, at + dir))]!;
}

