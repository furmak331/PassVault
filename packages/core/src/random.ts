import type { Bytes } from './encoding';

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * A uniformly random integer in [0, max).
 *
 * Uses rejection sampling: values from the top of the 32-bit range that would
 * make some results more likely than others (modulo bias) are thrown away.
 */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) {
    throw new RangeError('max must be an integer between 1 and 2^32');
  }
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0] as number;
  } while (value >= limit);
  return value % max;
}

export function randomId(): string {
  return crypto.randomUUID();
}
