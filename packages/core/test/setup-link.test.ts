import { describe, expect, it } from 'vitest';
import {
  buildSetupLink,
  checkServer,
  normalizeServerUrl,
  parseSetupLink,
  sameFingerprint,
} from '../src';

const APP = 'https://example.github.io/PassVault/';

/** A stand-in server that answers /v1/server with the given fingerprint. */
const serverWith =
  (fingerprint: string): typeof fetch =>
  async () =>
    new Response(JSON.stringify({ version: '0.1.0', fingerprint, registration: 'closed' }), {
      headers: { 'content-type': 'application/json' },
    });

describe('server addresses', () => {
  it('accepts a host name, with or without https and a trailing slash', () => {
    expect(normalizeServerUrl('vault.example.com')).toBe('https://vault.example.com');
    expect(normalizeServerUrl(' https://vault.example.com/ ')).toBe('https://vault.example.com');
    expect(normalizeServerUrl('http://localhost:8080')).toBe('http://localhost:8080');
  });

  it('says so when an email is typed instead', () => {
    expect(() => normalizeServerUrl('sam@example.com')).toThrow(/email address/);
  });

  it('turns away things that are not addresses', () => {
    expect(() => normalizeServerUrl('not a server')).toThrow(/isn't a server address/);
    expect(() => normalizeServerUrl('vault')).toThrow(/isn't a server address/);
    expect(() => normalizeServerUrl('https://user@vault.example.com')).toThrow();
    expect(() => normalizeServerUrl('http://vault.example.com')).toThrow(/https/);
  });
});

describe('setup links', () => {
  it('round-trips a server and its fingerprint', () => {
    const link = buildSetupLink(APP, 'https://vault.tail1234.ts.net', '6F36 9FA5 35F6');
    expect(link).toBe(`${APP}#connect=vault.tail1234.ts.net&fp=6F369FA535F6`);
    expect(parseSetupLink(link)).toEqual({
      server: 'https://vault.tail1234.ts.net',
      fingerprint: '6F36 9FA5 35F6',
    });
  });

  it('keeps the full address of a local or sub-path server', () => {
    const local = buildSetupLink(APP, 'http://localhost:8080', 'ABCD EF01 2345');
    expect(parseSetupLink(local)?.server).toBe('http://localhost:8080');
    const sub = buildSetupLink(APP, 'https://example.com/vault', 'ABCD EF01 2345');
    expect(parseSetupLink(sub)?.server).toBe('https://example.com/vault');
  });

  it('replaces any fragment already on the app address', () => {
    expect(buildSetupLink(`${APP}#old`, 'https://v.example.com', 'ABCDEF012345')).toBe(
      `${APP}#connect=v.example.com&fp=ABCDEF012345`,
    );
  });

  it('finds the link in a pasted fragment, and nothing in other text', () => {
    expect(parseSetupLink('connect=v.example.com&fp=abcd-ef01-2345')?.fingerprint).toBe(
      'ABCD EF01 2345',
    );
    expect(parseSetupLink('vault.example.com')).toBeNull();
    expect(parseSetupLink(`${APP}#connect=v.example.com`)).toBeNull();
    expect(parseSetupLink(`${APP}#connect=v.example.com&fp=nothex`)).toBeNull();
    expect(parseSetupLink(`${APP}#connect=sam@example.com&fp=ABCDEF012345`)).toBeNull();
    expect(parseSetupLink(`${APP}#connect=http://v.example.com&fp=ABCDEF012345`)).toBeNull();
  });

  it('compares fingerprints however they are written', () => {
    expect(sameFingerprint('6f36 9fa5 35f6', '6F369FA535F6')).toBe(true);
    expect(sameFingerprint('6F36 9FA5 35F6', '6F36 9FA5 35F7')).toBe(false);
  });
});

describe('checking a server', () => {
  it('reports an address as unverified', async () => {
    const result = await checkServer('vault.example.com', serverWith('6F36 9FA5 35F6'));
    expect(result).toMatchObject({ server: 'https://vault.example.com', verified: false });
  });

  it('verifies the fingerprint a setup link carries', async () => {
    const link = buildSetupLink(APP, 'https://vault.example.com', '6F36 9FA5 35F6');
    const result = await checkServer(link, serverWith('6F36 9FA5 35F6'));
    expect(result.verified).toBe(true);
    expect(result.info.fingerprint).toBe('6F36 9FA5 35F6');
  });

  it('refuses a server whose fingerprint differs from the link', async () => {
    const link = buildSetupLink(APP, 'https://vault.example.com', '6F36 9FA5 35F6');
    await expect(checkServer(link, serverWith('0000 0000 0000'))).rejects.toThrow(
      /different fingerprint/,
    );
  });
});
