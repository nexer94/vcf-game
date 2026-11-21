import { Graphics, Particle, ParticleContainer, Rectangle, type Renderer, type Texture } from 'pixi.js';
import type { PacketSim } from '../traffic/packetSim';

/** One small white radial glow, generated from vectors once and tinted per packet. */
export function createGlowTexture(renderer: Renderer): Texture {
  const r = 8;
  const g = new Graphics();
  for (let i = r; i >= 3; i--) g.circle(r, r, i).fill({ color: 0xffffff, alpha: 0.07 });
  g.circle(r, r, 2.2).fill({ color: 0xffffff, alpha: 1 });
  const tex = renderer.generateTexture({ target: g, resolution: 2, antialias: true });
  g.destroy();
  return tex;
}

/**
 * Renders PacketSim state with a single ParticleContainer (one draw call, additive
 * blend for the glow, no filters). Particles are preallocated and reused.
 */
export class PacketLayer {
  readonly view: ParticleContainer<Particle>;
  private readonly pool: Particle[];
  private shown = 0;

  constructor(
    texture: Texture,
    private readonly sim: PacketSim,
    bounds: { x: number; y: number; width: number; height: number },
    scale = 0.85,
    blendMode: 'add' | 'normal' = 'add',
  ) {
    this.view = new ParticleContainer<Particle>({
      texture,
      dynamicProperties: { position: true, color: true, vertex: false, rotation: false, uvs: false },
    });
    this.view.blendMode = blendMode;
    // ParticleContainer does not compute bounds itself.
    this.view.boundsArea = new Rectangle(bounds.x - 200, bounds.y - 200, bounds.width + 400, bounds.height + 600);
    this.pool = sim.packets.map(
      () => new Particle({ texture, anchorX: 0.5, anchorY: 0.5, scaleX: scale, scaleY: scale }),
    );
  }

  sync(): void {
    const n = this.sim.count;
    const children = this.view.particleChildren;
    if (n !== this.shown) {
      children.length = n;
      for (let i = 0; i < n; i++) children[i] = this.pool[i]!;
      this.shown = n;
      this.view.update();
    }
    for (let i = 0; i < n; i++) {
      const p = this.sim.packets[i]!;
      const s = this.pool[i]!;
      s.x = p.x;
      s.y = p.y;
      s.tint = p.color;
      s.alpha = p.alpha;
    }
  }
}
