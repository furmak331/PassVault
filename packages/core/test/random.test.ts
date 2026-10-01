import { describe, expect, it } from 'vitest';
import { randomId, randomInt } from '../src';

describe('randomInt', () => {
  it('stays in range', () => {
    for (let i = 0; i < 2000; i++) {
      const n = randomInt(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
  });

  it('is roughly uniform (no modulo bias)', () => {
    // 3 doesn't divide 2^32, so a naive `% 3` would skew slightly. With 30,000
    // draws each bucket should land well within 10% of 10,000.
    const counts = [0, 0, 0];
    for (let i = 0; i < 30_000; i++) {
      const bucket = randomInt(3);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(1000);
  });

  it('rejects invalid bounds', () => {
    expect(() => randomInt(0)).toThrow(RangeError);
    expect(() => randomInt(1.5)).toThrow(RangeError);
  });
});

describe('randomId', () => {
  it('returns lowercase UUID v4 strings', () => {
    expect(randomId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
