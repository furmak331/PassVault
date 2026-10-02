import {
  fromBase64Url,
  importVaultKey,
  toBase64Url,
  unwrapVaultKey,
  Vault,
  type VaultHeader,
} from '@passvaultify/core';
import { ChromeStore, loadProfile } from './store';

/**
 * The unlocked session.
 *
 * Chrome stops an extension's service worker when it's idle, which would lose
 * an in-memory key. So the vault key's bytes live in chrome.storage.session:
 * held in memory only, never written to disk, cleared when the browser exits,
 * and readable only by the extension's own pages and worker (not by content
 * scripts or websites). Locking removes them.
 */
const SESSION = 'session';
export const AUTO_LOCK_ALARM = 'auto-lock';

interface Session {
  key: string;
  /** When the session expires, in ms since epoch; 0 for "when the browser closes". */
  lockAt: number;
}

export async function hasVault(): Promise<boolean> {
  return (await new ChromeStore().loadHeader()) !== null;
}

export async function isUnlocked(): Promise<boolean> {
  const got = await chrome.storage.session.get(SESSION);
  return Boolean(got[SESSION]);
}

async function scheduleLock(minutes: number): Promise<number> {
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  if (minutes <= 0) return 0;
  const lockAt = Date.now() + minutes * 60_000;
  await chrome.alarms.create(AUTO_LOCK_ALARM, { when: lockAt });
  return lockAt;
}

/** Derive the key from the master password and start a session. */
export async function unlock(password: string): Promise<void> {
  const header = await new ChromeStore().loadHeader();
  if (!header) throw new Error('There is no vault in this browser yet.');
  await startSession(await unwrapVaultKey(password, header));
}

/** Start a session from key bytes already in hand (just created or restored). */
export async function startSession(keyBytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const { autoLockMinutes } = await loadProfile();
  const session: Session = {
    key: toBase64Url(keyBytes),
    lockAt: await scheduleLock(autoLockMinutes),
  };
  keyBytes.fill(0);
  await chrome.storage.session.set({ [SESSION]: session });
}

/** Activity pushes the auto-lock back, like the web vault's idle timer. */
export async function touch(): Promise<void> {
  const got = await chrome.storage.session.get(SESSION);
  const session = got[SESSION] as Session | undefined;
  if (!session) return;
  const { autoLockMinutes } = await loadProfile();
  await chrome.storage.session.set({
    [SESSION]: { ...session, lockAt: await scheduleLock(autoLockMinutes) },
  });
}

export async function lock(): Promise<void> {
  await chrome.storage.session.remove(SESSION);
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
}

/** Open the vault with the session key, or null when locked. */
export async function openVault(): Promise<Vault | null> {
  const got = await chrome.storage.session.get(SESSION);
  const session = got[SESSION] as Session | undefined;
  if (!session) return null;
  if (session.lockAt && Date.now() >= session.lockAt) {
    await lock();
    return null;
  }
  const store = new ChromeStore();
  const header = await store.loadHeader();
  if (!header) {
    await lock();
    return null;
  }
  return Vault.open(store, await importVaultKey(fromBase64Url(session.key), header));
}

export async function vaultHeader(): Promise<VaultHeader | null> {
  return new ChromeStore().loadHeader();
}
