/**
 * Interop with the real sync server (apps/server), run in CI:
 *
 *   java -jar apps/server/target/passvaultify-server.jar &
 *   SYNC_SERVER_URL=http://localhost:8080 pnpm --filter @passvaultify/core test
 *
 * Two clients share a vault through the server. Every response is checked
 * against spec/openapi.yaml, and the test fails if an operation in the spec
 * was never exercised, so the spec, the Java server and this client can't drift.
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  changePassword,
  checkServer,
  createSyncAccount,
  signInToSync,
  SyncEngine,
  type SyncSettings,
  decryptItem,
  DecryptionError,
  encryptItem,
  MemoryStore,
  randomId,
  SyncClient,
  SyncError,
  toBase64Url,
  unlockVault,
  Vault,
  type ItemData,
  type SyncEvent,
} from '../src';

const SERVER = process.env.SYNC_SERVER_URL;

// ---------- Spec checking ----------

interface Operation {
  operationId: string;
  responses: Record<string, { $ref?: string; content?: Record<string, { schema?: unknown }> }>;
}
type Spec = {
  paths: Record<string, Record<string, Operation>>;
  components: { responses: Record<string, { content?: Record<string, { schema?: unknown }> }> };
};

const spec = parse(
  readFileSync(new URL('../../../spec/openapi.yaml', import.meta.url), 'utf8'),
) as Spec;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ ...spec, $id: 'spec' });

const routes = Object.entries(spec.paths).flatMap(([template, methods]) =>
  Object.entries(methods)
    .filter(([method]) => ['get', 'put', 'post', 'delete'].includes(method))
    .map(([method, op]) => ({
      method: method.toUpperCase(),
      template,
      pattern: new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`),
      op,
    })),
);
const exercised = new Set<string>();
const problems: string[] = [];
const pointer = (...parts: string[]) =>
  parts.map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');

/** fetch, but every response must be documented in the spec and match its schema. */
const specFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const url = new URL(String(input));
  const method = (init?.method ?? 'GET').toUpperCase();
  const route = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
  if (!route) {
    problems.push(`${method} ${url.pathname} is not in the spec`);
    return response;
  }
  exercised.add(route.op.operationId);
  const status = String(response.status);
  const documented = route.op.responses[status];
  if (!documented) {
    problems.push(`${route.op.operationId} answered ${status}, which the spec doesn't list`);
    return response;
  }
  const type = response.headers.get('content-type')?.split(';')[0] ?? '';
  if (response.status === 204 || type === 'text/event-stream') return response;
  const base = documented.$ref
    ? `#/components/responses/${documented.$ref.split('/').pop()}`
    : `#/${pointer('paths', route.template, method.toLowerCase(), 'responses', status)}`;
  const content = documented.$ref
    ? spec.components.responses[documented.$ref.split('/').pop() as string]?.content
    : documented.content;
  if (!content?.[type]) {
    problems.push(
      `${route.op.operationId} ${status} sent ${type || 'no content type'}, not in the spec`,
    );
    return response;
  }
  const validate = ajv.compile({ $ref: `spec${base}/${pointer('content', type, 'schema')}` });
  const body: unknown = await response.clone().json();
  if (!validate(body)) {
    problems.push(
      `${route.op.operationId} ${status}: ${ajv.errorsText(validate.errors)} in ${JSON.stringify(body)}`,
    );
  }
  return response;
};

// ---------- The flows ----------

const iterations = 100_000; // The server's minimum; keeps the test quick.
const password = 'correct horse battery staple';
let password_ = password;
const email = `interop-${toBase64Url(crypto.getRandomValues(new Uint8Array(6))).toLowerCase()}@example.com`;

function client() {
  return new SyncClient({ server: SERVER as string, fetch: specFetch });
}

/** Collects events from a device's stream until stopped. */
function listen(sync: SyncClient) {
  const events: SyncEvent[] = [];
  const controller = new AbortController();
  const done = sync
    .listen((e) => events.push(e), controller.signal)
    .catch((error: unknown) => {
      if (!(error instanceof Error && error.name === 'AbortError')) throw error;
    });
  return { events, stop: () => controller.abort(), done };
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe.skipIf(!SERVER)('sync server interop', () => {
  let laptop: SyncClient;
  let phone: SyncClient;
  const store = new MemoryStore();
  let vault: Vault;

  beforeAll(() => {
    laptop = client();
    phone = client();
  });

  afterAll(() => {
    expect(problems).toEqual([]);
    const all = routes.map((r) => r.op.operationId);
    expect(all.filter((id) => !exercised.has(id))).toEqual([]);
  });

  it('reports the server and its fingerprint', async () => {
    const health = await specFetch(`${SERVER}/health`);
    expect(await health.json()).toEqual({ status: 'ok' });
    const info = await laptop.serverInfo();
    expect(info.fingerprint).toMatch(/^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/);
  });

  it('uploads a vault made on this device', async () => {
    ({ vault } = await Vault.create(store, password, { iterations }));
    await vault.add({
      type: 'login',
      title: 'GitHub',
      username: 'sam',
      password: 'hunter2',
      urls: ['https://github.com'],
    });
    await vault.add({ type: 'note', title: 'Wi-Fi', notes: 'Network: home\nPassword: tr1cky' });

    await laptop.createAccount(email, password, vault.header);
    await expect(laptop.createAccount(email, password, vault.header)).rejects.toMatchObject({
      status: 409,
    });
    const header = await laptop.login(email, password, { name: 'Laptop', kind: 'web' });
    expect(header).toEqual(vault.header);

    for (const record of store.rawRecords()) {
      const result = await laptop.putItem(record.id, {
        expectedRevision: 0,
        deleted: false,
        data: record.data as string,
      });
      expect(result.ok).toBe(true);
    }
  });

  it('never lets the server see the password or plaintext', async () => {
    const prelogin = await laptop.prelogin(email);
    expect(prelogin).toEqual(vault.header.kdf);
    // A different password gets a clear refusal; an unknown email looks the same as a known one.
    await expect(
      phone.login(email, 'wrong password', { name: 'Phone', kind: 'extension' }),
    ).rejects.toMatchObject({
      status: 401,
    });
    const unknown = await phone.prelogin(`nobody-${Date.now()}@example.com`);
    expect(unknown.alg).toBe('pbkdf2-sha256');
    expect(unknown.salt).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('a second device signs in, unlocks and decrypts the same items', async () => {
    const header = await phone.login(email, password, { name: 'Phone', kind: 'extension' });
    const { vaultKey } = await unlockVault(password, header);
    const { revision, items } = await phone.changes();
    expect(revision).toBe(2);
    const titles = await Promise.all(
      items.map(
        async (item) => (await decryptItem<ItemData>(vaultKey, item.id, item.data as string)).title,
      ),
    );
    expect(titles.sort()).toEqual(['GitHub', 'Wi-Fi']);
  });

  it('a write on one device reaches the other, and stale writes conflict', async () => {
    const stream = listen(laptop);
    await until(() => stream.events.length > 0);
    expect(stream.events[0]).toEqual({ type: 'vault-changed', revision: 2 });

    const { vaultKey } = await unlockVault(password, vault.header);
    const github = vault.list().find((i) => i.data.title === 'GitHub');
    if (!github) throw new Error('missing item');
    const edited = { ...github.data, password: 'n3w-and-better' };
    const write = await phone.putItem(github.id, {
      expectedRevision:
        (await phone.changes()).items.find((i) => i.id === github.id)?.revision ?? 0,
      deleted: false,
      data: await encryptItem(vaultKey, github.id, edited),
    });
    expect(write.ok).toBe(true);
    await until(() => stream.events.some((e) => e.type === 'vault-changed' && e.revision === 3));

    const changed = await laptop.changes(2);
    expect(changed.items.map((i) => i.id)).toEqual([github.id]);
    expect(
      (
        await decryptItem<{ password: string }>(
          vaultKey,
          github.id,
          changed.items[0]?.data as string,
        )
      ).password,
    ).toBe('n3w-and-better');

    // The laptop still thinks the item is at its first revision.
    const stale = await laptop.putItem(github.id, {
      expectedRevision: 1,
      deleted: false,
      data: await encryptItem(vaultKey, github.id, github.data),
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.current.revision).toBe(3);
    stream.stop();
    await stream.done;
  });

  it("a server can't move one item's ciphertext onto another", async () => {
    const { vaultKey } = await unlockVault(password, vault.header);
    const { items } = await phone.changes();
    const [first] = items;
    const intruder = randomId();
    await phone.putItem(intruder, {
      expectedRevision: 0,
      deleted: false,
      data: first?.data as string,
    });
    const moved = (await phone.changes()).items.find((i) => i.id === intruder);
    await expect(decryptItem(vaultKey, intruder, moved?.data as string)).rejects.toBeInstanceOf(
      DecryptionError,
    );
    await phone.putItem(intruder, { expectedRevision: moved?.revision ?? 0, deleted: true });
    const tombstone = (await phone.changes()).items.find((i) => i.id === intruder);
    expect(tombstone).toMatchObject({ deleted: true });
    expect(tombstone).not.toHaveProperty('data');
  });

  it('lists devices and signs one out remotely', async () => {
    const tablet = client();
    await tablet.login(email, password, { name: 'Tablet', kind: 'web' });
    const stream = listen(tablet);
    await until(() => stream.events.length > 0);

    const devices = await laptop.devices();
    expect(devices.map((d) => d.name).sort()).toEqual(['Laptop', 'Phone', 'Tablet']);
    const target = devices.find((d) => d.name === 'Tablet');
    await laptop.signOutDevice(target?.id as string);

    await until(() => stream.events.some((e) => e.type === 'session-ended'));
    await stream.done;
    expect(tablet.signedIn).toBe(false);
    await expect(tablet.changes()).rejects.toBeInstanceOf(SyncError);
  });

  it('a master password change re-wraps the key and signs out the other devices', async () => {
    const changed = await changePassword(
      password,
      'a much better passphrase',
      vault.header,
      iterations,
    );
    await laptop.changeMasterPassword(
      password,
      vault.header.kdf,
      toBase64Url(changed.authKey),
      changed.header,
    );

    await expect(phone.changes()).rejects.toMatchObject({ status: 401 });
    expect(phone.signedIn).toBe(false);
    expect((await laptop.changes()).revision).toBeGreaterThan(0);

    await expect(
      phone.login(email, password, { name: 'Phone', kind: 'extension' }),
    ).rejects.toMatchObject({
      status: 401,
    });
    const header = await phone.login(email, 'a much better passphrase', {
      name: 'Phone',
      kind: 'extension',
    });
    expect(header.fingerprint).toBe(vault.header.fingerprint);
    // Same vault key: items written before the change still decrypt.
    const { vaultKey } = await unlockVault('a much better passphrase', header);
    const { items } = await phone.changes();
    const live = items.filter((i) => !i.deleted);
    for (const item of live)
      await expect(decryptItem(vaultKey, item.id, item.data as string)).resolves.toBeTruthy();
    password_ = 'a much better passphrase';
  });

  it('tokens refresh, and logging out ends only this device', async () => {
    const tokens: unknown[] = [];
    let skew = 0;
    const watch = new SyncClient({
      server: SERVER as string,
      fetch: specFetch,
      onTokens: (t) => void tokens.push(t),
      now: () => Date.now() + skew,
    });
    await watch.login(email, password_, { name: 'Watch', kind: 'cli' });
    // Sixteen minutes later the access token has expired, so the client refreshes first.
    skew = 16 * 60_000;
    await watch.changes();
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    await watch.logout();
    expect(watch.signedIn).toBe(false);
    expect((await phone.changes()).revision).toBeGreaterThan(0);
  });

  it('deletes the account and everything in it', async () => {
    await expect(laptop.deleteAccount('wrong password', vault.header.kdf)).rejects.toMatchObject({
      status: 403,
    });
    const header = await phone.login(email, password_, { name: 'Phone', kind: 'extension' });
    await phone.deleteAccount(password_, header.kdf);
    await expect(laptop.changes()).rejects.toMatchObject({ status: 401 });
    await expect(
      laptop.login(email, password_, { name: 'Laptop', kind: 'web' }),
    ).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe.skipIf(!SERVER)('sync engine against the server', () => {
  it('two devices stay in step live, conflicts keep both versions', async () => {
    const email2 = `engine-${toBase64Url(crypto.getRandomValues(new Uint8Array(6))).toLowerCase()}@example.com`;
    const { server, info } = await checkServer(SERVER as string, specFetch);

    // Device A has a vault and makes the account from it.
    const storeA = new MemoryStore();
    const { vault: a } = await Vault.create(storeA, password, { iterations });
    const item = await a.add({ type: 'login', title: 'Bank', password: 'one' });
    const connect = {
      server,
      serverFingerprint: info.fingerprint,
      email: email2,
      password,
      fetch: specFetch,
    };
    const settingsA = await createSyncAccount(a, {
      ...connect,
      device: { name: 'A', kind: 'web' },
    });

    // Device B signs in with nothing on it.
    const { settings: settingsB, header } = await signInToSync({
      ...connect,
      device: { name: 'B', kind: 'extension' },
    });
    const storeB = new MemoryStore();
    await storeB.saveHeader(header);
    const b = await Vault.unlock(storeB, password);

    const engine = (vault: Vault, settings: SyncSettings) =>
      new SyncEngine({ vault, settings, saveSettings: () => undefined, fetch: specFetch });
    const engineA = engine(a, settingsA);
    const engineB = engine(b, settingsB);
    engineA.start();
    engineB.start();
    try {
      await until(() => b.get(item.id)?.data.title === 'Bank');

      // A change on B arrives on A without anyone asking.
      await b.update(item.id, { password: 'two' });
      await until(() => (a.get(item.id)?.data as { password?: string }).password === 'two');

      // Both change it while B's stream is down: both versions survive.
      engineB.stop();
      await a.update(item.id, { password: 'from-a' });
      await until(() => engineA.status.pending === 0 && engineA.status.state === 'idle');
      await b.update(item.id, { password: 'from-b' });
      await engineB.syncNow();
      expect(
        b
          .list()
          .map((i) => i.data.title)
          .sort(),
      ).toEqual(['Bank', 'Bank (conflict)']);
      await until(() => a.list().length === 2);
    } finally {
      engineA.stop();
      engineB.stop();
    }
  });
});
