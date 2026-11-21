/**
 * Common contract of the full-screen object views opened from the server room (UX.md §7.1):
 * Počítač (ui/pc/pcView.ts) and Tabule (ui/whiteboard/whiteboardView.ts). The room screen drives the
 * transition and calls `escape()` before going one level up.
 */
export interface ObjectView {
  /** Transition frame (UX §7.2): alpha 0..1 and the view scale 0.96..1. */
  setTransition(alpha: number, scale: number): void;
  /** Esc inside the view: true = handled (e.g. closed a dialog), false = the room may go one level up. */
  escape(): boolean;
  dispose(): void;
}
