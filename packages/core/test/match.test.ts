import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  importVaultKey,
  matchItem,
  matchingLogins,
  matchUrl,
  MemoryStore,
  normalizeItem,
  unwrapVaultKey,
  Vault,
  type VaultItem,
} from '../src';

describe('matchUrl', () => {
  it('matches the same host, ignoring www, case and path', () => {
    expect(matchUrl('https://github.com', 'https://github.com/login?x=1')).toBe('exact');
    expect(matchUrl('github.com', 'https://WWW.GitHub.com/session')).toBe('exact');
  });

  it('matches subdomains of the saved host, not the other way round', () => {
    expect(matchUrl('https://google.com', 'https://accounts.google.com/signin')).toBe('subdomain');
    expect(matchUrl('https://accounts.google.com', 'https://google.com')).toBeNull();
  });

  it('never matches look-alike domains', () => {
    expect(matchUrl('https://google.com', 'https://g00gle.com')).toBeNull();
    expect(matchUrl('https://google.com', 'https://google.com.evil.io')).toBeNull();
    expect(matchUrl('https://google.com', 'https://evilgoogle.com')).toBeNull();
    expect(matchUrl('https://bank.test', 'https://bank.test.attacker.net/login')).toBeNull();
  });

  it('never fills an http page for a login saved on https', () => {
    expect(matchUrl('https://bank.test', 'http://bank.test/login')).toBeNull();
    expect(matchUrl('http://router.local', 'http://router.local/admin')).toBe('exact');
  });

  it('ignores non-web pages and respects explicit ports', () => {
    expect(matchUrl('https://github.com', 'file:///etc/passwd')).toBeNull();
    expect(matchUrl('https://github.com', 'chrome://settings')).toBeNull();
    expect(matchUrl('https://nas.local:5001', 'https://nas.local:5001/')).toBe('exact');
    expect(matchUrl('https://nas.local:5001', 'https://nas.local:8080/')).toBeNull();
  });

  it('allows only exact matches on hosts whose subdomains belong to other people', () => {
    expect(matchUrl('https://alex.github.io', 'https://alex.github.io/app')).toBe('exact');
    expect(matchUrl('https://github.io', 'https://attacker.github.io')).toBeNull();
    expect(matchUrl('https://myapp.vercel.app', 'https://evil.myapp.vercel.app')).toBeNull();
  });
});

describe('matchingLogins', () => {
  const NOW = '2026-01-01T00:00:00.000Z';
  const login = (id: string, title: string, urls: string[], trashed = false): VaultItem => ({
    id,
    revision: 1,
    updatedAt: NOW,
    data: {
      ...normalizeItem({ type: 'login', title, urls, password: 'pw' }, NOW),
      trashedAt: trashed ? NOW : null,
    },
  });

  it('puts exact matches first and skips notes and trashed items', () => {
    const items = [
      login('a', 'Google (all)', ['https://google.com']),
      login('b', 'Google accounts', ['https://accounts.google.com']),
      login('c', 'Old Google', ['https://accounts.google.com'], true),
      login('d', 'GitHub', ['https://github.com']),
    ];
    const found = matchingLogins(items, 'https://accounts.google.com/signin');
    expect(found.map((m) => [m.item.id, m.kind])).toEqual([
      ['b', 'exact'],
      ['a', 'subdomain'],
    ]);
    expect(
      matchItem(normalizeItem({ type: 'note', title: 'x' }, NOW), 'https://x.test'),
    ).toBeNull();
  });
});

describe('session keys', () => {
  it('unwraps the vault key and reopens the vault with it, no password needed', async () => {
    const store = new MemoryStore();
    const { vault } = await Vault.create(store, 'master pw', { iterations: 1000 });
    await vault.add({ type: 'login', title: 'GitHub', password: 'hunter2' });
    const header = vault.header;

    const bytes = await unwrapVaultKey('master pw', header);
    expect(bytes).toHaveLength(32);
    const reopened = await Vault.open(store, await importVaultKey(bytes, header));
    expect(reopened.list().map((i) => i.data.title)).toEqual(['GitHub']);

    await expect(unwrapVaultKey('wrong', header)).rejects.toThrow(DecryptionError);
    await expect(importVaultKey(new Uint8Array(32), header)).rejects.toThrow(DecryptionError);
  });
});
