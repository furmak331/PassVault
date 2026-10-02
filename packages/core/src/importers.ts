import { parseCsv } from './csv';
import { hostOf, normalizeTags, type ItemData, type NewItem } from './items';

export type ImportSource = 'chrome' | 'bitwarden' | 'firefox' | '1password' | 'csv';

export const SOURCE_LABELS: Record<ImportSource, string> = {
  chrome: 'Chrome, Edge or Brave',
  bitwarden: 'Bitwarden',
  firefox: 'Firefox',
  '1password': '1Password',
  csv: 'a CSV file',
};

export interface SkippedRow {
  /** 1-based line number in the file, counting the header as line 1. */
  line: number;
  reason: string;
}

export interface CsvImport {
  source: ImportSource;
  items: NewItem[];
  skipped: SkippedRow[];
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Column names each tool uses, lowercased. The first match wins. */
const COLUMNS = {
  title: ['name', 'title'],
  url: ['url', 'login_uri', 'website', 'uri'],
  username: ['username', 'login_username', 'login', 'email', 'user'],
  password: ['password', 'login_password'],
  notes: ['notes', 'note', 'extra', 'comments'],
  totp: ['login_totp', 'otpauth', 'totp'],
  tags: ['tags', 'folder', 'grouping'],
  favorite: ['favorite', 'fav'],
  type: ['type'],
  fields: ['fields'],
  archived: ['archived'],
} as const;

type Column = keyof typeof COLUMNS;

function detectSource(header: string[]): ImportSource {
  const has = (name: string) => header.includes(name);
  if (has('login_password') && has('type')) return 'bitwarden';
  if (has('formactionorigin') || (has('httprealm') && has('guid'))) return 'firefox';
  if (has('title') && has('password') && (has('otpauth') || has('archived'))) return '1password';
  if (has('name') && has('url') && has('username') && has('password')) return 'chrome';
  return 'csv';
}

const truthy = (value: string) => /^(1|true|yes)$/i.test(value.trim());

/** "www.github.com" → "github.com", a readable title for a login without one. */
function titleFromUrl(url: string): string {
  return hostOf(url)?.replace(/^www\./, '') ?? '';
}

/**
 * Turn an export from another password manager into vault items. Nothing is
 * written here: the caller shows a preview and decides.
 */
export function importCsv(text: string): CsvImport {
  const rows = parseCsv(text);
  const headerRow = rows[0];
  if (!headerRow) throw new ImportError('The file is empty.');
  const header = headerRow.map((h) => h.trim().toLowerCase());
  const index = {} as Record<Column, number>;
  for (const [column, names] of Object.entries(COLUMNS) as [Column, readonly string[]][]) {
    index[column] = names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  }
  if (index.password < 0 && index.notes < 0) {
    throw new ImportError(
      "This doesn't look like a password export: there's no password column. Export again as CSV from your browser or password manager.",
    );
  }

  const source = detectSource(header);
  const items: NewItem[] = [];
  const skipped: SkippedRow[] = [];

  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const get = (column: Column) => (index[column] >= 0 ? (row[index[column]] ?? '').trim() : '');
    const raw = (column: Column) => (index[column] >= 0 ? (row[index[column]] ?? '') : '');

    const type = get('type').toLowerCase();
    if (source === 'bitwarden' && (type === 'card' || type === 'identity')) {
      skipped.push({ line, reason: "Cards and identities aren't supported yet" });
      return;
    }

    const urls = get('url')
      .split(source === 'bitwarden' ? ',' : /\s+/)
      .map((u) => u.trim())
      .filter(Boolean);
    const extras = [
      raw('notes').trim(),
      get('fields') && `Custom fields:\n${raw('fields').trim()}`,
      get('totp') && `One-time code secret: ${get('totp')}`,
    ].filter(Boolean);
    const notes = extras.join('\n\n');
    const tags = get('tags')
      .split(source === 'bitwarden' ? /\// : /[,;]/)
      .map((t) => t.trim().replace(/\s+/g, '-'))
      .filter(Boolean);
    if (source === '1password' && truthy(get('archived'))) tags.push('archived');
    const favorite = truthy(get('favorite'));

    if (source === 'bitwarden' && type === 'note') {
      const title = get('title') || 'Untitled note';
      items.push({ type: 'note', title, notes, tags: normalizeTags(tags), favorite });
      return;
    }

    const username = get('username');
    const password = raw('password');
    if (!password && !username && urls.length === 0) {
      if (notes) {
        items.push({
          type: 'note',
          title: get('title') || 'Imported note',
          notes,
          tags: normalizeTags(tags),
          favorite,
        });
      } else {
        skipped.push({ line, reason: 'Empty row' });
      }
      return;
    }

    const title = get('title') || titleFromUrl(urls[0] ?? '') || username || 'Untitled login';
    items.push({
      type: 'login',
      title,
      username,
      password,
      urls,
      notes,
      tags: normalizeTags(tags),
      favorite,
    });
  });

  return { source, items, skipped };
}

/**
 * Two items count as the same if a person would call them duplicates: same
 * kind, same site, same username and same password (or, for notes, same title
 * and text). Used to skip what's already in the vault when importing.
 */
export function duplicateKey(item: NewItem | ItemData): string {
  if (item.type === 'note') {
    return ['note', item.title.trim().toLowerCase(), (item.notes ?? '').trim()].join('\u0000');
  }
  const host = (item.urls ?? []).map((u) => hostOf(u)?.replace(/^www\./, '') ?? u).sort()[0];
  return [
    'login',
    host ?? item.title.trim().toLowerCase(),
    (item.username ?? '').trim().toLowerCase(),
    item.password ?? '',
  ].join('\u0000');
}
