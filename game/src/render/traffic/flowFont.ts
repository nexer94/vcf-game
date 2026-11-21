/**
 * Bitmap font for the traffic numbers ("≈ 4,2 Gb/s", "✚ ISO 42 %") – UX.md §28.14: a small pool of BitmapText
 * (≤ 8 per view) instead of canvas Text, installed once with exactly the glyphs needed.
 */
import { BitmapFont } from 'pixi.js';
import { OUTLINE } from '../room/palette';

export const FLOW_FONT = 'vcf-flow-numbers';
const CHARS = '0123456789,.≈<>%✚⇅↑ GbMsISOuvnitř/-–';
let installed = false;

export function ensureFlowFont(): void {
  if (installed) return;
  installed = true;
  BitmapFont.install({
    name: FLOW_FONT,
    style: { fontFamily: 'system-ui, "Segoe UI", sans-serif', fontSize: 22, fontWeight: '800', fill: OUTLINE, stroke: { color: 0xffffff, width: 5, join: 'round' } },
    chars: [CHARS],
    resolution: 2,
    padding: 4,
  });
}
