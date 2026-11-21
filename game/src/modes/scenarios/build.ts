/**
 * Hotové scénáře – building the physical room of a scenario preset by REPLAYING Sandbox commands (modes/career
 * replayCommands), so the room obeys every model / game rule and renders exactly like the Sandbox:
 *  1. blueprint + site layout (chooseBlueprint – pre-selects the blueprint's documented design choices, 06 §2),
 *     then the sizing profile of the preset as design choices (deployment model + size, 20 §4.2 step 5; bringup
 *     sizingProfileOf),
 *  2. one rack per vSphere cluster with the pre-installed ToR-A (tor.ts) in the room of the instance's location,
 *  3. servers from the preset host configurations (starter catalog, 15 B.3), mounted, NIC ports cabled to the ToR,
 *     ToR ports as 802.1Q trunks with MTU 9000, ToRs of further racks linked to the first ToR (inter-switch cable),
 *  4. ESX installed (timed task, completed by the replay), DCUI management network, DNS A + PTR, NTP.
 *
 * GAME choices (not documentation, labelled in the snapshot notes): rack per cluster, tile = first valid hint, one
 * ToR per rack, two cabled NIC ports per host, inter-switch topology, VLAN IDs, IP addresses, MTU 9000 on the ToR.
 * The deployed Fleet itself is NOT produced by a replayed bring-up: it comes from the model (buildPresetFleet,
 * 40 §6.5), because the bring-up only creates the first management domain.
 *
 * Pure TypeScript: no DOM, no PixiJS.
 */
import {
  type BlueprintId,
  type DeploymentModel,
  type DeploymentSize,
  type DesignChoices,
  type HardwareCatalog,
  type PresetBuild,
  type ScenarioPreset,
  type SiteLayoutId,
  type SizingProfile,
  type StarterServer,
  LAYOUT_BLUEPRINTS,
  SITE_LAYOUT_IDS,
  SWITCH_MODELS,
  nicMaxSpeed,
} from '../../model';
import { replayCommands } from '../career/replay';
import { type CommandResult, type SandboxCommand, COMPANY_NETWORK_GAME_DEFAULTS, DEFAULT_TOR_MODEL_ID, SANDBOX_V3_OPTIONS, SandboxSession } from '../sandbox';

/** [GAME] network values of the prepared environments (illustrative, not documentation). */
export const SCENARIO_GAME_NETWORK = {
  /** ESX management VLAN (all clusters share the management network, 06 "shared-vlan" choice of the blueprints). */
  mgmtVlan: 1610,
  mask: '255.255.255.0',
  gateway: COMPANY_NETWORK_GAME_DEFAULTS.gateway,
  dns: COMPANY_NETWORK_GAME_DEFAULTS.dns,
  ntp: COMPANY_NETWORK_GAME_DEFAULTS.ntp,
  /** Host management IPs: 10.0.0.<hostIpStart + n>. */
  hostIpPrefix: '10.0.0.',
  hostIpStart: 150,
  /** Per-cluster host networks: VLAN = base + 10 × cluster index (vMotion, vSAN, host TEP), MTU 9000. */
  vmotionVlanBase: 1611,
  storageVlanBase: 1612,
  overlayVlanBase: 1613,
  hostNetMtu: 9000,
  switchMtu: 9000,
  /** NIC ports of each host cabled to the ToR. */
  cabledNicPorts: 2,
  gameValues: true,
} as const;

const RACK_ITEM_ID = 'rack-generic-42u';

/** Layout of a blueprint (first layout of the 06 §7a game mapping); no blueprint -> the Sandbox default layout. */
export function layoutForBlueprint(blueprintId: BlueprintId | null): SiteLayoutId | undefined {
  if (!blueprintId) return undefined;
  return SITE_LAYOUT_IDS.find((l) => LAYOUT_BLUEPRINTS[l].blueprintId === blueprintId);
}

/** Inverse of bringup sizingProfileOf (20 §4.2 step 5). */
export function designOfProfile(profile: SizingProfile): { readonly model: DeploymentModel; readonly size: DeploymentSize } {
  switch (profile) {
    case 'simple':
      return { model: 'simple', size: 'small' };
    case 'ha-small':
      return { model: 'high-availability', size: 'small' };
    case 'ha-medium':
      return { model: 'high-availability', size: 'medium' };
    case 'ha-large':
      return { model: 'high-availability', size: 'large' };
  }
}

export function starterServer(catalog: HardwareCatalog, id: string): StarterServer {
  const s = catalog.starterServers.find((x) => x.id === id);
  if (!s) throw new Error(`scenario: starter configuration ${id} not in the catalog`);
  return s;
}

/** Speeds of the NIC cards of a starter configuration. */
function nicSpeeds(catalog: HardwareCatalog, starterId: string): number[] {
  return starterServer(catalog, starterId).config.nics.flatMap((n) => [...(catalog.nics.get(n.partId)?.speedsGbE ?? [])]);
}

/**
 * [GAME] ToR model whose port speed matches the fastest NIC of the host configurations. The game catalog has no
 * mixed-speed switch, so one model is used for the whole scenario (all ToRs must be linkable).
 */
export function torModelFor(catalog: HardwareCatalog, starterIds: readonly string[]): string {
  let speed = 0;
  for (const id of starterIds)
    for (const n of starterServer(catalog, id).config.nics) {
      const part = catalog.nics.get(n.partId);
      if (part) speed = Math.max(speed, nicMaxSpeed(part));
    }
  const tor = SWITCH_MODELS.find((m) => !m.oobOnly && m.speedsGbE.includes(speed));
  return tor?.id ?? DEFAULT_TOR_MODEL_ID;
}

/** One rack of the scenario = one vSphere cluster of the preset fleet. */
export interface ScenarioRack {
  readonly rackId: string;
  readonly torId: string;
  readonly roomId: string;
  readonly clusterId: string;
  readonly domainId: string;
  readonly instanceId: string;
}

export interface ScenarioRoomBuild {
  readonly session: SandboxSession;
  /** Preset host id (Fleet) -> physical server id (Sandbox room). */
  readonly hostServers: Readonly<Record<string, string>>;
  readonly racks: readonly ScenarioRack[];
  /** Number of replayed commands (for tests / debugging). */
  readonly commandCount: number;
  /** Rooms per instance id. */
  readonly instanceRooms: Readonly<Record<string, string>>;
  /** [GAME] NIC cards replaced so the host can be cabled to the scenario's ToR model (no mixed-speed switch). */
  readonly nicAdjustments: readonly NicAdjustment[];
}

export interface NicAdjustment {
  readonly hostId: string;
  readonly serverId: string;
  readonly removed: readonly string[];
  readonly added: string;
  readonly speedGbE: number;
}

/**
 * Builds the room of a preset. Commands that depend on created ids (racks, servers) are issued step by step; each
 * step goes through replayCommands (throws ReplayError on any rejection, completes timed tasks).
 */
export function buildScenarioRoom(preset: ScenarioPreset, build: PresetBuild): ScenarioRoomBuild {
  const session = new SandboxSession({ ...SANDBOX_V3_OPTIONS });
  const catalog = session.context.catalog;
  let commandCount = 0;
  const run = (cmd: SandboxCommand): CommandResult => {
    commandCount++;
    const [r] = replayCommands(session, [cmd]);
    return r as CommandResult;
  };
  const created = (r: CommandResult): readonly string[] => (r.ok ? (r.created ?? []) : []);

  // 1. blueprint + layout + profile design choices
  const layoutId = layoutForBlueprint(preset.blueprintId);
  if (preset.blueprintId && layoutId) run({ type: 'chooseBlueprint', blueprintId: preset.blueprintId, layoutId });
  const firstProfile = preset.instances.find((i) => i.first)?.profile ?? preset.instances[0]?.profile;
  if (firstProfile) {
    const want = designOfProfile(firstProfile);
    const pick = (decision: keyof DesignChoices & ('deployment-model' | 'deployment-size'), option: string): void => {
      if (session.state.choices[decision] !== option) run({ type: 'selectDesignOption', decision, option });
    };
    pick('deployment-model', want.model);
    pick('deployment-size', want.size);
  }

  // Rooms: instance location 'site' -> first room, 'region2' -> second room (06 §6.1 host groups; 06 §7a layout).
  const rooms = session.snapshot().site.layout.rooms.map((r) => r.id);
  const instanceRooms: Record<string, string> = {};
  for (const pi of preset.instances) {
    const roomId = pi.location === 'region2' ? (rooms[1] ?? rooms[0]) : rooms[0];
    if (!roomId) throw new Error(`scenario ${preset.id}: layout has no room`);
    instanceRooms[pi.key] = roomId;
  }
  for (const pi of preset.instances)
    if (pi.location === 'region2' && instanceRooms[pi.key] !== rooms[0]) run({ type: 'assignRoomRole', roomId: instanceRooms[pi.key] as string, role: 'secondary-instance' });

  // 2. racks (one per cluster) + 3. servers
  const hostServers: Record<string, string> = {};
  const racks: ScenarioRack[] = [];
  const nicAdjustments: NicAdjustment[] = [];
  const torModelId = torModelFor(catalog, Object.values(build.hostConfigs));
  const torSpeed = Math.max(...(catalog.switches.get(torModelId)?.speedsGbE ?? [0]));
  const N = SCENARIO_GAME_NETWORK;
  let hostIndex = 0;
  for (const inst of build.fleet.instances) {
    const roomId = instanceRooms[inst.id] ?? rooms[0] ?? '';
    for (const dom of [inst.managementDomain, ...inst.workloadDomains])
      for (const cl of dom.clusters) {
        const configs = cl.hosts.map((h) => build.hostConfigs[h.id] ?? '');
        const hint = session.rackPlacementHints(roomId, { facing: 'S' })?.[0];
        if (!hint) throw new Error(`scenario ${preset.id}: no free rack tile in ${roomId}`);
        const placed = created(run({ type: 'placeRack', itemId: RACK_ITEM_ID, tile: hint.tile, facing: 'S', roomId, torModelId }));
        const rackId = placed[0];
        const torId = placed[1];
        if (!rackId || !torId) throw new Error(`scenario ${preset.id}: rack without pre-installed ToR`);
        racks.push({ rackId, torId, roomId, clusterId: cl.id, domainId: dom.id, instanceId: inst.id });
        const torPorts = catalog.switches.get(session.state.room.physical.switches.find((s) => s.id === torId)?.modelId ?? '')?.ports ?? 0;
        cl.hosts.forEach((h, i) => {
          const serverId = created(run({ type: 'buyItem', itemId: configs[i] as string }))[0];
          if (!serverId) throw new Error(`scenario ${preset.id}: server ${configs[i]} not bought`);
          hostServers[h.id] = serverId;
          run({ type: 'mountDevice', inventoryId: serverId, rackId });
          if (!nicSpeeds(catalog, configs[i] as string).includes(torSpeed)) {
            // [GAME] swap the NIC card(s) for a certified card of the fabric speed (BCG BOM of the model, addNic rules).
            const view = () => session.snapshot().physical.servers.find((x) => x.id === serverId);
            const removed = (view()?.nicSlots ?? []).map((x) => x.partId).filter((x): x is string => x !== undefined);
            for (let slot = removed.length; slot >= 1; slot--) run({ type: 'removeNic', serverId, slot });
            const opt = view()?.nicOptions.find((o) => o.speedsGbE.includes(torSpeed) && o.incompatibleTors.length === 0);
            if (!opt) throw new Error(`scenario ${preset.id}: no certified ${torSpeed}G NIC for ${configs[i]}`);
            run({ type: 'addNic', serverId, slot: 1, nicPartId: opt.partId });
            nicAdjustments.push({ hostId: h.id, serverId, removed, added: opt.partId, speedGbE: torSpeed });
          }
          for (let p = 0; p < N.cabledNicPorts; p++) run({ type: 'connectCable', from: { deviceId: serverId, port: p }, to: { deviceId: torId, port: i * N.cabledNicPorts + p } });
        });
        // [GAME] inter-switch link to the first ToR (which has the company network uplink in its last port).
        const hub = racks[0];
        if (hub && hub.torId !== torId) {
          const hubPorts = catalog.switches.get(session.state.room.physical.switches.find((s) => s.id === hub.torId)?.modelId ?? '')?.ports ?? 0;
          // hub port: last port = company uplink, then one port per further rack downwards
          run({ type: 'connectCable', from: { deviceId: torId, port: torPorts - 2 }, to: { deviceId: hub.torId, port: hubPorts - 1 - (racks.length - 1) } });
        }
        run({ type: 'setSwitchPort', switchId: torId, port: Array.from({ length: torPorts }, (_, i) => i), config: { mode: 'trunk', vlans: 'all', mtu: N.switchMtu } });
      }
    // 4. ESX on every host of the instance
    for (const dom of [inst.managementDomain, ...inst.workloadDomains])
      for (const cl of dom.clusters)
        for (const h of cl.hosts) {
          const serverId = hostServers[h.id] as string;
          run({ type: 'installEsx', serverId, method: 'physical' });
          const ip = `${N.hostIpPrefix}${N.hostIpStart + hostIndex++}`;
          run({ type: 'configureMgmtNetwork', serverId, ip, mask: N.mask, gw: N.gateway, vlan: N.mgmtVlan, dns: [N.dns], hostname: h.fqdn });
          run({ type: 'addDnsRecord', fqdn: h.fqdn, ip });
          run({ type: 'configureHostNtp', hostId: serverId, servers: [N.ntp] });
        }
  }
  return { session, hostServers, racks, commandCount, instanceRooms, nicAdjustments };
}
