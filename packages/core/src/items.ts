/**
 * Vault item types. Everything here is encrypted as a whole: the server and
 * the local store only ever see the envelope, never these fields.
 */

export interface PasswordChange {
  password: string;
  /** ISO 8601 time the password was replaced. */
  changedAt: string;
}

interface ItemBase {
  title: string;
  notes: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  /** Set while the item is in Trash. Items are purged 30 days after this. */
  trashedAt: string | null;
}

export interface LoginItem extends ItemBase {
  type: 'login';
  username: string;
  password: string;
  urls: string[];
  /** Earlier passwords, newest first. */
  passwordHistory: PasswordChange[];
}

export interface NoteItem extends ItemBase {
  type: 'note';
}

export type ItemData = LoginItem | NoteItem;
export type ItemType = ItemData['type'];

/** What callers provide when creating an item; everything else has defaults. */
export type NewItem =
  | ({ type: 'login'; title: string } & Partial<
      Pick<LoginItem, 'username' | 'password' | 'urls' | 'notes' | 'tags' | 'favorite'>
    >)
  | ({ type: 'note'; title: string } & Partial<Pick<NoteItem, 'notes' | 'tags' | 'favorite'>>);

/** Editable fields. `type`, timestamps and history are managed by the vault. */
export type ItemPatch = Partial<
  Pick<LoginItem, 'title' | 'username' | 'password' | 'urls' | 'notes' | 'tags' | 'favorite'>
>;

export const MAX_PASSWORD_HISTORY = 10;

export function normalizeItem(input: NewItem, now: string): ItemData {
  const base = {
    title: input.title.trim(),
    notes: input.notes ?? '',
    tags: normalizeTags(input.tags ?? []),
    favorite: input.favorite ?? false,
    createdAt: now,
    trashedAt: null,
  };
  if (input.type === 'note') return { type: 'note', ...base };
  return {
    type: 'login',
    ...base,
    username: input.username ?? '',
    password: input.password ?? '',
    urls: (input.urls ?? []).map((u) => u.trim()).filter(Boolean),
    passwordHistory: [],
  };
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const t of tags) {
    const tag = t.trim().toLowerCase();
    if (tag) seen.add(tag);
  }
  return [...seen].sort();
}

/**
 * Apply an edit. When a login's password changes, the old one moves into
 * history so it can be recovered if the site didn't accept the change.
 */
export function applyPatch(item: ItemData, patch: ItemPatch, now: string): ItemData {
  const next: ItemData = { ...item };
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags);
  if (patch.favorite !== undefined) next.favorite = patch.favorite;
  if (next.type === 'login' && item.type === 'login') {
    if (patch.username !== undefined) next.username = patch.username;
    if (patch.urls !== undefined) next.urls = patch.urls.map((u) => u.trim()).filter(Boolean);
    if (patch.password !== undefined && patch.password !== item.password) {
      next.password = patch.password;
      next.passwordHistory = item.password
        ? [{ password: item.password, changedAt: now }, ...item.passwordHistory].slice(
            0,
            MAX_PASSWORD_HISTORY,
          )
        : item.passwordHistory;
    }
  }
  return next;
}

/** Hostname of a URL, tolerant of entries typed without a scheme. */
export function hostOf(url: string): string | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname || null;
  } catch {
    return null;
  }
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isIsoDate = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));

/**
 * Rebuild an item that arrived from outside this vault (a backup, later a
 * sync peer) field by field, so only known fields with the right types get in.
 * Returns null when it isn't an item at all.
 */
export function sanitizeItem(input: unknown, now: string): ItemData | null {
  if (typeof input !== 'object' || input === null) return null;
  const v = input as Record<string, unknown>;
  if ((v.type !== 'login' && v.type !== 'note') || !isString(v.title)) return null;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter(isString) : []);
  const base = {
    title: v.title,
    notes: isString(v.notes) ? v.notes : '',
    tags: strings(v.tags),
    favorite: v.favorite === true,
  };
  const item = normalizeItem(
    v.type === 'note'
      ? { type: 'note', ...base }
      : {
          type: 'login',
          ...base,
          username: isString(v.username) ? v.username : '',
          password: isString(v.password) ? v.password : '',
          urls: strings(v.urls),
        },
    isIsoDate(v.createdAt) ? v.createdAt : now,
  );
  if (item.type === 'login' && Array.isArray(v.passwordHistory)) {
    item.passwordHistory = v.passwordHistory
      .filter(
        (h): h is PasswordChange =>
          typeof h === 'object' && h !== null && isString(h.password) && isIsoDate(h.changedAt),
      )
      .map((h) => ({ password: h.password, changedAt: h.changedAt }))
      .slice(0, MAX_PASSWORD_HISTORY);
  }
  return item;
}
