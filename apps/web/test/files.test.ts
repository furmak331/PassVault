import { describe, expect, it } from 'vitest';
import { backupFilename, looksLikeBackup } from '../src/app/files';
import { backupIsStale } from '../src/app/profile';

describe('import helpers', () => {
  it('tells a backup from a CSV by content, not by name', () => {
    expect(looksLikeBackup('  \n{"format":"passvaultify-backup"}')).toBe(true);
    expect(looksLikeBackup('name,url,username,password\n')).toBe(false);
  });

  it('names backups by date', () => {
    expect(backupFilename(new Date('2026-10-02T12:00:00Z'))).toBe(
      'passvaultify-backup-2026-10-02.json',
    );
  });
});

describe('backup reminder', () => {
  const now = Date.parse('2026-10-02T00:00:00Z');
  it('asks for a backup when there is none or it is over 30 days old', () => {
    expect(backupIsStale(null, now)).toBe(true);
    expect(backupIsStale('2026-08-01T00:00:00Z', now)).toBe(true);
    expect(backupIsStale('2026-09-20T00:00:00Z', now)).toBe(false);
  });
});
