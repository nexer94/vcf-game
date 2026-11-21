// Generates src/scenarios/sources/sourceRegistry.json from the "Zdroje" sections of docs/spec/*.md (UX ch. 21.2).
// Run: npm run gen:sources   (a test fails when the committed registry is out of date)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistryFromDir } from '../src/scenarios/sources/specSources.ts';

const here = dirname(fileURLToPath(import.meta.url));
const specDir = join(here, '../../docs/spec');
const out = join(here, '../src/scenarios/sources/sourceRegistry.json');
const reg = buildRegistryFromDir(specDir, { readdirSync, readFileSync });
writeFileSync(out, `${JSON.stringify(reg, null, 1)}\n`);
console.log(`source registry: ${reg.sources.length} sources from ${reg.files.length} spec files -> ${out}`);
