import type { FrameInfo } from './messages';

/**
 * Tokens for in-page UI. A content script registers a random token for its
 * frame; the background records the tab, frame and address Chrome reports for
 * it (never what the page says). The in-page extension frames (menu, save bar)
 * carry only the token, and act on what it resolves to. A page that copies the
 * token gets nothing: it resolves to the frame that registered it.
 *
 * Kept in chrome.storage.session, since Chrome stops the background worker
 * whenever it's idle.
 */
const PREFIX = 'frame:';
const MAX_AGE_MS = 12 * 60 * 60_000;

interface Entry extends FrameInfo {
  at: number;
}

export async function registerFrame(token: string, info: FrameInfo): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(token)) return;
  await chrome.storage.session.set({
    [PREFIX + token]: { ...info, at: Date.now() } satisfies Entry,
  });
}

export async function resolveFrame(token: string): Promise<FrameInfo | null> {
  const got = await chrome.storage.session.get(PREFIX + token);
  const entry = got[PREFIX + token] as Entry | undefined;
  if (!entry || Date.now() - entry.at > MAX_AGE_MS) return null;
  return {
    tabId: entry.tabId,
    frameId: entry.frameId,
    documentId: entry.documentId,
    url: entry.url,
  };
}

/** Drop a closed tab's tokens. */
export async function forgetTab(tabId: number): Promise<void> {
  const all = await chrome.storage.session.get(null);
  const stale = Object.entries(all)
    .filter(([key, value]) => key.startsWith(PREFIX) && (value as Entry).tabId === tabId)
    .map(([key]) => key);
  if (stale.length) await chrome.storage.session.remove(stale);
}
