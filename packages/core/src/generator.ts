import { randomInt } from './random';
import { EFF_LARGE_WORDLIST } from './wordlist/eff-large';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!#$%&*+-=?@^_~';
/** Characters people confuse when reading a password aloud or retyping it. */
const LOOK_ALIKES = /[Il1O0o|]/g;

export interface Generated {
  value: string;
  /** Entropy of the generation process (not of this particular string). */
  bits: number;
}

export interface RandomOptions {
  length: number;
  digits?: boolean;
  symbols?: boolean;
  avoidLookAlikes?: boolean;
}

/**
 * A random password containing at least one character from each enabled set.
 * Every character is drawn uniformly (see randomInt) from the combined pool.
 */
export function generateRandom({
  length,
  digits = true,
  symbols = true,
  avoidLookAlikes = true,
}: RandomOptions): Generated {
  if (!Number.isInteger(length) || length < 4 || length > 128) {
    throw new RangeError('length must be between 4 and 128');
  }
  let sets = [LOWER, UPPER];
  if (digits) sets.push(DIGITS);
  if (symbols) sets.push(SYMBOLS);
  if (avoidLookAlikes) sets = sets.map((s) => s.replace(LOOK_ALIKES, ''));
  const pool = sets.join('');
  // Rejection sampling over whole passwords keeps every accepted password
  // equally likely; with length >= 4 a retry is rare.
  for (;;) {
    let value = '';
    for (let i = 0; i < length; i++) value += pool[randomInt(pool.length)];
    if (sets.every((s) => [...value].some((ch) => s.includes(ch)))) {
      return { value, bits: length * Math.log2(pool.length) };
    }
  }
}

export interface PassphraseOptions {
  words: number;
  separator?: string;
  /** Capitalize one random word, for sites that demand an uppercase letter. */
  capitalize?: boolean;
  /** Append one random digit, for sites that demand a number. */
  number?: boolean;
}

/** Words from the EFF large wordlist: 12.9 bits each. */
export function generatePassphrase({
  words,
  separator = '-',
  capitalize = false,
  number = false,
}: PassphraseOptions): Generated {
  if (!Number.isInteger(words) || words < 3 || words > 20) {
    throw new RangeError('words must be between 3 and 20');
  }
  const list = EFF_LARGE_WORDLIST;
  const picked = Array.from({ length: words }, () => list[randomInt(list.length)] as string);
  let bits = words * Math.log2(list.length);
  if (capitalize) {
    const i = randomInt(words);
    const w = picked[i] as string;
    picked[i] = w.charAt(0).toUpperCase() + w.slice(1);
    bits += Math.log2(words);
  }
  let value = picked.join(separator);
  if (number) {
    value += separator + DIGITS[randomInt(10)];
    bits += Math.log2(10);
  }
  return { value, bits };
}

export function generatePin(length: number): Generated {
  if (!Number.isInteger(length) || length < 4 || length > 12) {
    throw new RangeError('length must be between 4 and 12');
  }
  let value = '';
  for (let i = 0; i < length; i++) value += DIGITS[randomInt(10)];
  return { value, bits: length * Math.log2(10) };
}

/** An attacker with a fast hash and a GPU rig: the usual worst case for a leaked site database. */
export const FAST_HASH_GUESSES_PER_SECOND = 1e10;

/** Average seconds to guess a secret with `bits` of entropy (half the keyspace). */
export function crackSeconds(
  bits: number,
  guessesPerSecond = FAST_HASH_GUESSES_PER_SECOND,
): number {
  return 2 ** (bits - 1) / guessesPerSecond;
}

const YEAR = 365.25 * 24 * 3600;

/** "3 hours", "2.4 million years", "longer than the sun will shine". */
export function formatDuration(seconds: number): string {
  const plural = (n: number, unit: string) =>
    `${n.toLocaleString('en')} ${unit}${n === 1 ? '' : 's'}`;
  if (seconds < 1) return 'less than a second';
  if (seconds < 60) return plural(Math.round(seconds), 'second');
  if (seconds < 3600) return plural(Math.round(seconds / 60), 'minute');
  if (seconds < 86400) return plural(Math.round(seconds / 3600), 'hour');
  if (seconds < YEAR) return plural(Math.round(seconds / 86400), 'day');
  const years = seconds / YEAR;
  const short = (v: number) =>
    v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v).toLocaleString('en');
  if (years < 1e3) return plural(Math.round(years), 'year');
  if (years < 1e6) return `${short(years / 1e3)} thousand years`;
  if (years < 1e9) return `${short(years / 1e6)} million years`;
  // The sun has roughly 5 billion years left.
  if (years < 5e9) return `${short(years / 1e9)} billion years`;
  return 'longer than the sun will shine';
}

export type StrengthLevel = 'weak' | 'fair' | 'strong' | 'very-strong' | 'excellent';

/** Strength label for a generated secret, from its entropy. */
export function levelForBits(bits: number): StrengthLevel {
  if (bits < 36) return 'weak';
  if (bits < 60) return 'fair';
  if (bits < 80) return 'strong';
  if (bits < 128) return 'very-strong';
  return 'excellent';
}
