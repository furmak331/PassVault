import { unlockVault, type VaultHeader } from '../crypto';
import { duplicateKey } from '../importers';
import type { ItemData } from '../items';
import type { Vault } from '../vault';
import { SyncClient, type ServerInfo, type SyncDeviceInput } from './client';
import type { SyncSettings } from './engine';

/**
 * The steps of connecting a device to a sync server. The UI walks through
 * them, showing the server's fingerprint before anything is sent.
 */

/** Accepts "vault.example.com", "https://vault.example.com/" and the like. */
export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !isLocalHost(parsed.hostname)) {
    throw new Error(
      'Use an https:// address. Plain http is only allowed for a server on this computer.',
    );
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** Step 1: reach the server and learn its fingerprint and whether it takes new accounts. */
export async function checkServer(
  input: string,
  fetchImpl?: typeof fetch,
): Promise<{ server: string; info: ServerInfo }> {
  const server = normalizeServerUrl(input);
  const client = new SyncClient({ server, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  return { server, info: await client.serverInfo() };
}

export interface ConnectOptions {
  server: string;
  /** The fingerprint the person saw and accepted in step 1. */
  serverFingerprint: string;
  email: string;
  password: string;
  device: SyncDeviceInput;
  fetch?: typeof fetch;
}

/**
 * Step 2a: make an account from the vault on this device. The account's
 * password is the vault's master password: the server gets only the auth key
 * derived from it. Every item is then marked for upload.
 */
export async function createSyncAccount(
  vault: Vault,
  options: ConnectOptions,
): Promise<SyncSettings> {
  // Proves the password before anything is sent.
  await unlockVault(options.password, vault.header);
  const client = clientFor(options);
  await client.createAccount(options.email, options.password, vault.header);
  await client.login(options.email, options.password, options.device);
  await vault.resetSync();
  return settingsFor(options, client);
}

/**
 * Step 2b: sign in to an existing account. Returns the account's vault header,
 * which opens with the same password. The caller decides what to do with the
 * vault on this device, if there is one (see compareVaults).
 */
export async function signInToSync(
  options: ConnectOptions,
): Promise<{ settings: SyncSettings; header: VaultHeader }> {
  const client = clientFor(options);
  const header = await client.login(options.email, options.password, options.device);
  return { settings: settingsFor(options, client), header };
}

/**
 * How the account's vault relates to the one on this device:
 * - same: one vault (same fingerprint). Sync merges them item by item.
 * - different: two vaults. This device can join the account's vault and bring
 *   its items across with mergeItemsInto.
 */
export function compareVaults(local: VaultHeader, remote: VaultHeader): 'same' | 'different' {
  return local.fingerprint === remote.fingerprint ? 'same' : 'different';
}

/**
 * Copy items into a vault, skipping ones it already has (same site, username
 * and password, or same note). They get new IDs and are uploaded on the next sync.
 */
export async function mergeItemsInto(vault: Vault, items: ItemData[]): Promise<number> {
  const existing = new Set([...vault.list(), ...vault.trash()].map((i) => duplicateKey(i.data)));
  let added = 0;
  for (const item of items) {
    const key = duplicateKey(item);
    if (existing.has(key)) continue;
    existing.add(key);
    await vault.importItem(item);
    added++;
  }
  return added;
}

function clientFor(options: ConnectOptions): SyncClient {
  return new SyncClient({
    server: options.server,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

function settingsFor(options: ConnectOptions, client: SyncClient): SyncSettings {
  return {
    server: options.server,
    email: options.email,
    deviceName: options.device.name,
    serverFingerprint: options.serverFingerprint,
    lastRevision: 0,
    tokens: client.getTokens(),
  };
}
