import type { VaultHeader } from './crypto';

/**
 * An encrypted item as stored and synced. Matches `ItemRecord` in
 * spec/openapi.yaml, so a local vault can later be uploaded unchanged.
 */
export interface ItemRecord {
  id: string;
  /** Increments on every write. Used for sync conflict detection. */
  revision: number;
  updatedAt: string;
  /** Tombstone: the item was purged. `data` is absent. */
  deleted: boolean;
  /** pvf1 envelope of the item JSON. */
  data?: string;
}

/** Where a vault's encrypted data lives. Implementations never see plaintext. */
export interface VaultStore {
  loadHeader(): Promise<VaultHeader | null>;
  saveHeader(header: VaultHeader): Promise<void>;
  loadRecords(): Promise<ItemRecord[]>;
  saveRecord(record: ItemRecord): Promise<void>;
  /** Remove the vault entirely. */
  clear(): Promise<void>;
}

/** In-memory store, for tests and the demo vault. */
export class MemoryStore implements VaultStore {
  private header: VaultHeader | null = null;
  private readonly records = new Map<string, ItemRecord>();

  async loadHeader() {
    return this.header;
  }
  async saveHeader(header: VaultHeader) {
    this.header = header;
  }
  async loadRecords() {
    return [...this.records.values()].map((r) => ({ ...r }));
  }
  async saveRecord(record: ItemRecord) {
    this.records.set(record.id, { ...record });
  }
  async clear() {
    this.header = null;
    this.records.clear();
  }

  /** Test helper: the raw records, exactly as a server would see them. */
  rawRecords(): ItemRecord[] {
    return [...this.records.values()];
  }
}
