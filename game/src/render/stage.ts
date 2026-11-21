import { Application } from 'pixi.js';
import type { GameEngine, GameSnapshot } from '../engine';
import { fitRect, type Camera } from './camera';
import { createDemoTopology } from './demo/demoTopology';
import { DemoTrafficSource } from './demo/demoTraffic';
import { loadRoomDemo } from './room/roomDemo';
import { RoomScene } from './room/roomScene';
import { ROOM_BG } from './room/palette';
import { DatacenterScene } from './scene/datacenterScene';

/**
 * - backdrop: slow automatic drift, no interaction, labels hidden (menu background)
 * - interactive: a screen drives the camera via setCamera() and frame hooks
 * - off: ticker stopped, canvas hidden (no GPU work behind DOM-only screens)
 */
export type StageMode = 'backdrop' | 'interactive' | 'off';

/** Which world the stage shows: the old dark datacenter prototype or the cosy Sandbox room. */
export type StageScene = 'datacenter' | 'room';

const BACKGROUND: Readonly<Record<StageScene, number>> = { datacenter: 0x0f141b, room: ROOM_BG };

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
  private active: StageScene = 'datacenter';

  private constructor(
    readonly app: Application,
    readonly scene: DatacenterScene,
    readonly room: RoomScene,
    private readonly engine: GameEngine,
  ) {
    room.world.visible = false;
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
    const room = new RoomScene(app.renderer);
    app.stage.addChild(scene.world, room.world);
    const stage = new SceneStage(app, scene, room, engine);
    stage.setMode('off');
    return stage;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get activeScene(): StageScene {
    return this.active;
  }

  /** Switch the visible world (also sets the canvas background colour). */
  setScene(which: StageScene): void {
    this.active = which;
    this.scene.world.visible = which === 'datacenter';
    this.room.world.visible = which === 'room';
    this.app.renderer.background.color = BACKGROUND[which];
  }

  /** Menu backdrop: the cosy room with illustrative demo furniture. */
  showRoomBackdrop(): void {
    loadRoomDemo(this.room);
    this.setScene('room');
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
    const bounds = this.active === 'room' ? this.room.bounds : this.scene.layout.bounds;
    return fitRect(bounds, this.app.screen.width, this.app.screen.height, padding);
  }

  setCamera(cam: Camera): void {
    const world = this.active === 'room' ? this.room.world : this.scene.world;
    world.position.set(cam.x, cam.y);
    world.scale.set(cam.scale);
    if (this.active === 'room') this.room.setViewScale(cam.scale, this.app.renderer.resolution);
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
    if (this.active === 'room') this.room.update(snap, realMs);
    else this.scene.update(snap, realMs);
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
