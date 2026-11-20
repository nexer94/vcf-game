import { GameEngine } from './engine';
import { SceneStage } from './render/stage';
import { startApp } from './ui/app';
import './ui/styles.css';
import './ui/screens.css';

async function bootstrap(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) throw new Error('#app element not found');
  host.style.position = 'relative';

  const engine = new GameEngine(1);
  const stage = await SceneStage.create(host, engine);
  startApp(host, stage, engine);
}

void bootstrap();
