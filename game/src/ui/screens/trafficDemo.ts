import { attachCameraControls, zoomLevelForScale, type Camera } from '../../render';
import { button, h } from '../dom';
import { createHud } from '../hud';
import { createLegend } from '../legend';
import { createLinkTooltip } from '../linkTooltip';
import { createTimeControls } from '../timeControls';
import { onEscape, type ScreenDef } from './screen';

/** Hover tooltip refresh rate (DOM writes are throttled). */
const TOOLTIP_INTERVAL_MS = 200;
/** Hit-test tolerance for cables, in screen px. */
const HOVER_TOLERANCE_PX = 8;
/** Device labels shown only from this zoom on (LOD). */
const DETAIL_MIN_SCALE = 0.9;

/** Interactive isometric datacenter with illustrative traffic (prototype). */
export const trafficDemoScreen: ScreenDef = {
  stageMode: 'interactive',
  mount(root, ctx) {
    const { stage, engine } = ctx;
    const canvas = stage.canvas;
    const uiRoot = h('div', { class: 'ui-root' });
    root.appendChild(uiRoot);
    const hud = createHud(uiRoot);
    createLegend(uiRoot);
    const time = createTimeControls(uiRoot, engine);
    const tooltip = createLinkTooltip(uiRoot);
    uiRoot.append(
      h('div', { class: 'ui-panel back-panel' }, button('← Menu', () => ctx.navigate({ name: 'menu' }), { class: 'btn', title: 'Zpět do menu (Esc)' })),
    );

    const applyCamera = (cam: Camera): void => {
      stage.setCamera(cam);
      stage.scene.setDetailVisible(cam.scale >= DETAIL_MIN_SCALE);
    };

    let hover: { sx: number; sy: number; wx: number; wy: number } | null = null;
    let tooltipAge = Infinity;
    const camera = attachCameraControls({
      element: canvas,
      initial: stage.fit(),
      onChange: applyCamera,
      onHover: (pos) => {
        hover = pos;
        tooltipAge = Infinity; // refresh immediately on movement
      },
    });
    const onDbl = (): void => camera.set(stage.fit());
    canvas.addEventListener('dblclick', onDbl);

    const offFrame = stage.onFrame((snap, real, fps) => {
      time.update(snap);
      const cam = camera.camera;
      const scene = stage.scene;
      const hit = hover ? scene.hitTestCable(hover.wx, hover.wy, HOVER_TOLERANCE_PX / cam.scale) : null;
      scene.setHovered(hit?.spec.id ?? null);
      tooltipAge += real;
      if (!hit || !hover) {
        tooltip.hide();
        canvas.style.cursor = canvas.style.cursor === 'grabbing' ? 'grabbing' : '';
      } else {
        canvas.style.cursor = 'pointer';
        if (tooltipAge >= TOOLTIP_INTERVAL_MS) {
          tooltipAge = 0;
          const t = scene.trafficFor(hit.spec.id);
          if (t) tooltip.show(hover.sx, hover.sy, hit.spec.label, t);
        }
      }
      hud.update({ zoomLevel: zoomLevelForScale(cam.scale), fps, packets: scene.livePackets });
    });
    const offEsc = onEscape(() => ctx.navigate({ name: 'menu' }));

    return {
      dispose() {
        offEsc();
        offFrame();
        camera.dispose();
        canvas.removeEventListener('dblclick', onDbl);
        canvas.style.cursor = '';
        stage.scene.setHovered(null);
        time.dispose();
        uiRoot.remove();
      },
    };
  },
};
