/**
 * Traffic types and their colours (docs/design/GRAPHICS.md, "Vizualizace provozu").
 * Pure data - shared by render (packets) and UI (legend, tooltip).
 */
export const TRAFFIC_TYPES = ['management', 'vmotion', 'vsan', 'nfs', 'overlay', 'vm'] as const;
export type TrafficType = (typeof TRAFFIC_TYPES)[number];

export interface TrafficTypeStyle {
  readonly label: string;
  /** Pixi colour (0xRRGGBB). */
  readonly color: number;
  /** Same colour as CSS string for DOM UI. */
  readonly css: string;
}

export const TRAFFIC_STYLE: Readonly<Record<TrafficType, TrafficTypeStyle>> = {
  management: { label: 'Management', color: 0x8aa4c8, css: '#8aa4c8' },
  vmotion: { label: 'vMotion', color: 0xf0a14a, css: '#f0a14a' },
  vsan: { label: 'vSAN', color: 0x4cc38a, css: '#4cc38a' },
  nfs: { label: 'NFS / storage', color: 0x3fb8c9, css: '#3fb8c9' },
  overlay: { label: 'NSX overlay', color: 0xa37cf0, css: '#a37cf0' },
  vm: { label: 'VM / north-south', color: 0xe8edf3, css: '#e8edf3' },
};
