/**
 * Live miniature of the whiteboard on the room wall (UX.md §10.1): LOD thumbnail of the auto diagram (page
 * Fyzicky), refreshed at most once per second, plus the "!" sticker when the content changed since the board
 * was last opened.
 */
import type { RoomScene } from '../../render/room/roomScene';
import { layoutBoard, layoutKey } from '../../render/whiteboard/hldLayout';
import type { RoomPort } from '../sandbox/sessionPort';
import { boardInputOf } from './boardInput';

const THROTTLE_MS = 1000;

export interface RoomBoardSync {
  /** The board view was opened: clear the sticker. */
  markSeen(): void;
  dispose(): void;
}

export function createRoomBoardSync(room: RoomScene, port: RoomPort): RoomBoardSync {
  let seenKey: string | null = null;
  let key = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRun = 0;
  const run = (): void => {
    timer = null;
    lastRun = Date.now();
    const layout = layoutBoard(boardInputOf(port.state(), port.ops?.snapshot()), 'fyzicky');
    const k = layoutKey(layout);
    if (k !== key) {
      key = k;
      room.fixtures.setThumbnail(layout.empty ? null : layout);
    }
    seenKey ??= key;
    room.fixtures.setSticker(key !== seenKey);
  };
  const schedule = (): void => {
    if (timer) return;
    timer = setTimeout(run, Math.max(0, THROTTLE_MS - (Date.now() - lastRun)));
  };
  const off = port.subscribe(schedule);
  run();
  return {
    markSeen() {
      run();
      seenKey = key;
      room.fixtures.setSticker(false);
    },
    dispose() {
      off();
      if (timer) clearTimeout(timer);
      room.fixtures.setThumbnail(null);
      room.fixtures.setSticker(false);
    },
  };
}
