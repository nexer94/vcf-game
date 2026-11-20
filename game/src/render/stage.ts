import { Application } from 'pixi.js';
import type { GameEngine, GameSnapshot } from '../engine';
import { fitRect, type Camera } from './camera';
import { createDemoTopology } from './demo/demoTopology';
import { DemoTrafficSource } from './demo/demoTraffic';
import { DatacenterScene } from './scene/datacenterScene';

/**
 * - backdrop: slow automatic drift, no interaction, labels hidden (menu background)
 * - interactive: a screen drives the camera via setCamera() and frame hooks
 * - off: ticker stopped, canvas hidden (no GPU work behind DOM-only screens)
 */
export type StageMode = 'backdrop' | 'interactive' | 'off';

export type FrameHook = (snapshot: GameSnapshot, realDeltaMs: number, fps: number) => void;

/** Drift period of the menu backdrop camera (ms). */
const BACKDROP_PERIOD_MS = 60_000;
const BACKDROP_DRIFT_PX = 60;
const BACKDROP_ZOOM = 1.25;

/**
 * Single PixiJS application shared by all screens (WebGL context is created once).
 * Currently hosts the illustrative datacenter traffic scene.
 */
export class SceneStage {
  private mode: StageMode = 'off';
  private readonly hooks = new Set<FrameHook>();
  private backdropMs = 0;

  private constructor(
    readonly app: Application,
    readonly scene: DatacenterScene,
    private readonly engine: GameEngine,
  ) {
    app.ticker.add((ticker) => this.frame(ticker.deltaMS, ticker.FPS));
  }

  static async create(host: HTMLElement, engine: GameEngine): Promise<SceneStage> {
    const dpr = window.devicePixelRatio || 1;
    const app = new Application();
    await app.init({
      background: '#0f141b',
      resizeTo: host,
      // MSAA only on low-DPR screens; on HiDPI the extra pixels already smooth edges
      // and MSAA would multiply fill-rate cost on weak GPUs (Chromebooks).
      antialias: dpr < 1.5,
      // Cap DPR: crisp enough, cheap on weak GPUs.
      resolution: Math.min(dpr, 1.5),
      autoDensity: true,
      powerPreference: 'high-performance',
    });
    app.canvas.classList.add('stage-canvas');
    host.appendChild(app.canvas);
    // DEMO data source - replaced by engine snapshot data once traffic is simulated there.
    const scene = new DatacenterScene(app.renderer, createDemoTopology(), new DemoTrafficSource());
    app.stage.addChild(scene.world);
    const stage = new SceneStage(app, scene, engine);
    stage.setMode('off');
    return stage;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  setMode(mode: StageMode): void {
    this.mode = mode;
    this.app.canvas.style.visibility = mode === 'off' ? 'hidden' : 'visible';
    if (mode === 'off') {
      this.app.ticker.stop();
      return;
    }
    this.scene.setDetailVisible(false);
    if (mode === 'backdrop') this.engine.setSpeed(1);
    this.app.ticker.start();
  }

  /** Camera that fits the whole scene into the current screen. */
  fit(padding = 60): Camera {
    return fitRect(this.scene.layout.bounds, this.app.screen.width, this.app.screen.height, padding);
  }

  setCamera(cam: Camera): void {
    this.scene.world.position.set(cam.x, cam.y);
    this.scene.world.scale.set(cam.scale);
  }

  /** Per-frame callback (after the scene update). Returns an unsubscribe function. */
  onFrame(hook: FrameHook): () => void {
    this.hooks.add(hook);
    return () => this.hooks.delete(hook);
  }

  private frame(realMs: number, fps: number): void {
    // NOTE: the engine is ticked here only while a scene is visible. When the sandbox
    // gets a live simulation, engine ticking moves to a render-independent loop.
    this.engine.tick(Math.min(realMs, 100));
    const snap = this.engine.snapshot();
    this.scene.update(snap, realMs);
    if (this.mode === 'backdrop') this.driftBackdrop(realMs);
    for (const h of this.hooks) h(snap, realMs, fps);
  }

  private driftBackdrop(realMs: number): void {
    this.backdropMs = (this.backdropMs + realMs) % BACKDROP_PERIOD_MS;
    const a = (this.backdropMs / BACKDROP_PERIOD_MS) * Math.PI * 2;
    const base = this.fit(20);
    const scale = base.scale * BACKDROP_ZOOM;
    const { width, height } = this.app.screen;
    // Zoom around the screen centre, then drift on a slow ellipse.
    this.setCamera({
      x: width / 2 - (width / 2 - base.x) * BACKDROP_ZOOM + Math.cos(a) * BACKDROP_DRIFT_PX,
      y: height / 2 - (height / 2 - base.y) * BACKDROP_ZOOM + Math.sin(a) * BACKDROP_DRIFT_PX * 0.5,
      scale,
    });
  }
}
