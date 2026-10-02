import {
  changePassword,
  createVault,
  type UnlockedVault,
  decryptItem,
  encryptItem,
  unlockVault,
  type CreateVaultOptions,
  type Fingerprint,
  type VaultHeader,
} from './crypto';
import {
  applyPatch,
  normalizeItem,
  sanitizeItem,
  type ItemData,
  type ItemPatch,
  type NewItem,
} from './items';
import { randomId } from './random';
import type { ItemRecord, VaultStore } from './store';

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface VaultItem {
  id: string;
  revision: number;
  updatedAt: string;
  data: ItemData;
}

/** What changed, and whether it was this device or a sync from another one. */
export interface VaultChange {
  source: 'local' | 'remote';
  ids: string[];
}

/** An item as the sync server holds it (spec/openapi.yaml ItemRecord). */
export interface RemoteRecord {
  id: string;
  revision: number;
  updatedAt: string;
  deleted: boolean;
  data?: string;
}

export interface VaultOptions {
  /** Clock override for tests. */
  now?: () => Date;
}

export class VaultLockedError extends Error {
  constructor() {
    super('The vault is locked');
    this.name = 'VaultLockedError';
  }
}

/**
 * An unlocked vault: the decrypted items in memory, and every write encrypted
 * before it reaches the store.
 */
export class Vault {
  private key: CryptoKey | null;
  private readonly items = new Map<string, VaultItem>();
  /** Every stored record, ciphertext included: what sync pushes. */
  private readonly records = new Map<string, ItemRecord>();
  private readonly listeners = new Set<(change: VaultChange) => void>();
  private readonly now: () => Date;

  private constructor(
    private readonly store: VaultStore,
    private headerValue: VaultHeader,
    key: CryptoKey,
    options: VaultOptions,
  ) {
    this.key = key;
    this.now = options.now ?? (() => new Date());
  }

  /** Create a new vault in an empty store. */
  static async create(
    store: VaultStore,
    password: string,
    options: VaultOptions & CreateVaultOptions = {},
  ): Promise<{ vault: Vault; fingerprint: Fingerprint }> {
    if (await store.loadHeader()) throw new Error('A vault already exists in this store');
    // Without a header nothing here is readable; clear leftovers (an interrupted restore).
    await store.clear();
    const created = await createVault(password, options);
    await store.saveHeader(created.header);
    return {
      vault: new Vault(store, created.header, created.vaultKey, options),
      fingerprint: created.fingerprint,
    };
  }

  /**
   * Unlock and decrypt every item. Throws DecryptionError on a wrong password.
   * Items that have been in Trash longer than the retention period are purged.
   */
  static async unlock(
    store: VaultStore,
    password: string,
    options: VaultOptions = {},
  ): Promise<Vault> {
    const header = await store.loadHeader();
    if (!header) throw new Error('No vault in this store');
    const { vaultKey } = await unlockVault(password, header);
    return Vault.load(store, header, vaultKey, options);
  }

  /**
   * Open a vault with a key already in hand (see unwrapVaultKey), for clients
   * that resume a session without asking for the password again.
   */
  static async open(
    store: VaultStore,
    vaultKey: CryptoKey,
    options: VaultOptions = {},
  ): Promise<Vault> {
    const header = await store.loadHeader();
    if (!header) throw new Error('No vault in this store');
    return Vault.load(store, header, vaultKey, options);
  }

  private static async load(
    store: VaultStore,
    header: VaultHeader,
    vaultKey: CryptoKey,
    options: VaultOptions,
  ): Promise<Vault> {
    const vault = new Vault(store, header, vaultKey, options);
    for (const record of await store.loadRecords()) {
      vault.records.set(record.id, record);
      if (record.deleted || !record.data) continue;
      const data = await decryptItem<ItemData>(vaultKey, record.id, record.data);
      vault.items.set(record.id, {
        id: record.id,
        revision: record.revision,
        updatedAt: record.updatedAt,
        data,
      });
    }
    await vault.purgeExpiredTrash();
    return vault;
  }

  get header(): VaultHeader {
    return this.headerValue;
  }

  get locked(): boolean {
    return this.key === null;
  }

  /** Forget the key and every decrypted item. */
  lock(): void {
    this.key = null;
    this.items.clear();
  }

  /** Items not in Trash, most recently updated first. */
  list(): VaultItem[] {
    return this.all().filter((i) => i.data.trashedAt === null);
  }

  /** Items in Trash, most recently trashed first. */
  trash(): VaultItem[] {
    return this.all()
      .filter((i) => i.data.trashedAt !== null)
      .sort((a, b) => (b.data.trashedAt ?? '').localeCompare(a.data.trashedAt ?? ''));
  }

  get(id: string): VaultItem | undefined {
    this.assertUnlocked();
    return this.items.get(id);
  }

  async add(input: NewItem): Promise<VaultItem> {
    return this.write(randomId(), normalizeItem(input, this.timestamp()));
  }

  /**
   * Add an item that came from outside this vault (a backup), keeping its
   * creation date, favorite and password history, under a fresh ID. Unknown or
   * malformed fields are dropped.
   */
  async importItem(data: unknown): Promise<VaultItem> {
    const item = sanitizeItem(data, this.timestamp());
    if (!item) throw new Error('Not a vault item');
    return this.write(randomId(), item);
  }

  async update(id: string, patch: ItemPatch): Promise<VaultItem> {
    const item = this.require(id);
    return this.write(id, applyPatch(item.data, patch, this.timestamp()));
  }

  /** Move to Trash. Reversible with restore() for 30 days. */
  async moveToTrash(id: string): Promise<VaultItem> {
    const item = this.require(id);
    return this.write(id, { ...item.data, trashedAt: this.timestamp() });
  }

  async restore(id: string): Promise<VaultItem> {
    const item = this.require(id);
    return this.write(id, { ...item.data, trashedAt: null });
  }

  /** Delete permanently. Leaves a tombstone so other devices learn about it. */
  async purge(id: string): Promise<void> {
    this.require(id);
    const previous = this.records.get(id);
    await this.saveRecord({
      id,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: this.timestamp(),
      deleted: true,
      base: previous?.base ?? 0,
      pending: true,
    });
    this.items.delete(id);
    this.emit('local', [id]);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    this.assertUnlocked();
    await this.applyPasswordChange(
      await changePassword(currentPassword, newPassword, this.headerValue),
    );
  }

  /**
   * Store a header re-wrapped by core's changePassword. Synced vaults compute
   * the change first, send it to the server, then apply it here.
   */
  async applyPasswordChange(changed: UnlockedVault): Promise<void> {
    this.assertUnlocked();
    if (changed.header.fingerprint !== this.headerValue.fingerprint) {
      throw new Error('That header belongs to a different vault');
    }
    await this.store.saveHeader(changed.header);
    this.headerValue = changed.header;
    this.key = changed.vaultKey;
  }

  /** Take a header from the sync server after the password was changed on another device. */
  async adoptHeader(header: VaultHeader): Promise<void> {
    if (header.fingerprint !== this.headerValue.fingerprint) {
      throw new Error('That header belongs to a different vault');
    }
    await this.store.saveHeader(header);
    this.headerValue = header;
  }

  // ---------- Sync ----------

  /** Called after every write, local or from sync. Returns an unsubscribe function. */
  onChange(listener: (change: VaultChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Records changed here that the server hasn't accepted yet. */
  pendingChanges(): ItemRecord[] {
    return [...this.records.values()].filter((r) => r.pending).map((r) => ({ ...r }));
  }

  /** Where an item stands with the server, or undefined if this device has never seen it. */
  syncInfo(id: string): { base: number; pending: boolean; deleted: boolean } | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    return { base: record.base ?? 0, pending: record.pending ?? false, deleted: record.deleted };
  }

  /** Decrypt an item from the server without storing it. Throws DecryptionError if it was tampered with. */
  async openRemote(remote: RemoteRecord): Promise<ItemData | null> {
    const key = this.assertUnlocked();
    if (remote.deleted || !remote.data) return null;
    return decryptItem<ItemData>(key, remote.id, remote.data);
  }

  /** Store the server's copy of an item, replacing this device's. */
  async acceptRemote(remote: RemoteRecord): Promise<void> {
    const data = await this.openRemote(remote);
    const previous = this.records.get(remote.id);
    const revision = (previous?.revision ?? 0) + 1;
    await this.saveRecord({
      id: remote.id,
      revision,
      updatedAt: remote.updatedAt,
      deleted: remote.deleted,
      ...(data && remote.data ? { data: remote.data } : {}),
      base: remote.revision,
      pending: false,
    });
    if (data)
      this.items.set(remote.id, { id: remote.id, revision, updatedAt: remote.updatedAt, data });
    else this.items.delete(remote.id);
    this.emit('remote', [remote.id]);
  }

  /**
   * The server accepted a push. If the item changed again while the push was
   * in flight, it stays pending, now based on the server's new revision.
   */
  async markPushed(id: string, pushedRevision: number, serverRevision: number): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    const unchanged = record.revision === pushedRevision;
    await this.saveRecord({ ...record, base: serverRevision, pending: !unchanged });
  }

  /** Keep this device's change, but base it on the server's newer revision so the push succeeds. */
  async rebase(id: string, serverRevision: number): Promise<void> {
    const record = this.records.get(id);
    if (record) await this.saveRecord({ ...record, base: serverRevision, pending: true });
  }

  /** Mark everything as never synced: for uploading to a new account, or a server that lost data. */
  async resetSync(): Promise<void> {
    for (const record of [...this.records.values()]) {
      await this.saveRecord({ ...record, base: 0, pending: true });
    }
  }

  /** All distinct tags on items not in Trash, alphabetically. */
  tags(): string[] {
    return [...new Set(this.list().flatMap((i) => i.data.tags))].sort();
  }

  private all(): VaultItem[] {
    this.assertUnlocked();
    return [...this.items.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async write(id: string, data: ItemData): Promise<VaultItem> {
    const key = this.assertUnlocked();
    const previous = this.records.get(id);
    const revision = (previous?.revision ?? 0) + 1;
    const updatedAt = this.timestamp();
    await this.saveRecord({
      id,
      revision,
      updatedAt,
      deleted: false,
      data: await encryptItem(key, id, data),
      base: previous?.base ?? 0,
      pending: true,
    });
    const item: VaultItem = { id, revision, updatedAt, data };
    this.items.set(id, item);
    this.emit('local', [id]);
    return item;
  }

  private async saveRecord(record: ItemRecord) {
    await this.store.saveRecord(record);
    this.records.set(record.id, record);
  }

  private emit(source: VaultChange['source'], ids: string[]) {
    for (const listener of this.listeners) listener({ source, ids });
  }

  private async purgeExpiredTrash() {
    const cutoff = this.now().getTime() - TRASH_RETENTION_DAYS * DAY_MS;
    for (const item of this.trash()) {
      if (item.data.trashedAt && Date.parse(item.data.trashedAt) < cutoff)
        await this.purge(item.id);
    }
  }

  private require(id: string): VaultItem {
    const item = this.get(id);
    if (!item) throw new Error(`No item with id ${id}`);
    return item;
  }

  private assertUnlocked(): CryptoKey {
    if (!this.key) throw new VaultLockedError();
    return this.key;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
