/**
 * The pvf1 crypto format. spec/crypto.md is the source of truth; this file
 * implements it with the Web Crypto API only.
 */
import { type Bytes, fromBase64Url, fromUtf8, toBase64Url, toHex, utf8 } from './encoding';
import { randomBytes } from './random';

export const FORMAT = 'pvf1';
export const DEFAULT_ITERATIONS = 600_000;

const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

const INFO_AUTH = 'passvaultify/v1/auth';
const INFO_WRAP = 'passvaultify/v1/wrap';
const INFO_FINGERPRINT = 'passvaultify/v1/fingerprint';
const AAD_VAULT_KEY = 'passvaultify/v1/vault-key';
const itemAad = (itemId: string) => `passvaultify/v1/item/${itemId}`;

export interface KdfParams {
  alg: 'pbkdf2-sha256';
  iterations: number;
  /** base64url */
  salt: string;
}

export interface Fingerprint {
  /** HKDF output; the code is its first 6 bytes. */
  bytes: Bytes;
  /** First 6 bytes as "XXXX XXXX XXXX". Stored in the vault header. */
  code: string;
  /** 16 bytes that drive the ring pattern, derived from the code. */
  rings: Bytes;
}

/** What a vault stores in plaintext. None of it is secret. */
export interface VaultHeader {
  format: typeof FORMAT;
  kdf: KdfParams;
  wrappedVaultKey: string;
  fingerprint: string;
}

export interface UnlockedVault {
  header: VaultHeader;
  /** Non-extractable AES-GCM key: code can use it but never read its bytes. */
  vaultKey: CryptoKey;
  /** Sent to a sync server at sign-in. Unused in local-only mode. */
  authKey: Bytes;
}

export class DecryptionError extends Error {
  constructor(message = 'Decryption failed') {
    super(message);
    this.name = 'DecryptionError';
  }
}

const subtle = () => globalThis.crypto.subtle;

export function createKdfParams(iterations = DEFAULT_ITERATIONS): KdfParams {
  return { alg: 'pbkdf2-sha256', iterations, salt: toBase64Url(randomBytes(SALT_LENGTH)) };
}

/** Master key = PBKDF2-HMAC-SHA256(NFKC(password), salt, iterations, 32 bytes). */
export async function deriveMasterKey(password: string, kdf: KdfParams): Promise<Bytes> {
  if (kdf.alg !== 'pbkdf2-sha256') throw new Error(`Unsupported KDF: ${String(kdf.alg)}`);
  const base = await subtle().importKey('raw', utf8(password.normalize('NFKC')), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(kdf.salt), iterations: kdf.iterations },
    base,
    KEY_LENGTH * 8,
  );
  return new Uint8Array(bits);
}

/** HKDF-SHA256 with an empty salt, as specified in spec/crypto.md. */
export async function hkdf(ikm: Bytes, info: string, length: number): Promise<Bytes> {
  const base = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) },
    base,
    length * 8,
  );
  return new Uint8Array(bits);
}

export async function deriveSubkeys(masterKey: Bytes): Promise<{ authKey: Bytes; wrapKey: Bytes }> {
  const [authKey, wrapKey] = await Promise.all([
    hkdf(masterKey, INFO_AUTH, KEY_LENGTH),
    hkdf(masterKey, INFO_WRAP, KEY_LENGTH),
  ]);
  return { authKey, wrapKey };
}

async function aesKey(raw: Bytes): Promise<CryptoKey> {
  return subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

type KeyInput = Bytes | CryptoKey;
const asKey = (key: KeyInput) => (key instanceof Uint8Array ? aesKey(key) : Promise.resolve(key));

/**
 * AES-256-GCM encrypt into a "pvf1.<iv>.<ciphertext+tag>" envelope.
 * `iv` exists for test vectors only; production code must let it default.
 */
export async function seal(
  key: KeyInput,
  plaintext: Bytes,
  aad: string,
  iv: Bytes = randomBytes(IV_LENGTH),
): Promise<string> {
  if (iv.length !== IV_LENGTH) throw new Error('IV must be 12 bytes');
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(aad) },
    await asKey(key),
    plaintext,
  );
  return `${FORMAT}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ct))}`;
}

export async function open(key: KeyInput, envelope: string, aad: string): Promise<Bytes> {
  const parts = envelope.split('.');
  if (parts.length !== 3 || parts[0] !== FORMAT)
    throw new DecryptionError('Unknown envelope format');
  let iv: Bytes;
  let ct: Bytes;
  try {
    iv = fromBase64Url(parts[1] as string);
    ct = fromBase64Url(parts[2] as string);
  } catch {
    throw new DecryptionError('Malformed envelope');
  }
  if (iv.length !== IV_LENGTH) throw new DecryptionError('Malformed envelope');
  try {
    const pt = await subtle().decrypt(
      { name: 'AES-GCM', iv, additionalData: utf8(aad) },
      await asKey(key),
      ct,
    );
    return new Uint8Array(pt);
  } catch {
    // Wrong key, wrong AAD or tampered ciphertext: GCM can't tell them apart, and neither do we.
    throw new DecryptionError();
  }
}

export async function computeFingerprint(vaultKeyBytes: Bytes): Promise<Fingerprint> {
  const bytes = await hkdf(vaultKeyBytes, INFO_FINGERPRINT, 16);
  const hex = toHex(bytes.subarray(0, 6)).toUpperCase();
  const code = `${hex.slice(0, 4)} ${hex.slice(4, 8)} ${hex.slice(8, 12)}`;
  return { bytes, code, rings: await fingerprintRings(code) };
}

/**
 * The ring pattern for a fingerprint code. Derived from the code alone, so the
 * lock screen can draw it from the vault header before unlocking.
 */
export async function fingerprintRings(code: string): Promise<Bytes> {
  const digest = await subtle().digest('SHA-256', utf8(`passvaultify/v1/rings/${code}`));
  return new Uint8Array(digest).slice(0, 16);
}

export interface CreateVaultOptions {
  iterations?: number;
  /** Test hooks: fixed values make output match spec/vectors/pvf1.json. */
  kdf?: KdfParams;
  vaultKeyBytes?: Bytes;
  wrapIv?: Bytes;
}

/** Create a new vault: a fresh salt and vault key, wrapped under the password. */
export async function createVault(
  password: string,
  options: CreateVaultOptions = {},
): Promise<UnlockedVault & { fingerprint: Fingerprint }> {
  const kdf = options.kdf ?? createKdfParams(options.iterations);
  const vaultKeyBytes = options.vaultKeyBytes
    ? options.vaultKeyBytes.slice()
    : randomBytes(KEY_LENGTH);
  const masterKey = await deriveMasterKey(password, kdf);
  const { authKey, wrapKey } = await deriveSubkeys(masterKey);
  const wrappedVaultKey = await seal(wrapKey, vaultKeyBytes, AAD_VAULT_KEY, options.wrapIv);
  const fingerprint = await computeFingerprint(vaultKeyBytes);
  const vaultKey = await aesKey(vaultKeyBytes);
  wipe(masterKey, wrapKey, vaultKeyBytes);
  return {
    header: { format: FORMAT, kdf, wrappedVaultKey, fingerprint: fingerprint.code },
    vaultKey,
    authKey,
    fingerprint,
  };
}

/**
 * Unlock a vault. A wrong password yields a wrong wrap key, so AES-GCM rejects
 * the wrapped vault key and this throws DecryptionError.
 */
export async function unlockVault(password: string, header: VaultHeader): Promise<UnlockedVault> {
  if (header.format !== FORMAT)
    throw new Error(`Unsupported vault format: ${String(header.format)}`);
  const masterKey = await deriveMasterKey(password, header.kdf);
  const { authKey, wrapKey } = await deriveSubkeys(masterKey);
  const vaultKeyBytes = await open(wrapKey, header.wrappedVaultKey, AAD_VAULT_KEY);
  const fingerprint = await computeFingerprint(vaultKeyBytes);
  const vaultKey = await aesKey(vaultKeyBytes);
  wipe(masterKey, wrapKey, vaultKeyBytes);
  if (fingerprint.code !== header.fingerprint) {
    throw new DecryptionError('Vault fingerprint does not match');
  }
  return { header, vaultKey, authKey };
}

/** Re-wrap the same vault key under a new password. No item is re-encrypted. */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
  header: VaultHeader,
  iterations = header.kdf.iterations,
): Promise<UnlockedVault> {
  const oldKeys = await deriveSubkeys(await deriveMasterKey(oldPassword, header.kdf));
  const vaultKeyBytes = await open(oldKeys.wrapKey, header.wrappedVaultKey, AAD_VAULT_KEY);
  const kdf = createKdfParams(iterations);
  const masterKey = await deriveMasterKey(newPassword, kdf);
  const { authKey, wrapKey } = await deriveSubkeys(masterKey);
  const wrappedVaultKey = await seal(wrapKey, vaultKeyBytes, AAD_VAULT_KEY);
  const vaultKey = await aesKey(vaultKeyBytes);
  wipe(oldKeys.wrapKey, oldKeys.authKey, masterKey, wrapKey, vaultKeyBytes);
  return { header: { ...header, kdf, wrappedVaultKey }, vaultKey, authKey };
}

export async function encryptItem(
  vaultKey: CryptoKey,
  itemId: string,
  item: unknown,
  iv?: Bytes,
): Promise<string> {
  return seal(vaultKey, utf8(JSON.stringify(item)), itemAad(itemId), iv);
}

export async function decryptItem<T = unknown>(
  vaultKey: CryptoKey,
  itemId: string,
  envelope: string,
): Promise<T> {
  return JSON.parse(fromUtf8(await open(vaultKey, envelope, itemAad(itemId)))) as T;
}

/**
 * Best-effort zeroing of key material we no longer need. JavaScript can't
 * guarantee no copies remain, but this shortens how long they live.
 */
function wipe(...buffers: Bytes[]) {
  for (const b of buffers) b.fill(0);
}
