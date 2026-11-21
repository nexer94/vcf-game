// Hotové scénáře (CLAUDE.md "Herní režimy" 3): fully deployed, read-only environments built from the model's scenario
// presets (40 §6.5) on top of the shared model + engine + Sandbox reducer. Pure TypeScript – no DOM, no PixiJS.
export * from './build';
export * from './view';
export * from './session';
