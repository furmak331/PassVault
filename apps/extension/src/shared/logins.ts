import {
  matchUrl,
  matchingLogins,
  type LoginItem,
  type Vault,
  type VaultItem,
} from '@passvaultify/core';

export type LoginEntry = VaultItem & { data: LoginItem };

/** Logins saved for a page, best match first. */
export function loginsFor(vault: Vault, url: string): LoginEntry[] {
  return matchingLogins(vault.list(), url).map((m) => m.item as LoginEntry);
}

/**
 * What saving a submitted login would mean: nothing (already saved exactly),
 * an update to a login with the same username on this site, or a new login.
 */
export function saveIntent(
  vault: Vault,
  url: string,
  username: string,
  password: string,
): { kind: 'same' } | { kind: 'update'; item: LoginEntry } | { kind: 'new' } {
  const sameSite = vault
    .list()
    .filter(
      (i): i is LoginEntry => i.data.type === 'login' && i.data.urls.some((u) => matchUrl(u, url)),
    );
  const existing =
    sameSite.find((i) => i.data.username.toLowerCase() === username.toLowerCase()) ??
    // A sign-in with no username field (password only) updates the site's only login.
    (!username && sameSite.length === 1 ? sameSite[0] : undefined);
  if (existing?.data.password === password) return { kind: 'same' };
  if (existing) return { kind: 'update', item: existing };
  return { kind: 'new' };
}

/** The site's host, without "www.", for titles and the never-save list. */
export function siteHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
