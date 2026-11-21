import type { GameEngine } from '../../engine';
import type { SceneStage, StageMode, StageScene } from '../../render/stage';
import type { Route } from '../router';

/** Shared services handed to every screen. */
export interface AppContext {
  readonly stage: SceneStage;
  readonly engine: GameEngine;
  navigate(route: Route): void;
}

/** A mounted screen. Created by a ScreenFactory, disposed on navigation. */
export interface MountedScreen {
  /** Called when the route changes but stays on the same screen (e.g. sandbox phase). */
  update?(route: Route): void;
  dispose(): void;
}

export interface ScreenDef {
  /** What the shared PixiJS stage does behind this screen. */
  readonly stageMode: StageMode;
  /** Which world the stage shows behind this screen (default: datacenter). */
  readonly stageScene?: StageScene;
  mount(root: HTMLElement, ctx: AppContext, route: Route): MountedScreen;
}

/** Hook Escape -> callback; returns cleanup. */
export function onEscape(fn: () => void): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') fn();
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
