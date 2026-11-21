/**
 * DesignStatePort over the SandboxSession (RoomPort.ops): the right-side panel "Návrh", the phase shell and the
 * computer app share ONE source of truth – the session's design choices. Writes are the commands
 * selectDesignOption / acknowledgeDesignWarnings; the session (model) validates.
 */
import type { DesignDecisionId } from '../../model';
import type { DesignStatePort } from '../sandbox/designState';
import type { RoomPort } from '../sandbox/sessionPort';

export function createSessionDesignState(port: RoomPort, onReject?: (message: string) => void): DesignStatePort | null {
  const ops = port.ops;
  if (!ops) return null;
  let memo: { choices: unknown; ack: unknown; sel: Map<string, string>; acks: Set<string> } | null = null;
  const read = (): NonNullable<typeof memo> => {
    const d = ops.snapshot().design;
    if (!memo || memo.choices !== d.choices || memo.ack !== d.acknowledgedWarningKeys) {
      memo = {
        choices: d.choices,
        ack: d.acknowledgedWarningKeys,
        sel: new Map(Object.entries(d.choices).filter((e): e is [string, string] => typeof e[1] === 'string')),
        acks: new Set(d.acknowledgedWarningKeys),
      };
    }
    return memo;
  };
  return {
    selection: () => read().sel,
    acknowledged: () => read().acks,
    select(d, o) {
      const r = ops.dispatch({ type: 'selectDesignOption', decision: d as DesignDecisionId, option: o });
      if (!r.ok) onReject?.(r.message);
    },
    acknowledgeWarnings(keys) {
      if (!keys.length) return;
      const r = ops.dispatch({ type: 'acknowledgeDesignWarnings', keys });
      if (!r.ok) onReject?.(r.message);
    },
    subscribe(fn) {
      // Only design changes reach the listeners (the session also emits task progress etc.).
      let last = read();
      return port.subscribe(() => {
        const now = read();
        if (now !== last) {
          last = now;
          fn();
        }
      });
    },
  };
}
