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
  if (/^[^\s/@:]+@[^\s/@]+\.[^\s/@]+$/.test(url)) {
    throw new Error(
      "That's an email address. Enter the server's address, like vault.example.com, or paste a setup link from a device that's already connected.",
    );
  }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That isn't a server address. It looks like vault.example.com.");
  }
  if (
    parsed.username ||
    parsed.password ||
    (!parsed.hostname.includes('.') && !isLocalHost(parsed.hostname))
  ) {
    throw new Error("That isn't a server address. It looks like vault.example.com.");
  }
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

/**
 * A setup link: a web vault address whose fragment names a sync server and its
 * fingerprint, e.g. https://example.github.io/PassVault/#connect=vault.example.com&fp=6F369FA535F6
 * A device that's already connected shows it (and a QR code of it) so another
 * can join without typing an address or comparing fingerprints. Both parts
 * are public; the fragment never reaches the web vault's host.
 */
export interface SetupLink {
  server: string;
  /** Grouped like the server shows it: "6F36 9FA5 35F6". */
  fingerprint: string;
}

const compactFingerprint = (fingerprint: string) => fingerprint.replace(/[\s-]/g, '').toUpperCase();

/** Whether two fingerprints are the same, however they're spaced or cased. */
export function sameFingerprint(a: string, b: string): boolean {
  return compactFingerprint(a) === compactFingerprint(b);
}

export function buildSetupLink(appUrl: string, server: string, fingerprint: string): string {
  const url = new URL(server);
  // An https server at its root needs only its host name.
  const short =
    url.protocol === 'https:' && (url.pathname === '/' || url.pathname === '') ? url.host : server;
  const fragment = new URLSearchParams({ connect: short, fp: compactFingerprint(fingerprint) });
  return `${appUrl.split('#')[0]}#${fragment.toString()}`;
}

/** The setup link in a pasted string or a page address, or null if there isn't one. */
export function parseSetupLink(input: string): SetupLink | null {
  const text = input.trim();
  const hash = text.indexOf('#');
  const fragment = hash >= 0 ? text.slice(hash + 1) : text.startsWith('connect=') ? text : '';
  if (!fragment) return null;
  const params = new URLSearchParams(fragment);
  const server = params.get('connect');
  const fp = compactFingerprint(params.get('fp') ?? '');
  if (!server || !/^[0-9A-F]{8,64}$/.test(fp)) return null;
  try {
    return { server: normalizeServerUrl(server), fingerprint: fp.replace(/(.{4})(?=.)/g, '$1 ') };
  } catch {
    return null;
  }
}

/**
 * Step 1: reach the server and learn its fingerprint and whether it takes new
 * accounts. Takes an address or a setup link; with a link, the server's
 * fingerprint must match the link's, and `verified` says it was checked.
 */
export async function checkServer(
  input: string | SetupLink,
  fetchImpl?: typeof fetch,
): Promise<{ server: string; info: ServerInfo; verified: boolean }> {
  const link = typeof input === 'string' ? parseSetupLink(input) : input;
  const server = link ? link.server : normalizeServerUrl(input as string);
  const client = new SyncClient({ server, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  const info = await client.serverInfo();
  if (link && !sameFingerprint(link.fingerprint, info.fingerprint)) {
    throw new Error(
      `The server at ${new URL(server).host} has a different fingerprint from the setup link (${info.fingerprint}, not ${link.fingerprint}). Don't sign in: ask for a new link from a device you trust.`,
    );
  }
  return { server, info, verified: Boolean(link) };
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
