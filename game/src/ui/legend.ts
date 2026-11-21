import { LOAD_CSS } from '../render/traffic/loadStyle';
import { DROP_COLOR } from '../render/traffic/packetSim';
import { TRAFFIC_STYLE, TRAFFIC_TYPES } from '../render/traffic/trafficTypes';
import { ILLUSTRATIVE_LABEL } from './hud';

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Always-visible legend: traffic colours, load thresholds, dropped packets. */
export function createLegend(parent: HTMLElement, opts: { readonly neutralCables?: boolean } = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ui-panel legend';
  const types = TRAFFIC_TYPES.map((t) => {
    const s = TRAFFIC_STYLE[t];
    return `<li><span class="dot" style="background:${s.css};box-shadow:0 0 6px ${s.css}"></span>${s.label}</li>`;
  }).join('');
  el.innerHTML = `
    <h2>Typ provozu (pakety)</h2>
    <ul>${types}</ul>
    <h2>Vytížení linky</h2>
    <ul>
      ${opts.neutralCables
        ? `<li><span class="bar bar-neutral" style="height:4px"></span>kabel: tloušťka = vytížení</li><li><span class="bar bar-neutral" style="height:4px"></span>proužek = typ provozu</li>`
        : `<li><span class="bar" style="height:2px;background:${LOAD_CSS.normal}"></span>tloušťka = vytížení</li>`}
      <li><span class="bar" style="height:4px;background:${LOAD_CSS.warn}"></span>nad 80 %</li>
      <li><span class="bar" style="height:6px;background:${LOAD_CSS.crit}"></span>nad 95 %</li>
      <li><span class="dot" style="background:${hex(DROP_COLOR)}"></span>zahozený paket (padá a mizí)</li>
    </ul>
    <div class="foot"><span class="ui-badge">${ILLUSTRATIVE_LABEL}</span></div>`;
  parent.appendChild(el);
  return el;
}
