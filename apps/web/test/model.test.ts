import { normalizeItem, Vault, type NewItem, type VaultItem } from '@passvaultify/core';
import { createDemoVault, DEMO_PASSWORD } from '../src/app/demo';
import { matchesFilter, matchesQuery, reuseIndex, subtitle } from '../src/app/model';
import { describe, expect, it } from 'vitest';

const NOW = '2026-01-01T00:00:00.000Z';
const item = (id: string, input: NewItem): VaultItem => ({
  id,
  revision: 1,
  updatedAt: NOW,
  data: normalizeItem(input, NOW),
});

const github = item('a', {
  type: 'login',
  title: 'GitHub',
  username: 'alex-dev',
  password: 'same',
  urls: ['https://github.com/login'],
  tags: ['dev', 'work'],
});
const netflix = item('b', { type: 'login', title: 'Netflix', password: 'same', favorite: true });
const note = item('c', { type: 'note', title: 'Recovery codes', notes: 'secret-code-123' });

describe('search', () => {
  it('matches title, username, host and tags, case-insensitively', () => {
    expect(matchesQuery(github, 'GIT')).toBe(true);
    expect(matchesQuery(github, 'alex')).toBe(true);
    expect(matchesQuery(github, 'github.com')).toBe(true);
    expect(matchesQuery(github, '#work')).toBe(true);
    expect(matchesQuery(github, '')).toBe(true);
  });

  it('requires every word to match', () => {
    expect(matchesQuery(github, 'git dev')).toBe(true);
    expect(matchesQuery(github, 'git netflix')).toBe(false);
  });

  it('never searches passwords or note bodies', () => {
    expect(matchesQuery(github, 'same')).toBe(false);
    expect(matchesQuery(note, 'secret-code')).toBe(false);
  });
});

describe('filters', () => {
  it('filters by favorite, type and tag', () => {
    expect(matchesFilter(netflix, { kind: 'favorites' })).toBe(true);
    expect(matchesFilter(github, { kind: 'favorites' })).toBe(false);
    expect(matchesFilter(note, { kind: 'type', type: 'note' })).toBe(true);
    expect(matchesFilter(github, { kind: 'tag', tag: 'dev' })).toBe(true);
    expect(matchesFilter(netflix, { kind: 'tag', tag: 'dev' })).toBe(false);
  });

  it('never shows note contents in the list', () => {
    expect(subtitle(note)).toBe('Secure note');
    expect(subtitle(github)).toBe('alex-dev');
  });
});

describe('reuse', () => {
  it('groups logins that share a password', () => {
    const index = reuseIndex([github, netflix, note]);
    expect(index.get('same')?.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('demo vault', () => {
  it('has realistic, backdated items and one in Trash', async () => {
    const { vault, store } = await createDemoVault();
    expect(vault.list()).toHaveLength(9);
    expect(vault.trash()).toHaveLength(1);
    const reused = [...reuseIndex(vault.list()).values()].filter((group) => group.length > 1);
    expect(reused).toHaveLength(1);
    const oldest = Math.min(...vault.list().map((i) => Date.parse(i.data.createdAt)));
    expect(Date.now() - oldest).toBeGreaterThan(365 * 86400_000);
    // New writes after setup use the real clock.
    const fresh = await vault.add({ type: 'note', title: 'New' });
    expect(Date.now() - Date.parse(fresh.updatedAt)).toBeLessThan(60_000);
    // And it locks and unlocks like a real vault.
    vault.lock();
    const again = await Vault.unlock(store, DEMO_PASSWORD);
    expect(again.list()).toHaveLength(10);
  });
});
