import { fingerprintRings } from '@passvaultify/core';
import { useEffect, useState } from 'react';
import type { ExtensionProfile } from './store';

/** Apply the profile's theme and accent to <body>, following the OS for "system". */
export function useBodyTheme(profile: ExtensionProfile | null): void {
  useEffect(() => {
    if (!profile) return;
    const media = matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const theme =
        profile.theme === 'system' ? (media.matches ? 'porcelain' : 'graphite') : profile.theme;
      document.body.dataset.theme = theme;
      document.body.dataset.accent = profile.accent;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [profile]);
}

/** The fingerprint ring pattern for a vault's code. */
export function useRings(code: string | undefined): Uint8Array | null {
  const [rings, setRings] = useState<{ code: string; bytes: Uint8Array } | null>(null);
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    void fingerprintRings(code).then((bytes) => {
      if (!cancelled) setRings({ code, bytes });
    });
    return () => {
      cancelled = true;
    };
  }, [code]);
  return rings && rings.code === code ? rings.bytes : null;
}

/** The dial wordmark, same as the web vault's. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <svg className="brand__mark" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="13.4" r="8.6" />
        <circle cx="12" cy="13.4" r="3.6" />
        <path d="M9.3 1.2h5.4L12 4.4z" className="brand__index" />
      </svg>
      {!compact && <span className="brand__name">PassVaultify</span>}
    </span>
  );
}

/** "github.com" for a URL, without "www.". */
export function hostLabel(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export const isWebPage = (url: string | undefined) => !!url && /^https?:\/\//i.test(url);
