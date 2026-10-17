import { describe, expect, it } from 'vitest';
import { Rng, hash32 } from '../../src/core/rng';

describe('deterministic rng', () => {
  it('same seed -> same sequence', () => {
    const a = new Rng(42), b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('hash is stable and input-sensitive', () => {
    expect(hash32(1, 2, 'x')).toBe(hash32(1, 2, 'x'));
    expect(hash32(1, 2, 'x')).not.toBe(hash32(1, 3, 'x'));
    expect(hash32('12')).not.toBe(hash32(12));
  });
  it('weighted never picks zero-weight items', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) expect(r.weighted([0, 1, 0, 2])).not.toBe(0);
  });
});
