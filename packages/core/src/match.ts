import type { ItemData } from './items';
import type { VaultItem } from './vault';

/** How a saved website relates to the page about to be filled. */
export type MatchKind = 'exact' | 'subdomain';

/**
 * Hosts where unrelated people own the subdomains. A login saved for
 * "github.io" must never be offered on "attacker.github.io", so on these only
 * an exact host match counts. (A full public-suffix list would generalize this.)
 */
const SHARED_HOSTS = [
  'github.io',
  'gitlab.io',
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'workers.dev',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
  'azurewebsites.net',
  'cloudfront.net',
  'appspot.com',
  'blogspot.com',
  'glitch.me',
  'onrender.com',
  'fly.dev',
];

function parse(url: string): URL | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
}

const normalizeHost = (host: string) =>
  host
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');

/**
 * Should a login saved for `saved` be offered on `page`? Rules, strictest first:
 * only http(s) pages; never an http page for a login saved on https; an
 * explicit port must match; the host must be the same, or a subdomain of the
 * saved host (accounts.google.com for google.com) unless it's a shared host.
 * A look-alike domain (g00gle.com, google.com.evil.io) never matches.
 */
export function matchUrl(saved: string, page: string): MatchKind | null {
  const s = parse(saved);
  const p = parse(page);
  if (!s || !p) return null;
  if (p.protocol !== 'https:' && p.protocol !== 'http:') return null;
  if (s.protocol !== 'https:' && s.protocol !== 'http:') return null;
  if (s.protocol === 'https:' && p.protocol === 'http:') return null;
  if (s.port && s.port !== p.port) return null;
  const sh = normalizeHost(s.hostname);
  const ph = normalizeHost(p.hostname);
  if (!sh || !ph) return null;
  if (sh === ph) return 'exact';
  const shared = SHARED_HOSTS.some((h) => sh === h || sh.endsWith(`.${h}`));
  if (!shared && sh.includes('.') && ph.endsWith(`.${sh}`)) return 'subdomain';
  return null;
}

/** The best match among a login's saved websites. */
export function matchItem(item: ItemData, page: string): MatchKind | null {
  if (item.type !== 'login' || item.trashedAt) return null;
  let best: MatchKind | null = null;
  for (const url of item.urls) {
    const kind = matchUrl(url, page);
    if (kind === 'exact') return 'exact';
    best ??= kind;
  }
  return best;
}

/** Logins to offer on a page: exact host matches first, then by title. */
export function matchingLogins(
  items: VaultItem[],
  page: string,
): { item: VaultItem; kind: MatchKind }[] {
  return items
    .map((item) => ({ item, kind: matchItem(item.data, page) }))
    .filter((m): m is { item: VaultItem; kind: MatchKind } => m.kind !== null)
    .sort(
      (a, b) =>
        (a.kind === 'exact' ? 0 : 1) - (b.kind === 'exact' ? 0 : 1) ||
        a.item.data.title.localeCompare(b.item.data.title),
    );
}
