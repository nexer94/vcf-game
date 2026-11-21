// Domain model of VCF (types, states, transitions, prerequisite validation).
// Generated from docs/spec/ by domain-modeler. No PixiJS / DOM dependencies.
export * from './validation';
export * from './net';
export * from './architecture';
export * from './bringup';
export * from './design';
export * from './hardware';
// bcgDataset / hardwareCatalog import the BCG JSON from docs/spec/data (outside game/); the Vite dev server allows it
// via `server.fs.allow: ['..']` (vite.config.ts). Importing the barrel therefore loads the dataset (~360 kB JSON).
export * from './bcgDataset';
export * from './hardwareCatalog';
export * from './physical';
export * from './sites';
export * from './hardwareDesign';
