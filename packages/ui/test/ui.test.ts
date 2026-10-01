import { describe, expect, it } from 'vitest';
import { charKind, dataChipText, fingerprintArcs, toBits } from '../src';

describe('fingerprintArcs', () => {
  it('reads bits most significant first', () => {
    expect(toBits(new Uint8Array([0b10100000]))).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('draws nothing for an all-zero fingerprint', () => {
    expect(fingerprintArcs(new Uint8Array(16))).toEqual([]);
  });

  it('draws one full circle per ring for an all-ones fingerprint', () => {
    const arcs = fingerprintArcs(new Uint8Array(16).fill(0xff));
    expect(arcs).toHaveLength(4);
    for (const a of arcs) expect(a.end - a.start).toBeCloseTo(Math.PI * 2);
  });

  it('merges consecutive set bits on a ring into one arc', () => {
    // First ring (44 bits): bits 0-2 set, the rest clear.
    const bytes = new Uint8Array(16);
    bytes[0] = 0b11100000;
    const arcs = fingerprintArcs(bytes);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.ring).toBe(0);
  });

  it('is deterministic and rejects the wrong length', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    expect(fingerprintArcs(bytes)).toEqual(fingerprintArcs(bytes.slice()));
    expect(() => fingerprintArcs(new Uint8Array(15))).toThrow();
  });
});

describe('charKind', () => {
  it('classifies characters for coloring', () => {
    expect([...'a1#Z0!'].map(charKind)).toEqual([
      'letter',
      'digit',
      'symbol',
      'letter',
      'digit',
      'symbol',
    ]);
  });
});

describe('dataChipText', () => {
  it('names where the vault lives', () => {
    expect(dataChipText({ mode: 'local' })).toBe('Local only · this device');
    expect(dataChipText({ mode: 'self', where: 'vault.home.arpa' })).toBe(
      'Self-hosted · vault.home.arpa',
    );
    expect(dataChipText({ mode: 'cloud' })).toBe('PassVaultify Cloud · eu-1');
  });
});
