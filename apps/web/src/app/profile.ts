export type ThemeSetting = 'system' | 'graphite' | 'porcelain';
export type Accent = 'cobalt' | 'jade' | 'amber' | 'rose';
export type StorageMode = 'local' | 'self' | 'cloud';

/**
 * Personal settings. Not secret, so they're stored unencrypted next to the
 * vault and are available on the lock screen.
 */
export interface Profile {
  name: string;
  vaultName: string;
  theme: ThemeSetting;
  accent: Accent;
  /** Minutes without activity before the vault locks. 0 means never. */
  autoLockMinutes: number;
  storageMode: StorageMode;
}

export const DEFAULT_PROFILE: Profile = {
  name: '',
  vaultName: 'My Vault',
  theme: 'system',
  accent: 'cobalt',
  autoLockMinutes: 15,
  storageMode: 'local',
};

export const AUTO_LOCK_CHOICES = [1, 5, 15, 60, 0] as const;

export const ACCENTS: { value: Accent; label: string; swatch: string }[] = [
  { value: 'cobalt', label: 'Cobalt', swatch: '#6f8bff' },
  { value: 'jade', label: 'Jade', swatch: '#2fb38a' },
  { value: 'amber', label: 'Amber', swatch: '#e0a43a' },
  { value: 'rose', label: 'Rose', swatch: '#e86a8a' },
];

export function defaultVaultName(name: string): string {
  const n = name.trim();
  return n ? `${n}'s Vault` : 'My Vault';
}

export function autoLockLabel(minutes: number): string {
  if (minutes === 0) return 'Never';
  return minutes === 1 ? '1 minute' : minutes === 60 ? '1 hour' : `${minutes} minutes`;
}
