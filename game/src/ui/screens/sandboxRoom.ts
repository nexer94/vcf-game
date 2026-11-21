/**
 * Sandbox server room (UX.md Part II):
 *   top: HUD (money ∞ + spent, "Další krok" from the objectives tracker, time, keys, ⚙)
 *   centre: isometric room (racks = interactive objects: hover outline + magnifier + tooltip, click = rack view)
 *   bottom: shop + backpack; bottom-left: traffic legend chip "Provoz ▾"; right: design-decisions panel.
 *
 * View stack (UX §7): Místnost -> Rack (2D elevation, cabling) / Tabule / Počítač (placeholders). Esc = one level up.
 * State lives behind ONE adapter (ui/sandbox/sessionPort.ts); this screen never decides VCF rules.
 */
import { attachCameraControls, fitRect, type Camera, type CameraControls } from '../../render';
import type { Tile } from '../../render/room/roomGrid';
import { cameraOnto, transitionDuration, transitionFrame, type TransitionDirection } from '../../render/room/viewTransition';
import { button, h } from '../dom';
import { message } from '../messages';
import { loadDesignStepData } from '../sandbox/designData';
import { sharedDesignState } from '../sandbox/designState';
import { createDesignViewState, renderDesignStep, restoreDesignFocus } from '../sandbox/designStep';
import { buildDemoRoom } from '../sandbox/demoRoom';
// Sprint 2B: desk + computer and whiteboard (ui/pc/roomHooks.ts).
import { createRoomObjectHooks, isFixtureId } from '../pc/roomHooks';
import { createHostDetail, type HostDetail } from '../sandbox/hostDetail';
import { createObjectPanels } from '../sandbox/objectPanels';
import { resolveShowMe } from '../sandbox/panelData';
import { createRackPanel, type RackPanel } from '../sandbox/rackPanel';
import { bmcTransfersOf, linkTrafficOf, roomContentsOf, StaticTrafficSource } from '../sandbox/roomSync';
import { parentView, ROOM_VIEW, sameView, viewLabel, type RoomView } from '../sandbox/roomViews';
import { createDemoRoomPort, sharedRoomPort, type InventoryEntry, type ObjectiveView, type RoomPort, type RoomState } from '../sandbox/sessionPort';
import { createShop, formatPrice } from '../sandbox/shop';
import { createTrafficChip } from '../sandbox/trafficChip';
import { createTimeControls } from '../timeControls';
// Multi-room sites ("Výběr lokality"): layout adapter, overview, door.
import { roomDoor } from '../../render/room/roomStatic';
import { createSiteOverview } from '../sandbox/siteOverview';
import { AZ_CYCLE, azText, doorTarget, roomOf, sharedSitePort, type SiteRoomView } from '../sandbox/siteLayout';
import { VCF_VERSION } from '../version';
import type { Route } from '../router';
import type { ScreenDef } from './screen';
import './room.css';
import './site.css';

const ROOM_KEYS: readonly [string, string][] = [
  ['Mezerník / P', 'pauza'],
  [', / .', 'zpomalit / zrychlit čas (1× · 4× · 16×)'],
  ['1–7', 'kategorie obchodu (když má fokus obchod)'],
  ['E / Enter', 'otevřít rack / tabuli / počítač pod kurzorem'],
  ['Shift+D', 'počítač → Návrh VCF'],
  ['Esc / Backspace', 'zrušit → o úroveň zpět'],
  ['D', 'panel Návrh'],
  ['L', 'legenda provozu'],
  ['T / Shift+T', 'úkoly rozbalit / skrýt'],
  ['S (v racku)', 'seznam zapojení'],
  ['Enter / klik na server či switch', 'panel zařízení (v racku)'],
  ['Ctrl+Z / Ctrl+Y', 'vrátit / zopakovat změnu místnosti'],
  ['kolečko / tah · + − 0', 'zoom / posun / celá místnost'],
];

const TOP_H = 52;
const BOTTOM_H = 196;
const SIDE_W = 380;
const SIDE_TAB_W = 44;
const TOOLTIP_DELAY_MS = 400;

const OBJ_ICON: Readonly<Record<ObjectiveView['status'], string>> = { todo: '○', progress: '◐', done: '✓', skipped: '⤼', problem: '⚠' };

function keysHelp(): HTMLElement {
  return h('details', { class: 'legend-pop keys-pop' },
    h('summary', { 'aria-label': 'Klávesové zkratky', title: 'Klávesové zkratky' }, '⌨'),
    h('div', { class: 'legend-pop-body' },
      h('strong', null, 'Klávesové zkratky'),
      h('dl', null, ...ROOM_KEYS.flatMap(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])),
    ),
  );
}

const viewOf = (r: Route): RoomView => (r.name === 'sandbox-room' && r.view ? r.view : ROOM_VIEW);
const prefersReduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const sandboxRoomScreen: ScreenDef = {
  stageMode: 'interactive',
  stageScene: 'room',
  mount(root, ctx, route) {
    const { stage, engine } = ctx;
    const room = stage.room;
    const canvas = stage.canvas;
    // Site layout (adapter; engine integration later): which room of the site this screen shows.
    const site = sharedSitePort();
    let roomId = roomOf(site.layout(), route.name === 'sandbox-room' ? route.roomId : undefined).id;
    const multiRoom = (): boolean => site.layout().rooms.length > 1;
    const curRoom = (): SiteRoomView => roomOf(site.layout(), roomId);
    room.clear();
    room.setSize(curRoom().size);
    const startTile: Tile = { gx: Math.floor(room.size.cols / 2), gy: room.size.rows - 2 };
    room.resetAvatar(startTile);
    room.world.alpha = 1;
    room.world.visible = true;
    let demo = route.name === 'sandbox-room' && route.demo;
    let view: RoomView = viewOf(route);
    let reducedMotion = prefersReduced();
    let port: RoomPort | null = null;
    let state: RoomState | null = null;
    let offPort: (() => void) | null = null;
    let picked: InventoryEntry | null = null;
    let disposed = false;

    const ui = h('div', { class: 'ui-root room-ui' });
    root.appendChild(ui);
    const live = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });
    const liveBad = h('div', { class: 'sr-only', 'aria-live': 'assertive' });
    const toast = h('span', { class: 'room-toast', 'aria-hidden': 'true' });
    const say = (text: string, bad = false): void => {
      toast.textContent = text;
      toast.classList.toggle('bad', bad);
      (bad ? liveBad : live).textContent = text;
    };

    // ------------------------------------------------------------ HUD
    const spentEl = h('small', null, 'herní');
    const nextChip = button('', () => toggleTracker(), { class: 'hud-chip phase-chip', 'aria-expanded': 'false', 'aria-controls': 'room-tracker', title: 'Další krok (T)' });
    const timeSlot = h('div', { class: 'room-time' });
    const demoToggle = h('input', { type: 'checkbox', id: 'room-demo' });
    demoToggle.checked = demo;
    const motionToggle = h('input', { type: 'checkbox', id: 'room-motion' });
    motionToggle.checked = reducedMotion;
    const settings = h('details', { class: 'legend-pop keys-pop settings-pop' },
      h('summary', { 'aria-label': 'Nastavení', title: 'Nastavení' }, '⚙'),
      h('div', { class: 'legend-pop-body' },
        h('strong', null, 'Nastavení'),
        h('label', { class: 'set-row', for: 'room-motion' }, motionToggle, ' Omezit pohyb (bez přeletů kamery)'),
        h('label', { class: 'set-row', for: 'room-demo', title: 'Rozmístí ukázkové racky, servery, switche a kabely s ilustrativním provozem' }, demoToggle, ' Ukázka ', h('span', { class: 'ui-badge' }, 'ilustrativní')),
        button('Úkoly zobrazit / skrýt (Shift+T)', () => setHidden(!(state?.objectivesHidden ?? false)), { class: 'btn btn-small' }),
        button('Změnit blueprint / lokalitu…', () => ctx.navigate({ name: 'sandbox-site' }), { class: 'btn btn-small', title: `Teď: ${site.layout().label}` }),
      ),
    );
    const undoBtn = button('⟲', () => undoRedo('undo'), { class: 'btn btn-small', title: 'Vrátit změnu místnosti (Ctrl+Z)', 'aria-label': 'Vrátit změnu místnosti (Ctrl+Z)', disabled: true });
    const redoBtn = button('⟳', () => undoRedo('redo'), { class: 'btn btn-small', title: 'Zopakovat změnu (Ctrl+Y)', 'aria-label': 'Zopakovat změnu místnosti (Ctrl+Y)', disabled: true });
    const dnsBtn = button('DNS', () => panels.openDns(), { class: 'btn btn-small', title: 'DNS server firmy (mimo VCF)' });
    // Site widget: room name, AZ badge (UI only, via the site adapter), room switcher + site overview.
    const roomTitle = h('strong', null, 'Serverovna');
    const azBtn = button('AZ —', () => site.setAz(roomId, AZ_CYCLE[(AZ_CYCLE.indexOf(curRoom().az) + 1) % AZ_CYCLE.length]!), {
      class: 'az-badge',
      title: 'Role místnosti: AZ1 / AZ2 / witness / druhá VCF Instance (co znamená pro VCF, vyhodnocuje model podle dokumentace)',
    });
    const roomSelect = h('select', { 'aria-label': 'Přejít do místnosti', title: 'Přejít do místnosti' }) as HTMLSelectElement;
    roomSelect.addEventListener('change', () => goRoom(roomSelect.value));
    const overviewBtn = button('Areál', () => goOverview(), { class: 'btn btn-small', title: 'Přehled lokality (Esc v místnosti)' });
    const siteWidget = h('span', { class: 'room-site' }, azBtn, roomSelect, overviewBtn);
    const renderSiteHud = (): void => {
      const layout = site.layout();
      const r = curRoom();
      roomTitle.textContent = r.label;
      azBtn.textContent = azText(r.az);
      azBtn.dataset['az'] = r.az ?? 'none';
      azBtn.setAttribute('aria-label', `Role místnosti: ${azText(r.az)} – změnit`);
      roomSelect.replaceChildren(...layout.rooms.map((x) => h('option', { value: x.id }, `→ ${x.label}`)));
      roomSelect.value = roomId;
      roomSelect.hidden = layout.rooms.length < 2;
      overviewBtn.hidden = layout.rooms.length < 2;
    };
    const hud = h('header', { class: 'room-hud' },
      button('← Sandbox', () => ctx.navigate({ name: 'sandbox-intro' }), { class: 'btn btn-small', title: 'Odejít ze serverovny' }),
      h('div', { class: 'room-title' }, roomTitle, h('span', { class: 'muted' }, ` · ${VCF_VERSION}`)),
      siteWidget,
      h('div', { class: 'hud-chip', title: 'Herní měna – v Sandboxu neomezená. Ceny jsou herní, nejsou z dokumentace.' }, h('span', { class: 'coin', 'aria-hidden': 'true' }), '∞ ', spentEl),
      nextChip,
      h('span', { class: 'hud-group' }, undoBtn, redoBtn, dnsBtn),
      timeSlot,
      keysHelp(),
      settings,
    );
    const tracker = h('section', { class: 'room-tracker', id: 'room-tracker', hidden: true, 'aria-label': 'Úkoly', role: 'region' });
    ui.append(hud, tracker, toast, live, liveBad);
    const time = createTimeControls(timeSlot, engine, 'stepped');
    const panels = createObjectPanels({ ui, port: () => port, announce: (t, bad) => say(t, bad), onOpenHost: (id) => openHost(id) });
    function undoRedo(which: 'undo' | 'redo'): void {
      const ops = port?.ops;
      if (!ops) return say('Vracení změn funguje jen v tvé serverovně, ne v ukázce.', true);
      const r = ops.dispatch({ type: which === 'undo' ? 'undoRoom' : 'redoRoom' });
      say(r.ok ? (which === 'undo' ? 'Vráceno.' : 'Zopakováno.') : r.message, !r.ok);
    }
    const rackTools = (): HTMLElement[] => {
      const u = button('⟲', () => undoRedo('undo'), { class: 'btn btn-small rack-undo', title: 'Vrátit (Ctrl+Z)', 'aria-label': 'Vrátit změnu (Ctrl+Z)' });
      const r = button('⟳', () => undoRedo('redo'), { class: 'btn btn-small rack-redo', title: 'Zopakovat (Ctrl+Y)', 'aria-label': 'Zopakovat změnu (Ctrl+Y)' });
      const d = button('DNS', () => panels.openDns(), { class: 'btn btn-small', title: 'DNS server firmy (mimo VCF)' });
      u.disabled = !state?.undo?.canUndo;
      r.disabled = !state?.undo?.canRedo;
      d.hidden = !port?.ops;
      return [u, r, d];
    };
    function openDevice(id: string): void {
      const d = state?.devices.find((x) => x.id === id);
      if (!d) return;
      if (d.kind === 'server') panels.openServer(id);
      else panels.openSwitch(id);
    }
    function openHost(id: string): void {
      const rackId = state?.devices.find((x) => x.id === id)?.mount?.rackId;
      if (!rackId) return say('Server není v racku.', true);
      panels.close();
      goTo({ kind: 'host', rackId, hostId: id });
    }
    function showMe(o: ObjectiveView): void {
      const ops = port?.ops;
      if (!ops) return say('„Ukaž mi“ funguje jen v tvé serverovně.', true);
      const a = resolveShowMe(o.showMe, ops.snapshot(), o.id);
      switch (a.kind) {
        case 'view':
          if (!sameView(a.view, view)) goTo(a.view);
          return;
        case 'server':
          if (a.rackId && !(view.kind === 'rack' && view.rackId === a.rackId)) goTo({ kind: 'rack', rackId: a.rackId });
          panels.openServer(a.serverId, a.tab);
          return;
        case 'switch':
          if (a.rackId && !(view.kind === 'rack' && view.rackId === a.rackId)) goTo({ kind: 'rack', rackId: a.rackId });
          panels.openSwitch(a.switchId);
          return;
        case 'dns':
          panels.openDns();
          return;
        case 'inventory':
          if (view.kind !== 'room') goTo(ROOM_VIEW);
          shop.setTab(a.tab);
          shop.el.querySelector<HTMLElement>(`[data-tab="${a.tab}"]`)?.focus();
          return;
        case 'none':
          say(a.reason, true);
      }
    }

    // ------------------------------------------------------------ right panel (design decisions)
    const sideBody = h('div', { class: 'room-side-body', id: 'room-side-body' });
    const sideToggle = button('Návrhová rozhodnutí', () => setSide(!sideOpen), { class: 'room-side-tab', 'aria-expanded': 'false', 'aria-controls': 'room-side-body' });
    const side = h('aside', { class: 'room-side collapsed', 'aria-label': 'Návrhová rozhodnutí' }, sideToggle, sideBody);
    ui.appendChild(side);
    let sideOpen = false;
    let offDesign: (() => void) | null = null;
    const mountDesign = (): void => {
      if (offDesign) return;
      const design = sharedDesignState();
      const dview = createDesignViewState();
      const notice = message({ type: 'game-limit', compact: true, title: 'Návrh zatím nepočítá s místností', body: 'Dostupnost voleb podle hardwaru, který tu postavíš, simulace zatím nemodeluje.' });
      const render = (): void => {
        const data = loadDesignStepData(design.selection(), design.acknowledged());
        const fk = (document.activeElement as HTMLElement | null)?.dataset?.['fk'];
        renderDesignStep(sideBody, { data, view: dview, notice, onSelect: (d, o) => design.select(d, o), onAcknowledge: (k) => design.acknowledgeWarnings(k), onProceed: () => ctx.navigate({ name: 'sandbox', phase: 'priprava' }) }, design.acknowledged());
        restoreDesignFocus(sideBody, fk);
      };
      offDesign = design.subscribe(render);
      render();
    };
    const setSide = (open: boolean): void => {
      sideOpen = open;
      side.classList.toggle('collapsed', !open);
      sideToggle.setAttribute('aria-expanded', String(open));
      if (open) mountDesign();
      if (view.kind === 'room') camera?.set(fitRoom());
    };

    // ------------------------------------------------------------ shop + traffic chip
    const shop = createShop({
      onBuy: (itemId) => {
        if (!port) return;
        const r = port.buyItem(itemId);
        if (!r.ok) return say(r.message, true);
        const entry = port.state().inventory.find((e) => e.id === r.id);
        say(`Koupeno: ${entry?.label ?? itemId} – je v batohu.${entry ? ' Teď ho umísti.' : ''}`);
        if (entry) pick(entry);
      },
      onPick: (e) => pick(e),
      onSell: (id) => {
        const r = port?.removeItem(id);
        if (r && !r.ok) say(r.message, true);
        else say('Prodáno (Sandbox vrací 100 % herní ceny).');
      },
    });
    ui.appendChild(shop.el);
    const chip = createTrafficChip((t) => room.setTrafficFilter(t));
    ui.appendChild(chip.el);
    // Hidden keyboard / screen-reader list of interactive objects (UX §4.5).
    const objList = h('ul', { class: 'sr-only room-objects', 'aria-label': 'Objekty v místnosti' });
    ui.appendChild(objList);
    // Sprint 2B hook: computer + whiteboard views.
    const objHooks = createRoomObjectHooks({
      stage, ui, gameTimeMs: () => engine.snapshot().clock.gameTimeMs, port: () => port, goTo: (v) => goTo(v),
      roomCamera: () => savedRoomCam ?? camera?.camera ?? null, say: (t, bad) => say(t, bad),
      openShopServers: () => { goTo(ROOM_VIEW); shop.setTab('servers'); },
    });

    // ------------------------------------------------------------ object views (placeholders)
    const placeholder = h('div', { class: 'view-placeholder', hidden: true });
    ui.appendChild(placeholder);

    function pick(e: InventoryEntry | null): void {
      picked = e;
      if (!e) room.setGhost(null);
      canvas.style.cursor = e ? 'copy' : '';
      if (e && view.kind !== 'room') goTo(ROOM_VIEW);
      if (e) say(e.kind === 'rack' ? `${e.label}: klikni na volnou dlaždici.` : `${e.label}: klikni na rack (nebo otevři rack a vyber pozici).`);
      if (state) shop.update(state, picked?.id ?? null);
      if (e) shop.setTab('backpack');
    }

    // ------------------------------------------------------------ tracker / HUD chip
    let trackerOpen = false;
    function toggleTracker(force?: boolean): void {
      trackerOpen = force ?? !trackerOpen;
      tracker.hidden = !trackerOpen || !!state?.objectivesHidden;
      nextChip.setAttribute('aria-expanded', String(!tracker.hidden));
      renderTracker();
    }
    function setHidden(hidden: boolean): void {
      port?.setObjectivesHidden(hidden);
    }
    function nextObjective(s: RoomState): ObjectiveView | undefined {
      return (s.nextObjectiveId ? s.objectives.find((o) => o.id === s.nextObjectiveId) : undefined) ?? s.objectives.find((o) => o.status !== 'done' && o.status !== 'skipped' && o.kind !== 'game-optional');
    }
    let lastNext = '';
    function renderHud(s: RoomState): void {
      spentEl.textContent = `herní · utraceno ${formatPrice(s.spent)}`;
      const next = nextObjective(s);
      nextChip.replaceChildren();
      if (s.objectivesHidden) nextChip.append('☰✓ Úkoly skryté');
      else if (!s.objectives.length) nextChip.append('Úkoly nejsou k dispozici');
      else if (!next) nextChip.append('✓ ', h('strong', null, 'Vše hotovo'), h('span', { class: 'muted' }, ' – zkus rozbít síť a podívej se, co řekne validace'));
      else nextChip.append('▶ ', h('span', { class: 'muted' }, 'Další krok: '), h('strong', null, next.title), next.progress ? h('span', { class: 'muted' }, ` ${next.progress.done}/${next.progress.total}`) : '', ' ▾');
      const key = next?.id ?? '';
      if (lastNext && key !== lastNext) {
        const done = s.objectives.find((o) => o.id === lastNext);
        if (done?.status === 'done') live.textContent = `Hotovo: ${done.title}.${next ? ` Další krok: ${next.title}.` : ''}`;
      }
      lastNext = key;
      tracker.hidden = !trackerOpen || s.objectivesHidden;
      renderTracker();
    }
    function renderTracker(): void {
      if (tracker.hidden || !state) return;
      const s = state;
      const next = nextObjective(s);
      tracker.replaceChildren(
        h('div', { class: 'pop-head' }, h('strong', null, 'Úkoly'), h('span', { class: 'muted small' }, s.source === 'local-fallback' ? ' (zjednodušené – herní kroky)' : ''), button('–', () => toggleTracker(false), { class: 'btn btn-small', 'aria-label': 'Sbalit úkoly' })),
        h('ul', { class: 'obj-list' }, ...s.objectives.map((o) => h('li', { class: `obj obj-${o.status}${o.id === next?.id ? ' obj-next' : ''}` },
          h('span', { class: 'obj-icon', 'aria-hidden': 'true' }, o.kind === 'game-optional' ? '◇' : OBJ_ICON[o.status]),
          h('span', { class: 'obj-title' }, o.title, o.progress ? ` ${o.progress.done}/${o.progress.total}` : '', o.kind === 'doc-recommended' ? ' ★' : ''),
          o.kind === 'game-optional' ? h('span', { class: 'ui-badge badge-outscope' }, 'mimo VCF scope – herní') : null,
          o.showMe && o.status !== 'done' ? button('Ukaž mi', () => showMe(o), { class: 'btn btn-small btn-showme', 'aria-label': `Ukaž mi: ${o.title}` }) : null,
          o.docUrl ? h('a', { href: o.docUrl, target: '_blank', rel: 'noopener noreferrer', class: 'doc-link', title: o.specRef ?? '' }, 'Proč?') : null,
          o.status !== 'done' && o.status !== 'skipped' ? button('⤼', () => port?.skipObjective(o.id), { class: 'btn btn-small', title: 'Přeskočit vedení (nic nemění ve hře ani ve validacích)', 'aria-label': `Přeskočit: ${o.title}` }) : null,
        ))),
        h('p', { class: 'muted small' }, 'Úkoly jen vedou – nic nezamykají.'),
      );
    }

    // ------------------------------------------------------------ camera + room input
    const fitRoom = (): Camera => {
      const w = canvas.clientWidth - (sideOpen ? SIDE_W : SIDE_TAB_W);
      const hh = canvas.clientHeight - TOP_H - BOTTOM_H;
      const cam = fitRect(room.bounds, Math.max(200, w), Math.max(200, hh), 16);
      return { x: cam.x, y: cam.y + TOP_H, scale: cam.scale };
    };
    let hover: { sx: number; sy: number; wx: number; wy: number } | null = null;
    let hoverCab: string | null = null;
    let hoverMs = 0;
    const tip = h('div', { class: 'ui-panel tooltip room-tip', role: 'tooltip', hidden: true });
    ui.appendChild(tip);
    const showTip = (sx: number, sy: number, lines: readonly string[]): void => {
      tip.replaceChildren(...lines.map((l, i) => (i === 0 ? h('strong', null, l) : h('div', null, l))));
      tip.style.transform = `translate(${Math.min(canvas.clientWidth - 260, sx + 14)}px, ${sy + 14}px)`;
      tip.hidden = false;
    };
    const rackTooltip = (id: string): string[] => {
      const s = state;
      const r = s?.racks.find((x) => x.id === id);
      const devs = s?.devices.filter((d) => d.mount?.rackId === id) ?? [];
      return [`Rack ${r?.label ?? id}`, `${devs.filter((d) => d.kind === 'server').length} serverů · ${devs.filter((d) => d.kind === 'switch').length} switchů`, picked && picked.kind !== 'rack' ? 'klik = zarackovat · E = otevřít' : 'klik = otevřít (kabeláž)'];
    };

    let camera = null as CameraControls | null;
    const attachRoomControls = (initial: Camera): void => {
      camera?.dispose();
      camera = attachCameraControls({
        element: canvas,
        initial,
        onChange: (cam) => stage.setCamera(cam),
        onHover: (pos) => {
          hover = pos;
          hoverMs = 0;
        },
        onClick: (pos) => onRoomClick(pos),
      });
      stage.setCamera(initial);
    };
    attachRoomControls(fitRoom());

    function onRoomClick(pos: { wx: number; wy: number }): void {
      if (!port || transition) return;
      const tile = room.tileAtWorld(pos.wx, pos.wy);
      const cab = room.cabinetAtWorld(pos.wx, pos.wy);
      const sel = picked;
      if (sel) {
        if (sel.kind === 'rack') {
          if (!tile) return say('Mimo místnost.', true);
          const chk = room.checkPlace('rack', tile);
          if (!chk.ok) return say(chk.reason === 'occupied' ? 'Dlaždice je obsazená.' : chk.reason === 'avatar' ? 'Tady stojí panáček.' : 'Mimo místnost.', true);
          site.assignRack(sel.id, roomId); // before placing: the rack belongs to this room of the site
          const r = port.placeRack(sel.id, tile);
          if (!r.ok) return say(r.message, true);
          pick(null);
          say(`${sel.label} postaven. Teď kup server a switch a klikni na rack.`);
          room.walkTo({ gx: tile.gx, gy: Math.min(room.size.rows - 1, tile.gy + 1) });
          return;
        }
        if (!cab) return say('Klikni na rack.', true);
        const r = port.mountDevice(sel.id, cab.id);
        if (!r.ok) return say(r.message, true);
        pick(null);
        say(`${sel.label} zarackován do ${cab.id}.`);
        room.walkToCabinet(cab.id);
        return;
      }
      if (cab) return openRack(cab.id);
      if (multiRoom() && onDoor(pos.wx, pos.wy, tile)) return leaveByDoor();
      const fx = objHooks.fixtureAt(pos.wx, pos.wy); // Sprint 2B hook
      if (fx) return goTo(objHooks.viewOf(fx));
      if (tile && !room.walkTo(tile)) say('Tam se nedá dojít.', true);
    }

    function openRack(id: string): void {
      room.walkToCabinet(id); // cosmetic, never waited for
      goTo({ kind: 'rack', rackId: id });
    }

    const goTo = (v: RoomView): void => ctx.navigate({ name: 'sandbox-room', demo, ...(multiRoom() ? { roomId } : {}), ...(v.kind === 'room' ? {} : { view: v }) });

    // ------------------------------------------------------------ multi-room site (rooms, door, overview)
    const goRoom = (id: string): void => ctx.navigate({ name: 'sandbox-room', demo, roomId: id });
    const goOverview = (): void => ctx.navigate({ name: 'sandbox-room', demo, overview: true });
    /** Racks of the adapter state that stand in the shown room (racks not yet placed stay everywhere). */
    const inThisRoom = (rackId: string, placed: boolean): boolean => !placed || site.roomOfRack(rackId) === roomId;
    function onDoor(wx: number, wy: number, tile: Tile | null): boolean {
      const d = roomDoor(room.size);
      const r = d.rect;
      return (wx >= r.x && wx <= r.x + r.width && wy >= r.y && wy <= r.y + r.height) || (!!tile && tile.gx === d.tile.gx && tile.gy === d.tile.gy);
    }
    let offDoorWalk: (() => void) | null = null;
    function leaveByDoor(): void {
      const target = doorTarget(site.layout(), roomId);
      const d = roomDoor(room.size).tile;
      offDoorWalk?.();
      const go = (): void => {
        offDoorWalk?.();
        offDoorWalk = null;
        if (target) goRoom(target);
        else goOverview();
      };
      const reached = room.walkTo(d);
      if (!reached || reachedTile(reached, d)) return go();
      say(`Jdu ke dveřím → ${target ? roomOf(site.layout(), target).label : 'přehled lokality'}.`);
      offDoorWalk = room.onAvatarArrive((t) => (reachedTile(t, d) ? go() : undefined));
    }
    const reachedTile = (a: Tile, b: Tile): boolean => a.gx === b.gx && a.gy === b.gy;
    let fadeMs = -1;
    function switchRoom(id: string, viaDoor: boolean): void {
      if (id === roomId) return;
      offDoorWalk?.();
      offDoorWalk = null;
      pick(null);
      roomId = roomOf(site.layout(), id).id;
      room.clear();
      room.setSize(curRoom().size);
      room.resetAvatar(viaDoor ? roomDoor(room.size).tile : { gx: Math.floor(room.size.cols / 2), gy: room.size.rows - 2 });
      renderSiteHud();
      applyState();
      if (camera) camera.set(fitRoom());
      if (!reducedMotion) {
        fadeMs = 0;
        room.world.alpha = 0;
      }
      say(`${curRoom().label}${curRoom().az ? ` (${curRoom().az})` : ''}.`);
    }
    const racksOfRoom = (id: string): { gx: number; gy: number }[] =>
      (state?.racks ?? []).filter((r) => r.tile && site.roomOfRack(r.id) === id).map((r) => r.tile!);
    const overview = createSiteOverview({
      stage, ui, site, racksOf: racksOfRoom, topH: TOP_H, reducedMotion: () => reducedMotion, currentRoom: () => roomId,
      onEnterRoom: (id) => goRoom(id), announce: (t) => say(t),
    });
    const setRoomUiHidden = (hidden: boolean): void => {
      shop.el.hidden = hidden;
      chip.el.hidden = hidden;
      side.hidden = hidden;
      tracker.hidden = hidden || !trackerOpen || !!state?.objectivesHidden;
    };
    function showOverview(): void {
      if (overview.active) return;
      if (view.kind !== 'room') enterView(ROOM_VIEW, false);
      pick(null);
      camera?.dispose();
      camera = null;
      tip.hidden = true;
      setRoomUiHidden(true);
      overview.show();
    }
    function hideOverview(): void {
      if (!overview.active) return;
      overview.hide();
      setRoomUiHidden(false);
      room.world.visible = true;
      room.world.alpha = 1;
      attachRoomControls(fitRoom());
    }
    const offSite = site.subscribe(() => {
      renderSiteHud();
      applyState();
      overview.refresh();
    });
    renderSiteHud();

    // ------------------------------------------------------------ view stack + transitions (UX §7)
    let rackPanel = null as RackPanel | null;
    let hostDetail = null as HostDetail | null;
    let savedRoomCam: Camera | null = null;
    let transition = null as { dir: TransitionDirection; t: number; from: Camera; to: Camera; done: () => void } | null;

    function finishTransition(): void {
      if (!transition) return;
      transition.t = transitionDuration(transition.dir, reducedMotion);
      applyTransition(0);
    }

    function applyTransition(dt: number): void {
      const tr = transition;
      if (!tr) return;
      tr.t += dt;
      const f = transitionFrame(tr.dir, tr.t, tr.from, tr.to, reducedMotion);
      if (f.camera) stage.setCamera(f.camera);
      room.world.alpha = f.roomAlpha;
      room.world.visible = f.roomAlpha > 0.001;
      const rv = stage.rack.root;
      if (rackPanel) {
        const c = rackPanel.camera;
        const w = canvas.clientWidth / 2;
        const hh = canvas.clientHeight / 2;
        rv.alpha = f.viewAlpha;
        rv.scale.set(c.scale * f.viewScale);
        rv.position.set(w + (c.x - w) * f.viewScale, hh + (c.y - hh) * f.viewScale);
        rv.visible = f.viewAlpha > 0.001;
      }
      placeholder.style.opacity = String(f.viewAlpha);
      objHooks.current?.setTransition(f.viewAlpha, f.viewScale); // Sprint 2B hook
      if (f.done) {
        transition = null;
        tr.done();
      }
    }

    function enterView(next: RoomView, animate: boolean): void {
      const prev = view;
      view = next;
      tip.hidden = true;
      room.setHighlightedCabinet(null);
      if (objHooks.switchApp(prev, next)) return; // Sprint 2B hook: pc app -> pc app
      if (next.kind === 'room') {
        closeObjectView(prev, animate);
        return;
      }
      // Leaving another object view first (e.g. rack R1 -> R2): no animation between object views.
      if (prev.kind !== 'room') closeObjectView(prev, false, true);
      savedRoomCam ??= camera?.camera ?? fitRoom();
      camera?.dispose();
      camera = null;
      shop.el.hidden = true;
      chip.el.hidden = true;
      side.hidden = true;
      if (next.kind === 'rack' || next.kind === 'host') {
        if (!port || !state?.racks.some((r) => r.id === next.rackId && r.tile)) {
          say(`Rack ${next.rackId} tu není.`, true);
          goTo(ROOM_VIEW);
          return;
        }
        if (next.kind === 'host' && port.ops) {
          hostDetail = createHostDetail({
            ui,
            ops: port.ops,
            hostId: next.hostId,
            rackId: next.rackId,
            announce: say,
            onBack: () => goTo({ kind: 'rack', rackId: next.rackId }),
            onOpenServer: (id, tab) => panels.openServer(id, tab),
            onOpenSwitch: (id) => panels.openSwitch(id),
            reducedMotion: () => reducedMotion,
          });
        } else rackPanel = createRackPanel({
          ui,
          canvas,
          view: stage.rack,
          port,
          rackId: next.rackId,
          announce: say,
          onBack: () => goTo(parentView(view) ?? ROOM_VIEW),
          onOpenRack: (id) => goTo({ kind: 'rack', rackId: id }),
          reducedMotion: () => reducedMotion,
          dpr: stage.app.renderer.resolution,
          onOpenDevice: openDevice,
          onOpenHost: openHost,
          toolbarExtra: rackTools(),
        });
        if (next.kind === 'host' && !hostDetail) say('Detail hosta je jen v tvé serverovně (ne v ukázce).', true);
      } else if (!objHooks.open(next)) {
        showPlaceholder(next);
      }
      const rect = next.kind === 'rack' || next.kind === 'host' ? room.cabinetRect(next.rackId) : objHooks.rect(next);
      const from = savedRoomCam;
      const to = rect ? cameraOnto(rect, { x: 0, y: TOP_H, width: canvas.clientWidth, height: canvas.clientHeight - TOP_H - BOTTOM_H }) : from;
      if (!animate) {
        room.world.visible = false;
        stage.rack.root.alpha = 1;
        placeholder.style.opacity = '1';
        if (rackPanel) stage.rack.setCamera(rackPanel.camera, stage.app.renderer.resolution);
        return;
      }
      stage.rack.root.alpha = 0;
      transition = {
        dir: 'open',
        t: 0,
        from,
        to,
        done: () => {
          room.world.visible = false;
          if (rackPanel) stage.rack.setCamera(rackPanel.camera, stage.app.renderer.resolution);
        },
      };
      applyTransition(0);
    }

    function closeObjectView(prev: RoomView, animate: boolean, keepRoomHidden = false): void {
      rackPanel?.dispose();
      rackPanel = null;
      hostDetail?.dispose();
      hostDetail = null;
      placeholder.hidden = true;
      objHooks.closeView(); // Sprint 2B hook
      if (keepRoomHidden) return;
      shop.el.hidden = false;
      chip.el.hidden = false;
      side.hidden = false;
      const back = savedRoomCam ?? fitRoom();
      savedRoomCam = null;
      const restore = (): void => {
        room.world.alpha = 1;
        room.world.visible = true;
        attachRoomControls(back);
      };
      if (!animate || prev.kind === 'room') return restore();
      const rect = prev.kind === 'rack' || prev.kind === 'host' ? room.cabinetRect(prev.rackId) : objHooks.rect(prev);
      const from = rect ? cameraOnto(rect, { x: 0, y: TOP_H, width: canvas.clientWidth, height: canvas.clientHeight - TOP_H - BOTTOM_H }) : back;
      room.world.visible = true;
      room.world.alpha = 0;
      stage.setCamera(from);
      transition = { dir: 'close', t: transitionDuration('open', true) * 0 + 0, from, to: back, done: restore };
      // Rack panel is already gone: start the close at the camera flight part.
      transition.t = reducedMotion ? 0 : 150;
      applyTransition(0);
    }

    function showPlaceholder(v: RoomView): void {
      const isBoard = v.kind === 'board';
      placeholder.hidden = false;
      placeholder.style.opacity = '0';
      placeholder.replaceChildren(
        h('div', { class: 'placeholder-card ui-panel' },
          h('h2', null, viewLabel(v)),
          message({
            type: 'game-limit',
            title: isBoard ? 'Tabule s High-Level Designem se připravuje' : 'Počítač (Návrh VCF, VCF Installer) se připravuje',
            body: isBoard
              ? 'Tady se z tvého zapojení automaticky nakreslí High-Level Design a budeš si moct dokreslovat poznámky.'
              : 'Tady bude plocha počítače s aplikacemi (Návrh VCF dlaždicemi, use case, později VCF Installer). Zatím použij panel Návrh vpravo.',
          }),
          button('← Zpět do místnosti (Esc)', () => goTo(ROOM_VIEW), { class: 'btn btn-primary' }),
        ),
      );
      placeholder.querySelector<HTMLButtonElement>('button')?.focus();
    }

    // ------------------------------------------------------------ port + state sync
    const applyState = (): void => {
      if (!port || disposed) return;
      state = port.state();
      const full = state;
      room.syncContents(roomContentsOf({ ...full, racks: full.racks.filter((r) => inThisRoom(r.id, !!r.tile)) }));
      if (!demoTraffic) room.setTrafficSource(new StaticTrafficSource(linkTrafficOf(state)));
      if (!demoTraffic) room.setBmcTransfers(bmcTransfersOf(state));
      shop.update(state, picked?.id ?? null);
      renderHud(state);
      room.setCompanyUplink(state.companyNetwork ? { deviceId: state.companyNetwork.switchId, port: state.companyNetwork.port } : null);
      undoBtn.disabled = !state.undo?.canUndo;
      redoBtn.disabled = !state.undo?.canRedo;
      dnsBtn.hidden = !port.ops;
      for (const b of ui.querySelectorAll<HTMLButtonElement>('.rack-undo')) b.disabled = !state.undo?.canUndo;
      for (const b of ui.querySelectorAll<HTMLButtonElement>('.rack-redo')) b.disabled = !state.undo?.canRedo;
      panels.refresh();
      if (hostDetail && port.ops) {
        const snap = port.ops.snapshot();
        hostDetail.update(snap, snap.revision !== hostRev);
        hostRev = snap.revision;
      }
      objList.replaceChildren(...state.racks.filter((r) => r.tile && inThisRoom(r.id, true)).map((r) =>
        h('li', null, button(`Otevřít rack ${r.label}`, () => openRack(r.id), { 'data-rack': r.id, class: 'sr-focusable' })),
      ));
      for (const b of objList.querySelectorAll<HTMLButtonElement>('button')) {
        b.addEventListener('focus', () => room.setHighlightedCabinet(b.dataset['rack'] ?? null));
        b.addEventListener('blur', () => room.setHighlightedCabinet(null));
      }
      objList.append(...objHooks.srButtons()); // Sprint 2B hook
      if (picked && !state.inventory.some((e) => e.id === picked!.id)) pick(null);
    };
    let demoTraffic = false;
    let hostRev = -1;
    const usePort = (p: RoomPort, isDemo: boolean): void => {
      if (disposed) return;
      offPort?.();
      port = p;
      demoTraffic = false;
      if (isDemo) {
        const built = buildDemoRoom(p);
        demoTraffic = true;
        room.setTrafficSource(built.traffic);
        room.setBmcTransfers(built.bmcCables);
      }
      objHooks.bindPort(p, isDemo); // Sprint 2B hook
      offPort = p.subscribe(applyState);
      applyState();
      if (view.kind === 'room') camera?.set(fitRoom());
      if (view.kind !== 'room') enterView(view, false);
      overview.refresh();
    };
    const loadPort = (): void => {
      room.clear();
      (demo ? createDemoRoomPort() : sharedRoomPort(engine as never)).then((p) => usePort(p, demo), (err: unknown) => say(`Nepodařilo se načíst katalog: ${String(err)}`, true));
    };
    loadPort();
    if (view.kind !== 'room') {
      // Deep link: show the view once the port is ready (no animation).
      camera?.dispose();
      camera = null;
    }
    if (route.name === 'sandbox-room' && route.overview) showOverview();
    if (!overview.active) say('Kup rack v obchodě dole a postav ho. Klik na rack = otevřít kabeláž.');

    demoToggle.addEventListener('change', () => {
      settings.open = false;
      ctx.navigate({ name: 'sandbox-room', demo: demoToggle.checked });
    });
    motionToggle.addEventListener('change', () => {
      reducedMotion = motionToggle.checked;
    });

    // ------------------------------------------------------------ frame
    let chipMs = 0;
    const offFrame = stage.onFrame((snap, real) => {
      time.update(snap);
      if (fadeMs >= 0 && !transition) {
        fadeMs += real;
        room.world.alpha = Math.min(1, fadeMs / 220);
        if (fadeMs >= 220) fadeMs = -1;
      }
      if (transition) applyTransition(real);
      chipMs += real;
      if (chipMs > 250) {
        chipMs = 0;
        chip.update(room.activeTypes, room.bmcTransferActive);
      }
      if (view.kind !== 'room' || transition || !camera || overview.active) return;
      const tile = hover ? room.tileAtWorld(hover.wx, hover.wy) : null;
      if (picked?.kind === 'rack') {
        room.setGhost(tile ? { kind: 'rack', tile } : null);
        room.setHoverTile(null);
      } else {
        room.setGhost(null);
        room.setHoverTile(picked ? null : tile);
      }
      const cab = hover ? room.cabinetAtWorld(hover.wx, hover.wy) : null;
      const cabId = cab?.kind === 'rack' ? cab.id : null;
      const fxId = hover && !cabId && !picked ? objHooks.fixtureAt(hover.wx, hover.wy) : null; // Sprint 2B hook
      if ((cabId ?? fxId) !== hoverCab) {
        hoverCab = cabId ?? fxId;
        hoverMs = 0;
      }
      room.setHighlightedCabinet(cabId ?? fxId);
      const bundle = hover && !cabId ? room.bundleAtWorld(hover.wx, hover.wy, 8 / camera.camera.scale) : null;
      room.setHoveredBundle(bundle?.key ?? null);
      canvas.style.cursor = picked ? (picked.kind === 'rack' || cabId ? 'copy' : 'not-allowed') : cabId || fxId ? 'zoom-in' : '';
      hoverMs += real;
      if (hover && hoverMs >= TOOLTIP_DELAY_MS && (cabId || fxId || bundle)) {
        if (cabId) showTip(hover.sx, hover.sy, rackTooltip(cabId));
        else if (fxId) showTip(hover.sx, hover.sy, objHooks.tooltip(fxId));
        else if (bundle && state) {
          const s = state;
          const lab = (d: string, p: number): string => {
            const dev = s.devices.find((x) => x.id === d);
            return p < 0 ? `${dev?.label ?? d} BMC` : dev?.kind === 'switch' ? `${dev.label} p${p + 1}` : `${dev?.label ?? d} ${dev?.nicPorts.find((n) => n.index === p)?.label ?? ''}`;
          };
          showTip(hover.sx, hover.sy, [`Svazek ×${bundle.cables.length} (stropní žlab)`, ...bundle.cables.slice(0, 8).map((c) => `${lab(c.from.deviceId, c.from.port)} → ${lab(c.to.deviceId, c.to.port)}`), ...(bundle.cables.length > 8 ? [`+${bundle.cables.length - 8} další`] : [])]);
        }
      } else tip.hidden = true;
    });

    // ------------------------------------------------------------ keys
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing && (view.kind === 'room' || view.kind === 'rack')) {
        const k = e.key.toLowerCase();
        if (k === 'z' || k === 'y') {
          e.preventDefault();
          undoRedo(k === 'y' || e.shiftKey ? 'redo' : 'undo');
          return;
        }
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (transition) {
        finishTransition();
        if (e.key !== 'Escape') return;
      }
      if (e.key === 'Escape' || (e.key === 'Backspace' && !typing)) {
        if (panels.escape()) return;
        if (hostDetail?.escape()) return;
        if (objHooks.current?.escape()) return; // Sprint 2B hook
        if (rackPanel?.escape()) return;
        if (settings.open) {
          settings.open = false;
          return;
        }
        if (view.kind !== 'room') {
          e.preventDefault();
          goTo(parentView(view) ?? ROOM_VIEW);
          return;
        }
        if (overview.active) {
          e.preventDefault();
          goRoom(roomId);
          return;
        }
        if (picked) return pick(null);
        if (trackerOpen) return toggleTracker(false);
        if (multiRoom()) goOverview(); // room -> site overview (one level up in multi-room layouts)
        return;
      }
      if (typing) return;
      if (e.key === 'D' && e.shiftKey) goTo({ kind: 'pc', app: 'navrh' }); // Sprint 2B hook (UX §7.3)
      else if (e.key === 'd' || e.key === 'D') {
        if (view.kind === 'room') setSide(!sideOpen);
      } else if (e.key === 'l' || e.key === 'L') chip.toggle();
      else if (e.key === 't') toggleTracker();
      else if (e.key === 'T') setHidden(!(state?.objectivesHidden ?? false));
      else if ((e.key === 'e' || e.key === 'E' || e.key === 'Enter') && view.kind === 'room' && hoverCab && !(t instanceof HTMLButtonElement)) {
        if (isFixtureId(hoverCab)) goTo(objHooks.viewOf(hoverCab));
        else openRack(hoverCab);
      }
      else if (e.key === '0' && view.kind === 'room') camera?.set(fitRoom());
    };
    window.addEventListener('keydown', onKey);
    const onResize = (): void => {
      if (view.kind === 'room' && !transition) camera?.set(fitRoom());
    };
    window.addEventListener('resize', onResize);
    const onPointerDown = (): void => finishTransition();
    window.addEventListener('pointerdown', onPointerDown, true);
    const onDbl = (): void => {
      if (view.kind === 'room') camera?.set(fitRoom());
    };
    canvas.addEventListener('dblclick', onDbl);
    const onCtx = (e: MouseEvent): void => {
      if (picked) {
        e.preventDefault();
        pick(null);
      }
    };
    canvas.addEventListener('contextmenu', onCtx);

    return {
      update(r) {
        if (r.name !== 'sandbox-room') return;
        if (r.overview) {
          if (r.demo !== demo) {
            demo = r.demo;
            demoToggle.checked = demo;
            loadPort();
          }
          showOverview();
          return;
        }
        const nextRoom = roomOf(site.layout(), r.roomId).id;
        const fromOverview = overview.active;
        if (fromOverview) hideOverview();
        if (nextRoom !== roomId) {
          if (view.kind !== 'room') enterView(ROOM_VIEW, false);
          switchRoom(nextRoom, !fromOverview);
        } else if (fromOverview && !reducedMotion) {
          fadeMs = 0;
          room.world.alpha = 0;
        }
        if (r.demo !== demo) {
          demo = r.demo;
          demoToggle.checked = demo;
          if (view.kind !== 'room') enterView(ROOM_VIEW, false);
          view = viewOf(r);
          picked = null;
          loadPort();
          return;
        }
        const next = viewOf(r);
        if (sameView(next, view)) return;
        finishTransition();
        enterView(next, true);
      },
      dispose() {
        disposed = true;
        finishTransition();
        offSite();
        offDoorWalk?.();
        overview.dispose();
        rackPanel?.dispose();
        hostDetail?.dispose();
        panels.dispose();
        offPort?.();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('pointerdown', onPointerDown, true);
        offFrame();
        offDesign?.();
        objHooks.dispose(); // Sprint 2B hook
        camera?.dispose();
        canvas.removeEventListener('dblclick', onDbl);
        canvas.removeEventListener('contextmenu', onCtx);
        canvas.style.cursor = '';
        room.setGhost(null);
        room.setHoverTile(null);
        room.setHoveredBundle(null);
        room.setHighlightedCabinet(null);
        room.setTrafficFilter(null);
        room.setBmcTransfers([]);
        room.setCompanyUplink(null);
        room.world.alpha = 1;
        room.world.visible = true;
        stage.rack.root.visible = false;
        time.dispose();
        ui.remove();
      },
    };
  },
};
