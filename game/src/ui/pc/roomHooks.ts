/**
 * Glue between the server-room screen (ui/screens/sandboxRoom.ts) and the fixed room objects of Sprint 2B:
 * Počítač (ui/pc/pcView.ts) and Tabule (ui/whiteboard/whiteboardView.ts). Keeps the hook edits in the screen
 * small: picking, tooltips, camera targets, opening / switching / closing the views, the wall miniature and the
 * shared design state binding.
 */
import type { SceneStage } from '../../render/stage';
import { isFixtureId, type FixtureId } from '../../render/room/fixtures';
import { h, button } from '../dom';
import { bindSharedDesignState } from '../sandbox/designState';
import type { RoomView } from '../sandbox/roomViews';
import type { RoomPort } from '../sandbox/sessionPort';
import { createRoomBoardSync, type RoomBoardSync } from '../whiteboard/roomBoard';
import { createWhiteboardView, preferBoardPage } from '../whiteboard/whiteboardView';
import type { ObjectView } from './objectView';
import type { PcUnlock } from './pcData';
import { createPcView, type PcView } from './pcView';
import { createSessionDesignState } from './sessionDesignState';

export interface RoomObjectHooksOptions {
  readonly stage: SceneStage;
  readonly ui: HTMLElement;
  gameTimeMs(): number;
  port(): RoomPort | null;
  goTo(v: RoomView): void;
  /** Camera of the room right now (screen point of the monitor for the PC transition). */
  roomCamera(): { x: number; y: number; scale: number } | null;
  say(text: string, bad?: boolean): void;
  /** "Kup ještě N serverů": back to the room with the shop on servers. */
  openShopServers(): void;
}

export interface RoomObjectHooks {
  readonly current: ObjectView | null;
  fixtureAt(wx: number, wy: number): FixtureId | null;
  tooltip(id: FixtureId): string[];
  viewOf(id: FixtureId): RoomView;
  /** World rect for the camera flight (pc / board views); null for other views. */
  rect(v: RoomView): { x: number; y: number; width: number; height: number } | null;
  /** Opens the pc / board view; false for other views. */
  open(v: RoomView): boolean;
  /** Pc app -> another pc app: switch inside the open view (no transition). */
  switchApp(prev: RoomView, next: RoomView): boolean;
  closeView(): void;
  bindPort(p: RoomPort, isDemo: boolean): void;
  /** Hidden keyboard / screen-reader buttons for the room object list (UX §4.5). */
  srButtons(): HTMLElement[];
  dispose(): void;
}

export const FIXTURE_TIP: Readonly<Record<FixtureId, readonly string[]>> = {
  '@pc': ['Počítač', 'Návrh VCF, use case, knihovna', 'klik / E = posadit se k počítači'],
  '@board': ['Tabule', 'High-Level Design tvé serverovny + tvoje poznámky', 'klik / E = otevřít'],
};

export function createRoomObjectHooks(o: RoomObjectHooksOptions): RoomObjectHooks {
  const room = o.stage.room;
  let current: ObjectView | null = null;
  let boardSync: RoomBoardSync | null = null;
  let demo = false;

  const onUnlock = (u: PcUnlock): void => {
    if (u.target === 'shop-servers') o.openShopServers();
    else {
      o.goTo({ kind: 'room' });
      o.say(`${u.text} – v místnosti (rack → server).`);
    }
  };

  return {
    get current() {
      return current;
    },
    fixtureAt: (wx, wy) => room.fixtureAtWorld(wx, wy),
    tooltip: (id) => [...FIXTURE_TIP[id]],
    viewOf: (id) => (id === '@pc' ? { kind: 'pc', app: 'plocha' } : { kind: 'board' }),
    rect(v) {
      if (v.kind === 'pc') return room.fixtureRect('@pc');
      if (v.kind === 'board') return room.fixtureRect('@board');
      return null;
    },
    open(v) {
      const port = o.port();
      if ((v.kind !== 'pc' && v.kind !== 'board') || !port) return false;
      current?.dispose();
      if (v.kind === 'pc') {
        const r = room.fixtureRect('@pc');
        const cam = o.roomCamera();
        current = createPcView({
          ui: o.ui,
          port,
          app: v.app,
          gameTimeMs: o.gameTimeMs,
          ...(cam ? { originPx: { x: (r.x + r.width / 2) * cam.scale + cam.x, y: (r.y + r.height / 2) * cam.scale + cam.y } } : {}),
          announce: o.say,
          onApp: (app) => o.goTo({ kind: 'pc', app }),
          onBack: () => o.goTo({ kind: 'room' }),
          onUnlock,
          onShowBoard: () => {
            preferBoardPage('logicky');
            o.goTo({ kind: 'board' });
          },
        });
      } else {
        boardSync?.markSeen();
        current = createWhiteboardView({
          ui: o.ui,
          canvas: o.stage.canvas,
          app: o.stage.app,
          port,
          sandboxId: demo ? 'demo' : 'sandbox',
          announce: o.say,
          onBack: () => o.goTo({ kind: 'room' }),
          onOpenRack: (rackId) => o.goTo({ kind: 'rack', rackId }),
        });
      }
      return true;
    },
    switchApp(prev, next) {
      if (prev.kind !== 'pc' || next.kind !== 'pc' || !current) return false;
      (current as PcView).setApp(next.app);
      return true;
    },
    closeView() {
      current?.dispose();
      current = null;
    },
    bindPort(p, isDemo) {
      demo = isDemo;
      bindSharedDesignState(isDemo ? null : createSessionDesignState(p, (m) => o.say(m, true)));
      boardSync?.dispose();
      boardSync = createRoomBoardSync(room, p);
    },
    srButtons() {
      return (['@board', '@pc'] as const).map((id) => {
        const b = button(`Otevřít: ${FIXTURE_TIP[id][0]}`, () => o.goTo(id === '@pc' ? { kind: 'pc', app: 'plocha' } : { kind: 'board' }), { class: 'sr-focusable', 'data-fixture': id });
        b.addEventListener('focus', () => room.setHighlightedCabinet(id));
        b.addEventListener('blur', () => room.setHighlightedCabinet(null));
        return h('li', null, b);
      });
    },
    dispose() {
      current?.dispose();
      current = null;
      boardSync?.dispose();
      boardSync = null;
    },
  };
}

export { isFixtureId };
