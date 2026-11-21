/**
 * Player notes on the whiteboard (UX.md §10.4–10.5) – pure data model, no PixiJS / DOM.
 *
 * - Three pages (Fyzicky · Síť · Logicky), each with its own strokes and texts.
 * - Undo / redo stack per board (max 100 steps, not persisted).
 * - Serialisation: strokes simplified (RDP ε 0.75) and rounded to whole board units, delta encoded.
 * - Game limits (herní): 1 000 strokes / 100 000 points per page, text max 200 characters.
 *
 * Nothing here is a VCF fact – it is the player's own drawing.
 */
import { distToPolyline, simplifyRdp, type Pt } from './sketch';

export const BOARD_PAGES = ['fyzicky', 'sit', 'logicky'] as const;
export type BoardPage = (typeof BOARD_PAGES)[number];
export const isBoardPage = (v: unknown): v is BoardPage => typeof v === 'string' && (BOARD_PAGES as readonly string[]).includes(v);

export const PAGE_LABEL: Readonly<Record<BoardPage, string>> = { fyzicky: 'Fyzicky', sit: 'Síť', logicky: 'Logicky' };

/** Virtual board size (board units). Auto diagram uses x < NOTES_X, the strip on the right is the player's. */
export const BOARD_W = 1600;
export const BOARD_H = 1000;
export const NOTES_X = 1120;

/** Player marker colours (never the auto-diagram ink). All ≥ 3:1 on the board surface #fbfbf7. */
export const PEN_COLORS = [
  { id: 'red', label: 'červená', color: 0xc92a2a, css: '#c92a2a' },
  { id: 'green', label: 'zelená', color: 0x2b8a3e, css: '#2b8a3e' },
  { id: 'orange', label: 'oranžová', color: 0xc2410c, css: '#c2410c' },
] as const;
export type PenColorId = (typeof PEN_COLORS)[number]['id'];
export const PEN_WIDTHS = [2.5, 4.5, 8] as const;

export const LIMITS = { strokesPerPage: 1000, pointsPerPage: 100_000, textChars: 200, undoSteps: 100 } as const;

export interface Stroke {
  readonly id: string;
  readonly color: PenColorId;
  /** Index into PEN_WIDTHS. */
  readonly width: number;
  readonly points: readonly Pt[];
}

export interface BoardText {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly color: PenColorId;
  readonly size: number;
  readonly text: string;
}

export interface PageNotes {
  readonly strokes: readonly Stroke[];
  readonly texts: readonly BoardText[];
}

export type NotesData = Readonly<Record<BoardPage, PageNotes>>;

type Op =
  | { readonly kind: 'add'; readonly page: BoardPage; readonly strokes: readonly Stroke[]; readonly texts: readonly BoardText[] }
  | { readonly kind: 'remove'; readonly page: BoardPage; readonly strokes: readonly Stroke[]; readonly texts: readonly BoardText[] }
  | { readonly kind: 'edit-text'; readonly page: BoardPage; readonly before: BoardText; readonly after: BoardText };

export type AddResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'full' | 'empty' | 'too-long' };

const EMPTY_PAGE: PageNotes = { strokes: [], texts: [] };
export const emptyNotes = (): NotesData => ({ fyzicky: EMPTY_PAGE, sit: EMPTY_PAGE, logicky: EMPTY_PAGE });

const pointCount = (p: PageNotes): number => p.strokes.reduce((n, s) => n + s.points.length, 0);

let idSeq = 0;
const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(idSeq++).toString(36)}`;

/** Mutable notes store with undo / redo. Listeners fire after every change. */
export class BoardNotes {
  private data: NotesData;
  private undoStack: Op[] = [];
  private redoStack: Op[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(initial: NotesData = emptyNotes()) {
    this.data = initial;
  }

  get notes(): NotesData {
    return this.data;
  }

  page(p: BoardPage): PageNotes {
    return this.data[p];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Fill level of a page vs the game limits (0..1). */
  fill(p: BoardPage): number {
    const pg = this.data[p];
    return Math.max(pg.strokes.length / LIMITS.strokesPerPage, pointCount(pg) / LIMITS.pointsPerPage);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Add a finished stroke (raw points; simplified + rounded here). */
  addStroke(page: BoardPage, color: PenColorId, width: number, raw: readonly Pt[]): AddResult {
    const pts = roundPts(simplifyRdp(raw, 0.75));
    if (pts.length === 0) return { ok: false, reason: 'empty' };
    const pg = this.data[page];
    if (pg.strokes.length + 1 > LIMITS.strokesPerPage || pointCount(pg) + pts.length > LIMITS.pointsPerPage) return { ok: false, reason: 'full' };
    const stroke: Stroke = { id: newId('s'), color, width: clampWidth(width), points: pts };
    this.apply({ kind: 'add', page, strokes: [stroke], texts: [] }, true);
    return { ok: true };
  }

  addText(page: BoardPage, x: number, y: number, color: PenColorId, text: string, size = 30): AddResult {
    const t = text.trim();
    if (!t) return { ok: false, reason: 'empty' };
    if (t.length > LIMITS.textChars) return { ok: false, reason: 'too-long' };
    const item: BoardText = { id: newId('t'), x: Math.round(x), y: Math.round(y), color, size, text: t };
    this.apply({ kind: 'add', page, strokes: [], texts: [item] }, true);
    return { ok: true };
  }

  editText(page: BoardPage, id: string, text: string): AddResult {
    const before = this.data[page].texts.find((t) => t.id === id);
    if (!before) return { ok: false, reason: 'empty' };
    const t = text.trim();
    if (!t) {
      this.apply({ kind: 'remove', page, strokes: [], texts: [before] }, true);
      return { ok: true };
    }
    if (t.length > LIMITS.textChars) return { ok: false, reason: 'too-long' };
    if (t === before.text) return { ok: true };
    this.apply({ kind: 'edit-text', page, before, after: { ...before, text: t } }, true);
    return { ok: true };
  }

  /** Eraser ("houba"): removes whole strokes / texts under the point (radius in board units). */
  eraseAt(page: BoardPage, p: Pt, radius: number): number {
    const pg = this.data[page];
    const strokes = pg.strokes.filter((s) => distToPolyline(p, s.points) <= radius + PEN_WIDTHS[s.width]! / 2);
    const texts = pg.texts.filter((t) => hitText(t, p, radius));
    if (!strokes.length && !texts.length) return 0;
    this.apply({ kind: 'remove', page, strokes, texts }, true);
    return strokes.length + texts.length;
  }

  /** Text at a point (double-click = edit). */
  textAt(page: BoardPage, p: Pt): BoardText | undefined {
    return [...this.data[page].texts].reverse().find((t) => hitText(t, p, 0));
  }

  /** "Smazat moje" – one undoable step. */
  clearPage(page: BoardPage): number {
    const pg = this.data[page];
    const n = pg.strokes.length + pg.texts.length;
    if (!n) return 0;
    this.apply({ kind: 'remove', page, strokes: pg.strokes, texts: pg.texts }, true);
    return n;
  }

  undo(): BoardPage | null {
    const op = this.undoStack.pop();
    if (!op) return null;
    this.apply(invert(op), false);
    this.redoStack.push(op);
    this.emit();
    return op.page;
  }

  redo(): BoardPage | null {
    const op = this.redoStack.pop();
    if (!op) return null;
    this.apply(op, false);
    this.undoStack.push(op);
    this.emit();
    return op.page;
  }

  private apply(op: Op, record: boolean): void {
    const pg = this.data[op.page];
    let next: PageNotes;
    if (op.kind === 'add') next = { strokes: [...pg.strokes, ...op.strokes], texts: [...pg.texts, ...op.texts] };
    else if (op.kind === 'remove') {
      const s = new Set(op.strokes.map((x) => x.id));
      const t = new Set(op.texts.map((x) => x.id));
      next = { strokes: pg.strokes.filter((x) => !s.has(x.id)), texts: pg.texts.filter((x) => !t.has(x.id)) };
    } else next = { strokes: pg.strokes, texts: pg.texts.map((x) => (x.id === op.before.id ? op.after : x)) };
    this.data = { ...this.data, [op.page]: next };
    if (record) {
      this.undoStack.push(op);
      if (this.undoStack.length > LIMITS.undoSteps) this.undoStack.shift();
      this.redoStack = [];
      this.emit();
    }
  }

  private emit(): void {
    for (const f of this.listeners) f();
  }
}

function invert(op: Op): Op {
  if (op.kind === 'add') return { kind: 'remove', page: op.page, strokes: op.strokes, texts: op.texts };
  if (op.kind === 'remove') return { kind: 'add', page: op.page, strokes: op.strokes, texts: op.texts };
  return { kind: 'edit-text', page: op.page, before: op.after, after: op.before };
}

const clampWidth = (w: number): number => Math.max(0, Math.min(PEN_WIDTHS.length - 1, Math.round(w)));
const roundPts = (pts: readonly Pt[]): Pt[] => {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = { x: Math.round(p.x), y: Math.round(p.y) };
    const last = out[out.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) out.push(q);
  }
  return out;
};

/** Approximate text box (no font metrics in pure code): 0.55 em per character. */
export function textBox(t: BoardText): { x: number; y: number; w: number; h: number } {
  return { x: t.x, y: t.y, w: Math.max(t.size, t.text.length * t.size * 0.55), h: t.size * 1.3 };
}

function hitText(t: BoardText, p: Pt, pad: number): boolean {
  const b = textBox(t);
  return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
}

// ---------------------------------------------------------------------------
// Serialisation (UX §10.5): { v: 1, pages: { fyzicky|sit|logicky: { strokes, texts } } }
// ---------------------------------------------------------------------------

interface SavedStroke {
  c: string;
  w: number;
  /** Delta-encoded points: x0, y0, dx1, dy1, … */
  p: number[];
}
interface SavedText {
  x: number;
  y: number;
  c: string;
  s: number;
  t: string;
}
interface SavedBoard {
  v: 1;
  pages: Partial<Record<BoardPage, { strokes?: SavedStroke[]; texts?: SavedText[] }>>;
}

const COLOR_IDS = new Set<string>(PEN_COLORS.map((c) => c.id));

export function serializeNotes(n: NotesData): string {
  const pages: SavedBoard['pages'] = {};
  for (const page of BOARD_PAGES) {
    const pg = n[page];
    if (!pg.strokes.length && !pg.texts.length) continue;
    pages[page] = {
      strokes: pg.strokes.map((s) => {
        const p: number[] = [];
        let px = 0;
        let py = 0;
        for (const q of s.points) {
          p.push(q.x - px, q.y - py);
          px = q.x;
          py = q.y;
        }
        return { c: s.color, w: s.width, p };
      }),
      texts: pg.texts.map((t) => ({ x: t.x, y: t.y, c: t.color, s: t.size, t: t.text })),
    };
  }
  return JSON.stringify({ v: 1, pages } satisfies SavedBoard);
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parses saved notes; anything malformed is dropped silently (never throws). Limits are enforced. */
export function parseNotes(json: string | null | undefined): NotesData {
  const out: Record<BoardPage, PageNotes> = { ...emptyNotes() };
  if (!json) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object' || (raw as SavedBoard).v !== 1) return out;
  const pages = (raw as SavedBoard).pages ?? {};
  for (const page of BOARD_PAGES) {
    const pg = pages[page];
    if (!pg || typeof pg !== 'object') continue;
    const strokes: Stroke[] = [];
    let points = 0;
    for (const s of Array.isArray(pg.strokes) ? pg.strokes : []) {
      if (strokes.length >= LIMITS.strokesPerPage) break;
      if (!s || !COLOR_IDS.has(s.c) || !num(s.w) || !Array.isArray(s.p) || s.p.length < 2 || s.p.length % 2) continue;
      const pts: Pt[] = [];
      let x = 0;
      let y = 0;
      let ok = true;
      for (let i = 0; i < s.p.length; i += 2) {
        const dx = s.p[i];
        const dy = s.p[i + 1];
        if (!num(dx) || !num(dy)) {
          ok = false;
          break;
        }
        x += dx;
        y += dy;
        pts.push({ x, y });
      }
      if (!ok || points + pts.length > LIMITS.pointsPerPage) continue;
      points += pts.length;
      strokes.push({ id: newId('s'), color: s.c as PenColorId, width: clampWidth(s.w), points: pts });
    }
    const texts: BoardText[] = [];
    for (const t of Array.isArray(pg.texts) ? pg.texts : []) {
      if (!t || !num(t.x) || !num(t.y) || !COLOR_IDS.has(t.c) || typeof t.t !== 'string') continue;
      const text = t.t.slice(0, LIMITS.textChars).trim();
      if (!text) continue;
      texts.push({ id: newId('t'), x: t.x, y: t.y, color: t.c as PenColorId, size: num(t.s) ? Math.max(10, Math.min(60, t.s)) : 22, text });
    }
    out[page] = { strokes, texts };
  }
  return out;
}

// ---------------------------------------------------------------------------
// localStorage (per sandbox; failures are reported, never thrown)
// ---------------------------------------------------------------------------

/** Max serialised size per board (herní limit; localStorage is ~5 MB per origin). */
export const MAX_SAVED_BYTES = 1_500_000;
const KEY_PREFIX = 'vcf-game.board.v1.';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadNotes(storage: StorageLike | undefined, sandboxId: string): NotesData {
  try {
    return parseNotes(storage?.getItem(KEY_PREFIX + sandboxId));
  } catch {
    return emptyNotes();
  }
}

export type SaveResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'too-big' | 'storage' };

export function saveNotes(storage: StorageLike | undefined, sandboxId: string, n: NotesData): SaveResult {
  const json = serializeNotes(n);
  if (json.length > MAX_SAVED_BYTES) return { ok: false, reason: 'too-big' };
  try {
    if (!storage) return { ok: false, reason: 'storage' };
    storage.setItem(KEY_PREFIX + sandboxId, json);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'storage' };
  }
}
