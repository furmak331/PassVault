import type {
  ItemRecord,
  SyncSettings,
  SyncTokens,
  VaultHeader,
  VaultStore,
} from '@passvaultify/core';
import Dexie, { type EntityTable } from 'dexie';
import { sanitizeProfile, type Profile } from './profile';

interface MetaRow {
  key: 'header' | 'profile' | 'sync';
  value: unknown;
}

class PassVaultifyDb extends Dexie {
  meta!: EntityTable<MetaRow, 'key'>;
  records!: EntityTable<ItemRecord, 'id'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ meta: 'key', records: 'id' });
  }
}

/**
 * The local-only vault in IndexedDB. Like every VaultStore it only ever
 * receives the header and encrypted records.
 */
export class IdbStore implements VaultStore {
  private readonly db: PassVaultifyDb;

  constructor(name = 'passvaultify') {
    this.db = new PassVaultifyDb(name);
  }

  async loadHeader(): Promise<VaultHeader | null> {
    return ((await this.db.meta.get('header'))?.value as VaultHeader | undefined) ?? null;
  }

  async saveHeader(header: VaultHeader): Promise<void> {
    await this.db.meta.put({ key: 'header', value: header });
  }

  async loadRecords(): Promise<ItemRecord[]> {
    return this.db.records.toArray();
  }

  async saveRecord(record: ItemRecord): Promise<void> {
    await this.db.records.put(record);
  }

  async clear(): Promise<void> {
    await this.db.transaction('rw', this.db.meta, this.db.records, async () => {
      await this.db.meta.clear();
      await this.db.records.clear();
    });
  }

  async loadProfile(): Promise<Profile | null> {
    const row = await this.db.meta.get('profile');
    return row ? sanitizeProfile(row.value as Partial<Profile>) : null;
  }

  async saveProfile(profile: Profile): Promise<void> {
    await this.db.meta.put({ key: 'profile', value: profile });
  }

  /** Sync server, account and session tokens. Cleared with the vault. */
  async loadSync(): Promise<SyncSettings | null> {
    return ((await this.db.meta.get('sync'))?.value as SyncSettings | undefined) ?? null;
  }

  async saveSync(settings: SyncSettings | null): Promise<void> {
    if (settings) await this.db.meta.put({ key: 'sync', value: settings });
    else await this.db.meta.delete('sync');
  }

  /** Tokens as last saved by any tab, so tabs don't refresh over each other. */
  async loadSyncTokens(): Promise<SyncTokens | null> {
    return (await this.loadSync())?.tokens ?? null;
  }
}
