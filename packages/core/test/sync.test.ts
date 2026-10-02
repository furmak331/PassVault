import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  mergeItemsInto,
  SyncEngine,
  Vault,
  type ItemData,
  type PutResult,
  type SyncChanges,
  type SyncConflict,
  type SyncItemRecord,
  type SyncSettings,
  type SyncTransport,
} from '../src';

const PASSWORD = 'correct horse battery staple';
const FINGERPRINT = 'AAAA BBBB CCCC';

/** The sync server's rules, in memory: one revision per vault, 409 on a stale write. */
class FakeServer {
  revision = 0;
  readonly items = new Map<string, SyncItemRecord>();
  online = true;
  fingerprint = FINGERPRINT;

  transport(): SyncTransport {
    const offline = () => {
      if (!this.online) throw new TypeError('Failed to fetch');
    };
    return {
      signedIn: true,
      serverInfo: async () => {
        offline();
        return { version: 'test', fingerprint: this.fingerprint, registration: 'open' as const };
      },
      changes: async (since?: number): Promise<SyncChanges> => {
        offline();
        const from = since === undefined || since > this.revision ? 0 : since;
        return {
          revision: this.revision,
          items: [...this.items.values()]
            .filter((i) => i.revision > from)
            .sort((a, b) => a.revision - b.revision)
            .map((i) => ({ ...i })),
        };
      },
      putItem: async (id, write): Promise<PutResult> => {
        offline();
        const existing = this.items.get(id);
        if (existing && existing.revision !== write.expectedRevision) {
          return { ok: false, current: { ...existing } };
        }
        this.revision++;
        const item: SyncItemRecord = {
          id,
          revision: this.revision,
          updatedAt: new Date().toISOString(),
          deleted: write.deleted,
          ...(write.deleted ? {} : { data: write.data as string }),
        };
        this.items.set(id, item);
        return { ok: true, item: { ...item } };
      },
      listen: () => new Promise<void>(() => undefined),
    };
  }
}

const settings = (): SyncSettings => ({
  server: 'https://vault.test',
  email: 'sam@example.com',
  deviceName: 'Test',
  serverFingerprint: FINGERPRINT,
  lastRevision: 0,
  tokens: null,
});

/** Two devices holding the same vault, and a server between them. */
async function setup() {
  const server = new FakeServer();
  const storeA = new MemoryStore();
  const { vault: a } = await Vault.create(storeA, PASSWORD, { iterations: 1000 });
  const storeB = new MemoryStore();
  await storeB.saveHeader(a.header);
  const b = await Vault.unlock(storeB, PASSWORD);
  const device = (vault: Vault) => {
    const conflicts: SyncConflict[] = [];
    const engine = new SyncEngine({
      vault,
      settings: settings(),
      saveSettings: () => undefined,
      transport: server.transport(),
      onConflicts: (c) => conflicts.push(...c),
    });
    return { vault, engine, conflicts };
  };
  return { server, a: device(a), b: device(b), storeA, storeB };
}

const titles = (vault: Vault) =>
  vault
    .list()
    .map((i) => i.data.title)
    .sort();

describe('SyncEngine', () => {
  it('carries new items, edits and deletions between devices', async () => {
    const { a, b, server } = await setup();
    const github = await a.vault.add({ type: 'login', title: 'GitHub', username: 'sam' });
    await a.vault.add({ type: 'note', title: 'Wi-Fi' });
    await a.engine.syncNow();
    expect(a.vault.pendingChanges()).toHaveLength(0);
    // The server only ever holds ciphertext.
    expect(JSON.stringify([...server.items.values()])).not.toContain('GitHub');

    await b.engine.syncNow();
    expect(titles(b.vault)).toEqual(['GitHub', 'Wi-Fi']);

    await b.vault.update(github.id, { username: 'samuel' });
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(a.vault.get(github.id)?.data).toMatchObject({ username: 'samuel' });

    await a.vault.purge(github.id);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(titles(b.vault)).toEqual(['Wi-Fi']);
    expect(server.items.get(github.id)).toMatchObject({ deleted: true });
    expect(server.items.get(github.id)).not.toHaveProperty('data');
  });

  it('keeps both versions when two devices edit one item differently', async () => {
    const { a, b } = await setup();
    const item = await a.vault.add({ type: 'login', title: 'Bank', password: 'one' });
    await a.engine.syncNow();
    await b.engine.syncNow();

    await a.vault.update(item.id, { password: 'from-a' });
    await b.vault.update(item.id, { password: 'from-b' });
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();

    for (const vault of [a.vault, b.vault]) {
      expect(titles(vault)).toEqual(['Bank', 'Bank (conflict)']);
      const passwords = vault
        .list()
        .map((i) => (i.data as { password: string }).password)
        .sort();
      expect(passwords).toEqual(['from-a', 'from-b']);
      expect(vault.pendingChanges()).toHaveLength(0);
    }
    expect(b.conflicts).toEqual([{ id: item.id, title: 'Bank', copyId: expect.any(String) }]);
    expect(a.conflicts).toEqual([]);
    const copy = b.vault.list().find((i) => i.data.title === 'Bank (conflict)');
    expect(copy?.data.tags).toContain('conflict');
  });

  it("doesn't make a copy when both devices made the same change", async () => {
    const { a, b } = await setup();
    const item = await a.vault.add({ type: 'note', title: 'Same' });
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.vault.update(item.id, { favorite: true });
    await b.vault.update(item.id, { favorite: true });
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(titles(b.vault)).toEqual(['Same']);
    expect(b.vault.get(item.id)?.data.favorite).toBe(true);
    expect(b.conflicts).toEqual([]);
    expect(b.vault.pendingChanges()).toHaveLength(0);
  });

  it('an edit beats a deletion made elsewhere', async () => {
    const { a, b } = await setup();
    const item = await a.vault.add({ type: 'note', title: 'Keep me' });
    await a.engine.syncNow();
    await b.engine.syncNow();

    await a.vault.purge(item.id);
    await b.vault.update(item.id, { notes: 'still needed' });
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    for (const vault of [a.vault, b.vault]) {
      expect(vault.get(item.id)?.data).toMatchObject({ title: 'Keep me', notes: 'still needed' });
    }
  });

  it('a deletion here gives way to an edit there', async () => {
    const { a, b } = await setup();
    const item = await a.vault.add({ type: 'note', title: 'Edited' });
    await a.engine.syncNow();
    await b.engine.syncNow();

    await a.vault.update(item.id, { notes: 'new' });
    await a.engine.syncNow();
    await b.vault.purge(item.id);
    await b.engine.syncNow();
    expect(b.vault.get(item.id)?.data).toMatchObject({ notes: 'new' });
  });

  it('queues changes while offline and sends them when back', async () => {
    const { a, b, server } = await setup();
    server.online = false;
    await a.vault.add({ type: 'note', title: 'Written offline' });
    await a.engine.syncNow();
    expect(a.engine.status).toMatchObject({ state: 'offline', pending: 1 });

    server.online = true;
    await a.engine.syncNow();
    expect(a.engine.status).toMatchObject({ state: 'idle', pending: 0 });
    await b.engine.syncNow();
    expect(titles(b.vault)).toEqual(['Written offline']);
  });

  it('stops if the server fingerprint changes', async () => {
    const { a, server } = await setup();
    await a.vault.add({ type: 'note', title: 'Secret' });
    server.fingerprint = 'DEAD BEEF 0000';
    await a.engine.syncNow();
    expect(a.engine.status.state).toBe('error');
    expect(a.engine.status.message).toContain('DEAD BEEF 0000');
    expect(server.items.size).toBe(0);
  });

  it('ignores a record whose ciphertext was moved from another item', async () => {
    const { a, b, server } = await setup();
    const one = await a.vault.add({ type: 'note', title: 'One' });
    const two = await a.vault.add({ type: 'note', title: 'Two' });
    await a.engine.syncNow();
    await b.engine.syncNow();
    // A malicious server copies One's ciphertext over Two.
    server.revision++;
    server.items.set(two.id, {
      ...(server.items.get(one.id) as SyncItemRecord),
      id: two.id,
      revision: server.revision,
    });
    await b.engine.syncNow();
    expect(b.vault.get(two.id)?.data.title).toBe('Two');
    expect(b.engine.status.state).toBe('idle');
  });

  it('uploads everything again if the server lost data', async () => {
    const { a, server } = await setup();
    await a.vault.add({ type: 'note', title: 'One' });
    await a.vault.add({ type: 'note', title: 'Two' });
    await a.engine.syncNow();
    // The server is restored from an empty backup.
    server.items.clear();
    server.revision = 0;
    await a.vault.add({ type: 'note', title: 'Three' });
    await a.engine.syncNow();
    console.log(
      'DBG',
      a.engine.status,
      a.vault.pendingChanges().map((r) => [r.base, r.pending]),
      server.revision,
    );
    expect(server.items.size).toBe(3);
  });

  it('pushes again what changed while a push was in flight', async () => {
    const { a, server } = await setup();
    const item = await a.vault.add({ type: 'note', title: 'v1' });
    const transport = server.transport();
    const original = transport.putItem;
    let edited = false;
    transport.putItem = async (id, write) => {
      const result = await original(id, write);
      if (!edited) {
        edited = true;
        await a.vault.update(item.id, { title: 'v2' });
      }
      return result;
    };
    const engine = new SyncEngine({
      vault: a.vault,
      settings: settings(),
      saveSettings: () => undefined,
      transport,
    });
    await engine.syncNow();
    expect(a.vault.pendingChanges()).toHaveLength(0);
    expect(server.items.get(item.id)?.revision).toBe(2);
  });
});

describe('mergeItemsInto', () => {
  it('copies items across, skipping ones already there', async () => {
    const { vault } = await Vault.create(new MemoryStore(), PASSWORD, { iterations: 1000 });
    await vault.add({
      type: 'login',
      title: 'GitHub',
      username: 'sam',
      password: 'x',
      urls: ['https://github.com'],
    });
    const incoming: ItemData[] = [
      {
        type: 'login',
        title: 'GitHub',
        username: 'sam',
        password: 'x',
        urls: ['https://github.com'],
        notes: '',
        tags: [],
        favorite: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        trashedAt: null,
        passwordHistory: [],
      },
      {
        type: 'note',
        title: 'New',
        notes: 'hello',
        tags: [],
        favorite: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        trashedAt: null,
      },
    ];
    expect(await mergeItemsInto(vault, incoming)).toBe(1);
    expect(titles(vault)).toEqual(['GitHub', 'New']);
  });
});
