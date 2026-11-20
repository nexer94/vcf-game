import type { ZoomLevel } from '../render/camera';

export interface Hud {
  update(info: { zoomLevel: ZoomLevel; fps: number; packets: number }): void;
}

export const ILLUSTRATIVE_LABEL = 'ilustrativní model';

/** Title, zoom level, FPS and the "ilustrativní model" badge. */
export function createHud(parent: HTMLElement): Hud {
  const el = document.createElement('div');
  el.className = 'ui-panel hud';
  el.innerHTML = `
    <h1>Datacentrum – rack a provoz</h1>
    <div class="row"><span class="ui-badge">${ILLUSTRATIVE_LABEL}</span><span data-k="zoom"></span></div>
    <div class="row"><span data-k="perf"></span></div>
    <div class="hint">Táhni myší = posun · kolečko = zoom · najeď na kabel = detail<br>Mezerník = pauza · 1/2/3 = 1×/4×/16×</div>`;
  parent.appendChild(el);
  const zoom = el.querySelector<HTMLElement>('[data-k="zoom"]')!;
  const perf = el.querySelector<HTMLElement>('[data-k="perf"]')!;
  let lastZoom = '';
  let lastPerf = '';
  return {
    update({ zoomLevel, fps, packets }) {
      const z = `Úroveň: ${zoomLevel}`;
      if (z !== lastZoom) zoom.textContent = lastZoom = z;
      const p = `${Math.round(fps)} FPS · ${packets} paketů`;
      if (p !== lastPerf) perf.textContent = lastPerf = p;
    },
  };
}
