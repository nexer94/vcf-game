/**
 * Replays commands through the Sandbox reducer (the same rules as a player): the initial state of a Career level – and
 * later of a "Hotový scénář" (pre-built, fully deployed environment) – is built by REPLAYING commands, never by writing
 * state by hand, so every model validation applies (UX 25.6).
 *
 * Timed tasks (binary downloads, ESX installs, bring-up validation / deployment) are completed by advancing the session
 * clock after each command when `completeTasks` is on (default), so a replay can go up to a completed bring-up.
 */
import type { CommandResult, SandboxCommand, SandboxSession } from '../sandbox';

export class ReplayError extends Error {
  constructor(
    readonly index: number,
    readonly command: SandboxCommand,
    readonly result: Extract<CommandResult, { ok: false }>,
  ) {
    super(`replay: command #${index} ${command.type} rejected: ${JSON.stringify(result.rejection)}`);
    this.name = 'ReplayError';
  }
}

export interface ReplayOptions {
  /** Complete running timed tasks after each command (default true). */
  readonly completeTasks?: boolean;
  /** Safety bound of clock steps per command (default 50 × 1 game day). */
  readonly maxSteps?: number;
}

const DAY_MS = 24 * 60 * 60_000;

/** Runs timed tasks to completion (bounded). Returns true when no task is left. */
export function completeRunningTasks(session: SandboxSession, maxSteps = 50): boolean {
  for (let i = 0; i < maxSteps && session.state.tasks.length > 0; i++) session.advance(DAY_MS);
  return session.state.tasks.length === 0;
}

/** Dispatches `commands` in order; throws ReplayError on the first rejection. Returns the results. */
export function replayCommands(session: SandboxSession, commands: readonly SandboxCommand[], opts: ReplayOptions = {}): CommandResult[] {
  const out: CommandResult[] = [];
  commands.forEach((cmd, i) => {
    const r = session.dispatch(cmd);
    if (!r.ok) throw new ReplayError(i, cmd, r);
    out.push(r);
    if (opts.completeTasks !== false && !completeRunningTasks(session, opts.maxSteps)) throw new Error(`replay: tasks after command #${i} ${cmd.type} did not finish`);
  });
  return out;
}
