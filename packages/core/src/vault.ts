import {
  changePassword,
  createVault,
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
  private readonly revisions = new Map<string, number>();
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
    const vault = new Vault(store, header, vaultKey, options);
    for (const record of await store.loadRecords()) {
      vault.revisions.set(record.id, record.revision);
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
    this.items.delete(id);
    const revision = (this.revisions.get(id) ?? 0) + 1;
    this.revisions.set(id, revision);
    await this.store.saveRecord({ id, revision, updatedAt: this.timestamp(), deleted: true });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    this.assertUnlocked();
    const changed = await changePassword(currentPassword, newPassword, this.headerValue);
    await this.store.saveHeader(changed.header);
    this.headerValue = changed.header;
    this.key = changed.vaultKey;
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
    const revision = (this.revisions.get(id) ?? 0) + 1;
    const updatedAt = this.timestamp();
    const record: ItemRecord = {
      id,
      revision,
      updatedAt,
      deleted: false,
      data: await encryptItem(key, id, data),
    };
    await this.store.saveRecord(record);
    this.revisions.set(id, revision);
    const item: VaultItem = { id, revision, updatedAt, data };
    this.items.set(id, item);
    return item;
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
