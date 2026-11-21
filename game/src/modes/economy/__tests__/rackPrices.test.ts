import { describe, expect, it } from 'vitest';
import { buildHardwareCatalog } from '../../../model/hardwareCatalog';
import { DEFAULT_PRICE_TABLE, itemPrice } from '../prices';

describe('rack prices (game currency)', () => {
  const cat = buildHardwareCatalog();
  it('three sizes have distinct game prices growing with height', () => {
    const p = ['rack-generic-24u', 'rack-generic-42u', 'rack-generic-48u'].map((id) => itemPrice(cat, id));
    expect(p.every((x) => typeof x === 'number' && x > 0)).toBe(true);
    expect(p[0]! < p[1]! && p[1]! < p[2]!).toBe(true);
    expect(itemPrice(cat, 'rack-generic-42u')).toBe(DEFAULT_PRICE_TABLE.rackById['rack-generic-42u']);
  });
});
