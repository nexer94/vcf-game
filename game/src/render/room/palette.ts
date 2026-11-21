/**
 * Colour palette of the cosy cartoon server room (docs/design/GRAPHICS.md, "Styl").
 * Original palette - bright, saturated, soft. Light comes from the front-left:
 * top faces brightest, +gy (front-left) faces light, +gx (front-right) faces darker.
 * Traffic colours are NOT here - they come from traffic/trafficTypes.ts.
 */
export const OUTLINE = 0x2e2645;
export const OUTLINE_SOFT = 0x5a4f78;

export const ROOM_BG = 0xf4ead8;

export const FLOOR = {
  a: 0xe9e5f2,
  b: 0xdfdaee,
  grout: 0xc7c0dc,
  perforated: 0xb3abcf,
  slabLeft: 0xb9b0d6,
  slabRight: 0x9e94c4,
} as const;

export const WALL = {
  /** Right back wall (along gy = 0), its face looks to +gy -> lit. */
  right: 0x9fdccf,
  rightDark: 0x86cbbd,
  /** Left back wall (along gx = 0), its face looks to +gx -> shaded. */
  left: 0x82c6c9,
  leftDark: 0x6db3b7,
  cap: 0xf7f2e8,
  base: 0x5d8f9a,
} as const;

export const DECOR = {
  door: 0xf2a65a,
  doorDark: 0xd98a3d,
  doorFrame: 0xfff4e0,
  doorWindow: 0xcbeaf6,
  handle: 0xffd34d,
  ac: 0xfbfbff,
  acShade: 0xdcdcec,
  acVent: 0x9aa0bd,
  acLed: 0x4cc38a,
  tray: 0xffcf4a,
  trayDark: 0xe0a92a,
  poster: 0xffffff,
  posterA: 0xff7a8a,
  posterB: 0x5b9cf0,
  posterC: 0x4cc38a,
  extinguisher: 0xe5484d,
  sign: 0x4cc38a,
  lamp: 0xfff6c8,
} as const;

export const CABINET = {
  top: 0x6a6a9a,
  front: 0x4a4a78,
  side: 0x383862,
  inner: 0x27274a,
  rail: 0x8a8ab8,
  /** Low network cabinet for standalone switches. */
  netTop: 0x7fa8e8,
  netFront: 0x5b86d0,
  netSide: 0x4870b8,
} as const;

export const DEVICE = {
  serverFace: 0xeef0f7,
  serverShade: 0xcfd3e3,
  bay: 0xb7bcd2,
  switchFace: 0x3d6fd1,
  switchShade: 0x2f58aa,
  port: 0xe8f0ff,
  ledOk: 0x47d18c,
  ledAct: 0xffc94d,
} as const;

export const AVATAR = {
  skin: 0xffd2a8,
  cheek: 0xff9e9e,
  hair: 0x6b3f2a,
  hoodie: 0xff8a3d,
  hoodieDark: 0xe0702a,
  pants: 0x3d5aa8,
  shoe: 0x2e2645,
  badge: 0xffffff,
} as const;

/** Physical cables: neutral body (traffic colour rides on packets / stripe), dark OUTLINE around. */
export const CABLE = {
  body: 0xf7f5fc,
} as const;

export const SHADOW = 0x3a2f5a;
export const HOVER_TILE = 0xffffff;
export const TARGET_TILE = 0xff8a3d;
export const BLOCKED_TILE = 0xe5484d;

/** Illustrative label colours for server tags (vendor = colour/text label only, no logos). */
export const TAG_COLORS: readonly number[] = [0x3d8bfd, 0x2bb673, 0xe5484d, 0x1fb6c9, 0x9b59e0, 0xf0a14a];
