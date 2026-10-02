import {
  SyncEngine,
  type SyncSettings,
  type SyncStatus,
  type SyncTokens,
} from '@passvaultify/core';
import { openVault } from './session';

/**
 * Sync in the extension. It runs in the background worker, which opens the
 * vault fresh for each run (the popup or settings page may have written in
 * between): on unlock, after local writes, when the popup opens, and every
 * few minutes while unlocked. The worker can't hold a live connection, since
 * Chrome stops it when idle, so there's no event stream here.
 */

const SETTINGS = 'sync:settings';
const STATUS = 'sync:status';
export const SYNC_ALARM = 'sync';
export const SYNC_EVERY_MINUTES = 5;

export async function loadSyncSettings(): Promise<SyncSettings | null> {
  const got = await chrome.storage.local.get(SETTINGS);
  return (got[SETTINGS] as SyncSettings | undefined) ?? null;
}

export async function saveSyncSettings(settings: SyncSettings | null): Promise<void> {
  if (settings) await chrome.storage.local.set({ [SETTINGS]: settings });
  else await chrome.storage.local.remove(SETTINGS);
}

async function loadTokens(): Promise<SyncTokens | null> {
  return (await loadSyncSettings())?.tokens ?? null;
}

/** The last run's outcome, for the popup and settings page. Memory only, like the session. */
export async function loadSyncStatus(): Promise<SyncStatus | null> {
  const got = await chrome.storage.session.get(STATUS);
  return (got[STATUS] as SyncStatus | undefined) ?? null;
}

async function saveSyncStatus(status: SyncStatus | null) {
  if (status) await chrome.storage.session.set({ [STATUS]: status });
  else await chrome.storage.session.remove(STATUS);
}

let running: Promise<SyncStatus | null> | null = null;

/** One pull and push, if this device is connected and unlocked. Concurrent calls share a run. */
export function runSync(): Promise<SyncStatus | null> {
  running ??= (async () => {
    try {
      const settings = await loadSyncSettings();
      const vault = settings ? await openVault() : null;
      if (!settings || !vault) return null;
      const previous = await loadSyncStatus();
      const engine = new SyncEngine({
        vault,
        settings,
        saveSettings: saveSyncSettings,
        loadTokens,
        live: false,
      });
      await engine.syncNow();
      const status = {
        ...engine.status,
        lastSyncedAt: engine.status.lastSyncedAt ?? previous?.lastSyncedAt ?? null,
      };
      await saveSyncStatus(status);
      return status;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Keep syncing every few minutes while connected. */
export async function scheduleSync(): Promise<void> {
  if (await loadSyncSettings()) {
    await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_EVERY_MINUTES });
  } else {
    await chrome.alarms.clear(SYNC_ALARM);
    await saveSyncStatus(null);
  }
}

/** A name for this device in the server's device list. */
export function extensionDeviceName(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /CrOS/.test(ua)
        ? 'ChromeOS'
        : /Linux/.test(ua)
          ? 'Linux'
          : '';
  return os ? `Chrome extension on ${os}` : 'Chrome extension';
}

export function hostOf(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}
