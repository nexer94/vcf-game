/**
 * Icon names + path data of the own line icons (GRAPHICS.md T9) – DOM-free, so pure data modules
 * (pcData.ts, tests in node) can reference icon names. DOM creation lives in icons.ts.
 */

/** Path data per icon (viewBox 0 0 24 24). */
export const ICON_PATHS = {
  // message types (UX.md 3.2 / T4)
  error: '<path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z"/><path d="M8 12h8"/>',
  warning: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>',
  puzzle:
    '<path d="M5 8h3.2a2 2 0 1 1 3.6 0H15v3.2a2 2 0 1 1 0 3.6V19h-3.2a2 2 0 1 0-3.6 0H5v-4.2a2 2 0 1 0 0-3.6z"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M8.5 15c-1.6-1.2-2.5-3-2.5-5a6 6 0 0 1 12 0c0 2-.9 3.8-2.5 5l-.5 1.5h-6z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.01"/>',
  // states
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  circle: '<circle cx="12" cy="12" r="6.5"/>',
  'half-circle': '<circle cx="12" cy="12" r="6.5"/><path d="M12 5.5v13"/><path d="M12 8h3"/><path d="M12 11h4.5"/><path d="M12 14h4.5"/><path d="M12 17h2.5"/>',
  diamond: '<path d="M12 5 19 12 12 19 5 12z"/>',
  skip: '<path d="M4 16a8 8 0 0 1 14-5"/><path d="M19 6v5h-5"/>',
  cross: '<path d="M7 7l10 10"/><path d="M17 7 7 17"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  approx: '<path d="M4 9.5c2.7-2.6 5.3 2.6 8 0s5.3 2.6 8 0"/><path d="M4 15.5c2.7-2.6 5.3 2.6 8 0s5.3 2.6 8 0"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8"/><path d="M9.5 10h5"/><path d="M9.5 14h5"/>',
  // hardware / topology
  server: '<rect x="3.5" y="5" width="17" height="6" rx="1.5"/><rect x="3.5" y="13" width="17" height="6" rx="1.5"/><path d="M7 8h.01"/><path d="M7 16h.01"/><path d="M11 8h6"/><path d="M11 16h6"/>',
  switch: '<rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M6 12h1"/><path d="M9 12h1"/><path d="M12 12h1"/><path d="M15 12h1"/><path d="M18 12h.01"/>',
  rack: '<rect x="5" y="2.5" width="14" height="19" rx="1.5"/><path d="M5 7.5h14"/><path d="M5 12h14"/><path d="M5 16.5h14"/><path d="M8 5h.01"/>',
  cable: '<path d="M5 4v4a3 3 0 0 0 3 3h8a3 3 0 0 1 3 3v6"/><rect x="3" y="2" width="4" height="3" rx=".5"/><rect x="17" y="19" width="4" height="3" rx=".5"/>',
  disk: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><circle cx="12" cy="11" r="4"/><path d="M12 11h.01"/><path d="M8 17.5h8"/>',
  nic: '<path d="M3 7h18v9H3z"/><path d="M6 16v3"/><path d="M10 16v3"/><path d="M14 16v3"/><rect x="13" y="9.5" width="5" height="4"/>',
  host: '<rect x="3.5" y="4" width="17" height="12" rx="1.5"/><path d="M8 20h8"/><path d="M12 16v4"/>',
  cluster: '<rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="8.5" y="14" width="7" height="7" rx="1"/>',
  domain: '<path d="M12 3 20.5 7.5v9L12 21l-8.5-4.5v-9z"/><path d="M12 12 20.5 7.5"/><path d="M12 12v9"/><path d="M12 12 3.5 7.5"/>',
  fleet: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.2 7.2 10.8 16"/><path d="M15.8 7.2 13.2 16"/><path d="M8.5 6h7"/>',
  dns: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z"/>',
  ntp: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  whiteboard: '<rect x="3" y="3.5" width="18" height="12.5" rx="1"/><path d="M8 20l2-4"/><path d="M16 20l-2-4"/><path d="M7 8.5c2-1.5 3 1.5 5 0s3 1.5 5 0"/>',
  computer: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8.5 20h7"/><path d="M12 16v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-4 4.2-6 7.5-6s6.3 2 7.5 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3"/><path d="M12 18.5v3"/><path d="M2.5 12h3"/><path d="M18.5 12h3"/><path d="m5.3 5.3 2.1 2.1"/><path d="m16.6 16.6 2.1 2.1"/><path d="m5.3 18.7 2.1-2.1"/><path d="m16.6 7.4 2.1-2.1"/>',
  doc: '<path d="M4 5.5c2.5-1.5 5-1.5 7 0v14c-2-1.5-4.5-1.5-7 0z"/><path d="M11 5.5c1-.8 2-1.2 3-1.3"/><path d="M15 4h5v5"/><path d="m20 4-6 6"/><path d="M11 19.5c1.5-1.1 3.3-1.4 5-1v-5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
  /** Own game mark: isometric cube drawn with lines (T0) - never a red bubble/circle. */
  'game-mark':
    '<path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z"/><path d="M3.5 7 12 11.5 20.5 7"/><path d="M12 11.5v10"/><path d="M6.5 11.5 9.5 13"/><path d="M6.5 14.5 9.5 16"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Icon per message type (T4). */
export const MESSAGE_ICON = {
  'vcf-error': 'error',
  'vcf-warning': 'warning',
  'game-limit': 'puzzle',
  'game-tip': 'bulb',
} as const satisfies Record<string, IconName>;
