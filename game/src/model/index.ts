// Domain model of VCF (types, states, transitions, prerequisite validation).
// Generated from docs/spec/ by domain-modeler. No PixiJS / DOM dependencies.
export * from './validation';
export * from './net';
export * from './architecture';
export * from './bringup';
export * from './design';
export * from './hardware';
// bcgDataset / hardwareCatalog import the BCG JSON from docs/spec/data (outside game/). They are not re-exported
// here so that importing the model barrel never loads the dataset; import them directly:
//   import { buildHardwareCatalog } from './model/hardwareCatalog';
// (The Vite dev server needs `server.fs.allow` to include the repository root for that import.)
export type { HardwareCatalog, StarterServer, CatalogItem, SwitchModel, RackModel, StarterConfigDef, StarterStatus } from './hardwareCatalog';
export * from './physical';
export * from './hardwareDesign';
