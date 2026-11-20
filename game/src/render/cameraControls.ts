import { pan, screenToWorld, zoomAt, type Camera } from './camera';

export interface CameraControlsOptions {
  readonly element: HTMLElement;
  readonly initial: Camera;
  readonly onChange: (cam: Camera) => void;
  /** Pointer hover in screen (element-local) coordinates; null when leaving / dragging. */
  readonly onHover?: (pos: { sx: number; sy: number; wx: number; wy: number } | null) => void;
}

export interface CameraControls {
  get camera(): Camera;
  set(cam: Camera): void;
  dispose(): void;
}

/** Mouse/touch pan (drag) + wheel zoom around the cursor. DOM only, no game logic. */
export function attachCameraControls(opts: CameraControlsOptions): CameraControls {
  const el = opts.element;
  let cam = opts.initial;
  let drag: { id: number; x: number; y: number } | null = null;

  const local = (e: PointerEvent | WheelEvent): { sx: number; sy: number } => {
    const r = el.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  const apply = (next: Camera): void => {
    cam = next;
    opts.onChange(cam);
  };

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
    opts.onHover?.(null);
  };
  const onMove = (e: PointerEvent): void => {
    if (drag && drag.id === e.pointerId) {
      apply(pan(cam, e.clientX - drag.x, e.clientY - drag.y));
      drag.x = e.clientX;
      drag.y = e.clientY;
      return;
    }
    const { sx, sy } = local(e);
    const w = screenToWorld(cam, sx, sy);
    opts.onHover?.({ sx, sy, wx: w.x, wy: w.y });
  };
  const onUp = (e: PointerEvent): void => {
    if (!drag || drag.id !== e.pointerId) return;
    drag = null;
    el.releasePointerCapture(e.pointerId);
    el.style.cursor = '';
  };
  const onLeave = (): void => {
    if (!drag) opts.onHover?.(null);
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const { sx, sy } = local(e);
    // Normalise line/page deltas to pixels.
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    apply(zoomAt(cam, Math.exp(-dy * 0.0015), sx, sy));
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.style.touchAction = 'none';
  opts.onChange(cam);

  return {
    get camera() {
      return cam;
    },
    set(next: Camera) {
      apply(next);
    },
    dispose() {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
    },
  };
}
