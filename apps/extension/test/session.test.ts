import { unwrapVaultKey, Vault } from '@passvaultify/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_LOCK_ALARM,
  isUnlocked,
  lock,
  openVault,
  startSession,
  touch,
  unlock,
} from '../src/shared/session';
import { ChromeStore, loadProfile, saveProfile } from '../src/shared/store';
import { fakeChrome, type FakeChrome } from './chrome';

const PASSWORD = 'correct horse battery staple';

describe('extension vault and session', () => {
  let chrome: FakeChrome;
  beforeEach(async () => {
    chrome = fakeChrome();
    const { vault } = await Vault.create(new ChromeStore(), PASSWORD, { iterations: 1000 });
    await vault.add({
      type: 'login',
      title: 'GitHub',
      username: 'sam',
      urls: ['https://github.com'],
    });
  });

  it('stores only the header and encrypted records', () => {
    const stored = JSON.stringify(chrome.storage.local.dump());
    expect(stored).toContain('vault:header');
    expect(stored).not.toContain('GitHub');
  });

  it('unlocks with the master password and opens from the session', async () => {
    expect(await openVault()).toBeNull();
    await expect(unlock('wrong password')).rejects.toThrow();
    expect(await isUnlocked()).toBe(false);

    await unlock(PASSWORD);
    expect(await isUnlocked()).toBe(true);
    const vault = await openVault();
    expect(vault?.list().map((item) => item.data.title)).toEqual(['GitHub']);
    // The key is in session storage (memory), never in local storage.
    const session = Object.values(chrome.storage.session.dump())[0] as { key: string };
    expect(session.key).toMatch(/^[\w-]{43}$/);
    expect(JSON.stringify(chrome.storage.local.dump())).not.toContain(session.key);
  });

  it('schedules auto-lock from the profile and pushes it back on use', async () => {
    await saveProfile({ autoLockMinutes: 5 });
    await unlock(PASSWORD);
    expect(chrome.alarms.create).toHaveBeenLastCalledWith(AUTO_LOCK_ALARM, {
      when: expect.any(Number),
    });
    const calls = chrome.alarms.create.mock.calls.length;
    await touch();
    expect(chrome.alarms.create.mock.calls.length).toBe(calls + 1);
  });

  it('sets no alarm when locking only on browser close', async () => {
    await saveProfile({ autoLockMinutes: 0 });
    await unlock(PASSWORD);
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  it('locks, and treats an overdue session as locked', async () => {
    await unlock(PASSWORD);
    await lock();
    expect(await openVault()).toBeNull();

    await unlock(PASSWORD);
    const [key] = Object.keys(chrome.storage.session.dump());
    const session = chrome.storage.session.dump()[key as string] as { lockAt: number };
    await chrome.storage.session.set({ [key as string]: { ...session, lockAt: Date.now() - 1 } });
    expect(await openVault()).toBeNull();
    expect(await isUnlocked()).toBe(false);
  });

  it('removing the vault keeps the preferences', async () => {
    await saveProfile({ theme: 'graphite' });
    await new ChromeStore().clear();
    expect(await new ChromeStore().loadHeader()).toBeNull();
    expect((await loadProfile()).theme).toBe('graphite');
  });

  it('a session started from the unwrapped key opens the vault', async () => {
    const header = await new ChromeStore().loadHeader();
    if (!header) throw new Error('no header');
    await startSession(await unwrapVaultKey(PASSWORD, header));
    expect((await openVault())?.list()).toHaveLength(1);
  });
});
