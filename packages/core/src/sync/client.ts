import { deriveMasterKey, deriveSubkeys, type KdfParams, type VaultHeader } from '../crypto';
import { toBase64Url } from '../encoding';
import type { components } from './openapi';

/**
 * Talks to a PassVaultify sync server (spec/openapi.yaml). It only ever sends
 * the auth key and ciphertext: the master password, master key and vault key
 * stay on this device.
 */

type Schemas = components['schemas'];
export type ServerInfo = Schemas['ServerInfo'];
export type SyncItemRecord = Schemas['ItemRecord'];
export type SyncItemWrite = Schemas['ItemWrite'];
export type SyncDevice = Schemas['Device'];
export type SyncDeviceInput = Schemas['DeviceInput'];

export interface SyncTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds when the access token stops working. */
  expiresAt: number;
}

export interface SyncChanges {
  revision: number;
  items: SyncItemRecord[];
}

export type PutResult = { ok: true; item: SyncItemRecord } | { ok: false; current: SyncItemRecord };

export type SyncEvent = { type: 'vault-changed'; revision: number } | { type: 'session-ended' };

export class SyncError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    message: string,
    /** Seconds to wait, on 429. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'SyncError';
  }

  /** The session is gone: the device was signed out, or the tokens expired. */
  get signedOut(): boolean {
    return this.status === 401;
  }
}

export interface SyncClientOptions {
  /** Base URL, e.g. https://vault.example.com */
  server: string;
  tokens?: SyncTokens | null;
  /** Called whenever tokens change, to persist them; null after signing out. */
  onTokens?: (tokens: SyncTokens | null) => void | Promise<void>;
  /**
   * Reads the persisted tokens. Other tabs, or the extension's background,
   * share them: before refreshing, the client checks whether one of them
   * already did, because presenting a used refresh token ends the session.
   */
  readTokens?: () => Promise<SyncTokens | null>;
  fetch?: typeof fetch;
  now?: () => number;
}

/** The auth key for a password, base64url. Derives the master key, keeps only the auth half. */
export async function deriveAuthKey(password: string, kdf: KdfParams): Promise<string> {
  const masterKey = await deriveMasterKey(password, kdf);
  const { authKey, wrapKey } = await deriveSubkeys(masterKey);
  const encoded = toBase64Url(authKey);
  masterKey.fill(0);
  authKey.fill(0);
  wrapKey.fill(0);
  return encoded;
}

/** Refresh this long before the access token expires. */
const EXPIRY_MARGIN_MS = 30_000;

export class SyncClient {
  readonly server: string;
  private tokens: SyncTokens | null;
  private refreshing: Promise<SyncTokens> | null = null;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly onTokens: SyncClientOptions['onTokens'];
  private readonly readTokens: SyncClientOptions['readTokens'];

  constructor(options: SyncClientOptions) {
    this.server = options.server.replace(/\/+$/, '');
    this.tokens = options.tokens ?? null;
    this.onTokens = options.onTokens;
    this.readTokens = options.readTokens;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  get signedIn(): boolean {
    return this.tokens !== null;
  }

  /** The current tokens, to persist them. */
  getTokens(): SyncTokens | null {
    return this.tokens ? { ...this.tokens } : null;
  }

  /** Replace the tokens with ones loaded from storage (no onTokens callback). */
  useTokens(tokens: SyncTokens | null): void {
    this.tokens = tokens;
  }

  // Server

  serverInfo(): Promise<ServerInfo> {
    return this.call<ServerInfo>('GET', '/v1/server');
  }

  // Accounts and sign-in

  async prelogin(email: string): Promise<KdfParams> {
    const body = await this.call<{ kdf: KdfParams }>('POST', '/v1/auth/prelogin', { email });
    return body.kdf;
  }

  /** Uploads a vault created on this device. Items are pushed separately. */
  async createAccount(email: string, password: string, header: VaultHeader): Promise<string> {
    const authKey = await deriveAuthKey(password, header.kdf);
    const body = await this.call<{ accountId: string }>('POST', '/v1/accounts', {
      email,
      authKey,
      header,
    });
    return body.accountId;
  }

  /** Signs in and returns the vault header, which unlocks with the same password. */
  async login(email: string, password: string, device: SyncDeviceInput): Promise<VaultHeader> {
    const kdf = await this.prelogin(email);
    const authKey = await deriveAuthKey(password, kdf);
    const body = await this.call<{ tokens: Schemas['Tokens']; header: VaultHeader }>(
      'POST',
      '/v1/auth/login',
      {
        email,
        authKey,
        device,
      },
    );
    await this.setTokens(this.fromWire(body.tokens));
    return body.header;
  }

  async logout(): Promise<void> {
    try {
      if (this.tokens) await this.authed('POST', '/v1/auth/logout');
    } finally {
      await this.setTokens(null);
    }
  }

  /**
   * Stores the header from a master password change made with core's
   * changePassword. Other devices are signed out by the server.
   */
  async changeMasterPassword(
    currentPassword: string,
    currentKdf: KdfParams,
    newAuthKey: string,
    header: VaultHeader,
  ): Promise<void> {
    const currentAuthKey = await deriveAuthKey(currentPassword, currentKdf);
    await this.authed('PUT', '/v1/vault/header', { currentAuthKey, newAuthKey, header });
  }

  async deleteAccount(password: string, kdf: KdfParams): Promise<void> {
    const authKey = await deriveAuthKey(password, kdf);
    await this.authed('DELETE', '/v1/accounts/me', { authKey });
    await this.setTokens(null);
  }

  // Sync

  changes(since?: number): Promise<SyncChanges> {
    return this.authed<SyncChanges>(
      'GET',
      since === undefined ? '/v1/sync' : `/v1/sync?since=${since}`,
    );
  }

  /** Writes an item. On a conflict, returns the server's newer copy instead. */
  async putItem(id: string, write: SyncItemWrite): Promise<PutResult> {
    try {
      const item = await this.authed<SyncItemRecord>(
        'PUT',
        `/v1/items/${encodeURIComponent(id)}`,
        write,
      );
      return { ok: true, item };
    } catch (error) {
      if (error instanceof ConflictResponse) return { ok: false, current: error.current };
      throw error;
    }
  }

  // Devices

  devices(): Promise<SyncDevice[]> {
    return this.authed<SyncDevice[]>('GET', '/v1/devices');
  }

  async signOutDevice(deviceId: string): Promise<void> {
    await this.authed('DELETE', `/v1/devices/${encodeURIComponent(deviceId)}`);
  }

  // Events

  /**
   * Reads change notifications until the signal aborts, the stream closes or
   * the session ends. Reconnecting is the caller's choice; on reconnect the
   * server sends the current revision first, so nothing is missed.
   */
  async listen(onEvent: (event: SyncEvent) => void, signal?: AbortSignal): Promise<void> {
    const response = await this.authedResponse(
      'GET',
      '/v1/events',
      undefined,
      signal,
      'text/event-stream',
    );
    if (!response.body) return;
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let event = 'message';
    let data = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (line === '') {
            const parsed = parseEvent(event, data);
            event = 'message';
            data = '';
            if (!parsed) continue;
            onEvent(parsed);
            if (parsed.type === 'session-ended') {
              await this.setTokens(null);
              return;
            }
          } else if (line.startsWith(':')) {
            // Keep-alive comment.
          } else {
            const colon = line.indexOf(':');
            const field = colon < 0 ? line : line.slice(0, colon);
            const text = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
            if (field === 'event') event = text;
            else if (field === 'data') data = data ? `${data}\n${text}` : text;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Plumbing

  private fromWire(tokens: Schemas['Tokens']): SyncTokens {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: this.now() + tokens.expiresIn * 1000,
    };
  }

  private async setTokens(tokens: SyncTokens | null) {
    this.tokens = tokens;
    await this.onTokens?.(tokens);
  }

  /**
   * One refresh at a time, across tabs too (Web Locks), since each refresh
   * token works once. Inside the lock, tokens another context saved win.
   */
  private refresh(): Promise<SyncTokens> {
    if (!this.refreshing) {
      this.refreshing = withLock('passvaultify-token-refresh', async () => {
        const stored = await this.readTokens?.();
        if (stored && stored.refreshToken !== this.tokens?.refreshToken) {
          this.tokens = stored;
          if (this.now() < stored.expiresAt - EXPIRY_MARGIN_MS) return stored;
        }
        const refreshToken = this.tokens?.refreshToken;
        if (!refreshToken) throw new SyncError(401, 'Not signed in', 'Sign in to sync.');
        try {
          const tokens = this.fromWire(
            await this.call<Schemas['Tokens']>('POST', '/v1/auth/refresh', { refreshToken }),
          );
          await this.setTokens(tokens);
          return tokens;
        } catch (error) {
          if (error instanceof SyncError && error.signedOut) await this.setTokens(null);
          throw error;
        }
      }).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async accessToken(): Promise<string> {
    if (!this.tokens) throw new SyncError(401, 'Not signed in', 'Sign in to sync.');
    if (this.now() >= this.tokens.expiresAt - EXPIRY_MARGIN_MS)
      return (await this.refresh()).accessToken;
    return this.tokens.accessToken;
  }

  private async authed<T = void>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.authedResponse(method, path, body);
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  /** Sends with the access token; if the server says it's no longer valid, refreshes once and retries. */
  private async authedResponse(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    accept = 'application/json',
  ): Promise<Response> {
    let token = await this.accessToken();
    let response = await this.send(method, path, body, token, signal, accept);
    if (response.status === 401) {
      token = (await this.refresh()).accessToken;
      response = await this.send(method, path, body, token, signal, accept);
    }
    if (response.status === 409 && path.startsWith('/v1/items/')) {
      throw new ConflictResponse(((await response.json()) as { current: SyncItemRecord }).current);
    }
    if (!response.ok) throw await toError(response);
    return response;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, body);
    if (!response.ok) throw await toError(response);
    return (await response.json()) as T;
  }

  private send(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
    signal?: AbortSignal,
    accept = 'application/json',
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: accept };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    return this.fetch(this.server + path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  }
}

async function withLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  return locks ? locks.request(name, task) : task();
}

class ConflictResponse extends Error {
  constructor(readonly current: SyncItemRecord) {
    super('Conflict');
  }
}

async function toError(response: Response): Promise<SyncError> {
  let title = response.statusText || 'Request failed';
  let detail = `The server answered ${response.status}.`;
  try {
    const problem = (await response.json()) as { title?: string; detail?: string };
    title = problem.title ?? title;
    detail = problem.detail ?? problem.title ?? detail;
  } catch {
    // Not JSON: keep the generic message.
  }
  const retryAfter = Number(response.headers.get('Retry-After'));
  return new SyncError(
    response.status,
    title,
    detail,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

function parseEvent(event: string, data: string): SyncEvent | null {
  if (event === 'session-ended') return { type: 'session-ended' };
  if (event === 'vault-changed') {
    try {
      const revision = (JSON.parse(data) as { revision?: unknown }).revision;
      if (typeof revision === 'number') return { type: 'vault-changed', revision };
    } catch {
      // Malformed event: ignore it.
    }
  }
  return null;
}
