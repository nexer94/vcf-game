import { Container, type Renderer } from 'pixi.js';
import type { GameSnapshot } from '../../engine';
import { distanceToPolyline } from '../geom/bezier';
import { PacketSim } from '../traffic/packetSim';
import type { LinkTraffic, TrafficSource } from '../traffic/trafficModel';
import { createBoxesView, type BoxesView } from './boxes';
import { CableLayer } from './cableLayer';
import { createFloor } from './floor';
import { buildLayout, type CableGeometry, type SceneLayout } from './layout';
import { createGlowTexture, PacketLayer } from './packetLayer';
import type { Topology } from './topology';

/** Max real delta fed to the visual simulation (avoids bursts after a background tab). */
const MAX_REAL_DELTA_MS = 100;

/**
 * Rack-level datacenter scene: floor, racks, cables and animated traffic.
 * Reads only the engine snapshot (game time) and a TrafficSource.
 */
export class DatacenterScene {
  readonly world = new Container();
  readonly layout: SceneLayout;
  private readonly boxes: BoxesView;
  private readonly cables: CableLayer;
  private readonly sim: PacketSim;
  private readonly packets: PacketLayer;
  private lastGameTimeMs: number | null = null;
  private traffic: ReadonlyMap<string, LinkTraffic> = new Map();
  private hoveredId: string | null = null;

  constructor(
    renderer: Renderer,
    topology: Topology,
    private readonly source: TrafficSource,
  ) {
    this.layout = buildLayout(topology);
    this.boxes = createBoxesView(topology);
    this.cables = new CableLayer(this.layout.cables);
    this.sim = new PacketSim(this.layout.cables);
    this.packets = new PacketLayer(createGlowTexture(renderer), this.sim, this.layout.bounds);
    this.world.addChild(createFloor(topology.floor, topology.boxes), this.boxes.view, this.cables.view, this.packets.view);
  }

  update(snapshot: GameSnapshot, realDeltaMs: number): void {
    const now = snapshot.clock.gameTimeMs;
    const gameDelta = this.lastGameTimeMs === null ? 0 : Math.max(0, now - this.lastGameTimeMs);
    this.lastGameTimeMs = now;
    this.traffic = this.source.sample(now);
    const real = Math.min(realDeltaMs, MAX_REAL_DELTA_MS);
    // Cap game delta consistently with the real-delta cap (speed multiplier preserved).
    const game = Math.min(gameDelta, MAX_REAL_DELTA_MS * Math.max(1, snapshot.clock.speed));
    this.sim.step(game, real, this.traffic, snapshot.clock.speed);
    this.packets.sync();
    this.cables.update(this.traffic, this.hoveredId);
  }

  setDetailVisible(visible: boolean): void {
    this.boxes.setDetailVisible(visible);
  }

  /** Nearest cable within `tolerance` world px of the world point, or null. */
  hitTestCable(wx: number, wy: number, tolerance: number): CableGeometry | null {
    let best: CableGeometry | null = null;
    let bestD = tolerance;
    for (const c of this.layout.cables) {
      const d = distanceToPolyline(c.samples, wx, wy);
      if (d <= bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  setHovered(id: string | null): void {
    this.hoveredId = id;
  }

  trafficFor(id: string): LinkTraffic | undefined {
    return this.traffic.get(id);
  }

  get livePackets(): number {
    return this.sim.count;
  }
}
