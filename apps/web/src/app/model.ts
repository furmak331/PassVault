import { hostOf, type ItemData, type VaultItem } from '@passvaultify/core';

export type Filter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'type'; type: ItemData['type'] }
  | { kind: 'tag'; tag: string }
  | { kind: 'trash' };

export function filterLabel(filter: Filter): string {
  switch (filter.kind) {
    case 'all':
      return 'All items';
    case 'favorites':
      return 'Favorites';
    case 'type':
      return filter.type === 'login' ? 'Logins' : 'Secure notes';
    case 'tag':
      return `#${filter.tag}`;
    case 'trash':
      return 'Trash';
  }
}

export function sameFilter(a: Filter, b: Filter): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function matchesFilter(item: VaultItem, filter: Filter): boolean {
  const d = item.data;
  switch (filter.kind) {
    case 'all':
    case 'trash':
      return true;
    case 'favorites':
      return d.favorite;
    case 'type':
      return d.type === filter.type;
    case 'tag':
      return d.tags.includes(filter.tag);
  }
}

/** Case-insensitive match on title, username, websites and tags. Every word must match. */
export function matchesQuery(item: VaultItem, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const d = item.data;
  const haystack = [d.title, ...d.tags.map((t) => `#${t}`)];
  if (d.type === 'login')
    haystack.push(d.username, ...d.urls, ...d.urls.map((u) => hostOf(u) ?? ''));
  const text = haystack.join('\n').toLowerCase();
  return words.every((w) => text.includes(w));
}

export function byTitle(a: VaultItem, b: VaultItem): number {
  return a.data.title.localeCompare(b.data.title, undefined, { sensitivity: 'base' });
}

/** The line under an item's title in the list. */
export function subtitle(item: VaultItem): string {
  const d = item.data;
  if (d.type === 'login') return d.username || (d.urls[0] && hostOf(d.urls[0])) || 'Login';
  const firstLine = d.notes.split('\n').find((l) => l.trim());
  return firstLine ? 'Secure note' : 'Empty note';
}

/** Color seed for an item's avatar: its site when it has one, so all GitHub logins match. */
export function avatarSeed(item: VaultItem): string {
  const d = item.data;
  return (d.type === 'login' && d.urls[0] && hostOf(d.urls[0])) || d.title;
}

/** Titles of the other logins that share each password. */
export function reuseIndex(items: VaultItem[]): Map<string, VaultItem[]> {
  const index = new Map<string, VaultItem[]>();
  for (const item of items) {
    if (item.data.type !== 'login' || !item.data.password) continue;
    const list = index.get(item.data.password) ?? [];
    list.push(item);
    index.set(item.data.password, list);
  }
  return index;
}

export const SHORT_PASSWORD = 10;
