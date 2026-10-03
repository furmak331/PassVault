import { Vault } from '@passvaultify/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { loginsFor, saveIntent, siteHost } from '../src/shared/logins';
import { ChromeStore } from '../src/shared/store';
import { fakeChrome } from './chrome';

describe('what a submitted login means', () => {
  let vault: Vault;
  beforeEach(async () => {
    fakeChrome();
    ({ vault } = await Vault.create(new ChromeStore(), 'correct horse battery staple', {
      iterations: 1000,
    }));
    await vault.add({
      type: 'login',
      title: 'GitHub',
      username: 'Sam@example.com',
      password: 'old-password',
      urls: ['https://github.com'],
    });
  });

  it('asks nothing when the login is already saved exactly', () => {
    expect(
      saveIntent(vault, 'https://github.com/login', 'sam@example.com', 'old-password'),
    ).toEqual({ kind: 'same' });
  });

  it('updates the login with the same username when the password changed', () => {
    const intent = saveIntent(vault, 'https://github.com/session', 'sam@example.com', 'new');
    expect(intent.kind).toBe('update');
    expect(intent.kind === 'update' && intent.item.data.title).toBe('GitHub');
  });

  it("updates the site's only login when the form had no username", () => {
    expect(saveIntent(vault, 'https://github.com/', '', 'new').kind).toBe('update');
  });

  it('saves a new login for another username or another site', async () => {
    expect(saveIntent(vault, 'https://github.com/', 'alex', 'pw').kind).toBe('new');
    expect(saveIntent(vault, 'https://gitlab.com/', 'sam@example.com', 'pw').kind).toBe('new');
    // A look-alike address is another site.
    expect(
      saveIntent(vault, 'https://github.com.evil.example/', 'sam@example.com', 'pw').kind,
    ).toBe('new');
    // With two logins for the site, a missing username can't pick one.
    await vault.add({
      type: 'login',
      title: 'GitHub (work)',
      username: 'work',
      password: 'x',
      urls: ['https://github.com'],
    });
    expect(saveIntent(vault, 'https://github.com/', '', 'pw').kind).toBe('new');
  });

  it('ignores logins in the trash', async () => {
    const [item] = vault.list();
    if (item) await vault.moveToTrash(item.id);
    expect(saveIntent(vault, 'https://github.com/', 'sam@example.com', 'old-password').kind).toBe(
      'new',
    );
    expect(loginsFor(vault, 'https://github.com/')).toHaveLength(0);
  });

  it('lists the logins for a page and names its site', () => {
    expect(loginsFor(vault, 'https://github.com/login').map((i) => i.data.title)).toEqual([
      'GitHub',
    ]);
    expect(loginsFor(vault, 'http://github.com/login')).toHaveLength(0);
    expect(siteHost('https://www.github.com/login')).toBe('github.com');
    expect(siteHost('not a url')).toBe('');
  });
});
