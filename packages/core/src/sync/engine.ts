import { DecryptionError, unlockVault } from '../crypto';
import type { ItemData } from '../items';
import type { RemoteRecord, Vault } from '../vault';
import {
  SyncClient,
  SyncError,
  type SyncDeviceInput,
  type SyncEvent,
  type SyncTokens,
} from './client';

/**
 * Keeps a Vault in step with a sync server.
 *
 * - Pull: fetch changes since the last revision seen, and store them unless
 *   this device has its own unsent change to the same item.
 * - Push: send every pending record with the server revision it was based on.
 * - Conflicts (both devices changed one item): if the contents match, nothing
 *   to do. Otherwise the server's copy keeps the item and this device's
 *   version is saved next to it as a "(conflict)" copy, so nothing is lost.
 *   An edit beats a deletion.
 *
 * The server only ever sees ciphertext; everything here works on records the
 * Vault encrypted.
 */

export interface SyncSettings {
  server: string;
  email: string;
  deviceName: string;
  /** Pinned when the device connected. A different fingerprint stops sync. */
  serverFingerprint: string;
  /** The vault revision of the last pull. */
  lastRevision: number;
  tokens: SyncTokens | null;
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'signed-out' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** Changes made here that the server doesn't have yet. */
  pending: number;
  lastSyncedAt: string | null;
  /** Why sync stopped, for 'error' and 'signed-out'. */
  message?: string;
}

export interface SyncConflict {
  id: string;
  title: string;
  /** This device's version, saved as a separate item. */
  copyId: string;
}

/** The parts of SyncClient the engine uses, so tests can stand in a fake. */
export type SyncTransport = Pick<
  SyncClient,
  'serverInfo' | 'changes' | 'putItem' | 'listen' | 'signedIn'
>;

export interface SyncEngineOptions {
  vault: Vault;
  settings: SyncSettings;
  saveSettings: (settings: SyncSettings) => void | Promise<void>;
  /** Reads the persisted tokens, which other tabs or contexts may have refreshed. */
  loadTokens?: () => Promise<SyncTokens | null>;
  /** Reads the persisted settings when the engine starts, in case they moved on since. */
  loadSettings?: () => Promise<SyncSettings | null>;
  /** Defaults to a SyncClient for settings.server. */
  transport?: SyncTransport;
  fetch?: typeof fetch;
  onStatus?: (status: SyncStatus) => void;
  onConflicts?: (conflicts: SyncConflict[]) => void;
  /** Hold a live event stream while started. Off in the extension's background. */
  live?: boolean;
}

const MAX_PUSH_ROUNDS = 5;
const PUSH_DEBOUNCE_MS = 400;
const MAX_BACKOFF_MS = 60_000;

export class SyncEngine {
  private readonly vault: Vault;
  private settings: SyncSettings;
  private readonly options: SyncEngineOptions;
  private readonly transport: SyncTransport;
  /** The API client, for account actions (devices, password change). Null with a test transport. */
  readonly client: SyncClient | null;
  private statusValue: SyncStatus;
  private listening = false;
  private readonly subscribers = new Set<(status: SyncStatus) => void>();
  private readonly conflictListeners = new Set<(conflicts: SyncConflict[]) => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private verified = false;
  private started = false;
  private stream: AbortController | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 2_000;
  private unsubscribe: (() => void) | null = null;
  private readonly online = () => void this.syncNow();

  constructor(options: SyncEngineOptions) {
    this.options = options;
    this.vault = options.vault;
    this.settings = { ...options.settings };
    this.client = options.transport
      ? null
      : new SyncClient({
          server: options.settings.server,
          tokens: options.settings.tokens,
          ...(options.fetch ? { fetch: options.fetch } : {}),
          ...(options.loadTokens ? { readTokens: options.loadTokens } : {}),
          onTokens: (tokens) => this.save({ tokens }),
        });
    this.transport = options.transport ?? (this.client as SyncClient);
    this.statusValue = {
      state: options.settings.tokens || options.transport ? 'idle' : 'signed-out',
      pending: this.vault.pendingChanges().length,
      lastSyncedAt: null,
    };
  }

  get status(): SyncStatus {
    return this.statusValue;
  }

  get server(): string {
    return this.settings.server;
  }

  get email(): string {
    return this.settings.email;
  }

  /**
   * Sign this device in again after it was signed out. If the master password
   * was changed on another device, the account's new header replaces the one
   * here, so the vault then opens with the new password.
   */
  async signIn(password: string, device: SyncDeviceInput): Promise<void> {
    if (!this.client) throw new Error('No client');
    const header = await this.client.login(this.settings.email, password, device);
    if (header.fingerprint !== this.vault.header.fingerprint) {
      await this.client.logout();
      throw new Error('This account now holds a different vault.');
    }
    if (header.wrappedVaultKey !== this.vault.header.wrappedVaultKey) {
      await unlockVault(password, header);
      await this.vault.adoptHeader(header);
    }
    this.publish({ state: 'idle', pending: 0, lastSyncedAt: this.statusValue.lastSyncedAt });
    if (this.started && this.options.live !== false) void this.listenLoop();
    await this.syncNow();
  }

  /** Status updates. Returns an unsubscribe function. */
  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /** Told when a sync kept two versions of items. Returns an unsubscribe function. */
  onConflicts(listener: (conflicts: SyncConflict[]) => void): () => void {
    this.conflictListeners.add(listener);
    return () => this.conflictListeners.delete(listener);
  }

  /** Sync now, then keep syncing: after local writes, on server events, and when back online. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.vault.onChange((change) => {
      this.setStatus({ pending: this.vault.pendingChanges().length });
      if (change.source === 'local') this.schedulePush();
    });
    globalThis.addEventListener?.('online', this.online);
    void this.reload().then(() => {
      if (!this.started) return;
      void this.syncNow();
      if (this.options.live !== false) void this.listenLoop();
    });
  }

  private async reload() {
    const fresh = await this.options.loadSettings?.();
    if (!fresh) return;
    this.settings = { ...fresh };
    this.client?.useTokens(fresh.tokens);
  }

  stop(): void {
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    globalThis.removeEventListener?.('online', this.online);
    this.stream?.abort();
    this.stream = null;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.pushTimer) clearTimeout(this.pushTimer);
  }

  /** One full pull and push. Calls made while one is running fold into a single follow-up run. */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.runOnce();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async runOnce() {
    if (this.statusValue.state === 'signed-out' || this.statusValue.state === 'error') {
      if (!this.transport.signedIn) return;
    }
    this.setStatus({ state: 'syncing' });
    try {
      if (!this.verified) {
        const info = await this.transport.serverInfo();
        if (info.fingerprint !== this.settings.serverFingerprint) {
          this.setStatus({
            state: 'error',
            message: `The server's fingerprint changed to ${info.fingerprint}. Sync is paused until you check it.`,
          });
          return;
        }
        this.verified = true;
      }
      const conflicts: SyncConflict[] = [];
      await this.pull(conflicts);
      // Catch up past our own writes, and anything that landed while pushing.
      if (await this.push(conflicts)) await this.pull(conflicts);
      if (conflicts.length) {
        this.options.onConflicts?.(conflicts);
        for (const listener of this.conflictListeners) listener(conflicts);
      }
      this.retryDelay = 2_000;
      this.publish({
        state: 'idle',
        lastSyncedAt: new Date().toISOString(),
        pending: this.vault.pendingChanges().length,
      });
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown) {
    if (error instanceof SyncError && error.signedOut) {
      this.setStatus({ state: 'signed-out', message: error.message });
    } else if (error instanceof SyncError && error.status < 500 && error.status !== 429) {
      this.setStatus({ state: 'error', message: error.message });
    } else {
      // Network down, server restarting or rate-limited: try again later.
      this.setStatus({ state: 'offline', message: errorMessage(error) });
      this.retryLater();
    }
  }

  private retryLater() {
    if (!this.started) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_BACKOFF_MS);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void this.syncNow();
    }, delay);
    this.timers.add(timer);
  }

  private schedulePush() {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.syncNow();
    }, PUSH_DEBOUNCE_MS);
  }

  private async pull(conflicts: SyncConflict[]) {
    const since = this.settings.lastRevision;
    const changes = await this.transport.changes(since > 0 ? since : undefined);
    if (changes.revision < since) {
      // The server went back in time (restored from an older backup): send it everything again.
      await this.vault.resetSync();
    }
    for (const remote of changes.items) await this.merge(remote, conflicts);
    await this.save({ lastRevision: changes.revision });
  }

  /** Sends pending records. Returns how many the server took. */
  private async push(conflicts: SyncConflict[]): Promise<number> {
    let written = 0;
    for (let round = 0; round < MAX_PUSH_ROUNDS; round++) {
      const pending = this.vault.pendingChanges();
      if (pending.length === 0) break;
      for (const record of pending) {
        const result = await this.transport.putItem(record.id, {
          expectedRevision: record.base ?? 0,
          deleted: record.deleted,
          ...(!record.deleted && record.data ? { data: record.data } : {}),
        });
        if (result.ok) {
          await this.vault.markPushed(record.id, record.revision, result.item.revision);
          written++;
        } else {
          await this.resolve(result.current, conflicts);
        }
      }
    }
    return written;
  }

  /** A record from the server. */
  private async merge(remote: RemoteRecord, conflicts: SyncConflict[]) {
    const local = this.vault.syncInfo(remote.id);
    if (local?.pending) {
      if (remote.revision > local.base) await this.resolve(remote, conflicts);
      return;
    }
    if (local && remote.revision <= local.base) return;
    await this.acceptOrSkip(remote);
  }

  /** Both this device and the server changed the item since this device last synced it. */
  private async resolve(remote: RemoteRecord, conflicts: SyncConflict[]) {
    const mine = this.vault.get(remote.id);
    if (remote.deleted) {
      // Deleted there. If it was edited here, the edit wins and brings it back.
      if (mine) await this.vault.rebase(remote.id, remote.revision);
      else await this.acceptOrSkip(remote);
      return;
    }
    const theirs = await this.openOrSkip(remote);
    if (theirs === undefined) return;
    if (!mine || !theirs || sameItem(mine.data, theirs)) {
      await this.vault.acceptRemote(remote);
      return;
    }
    await this.vault.acceptRemote(remote);
    const copy = await this.vault.importItem({
      ...mine.data,
      title: `${mine.data.title} (conflict)`,
      tags: [...mine.data.tags, 'conflict'],
    });
    conflicts.push({ id: remote.id, title: theirs.title, copyId: copy.id });
  }

  private async openOrSkip(remote: RemoteRecord): Promise<ItemData | null | undefined> {
    try {
      return await this.vault.openRemote(remote);
    } catch (error) {
      if (error instanceof DecryptionError) return undefined;
      throw error;
    }
  }

  /** Store a server record, unless it doesn't decrypt: then keep the local copy and carry on. */
  private async acceptOrSkip(remote: RemoteRecord) {
    try {
      await this.vault.acceptRemote(remote);
    } catch (error) {
      if (!(error instanceof DecryptionError)) throw error;
    }
  }

  private async listenLoop() {
    if (this.listening) return;
    this.listening = true;
    try {
      await this.listenUntilStopped();
    } finally {
      this.listening = false;
    }
  }

  private async listenUntilStopped() {
    let delay = 1_000;
    while (this.started) {
      const controller = new AbortController();
      this.stream = controller;
      try {
        await this.transport.listen((event) => this.onEvent(event), controller.signal);
        delay = 1_000;
      } catch (error) {
        if (!this.started || controller.signal.aborted) return;
        if (error instanceof SyncError && error.signedOut) {
          this.setStatus({ state: 'signed-out', message: error.message });
          return;
        }
      }
      if (!this.transport.signedIn) {
        this.setStatus({ state: 'signed-out', message: 'This device was signed out.' });
        return;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          resolve();
        }, delay);
        this.timers.add(timer);
      });
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
    }
  }

  private onEvent(event: SyncEvent) {
    if (event.type === 'session-ended') {
      this.setStatus({ state: 'signed-out', message: 'This device was signed out.' });
    } else if (event.revision !== this.settings.lastRevision) {
      void this.syncNow();
    }
  }

  private async save(patch: Partial<SyncSettings>) {
    this.settings = { ...this.settings, ...patch };
    await this.options.saveSettings(this.settings);
  }

  private setStatus(patch: Partial<SyncStatus>) {
    this.publish({ ...this.statusValue, ...patch });
  }

  private publish(status: SyncStatus) {
    this.statusValue = { ...status, pending: this.vault.pendingChanges().length };
    this.options.onStatus?.(this.statusValue);
    for (const listener of this.subscribers) listener(this.statusValue);
  }
}

function sameItem(a: ItemData, b: ItemData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function errorMessage(error: unknown): string {
  if (error instanceof SyncError) return error.message;
  return "Can't reach the sync server. Changes are kept here and sent when it's back.";
}
