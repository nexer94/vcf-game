import { Application } from 'pixi.js';
import { GameEngine } from './engine';
import { attachCameraControls, fitRect, zoomLevelForScale, type Camera } from './render';
import { createDemoTopology } from './render/demo/demoTopology';
import { DemoTrafficSource } from './render/demo/demoTraffic';
import { DatacenterScene } from './render/scene/datacenterScene';
import { createHud, createLegend, createLinkTooltip, createTimeControls } from './ui';
import './ui/styles.css';

/** Hover tooltip refresh rate (DOM writes are throttled). */
const TOOLTIP_INTERVAL_MS = 200;
/** Hit-test tolerance for cables, in screen px. */
const HOVER_TOLERANCE_PX = 8;
/** Device labels shown only from this zoom on (LOD). */
const DETAIL_MIN_SCALE = 0.9;

async function bootstrap(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) throw new Error('#app element not found');
  host.style.position = 'relative';

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
  host.appendChild(app.canvas);

  const engine = new GameEngine(1);

  // DEMO data source - replaced by engine snapshot data once traffic is simulated there.
  const scene = new DatacenterScene(app.renderer, createDemoTopology(), new DemoTrafficSource());
  app.stage.addChild(scene.world);

  const uiRoot = document.createElement('div');
  uiRoot.className = 'ui-root';
  host.appendChild(uiRoot);
  const hud = createHud(uiRoot);
  createLegend(uiRoot);
  const time = createTimeControls(uiRoot, engine);
  const tooltip = createLinkTooltip(uiRoot);

  const applyCamera = (cam: Camera): void => {
    scene.world.position.set(cam.x, cam.y);
    scene.world.scale.set(cam.scale);
    scene.setDetailVisible(cam.scale >= DETAIL_MIN_SCALE);
  };
  const fit = (): Camera => fitRect(scene.layout.bounds, app.screen.width, app.screen.height, 60);

  let hover: { sx: number; sy: number; wx: number; wy: number } | null = null;
  let tooltipAge = Infinity;
  const camera = attachCameraControls({
    element: app.canvas,
    initial: fit(),
    onChange: applyCamera,
    onHover: (pos) => {
      hover = pos;
      tooltipAge = Infinity; // refresh immediately on movement
    },
  });
  app.canvas.addEventListener('dblclick', () => camera.set(fit()));

  app.ticker.add((ticker) => {
    const real = ticker.deltaMS;
    engine.tick(Math.min(real, 100));
    const snap = engine.snapshot();
    scene.update(snap, real);
    time.update(snap);

    // Hover detail.
    const cam = camera.camera;
    const hit = hover ? scene.hitTestCable(hover.wx, hover.wy, HOVER_TOLERANCE_PX / cam.scale) : null;
    scene.setHovered(hit?.spec.id ?? null);
    tooltipAge += real;
    if (!hit || !hover) {
      tooltip.hide();
      app.canvas.style.cursor = app.canvas.style.cursor === 'grabbing' ? 'grabbing' : '';
    } else {
      app.canvas.style.cursor = 'pointer';
      if (tooltipAge >= TOOLTIP_INTERVAL_MS) {
        tooltipAge = 0;
        const t = scene.trafficFor(hit.spec.id);
        if (t) tooltip.show(hover.sx, hover.sy, hit.spec.label, t);
      }
    }
    hud.update({ zoomLevel: zoomLevelForScale(cam.scale), fps: ticker.FPS, packets: scene.livePackets });
  });
}

void bootstrap();
