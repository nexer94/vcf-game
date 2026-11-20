/**
 * Generic timed tasks ("úlohy s průběhem"): long-running actions such as a binary download or a
 * bring-up deployment. Pure and immutable: `advanceTimedTasks` returns new task objects.
 *
 * Durations are always supplied by the caller. The VCF documentation does not publish durations,
 * so callers must mark game values with `illustrativeDuration: true` (UI shows them as "ilustrativní").
 */

export interface TimedTask<K extends string = string, P = unknown> {
  readonly id: string;
  readonly kind: K;
  /** Short human-readable label for task lists. */
  readonly label: string;
  /** Total game-time duration in ms (> 0). */
  readonly durationMs: number;
  /** Game time already spent on the task. */
  readonly elapsedMs: number;
  /** Game time at which the task started. */
  readonly startedAtMs: number;
  /** True if `durationMs` is an illustrative game value, not a documented fact. */
  readonly illustrativeDuration: boolean;
  /** Domain data needed when the task completes. */
  readonly payload: P;
}

export function createTimedTask<K extends string, P>(init: {
  readonly id: string;
  readonly kind: K;
  readonly label: string;
  readonly durationMs: number;
  readonly startedAtMs: number;
  readonly illustrativeDuration: boolean;
  readonly payload: P;
}): TimedTask<K, P> {
  if (!Number.isFinite(init.durationMs) || init.durationMs <= 0) {
    throw new RangeError(`Invalid task duration: ${String(init.durationMs)}`);
  }
  return { ...init, elapsedMs: 0 };
}

/** Progress in [0, 1]. */
export function taskProgress(task: TimedTask): number {
  return Math.min(1, task.elapsedMs / task.durationMs);
}

export function taskRemainingMs(task: TimedTask): number {
  return Math.max(0, task.durationMs - task.elapsedMs);
}

/**
 * Advances all tasks in parallel by a game-time delta. Tasks that reach their duration are returned
 * in `completed` (in input order) and removed from `running`. A zero delta (paused clock) is a no-op.
 */
export function advanceTimedTasks<T extends TimedTask>(
  tasks: readonly T[],
  gameDeltaMs: number,
): { readonly running: T[]; readonly completed: T[] } {
  if (!Number.isFinite(gameDeltaMs) || gameDeltaMs < 0) {
    throw new RangeError(`Invalid game delta: ${String(gameDeltaMs)}`);
  }
  if (gameDeltaMs === 0) return { running: [...tasks], completed: [] };
  const running: T[] = [];
  const completed: T[] = [];
  for (const t of tasks) {
    const next = { ...t, elapsedMs: Math.min(t.durationMs, t.elapsedMs + gameDeltaMs) };
    (next.elapsedMs >= next.durationMs ? completed : running).push(next);
  }
  return { running, completed };
}
