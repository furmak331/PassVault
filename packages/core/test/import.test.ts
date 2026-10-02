import { describe, expect, it } from 'vitest';
import {
  BackupError,
  createBackup,
  CsvError,
  DecryptionError,
  duplicateKey,
  ImportError,
  importCsv,
  MemoryStore,
  openBackup,
  parseBackup,
  parseCsv,
  restoreBackup,
  serializeBackup,
  Vault,
  type LoginItem,
} from '../src';

const FAST = { iterations: 1000 };

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, newlines in fields, CRLF and a BOM', () => {
    const text = '﻿name,note\r\n"Bank, main","line one\nline ""two"""\r\nplain,\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Bank, main', 'line one\nline "two"'],
      ['plain', ''],
    ]);
  });

  it('keeps a last row without a trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('rejects a file that ends inside quotes', () => {
    expect(() => parseCsv('a,b\n"unterminated,2')).toThrow(CsvError);
  });
});

describe('importCsv', () => {
  it('reads a Chrome export', () => {
    const csv =
      'name,url,username,password,note\n' +
      'github.com,https://github.com/login,alex,hunter2,\n' +
      ',https://www.netflix.com/,alex@mail.test,p@ss,shared with family\n';
    const result = importCsv(csv);
    expect(result.source).toBe('chrome');
    expect(result.items).toHaveLength(2);
    const [github, netflix] = result.items as LoginItem[];
    expect(github).toMatchObject({ type: 'login', title: 'github.com', username: 'alex' });
    expect(github?.urls).toEqual(['https://github.com/login']);
    expect(netflix?.title).toBe('netflix.com');
    expect(netflix?.notes).toBe('shared with family');
  });

  it('reads a Bitwarden export, including notes, folders, favorites and TOTP', () => {
    const csv =
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n' +
      'Work/Dev,1,login,GitHub,,"PIN: 1234",0,"https://github.com,https://gist.github.com",alex,s3cret,JBSWY3DP\n' +
      ',,note,Wi-Fi,Password: lantern,,0,,,,\n' +
      ',,card,Visa,,,0,,,,\n';
    const result = importCsv(csv);
    expect(result.source).toBe('bitwarden');
    expect(result.items).toHaveLength(2);
    expect(result.skipped).toEqual([
      { line: 4, reason: "Cards and identities aren't supported yet" },
    ]);
    const [login, note] = result.items;
    expect(login).toMatchObject({ type: 'login', title: 'GitHub', favorite: true });
    expect((login as LoginItem).urls).toEqual(['https://github.com', 'https://gist.github.com']);
    expect(login?.tags).toEqual(['dev', 'work']);
    expect(login?.notes).toContain('PIN: 1234');
    expect(login?.notes).toContain('JBSWY3DP');
    expect(note).toMatchObject({ type: 'note', title: 'Wi-Fi', notes: 'Password: lantern' });
  });

  it('reads a Firefox export and titles items by site', () => {
    const csv =
      '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n' +
      '"https://accounts.example.com","sam","pw1",,"https://accounts.example.com","{abc}","1","2","3"\n';
    const result = importCsv(csv);
    expect(result.source).toBe('firefox');
    expect(result.items[0]).toMatchObject({ title: 'accounts.example.com', username: 'sam' });
  });

  it('reads a 1Password export with tags and archived items', () => {
    const csv =
      'Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\n' +
      'Bank,https://bank.test,me,pw,,true,true,"finance; money",hello\n';
    const result = importCsv(csv);
    expect(result.source).toBe('1password');
    expect(result.items[0]).toMatchObject({ title: 'Bank', favorite: true });
    expect(result.items[0]?.tags).toEqual(['archived', 'finance', 'money']);
  });

  it('skips empty rows and explains why', () => {
    const result = importCsv('name,url,username,password\n,,,\nx,https://x.test,u,p\n');
    expect(result.items).toHaveLength(1);
    expect(result.skipped).toEqual([{ line: 2, reason: 'Empty row' }]);
  });

  it('refuses files that are not password exports', () => {
    expect(() => importCsv('')).toThrow(ImportError);
    expect(() => importCsv('date,amount\n2024-01-01,12\n')).toThrow(ImportError);
  });

  it('treats the same site, username and password as a duplicate', () => {
    const a = importCsv('name,url,username,password\nA,https://www.github.com/login,Alex,pw\n')
      .items[0];
    const b = importCsv('name,url,username,password\nB,https://github.com,alex,pw\n').items[0];
    const c = importCsv('name,url,username,password\nB,https://github.com,alex,other\n').items[0];
    expect(a && b && duplicateKey(a)).toBe(b && duplicateKey(b));
    expect(a && c && duplicateKey(a)).not.toBe(c && duplicateKey(c));
  });
});

describe('backups', () => {
  async function vaultWithItems() {
    const store = new MemoryStore();
    const { vault } = await Vault.create(store, 'master pw', FAST);
    const kept = await vault.add({
      type: 'login',
      title: 'GitHub',
      password: 'old',
      favorite: true,
    });
    await vault.update(kept.id, { password: 'new' });
    const gone = await vault.add({ type: 'note', title: 'Purged' });
    await vault.purge(gone.id);
    return { store, vault };
  }

  it('round-trips through a file and opens with the master password', async () => {
    const { store } = await vaultWithItems();
    const text = serializeBackup(await createBackup(store, { vaultName: 'Home' }));
    expect(text).not.toContain('GitHub');
    const backup = parseBackup(text);
    expect(backup.vaultName).toBe('Home');
    expect(backup.records).toHaveLength(1); // tombstones are left out
    const items = await openBackup(backup, 'master pw');
    expect(items[0]?.data).toMatchObject({ title: 'GitHub', password: 'new', favorite: true });

    const target = new MemoryStore();
    await restoreBackup(target, backup);
    const restored = await Vault.unlock(target, 'master pw');
    expect(restored.list().map((i) => i.data.title)).toEqual(['GitHub']);
  });

  it('rejects a wrong password and a tampered item before writing anything', async () => {
    const { store } = await vaultWithItems();
    const backup = parseBackup(serializeBackup(await createBackup(store)));
    await expect(openBackup(backup, 'wrong')).rejects.toThrow(DecryptionError);
    const record = backup.records[0];
    if (!record?.data) throw new Error('missing record');
    const flipped = record.data.slice(0, -2) + (record.data.endsWith('A') ? 'BA' : 'AA');
    const tampered = { ...backup, records: [{ ...record, data: flipped }] };
    await expect(openBackup(tampered, 'master pw')).rejects.toThrow();
  });

  it('validates the file strictly', async () => {
    const { store } = await vaultWithItems();
    const good = JSON.parse(serializeBackup(await createBackup(store))) as Record<string, unknown>;
    const bad = (patch: Record<string, unknown>) => JSON.stringify({ ...good, ...patch });
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup(bad({ format: 'something-else' }))).toThrow(/isn't a PassVaultify/);
    expect(() => parseBackup(bad({ version: 2 }))).toThrow(/newer version/);
    const header = good.header as { kdf: Record<string, unknown> };
    // A huge iteration count would freeze the tab while "unlocking".
    expect(() =>
      parseBackup(bad({ header: { ...header, kdf: { ...header.kdf, iterations: 2 ** 31 } } })),
    ).toThrow(/header/);
    expect(() => parseBackup(bad({ records: [{ id: '../x', revision: 1 }] }))).toThrow(/items/);
  });

  it('merges a backup into another vault with history kept and fresh IDs', async () => {
    const { store } = await vaultWithItems();
    const items = await openBackup(
      parseBackup(serializeBackup(await createBackup(store))),
      'master pw',
    );
    const { vault: other } = await Vault.create(new MemoryStore(), 'other pw', FAST);
    const imported = await other.importItem(items[0]?.data);
    expect(imported.id).not.toBe(items[0]?.id);
    expect(imported.data).toMatchObject({ title: 'GitHub', favorite: true, trashedAt: null });
    expect((imported.data as LoginItem).passwordHistory[0]?.password).toBe('old');
    await expect(other.importItem({ type: 'card' })).rejects.toThrow();
  });

  it('drops unknown fields from imported items', async () => {
    const { vault } = await Vault.create(new MemoryStore(), 'pw', FAST);
    const item = await vault.importItem({
      type: 'login',
      title: 'X',
      password: 'p',
      urls: ['https://x.test', 42],
      evil: '<script>',
      createdAt: 'not a date',
    });
    expect(item.data).not.toHaveProperty('evil');
    expect((item.data as LoginItem).urls).toEqual(['https://x.test']);
    expect(Date.parse(item.data.createdAt)).not.toBeNaN();
  });
});
