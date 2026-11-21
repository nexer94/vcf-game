/**
 * Engine-owned real-time loop: ticks the GameEngine independently of any renderer, so game time (and
 * Sandbox tasks) keep progressing even when the PixiJS stage is stopped ('off' mode, DOM-only screens).
 *
 * DOM-free: the frame scheduler is injected by the app layer (e.g. requestAnimationFrame in main.ts,
 * a fake scheduler in tests).
 */
import type { GameEngine } from './engine';

export interface FrameScheduler {
  /** Request a callback on the next frame; `nowMs` is a monotonic timestamp in ms. */
  request(callback: (nowMs: number) => void): number;
  cancel(handle: number): void;
}

export interface EngineLoopOptions {
  /**
   * Upper bound of a single real-time step (ms). Long gaps (background tab, debugger) are clamped so
   * the simulation does not jump. Default 100 ms.
   */
  readonly maxDeltaMs?: number;
}

export interface EngineLoop {
  stop(): void;
  readonly running: boolean;
}

export function startEngineLoop(engine: Pick<GameEngine, 'tick'>, scheduler: FrameScheduler, options: EngineLoopOptions = {}): EngineLoop {
  const maxDelta = options.maxDeltaMs ?? 100;
  let last: number | undefined;
  let handle: number | undefined;
  let running = true;

  const frame = (now: number): void => {
    if (!running) return;
    if (last !== undefined) {
      const delta = Math.min(Math.max(0, now - last), maxDelta);
      if (Number.isFinite(delta)) engine.tick(delta);
    }
    last = now;
    handle = scheduler.request(frame);
  };
  handle = scheduler.request(frame);

  return {
    stop(): void {
      running = false;
      if (handle !== undefined) scheduler.cancel(handle);
      handle = undefined;
    },
    get running(): boolean {
      return running;
    },
  };
}
