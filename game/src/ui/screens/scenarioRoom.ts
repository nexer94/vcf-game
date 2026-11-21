/**
 * "Hotové scénáře" – one fully deployed scenario (CLAUDE.md section 3), read-only.
 *
 *   top: HUD (← Scénáře, title, room switch, traffic note, time, ?)
 *   centre: the same isometric room renderer as the Sandbox (racks with ToR + servers, cables, traffic dots);
 *           no shop, no placement. Click a rack -> rack strip (hosts by U); click a host -> its VMs highlighted.
 *   right: panel VM · Zdroje · Hosty · O scénáři (ui/scenarios/scenarioPanel.ts).
 *   bottom-left: traffic legend chip.
 *
 * Data only through ONE adapter (ui/scenarios/scenarioSource.ts). Layout zones per UX ch. 22 (no shop, right panel).
 */
import { attachCameraControls, fitRect, type Camera, type CameraControls } from '../../render';
import { button, h } from '../dom';
import { message } from '../messages';
import { roomContentsOf } from '../sandbox/roomSync';
import { applyZoneVars, computeZones, type Zones } from '../sandbox/layoutZones';
import { closeSourcePopover, setSourceObstacles } from '../sandbox/sourcePopover';
import { createTrafficChip } from '../sandbox/trafficChip';
import { createTimeControls } from '../timeControls';
import { VCF_VERSION } from '../version';
import { presetById } from '../../model/deployedInventory';
import { createScenarioPanel, type ScenarioPanel } from '../scenarios/scenarioPanel';
import { loadScenario, type ScenarioSource } from '../scenarios/scenarioSource';
import type { RoomState } from '../sandbox/sessionPort';
import type { ScreenDef } from './screen';
import './room.css';
import '../sandbox/v3.css';
import '../scenarios/scenarios.css';

const KEYS: readonly [string, string][] = [
  ['Mezerník / P', 'pauza'],
  [', / .', 'zpomalit / zrychlit čas'],
  ['klik na rack', 'hosty v racku'],
  ['klik na host / VM', 'zvýraznit VM hostu / host VM'],
  ['1 – 4', 'záložky VM · Zdroje · Hosty · O scénáři'],
  ['L', 'legenda provozu'],
  ['Esc', 'zrušit výběr → zpět na seznam'],
  ['kolečko / tah · 0', 'zoom / posun / celá místnost'],
];

export const scenarioRoomScreen: ScreenDef = {
  stageMode: 'interactive',
  stageScene: 'room',
  mount(root, ctx, route) {
    const { stage, engine } = ctx;
    const room = stage.room;
    const canvas = stage.canvas;
    const presetId = route.name === 'scenario' ? route.id : '';
    const preset = presetById(presetId);
    room.clear();
    room.world.alpha = 1;
    room.world.visible = true;
    stage.rack.root.visible = false;
    let disposed = false;
    let src: ScenarioSource | null = null;
    let panel: ScenarioPanel | null = null;
    let roomId = '';
    let selHost: string | null = null;
    let selVm: string | null = null;
    let selRack: string | null = null;
    let offAttach: (() => void) | null = null;

    const ui = h('div', { class: 'ui-root room-ui scen-ui' });
    root.appendChild(ui);
    const live = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });

    // ------------------------------------------------------------ HUD
    const timeSlot = h('div', { class: 'room-time' });
    const time = createTimeControls(timeSlot, engine, 'stepped');
    const roomSelect = h('select', { 'aria-label': 'Přejít do místnosti', title: 'Přejít do místnosti', hidden: true }) as HTMLSelectElement;
    roomSelect.addEventListener('change', () => showRoom(roomSelect.value));
    const trafficNote = h('span', { class: 'hud-chip', hidden: true, title: 'Tečky provozu jsou jen animace – toky z modelu poběží, až scénářová session enginu dodá provoz.' }, 'Provoz ', h('small', null, 'ilustrativní'));
    const help = h('details', { class: 'legend-pop keys-pop help-pop' },
      h('summary', { 'aria-label': 'Nápověda a klávesy', title: 'Nápověda a klávesy' }, '?'),
      h('div', { class: 'legend-pop-body' }, h('strong', null, 'Klávesy'), h('dl', null, ...KEYS.flatMap(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)]))),
    );
    const titleEl = h('strong', null, preset?.title ?? 'Scénář');
    const hud = h('header', { class: 'room-hud v3' },
      button('← Scénáře', () => ctx.navigate({ name: 'scenarios' }), { class: 'btn btn-small', title: 'Zpět na seznam scénářů' }),
      h('div', { class: 'room-title scen-title' }, titleEl, h('span', { class: 'muted hud-ver' }, ` · ${VCF_VERSION}`)),
      h('span', { class: 'hud-chip', title: 'Hotový scénář – jen prohlížení, nic se neinstaluje' }, 'jen prohlížení'),
      roomSelect,
      h('span', { class: 'hud-mid' }, trafficNote),
      timeSlot,
      help,
    );
    ui.appendChild(hud);

    // ------------------------------------------------------------ rack strip (hosts by U)
    const strip = h('div', { class: 'scen-rack ui-panel', hidden: true, role: 'dialog', 'aria-label': 'Rack' });
    ui.appendChild(strip);
    const renderStrip = (): void => {
      if (!src || !selRack) {
        strip.hidden = true;
        return;
      }
      const st = src.roomState();
      const rack = st.racks.find((r) => r.id === selRack);
      const devs = st.devices.filter((d) => d.mount?.rackId === selRack).sort((a, b) => b.mount!.positionU - a.mount!.positionU);
      strip.replaceChildren(
        h('div', { class: 'scen-rack-head' }, h('strong', null, `Rack ${rack?.label ?? selRack}`), h('span', { class: 'muted small' }, ` ${rack?.heightU ?? ''}U`), h('span', { class: 'inv-spacer' }),
          button('×', () => selectRack(null), { class: 'btn btn-small', 'aria-label': 'Zavřít rack' })),
        h('ol', { class: 'scen-rack-units' }, ...devs.map((d) => {
          const hostId = d.kind === 'server' ? src!.hostOfDevice(d.id) : undefined;
          const host = hostId ? src!.model.hosts.find((x) => x.id === hostId) : undefined;
          const top = d.mount!.positionU + d.heightU - 1;
          const u = d.heightU > 1 ? `U${d.mount!.positionU}–${top}` : `U${d.mount!.positionU}`;
          const label = host ? `${host.label} · ${host.vmIds.length} VM` : d.kind === 'switch' && d.role === 'tor' && !/tor/i.test(d.label) ? `${d.label} (ToR)` : d.label;
          const inner = h('span', { class: 'scen-u' }, h('span', { class: 'scen-u-n' }, u), h('span', { class: 'scen-u-label' }, label), h('span', { class: 'muted small' }, d.modelLabel));
          return h('li', { class: `scen-unit u${Math.min(4, d.heightU)} ${d.kind}${hostId && hostId === selHost ? ' sel' : ''}` },
            hostId ? button(inner, () => selectHost(hostId === selHost ? null : hostId), { class: 'scen-u-btn', 'aria-pressed': hostId === selHost ? 'true' : 'false', title: 'Klik = zvýraznit VM tohoto hostu' }) : inner);
        })),
      );
      strip.hidden = false;
    };

    // ------------------------------------------------------------ zones + camera
    let zones: Zones = computeZones({ viewportW: innerWidth, viewportH: innerHeight, checklist: 'hidden', rightPanel: true, shop: 'none' });
    const relayout = (): void => {
      zones = computeZones({ viewportW: innerWidth, viewportH: innerHeight, checklist: 'hidden', rightPanel: true, shop: 'none' });
      applyZoneVars(ui, zones);
    };
    relayout();
    setSourceObstacles(() => zones.obstacles);
    const fitRoom = (): Camera => {
      const z = zones;
      const cam = fitRect(room.bounds, Math.max(200, z.scene.w), Math.max(200, z.scene.h), 24);
      return { x: cam.x, y: cam.y + z.scene.y, scale: cam.scale };
    };
    let hover: { wx: number; wy: number } | null = null;
    const tip = h('div', { class: 'ui-panel tooltip room-tip', role: 'tooltip', hidden: true });
    ui.appendChild(tip);
    let camera: CameraControls | null = attachCameraControls({
      element: canvas,
      initial: fitRoom(),
      onChange: (cam) => stage.setCamera(cam),
      onHover: (pos) => {
        hover = pos;
        if (!pos) tip.hidden = true;
        else showTip(pos.sx, pos.sy);
      },
      onClick: (pos) => {
        const cab = room.cabinetAtWorld(pos.wx, pos.wy);
        selectRack(cab?.kind === 'rack' ? (cab.id === selRack ? null : cab.id) : null);
      },
    });
    stage.setCamera(fitRoom());
    const showTip = (sx: number, sy: number): void => {
      const cab = hover ? room.cabinetAtWorld(hover.wx, hover.wy) : null;
      if (!cab || cab.kind !== 'rack' || !src) {
        tip.hidden = true;
        return;
      }
      const st = src.roomState();
      const hosts = st.devices.filter((d) => d.mount?.rackId === cab.id && d.kind === 'server').map((d) => src!.hostOfDevice(d.id)).filter((x): x is string => !!x);
      const vms = src.model.hosts.filter((x) => hosts.includes(x.id)).reduce((n, x) => n + x.vmIds.length, 0);
      tip.replaceChildren(h('strong', null, `Rack ${st.racks.find((r) => r.id === cab.id)?.label ?? cab.id}`), h('div', null, `${hosts.length} hostů · ${vms} VM`), h('div', null, 'klik = hosty v racku'));
      tip.style.transform = `translate(${Math.min(canvas.clientWidth - 260, sx + 14)}px, ${sy + 14}px)`;
      tip.hidden = false;
    };

    // ------------------------------------------------------------ traffic chip
    const chip = createTrafficChip((t) => room.setTrafficFilter(t));
    ui.appendChild(chip.el);

    // ------------------------------------------------------------ selection
    const rackLabelOfHost = (hostId: string): string | undefined => {
      const r = src?.rackOfHost(hostId);
      return r ? src!.roomState().racks.find((x) => x.id === r)?.label : undefined;
    };
    const syncSelection = (): void => {
      panel?.setSelection({ hostId: selHost, vmId: selVm });
      renderStrip();
    };
    function selectRack(id: string | null): void {
      selRack = id;
      renderStrip();
      strip.querySelector<HTMLButtonElement>('.scen-u-btn')?.focus({ preventScroll: true });
    }
    function selectHost(id: string | null): void {
      selHost = id;
      if (!id || (selVm && src?.model.vms.find((v) => v.id === selVm)?.hostId !== id)) selVm = null;
      if (id && src) {
        const r = src.rackOfHost(id);
        if (r) {
          const rr = src.roomOfRack(r);
          if (rr !== roomId) showRoom(rr);
          selRack = r;
        }
        const x = src.model.hosts.find((hh) => hh.id === id);
        live.textContent = x ? `Host ${x.label}: ${x.vmIds.length} VM` : '';
      }
      syncSelection();
    }
    function selectVm(id: string | null): void {
      selVm = id;
      const vm = id ? src?.model.vms.find((v) => v.id === id) : undefined;
      if (vm?.hostId) selectHost(vm.hostId);
      else syncSelection();
      if (vm) live.textContent = `${vm.name} běží na ${src?.model.hosts.find((x) => x.id === vm.hostId)?.label ?? '—'}`;
    }

    // ------------------------------------------------------------ room sync
    const applyRoom = (): void => {
      if (!src) return;
      const st: RoomState = src.roomState();
      room.syncContents(roomContentsOf({ ...st, racks: st.racks.filter((r) => r.tile && src!.roomOfRack(r.id) === roomId) }));
      const tr = src.traffic();
      room.setTrafficSource(tr.source);
      room.setBmcTransfers(tr.bmc);
      trafficNote.hidden = !tr.illustrative;
      room.setCompanyUplink(st.companyNetwork ? { deviceId: st.companyNetwork.switchId, port: st.companyNetwork.port } : null);
    };
    function showRoom(id: string): void {
      if (!src) return;
      const r = src.layout.rooms.find((x) => x.id === id) ?? src.layout.rooms[0]!;
      roomId = r.id;
      roomSelect.value = r.id;
      room.clear();
      room.setSize(r.size);
      room.resetAvatar({ gx: Math.floor(room.size.cols / 2), gy: room.size.rows - 2 });
      applyRoom();
      if (selRack && src.roomOfRack(selRack) !== roomId) selRack = null;
      camera?.set(fitRoom());
    }

    // ------------------------------------------------------------ load
    const loading = h('div', { class: 'scen-panel scen-loading' }, h('p', null, preset ? 'Načítám scénář…' : 'Neznámý scénář.'), preset ? '' : button('← Scénáře', () => ctx.navigate({ name: 'scenarios' }), { class: 'btn' }));
    ui.appendChild(loading);
    if (preset)
      loadScenario(preset.id).then((s) => {
        if (disposed) return;
        src = s;
        offAttach = s.attach(engine as never);
        roomSelect.replaceChildren(...s.layout.rooms.map((r) => h('option', { value: r.id }, `→ ${r.label}`)));
        roomSelect.hidden = s.layout.rooms.length < 2;
        const tr = s.traffic();
        panel = createScenarioPanel({
          model: s.model,
          illustrativeTraffic: tr.illustrative,
          origin: s.origin,
          ...(s.notes ? { notes: s.notes } : {}),
          rackLabelOfHost,
          onSelectHost: (id) => selectHost(id),
          onSelectVm: (id) => selectVm(id),
        });
        loading.replaceWith(panel.el);
        showRoom(s.layout.rooms[0]!.id);
        panel.setSelection({ hostId: null, vmId: null });
      }, (err: unknown) => {
        if (disposed) return;
        loading.replaceChildren(message({ type: 'game-limit', title: 'Scénář se nenačetl', body: String(err) }), button('← Scénáře', () => ctx.navigate({ name: 'scenarios' }), { class: 'btn' }));
      });

    // ------------------------------------------------------------ frame + keys
    let chipMs = 0;
    const offFrame = stage.onFrame((snap, real) => {
      time.update(snap);
      chipMs += real;
      if (chipMs > 250) {
        chipMs = 0;
        chip.update(room.activeTypes, room.bmcTransferActive);
      }
      const cab = hover ? room.cabinetAtWorld(hover.wx, hover.wy) : null;
      const hov = cab?.kind === 'rack' ? cab.id : null;
      room.setHighlightedCabinet(hov ?? selRack);
      canvas.style.cursor = hov ? 'pointer' : '';
    });
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) {
        if (e.key === 'Escape') (t as HTMLElement).blur();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (closeSourcePopover()) return;
        if (selVm || selHost) {
          selVm = null;
          selHost = null;
          syncSelection();
        } else if (selRack) selectRack(null);
        else ctx.navigate({ name: 'scenarios' });
        e.preventDefault();
      } else if (e.key === '0') camera?.set(fitRoom());
      else if (e.key === 'l' || e.key === 'L') chip.toggle();
      else if (panel && ['1', '2', '3', '4'].includes(e.key)) panel.setTab((['vm', 'zdroje', 'hosty', 'o'] as const)[Number(e.key) - 1]!);
    };
    window.addEventListener('keydown', onKey);
    const onResize = (): void => {
      relayout();
      camera?.set(fitRoom());
    };
    window.addEventListener('resize', onResize);

    return {
      dispose() {
        disposed = true;
        closeSourcePopover();
        offAttach?.();
        offFrame();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', onResize);
        camera?.dispose();
        camera = null;
        canvas.style.cursor = '';
        room.setHighlightedCabinet(null);
        room.setTrafficFilter(null);
        room.setTrafficSource(null);
        room.setBmcTransfers([]);
        room.setCompanyUplink(null);
        room.clear();
        chip.dispose();
        time.dispose();
        ui.remove();
      },
    };
  },
};
