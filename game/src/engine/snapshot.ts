/**
 * Read-only snapshot of the game state handed to the render layer each frame.
 * Render must treat it as immutable and never call back into the model directly.
 * Domain parts (topology, tasks, flows...) will be added later.
 */
import type { ClockState } from './clock';

export interface GameSnapshot {
  /** Monotonic counter, incremented on every engine tick. */
  readonly tick: number;
  readonly clock: ClockState;
}
