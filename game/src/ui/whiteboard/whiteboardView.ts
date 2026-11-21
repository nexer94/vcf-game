/**
 * Tabule (whiteboard) – zoomed view (UX.md §10): auto High-Level Design from the game state + the player's notes.
 *
 * DOM: top bar (pages Fyzicky · Síť · Logicky, layer toggles, Popis, close) and the marker shelf (tools).
 * PixiJS: render/whiteboard/boardRenderer.ts on the shared stage. The auto diagram is derived from the snapshot
 * (ui/whiteboard/boardInput.ts -> render/whiteboard/hldLayout.ts); the player cannot erase or move it.
 * Notes persist in localStorage per sandbox (try/catch, size limits – render/whiteboard/notes.ts).
 */
import type { Application } from 'pixi.js';
import { BoardRenderer, zoomStep, type BoardCamera } from '../../render/whiteboard/boardRenderer';
import { describeBoard, layoutBoard, layoutKey, type HldNode } from '../../render/whiteboard/hldLayout';
import {
  BOARD_H,
  BOARD_PAGES,
  BOARD_W,
  BoardNotes,
  isBoardPage,
  LIMITS,
  loadNotes,
  PAGE_LABEL,
  PEN_COLORS,
  PEN_WIDTHS,
  saveNotes,
  type BoardPage,
  type BoardText,
  type PenColorId,
} from '../../render/whiteboard/notes';
import type { Pt } from '../../render/whiteboard/sketch';
import { button, h } from '../dom';
import type { ObjectView } from '../pc/objectView';
import type { RoomPort } from '../sandbox/sessionPort';
import { boardInputOf } from './boardInput';
import './whiteboard.css';

type Tool = 'pointer' | 'pen' | 'text' | 'eraser';

export interface WhiteboardViewOptions {
  readonly ui: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly app: Application;
  readonly port: RoomPort;
  /** localStorage namespace ("per sandbox"). */
  readonly sandboxId: string;
  readonly page?: BoardPage;
  announce(text: string, bad?: boolean): void;
  onBack(): void;
  onOpenRack(rackId: string): void;
}

const TOP = 52 + 44;
const BOTTOM = 62;
const SHELF = 56;
const LAYOUT_THROTTLE_MS = 250;
const SAVE_DEBOUNCE_MS = 1000;
let lastPage: BoardPage = 'fyzicky';

/** Page the next opened board starts on (e.g. "Ukázat na tabuli" from the design summary = Logicky). */
export function preferBoardPage(p: BoardPage): void {
  lastPage = p;
}

const storage = (): Storage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export function createWhiteboardView(o: WhiteboardViewOptions): ObjectView {
  const { canvas, app } = o;
  const dpr = app.renderer.resolution;
  const board = new BoardRenderer(app.renderer, dpr);
  app.stage.addChild(board.root);
  const notes = new BoardNotes(loadNotes(storage(), o.sandboxId));

  let page: BoardPage = o.page && isBoardPage(o.page) ? o.page : lastPage;
  let tool: Tool = 'pointer';
  let color: PenColorId = PEN_COLORS[0].id;
  let width = 1;
  let showAuto = true;
  let showMine = true;
  let cam: BoardCamera = { x: 0, y: 0, scale: 1 };
  let layoutSig = '';
  let disposed = false;

  // ------------------------------------------------------------ DOM
  const tabs = BOARD_PAGES.map((p) =>
    button(PAGE_LABEL[p], () => setPage(p), { class: 'wb-tab', role: 'tab', 'aria-selected': String(p === page), 'data-page': p }),
  );
  const autoToggle = h('input', { type: 'checkbox', id: 'wb-auto', checked: true });
  const mineToggle = h('input', { type: 'checkbox', id: 'wb-mine', checked: true });
  const descPanel = h('aside', { class: 'wb-desc ui-panel', hidden: true, 'aria-label': 'Popis tabule', tabindex: '-1' });
  const descBtn = button('Popis', () => toggleDesc(), { class: 'btn btn-small', 'aria-expanded': 'false', title: 'Textová podoba diagramu (pro čtečky obrazovky)' });
  const bar = h('div', { class: 'wb-bar' },
    h('strong', null, 'Tabule'),
    h('div', { class: 'wb-tabs', role: 'tablist', 'aria-label': 'Stránky tabule' }, ...tabs),
    h('label', { class: 'wb-check', for: 'wb-auto', title: 'A' }, autoToggle, ' auto diagram'),
    h('label', { class: 'wb-check', for: 'wb-mine', title: 'M' }, mineToggle, ' moje poznámky'),
    h('span', { class: 'wb-stamp' }, 'Diagram kreslí hra podle tvé serverovny · ', h('span', { class: 'wb-ink' }, 'modrý inkoust'), ' = hra'),
    descBtn,
    button('✖ Zpět (Esc)', () => o.onBack(), { class: 'btn btn-small', title: 'Zpět do místnosti' }),
  );
  const toolBtn = (t: Tool, label: string, key: string, title: string): HTMLButtonElement =>
    button(label, () => setTool(t), { class: 'wb-tool', 'aria-pressed': String(t === tool), 'data-tool': t, title: `${title} (${key})` });
  const tools = [toolBtn('pointer', '➚ ukazovátko', 'V', 'Ukazovátko – popisky prvků diagramu'), toolBtn('pen', '✎ fix', 'B', 'Fix – kreslení'), toolBtn('text', 'T text', 'N', 'Text – klikni na tabuli'), toolBtn('eraser', '⌫ houba', 'G', 'Houba – maže celé tvoje tahy a texty')];
  const colorBtns = PEN_COLORS.map((c, i) =>
    button(h('span', { class: 'wb-dot', style: `background:${c.css}` }), () => setColor(c.id), { class: 'wb-color', 'aria-pressed': String(c.id === color), 'aria-label': `Barva ${c.label} (${i + 1})`, title: `${c.label} (${i + 1})` }),
  );
  const widthBtns = PEN_WIDTHS.map((w, i) =>
    button(h('span', { class: 'wb-w', style: `height:${Math.round(w)}px` }), () => setWidth(i), { class: 'wb-width', 'aria-pressed': String(i === width), 'aria-label': `Tloušťka ${i + 1}`, title: 'Tloušťka ([ / ])' }),
  );
  const undoBtn = button('⟲', () => doUndo(), { class: 'btn btn-small', 'aria-label': 'Zpět (Ctrl+Z)', title: 'Zpět (Ctrl+Z)' });
  const redoBtn = button('⟳', () => doRedo(), { class: 'btn btn-small', 'aria-label': 'Znovu (Ctrl+Shift+Z)', title: 'Znovu (Ctrl+Shift+Z)' });
  const clearBtn = button('🗑 smazat moje', () => clearMine(), { class: 'btn btn-small', title: 'Smaže tvoje poznámky na této stránce (auto diagram zůstane)' });
  const fillEl = h('span', { class: 'muted small wb-fill' });
  const shelf = h('div', { class: 'wb-shelf', role: 'toolbar', 'aria-label': 'Nástroje tabule' },
    ...tools, h('span', { class: 'wb-sep' }), ...colorBtns, h('span', { class: 'wb-sep' }), ...widthBtns, h('span', { class: 'wb-sep' }), undoBtn, redoBtn, clearBtn, fillEl,
  );
  const tip = h('div', { class: 'ui-panel tooltip wb-tip', role: 'tooltip', hidden: true });
  const root = h('div', { class: 'wb-ui' }, bar, shelf, tip, descPanel);
  o.ui.appendChild(root);
  autoToggle.addEventListener('change', () => setAuto(autoToggle.checked));
  mineToggle.addEventListener('change', () => setMine(mineToggle.checked));

  // ------------------------------------------------------------ camera
  const fit = (): BoardCamera => {
    const w = canvas.clientWidth;
    const hh = canvas.clientHeight - TOP - BOTTOM;
    const scale = Math.max(0.2, Math.min((w - 48) / (BOARD_W + 44), (hh - 24) / (BOARD_H + SHELF)));
    return { x: (w - BOARD_W * scale) / 2, y: TOP + 12 + 22 * scale, scale };
  };
  const setCam = (c: BoardCamera): void => {
    cam = c;
    board.setCamera(c);
  };
  setCam(fit());
  const toBoard = (sx: number, sy: number): Pt => ({ x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale });
  const zoomAt = (factor: number, sx: number, sy: number): void => {
    const base = fit().scale;
    const scale = Math.max(base * 0.6, Math.min(base * 4, cam.scale * factor));
    const p = toBoard(sx, sy);
    const prevStep = zoomStep(cam.scale);
    setCam({ x: sx - p.x * scale, y: sy - p.y * scale, scale });
    if (zoomStep(scale) !== prevStep) positionInput();
  };

  // ------------------------------------------------------------ auto layer (from the snapshot)
  const refreshLayout = (): void => {
    if (disposed) return;
    const state = o.port.state();
    const input = boardInputOf(state, o.port.ops?.snapshot());
    const next = layoutBoard(input, page);
    const sig = `${page}#${layoutKey(next)}`;
    if (sig !== layoutSig) {
      layoutSig = sig;
      board.setLayout(next);
    }
    if (!descPanel.hidden) renderDesc();
  };
  let layoutTimer: ReturnType<typeof setTimeout> | null = null;
  const offPort = o.port.subscribe(() => {
    layoutTimer ??= setTimeout(() => {
      layoutTimer = null;
      refreshLayout();
    }, LAYOUT_THROTTLE_MS);
  });
  refreshLayout();

  // ------------------------------------------------------------ notes + persistence
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let warnedFull = false;
  const save = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    const r = saveNotes(storage(), o.sandboxId, notes.notes);
    if (!r.ok) o.announce(r.reason === 'too-big' ? 'Tabule je moc plná na uložení – smaž staré poznámky.' : 'Poznámky se nepodařilo uložit (úložiště prohlížeče).', true);
  };
  const renderNotes = (): void => {
    board.setNotes(notes.page(page));
    undoBtn.disabled = !notes.canUndo;
    redoBtn.disabled = !notes.canRedo;
    const pg = notes.page(page);
    clearBtn.disabled = pg.strokes.length + pg.texts.length === 0;
    const f = notes.fill(page);
    fillEl.textContent = f >= 0.5 ? `zaplněno ${Math.round(f * 100)} % (herní limit)` : '';
    if (f >= 0.9 && !warnedFull) {
      warnedFull = true;
      o.announce('Tabule je skoro plná – smaž staré poznámky.', true);
    }
    if (!descPanel.hidden) renderDesc();
  };
  const offNotes = notes.subscribe(() => {
    renderNotes();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS);
  });
  renderNotes();

  // ------------------------------------------------------------ state setters
  function setPage(p: BoardPage): void {
    if (p === page) return;
    closeInput(true);
    page = p;
    lastPage = p;
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset['page'] === p));
    refreshLayout();
    renderNotes();
    o.announce(`Tabule: stránka ${PAGE_LABEL[p]}.`);
  }
  function setTool(t: Tool): void {
    closeInput(true);
    tool = t;
    for (const b of tools) b.setAttribute('aria-pressed', String(b.dataset['tool'] === t));
    canvas.style.cursor = t === 'pen' ? 'crosshair' : t === 'text' ? 'text' : t === 'eraser' ? 'cell' : '';
    board.setHover(null);
    tip.hidden = true;
  }
  function setColor(c: PenColorId): void {
    color = c;
    PEN_COLORS.forEach((x, i) => colorBtns[i]!.setAttribute('aria-pressed', String(x.id === c)));
    if (tool !== 'pen' && tool !== 'text') setTool('pen');
  }
  function setWidth(i: number): void {
    width = Math.max(0, Math.min(PEN_WIDTHS.length - 1, i));
    widthBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === width)));
  }
  function setAuto(v: boolean): void {
    showAuto = v;
    autoToggle.checked = v;
    board.setAutoVisible(v);
  }
  function setMine(v: boolean): void {
    showMine = v;
    mineToggle.checked = v;
    board.setNotesVisible(v);
  }
  function doUndo(): void {
    const p = notes.undo();
    if (p && p !== page) setPage(p);
  }
  function doRedo(): void {
    const p = notes.redo();
    if (p && p !== page) setPage(p);
  }
  function clearMine(): void {
    const pg = notes.page(page);
    if (!pg.strokes.length && !pg.texts.length) return;
    if (!window.confirm(`Smazat všechny tvoje poznámky na stránce ${PAGE_LABEL[page]}? Auto diagram zůstane.`)) return;
    notes.clearPage(page);
    o.announce('Smazáno · vrátit jde tlačítkem ⟲ (Ctrl+Z).');
  }

  // ------------------------------------------------------------ text tool (DOM input on the spot, IME-safe)
  let input: { el: HTMLInputElement; at: Pt; editing?: BoardText } | null = null;
  function positionInput(): void {
    if (!input) return;
    input.el.style.transform = `translate(${cam.x + input.at.x * cam.scale}px, ${cam.y + input.at.y * cam.scale}px)`;
    input.el.style.fontSize = `${Math.max(12, 30 * cam.scale)}px`;
  }
  function openInput(at: Pt, editing?: BoardText): void {
    closeInput(true);
    const el = h('input', { type: 'text', class: 'wb-input', maxlength: String(LIMITS.textChars), 'aria-label': 'Text na tabuli (Enter uloží, Esc zruší)', style: `color:${PEN_COLORS.find((c) => c.id === (editing?.color ?? color))!.css}` });
    el.value = editing?.text ?? '';
    input = { el, at: editing ? { x: editing.x, y: editing.y } : at, ...(editing ? { editing } : {}) };
    root.appendChild(el);
    positionInput();
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') closeInput(true);
      else if (e.key === 'Escape') closeInput(false);
    });
    // Focus after the canvas mousedown default action (which would blur the field right away).
    setTimeout(() => {
      if (input?.el !== el) return;
      el.focus();
      el.addEventListener('blur', () => closeInput(true));
    }, 0);
  }
  function closeInput(commit: boolean): void {
    const cur = input;
    if (!cur) return;
    input = null;
    const text = cur.el.value;
    cur.el.remove();
    if (!commit) return;
    const r = cur.editing ? notes.editText(page, cur.editing.id, text) : notes.addText(page, cur.at.x, cur.at.y, color, text);
    if (!r.ok && r.reason === 'too-long') o.announce(`Text je delší než ${LIMITS.textChars} znaků (herní limit).`, true);
  }

  // ------------------------------------------------------------ text alternative (UX §10.6)
  function renderDesc(): void {
    const input2 = boardInputOf(o.port.state(), o.port.ops?.snapshot());
    const pg = notes.page(page);
    descPanel.replaceChildren(
      h('div', { class: 'pop-head' }, h('strong', null, `Popis tabule – ${PAGE_LABEL[page]}`), button('✖', () => toggleDesc(false), { class: 'btn btn-small', 'aria-label': 'Zavřít popis' })),
      h('h3', null, 'Auto diagram (kreslí hra)'),
      h('ul', null, ...describeBoard(input2, page).map((l) => h('li', null, l))),
      h('h3', null, `Moje poznámky (${pg.texts.length})`),
      pg.texts.length ? h('ul', null, ...pg.texts.map((t) => h('li', null, t.text))) : h('p', { class: 'muted small' }, 'Žádné texty.'),
      h('p', { class: 'muted small' }, `${pg.strokes.length} ${pg.strokes.length === 1 ? 'kresba' : pg.strokes.length >= 2 && pg.strokes.length <= 4 ? 'kresby' : 'kreseb'}.`),
    );
  }
  function toggleDesc(force?: boolean): void {
    const open = force ?? descPanel.hidden;
    descPanel.hidden = !open;
    descBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      renderDesc();
      descPanel.focus();
    }
  }

  // ------------------------------------------------------------ pointer input
  let drag: { kind: 'pan' | 'draw' | 'erase'; id: number; sx: number; sy: number; cam: BoardCamera } | null = null;
  let spaceDown = false;
  const local = (e: PointerEvent | MouseEvent | WheelEvent): { sx: number; sy: number } => {
    const r = canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  const onDown = (e: PointerEvent): void => {
    const { sx, sy } = local(e);
    const p = toBoard(sx, sy);
    const panning = e.button === 1 || e.button === 2 || spaceDown || (e.pointerType === 'touch' && tool === 'pointer');
    if (panning) {
      drag = { kind: 'pan', id: e.pointerId, sx, sy, cam };
    } else if (e.button !== 0) return;
    else if (tool === 'pen') {
      if (!showMine) setMine(true);
      board.beginStroke(color, width, p);
      drag = { kind: 'draw', id: e.pointerId, sx, sy, cam };
    } else if (tool === 'eraser') {
      erase(p);
      drag = { kind: 'erase', id: e.pointerId, sx, sy, cam };
    } else if (tool === 'text') {
      if (!showMine) setMine(true);
      const hit = notes.textAt(page, p);
      openInput(p, hit);
      return;
    } else {
      const n = board.nodeAt(p);
      if (n?.rackId && (n.kind === 'host' || n.kind === 'group' || n.kind === 'rack')) o.onOpenRack(n.rackId);
      else drag = { kind: 'pan', id: e.pointerId, sx, sy, cam };
      return;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic / already released pointer */
    }
    e.preventDefault();
  };
  const onMove = (e: PointerEvent): void => {
    const { sx, sy } = local(e);
    if (drag && drag.id === e.pointerId) {
      if (drag.kind === 'pan') setCam({ x: drag.cam.x + sx - drag.sx, y: drag.cam.y + sy - drag.sy, scale: drag.cam.scale });
      else if (drag.kind === 'draw') board.extendStroke(toBoard(sx, sy));
      else erase(toBoard(sx, sy));
      positionInput();
      return;
    }
    if (tool !== 'pointer') return;
    const n = board.nodeAt(toBoard(sx, sy));
    hover(n, sx, sy);
  };
  const onUp = (e: PointerEvent): void => {
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.kind === 'draw') {
      const r = notes.addStroke(page, color, width, board.endStroke());
      if (!r.ok && r.reason === 'full') o.announce('Tabule je plná (herní limit) – tah se neuložil. Smaž staré poznámky.', true);
    }
    drag = null;
  };
  const erase = (p: Pt): void => {
    if (!showMine) return;
    const removed = notes.eraseAt(page, p, 8 / Math.max(0.3, cam.scale));
    if (!removed && showAuto && board.nodeAt(p)) {
      tip.textContent = 'Tohle kreslí hra – houba to nesmaže. Změň serverovnu.';
      tip.style.transform = `translate(${Math.min(canvas.clientWidth - 280, cam.x + p.x * cam.scale + 14)}px, ${cam.y + p.y * cam.scale + 14}px)`;
      tip.hidden = false;
    }
  };
  let hovered: HldNode | null = null;
  function hover(n: HldNode | null, sx: number, sy: number): void {
    if (n !== hovered) {
      hovered = n;
      board.setHover(n && !n.container ? n : n?.rackId ? n : null);
    }
    if (!n) {
      tip.hidden = true;
      canvas.style.cursor = '';
      return;
    }
    tip.replaceChildren(...n.tip.map((l, i) => (i === 0 ? h('strong', null, l) : h('div', null, l))), ...(n.problem ? [h('div', { class: 'bad' }, `! ${n.problem}`)] : []));
    tip.style.transform = `translate(${Math.min(canvas.clientWidth - 280, sx + 14)}px, ${sy + 14}px)`;
    tip.hidden = false;
    canvas.style.cursor = n.rackId ? 'pointer' : '';
  }
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const { sx, sy } = local(e);
    zoomAt(Math.exp(-e.deltaY * 0.0015), sx, sy);
  };
  const onCtx = (e: MouseEvent): void => e.preventDefault();
  const onLeave = (): void => {
    tip.hidden = true;
    board.setHover(null);
    hovered = null;
  };
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onCtx);
  canvas.addEventListener('pointerleave', onLeave);

  // ------------------------------------------------------------ keys (view-local; the room handles Esc)
  const onKey = (e: KeyboardEvent): void => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      doRedo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const lower = k.toLowerCase();
    if (lower === 'v') setTool('pointer');
    else if (lower === 'b') setTool('pen');
    else if (lower === 'n') setTool('text');
    else if (lower === 'g') setTool('eraser');
    else if (k >= '1' && k <= String(PEN_COLORS.length)) setColor(PEN_COLORS[Number(k) - 1]!.id);
    else if (k === '[') setWidth(width - 1);
    else if (k === ']') setWidth(width + 1);
    else if (lower === 'a') setAuto(!showAuto);
    else if (lower === 'm') setMine(!showMine);
    else if (k === '+' || k === '=') zoomAt(1.2, canvas.clientWidth / 2, canvas.clientHeight / 2);
    else if (k === '-') zoomAt(1 / 1.2, canvas.clientWidth / 2, canvas.clientHeight / 2);
    else if (k === '0') setCam(fit());
    else if (k.startsWith('Arrow')) {
      const d = 40;
      setCam({ ...cam, x: cam.x + (k === 'ArrowLeft' ? d : k === 'ArrowRight' ? -d : 0), y: cam.y + (k === 'ArrowUp' ? d : k === 'ArrowDown' ? -d : 0) });
      e.preventDefault();
    } else return;
    positionInput();
  };
  // Space = pan (hold) on the board. Captured so it does not also pause the game clock (time controls listen on window).
  const onSpace = (e: KeyboardEvent): void => {
    const t = e.target;
    if (e.key !== ' ' || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLButtonElement) return;
    spaceDown = true;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener('keydown', onSpace, true);
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') spaceDown = false;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  const onResize = (): void => {
    setCam(fit());
    positionInput();
  };
  window.addEventListener('resize', onResize);

  tabs.find((b) => b.dataset['page'] === page)?.focus({ preventScroll: true });
  o.announce(`Tabule – stránka ${PAGE_LABEL[page]}. Nástroje: V ukazovátko, B fix, N text, G houba. Popis = textová podoba.`);

  return {
    setTransition(alpha, scale) {
      board.root.alpha = alpha;
      root.style.opacity = String(alpha);
      const w = canvas.clientWidth / 2;
      const hh = canvas.clientHeight / 2;
      board.root.scale.set(cam.scale * scale);
      board.root.position.set(w + (cam.x - w) * scale, hh + (cam.y - hh) * scale);
    },
    escape() {
      if (input) {
        closeInput(false);
        return true;
      }
      if (!descPanel.hidden) {
        toggleDesc(false);
        return true;
      }
      if (tool !== 'pointer') {
        setTool('pointer');
        return true;
      }
      return false;
    },
    dispose() {
      if (disposed) return;
      closeInput(true);
      save();
      disposed = true;
      if (layoutTimer) clearTimeout(layoutTimer);
      offPort();
      offNotes();
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onCtx);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('keydown', onSpace, true);
      window.removeEventListener('resize', onResize);
      canvas.style.cursor = '';
      board.root.parent?.removeChild(board.root);
      board.dispose();
      root.remove();
    },
  };
}
