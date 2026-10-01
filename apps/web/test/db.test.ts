import 'fake-indexeddb/auto';
import { Vault } from '@passvaultify/core';
import { describe, expect, it } from 'vitest';
import { IdbStore } from '../src/app/db';
import { DEFAULT_PROFILE } from '../src/app/profile';

let n = 0;
const freshStore = () => new IdbStore(`test-${n++}`);

describe('IdbStore', () => {
  it('round-trips a vault through IndexedDB', async () => {
    const store = freshStore();
    const { vault } = await Vault.create(store, 'master pw', { iterations: 1000 });
    const item = await vault.add({ type: 'login', title: 'GitHub', password: 'hunter2' });
    await vault.moveToTrash(item.id);
    vault.lock();

    const reopened = await Vault.unlock(new IdbStore(`test-${n - 1}`), 'master pw');
    expect(reopened.trash().map((i) => i.data.title)).toEqual(['GitHub']);
  });

  it('stores only ciphertext', async () => {
    const store = freshStore();
    const { vault } = await Vault.create(store, 'master pw', { iterations: 1000 });
    await vault.add({ type: 'login', title: 'Secret Bank', password: 'hunter2' });
    const raw = JSON.stringify(await store.loadRecords());
    expect(raw).not.toContain('Secret Bank');
    expect(raw).not.toContain('hunter2');
  });

  it('saves the profile and fills in new defaults', async () => {
    const store = freshStore();
    expect(await store.loadProfile()).toBeNull();
    await store.saveProfile({ ...DEFAULT_PROFILE, name: 'Furqan', vaultName: "Furqan's Vault" });
    expect(await store.loadProfile()).toMatchObject({ name: 'Furqan', autoLockMinutes: 15 });
  });

  it('clears everything', async () => {
    const store = freshStore();
    await Vault.create(store, 'pw', { iterations: 1000 });
    await store.clear();
    expect(await store.loadHeader()).toBeNull();
    expect(await store.loadRecords()).toEqual([]);
  });
});
