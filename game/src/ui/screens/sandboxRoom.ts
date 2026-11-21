/**
 * Sandbox server room - ART-DIRECTION PROTOTYPE of the physical-build layout:
 *   top: thin HUD (money, game time + speed, phase / next step)
 *   centre: the isometric room with the avatar
 *   bottom: inventory / shop bar (pick an item -> ghost on the grid -> click to place)
 *   right: collapsible design-decisions panel (existing design-step UI mounted lazily)
 *
 * Catalogue items are generic placeholders ("ilustrativní"), no VCF facts. The real
 * catalogue comes from docs/spec (hardware) via the engine; placement rules will then
 * come from the model - this screen only checks physical drawing constraints.
 */
import { attachCameraControls, fitRect, type Camera, type CameraControls } from '../../render';
import { loadRoomDemo } from '../../render/room/roomDemo';
import { TAG_COLORS } from '../../render/room/palette';
import type { Tile } from '../../render/room/roomGrid';
import type { GhostKind, PlaceResult } from '../../render/room/roomScene';
import { button, h } from '../dom';
import { ILLUSTRATIVE_LABEL } from '../hud';
import { createLegend } from '../legend';
import { createLinkTooltip } from '../linkTooltip';
import { loadDesignStepData } from '../sandbox/designData';
import { sharedDesignState } from '../sandbox/designState';
import { createDesignViewState, renderDesignStep, restoreDesignFocus } from '../sandbox/designStep';
import { createTimeControls } from '../timeControls';
import { message } from '../messages';
import { VCF_VERSION } from '../version';
import { onEscape, type ScreenDef } from './screen';
import './room.css';

type ItemAction = { kind: 'floor'; ghost: GhostKind } | { kind: 'mount'; heightU: number; tagColor: number } | { kind: 'none' };

interface InventoryItem {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly icon: string;
  readonly action: ItemAction;
}

interface InventoryCategory {
  readonly id: string;
  readonly label: string;
  readonly items: readonly InventoryItem[];
}

/** Placeholder catalogue (generic, illustrative). Disks / NICs / cables are stubs for now. */
const CATALOG: readonly InventoryCategory[] = [
  {
    id: 'racks',
    label: 'Racky',
    items: [{ id: 'rack', name: 'Rack (prázdný)', desc: 'Postav na volnou dlaždici', icon: 'rack', action: { kind: 'floor', ghost: 'rack' } }],
  },
  {
    id: 'servers',
    label: 'Servery',
    items: [
      { id: 'srv-a', name: 'Server – modrý štítek', desc: 'Klikni na rack', icon: 'server-a', action: { kind: 'mount', heightU: 2, tagColor: TAG_COLORS[0]! } },
      { id: 'srv-b', name: 'Server – zelený štítek', desc: 'Klikni na rack', icon: 'server-b', action: { kind: 'mount', heightU: 2, tagColor: TAG_COLORS[1]! } },
      { id: 'srv-c', name: 'Server – červený štítek', desc: 'Klikni na rack', icon: 'server-c', action: { kind: 'mount', heightU: 1, tagColor: TAG_COLORS[2]! } },
    ],
  },
  {
    id: 'switches',
    label: 'Switche',
    items: [{ id: 'switch', name: 'Switch (generický)', desc: 'Postav na volnou dlaždici', icon: 'switch', action: { kind: 'floor', ghost: 'stand' } }],
  },
  { id: 'cables', label: 'Kabely', items: [{ id: 'cable', name: 'Kabel', desc: 'Připravujeme', icon: 'cable', action: { kind: 'none' } }] },
  { id: 'disks', label: 'Disky', items: [{ id: 'disk', name: 'Disk', desc: 'Připravujeme', icon: 'disk', action: { kind: 'none' } }] },
  { id: 'nics', label: 'NIC', items: [{ id: 'nic', name: 'Síťová karta', desc: 'Připravujeme', icon: 'nic', action: { kind: 'none' } }] },
];

const REASON: Record<Exclude<PlaceResult, { ok: true }>['reason'], string> = {
  duplicate: 'Objekt už existuje.',
  outside: 'Mimo místnost.',
  occupied: 'Dlaždice je obsazená.',
  avatar: 'Tady stojí panáček.',
  unknown: 'Tady není rack.',
  slot: 'V racku už není místo.',
};

/** Keyboard shortcuts of the room (UX.md §4.3). Digits are reserved for the inventory. */
const ROOM_KEYS: readonly [string, string][] = [
  ['Mezerník / P', 'pauza'],
  [', / .', 'zpomalit / zrychlit čas (1× · 4× · 16×)'],
  ['1–6', 'kategorie inventáře (když má fokus inventář)'],
  ['D', 'panel Návrh'],
  ['Esc', 'zrušit výběr → zpět'],
  ['kolečko / tah', 'zoom / posun · dvojklik = celá místnost'],
];

function keysHelp(): HTMLElement {
  return h('details', { class: 'legend-pop keys-pop' },
    h('summary', { 'aria-label': 'Klávesové zkratky', title: 'Klávesové zkratky' }, '⌨'),
    h('div', { class: 'legend-pop-body' },
      h('strong', null, 'Klávesové zkratky'),
      h('dl', null, ...ROOM_KEYS.flatMap(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])),
    ),
  );
}

const HOVER_TOLERANCE_PX = 8;
const TOOLTIP_INTERVAL_MS = 200;
const TOP_H = 52;
const BOTTOM_H = 132;
const SIDE_W = 380;
const SIDE_TAB_W = 44;
const LEGEND_W = 200;

export const sandboxRoomScreen: ScreenDef = {
  stageMode: 'interactive',
  stageScene: 'room',
  mount(root, ctx, route) {
    const { stage, engine } = ctx;
    const room = stage.room;
    const canvas = stage.canvas;
    const startTile: Tile = { gx: Math.floor(room.size.cols / 2), gy: room.size.rows - 2 };
    room.clear();
    room.resetAvatar(startTile);
    let demo = route.name === 'sandbox-room' && route.demo;
    if (demo) loadRoomDemo(room);
    let counter = 0;

    const ui = h('div', { class: 'ui-root room-ui' });
    root.appendChild(ui);

    // ---- top HUD
    const demoToggle = h('input', { type: 'checkbox', id: 'room-demo' });
    demoToggle.checked = demo;
    const toast = h('span', { class: 'room-toast', role: 'status', 'aria-live': 'polite' });
    const timeSlot = h('div', { class: 'room-time' });
    const hud = h(
      'header',
      { class: 'room-hud' },
      button('← Sandbox', () => ctx.navigate({ name: 'sandbox-intro' }), { class: 'btn btn-small', title: 'Zpět (Esc)' }),
      h('div', { class: 'room-title' }, h('strong', null, 'Serverovna'), h('span', { class: 'muted' }, ` · ${VCF_VERSION}`)),
      h('div', { class: 'hud-chip', title: 'Herní měna – v Sandboxu neomezená (není fakt z dokumentace)' }, h('span', { class: 'coin', 'aria-hidden': 'true' }), '∞ ', h('small', null, 'herní')),
      h('div', { class: 'hud-chip phase-chip', title: 'Aktuální fáze a další krok' }, h('strong', null, '1. Fyzická stavba'), h('span', { class: 'muted' }, ' → postav rack')),
      timeSlot,
      keysHelp(),
      h('label', { class: 'hud-chip demo-toggle', for: 'room-demo', title: 'Debug: rozmístí ukázkový rack, 2 servery, switch a kabely' }, demoToggle, ' Ukázka ', h('span', { class: 'ui-badge' }, 'ilustrativní')),
    );
    ui.append(hud, toast);
    const time = createTimeControls(timeSlot, engine, 'stepped');
    const legend = createLegend(ui, { neutralCables: true });
    legend.classList.add('room-legend');
    const tooltip = createLinkTooltip(ui);

    // ---- right panel (design decisions)
    const sideBody = h('div', { class: 'room-side-body' });
    const sideToggle = button('Návrhová rozhodnutí', () => setSide(!sideOpen), { class: 'room-side-tab', 'aria-expanded': 'false', 'aria-controls': 'room-side-body' });
    sideBody.id = 'room-side-body';
    const side = h('aside', { class: 'room-side collapsed', 'aria-label': 'Návrhová rozhodnutí' }, sideToggle, sideBody);
    ui.appendChild(side);
    let sideOpen = false;
    let cameraRef: CameraControls | null = null;
    let designMounted = false;
    let offDesign: (() => void) | null = null;
    const mountDesign = (): void => {
      if (designMounted) return;
      designMounted = true;
      // INTEGRATION POINT: later the SandboxSession port + filtering by current HW.
      const design = sharedDesignState();
      const view = createDesignViewState();
      const notice = message({
        type: 'game-limit',
        compact: true,
        title: 'Návrh zatím nepočítá s místností',
        body: 'Dostupnost voleb podle hardwaru, který tu postavíš, simulace zatím nemodeluje.',
      });
      const render = (): void => {
        const data = loadDesignStepData(design.selection(), design.acknowledged());
        const fk = (document.activeElement as HTMLElement | null)?.dataset?.['fk'];
        renderDesignStep(sideBody, {
          data,
          view,
          notice,
          onSelect: (d, o) => design.select(d, o),
          onAcknowledge: (keys) => design.acknowledgeWarnings(keys),
          onProceed: () => ctx.navigate({ name: 'sandbox', phase: 'priprava' }),
        }, design.acknowledged());
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
      // Keep the room centred in the free area.
      cameraRef?.set(fitRoom());
    };

    // ---- bottom inventory
    let selected: InventoryItem | null = null;
    const itemButtons = new Map<string, HTMLButtonElement>();
    const items = h('div', { class: 'inv-items', role: 'listbox', 'aria-label': 'Položky' });
    const tabs = h('div', { class: 'inv-tabs', role: 'tablist' });
    let activeCat = CATALOG[0]!.id;
    const selectItem = (it: InventoryItem | null): void => {
      selected = it && it.action.kind !== 'none' ? it : null;
      for (const [id, b] of itemButtons) b.setAttribute('aria-selected', String(selected?.id === id));
      if (!selected) room.setGhost(null);
      canvas.style.cursor = selected ? 'copy' : '';
    };
    const renderItems = (): void => {
      itemButtons.clear();
      items.replaceChildren();
      const cat = CATALOG.find((c) => c.id === activeCat)!;
      for (const it of cat.items) {
        const disabled = it.action.kind === 'none';
        const b = button(
          h('span', { class: 'inv-item-body' },
            h('span', { class: `inv-icon icon-${it.icon}`, 'aria-hidden': 'true' }),
            h('span', { class: 'inv-text' }, h('span', { class: 'inv-name' }, it.name), h('span', { class: 'inv-desc' }, it.desc)),
          ),
          () => selectItem(selected?.id === it.id ? null : it),
          { class: 'inv-item', role: 'option', 'aria-selected': 'false', disabled },
        );
        itemButtons.set(it.id, b);
        items.appendChild(b);
      }
      selectItem(null);
    };
    for (const cat of CATALOG) {
      const t = button(cat.label, () => {
        activeCat = cat.id;
        for (const el of tabs.children) el.setAttribute('aria-selected', String(el === t));
        renderItems();
      }, { class: 'inv-tab', role: 'tab', 'aria-selected': String(cat.id === activeCat) });
      tabs.appendChild(t);
    }
    const inv = h('footer', { class: 'room-inv', 'aria-label': 'Inventář a obchod (klávesy 1–6 = kategorie)' },
      h('div', { class: 'inv-head' }, tabs, h('span', { class: 'inv-note' }, 'Katalog je zatím ukázkový – ', h('span', { class: 'ui-badge' }, ILLUSTRATIVE_LABEL))),
      items,
    );
    ui.appendChild(inv);
    renderItems();
    // 1–6 = inventory categories while the inventory has focus (UX.md §4.3; time uses , / .).
    inv.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const n = Number(e.key);
      const tab = Number.isInteger(n) && n >= 1 ? (tabs.children[n - 1] as HTMLButtonElement | undefined) : undefined;
      if (!tab) return;
      e.preventDefault();
      tab.click();
      tab.focus();
    });

    const say = (text: string, bad = false): void => {
      toast.textContent = text;
      toast.classList.toggle('bad', bad);
    };
    say('Klikni na podlahu – panáček tam dojde. Vyber položku dole a postav ji.');

    // ---- camera + input
    const fitRoom = (): Camera => {
      // Keep the room clear of the legend (left) and the side panel / its tab (right).
      const left = canvas.clientWidth >= 1000 ? LEGEND_W : 0;
      const w = canvas.clientWidth - left - (sideOpen ? SIDE_W : SIDE_TAB_W);
      const hh = canvas.clientHeight - TOP_H - BOTTOM_H;
      const cam = fitRect(room.bounds, Math.max(200, w), Math.max(200, hh), 16);
      return { x: cam.x + left, y: cam.y + TOP_H, scale: cam.scale };
    };
    let hover: { sx: number; sy: number; wx: number; wy: number } | null = null;
    let tooltipAge = Infinity;
    const camera = (cameraRef = attachCameraControls({
      element: canvas,
      initial: fitRoom(),
      onChange: (cam) => stage.setCamera(cam),
      onHover: (pos) => {
        hover = pos;
        tooltipAge = Infinity;
      },
      onClick: (pos) => {
        const tile = room.tileAtWorld(pos.wx, pos.wy);
        if (selected) {
          const a = selected.action;
          if (a.kind === 'floor') {
            if (!tile) return say(REASON.outside, true);
            const id = `${a.ghost}-${++counter}`;
            const r = a.ghost === 'rack' ? room.placeRack(id, tile) : room.placeSwitch(id, tile);
            if (!r.ok) return say(REASON[r.reason], true);
            room.walkToCabinet(a.ghost === 'rack' ? id : `${id}-stand`);
            room.setGhost({ kind: a.ghost, tile });
            say(`${selected.name} postaven.`);
          } else if (a.kind === 'mount') {
            const cab = room.cabinetAtWorld(pos.wx, pos.wy);
            if (!cab || cab.kind !== 'rack') return say(REASON.unknown, true);
            const r = room.addServer(cab.id, { id: `srv-${++counter}`, heightU: a.heightU, tagColor: a.tagColor });
            if (!r.ok) return say(REASON[r.reason], true);
            room.walkToCabinet(cab.id);
            say('Server zarackován.');
          }
          return;
        }
        if (!tile) return;
        if (!room.walkTo(tile)) say('Tam se nedá dojít.', true);
      },
    }));
    const onDbl = (): void => camera.set(fitRoom());
    canvas.addEventListener('dblclick', onDbl);

    demoToggle.addEventListener('change', () => {
      demo = demoToggle.checked;
      if (demo) loadRoomDemo(room);
      else room.clear();
      ctx.navigate({ name: 'sandbox-room', demo });
    });

    const offFrame = stage.onFrame((_snap, real) => {
      time.update(_snap);
      const tile = hover ? room.tileAtWorld(hover.wx, hover.wy) : null;
      if (selected && selected.action.kind === 'floor') {
        room.setGhost(tile ? { kind: selected.action.ghost, tile } : null);
        room.setHoverTile(null);
      } else {
        room.setHoverTile(tile);
      }
      const cam = camera.camera;
      const cable = hover && !selected ? room.cableAtWorld(hover.wx, hover.wy, HOVER_TOLERANCE_PX / cam.scale) : null;
      room.setHoveredCable(cable?.id ?? null);
      tooltipAge += real;
      if (!cable || !hover) tooltip.hide();
      else if (tooltipAge >= TOOLTIP_INTERVAL_MS) {
        tooltipAge = 0;
        const t = room.trafficFor(cable.id);
        if (t) tooltip.show(hover.sx, hover.sy, cable.label ?? cable.id, t);
      }
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (e.key === 'd' || e.key === 'D') setSide(!sideOpen);
    };
    window.addEventListener('keydown', onKey);
    const offEsc = onEscape(() => {
      if (selected) selectItem(null);
      else ctx.navigate({ name: 'sandbox-intro' });
    });

    return {
      update(r) {
        if (r.name !== 'sandbox-room' || r.demo === demo) return;
        demo = r.demo;
        demoToggle.checked = demo;
        if (demo) loadRoomDemo(room);
        else room.clear();
      },
      dispose() {
        offEsc();
        window.removeEventListener('keydown', onKey);
        offFrame();
        offDesign?.();
        camera.dispose();
        canvas.removeEventListener('dblclick', onDbl);
        canvas.style.cursor = '';
        room.setGhost(null);
        room.setHoverTile(null);
        room.setHoveredCable(null);
        time.dispose();
        legend.remove();
        ui.remove();
      },
    };
  },
};
