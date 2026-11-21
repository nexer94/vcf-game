/**
 * Colour palette of the cosy cartoon server room (docs/design/GRAPHICS.md "Styl" + "Téma a paleta" T6).
 * Cool light server room (blue-grey floor and walls), graphite-navy racks, navy switches; warm counterweights
 * (wooden desk, plant, mug, lamp, amber cable tray). Red only sparingly (avatar hoodie, rack number plate,
 * wall stripe, extinguisher, poster) - own game values, not an official brand.
 * Light comes from the front-left: top faces brightest, +gy (front-left) faces light, +gx (front-right) darker.
 * Traffic colours are NOT here - they come from traffic/trafficTypes.ts.
 */
export const OUTLINE = 0x14233a;
export const OUTLINE_SOFT = 0x4a5b73;

export const ROOM_BG = 0xe4e9f0;

export const FLOOR = {
  a: 0xeef1f5,
  b: 0xe4e8ef,
  grout: 0xc9d1dc,
  perforated: 0xb4bfcd,
  slabLeft: 0xa9b5c5,
  slabRight: 0x8e9cb0,
} as const;

export const WALL = {
  /** Right back wall (along gy = 0), its face looks to +gy -> lit. */
  right: 0xd5dde8,
  rightDark: 0xc3cddb,
  /** Left back wall (along gx = 0), its face looks to +gx -> shaded. */
  left: 0xb9c5d5,
  leftDark: 0xa7b4c6,
  cap: 0xf7f9fb,
  base: 0x2b4a78,
  /** 6 px horizontal stripe at 1/3 wall height - the only large brand element in the scene. */
  stripe: 0xc41f33,
} as const;

export const DECOR = {
  door: 0x3b5f8f,
  doorDark: 0x2b4a78,
  doorFrame: 0xf7f9fb,
  doorWindow: 0xcbeaf6,
  handle: 0xffd34d,
  ac: 0xfbfcfd,
  acShade: 0xd5dde8,
  acVent: 0x8592a3,
  acLed: 0x3ccf7a,
  /** v3: thin grey wire tray above rack rows (alpha 0.35), GRAPHICS T6. */
  tray: 0x8592a3,
  trayDark: 0x6c7c93,
  poster: 0xffffff,
  posterA: 0xc41f33,
  posterB: 0x2b4a78,
  posterC: 0x4cc38a,
  extinguisher: 0xd42e3f,
  sign: 0x4cc38a,
  lamp: 0xfff6c8,
} as const;

export const CABINET = {
  top: 0x3b4a5f,
  front: 0x24324a,
  side: 0x1a2538,
  inner: 0x111a29,
  rail: 0x6c7c93,
  /** Small number plate at the top of the rack front (white number on red, 5.85:1). */
  label: 0xc41f33,
  /** Low network cabinet for standalone switches. */
  netTop: 0x4a6a96,
  netFront: 0x34527c,
  netSide: 0x284268,
} as const;

export const DEVICE = {
  serverFace: 0xeef1f5,
  serverShade: 0xcdd4de,
  bay: 0xb3bdca,
  switchFace: 0x2b4a78,
  switchShade: 0x213a60,
  port: 0xe6edf6,
  ledOk: 0x3ccf7a,
  ledAct: 0xffc24a,
  /** Fault only (4.25:1 on graphite) - always together with an icon / bubble. */
  ledFault: 0xff5a6a,
} as const;

export const AVATAR = {
  skin: 0xffd2a8,
  cheek: 0xff9e9e,
  hair: 0x6b3f2a,
  hoodie: 0xc41f33,
  hoodieDark: 0x9e1f2e,
  pants: 0x1f3550,
  shoe: 0x14233a,
  badge: 0xffffff,
} as const;

/** Physical cables: neutral body (traffic colour rides on packets / stripe), dark OUTLINE around. */
export const CABLE = {
  body: 0xf6f8fa,
} as const;

export const SHADOW = 0x1a2a40;
export const HOVER_TILE = 0xffffff;
/** Selection = blue (5.05:1 on the floor). */
export const TARGET_TILE = 0x1d63c8;
/** Invalid tile - always together with hatching (colour is never the only carrier). */
export const BLOCKED_TILE = 0xe5484d;

/** Hot / cold aisles on the floor (subtle tints over the cool floor, always with a text label in the legend). */
export const AISLE = {
  cold: 0x6ea8ff,
  hot: 0xf2a65a,
} as const;

/** Vendor tag colours (vendor = coloured tag + text only, no logos). Game colours, white text 5.3-7.1:1. */
export const VENDOR_TAG: Readonly<Record<'Dell' | 'HPE' | 'Lenovo' | 'Cisco' | 'Supermicro', number>> = {
  Dell: 0x2560c4,
  HPE: 0x187a4e,
  Lenovo: 0xa3245a,
  Cisco: 0x0f6f80,
  Supermicro: 0x6b3fb5,
};

/** Illustrative label colours for server tags (vendor colours + amber). */
export const TAG_COLORS: readonly number[] = [0x2560c4, 0x187a4e, 0xa3245a, 0x0f6f80, 0x6b3fb5, 0xb76e00];
