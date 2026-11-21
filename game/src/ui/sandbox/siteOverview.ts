/**
 * Site overview mode of the Sandbox room screen (route #/sandbox/mistnost/areal): the building / campus / DR map
 * from render/site, a small DOM card with the rooms (enter, AZ badge) and the illustrative link values.
 * Clicking a room flies the camera onto it and enters the room (UX §7.2 "zoom + prolnutí").
 */
import { attachCameraControls, fitRect, type Camera, type CameraControls } from '../../render';
import type { SceneStage } from '../../render/stage';
import { cameraOnto, easeOutCubic, lerpCamera } from '../../render/room/viewTransition';
import { button, h } from '../dom';
import { badge } from '../messages';
import { AZ_CYCLE, azText, formatLinkGame, siteSceneInput, type SitePort } from './siteLayout';

const ZOOM_MS = 380;

export interface SiteOverviewDeps {
  readonly stage: SceneStage;
  readonly ui: HTMLElement;
  readonly site: SitePort;
  /** Rack tiles per room (miniatures); from the room adapter state. */
  readonly racksOf: (roomId: string) => readonly { gx: number; gy: number }[];
  readonly topH: number;
  readonly reducedMotion: () => boolean;
  readonly currentRoom: () => string;
  readonly onEnterRoom: (roomId: string) => void;
  readonly announce: (text: string) => void;
}

export interface SiteOverview {
  readonly active: boolean;
  show(): void;
  hide(): void;
  refresh(): void;
  dispose(): void;
}

export function createSiteOverview(d: SiteOverviewDeps): SiteOverview {
  const { stage, site } = d;
  const canvas = stage.canvas;
  let active = false;
  let camera: CameraControls | null = null;
  let flight: { t: number; from: Camera; to: Camera; roomId: string } | null = null;
  let offFrame: (() => void) | null = null;
  let hoverRoom: string | null = null;
  const card = h('section', { class: 'ui-panel site-ov', 'aria-label': 'Přehled lokality', hidden: true });
  d.ui.appendChild(card);

  const fit = (): Camera => {
    const w = canvas.clientWidth;
    const hh = canvas.clientHeight - d.topH;
    const cam = fitRect(stage.site.bounds, Math.max(200, w), Math.max(200, hh), 24);
    return { x: cam.x, y: cam.y + d.topH, scale: cam.scale };
  };

  const enter = (roomId: string): void => {
    if (flight) return;
    const rect = stage.site.roomRect(roomId);
    const from = camera?.camera ?? fit();
    if (!rect || d.reducedMotion()) {
      d.onEnterRoom(roomId);
      return;
    }
    camera?.dispose();
    camera = null;
    flight = { t: 0, from, to: cameraOnto(rect, { x: 0, y: d.topH, width: canvas.clientWidth, height: canvas.clientHeight - d.topH }, 0.95), roomId };
  };

  const renderCard = (): void => {
    const layout = site.layout();
    const here = d.currentRoom();
    card.replaceChildren(
      h('h2', null, layout.label),
      h('p', { class: 'muted small' }, 'Klikni na místnost = vstoupit. Kolečko / tah = zoom / posun.'),
      h('ul', null, ...layout.rooms.map((r) => {
        const az = button(azText(r.az), () => site.setAz(r.id, AZ_CYCLE[(AZ_CYCLE.indexOf(r.az) + 1) % AZ_CYCLE.length]!), {
          class: 'az-badge',
          'data-az': r.az ?? 'none',
          title: 'Role místnosti: AZ1 / AZ2 / witness / druhá VCF Instance (co znamená pro VCF, vyhodnocuje model podle dokumentace)',
          'aria-label': `${r.label}: role ${azText(r.az)} – změnit`,
        });
        return h('li', null,
          button(`${r.id === here ? '● ' : ''}${r.label} →`, () => enter(r.id), { class: 'btn btn-small', 'aria-label': `Vstoupit: ${r.label}` }),
          az,
        );
      })),
      ...layout.links.map((l) => h('p', { class: 'small' },
        h('strong', null, `${layout.rooms.find((r) => r.id === l.from)?.label ?? l.from} ↔ ${layout.rooms.find((r) => r.id === l.to)?.label ?? l.to}`), h('span', { class: 'muted' }, ` (${l.kind === 'corridor' ? 'chodba' : l.kind === 'campus' ? 'kampus' : 'WAN'})`), ': ',
        formatLinkGame(l.game), ' ', badge('illustrative', 'herní hodnoty linky'))),
      ...(layout.links.length ? [h('p', { class: 'muted small' }, h('span', { 'aria-hidden': 'true' }, '▬ '), 'bílé „kapsle“ na lince = ilustrativní provoz mezi místnostmi (typ provozu se tu nemodeluje).')] : []),
    );
  };

  const refresh = (): void => {
    if (!active) return;
    stage.site.setInput(siteSceneInput(site.layout(), d.racksOf));
    stage.site.setHereRoom(d.currentRoom());
    renderCard();
  };

  return {
    get active() {
      return active;
    },
    show() {
      if (active) return;
      active = true;
      stage.setScene('site');
      card.hidden = false;
      refresh();
      const initial = fit();
      camera = attachCameraControls({
        element: canvas,
        initial,
        onChange: (cam) => stage.setCamera(cam),
        onHover: (pos) => {
          const id = pos ? stage.site.roomAtWorld(pos.wx, pos.wy) : null;
          if (id !== hoverRoom) {
            hoverRoom = id;
            stage.site.setHoveredRoom(id);
            canvas.style.cursor = id ? 'zoom-in' : '';
          }
        },
        onClick: (pos) => {
          const id = stage.site.roomAtWorld(pos.wx, pos.wy);
          if (id) enter(id);
        },
      });
      stage.setCamera(initial);
      offFrame = stage.onFrame((_s, real) => {
        const f = flight;
        if (!f) return;
        f.t += real;
        const k = easeOutCubic(f.t / ZOOM_MS);
        stage.setCamera(lerpCamera(f.from, f.to, k));
        stage.site.world.alpha = f.t > ZOOM_MS * 0.6 ? Math.max(0, 1 - (f.t - ZOOM_MS * 0.6) / (ZOOM_MS * 0.4)) : 1;
        if (f.t >= ZOOM_MS) {
          flight = null;
          d.onEnterRoom(f.roomId);
        }
      });
      d.announce('Přehled lokality. Vyber místnost.');
      card.querySelector<HTMLElement>('li .btn')?.focus();
    },
    hide() {
      if (!active) return;
      active = false;
      flight = null;
      camera?.dispose();
      camera = null;
      offFrame?.();
      offFrame = null;
      card.hidden = true;
      hoverRoom = null;
      stage.site.setHoveredRoom(null);
      stage.site.world.alpha = 1;
      canvas.style.cursor = '';
      stage.setScene('room');
    },
    refresh,
    dispose() {
      this.hide();
      card.remove();
    },
  };
}
