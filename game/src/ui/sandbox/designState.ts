/**
 * SINGLE INTEGRATION POINT between the "Návrh" UI and the place where design
 * choices live.
 *
 * Today: `createLocalDesignState()` keeps the selection in the UI (no rules here –
 * validation is done by the model via designData.ts).
 *
 * When game/src/modes/sandbox (SandboxSession) lands, implement this interface
 * as a thin wrapper:
 *   select(d, o)           -> session.selectDesignOption(d, o)
 *   acknowledgeWarnings(k) -> session.acknowledgeDesignWarnings(...)
 *   selection()/acknowledged() -> read from session snapshot
 *   subscribe(fn)          -> snapshot change notification
 * and pass it to the shell instead of the local state. Phase advance should then
 * go through session.advancePhase() (see sandboxShell.ts `advanceFromDesign`).
 */
export interface DesignStatePort {
  selection(): ReadonlyMap<string, string>;
  /** Keys of acknowledged warnings (IssueView.key). */
  acknowledged(): ReadonlySet<string>;
  /** Player intent; the UI does not validate. */
  select(decisionId: string, optionId: string): void;
  acknowledgeWarnings(keys: readonly string[]): void;
  /** Called after every state change; returns unsubscribe. */
  subscribe(fn: () => void): () => void;
}

export function createLocalDesignState(): DesignStatePort {
  const sel = new Map<string, string>();
  let ack = new Set<string>();
  const subs = new Set<() => void>();
  const emit = (): void => subs.forEach((f) => f());
  return {
    selection: () => sel,
    acknowledged: () => ack,
    select(d, o) {
      if (sel.get(d) === o) return;
      sel.set(d, o);
      // Any design change invalidates earlier acknowledgements (like re-validation in VCF Installer).
      ack = new Set();
      emit();
    },
    acknowledgeWarnings(keys) {
      ack = new Set([...ack, ...keys]);
      emit();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
