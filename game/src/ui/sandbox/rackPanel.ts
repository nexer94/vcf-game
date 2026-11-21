/**
 * Rack view controller (UX.md §9): DOM layer over the Pixi front elevation (render/rack/rackView.ts).
 *
 *  - port buttons (real <button>s exactly over the ports: focus, aria-label, big hit cells) – drag or click-click,
 *    keyboard Enter; the port under the pointer grows 1.6x (drawn in Pixi)
 *  - cable popover (cosmetic colour / label, unplug), connections list (S) – keyboard / screen-reader path
 *  - validation badges at devices from MODEL issues (4 message types, UX §3.2), problems list
 *  - mounting from the backpack into an empty U (model decides if it fits)
 *
 * "Compatible port" highlighting is only a hint mirroring the model's game cabling rules (free port, servers to
 * switches); the model's connectCable decides.
 */
import { attachCameraControls, fitRect, zoomAt, type Camera, type CameraControls } from '../../render';
import { rowAt } from '../../render/rack/rackLayout';
import type { RackCableData, RackElevationView } from '../../render/rack/rackView';
import type { Pt } from '../../render/rack/rackRoute';
import type { ValidationIssue } from '../../model';
import { button, h } from '../dom';
import { chip, message, type MessageType } from '../messages';
import { icon, MESSAGE_ICON } from '../icons';
import { elevationRacks, linkTrafficOf } from './roomSync';
import { CABLE_COLORS, isCableColorId, portKeyId, type CableColorId, type PortKey, type RoomCable, type RoomDevice, type RoomPort, type RoomState } from './sessionPort';

const TOP_H = 52;
const BAR_H = 44;
const BOTTOM_H = 168;

export function issueMessageType(i: ValidationIssue): MessageType {
  if (i.scope === 'game-scope') return 'game-limit';
  if (i.severity === 'error') return 'vcf-error';
  return 'vcf-warning';
}



function issueTitle(i: ValidationIssue): string {
  const t = issueMessageType(i);
  if (t === 'game-limit') return 'Herní pravidlo';
  if (i.severity === 'recommendation') return 'Odchylka od doporučení';
  if (i.severity === 'warning') return 'Varování validace';
  return 'Podle dokumentace nelze';
}

export interface RackPanelOptions {
  readonly ui: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly view: RackElevationView;
  readonly port: RoomPort;
  readonly rackId: string;
  readonly announce: (text: string, bad?: boolean) => void;
  readonly onBack: () => void;
  readonly onOpenRack: (rackId: string) => void;
  readonly reducedMotion: () => boolean;
  readonly dpr: number;
  /** Open the object panel of a device (server / switch). */
  readonly onOpenDevice?: (deviceId: string) => void;
  /** Open the host network detail (UX §9.6). */
  readonly onOpenHost?: (serverId: string) => void;
  /** Extra toolbar items (undo / redo, DNS…), owned by the caller. */
  readonly toolbarExtra?: readonly HTMLElement[];
}

export interface RackPanel {
  /** Esc: cancel the hanging cable / close popover first; returns true when it consumed the key. */
  escape(): boolean;
  /** Camera that the view uses (for the crossfade). */
  readonly camera: Camera;
  dispose(): void;
}

function portLabel(s: RoomState, p: PortKey): string {
  const d = s.devices.find((x) => x.id === p.deviceId);
  if (!d) return `${p.deviceId}:${p.port}`;
  if (p.port === 'bmc') return `${d.label} BMC`;
  if (d.kind === 'switch') return `${d.label} p${p.port + 1}`;
  return `${d.label} ${d.nicPorts.find((n) => n.index === p.port)?.label ?? `NIC ${p.port + 1}`}`;
}

function parsePortId(id: string): PortKey {
  const i = id.lastIndexOf(':');
  const port = id.slice(i + 1);
  return { deviceId: id.slice(0, i), port: port === 'bmc' ? 'bmc' : Number(port) };
}

export function createRackPanel(o: RackPanelOptions): RackPanel {
  const { ui, canvas, view, port } = o;
  let state = port.state();
  let selectedCable: string | null = null;
  let pending: { from: string; cursor: Pt | null } | null = null;
  let drag: { from: string; x: number; y: number; moved: boolean } | null = null;
  let suppressClick = false;
  let armed: string | null = null;
  let showTraffic = true;
  let showList = false;

  // ------------------------------------------------------------- DOM
  const title = h('strong', null, '');
  const subtitle = h('span', { class: 'muted' }, '');
  const trafficToggle = h('input', { type: 'checkbox', id: 'rack-traffic' });
  trafficToggle.checked = true;
  const listBtn = button('Seznam zapojení (S)', () => toggleList(), { class: 'btn btn-small', 'aria-expanded': 'false', 'aria-controls': 'rack-list' });
  const otherRacks = h('span', { class: 'rack-others' });
  const bar = h('div', { class: 'rack-bar', role: 'toolbar', 'aria-label': 'Pohled racku' },
    button('← Místnost', () => o.onBack(), { class: 'btn btn-small', title: 'Zpět (Esc)' }),
    h('div', { class: 'rack-title' }, title, ' ', subtitle),
    otherRacks,
    h('label', { class: 'inv-check', for: 'rack-traffic' }, trafficToggle, ' provoz'),
    listBtn,
    ...(o.toolbarExtra ?? []),
  );
  const deviceLayer = h('div', { class: 'rack-devbtns', 'aria-label': 'Zařízení v racku' });
  const portLayer = h('div', { class: 'rack-ports', 'aria-label': 'Porty zařízení' });
  const badgeLayer = h('div', { class: 'rack-badges' });
  const popover = h('div', { class: 'cable-pop', role: 'dialog', 'aria-label': 'Kabel', hidden: true });
  const list = h('div', { class: 'rack-list', id: 'rack-list', hidden: true, role: 'region', 'aria-label': 'Seznam zapojení' });
  const problems = h('div', { class: 'rack-problems', role: 'region', 'aria-label': 'Problémy' });
  const mountBox = h('div', { class: 'rack-mount' });
  const hint = h('p', { class: 'rack-hint' }, '');
  const bottom = h('footer', { class: 'rack-bottom', 'aria-label': 'Kabely' },
    h('div', { class: 'rack-bottom-col' }, h('strong', null, 'Kabely'), ' ', chip('zdarma – herní zjednodušení', 'badge-generic'), hint, mountBox),
    problems,
  );
  const root = h('div', { class: 'rack-ui' }, deviceLayer, portLayer, badgeLayer, bar, list, popover, bottom);
  ui.appendChild(root);

  // ------------------------------------------------------------- camera
  const area = (): { w: number; h: number } => ({ w: canvas.clientWidth, h: canvas.clientHeight - TOP_H - BAR_H - BOTTOM_H });
  const fit = (): Camera => {
    const L = view.layout;
    const a = area();
    const cam = fitRect({ x: 0, y: 0, width: L.width, height: L.height }, Math.max(200, a.w), Math.max(150, a.h), 8);
    const scale = Math.min(cam.scale, 2.2);
    return { x: (a.w - L.width * scale) / 2, y: TOP_H + BAR_H + Math.max(0, (a.h - L.height * scale) / 2), scale };
  };
  let cam: Camera = { x: 0, y: 0, scale: 1 };
  let controls: CameraControls | null = null;
  const applyCamera = (c: Camera): void => {
    cam = c;
    view.setCamera(c, o.dpr);
    layoutDom();
  };
  const toLocal = (sx: number, sy: number): Pt => ({ x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale });

  // ------------------------------------------------------------- data -> view
  function deviceOf(id: string): RoomDevice | undefined {
    return state.devices.find((d) => d.id === id);
  }

  function cableAt(p: string): RoomCable | undefined {
    const k = parsePortId(p);
    return state.cables.find((c) => (c.a.deviceId === k.deviceId && c.a.port === k.port) || (c.b.deviceId === k.deviceId && c.b.port === k.port));
  }

  function compatible(from: string): Set<string> {
    const f = parsePortId(from);
    const fd = deviceOf(f.deviceId);
    const out = new Set<string>();
    for (const p of view.layout.ports.values()) {
      if (p.id === from || p.deviceId === f.deviceId || cableAt(p.id)) continue;
      const td = deviceOf(p.deviceId);
      if (!fd || !td) continue;
      if (fd.kind === 'server' && td.kind === 'server') continue;
      out.add(p.id);
    }
    return out;
  }

  function sync(): void {
    state = port.state();
    const racks = elevationRacks(state, o.rackId);
    if (!racks.length) {
      o.onBack();
      return;
    }
    const cables: RackCableData[] = state.cables.map((c) => ({
      id: c.id,
      a: portKeyId(c.a),
      b: portKeyId(c.b),
      color: CABLE_COLORS[c.color].color,
      linkUp: c.linkUp,
      bmc: c.bmc,
    }));
    const devState = new Map(state.devices.map((d) => [d.id, { esxInstalled: d.esxInstalled, ...(state.companyNetwork?.switchId === d.id ? { companyUplinkPort: state.companyNetwork.port } : {}) }]));
    const before = view.layout;
    view.setData(racks, cables, devState);
    view.setTraffic(linkTrafficOf(state), showTraffic);
    if (before !== view.layout && (before.width !== view.layout.width || before.height !== view.layout.height || !controls)) {
      const c = fit();
      if (controls) controls.set(c);
      else applyCamera(c);
    }
    const rack = state.racks.find((r) => r.id === o.rackId)!;
    const inRack = state.devices.filter((d) => d.mount?.rackId === o.rackId);
    title.textContent = `Rack ${rack.label}`;
    subtitle.textContent = `· ${inRack.filter((d) => d.kind === 'server').length} serverů · ${inRack.filter((d) => d.kind === 'switch').length} switchů`;
    otherRacks.replaceChildren(
      ...state.racks.filter((r) => r.tile && r.id !== o.rackId).map((r) => button(`${r.label} ▶`, () => o.onOpenRack(r.id), { class: 'btn btn-small', title: `Otevřít rack ${r.label}` })),
    );
    if (selectedCable && !state.cables.some((c) => c.id === selectedCable)) selectCable(null);
    renderPorts();
    renderDeviceButtons();
    renderBadges();
    renderProblems();
    renderMount();
    renderList();
    renderPopover();
    updateHint();
    layoutDom();
  }

  // ------------------------------------------------------------- ports (DOM targets)
  const portButtons = new Map<string, HTMLButtonElement>();
  function portAria(id: string): string {
    const k = parsePortId(id);
    const d = deviceOf(k.deviceId);
    const label = portLabel(state, k);
    const speeds = k.port === 'bmc' ? '' : d?.kind === 'server' ? d.nicPorts.find((n) => n.index === k.port)?.speedsGbE.join('/') : d?.switchSpeedsGbE?.join('/');
    const c = cableAt(id);
    const peer = c ? (c.a.deviceId === k.deviceId && c.a.port === k.port ? c.b : c.a) : null;
    const link = c ? (c.linkUp ? `zapojeno do ${portLabel(state, peer!)}` : `zapojeno do ${portLabel(state, peer!)}, link nenaběhl`) : 'volný';
    return `${label}${speeds ? `, ${speeds} GbE` : ''}${k.port === 'bmc' ? ' (mimo VCF scope – herní)' : ''}, ${link}`;
  }

  function renderPorts(): void {
    const want = new Set(view.layout.ports.keys());
    for (const [id, b] of portButtons) if (!want.has(id)) {
      b.remove();
      portButtons.delete(id);
    }
    for (const id of want) {
      let b = portButtons.get(id);
      if (!b) {
        b = h('button', { type: 'button', class: 'port-btn', 'data-port': id });
        const pid = id;
        b.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          drag = { from: pid, x: e.clientX, y: e.clientY, moved: false };
        });
        b.addEventListener('click', () => {
          if (suppressClick) {
            suppressClick = false;
            return;
          }
          portActivate(pid);
        });
        b.addEventListener('pointerenter', () => view.setHoverPort(pid));
        b.addEventListener('pointerleave', () => view.setHoverPort(null));
        b.addEventListener('focus', () => view.setHoverPort(pid));
        b.addEventListener('blur', () => view.setHoverPort(null));
        b.addEventListener('keydown', (e) => portKey(e, pid));
        portButtons.set(id, b);
        portLayer.appendChild(b);
      }
      b.setAttribute('aria-label', portAria(id));
      b.title = portAria(id);
      b.setAttribute('aria-pressed', String(pending?.from === id));
    }
  }

  function portKey(e: KeyboardEvent, id: string): void {
    // Arrow keys jump between compatible ports while a cable hangs (UX §9.3).
    if (!pending || !e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const comp = [...compatible(pending.from)].map((p) => view.layout.ports.get(p)!);
    const cur = view.layout.ports.get(id)!;
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key] as [number, number] | undefined;
    if (!dir) return;
    let best: string | null = null;
    let bestD = Infinity;
    for (const p of comp) {
      const dx = p.x - cur.x;
      const dy = p.y - cur.y;
      if (dx * dir[0] + dy * dir[1] <= 0) continue;
      const d = Math.hypot(dx, dy) + Math.abs(dir[0] ? dy : dx) * 2;
      if (d < bestD) {
        bestD = d;
        best = p.id;
      }
    }
    if (best) portButtons.get(best)?.focus();
  }

  function portActivate(id: string): void {
    if (pending) {
      if (pending.from === id) return cancelPending();
      return finishCable(pending.from, id);
    }
    const existing = cableAt(id);
    if (existing && !armed) {
      selectCable(existing.id);
      return;
    }
    startPending(id, null);
  }

  function startPending(from: string, cursor: Pt | null): void {
    pending = { from, cursor };
    selectCable(null);
    view.setPending({ from, cursor, compatible: compatible(from) });
    portButtons.get(from)?.setAttribute('aria-pressed', 'true');
    updateHint();
    o.announce(`Kabel z ${portLabel(state, parsePortId(from))}. Vyber cílový port (šipky skáčou mezi volnými), Esc zruší.`);
  }

  function cancelPending(): void {
    if (!pending) return;
    portButtons.get(pending.from)?.setAttribute('aria-pressed', 'false');
    pending = null;
    view.setPending(null);
    updateHint();
  }

  function finishCable(from: string, to: string): void {
    const a = parsePortId(from);
    const b = parsePortId(to);
    cancelPending();
    const r = port.connectCable(a, b);
    if (r.ok) o.announce(`Zapojeno: ${portLabel(state, a)} do ${portLabel(state, b)}.`);
    else o.announce(`Nelze: ${r.message}`, true);
  }

  const onWinMove = (e: PointerEvent): void => {
    if (drag && !drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
      drag.moved = true;
      startPending(drag.from, null);
    }
    if (pending) {
      const r = canvas.getBoundingClientRect();
      pending.cursor = toLocal(e.clientX - r.left, e.clientY - r.top);
      view.setPending({ from: pending.from, cursor: pending.cursor, compatible: compatible(pending.from) });
    }
  };
  const onWinUp = (e: PointerEvent): void => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-port]');
    const to = target?.dataset['port'];
    if (to && to !== d.from) finishCable(d.from, to);
    else cancelPending();
  };
  window.addEventListener('pointermove', onWinMove);
  window.addEventListener('pointerup', onWinUp);
  portLayer.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    controls?.set(zoomAt(cam, Math.exp(-dy * 0.0015), e.clientX - r.left, e.clientY - r.top, 0.3, 3));
  }, { passive: false });

  // ------------------------------------------------------------- device buttons (open object panel)
  function renderDeviceButtons(): void {
    deviceLayer.replaceChildren();
    if (!o.onOpenDevice) return;
    for (const d of view.layout.devices.values()) {
      const dev = deviceOf(d.id);
      if (!dev) continue;
      const b = button('', () => o.onOpenDevice!(d.id), {
        class: 'dev-btn',
        'data-devbtn': d.id,
        title: `${dev.label}: otevřít panel (Enter)${dev.kind === 'server' ? ' · dvojklik = síť hosta' : ''}`,
        'aria-label': `${dev.kind === 'server' ? 'Server' : 'Switch'} ${dev.label} – otevřít panel`,
      });
      if (dev.kind === 'server' && o.onOpenHost) b.addEventListener('dblclick', () => o.onOpenHost!(d.id));
      deviceLayer.appendChild(b);
    }
  }

  // ------------------------------------------------------------- badges + problems (model issues)
  function issuesOf(deviceId: string): ValidationIssue[] {
    return state.issues.filter((i) => i.subject === deviceId);
  }

  function renderBadges(): void {
    badgeLayer.replaceChildren();
    for (const d of view.layout.devices.values()) {
      const iss = issuesOf(d.id);
      if (!iss.length) continue;
      const worst = iss.find((i) => issueMessageType(i) === 'vcf-error') ?? iss.find((i) => issueMessageType(i) === 'vcf-warning') ?? iss[0]!;
      const t = issueMessageType(worst);
      const b = button(h('span', { class: 'dev-badge-in' }, icon(MESSAGE_ICON[t]), String(iss.length)), () => problems.querySelector<HTMLElement>(`[data-subject="${CSS.escape(d.id)}"]`)?.focus(), {
        class: `dev-badge dev-badge-${t}`,
        'data-device': d.id,
        title: iss.map((i) => `${issueTitle(i)}: ${i.message}`).join('\n'),
        'aria-label': `${deviceOf(d.id)?.label ?? d.id}: ${iss.length} hlášení – ${issueTitle(worst)}`,
      });
      badgeLayer.appendChild(b);
    }
  }

  function renderProblems(): void {
    const inView = new Set(view.layout.devices.keys());
    const iss = state.issues.filter((i) => i.subject && inView.has(i.subject));
    problems.replaceChildren(h('strong', null, `Problémy (${iss.length})`));
    if (!iss.length) {
      problems.append(h('p', { class: 'ok-line' }, state.cables.length ? '✓ Vše v pořádku' : 'Zatím nic – zapoj servery do switche.'));
      return;
    }
    for (const i of iss) {
      const box = message({
        type: issueMessageType(i),
        compact: true,
        title: `${deviceOf(i.subject!)?.label ?? i.subject}: ${issueTitle(i)}`,
        body: i.message,
        bodyLang: 'en',
        reference: `${i.specRef} · ${i.code}`,
      });
      box.tabIndex = -1;
      box.dataset['subject'] = i.subject!;
      problems.append(box);
    }
  }

  // ------------------------------------------------------------- mounting from the backpack
  function renderMount(): void {
    const devs = state.inventory.filter((e) => e.kind !== 'rack');
    mountBox.replaceChildren();
    if (!devs.length) return;
    mountBox.append(h('span', { class: 'muted' }, 'Do racku: '));
    for (const e of devs) {
      const on = armed === e.id;
      mountBox.append(
        button(on ? `${e.label} – klikni na volné U` : e.label, () => {
          armed = on ? null : e.id;
          renderMount();
          updateHint();
        }, { class: `btn btn-small${on ? ' btn-primary' : ''}`, 'aria-pressed': String(on), title: 'Vyber a pak klikni na volnou pozici v racku' }),
      );
    }
    if (armed) mountBox.append(button('Nejnižší volná pozice', () => mountArmed(undefined), { class: 'btn btn-small' }));
  }

  function mountArmed(u: number | undefined): void {
    if (!armed) return;
    const id = armed;
    const r = port.mountDevice(id, o.rackId, u);
    if (r.ok) {
      armed = null;
      o.announce(`Zarackováno: ${id}.`);
    } else o.announce(`Nelze: ${r.message}`, true);
  }

  // ------------------------------------------------------------- cables: popover + list
  function selectCable(id: string | null): void {
    selectedCable = id;
    view.setSelectedCable(id);
    renderPopover();
  }

  function renderPopover(): void {
    const c = selectedCable ? state.cables.find((x) => x.id === selectedCable) : undefined;
    popover.hidden = !c;
    popover.replaceChildren();
    if (!c) return;
    const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Barva kabelu (jen tvoje značení)' },
      ...(Object.keys(CABLE_COLORS) as CableColorId[]).map((k) => {
        const b = button('', () => port.setCableMeta(c.id, { color: k }), {
          class: 'swatch',
          role: 'radio',
          'aria-checked': String(c.color === k),
          'aria-label': CABLE_COLORS[k].label,
          title: CABLE_COLORS[k].label,
          style: `background:#${CABLE_COLORS[k].color.toString(16).padStart(6, '0')}`,
        });
        return b;
      }),
    );
    const label = h('input', { type: 'text', maxlength: '24', value: c.label, 'aria-label': 'Popisek kabelu (max. 24 znaků)', placeholder: 'popisek' });
    label.addEventListener('change', () => port.setCableMeta(c.id, { label: label.value }));
    popover.append(
      h('div', { class: 'pop-head' }, h('strong', null, `${portLabel(state, c.a)} ⇄ ${portLabel(state, c.b)}`), button('✖', () => selectCable(null), { class: 'btn btn-small', 'aria-label': 'Zavřít' })),
      h('div', { class: 'pop-line' },
        c.linkUp ? `link ● ${c.speedGbE ?? '?'} GbE` : '▲ link nenaběhl (žádná společná rychlost)',
        ' ',
        chip('herní pravidlo', 'badge-generic', 'Rychlost linku = nejvyšší společná rychlost obou konců (herní zjednodušení)'),
        c.bmc ? chip('BMC – mimo VCF scope – herní', 'badge-outscope') : null,
      ),
      h('div', { class: 'pop-line' }, 'Barva: ', swatches),
      h('p', { class: 'muted small' }, 'Barva kabelu je jen tvoje značení (jako v reálné serverovně).'),
      h('div', { class: 'pop-line' }, label, button('Odpojit', () => {
        const r = port.disconnectCable(c.id);
        if (r.ok) o.announce(`Odpojeno: ${portLabel(state, c.a)} – ${portLabel(state, c.b)}.`);
      }, { class: 'btn btn-small btn-danger' })),
    );
    layoutDom();
  }

  function toggleList(force?: boolean): void {
    showList = force ?? !showList;
    list.hidden = !showList;
    listBtn.setAttribute('aria-expanded', String(showList));
    renderList();
  }

  function renderList(): void {
    if (!showList) return;
    const devIds = new Set(view.layout.devices.keys());
    const rows = state.cables.filter((c) => devIds.has(c.a.deviceId) || devIds.has(c.b.deviceId));
    const freeServers = state.devices.filter((d) => d.kind === 'server' && devIds.has(d.id));
    list.replaceChildren(
      h('div', { class: 'pop-head' }, h('strong', null, `Zapojení (${rows.length})`), button('✖', () => toggleList(false), { class: 'btn btn-small', 'aria-label': 'Zavřít seznam' })),
      rows.length
        ? h('table', { class: 'conn-table' },
            h('thead', null, h('tr', null, h('th', null, 'Odkud'), h('th', null, 'Kam'), h('th', null, 'Stav'), h('th', null, 'Barva'), h('th', null, ''))),
            h('tbody', null, ...rows.map((c) => h('tr', null,
              h('td', null, portLabel(state, c.a)),
              h('td', null, portLabel(state, c.b)),
              h('td', null, c.linkUp ? `● ${c.speedGbE} GbE` : '▲ link down', c.bmc ? ' · BMC (herní)' : ''),
              h('td', null, CABLE_COLORS[isCableColorId(c.color) ? c.color : 'neutral'].label),
              h('td', null,
                button('Vybrat', () => selectCable(c.id), { class: 'btn btn-small' }),
                button('Odpojit', () => port.disconnectCable(c.id), { class: 'btn btn-small btn-danger', 'aria-label': `Odpojit ${portLabel(state, c.a)} – ${portLabel(state, c.b)}` }),
              ),
            ))),
          )
        : h('p', null, 'Zatím žádné kabely.'),
      h('p', { class: 'muted small' }, `Serverů v pohledu: ${freeServers.length}. Zapojit: vyber port (Tab / Enter), pak cílový port – stejné jako myší.`),
    );
  }

  function updateHint(): void {
    hint.textContent = pending
      ? `Kabel visí z ${portLabel(state, parsePortId(pending.from))} – klikni na zvýrazněný port (Esc = zrušit).`
      : armed
        ? 'Klikni na volnou pozici (U) v racku, kam server / switch zasuneš.'
        : 'Táhni z portu na port, nebo klikni na port a pak na cíl. Klik na kabel = detail.';
  }

  // ------------------------------------------------------------- layout of DOM over the canvas
  function layoutDom(): void {
    const s = cam.scale;
    for (const [id, b] of portButtons) {
      const p = view.layout.ports.get(id);
      if (!p) continue;
      const x = cam.x + p.cell.x * s;
      const y = cam.y + p.cell.y * s;
      b.style.transform = `translate(${x}px, ${y}px)`;
      b.style.width = `${p.cell.w * s}px`;
      b.style.height = `${p.cell.h * s}px`;
    }
    for (const b of deviceLayer.children) {
      const id = (b as HTMLElement).dataset['devbtn'];
      const d = id ? view.layout.devices.get(id) : undefined;
      if (!d) continue;
      const w = d.kind === 'server' ? 210 : 74;
      const el = b as HTMLElement;
      el.style.transform = `translate(${cam.x + (d.x + 14) * s}px, ${cam.y + (d.y + 1) * s}px)`;
      el.style.width = `${w * s}px`;
      el.style.height = `${Math.max(12, (d.h - 2) * s)}px`;
    }
    for (const b of badgeLayer.children) {
      const id = (b as HTMLElement).dataset['device'];
      const d = id ? view.layout.devices.get(id) : undefined;
      if (!d) continue;
      (b as HTMLElement).style.transform = `translate(${cam.x + (d.x + d.w - 150) * s}px, ${cam.y + d.y * s - 8}px)`;
    }
    const c = selectedCable ? view.route(selectedCable) : undefined;
    if (c && !popover.hidden) {
      const mid = c[Math.floor(c.length / 2)]!;
      const x = Math.min(canvas.clientWidth - 330, Math.max(8, cam.x + mid.x * s + 16));
      const y = Math.min(canvas.clientHeight - BOTTOM_H - 200, Math.max(TOP_H + BAR_H + 8, cam.y + mid.y * s - 40));
      popover.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  // ------------------------------------------------------------- canvas input (pan / zoom / pick)
  controls = attachCameraControls({
    element: canvas,
    initial: fit(),
    onChange: (c) => applyCamera({ ...c, scale: Math.min(3, Math.max(0.3, c.scale)) }),
    onHover: (pos) => {
      if (!pos) return view.setHoverCable(null);
      if (pending) {
        pending.cursor = toLocal(pos.sx, pos.sy);
        view.setPending({ from: pending.from, cursor: pending.cursor, compatible: compatible(pending.from) });
      }
      const l = toLocal(pos.sx, pos.sy);
      const id = view.cableAt(l.x, l.y, 6 / cam.scale);
      view.setHoverCable(id);
      canvas.style.cursor = id ? 'pointer' : armed && rowAt(view.layout, l.x, l.y)?.row.kind === 'empty' ? 'copy' : '';
    },
    onClick: (pos) => {
      const l = toLocal(pos.sx, pos.sy);
      if (pending) return cancelPending();
      const hit = rowAt(view.layout, l.x, l.y);
      if (armed && hit && hit.row.kind === 'empty' && hit.column.rackId === o.rackId) return mountArmed(hit.row.bottomU);
      if (armed && hit && hit.row.kind === 'empty') return mountArmed(undefined);
      const cab = view.cableAt(l.x, l.y, 8 / cam.scale);
      if (!cab && hit && hit.row.kind === 'device' && o.onOpenDevice) return o.onOpenDevice(hit.row.deviceId);
      selectCable(cab);
    },
  });
  applyCamera(controls.camera);

  trafficToggle.addEventListener('change', () => {
    showTraffic = trafficToggle.checked;
    view.setTraffic(linkTrafficOf(state), showTraffic);
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (e.key === 's' || e.key === 'S') toggleList();
    else if ((e.key === 'Delete' || e.key === 'Del') && selectedCable) port.disconnectCable(selectedCable);
    else if (e.key === '+' || e.key === '=') controls?.set(zoomAt(cam, 1.2, canvas.clientWidth / 2, canvas.clientHeight / 2, 0.3, 3));
    else if (e.key === '-') controls?.set(zoomAt(cam, 1 / 1.2, canvas.clientWidth / 2, canvas.clientHeight / 2, 0.3, 3));
    else if (e.key === '0') controls?.set(fit());
  };
  window.addEventListener('keydown', onKey);
  const onResize = (): void => controls?.set(fit());
  window.addEventListener('resize', onResize);
  const off = port.subscribe(sync);
  view.root.visible = true;
  sync();

  return {
    escape() {
      if (pending) {
        cancelPending();
        return true;
      }
      if (armed) {
        armed = null;
        renderMount();
        updateHint();
        return true;
      }
      if (selectedCable) {
        selectCable(null);
        return true;
      }
      if (showList) {
        toggleList(false);
        return true;
      }
      return false;
    },
    get camera() {
      return cam;
    },
    dispose() {
      off();
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      controls?.dispose();
      controls = null;
      view.setPending(null);
      view.setHoverPort(null);
      view.setSelectedCable(null);
      view.root.visible = false;
      canvas.style.cursor = '';
      root.remove();
    },
  };
}
