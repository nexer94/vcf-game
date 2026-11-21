/**
 * SandboxSession snapshot -> RoomState (sessionPort.ts). THE ONLY PLACE that reads engine snapshot names:
 *   snapshot.physical (PhysicalView), snapshot.flows (FlowsView), snapshot.objectives (ObjectivesView).
 * Pure mapping, no rules.
 */
import type { FlowsView, PhysicalView } from '../../modes/sandbox/roomView';
import type { ObjectivesView, ObjectiveView as EngineObjective } from '../../modes/sandbox/objectives';
import type { ValidationIssue } from '../../model';
import {
  isCableColorId,
  type CableTraffic,
  type ObjectiveStatus,
  type ObjectiveView,
  type RoomCable,
  type RoomDevice,
  type RoomState,
  type ShopCatalog,
  type ShopPartItem,
  type ShopServerItem,
} from './sessionPort';

interface SnapshotLike {
  readonly revision?: number;
  readonly physical?: PhysicalView;
  readonly flows?: FlowsView;
  readonly objectives?: ObjectivesView;
}

const STATUS: Readonly<Record<EngineObjective['state'], ObjectiveStatus | null>> = {
  pending: 'todo',
  'in-progress': 'progress',
  done: 'done',
  regressed: 'problem',
  skipped: 'skipped',
  'blocked-spec': null,
};

export function objectivesOf(v: ObjectivesView | undefined): { items: ObjectiveView[]; hidden: boolean; nextId?: string } {
  if (!v || !v.available) return { items: [], hidden: v?.hidden ?? false };
  const items: ObjectiveView[] = [];
  for (const g of v.groups)
    for (const o of g.objectives) {
      const st = STATUS[o.state];
      if (!st) continue;
      items.push({
        id: o.id,
        title: o.title,
        kind: o.kind,
        status: st,
        group: g.title,
        ...(o.progress ? { progress: { done: o.progress.current, total: o.progress.target } } : {}),
        ...(o.why ? { specRef: o.why.specRef, docUrl: o.why.url } : {}),
        ...(o.showMe ? { showMe: o.showMe } : {}),
      });
    }
  return { items, hidden: v.hidden, ...(v.next ? { nextId: v.next.id } : {}) };
}

export function catalogOf(p: PhysicalView): ShopCatalog {
  const servers: ShopServerItem[] = [];
  const drives: ShopPartItem[] = [];
  const nics: ShopPartItem[] = [];
  const switches: ShopCatalog['switches'][number][] = [];
  const racks: ShopCatalog['racks'][number][] = [];
  for (const it of p.catalog.items) {
    switch (it.kind) {
      case 'server': {
        const c = it.config;
        const m = it.metrics;
        servers.push({
          kind: 'server', id: it.id, vendor: it.vendor, model: it.model, rackUnits: it.rackUnits,
          sockets: c.sockets, coresPerSocket: c.coresPerSocket, ramGB: c.ramGB,
          drives: c.drives.map((d) => {
            const part = p.catalog.items.find((x) => x.kind === 'drive' && x.id === d.partId);
            const dp = part && part.kind === 'drive' ? part.part : undefined;
            return { label: dp?.family ?? d.partId, count: d.count, capacityTB: dp?.capacityTB ?? 0, iface: dp?.interface ?? '?' };
          }),
          capacityTB: m?.nodeCapacityTB ?? 0,
          nics: c.nics.map((n) => {
            const part = p.catalog.items.find((x) => x.kind === 'nic' && x.id === n.partId);
            const np = part && part.kind === 'nic' ? part.part : undefined;
            return { label: np?.bomName ?? n.partId, count: n.count, ports: np?.ports ?? 0, speedsGbE: np?.speedsGbE ?? [] };
          }),
          nicPorts: m?.nicPorts ?? 0,
          maxNicGbE: m?.nodeNetworkGbE ?? 0,
          boot: c.boot.description,
          ...(it.esaProfile?.profile ? { profile: it.esaProfile.profile } : {}),
          profileNetworkLimited: it.esaProfile?.networkLimited ?? false,
          certified91: it.certified91,
          bcgUrl: it.bcgUrl,
          price: it.price,
        });
        break;
      }
      case 'drive':
        drives.push({ kind: 'drive', id: it.id, label: it.part.family, detail: `${it.part.interface} · ${it.part.capacityTB} TB`, oem: it.part.oem, ...(it.part.bcgDataUrl ? { bcgUrl: it.part.bcgDataUrl } : {}), price: it.price });
        break;
      case 'nic':
        nics.push({ kind: 'nic', id: it.id, label: it.part.bomName, detail: `${it.part.ports}× ${it.part.speedsGbE.join('/')} GbE`, ...(it.part.bcgDataUrl ? { bcgUrl: it.part.bcgDataUrl } : {}), price: it.price });
        break;
      case 'switch':
        switches.push({ kind: 'switch', id: it.id, label: it.model.label, ports: it.model.ports, speedsGbE: it.model.speedsGbE, maxMtu: it.model.maxMtu, defaultPortMtu: it.model.defaultPortMtu, rackUnits: it.model.rackUnits, price: it.price });
        break;
      case 'rack':
        racks.push({ kind: 'rack', id: it.id, label: it.model.label, heightU: it.model.heightU, price: it.price });
        break;
      default:
        break;
    }
  }
  return { servers, switches, racks, drives, nics, datasetFetchedAt: p.catalog.datasetFetchedAt, datasetRelease: p.catalog.datasetRelease };
}

export function roomStateFromSnapshot(raw: unknown): RoomState | null {
  const s = raw as SnapshotLike;
  const p = s.physical;
  if (!p) return null;
  const devices: RoomDevice[] = [
    ...p.servers.map((v): RoomDevice => ({
      id: v.id,
      kind: 'server',
      label: v.esx.network?.hostnameFqdn?.split('.')[0] ?? v.id,
      catalogItemId: v.catalogItemId ?? '',
      ...(v.vendor ? { vendor: v.vendor } : {}),
      modelLabel: v.modelName,
      heightU: v.rackUnits,
      ...(v.mount ? { mount: { rackId: v.mount.rackId, positionU: v.mount.positionU } } : {}),
      nicPorts: v.nicPorts.map((n) => ({ index: n.vmnic, label: n.label, speedsGbE: n.speedsGbE })),
      bmc: { label: v.bmc.label },
      switchPorts: 0,
      esxInstalled: v.status === 'esx-dhcp' || v.status === 'esx-static',
    })),
    ...p.switches.map((w): RoomDevice => ({
      id: w.id,
      kind: 'switch',
      // pre-installed wall-mounted OOB switch of the Sandbox (game scope, modes/sandbox/oob.ts)
      label: w.preinstalledOob ? `${w.id} (OOB, předinstalovaný)` : w.id,
      catalogItemId: w.modelId,
      modelLabel: w.label,
      heightU: w.rackUnits,
      ...(w.mount ? { mount: { rackId: w.mount.rackId, positionU: w.mount.positionU } } : {}),
      nicPorts: [],
      switchPorts: w.ports.length,
      switchSpeedsGbE: w.speedsGbE,
      esxInstalled: false,
    })),
  ];
  const cables: RoomCable[] = p.cables.map((c) => ({
    id: c.id,
    a: { deviceId: c.aEnd.deviceId, port: c.aEnd.port },
    b: { deviceId: c.bEnd.deviceId, port: c.bEnd.port },
    linkUp: c.link.up,
    ...(c.link.speedGbE !== undefined ? { speedGbE: c.link.speedGbE } : {}),
    bmc: c.bmc,
    color: isCableColorId(c.color) ? c.color : 'neutral',
    label: c.label ?? '',
  }));
  const issues: ValidationIssue[] = p.servers.flatMap((v) => {
    const t = v.topology;
    return [...t.errors, ...t.warnings, ...t.recommendations].map((i) => ({ ...i, subject: v.id }));
  });
  const traffic: CableTraffic[] = (s.flows?.links ?? [])
    .filter((l) => l.totalLoadGbps > 0)
    .map((l) => ({ cableId: l.cableId, ...(l.speedGbE !== undefined ? { speedGbE: l.speedGbE } : {}), byClass: l.loadGbpsByClass, utilization: l.utilization }));
  const obj = objectivesOf(s.objectives);
  return {
    revision: s.revision ?? 0,
    source: 'session',
    catalog: catalogOf(p),
    racks: p.racks.map((r) => ({ id: r.id, label: r.id, heightU: r.heightU, tile: r.placed && r.tile ? { gx: r.tile.gx, gy: r.tile.gy } : null, ...(r.facing ? { facing: r.facing } : {}) })),
    devices,
    cables,
    inventory: p.inventory
      .filter((i): i is typeof i & { kind: 'rack' | 'server' | 'switch' } => i.kind === 'rack' || i.kind === 'server' || i.kind === 'switch')
      .map((i) => ({ id: i.id, kind: i.kind, label: i.label, catalogItemId: i.itemId })),
    issues,
    traffic,
    objectives: obj.items,
    ...(obj.nextId ? { nextObjectiveId: obj.nextId } : {}),
    objectivesHidden: obj.hidden,
    spent: p.economy.spent,
    undo: p.undo,
    ...(p.companyNetwork ? { companyNetwork: { switchId: p.companyNetwork.switchId, port: p.companyNetwork.port } } : {}),
  };
}
