import {
  SyncEngine,
  type SyncConflict,
  type SyncSettings,
  type SyncStatus,
  type Vault,
} from '@passvaultify/core';
import { useEffect, useEffectEvent, useMemo, useSyncExternalStore } from 'react';
import type { IdbStore } from './db';
import { relativeTime } from './hooks';

/**
 * Runs a SyncEngine while a synced vault is unlocked. The engine reads its
 * settings from IndexedDB when it starts, since another tab may have moved
 * them on (new tokens, a later revision).
 */
export function useSyncEngine(
  vault: Vault | null,
  connection: SyncSettings | null,
  store: IdbStore,
  onConflicts: (conflicts: SyncConflict[]) => void,
): { engine: SyncEngine | null; status: SyncStatus | null } {
  const notify = useEffectEvent(onConflicts);
  const engine = useMemo(
    () =>
      vault && connection
        ? new SyncEngine({
            vault,
            settings: connection,
            loadSettings: () => store.loadSync(),
            loadTokens: () => store.loadSyncTokens(),
            saveSettings: (settings) => store.saveSync(settings),
          })
        : null,
    [vault, connection, store],
  );
  useEffect(() => {
    if (!engine) return;
    const unsubscribe = engine.onConflicts((conflicts) => notify(conflicts));
    engine.start();
    return () => {
      unsubscribe();
      engine.stop();
    };
  }, [engine]);
  const status = useSyncExternalStore(
    (onChange) => (engine ? engine.subscribe(onChange) : () => undefined),
    () => engine?.status ?? null,
  );
  return { engine, status };
}

/** A name for this device in the server's device list, e.g. "Chrome on Windows". */
export function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

export function hostOf(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

/** Short status for the sidebar chip. */
export function syncLabel(status: SyncStatus | null): string {
  if (!status) return 'Connecting';
  switch (status.state) {
    case 'syncing':
      return 'Syncing';
    case 'offline':
      return status.pending ? `Offline · ${status.pending} waiting` : 'Offline';
    case 'signed-out':
      return 'Sign in to sync';
    case 'error':
      return 'Sync paused';
    case 'idle':
      return status.pending ? `${status.pending} waiting` : 'Synced';
  }
}

/** One sentence for the sync panel. */
export function syncSentence(status: SyncStatus | null): string {
  if (!status) return 'Connecting to your server…';
  switch (status.state) {
    case 'syncing':
      return 'Syncing now…';
    case 'offline':
      return status.pending
        ? `Can't reach the server. ${status.pending} ${status.pending === 1 ? 'change is' : 'changes are'} kept here and will be sent when it's back.`
        : "Can't reach the server. Trying again shortly.";
    case 'signed-out':
      return status.message ?? 'This device was signed out.';
    case 'error':
      return status.message ?? 'Sync stopped.';
    case 'idle':
      return status.lastSyncedAt
        ? `Up to date. Last synced ${relativeTime(status.lastSyncedAt)}.`
        : 'Up to date.';
  }
}
