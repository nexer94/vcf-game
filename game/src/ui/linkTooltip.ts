import { loadBand } from '../render/traffic/loadStyle';
import type { LinkTraffic } from '../render/traffic/trafficModel';
import { TRAFFIC_STYLE } from '../render/traffic/trafficTypes';
import { formatCount, formatGbps, formatLatency, formatPercent } from './format';
import { ILLUSTRATIVE_LABEL } from './hud';

const BAND_LABEL = { normal: 'v normě', warn: 'vysoké (nad 80 %)', crit: 'přetížení (nad 95 %)' } as const;

export interface LinkTooltip {
  show(sx: number, sy: number, title: string, t: LinkTraffic): void;
  hide(): void;
}

/** Hover detail of a link: throughput, latency, queue, drops + traffic mix. */
export function createLinkTooltip(parent: HTMLElement): LinkTooltip {
  const el = document.createElement('div');
  el.className = 'ui-panel tooltip';
  el.setAttribute('role', 'tooltip');
  parent.appendChild(el);
  let lastHtml = '';

  return {
    show(sx, sy, title, t) {
      const band = loadBand(t.utilization);
      const mix = t.mix
        .filter((c) => c.gbps > 0.005)
        .map((c) => {
          const s = TRAFFIC_STYLE[c.type];
          return `<tr><td><span class="dot" style="background:${s.css}"></span>${s.label}</td><td>${formatGbps(c.gbps)}</td></tr>`;
        })
        .join('');
      const html = `
        <h3>${title}</h3>
        <table>
          <tr><td>Vytížení</td><td class="band band-${band}">${formatPercent(t.utilization)} – ${BAND_LABEL[band]}</td></tr>
          <tr><td>Propustnost</td><td>${formatGbps(t.throughputGbps)} / ${formatGbps(t.capacityGbps)}</td></tr>
          <tr><td>Poptávka</td><td>${formatGbps(t.demandGbps)}</td></tr>
          <tr><td>Latence</td><td>${formatLatency(t.latencyMs)}</td></tr>
          <tr><td>Fronta</td><td>${formatCount(t.queueDepth)} paketů</td></tr>
          <tr><td>Dropy</td><td>${formatCount(t.dropsPerSec)} /s</td></tr>
        </table>
        <table class="mix">${mix}</table>
        <div class="foot"><span class="ui-badge">${ILLUSTRATIVE_LABEL}</span></div>`;
      if (html !== lastHtml) el.innerHTML = lastHtml = html;
      el.classList.add('visible');
      // Keep inside the viewport.
      const pw = parent.clientWidth;
      const ph = parent.clientHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const x = sx + 16 + w > pw ? sx - 16 - w : sx + 16;
      const y = Math.min(Math.max(8, sy + 16), ph - h - 8);
      el.style.left = `${Math.max(8, x)}px`;
      el.style.top = `${y}px`;
    },
    hide() {
      el.classList.remove('visible');
    },
  };
}
