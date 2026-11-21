import { GameEngine, startEngineLoop } from './engine';
import { SceneStage } from './render/stage';
import { startApp } from './ui/app';
import './ui/styles.css';
import './ui/screens.css';

async function bootstrap(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) throw new Error('#app element not found');
  host.style.position = 'relative';

  const engine = new GameEngine(1);
  // Game time runs independently of rendering (stage 'off' must not stop Sandbox tasks).
  startEngineLoop(engine, {
    request: (cb) => window.requestAnimationFrame(cb),
    cancel: (h) => window.cancelAnimationFrame(h),
  });
  const stage = await SceneStage.create(host, engine);
  startApp(host, stage, engine);
  if (import.meta.env.DEV) (window as unknown as { __stage: unknown }).__stage = stage; // TMPDEBUG
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  const host = document.getElementById('app') ?? document.body;
  const box = document.createElement('div');
  box.className = 'boot-error';
  box.setAttribute('role', 'alert');
  box.style.cssText = 'padding:24px;font-family:system-ui,sans-serif;color:#f3f4f6;background:#3b0d0d;';
  const title = document.createElement('strong');
  title.textContent = 'Hru se nepodařilo spustit.';
  const detail = document.createElement('p');
  detail.textContent = err instanceof Error ? err.message : String(err);
  const hint = document.createElement('p');
  hint.textContent = 'Zkontroluj, že prohlížeč podporuje WebGL, a obnov stránku.';
  box.append(title, detail, hint);
  host.replaceChildren(box);
});
