import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE, rememberedTheme, rememberTheme } from '../src/app/profile';

afterEach(() => vi.unstubAllGlobals());

describe('remembered theme', () => {
  it('round-trips through storage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    rememberTheme('porcelain');
    expect(rememberedTheme()).toBe('porcelain');
  });

  it('ignores junk and falls back when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'neon', setItem: () => undefined });
    expect(rememberedTheme()).toBe(DEFAULT_PROFILE.theme);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => rememberTheme('graphite')).not.toThrow();
    expect(rememberedTheme()).toBe(DEFAULT_PROFILE.theme);
  });
});
