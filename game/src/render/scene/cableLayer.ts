import { Graphics } from 'pixi.js';
import { LOAD_COLORS, loadBand, loadWidth } from '../traffic/loadStyle';
import type { LinkTraffic } from '../traffic/trafficModel';
import type { CableGeometry } from './layout';

const SHEATH = 0x0a0e13;
const HOVER = 0xffffff;
/** Width quantisation step - avoids re-tessellating on sub-pixel changes. */
const WIDTH_STEP = 0.25;

/**
 * All cables in one Graphics. Re-tessellated only when the visual key
 * (band, quantised width, hover) changes, so idle frames cost nothing.
 */
export class CableLayer {
  readonly view = new Graphics();
  private lastKey = '';

  constructor(private readonly cables: readonly CableGeometry[]) {}

  update(traffic: ReadonlyMap<string, LinkTraffic>, hoveredId: string | null): void {
    let key = hoveredId ?? '-';
    const styles: { width: number; color: number; crit: boolean }[] = [];
    for (const c of this.cables) {
      const u = traffic.get(c.spec.id)?.utilization ?? 0;
      const band = loadBand(u);
      const width = Math.round(loadWidth(u) / WIDTH_STEP) * WIDTH_STEP;
      styles.push({ width, color: LOAD_COLORS[band], crit: band === 'crit' });
      key += `|${band[0]}${width}`;
    }
    if (key === this.lastKey) return;
    this.lastKey = key;

    const g = this.view;
    g.clear();
    this.cables.forEach((c, i) => {
      const s = styles[i]!;
      const { p0, p1, p2, p3 } = c.curve;
      const path = (): Graphics => g.moveTo(p0.x, p0.y).bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      if (c.spec.id === hoveredId) path().stroke({ color: HOVER, width: s.width + 6, alpha: 0.25, cap: 'round' });
      if (s.crit) path().stroke({ color: s.color, width: s.width + 5, alpha: 0.18, cap: 'round' });
      path().stroke({ color: SHEATH, width: s.width + 2, alpha: 0.7, cap: 'round' });
      path().stroke({ color: s.color, width: s.width, alpha: s.crit ? 1 : 0.85, cap: 'round' });
    });
  }
}
