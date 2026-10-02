import { decryptItem, FORMAT, unlockVault, type VaultHeader } from './crypto';
import { fromBase64Url } from './encoding';
import type { ItemData } from './items';
import type { ItemRecord, VaultStore } from './store';

/**
 * Encrypted backups (spec/crypto.md, "Backup file"). A backup is the vault
 * exactly as it's stored: the plaintext header and the pvf1 records. It opens
 * with the master password that was current when it was made, and nothing in
 * it is readable without that password.
 */
export const BACKUP_FORMAT = 'passvaultify-backup';
export const BACKUP_VERSION = 1;

export interface VaultBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  /** Shown before the password is asked for. Not secret, and optional. */
  vaultName?: string;
  header: VaultHeader;
  records: ItemRecord[];
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

/** Limits that keep a malicious or damaged file from hanging the tab. */
const MAX_ITERATIONS = 10_000_000;
const MIN_ITERATIONS = 1_000;
const MAX_RECORDS = 100_000;
const MAX_ENVELOPE = 1_000_000;

export async function createBackup(
  store: VaultStore,
  options: { vaultName?: string; now?: Date } = {},
): Promise<VaultBackup> {
  const header = await store.loadHeader();
  if (!header) throw new BackupError('There is no vault to back up.');
  const records = (await store.loadRecords()).filter((r) => !r.deleted && r.data);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: (options.now ?? new Date()).toISOString(),
    ...(options.vaultName ? { vaultName: options.vaultName } : {}),
    header,
    records,
  };
}

export function serializeBackup(backup: VaultBackup): string {
  return JSON.stringify(backup, null, 2);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new BackupError(message);
}

function validHeader(h: unknown): h is VaultHeader {
  if (!isObject(h) || h.format !== FORMAT || !isObject(h.kdf)) return false;
  const { alg, iterations, salt } = h.kdf;
  if (alg !== 'pbkdf2-sha256' || typeof salt !== 'string') return false;
  if (!Number.isInteger(iterations)) return false;
  if ((iterations as number) < MIN_ITERATIONS || (iterations as number) > MAX_ITERATIONS) {
    return false;
  }
  try {
    if (fromBase64Url(salt).length !== 16) return false;
  } catch {
    return false;
  }
  return (
    typeof h.wrappedVaultKey === 'string' &&
    h.wrappedVaultKey.startsWith(`${FORMAT}.`) &&
    h.wrappedVaultKey.length < 1000 &&
    typeof h.fingerprint === 'string' &&
    /^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/.test(h.fingerprint)
  );
}

function validRecord(r: unknown): r is ItemRecord {
  return (
    isObject(r) &&
    typeof r.id === 'string' &&
    /^[A-Za-z0-9_-]{1,100}$/.test(r.id) &&
    Number.isInteger(r.revision) &&
    (r.revision as number) > 0 &&
    typeof r.updatedAt === 'string' &&
    !Number.isNaN(Date.parse(r.updatedAt)) &&
    r.deleted === false &&
    typeof r.data === 'string' &&
    r.data.startsWith(`${FORMAT}.`) &&
    r.data.length <= MAX_ENVELOPE
  );
}

/** Parse and strictly validate a backup file. Throws BackupError with a readable reason. */
export function parseBackup(text: string): VaultBackup {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BackupError("This file isn't a PassVaultify backup (it isn't valid JSON).");
  }
  check(
    isObject(value) && value.format === BACKUP_FORMAT,
    "This file isn't a PassVaultify backup.",
  );
  check(
    value.version === BACKUP_VERSION,
    'This backup was made by a newer version of PassVaultify. Update the app and try again.',
  );
  check(validHeader(value.header), 'The backup is damaged: its vault header is invalid.');
  check(
    Array.isArray(value.records) && value.records.length <= MAX_RECORDS,
    'The backup is damaged: its item list is invalid.',
  );
  const records = value.records as unknown[];
  check(records.every(validRecord), 'The backup is damaged: one of its items is invalid.');
  check(
    new Set(records.map((r) => (r as ItemRecord).id)).size === records.length,
    'The backup is damaged: it contains duplicate items.',
  );
  const exportedAt = typeof value.exportedAt === 'string' ? value.exportedAt : '';
  const vaultName =
    typeof value.vaultName === 'string' ? value.vaultName.slice(0, 80).trim() : undefined;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    ...(vaultName ? { vaultName } : {}),
    header: value.header,
    records: records as ItemRecord[],
  };
}

/**
 * Open a backup with its master password and decrypt every item. Throws
 * DecryptionError on a wrong password or a tampered item, before anything is
 * written anywhere, so a bad file can never leave a half-restored vault.
 */
export async function openBackup(
  backup: VaultBackup,
  password: string,
): Promise<{ id: string; data: ItemData }[]> {
  const { vaultKey } = await unlockVault(password, backup.header);
  const items: { id: string; data: ItemData }[] = [];
  for (const record of backup.records) {
    items.push({
      id: record.id,
      data: await decryptItem<ItemData>(vaultKey, record.id, record.data ?? ''),
    });
  }
  return items;
}

/**
 * Restore a backup into an empty store, as the vault on this device. Call
 * openBackup first: it proves the password and every item are good.
 */
export async function restoreBackup(store: VaultStore, backup: VaultBackup): Promise<void> {
  if (await store.loadHeader()) throw new BackupError('A vault already exists on this device.');
  // Records first and the header last: until the header lands, there is no vault.
  await store.clear();
  for (const record of backup.records) await store.saveRecord(record);
  await store.saveHeader(backup.header);
}
