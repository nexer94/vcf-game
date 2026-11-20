import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guard the layering contract: model/engine/scenarios must not import PixiJS or render/ui.
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_DIRS = ['model', 'engine', 'scenarios'];
const FORBIDDEN = [/from\s+['"]pixi\.js['"]/, /from\s+['"][./]*\/(render|ui)(\/|['"])/];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('architecture', () => {
  it('core layers do not depend on PixiJS or render/ui', () => {
    const offenders = CORE_DIRS.flatMap((d) => walk(join(srcDir, d))).filter((f) => {
      const code = readFileSync(f, 'utf8');
      return FORBIDDEN.some((re) => re.test(code));
    });
    expect(offenders).toEqual([]);
  });
});
