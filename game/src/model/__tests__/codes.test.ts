import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VALIDATION_CODES, isValidationCode } from '../codes';

const modelDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sources = readdirSync(modelDir)
  .filter((n) => n.endsWith('.ts') && n !== 'codes.ts')
  .map((n) => ({ file: n, src: readFileSync(join(modelDir, n), 'utf8') }));

/** Codes passed as literals to `issue('…')` or to a local `fail('…')` helper. */
const emitted = new Set<string>();
for (const { src } of sources)
  for (const m of src.matchAll(/\b(?:issue|fail)\(\s*'([A-Z0-9_]+)'/g)) if (m[1] !== undefined) emitted.add(m[1]);

describe('validation code registry', () => {
  it('has no duplicates', () => {
    expect(new Set(VALIDATION_CODES).size).toBe(VALIDATION_CODES.length);
  });

  it('every emitted code is registered', () => {
    expect(emitted.size).toBeGreaterThan(50);
    expect([...emitted].filter((c) => !isValidationCode(c))).toEqual([]);
  });

  it('every registered code is emitted somewhere in the model', () => {
    expect(VALIDATION_CODES.filter((c) => !emitted.has(c))).toEqual([]);
  });

  it('no emitter passes a code through a non-literal except the typed password helper', () => {
    // issue(code, …) with a variable is allowed only inside validateInstallerPassword's `fail`
    // helper, whose parameter is typed ValidationCode.
    const dynamic = sources.flatMap(({ file, src }) =>
      [...src.matchAll(/\bissue\(\s*([a-z][A-Za-z0-9_]*)\s*,/g)].map((m) => `${file}:${m[1] ?? ''}`),
    );
    expect(dynamic).toEqual(['bringup.ts:code']);
  });
});
