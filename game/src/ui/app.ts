import type { GameEngine } from '../engine';
import type { SceneStage } from '../render/stage';
import { HashRouter } from './hashRouter';
import type { Route } from './router';
import { careerScreen } from './screens/career';
import { mainMenuScreen } from './screens/mainMenu';
import { sandboxIntroScreen } from './screens/sandboxIntro';
import { sandboxRoomScreen } from './screens/sandboxRoom';
import { sandboxShellScreen } from './screens/sandboxShell';
import { sandboxSiteScreen } from './screens/sandboxSite';
import type { AppContext, MountedScreen, ScreenDef } from './screens/screen';
import { trafficDemoScreen } from './screens/trafficDemo';
import { scenariosScreen } from './screens/scenarios';

const SCREENS: Readonly<Record<Route['name'], ScreenDef>> = {
  menu: mainMenuScreen,
  'sandbox-intro': sandboxIntroScreen,
  'sandbox-site': sandboxSiteScreen,
  sandbox: sandboxShellScreen,
  'sandbox-room': sandboxRoomScreen,
  career: careerScreen,
  scenarios: scenariosScreen,
  traffic: trafficDemoScreen,
};

/** Application shell: owns the screen layer above the shared PixiJS stage. */
export function startApp(host: HTMLElement, stage: SceneStage, engine: GameEngine): void {
  const layer = document.createElement('div');
  layer.className = 'screen-layer';
  host.appendChild(layer);

  /** Screen identity: the room screen of a Career level is a different screen instance than the Sandbox room. */
  const keyOf = (r: Route): string => (r.name === 'sandbox-room' && r.career ? `career-room:${r.career}` : r.name);
  let current: { name: string; screen: MountedScreen } | null = null;
  const router = new HashRouter((route) => {
    if (current && current.name === keyOf(route) && current.screen.update) {
      current.screen.update(route);
      return;
    }
    current?.screen.dispose();
    const def = SCREENS[route.name];
    stage.setScene(def.stageScene ?? 'datacenter');
    stage.setMode(def.stageMode);
    current = { name: keyOf(route), screen: def.mount(layer, ctx, route) };
  });
  const ctx: AppContext = { stage, engine, navigate: (r, o) => router.navigate(r, o) };
  router.start();
}
