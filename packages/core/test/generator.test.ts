import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EFF_LARGE_WORDLIST,
  EFF_LARGE_WORDLIST_SHA256,
  crackSeconds,
  estimateMasterPassword,
  formatDuration,
  generatePassphrase,
  generatePin,
  generateRandom,
  levelForBits,
} from '../src';

describe('EFF wordlist', () => {
  it('is the complete, unmodified list', () => {
    expect(EFF_LARGE_WORDLIST).toHaveLength(7776);
    expect(new Set(EFF_LARGE_WORDLIST).size).toBe(7776);
    expect(EFF_LARGE_WORDLIST[0]).toBe('abacus');
    expect(EFF_LARGE_WORDLIST[7775]).toBe('zoom');
    const sha = createHash('sha256').update(EFF_LARGE_WORDLIST.join('\n')).digest('hex');
    expect(sha).toBe(EFF_LARGE_WORDLIST_SHA256);
  });
});

describe('generateRandom', () => {
  it('honors length and includes every enabled character set', () => {
    for (let i = 0; i < 200; i++) {
      const { value } = generateRandom({ length: 12 });
      expect(value).toHaveLength(12);
      expect(value).toMatch(/[a-z]/);
      expect(value).toMatch(/[A-Z]/);
      expect(value).toMatch(/[0-9]/);
      expect(value).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it('avoids look-alike characters by default', () => {
    const all = Array.from({ length: 200 }, () => generateRandom({ length: 32 }).value).join('');
    expect(all).not.toMatch(/[Il1O0o|]/);
  });

  it('can be letters only', () => {
    const { value, bits } = generateRandom({
      length: 20,
      digits: false,
      symbols: false,
      avoidLookAlikes: false,
    });
    expect(value).toMatch(/^[A-Za-z]{20}$/);
    expect(bits).toBeCloseTo(20 * Math.log2(52));
  });

  it('rejects silly lengths', () => {
    expect(() => generateRandom({ length: 3 })).toThrow(RangeError);
    expect(() => generateRandom({ length: 129 })).toThrow(RangeError);
  });
});

describe('generatePassphrase', () => {
  it('uses words from the list', () => {
    const { value, bits } = generatePassphrase({ words: 5 });
    const words = value.split('-');
    expect(words).toHaveLength(5);
    for (const w of words) expect(EFF_LARGE_WORDLIST).toContain(w);
    expect(bits).toBeCloseTo(5 * Math.log2(7776));
  });

  it('can capitalize a word and add a number', () => {
    const { value } = generatePassphrase({
      words: 4,
      separator: '.',
      capitalize: true,
      number: true,
    });
    expect(value).toMatch(/^([A-Za-z-]+\.){4}\d$/);
    expect(value).toMatch(/[A-Z]/);
  });
});

describe('generatePin', () => {
  it('produces digits only', () => {
    expect(generatePin(6).value).toMatch(/^\d{6}$/);
    expect(() => generatePin(3)).toThrow(RangeError);
  });
});

describe('crack time', () => {
  it('formats durations from seconds to the heat death of the sun', () => {
    expect(formatDuration(0.2)).toBe('less than a second');
    expect(formatDuration(90)).toBe('2 minutes');
    expect(formatDuration(3 * 3600)).toBe('3 hours');
    expect(formatDuration(365.25 * 86400 * 2.4e6)).toBe('2.4 million years');
    expect(formatDuration(crackSeconds(128))).toBe('longer than the sun will shine');
  });

  it('labels entropy levels', () => {
    expect(levelForBits(20)).toBe('weak');
    expect(levelForBits(70)).toBe('strong');
    expect(levelForBits(130)).toBe('excellent');
  });
});

describe('estimateMasterPassword', () => {
  it('rejects common and personal passwords', async () => {
    expect((await estimateMasterPassword('password123')).acceptable).toBe(false);
    expect((await estimateMasterPassword('Furqan2026!', ['Furqan'])).acceptable).toBe(false);
  });

  it('accepts a long passphrase', async () => {
    const strength = await estimateMasterPassword('correct-horse-battery-staple-orbit');
    expect(strength.acceptable).toBe(true);
    expect(strength.score).toBe(4);
    expect(strength.crackSeconds).toBeGreaterThan(365.25 * 86400 * 1000);
  });
});
