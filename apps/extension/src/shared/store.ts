import type { ItemRecord, VaultHeader, VaultStore } from '@passvaultify/core';

const HEADER = 'vault:header';
const RECORD = 'vault:record:';
const PROFILE = 'vault:profile';

export type Theme = 'system' | 'graphite' | 'porcelain';
export type Accent = 'signal' | 'cobalt' | 'jade' | 'mono';

/** Settings that aren't secret, kept next to the vault in chrome.storage.local. */
export interface ExtensionProfile {
  vaultName: string;
  theme: Theme;
  accent: Accent;
  /** Minutes before the vault locks itself; 0 means only when the browser closes. */
  autoLockMinutes: number;
  /**
   * On websites (once site access is granted): offer to save or update a login
   * after a sign-in or sign-up form is submitted.
   */
  offerToSave: boolean;
  /** On websites: suggest saved logins, or a strong password, in the field being typed in. */
  autofillMenu: boolean;
  /** Sites (host names) where the person said never to offer saving. */
  neverSave: string[];
  lastBackupAt: string | null;
}

export const DEFAULT_PROFILE: ExtensionProfile = {
  vaultName: 'My Vault',
  theme: 'system',
  accent: 'signal',
  autoLockMinutes: 15,
  // Both only act once site access is granted, which is asked for separately.
  offerToSave: true,
  autofillMenu: true,
  neverSave: [],
  lastBackupAt: null,
};

/**
 * The vault in chrome.storage.local: the plaintext header and one key per
 * encrypted record. Like every VaultStore, it never sees plaintext items.
 */
export class ChromeStore implements VaultStore {
  async loadHeader(): Promise<VaultHeader | null> {
    const got = await chrome.storage.local.get(HEADER);
    return (got[HEADER] as VaultHeader | undefined) ?? null;
  }

  async saveHeader(header: VaultHeader): Promise<void> {
    await chrome.storage.local.set({ [HEADER]: header });
  }

  async loadRecords(): Promise<ItemRecord[]> {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([key]) => key.startsWith(RECORD))
      .map(([, record]) => record as ItemRecord);
  }

  async saveRecord(record: ItemRecord): Promise<void> {
    await chrome.storage.local.set({ [RECORD + record.id]: record });
  }

  /** Removes the vault and its records, keeping the profile (appearance). */
  async clear(): Promise<void> {
    const keys = Object.keys(await chrome.storage.local.get(null)).filter(
      (key) => key === HEADER || key.startsWith(RECORD),
    );
    await chrome.storage.local.remove(keys);
  }
}

export async function loadProfile(): Promise<ExtensionProfile> {
  const got = await chrome.storage.local.get(PROFILE);
  return { ...DEFAULT_PROFILE, ...(got[PROFILE] as Partial<ExtensionProfile> | undefined) };
}

export async function saveProfile(patch: Partial<ExtensionProfile>): Promise<ExtensionProfile> {
  const next = { ...(await loadProfile()), ...patch };
  await chrome.storage.local.set({ [PROFILE]: next });
  return next;
}
