/**
 * Original cartoon avatar (the admin) drawn from vectors and baked into six small
 * textures: {front, back} x {stand, stepA, stepB}. Left-facing variants are the
 * same textures mirrored (sprite.scale.x = -1). Origin = between the feet.
 */
import { Graphics, type Renderer, type Texture } from 'pixi.js';
import { AVATAR, OUTLINE } from './palette';

export type AvatarPose = 'stand' | 'stepA' | 'stepB';
export type AvatarSide = 'front' | 'back';

export interface AvatarTextures {
  readonly frames: Readonly<Record<AvatarSide, Readonly<Record<AvatarPose, Texture>>>>;
  /** Sprite anchor (0..1) that puts the feet at the sprite position. */
  readonly anchor: { readonly x: number; readonly y: number };
}

const LINE = { color: OUTLINE, width: 1.5, join: 'round' as const, cap: 'round' as const };
/** Fixed drawing box so every frame shares the same anchor. */
const BOX = { x: -16, y: -60, w: 32, h: 64 };

function drawAvatar(side: AvatarSide, pose: AvatarPose): Graphics {
  const g = new Graphics();
  // Invisible frame rectangle keeps all textures the same size/anchor.
  g.rect(BOX.x, BOX.y, BOX.w, BOX.h).fill({ color: 0xffffff, alpha: 0.001 });
  const step = pose === 'stand' ? 0 : pose === 'stepA' ? 1 : -1;
  // Legs + shoes.
  const legs: [number, number][] = [
    [-5, step * 1.5],
    [1, -step * 1.5],
  ];
  for (const [lx, lift] of legs) {
    g.roundRect(lx, -13 - lift, 4.5, 11, 2).fill({ color: AVATAR.pants }).stroke(LINE);
    g.ellipse(lx + 2.5, -2 - lift, 3.6, 2.2).fill({ color: AVATAR.shoe });
  }
  // Arms (swing opposite to legs).
  const arms: [number, number][] = [
    [-11.5, -step * 2],
    [7.5, step * 2],
  ];
  for (const [ax, swing] of arms) {
    g.roundRect(ax, -29 + swing, 4.5, 13, 2.2).fill({ color: AVATAR.hoodieDark }).stroke(LINE);
    g.circle(ax + 2.2, -15.5 + swing, 2.2).fill({ color: AVATAR.skin }).stroke(LINE);
  }
  // Body (hoodie).
  g.roundRect(-8.5, -31, 17, 20, 6).fill({ color: AVATAR.hoodie }).stroke(LINE);
  if (side === 'front') {
    g.moveTo(-4, -17).lineTo(4, -17).stroke({ ...LINE, width: 1.2, color: AVATAR.hoodieDark });
    // Name badge (blank card).
    g.roundRect(1.5, -27, 5, 6, 1).fill({ color: AVATAR.badge }).stroke({ ...LINE, width: 1 });
  } else {
    // Hood on the back.
    g.roundRect(-6, -33, 12, 7, 3.5).fill({ color: AVATAR.hoodieDark }).stroke(LINE);
  }
  // Head.
  const cx = 0;
  const cy = -42;
  g.circle(cx, cy, 11).fill({ color: AVATAR.skin }).stroke(LINE);
  if (side === 'front') {
    // Hair cap with a fringe sweeping to the right (facing direction).
    g.moveTo(cx - 11.4, cy + 1)
      .arc(cx, cy, 11.6, Math.PI * 1.03, Math.PI * 1.97)
      .lineTo(cx + 9, cy - 3)
      .lineTo(cx + 3, cy - 6)
      .lineTo(cx - 2, cy - 3)
      .lineTo(cx - 7, cy - 5)
      .closePath()
      .fill({ color: AVATAR.hair })
      .stroke(LINE);
    g.ellipse(cx + 1.5, cy + 1, 1.3, 1.9).fill({ color: OUTLINE });
    g.ellipse(cx + 6.5, cy + 1, 1.3, 1.9).fill({ color: OUTLINE });
    g.ellipse(cx - 2.5, cy + 5, 2.2, 1.3).fill({ color: AVATAR.cheek, alpha: 0.8 });
    g.ellipse(cx + 9, cy + 5, 1.6, 1.2).fill({ color: AVATAR.cheek, alpha: 0.8 });
    g.moveTo(cx + 2.5, cy + 6).quadraticCurveTo(cx + 4.2, cy + 7.6, cx + 6, cy + 6).stroke({ ...LINE, width: 1.2 });
  } else {
    g.circle(cx, cy - 0.5, 11.2).fill({ color: AVATAR.hair }).stroke(LINE);
    g.moveTo(cx - 3, cy - 8).quadraticCurveTo(cx + 1, cy - 4, cx + 5, cy - 8).stroke({ ...LINE, width: 1.2, color: 0x8a5a40 });
  }
  return g;
}

export function createAvatarTextures(renderer: Renderer): AvatarTextures {
  const make = (side: AvatarSide): Record<AvatarPose, Texture> => {
    const out = {} as Record<AvatarPose, Texture>;
    for (const pose of ['stand', 'stepA', 'stepB'] as const) {
      const g = drawAvatar(side, pose);
      out[pose] = renderer.generateTexture({ target: g, resolution: 3, antialias: true });
      g.destroy();
    }
    return out;
  };
  // generateTexture crops to the local bounds = BOX (all strokes stay inside it).
  return {
    frames: { front: make('front'), back: make('back') },
    anchor: { x: -BOX.x / BOX.w, y: -BOX.y / BOX.h },
  };
}
