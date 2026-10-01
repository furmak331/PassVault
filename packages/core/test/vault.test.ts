import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  MAX_PASSWORD_HISTORY,
  MemoryStore,
  Vault,
  VaultLockedError,
  hostOf,
  type LoginItem,
} from '../src';

const FAST = { iterations: 1000 };

function clock(start = '2026-10-01T09:00:00.000Z') {
  let t = Date.parse(start);
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

async function newVault(password = 'master password', c = clock()) {
  const store = new MemoryStore();
  const { vault } = await Vault.create(store, password, { ...FAST, now: c.now });
  return { store, vault, clock: c };
}

describe('Vault', () => {
  it('adds items with sensible defaults', async () => {
    const { vault } = await newVault();
    const item = await vault.add({
      type: 'login',
      title: '  GitHub ',
      username: 'furmak331',
      password: 'pw',
    });
    expect(item.revision).toBe(1);
    expect(item.data).toMatchObject({
      type: 'login',
      title: 'GitHub',
      username: 'furmak331',
      password: 'pw',
      urls: [],
      tags: [],
      favorite: false,
      trashedAt: null,
      passwordHistory: [],
    });
    expect(vault.list()).toHaveLength(1);
  });

  it('stores only ciphertext', async () => {
    const { vault, store } = await newVault();
    await vault.add({
      type: 'login',
      title: 'Secret Bank',
      username: 'me@example.com',
      password: 'hunter2',
    });
    const raw = JSON.stringify(store.rawRecords());
    for (const plaintext of ['Secret Bank', 'me@example.com', 'hunter2'])
      expect(raw).not.toContain(plaintext);
    expect(store.rawRecords()[0]?.data).toMatch(/^pvf1\./);
  });

  it('persists across lock and unlock', async () => {
    const { vault, store } = await newVault('pw-1');
    const a = await vault.add({ type: 'login', title: 'A', password: 'x' });
    await vault.add({ type: 'note', title: 'B', notes: 'wifi code 1234' });
    vault.lock();
    expect(() => vault.list()).toThrow(VaultLockedError);
    const reopened = await Vault.unlock(store, 'pw-1');
    expect(
      reopened
        .list()
        .map((i) => i.data.title)
        .sort(),
    ).toEqual(['A', 'B']);
    expect(reopened.get(a.id)?.revision).toBe(1);
  });

  it('rejects a wrong master password', async () => {
    const { store } = await newVault('right');
    await expect(Vault.unlock(store, 'wrong')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('refuses to create a second vault in the same store', async () => {
    const { store } = await newVault();
    await expect(Vault.create(store, 'again', FAST)).rejects.toThrow('already exists');
  });

  it('keeps password history newest first, capped', async () => {
    const { vault } = await newVault();
    const item = await vault.add({ type: 'login', title: 'Site', password: 'p0' });
    for (let i = 1; i <= MAX_PASSWORD_HISTORY + 2; i++)
      await vault.update(item.id, { password: `p${i}` });
    const data = vault.get(item.id)?.data as LoginItem;
    expect(data.password).toBe(`p${MAX_PASSWORD_HISTORY + 2}`);
    expect(data.passwordHistory).toHaveLength(MAX_PASSWORD_HISTORY);
    expect(data.passwordHistory[0]?.password).toBe(`p${MAX_PASSWORD_HISTORY + 1}`);
  });

  it('does not record history when the password is unchanged', async () => {
    const { vault } = await newVault();
    const item = await vault.add({ type: 'login', title: 'Site', password: 'same' });
    await vault.update(item.id, { password: 'same', title: 'Renamed' });
    expect((vault.get(item.id)?.data as LoginItem).passwordHistory).toEqual([]);
  });

  it('increments revisions on every write', async () => {
    const { vault } = await newVault();
    const item = await vault.add({ type: 'note', title: 'N' });
    await vault.update(item.id, { notes: 'x' });
    await vault.moveToTrash(item.id);
    await vault.restore(item.id);
    expect(vault.get(item.id)?.revision).toBe(4);
  });

  it('moves items to Trash and back', async () => {
    const { vault } = await newVault();
    const item = await vault.add({ type: 'note', title: 'N' });
    await vault.moveToTrash(item.id);
    expect(vault.list()).toHaveLength(0);
    expect(vault.trash().map((i) => i.id)).toEqual([item.id]);
    await vault.restore(item.id);
    expect(vault.list()).toHaveLength(1);
    expect(vault.trash()).toHaveLength(0);
  });

  it('purges with a tombstone', async () => {
    const { vault, store } = await newVault();
    const item = await vault.add({ type: 'note', title: 'N' });
    await vault.purge(item.id);
    expect(vault.get(item.id)).toBeUndefined();
    expect(store.rawRecords()).toEqual([
      { id: item.id, revision: 2, updatedAt: expect.any(String), deleted: true },
    ]);
  });

  it('purges Trash older than 30 days on unlock', async () => {
    const c = clock();
    const { vault, store } = await newVault('pw', c);
    const old = await vault.add({ type: 'note', title: 'old' });
    await vault.moveToTrash(old.id);
    c.advance(10 * 24 * 3600 * 1000);
    const recent = await vault.add({ type: 'note', title: 'recent' });
    await vault.moveToTrash(recent.id);
    c.advance(25 * 24 * 3600 * 1000); // old: 35 days in Trash, recent: 25
    const reopened = await Vault.unlock(store, 'pw', { now: c.now });
    expect(reopened.trash().map((i) => i.data.title)).toEqual(['recent']);
  });

  it('changes the master password without touching items', async () => {
    const { vault, store } = await newVault('old');
    await vault.add({ type: 'note', title: 'kept' });
    const before = store.rawRecords()[0]?.data;
    await vault.changePassword('old', 'new');
    expect(store.rawRecords()[0]?.data).toBe(before);
    await expect(Vault.unlock(store, 'old')).rejects.toBeInstanceOf(DecryptionError);
    expect((await Vault.unlock(store, 'new')).list()[0]?.data.title).toBe('kept');
  });

  it('collects normalized tags', async () => {
    const { vault } = await newVault();
    await vault.add({ type: 'note', title: 'a', tags: [' Work ', 'work', 'Home'] });
    await vault.add({ type: 'login', title: 'b', tags: ['finance'] });
    expect(vault.tags()).toEqual(['finance', 'home', 'work']);
  });
});

describe('hostOf', () => {
  it('reads hosts with or without a scheme', () => {
    expect(hostOf('https://github.com/login')).toBe('github.com');
    expect(hostOf('accounts.google.com')).toBe('accounts.google.com');
    expect(hostOf('')).toBeNull();
  });
});
