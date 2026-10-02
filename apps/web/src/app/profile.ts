export type ThemeSetting = 'system' | 'graphite' | 'porcelain';
export type Accent = 'signal' | 'cobalt' | 'jade' | 'mono';
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
  accent: 'signal',
  autoLockMinutes: 15,
  storageMode: 'local',
};

export const AUTO_LOCK_CHOICES = [1, 5, 15, 60, 0] as const;

export const ACCENTS: { value: Accent; label: string; swatch: string }[] = [
  { value: 'signal', label: 'Signal orange', swatch: '#ec4a0f' },
  { value: 'cobalt', label: 'Cobalt', swatch: '#2f55e8' },
  { value: 'jade', label: 'Jade', swatch: '#0b7f58' },
  { value: 'mono', label: 'Monochrome', swatch: '#151513' },
];

/** Fill in defaults and drop values from older versions (e.g. a retired accent). */
export function sanitizeProfile(saved: Partial<Profile>): Profile {
  const profile = { ...DEFAULT_PROFILE, ...saved };
  if (!ACCENTS.some((a) => a.value === profile.accent)) profile.accent = DEFAULT_PROFILE.accent;
  return profile;
}

export function defaultVaultName(name: string): string {
  const n = name.trim();
  return n ? `${n}'s Vault` : 'My Vault';
}

export function autoLockLabel(minutes: number): string {
  if (minutes === 0) return 'Never';
  return minutes === 1 ? '1 minute' : minutes === 60 ? '1 hour' : `${minutes} minutes`;
}
