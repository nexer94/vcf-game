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
import { icon } from '../icons';
import { FACING_LABEL, nextFacing, FACING_ORDER } from '../../render/room/placementFx';
import type { Facing } from '../../model/roomLayout';
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
import { createDemoRoomPort, setCareerLevel, setPlayMode, sharedRoomPort, type InventoryEntry, type ObjectiveView, type RackTileHint, type RoomPlacement, type RoomPort, type RoomState } from '../sandbox/sessionPort';
import { createChecklist, type Checklist } from '../sandbox/checklist';
import { createSpeechBubble, type SpeechBubble } from '../sandbox/bubble';
import { applyZoneVars, computeZones, type Rect, type Zones } from '../sandbox/layoutZones';
import { closeSourcePopover, setSourceObstacles } from '../sandbox/sourcePopover';
import { createServerConsole, type ServerConsole } from '../sandbox/serverConsole';
import { createShop, formatPrice } from '../sandbox/shop';
import { createTrafficChip } from '../sandbox/trafficChip';
import { createTimeControls } from '../timeControls';
// Multi-room sites ("Výběr lokality"): layout adapter, overview, door.
import { roomDoor } from '../../render/room/roomStatic';
import { createSiteOverview } from '../sandbox/siteOverview';
import { AZ_CYCLE, azText, createLocalSitePort, doorTarget, roomOf, sharedSitePort, switchingSitePort, type SiteRoomView } from '../sandbox/siteLayout';
import { VCF_VERSION } from '../version';
import type { Route } from '../router';
import type { ScreenDef } from './screen';
import './room.css';
import './site.css';
import '../sandbox/v3.css';

const ROOM_KEYS: readonly [string, string][] = [
  ['Mezerník / P', 'pauza'],
  [', / .', 'zpomalit / zrychlit čas (1× · 4× · 16×)'],
  ['1 / 2', 'obchod: Racky / Servery (když má fokus obchod)'],
  ['B', 'znovu otevřít bublinu (Kariéra)'],
  ['E / Enter', 'otevřít rack / tabuli / počítač pod kurzorem'],
  ['R', 'otočit rack (při umísťování, pod kurzorem nebo v pohledu racku)'],
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

const TOP_H = 48;
const TOOLTIP_DELAY_MS = 400;
const TOAST_MS = 3000;

/** "?" menu of the HUD: keys (⌨ moved here, UX 17.1) + library link. */
function helpMenu(onLibrary: () => void): HTMLElement {
  return h('details', { class: 'legend-pop keys-pop help-pop' },
    h('summary', { 'aria-label': 'Nápověda a klávesy', title: 'Nápověda a klávesy' }, '?'),
    h('div', { class: 'legend-pop-body' },
      button('Knihovna zdrojů (dokumentace)', onLibrary, { class: 'btn btn-small' }),
      h('strong', null, 'Klávesy'),
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
    let demo = route.name === 'sandbox-room' && route.demo;
    /** Career level id (Career mode: checklist + bubbles, budget, points). Sandbox: none of them (user decision). */
    const careerId = route.name === 'sandbox-room' ? route.career : undefined;
    const career = !!careerId && !demo;
    setPlayMode(career ? 'career' : 'sandbox');
    if (careerId) setCareerLevel(careerId);
    // Site layout: the session (player's Sandbox) or a local one for the illustrative demo room.
    const site = switchingSitePort(sharedSitePort(), createLocalSitePort(null), () => demo);
    let roomId = roomOf(site.layout(), route.name === 'sandbox-room' ? route.roomId : undefined).id;
    const multiRoom = (): boolean => site.layout().rooms.length > 1;
    const curRoom = (): SiteRoomView => roomOf(site.layout(), roomId);
    room.clear();
    room.setSize(curRoom().size);
    const startTile: Tile = { gx: Math.floor(room.size.cols / 2), gy: room.size.rows - 2 };
    room.resetAvatar(startTile);
    room.world.alpha = 1;
    room.world.visible = true;
    let view: RoomView = viewOf(route);
    let reducedMotion = prefersReduced();
    let port: RoomPort | null = null;
    let state: RoomState | null = null;
    let offPort: (() => void) | null = null;
    let picked: InventoryEntry | null = null;
    /** Facing chosen for the rack being placed (R rotates; engine rules decide what is valid). */
    let placeFacing: Facing = 'S';
    /** [GAME] placement view of the shown room (session backend; null = local fallback / demo room). */
    let placement: RoomPlacement | null = null;
    let disposed = false;

    const ui = h('div', { class: 'ui-root room-ui' });
    root.appendChild(ui);
    const live = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });
    const liveBad = h('div', { class: 'sr-only', 'aria-live': 'assertive' });
    const toast = h('span', { class: 'room-toast', 'aria-hidden': 'true', hidden: true });
    let toastTimer = 0;
    /** Result of an action (UX 16.1: toast only for results, gone after 3 s; instructions live in the bubble). */
    const say = (text: string, bad = false): void => {
      toast.textContent = text;
      toast.classList.toggle('bad', bad);
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => (toast.hidden = true), bad ? TOAST_MS * 2 : TOAST_MS);
      (bad ? liveBad : live).textContent = text;
      if (bad && career) bubble?.event('warn', text);
    };

    // ------------------------------------------------------------ HUD (UX 17.1: one row, 48 px)
    const moneyEl = h('span', null, '∞');
    const pointsEl = h('span', { class: 'hud-points', hidden: true });
    const timeSlot = h('div', { class: 'room-time' });
    const demoToggle = h('input', { type: 'checkbox', id: 'room-demo' });
    demoToggle.checked = demo;
    const motionToggle = h('input', { type: 'checkbox', id: 'room-motion' });
    motionToggle.checked = reducedMotion;
    const trapsToggle = h('input', { type: 'checkbox', id: 'room-traps' });
    const bubblesToggle = h('input', { type: 'checkbox', id: 'room-bubbles' });
    bubblesToggle.checked = true;
    const settings = h('details', { class: 'legend-pop keys-pop settings-pop' },
      h('summary', { 'aria-label': 'Nastavení', title: 'Nastavení' }, '⚙'),
      h('div', { class: 'legend-pop-body' },
        h('strong', null, 'Nastavení'),
        h('label', { class: 'set-row', for: 'room-motion' }, motionToggle, ' Omezit pohyb (bez přeletů kamery)'),
        h('label', { class: 'set-row', for: 'room-traps' }, trapsToggle, ' Ukázat i nevhodné sestavy (pasti)'),
        career ? h('label', { class: 'set-row', for: 'room-bubbles' }, bubblesToggle, ' Bubliny s nápovědou') : null,
        career ? button('Postup zobrazit / skrýt (Shift+T)', () => checklist?.setMode(checklist.mode === 'hidden' ? 'open' : 'hidden'), { class: 'btn btn-small' }) : null,
        career ? null : h('label', { class: 'set-row', for: 'room-demo', title: 'Rozmístí ukázkové racky, servery, switche a kabely s ilustrativním provozem' }, demoToggle, ' Ukázka ', h('span', { class: 'ui-badge' }, 'ilustrativní')),
        career ? null : button('Změnit blueprint / lokalitu…', () => ctx.navigate({ name: 'sandbox-site' }), { class: 'btn btn-small', title: `Teď: ${site.layout().label}` }),
      ),
    );
    const dnsBtn = button('DNS', () => panels.openDns(), { class: 'btn btn-small', title: 'DNS server firmy (mimo VCF)' });
    const designBtn = button('Návrh', () => setSide(!sideOpen), { class: 'btn btn-small hud-design', title: 'Návrhová rozhodnutí (D)', 'aria-expanded': 'false', hidden: true });
    // Site widget: room name, AZ badge (UI only, via the site adapter), room switcher + site overview.
    const roomTitle = h('strong', null, 'Serverovna');
    const azBtn = button('AZ —', () => {
      const r = site.setAz(roomId, AZ_CYCLE[(AZ_CYCLE.indexOf(curRoom().az) + 1) % AZ_CYCLE.length]!);
      if (!r.ok) say(r.message, true);
    }, {
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
    const hudMid = h('span', { class: 'hud-mid' }, designBtn);
    const hud = h('header', { class: 'room-hud v3' },
      button('← Menu', () => ctx.navigate(career ? { name: 'career', level: careerId! } : { name: 'menu' }), { class: 'btn btn-small', title: career ? 'Zpět na briefing levelu' : 'Odejít do menu' }),
      h('div', { class: 'room-title' }, roomTitle, h('span', { class: 'muted hud-ver' }, ` · ${VCF_VERSION}`)),
      siteWidget,
      h('div', { class: 'hud-chip', title: career ? 'Rozpočet levelu – herní měna (fiktivní), nejsou to údaje z dokumentace.' : 'Herní měna – v Sandboxu neomezená. Ceny jsou herní, nejsou z dokumentace.' }, h('span', { class: 'coin', 'aria-hidden': 'true' }), moneyEl, h('small', null, ' herní')),
      pointsEl,
      hudMid,
      timeSlot,
      dnsBtn,
      helpMenu(() => goTo({ kind: 'pc', app: 'knihovna' })),
      settings,
    );
    ui.append(hud, toast, live, liveBad);
    const time = createTimeControls(timeSlot, engine, 'stepped');
    const panels = createObjectPanels({ ui, port: () => port, announce: (t, bad) => say(t, bad), onOpenHost: (id) => openHost(id), onOpenConsole: (id) => openConsole(id), onLayout: () => {
      if (panels?.openId && sideOpen) setSide(false);
      relayout();
    } });
    function undoRedo(which: 'undo' | 'redo'): void {
      const ops = port?.ops;
      if (!ops) return say('Vracení změn funguje jen v tvé serverovně, ne v ukázce.', true);
      const r = ops.dispatch({ type: which === 'undo' ? 'undoRoom' : 'redoRoom' });
      say(r.ok ? (which === 'undo' ? 'Vráceno.' : 'Zopakováno.') : r.message, !r.ok);
    }
    const rackTools = (rackId?: string): HTMLElement[] => {
      const rot = rackId && port?.rotateRack ? button(h('span', { class: 'icon-text' }, icon('rotate'), 'Otočit (R)'), () => rotatePlaced(rackId), { class: 'btn btn-small', title: 'Otočit rack – čelo po směru hodinových ručiček na další povolený směr (herní pravidla místnosti)' }) : null;
      const u = button('⟲', () => undoRedo('undo'), { class: 'btn btn-small rack-undo', title: 'Vrátit (Ctrl+Z)', 'aria-label': 'Vrátit změnu (Ctrl+Z)' });
      const r = button('⟳', () => undoRedo('redo'), { class: 'btn btn-small rack-redo', title: 'Zopakovat (Ctrl+Y)', 'aria-label': 'Zopakovat změnu (Ctrl+Y)' });
      u.disabled = !state?.undo?.canUndo;
      r.disabled = !state?.undo?.canRedo;
      return rot ? [u, r, rot] : [u, r];
    };
    function openDevice(id: string): void {
      const d = state?.devices.find((x) => x.id === id);
      if (!d) return;
      if (d.kind === 'server') panels.openServer(id);
      else panels.openSwitch(id);
    }
    // ------------------------------------------------------------ server console (UX ch. 20)
    let consoleView: ServerConsole | null = null;
    let consoleHidden: { room: boolean; rack: boolean } | null = null;
    function openConsole(id: string): void {
      const ops = port?.ops;
      if (!ops) return say('Konzole funguje jen v tvé serverovně (ne v ukázce).', true);
      closeConsole();
      panels.close();
      closeSourcePopover();
      // Pause the scene drawing under the full-area console (weak laptops): hide the worlds, keep the clock.
      consoleHidden = { room: room.world.visible, rack: stage.rack.root.visible };
      room.world.visible = false;
      stage.rack.root.visible = false;
      ui.classList.add('console-open');
      consoleView = createServerConsole({ ops, serverId: id, host: ui, announce: (t, bad) => say(t, bad), onClose: () => closeConsole() });
    }
    function closeConsole(): void {
      if (!consoleView) return;
      consoleView.dispose();
      consoleView = null;
      ui.classList.remove('console-open');
      if (consoleHidden) {
        room.world.visible = consoleHidden.room;
        stage.rack.root.visible = consoleHidden.rack;
      }
      consoleHidden = null;
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
      if (career) port?.useHint?.(o.id, 'show');
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

    // ------------------------------------------------------------ right panel (design decisions) – v3: only from the
    // design phase on (HUD button "Návrh"); no vertical tab (UX 16.1)
    const sideBody = h('div', { class: 'room-side-body', id: 'room-side-body' });
    const side = h('aside', { class: 'room-side', 'aria-label': 'Návrhová rozhodnutí', hidden: true },
      h('div', { class: 'side-head' }, h('strong', null, 'Návrhová rozhodnutí'), button('×', () => setSide(false), { class: 'btn btn-small', 'aria-label': 'Zavřít návrh (D)' })),
      sideBody);
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
      if (open && designBtn.hidden) return;
      sideOpen = open;
      side.hidden = !open;
      designBtn.setAttribute('aria-expanded', String(open));
      designBtn.setAttribute('aria-pressed', String(open));
      if (open) {
        panels.close();
        mountDesign();
      }
      relayout();
    };
    /** Design phase reached (progressive disclosure, UX 16.1): any host with ESX, or a design choice already made. */
    const designPhase = (s: RoomState): boolean => {
      const grp = s.objectives.findIndex((o) => /návrh/i.test(o.group ?? ''));
      const nextIdx = s.objectives.findIndex((o) => o.id === s.nextObjectiveId);
      if (grp >= 0 && nextIdx >= 0) return nextIdx >= grp;
      return s.devices.some((d) => d.kind === 'server' && d.esxInstalled) || Object.keys(sharedDesignState().selection()).length > 0;
    };

    // ------------------------------------------------------------ shop + traffic chip
    const shop = createShop({
      onBuy: (itemId, qty) => {
        if (!port) return;
        let first: InventoryEntry | undefined;
        let n = 0;
        for (let i = 0; i < qty; i++) {
          const r = port.buyItem(itemId);
          if (!r.ok) {
            say(r.message, true);
            break;
          }
          n++;
          first ??= port.state().inventory.find((e) => e.id === r.id);
        }
        if (!n) return;
        say(n > 1 ? `Koupeno ${n}× – umísti je do racku.` : `Koupeno: ${first?.label ?? itemId}.`);
        if (career && n) bubble?.event('done', n > 1 ? `Koupeno ${n}×. Klikni na rack – server se zasune na nejnižší volnou pozici.` : 'Koupeno. Teď ho umísti.');
        if (first) pick(first);
      },
      onPick: (e) => pick(e),
      onSell: (id) => {
        const r = port?.removeItem(id);
        if (r && !r.ok) say(r.message, true);
        else say('Prodáno (vrací se 100 % herní ceny).');
      },
      onLayout: () => relayout(),
      showTraps: () => trapsToggle.checked,
      moneyNote: () => (career ? 'Ceny: herní · rozpočet levelu' : 'Ceny: herní · Sandbox ∞'),
    });
    trapsToggle.addEventListener('change', () => state && shop.update(state, picked?.id ?? null));
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

    // ------------------------------------------------------------ rack placement (engine hints, UX: ghost)
    const placeBar = h('div', { class: 'ui-panel place-bar', role: 'region', 'aria-label': 'Umísťování racku', hidden: true });
    ui.appendChild(placeBar);
    /** Rack height (U) of an inventory rack (catalog) – drawn at its real relative height. */
    const unitsOf = (e: InventoryEntry): number | undefined => state?.catalog.racks.find((r) => r.id === e.catalogItemId)?.heightU ?? state?.racks.find((r) => r.id === e.id)?.heightU;
    const hintsFor = (e: InventoryEntry): readonly RackTileHint[] | null => (placement ? (placement.hintsByModel[e.catalogItemId] ?? []) : null);
    const hintAt = (hs: readonly RackTileHint[], gx: number, gy: number): RackTileHint | undefined => hs.find((x) => x.tile.gx === gx && x.tile.gy === gy);
    function refreshPlacement(): void {
      placement = port?.roomPlacement?.(roomId) ?? null;
      room.setAisles(placement ? placement.aisles : null);
      const e = picked;
      if (e?.kind === 'rack') {
        const hs = hintsFor(e);
        room.setPlacementHints(hs ? { tiles: hs, facing: placeFacing } : null);
      } else room.setPlacementHints(null);
      renderPlaceBar();
    }
    function renderPlaceBar(): void {
      const e = picked;
      placeBar.hidden = !e || view.kind !== 'room';
      if (placeBar.hidden || !e) return;
      if (e.kind !== 'rack') {
        // Server placement (UX 19.2): racks with free U are outlined; click = lowest free position.
        placeBar.replaceChildren(
          h('div', { class: 'place-row' }, h('strong', null, e.label), button('Zrušit (Esc)', () => pick(null), { class: 'btn btn-small btn-ghost' })),
          h('div', { class: 'place-row small' }, 'Klikni na rack – server se zasune na nejnižší volnou pozici. Přesnou pozici vybereš v pohledu racku.'),
        );
        return;
      }
      const hs = hintsFor(e);
      const okTiles = hs ? hs.filter((x) => x.facings.includes(placeFacing)).length : null;
      placeBar.replaceChildren(
        h('div', { class: 'place-row' },
          h('strong', null, `${e.label}`), h('span', { class: 'muted' }, ` · ${unitsOf(e) ?? '?'}U · `), h('span', null, FACING_LABEL[placeFacing]),
          button(h('span', { class: 'icon-text' }, icon('rotate'), 'Otočit (R)'), () => rotatePick(), { class: 'btn btn-small', title: 'Otočit čelo racku (R)' }),
          button('Zrušit (Esc)', () => pick(null), { class: 'btn btn-small btn-ghost' }),
        ),
        h('div', { class: 'place-row small' },
          h('span', { class: 'place-key place-ok' }, 'modrá = sem lze'), h('span', { class: 'place-key place-bad' }, 'šrafovaná = nelze (najeď myší pro důvod)'),
          h('span', { class: 'place-key aisle-cold' }, 'studená ulička (čelo)'), h('span', { class: 'place-key aisle-hot' }, 'teplá ulička (záda)'),
          h('span', { class: 'ui-badge badge-generic', title: 'Rozmístění racků, uličky a volné sloty jsou herní pravidla místnosti, ne fakta z dokumentace VCF.' }, 'herní pravidla místnosti'),
        ),
        okTiles !== null ? h('div', { class: 'place-row small muted' }, `Volné sloty: ${placement?.freeSlots ?? '?'} · vhodných dlaždic s tímto čelem: ${okTiles}`) : h('div', { class: 'place-row small muted' }, 'Ukázková místnost: kontroluje se jen obsazenost dlaždice.'),
      );
    }
    function rotatePick(): void {
      const e = picked;
      if (!e || e.kind !== 'rack') return;
      const hs = hintsFor(e);
      // Next facing clockwise; prefer one that has at least one valid tile.
      let f = nextFacing(placeFacing);
      if (hs) for (let i = 0; i < 4 && !hs.some((x) => x.facings.includes(f)); i++) f = nextFacing(f);
      placeFacing = f;
      say(`Čelo racku: ${FACING_LABEL[f]}.`);
      refreshPlacement();
    }
    /** Rotate a placed rack to the next facing the engine allows on its tile. */
    function rotatePlaced(rackId: string): void {
      const r = state?.racks.find((x) => x.id === rackId);
      if (!port?.rotateRack || !r?.tile) return say('Otáčení racku je jen v tvé serverovně (ne v ukázce).', true);
      const cur = r.facing ?? 'S';
      const hs = port.rackHints?.(roomId, rackId) ?? [];
      const allowed = hintAt(hs, r.tile.gx, r.tile.gy)?.facings ?? [];
      let f = nextFacing(cur);
      for (let i = 0; i < 3 && !allowed.includes(f); i++) f = nextFacing(f);
      if (f === cur || !allowed.includes(f)) {
        const why = port.checkRackTile?.(roomId, r.tile, nextFacing(cur), rackId)?.issues[0]?.message;
        return say(`Rack ${r.label} nejde otočit – herní pravidla místnosti${why ? `: ${why}` : '.'}`, true);
      }
      const res = port.rotateRack(rackId, f);
      if (!res.ok) return say(res.message, true);
      say(`Rack ${r.label}: ${FACING_LABEL[f]}.`);
    }

    function pick(e: InventoryEntry | null): void {
      picked = e;
      if (!e) room.setGhost(null);
      canvas.style.cursor = e ? 'copy' : '';
      if (e && view.kind !== 'room') goTo(ROOM_VIEW);
      if (e?.kind === 'rack') {
        // Start with the first facing that has a valid tile (engine hints).
        const hs = hintsFor(e);
        if (hs && !hs.some((x) => x.facings.includes(placeFacing))) placeFacing = FACING_ORDER.find((f) => hs.some((x) => x.facings.includes(f))) ?? 'S';
      }
      bubble?.setDimmed(!!e);
      if (state) shop.update(state, picked?.id ?? null);
      refreshPlacement();
    }

    // ------------------------------------------------------------ Career: checklist (UX 17) + bubble (UX 18)
    let checklist: Checklist | null = null;
    let bubble: SpeechBubble | null = null;
    let checklistAuto = false;
    if (career) {
      checklist = createChecklist({
        allowSkip: false,
        onShowMe: (o) => showMe(o),
        onModeChange: () => relayout(),
        headerExtra: () => (state?.points !== undefined ? `★ ${state.points} b` : null),
      });
      ui.appendChild(checklist.el);
      hudMid.prepend(checklist.hudChip);
      bubble = createSpeechBubble({
        anchorRect: (a) => anchorRect(a),
        obstacles: () => zones.obstacles,
        scene: () => zones.scene,
        onShow: (a) => showAnchor(a),
      });
      ui.appendChild(bubble.el);
      bubblesToggle.addEventListener('change', () => bubble?.setEnabled(bubblesToggle.checked));
    }
    const nextObjective = (s: RoomState): ObjectiveView | undefined =>
      (s.nextObjectiveId ? s.objectives.find((o) => o.id === s.nextObjectiveId) : undefined) ?? s.objectives.find((o) => o.status !== 'done' && o.status !== 'skipped' && o.kind !== 'game-optional');
    let lastNext = '';
    function renderHud(s: RoomState): void {
      moneyEl.textContent = s.budget !== undefined ? formatPrice(s.budget - s.spent) : `∞ · utraceno ${formatPrice(s.spent)}`;
      pointsEl.hidden = s.points === undefined;
      pointsEl.textContent = s.points !== undefined ? `★ ${s.points} b herní` : '';
      designBtn.hidden = !designPhase(s) || demo;
      if (designBtn.hidden && sideOpen) setSide(false);
      if (!checklist || !bubble) return;
      checklist.update(s.objectives, s.nextObjectiveId);
      const next = checklist && s.objectives.find((o) => o.status === 'problem') || nextObjective(s);
      if (lastNext && next?.id !== lastNext) {
        const done = s.objectives.find((o) => o.id === lastNext);
        if (done?.status === 'done') bubble.event('done', `${done.title}.`);
      }
      lastNext = next?.id ?? '';
      bubble.setInstruction(next?.id ?? null, next ? (next.bubble ?? { text: next.title, anchor: 'avatar' }) : null);
    }

    // ------------------------------------------------------------ layout zones (UX 22)
    let zones: Zones = computeZones({ viewportW: innerWidth, viewportH: innerHeight, checklist: 'hidden', rightPanel: false, shop: 'open' });
    function relayout(): void {
      const panelOpen = sideOpen || panels.openId !== null;
      const inRoom = view.kind === 'room' && !overview.active;
      const clMode = checklist ? (view.kind === 'room' || view.kind === 'rack' ? checklist.mode : 'hidden') : 'hidden';
      zones = computeZones({ viewportW: innerWidth, viewportH: innerHeight, checklist: clMode, rightPanel: panelOpen, shop: inRoom ? (shop.open ? 'open' : 'collapsed') : 'none' });
      if (checklist && zones.autoCollapseChecklist && checklist.mode === 'open') {
        checklistAuto = true;
        checklist.setMode('bar');
        return;
      }
      if (checklist && checklistAuto && !zones.autoCollapseChecklist && checklist.mode === 'bar') {
        checklistAuto = false;
        checklist.setMode('open');
        return;
      }
      applyZoneVars(ui, zones);
      ui.classList.toggle('panel-open', panelOpen);
      if (view.kind === 'room' && !transition) camera?.set(fitRoom());
      if (!transition) rackPanel?.refit();
      bubble?.reposition();
    }
    setSourceObstacles(() => zones.obstacles);

    /** Screen rect of a bubble anchor ('avatar' | 'object:<kind>:<id>' | 'ui:<id>'). */
    function anchorRect(a: string): Rect | null {
      const cam = camera?.camera ?? null;
      const toScreen = (r: { x: number; y: number; width: number; height: number }): Rect | null =>
        cam ? { x: cam.x + r.x * cam.scale, y: cam.y + r.y * cam.scale, w: r.width * cam.scale, h: r.height * cam.scale } : null;
      if (a === 'avatar') {
        if (view.kind !== 'room') return null;
        const r = room.avatarRect?.();
        return r ? toScreen(r) : null;
      }
      if (a.startsWith('ui:')) {
        const id = a.slice(3);
        const el = id === 'shop-racks' || id === 'shop:racks' ? shop.tabRect('racks') : id.startsWith('shop') ? shop.tabRect('servers') : ui.querySelector(`[data-ui="${CSS.escape(id)}"]`)?.getBoundingClientRect() ?? null;
        return el && el.width ? { x: el.left, y: el.top, w: el.width, h: el.height } : null;
      }
      const [, kind, id] = a.split(':');
      if (kind === 'rack' && id && view.kind === 'room') {
        const r = room.cabinetRect(id);
        return r ? toScreen(r) : null;
      }
      if ((kind === 'server' || kind === 'tor' || kind === 'switch') && id) {
        const el = ui.querySelector(`[data-devbtn="${CSS.escape(id)}"]`)?.getBoundingClientRect();
        if (el && el.width) return { x: el.left, y: el.top, w: el.width, h: el.height };
        const rackId = state?.devices.find((d) => d.id === id)?.mount?.rackId;
        if (rackId && view.kind === 'room') {
          const r = room.cabinetRect(rackId);
          return r ? toScreen(r) : null;
        }
      }
      return null;
    }
    function showAnchor(a: string): void {
      if (a.startsWith('ui:shop')) {
        if (view.kind !== 'room') goTo(ROOM_VIEW);
        shop.setTab(a.includes('rack') ? 'racks' : 'servers');
        return;
      }
      const [, kind, id] = a.split(':');
      if (kind === 'rack' && id) return openRack(id);
      const rackId = id ? state?.devices.find((d) => d.id === id)?.mount?.rackId : undefined;
      if (rackId) goTo({ kind: 'rack', rackId });
    }

    // ------------------------------------------------------------ camera + room input
    const fitRoom = (): Camera => {
      const z = zones;
      const left = checklist && checklist.mode === 'open' && view.kind === 'room' ? z.checklistW + 12 : 0;
      const w = z.scene.w - left;
      const cam = fitRect(room.bounds, Math.max(200, w), Math.max(200, z.scene.h), 20);
      return { x: cam.x + left, y: cam.y + z.scene.y, scale: cam.scale };
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
        onChange: (cam) => {
          stage.setCamera(cam);
          bubble?.reposition();
        },
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
          const hs = hintsFor(sel);
          if (hs) {
            // Session: the engine's [GAME] room rules decide (hints); the reason comes from the model.
            if (!hintAt(hs, tile.gx, tile.gy)?.facings.includes(placeFacing)) {
              const why = port.checkRackTile?.(roomId, tile, placeFacing, sel.id)?.issues[0]?.message;
              return say(`Sem rack nelze (herní pravidlo místnosti)${why ? `: ${why}` : '.'}`, true);
            }
          } else {
            // Local fallback / demo room only: physical occupancy check of the drawing.
            const chk = room.checkPlace('rack', tile);
            if (!chk.ok) return say(chk.reason === 'occupied' ? 'Dlaždice je obsazená.' : chk.reason === 'avatar' ? 'Tady stojí panáček.' : 'Mimo místnost.', true);
          }
          if (port.source !== 'session') site.assignRack(sel.id, roomId); // local fallback / demo: room kept by the UI
          const r = port.placeRack(sel.id, tile, roomId, placeFacing);
          if (!r.ok) return say(r.message, true);
          pick(null);
          say(`${sel.label} postaven (${FACING_LABEL[placeFacing]}) – ToR switch nahoře je předinstalovaný.`);
          return;
        }
        if (!cab) return say('Klikni na rack.', true);
        const r = port.mountDevice(sel.id, cab.id);
        if (!r.ok) return say(r.message, true);
        pick(null);
        say(`${sel.label} zaracován do ${cab.id}.`);
        // Next not-placed server of the same purchase continues the placement (Shift+klik = koupit 4).
        const nextSrv = port.state().inventory.find((x) => x.kind === 'server');
        if (nextSrv) pick(nextSrv);
        else shop.setOpen(false);
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

    const goTo = (v: RoomView): void => ctx.navigate({ name: 'sandbox-room', demo, ...(careerId ? { career: careerId } : {}), ...(multiRoom() && !careerId ? { roomId } : {}), ...(v.kind === 'room' ? {} : { view: v }) });

    // ------------------------------------------------------------ multi-room site (rooms, door, overview)
    const goRoom = (id: string): void => ctx.navigate(careerId ? { name: 'sandbox-room', demo: false, career: careerId } : { name: 'sandbox-room', demo, roomId: id });
    const goOverview = (): void => {
      if (careerId) return;
      ctx.navigate({ name: 'sandbox-room', demo, overview: true });
    };
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
      side.hidden = hidden || !sideOpen;
      if (checklist) checklist.el.hidden = hidden || checklist.mode === 'hidden';
      if (bubble) bubble.el.hidden = hidden;
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
      renderPlaceBar();
      tip.hidden = true;
      room.setHighlightedCabinet(null);
      if (objHooks.switchApp(prev, next)) return; // Sprint 2B hook: pc app -> pc app
      closeConsole();
      if (next.kind === 'room') {
        closeObjectView(prev, animate);
        relayout();
        return;
      }
      queueMicrotask(() => relayout());
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
          toolbarExtra: rackTools(next.rackId),
          rightInset: () => zones.rightW,
          obstacles: () => zones.obstacles,
        });
        if (next.kind === 'host' && !hostDetail) say('Detail hosta je jen v tvé serverovně (ne v ukázce).', true);
      } else if (!objHooks.open(next)) {
        showPlaceholder(next);
      }
      const rect = next.kind === 'rack' || next.kind === 'host' ? room.cabinetRect(next.rackId) : objHooks.rect(next);
      const from = savedRoomCam;
      const to = rect ? cameraOnto(rect, { x: 0, y: TOP_H, width: canvas.clientWidth, height: canvas.clientHeight - TOP_H - zones.shopH }) : from;
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
      side.hidden = !sideOpen;
      const back = savedRoomCam ?? fitRoom();
      savedRoomCam = null;
      const restore = (): void => {
        room.world.alpha = 1;
        room.world.visible = true;
        attachRoomControls(back);
      };
      if (!animate || prev.kind === 'room') return restore();
      const rect = prev.kind === 'rack' || prev.kind === 'host' ? room.cabinetRect(prev.rackId) : objHooks.rect(prev);
      const from = rect ? cameraOnto(rect, { x: 0, y: TOP_H, width: canvas.clientWidth, height: canvas.clientHeight - TOP_H - zones.shopH }) : back;
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
      refreshPlacement();
      if (!demoTraffic) room.setTrafficSource(new StaticTrafficSource(linkTrafficOf(state)));
      if (!demoTraffic) room.setBmcTransfers(bmcTransfersOf(state));
      shop.update(state, picked?.id ?? null);
      renderHud(state);
      room.setCompanyUplink(state.companyNetwork ? { deviceId: state.companyNetwork.switchId, port: state.companyNetwork.port } : null);
      dnsBtn.hidden = !port.ops;
      for (const b of ui.querySelectorAll<HTMLButtonElement>('.rack-undo')) b.disabled = !state.undo?.canUndo;
      for (const b of ui.querySelectorAll<HTMLButtonElement>('.rack-redo')) b.disabled = !state.undo?.canRedo;
      panels.refresh();
      if (consoleView && port.ops) consoleView.update(port.ops.snapshot());
      // Career: level passed (engine evaluateLevel) -> result screen (UX 25.5), once.
      if (career && careerId && !careerDone && (port.ops?.snapshot() as { career?: { completed?: boolean } } | undefined)?.career?.completed) {
        careerDone = true;
        ctx.navigate({ name: 'career', level: careerId, result: true });
        return;
      }
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
    let careerDone = false;
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
      renderSiteHud(); // demo <-> player's room use different site ports
      (demo ? createDemoRoomPort() : sharedRoomPort(engine as never)).then((p) => usePort(p, demo), (err: unknown) => say(`Nepodařilo se načíst katalog: ${String(err)}`, true));
    };
    loadPort();
    if (view.kind !== 'room') {
      // Deep link: show the view once the port is ready (no animation).
      camera?.dispose();
      camera = null;
    }
    if (route.name === 'sandbox-room' && route.overview) showOverview();
    relayout();

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
      let badTile: { gx: number; gy: number } | null = null;
      if (picked?.kind === 'rack') {
        const hs = hintsFor(picked);
        const allowed = tile && hs ? (hintAt(hs, tile.gx, tile.gy)?.facings ?? []) : [];
        const valid = tile && hs ? allowed.includes(placeFacing) : undefined;
        if (tile && valid === false) badTile = tile;
        const units = unitsOf(picked);
        room.setGhost(tile ? { kind: 'rack', tile, facing: placeFacing, ...(units !== undefined ? { units } : {}), ...(valid !== undefined ? { valid } : {}), allowed } : null);
        room.setHoverTile(null);
      } else {
        room.setGhost(null);
        room.setHoverTile(picked ? null : tile);
      }
      const cab = hover && !badTile ? room.cabinetAtWorld(hover.wx, hover.wy) : null;
      const cabId = cab?.kind === 'rack' ? cab.id : null;
      const badKey = badTile ? `bad:${badTile.gx},${badTile.gy},${placeFacing}` : null;
      const fxId = hover && !cabId && !picked ? objHooks.fixtureAt(hover.wx, hover.wy) : null; // Sprint 2B hook
      if ((cabId ?? fxId ?? badKey) !== hoverCab) {
        hoverCab = cabId ?? fxId ?? badKey;
        hoverMs = 0;
      }
      room.setHighlightedCabinet(cabId ?? fxId);
      const bundle = hover && !cabId ? room.bundleAtWorld(hover.wx, hover.wy, 8 / camera.camera.scale) : null;
      room.setHoveredBundle(bundle?.key ?? null);
      canvas.style.cursor = picked ? (picked.kind === 'rack' || cabId ? 'copy' : 'not-allowed') : cabId || fxId ? 'zoom-in' : '';
      hoverMs += real;
      if (hover && hoverMs >= TOOLTIP_DELAY_MS && badTile && picked && port?.checkRackTile) {
        // Why the tile is invalid: the model's [GAME] room layout issues (scope game-scope) – shown as a game message.
        if (tip.hidden || tip.dataset['key'] !== badKey) {
          const issues = port.checkRackTile(roomId, badTile, placeFacing, picked.id)?.issues ?? [];
          tip.dataset['key'] = badKey ?? '';
          tip.replaceChildren(message({
            type: 'game-limit', compact: true, title: 'Herní pravidlo místnosti',
            body: issues.length ? h('ul', { class: 'tip-issues' }, ...issues.slice(0, 4).map((i) => h('li', { lang: 'en' }, i.message))) : 'S tímto čelem tu rack nestojí – zkus R.',
            ...(issues[0] ? { reference: `${issues[0].code} · ${issues[0].specRef}` } : {}),
          }));
          tip.style.transform = `translate(${Math.min(canvas.clientWidth - 320, hover.sx + 14)}px, ${hover.sy + 14}px)`;
          tip.hidden = false;
        }
      } else if (hover && hoverMs >= TOOLTIP_DELAY_MS && (cabId || fxId || bundle)) {
        tip.dataset['key'] = '';
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
      if (consoleView && e.key === 'Escape') {
        closeConsole();
        return;
      }
      if (consoleView) return;
      if (e.key === 'Escape' || (e.key === 'Backspace' && !typing)) {
        if (closeSourcePopover()) return;
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
        if (bubble?.escape()) return;
        if (multiRoom()) goOverview(); // room -> site overview (one level up in multi-room layouts)
        return;
      }
      if (typing) return;
      if (e.key === 'D' && e.shiftKey) goTo({ kind: 'pc', app: 'navrh' }); // Sprint 2B hook (UX §7.3)
      else if (e.key === 'd' || e.key === 'D') {
        if (view.kind === 'room') setSide(!sideOpen);
      } else if ((e.key === 'r' || e.key === 'R') && view.kind === 'room' && picked?.kind === 'rack') rotatePick();
      else if ((e.key === 'r' || e.key === 'R') && view.kind === 'room' && hoverCab && !isFixtureId(hoverCab) && !hoverCab.startsWith('bad:')) rotatePlaced(hoverCab);
      else if ((e.key === 'r' || e.key === 'R') && view.kind === 'rack') rotatePlaced(view.rackId);
      else if (e.key === 'l' || e.key === 'L') chip.toggle();
      else if (e.key === 't' && checklist) checklist.setMode(checklist.mode === 'open' ? 'bar' : 'open');
      else if (e.key === 'T' && checklist) checklist.setMode(checklist.mode === 'hidden' ? 'open' : 'hidden');
      else if ((e.key === 'b' || e.key === 'B') && bubble) bubble.open();
      else if ((e.key === 'e' || e.key === 'E' || e.key === 'Enter') && view.kind === 'room' && hoverCab && !hoverCab.startsWith('bad:') && !(t instanceof HTMLButtonElement)) {
        if (isFixtureId(hoverCab)) goTo(objHooks.viewOf(hoverCab));
        else openRack(hoverCab);
      }
      else if (e.key === '0' && view.kind === 'room') camera?.set(fitRoom());
    };
    window.addEventListener('keydown', onKey);
    const onResize = (): void => {
      relayout();
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
        closeConsole();
        closeSourcePopover();
        clearTimeout(toastTimer);
        checklist?.dispose();
        bubble?.dispose();
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
