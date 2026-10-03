/**
 * Logins captured from a page's sign-in form, waiting for the person to save
 * them. Held in chrome.storage.session (memory only, extension-private) for a
 * few minutes, then dropped.
 */
export interface PendingLogin {
  url: string;
  username: string;
  password: string;
  at: number;
  /** How many page loads the save bar has appeared on, so it doesn't follow the person around. */
  shown?: number;
}

const key = (tabId: number) => `pending:${tabId}`;
const identKey = (tabId: number) => `ident:${tabId}`;
const TTL_MS = 5 * 60_000;
const IDENT_TTL_MS = 10 * 60_000;

export async function setPending(tabId: number, login: PendingLogin): Promise<void> {
  await chrome.storage.session.set({ [key(tabId)]: login });
}

export async function getPending(tabId: number): Promise<PendingLogin | null> {
  const got = await chrome.storage.session.get(key(tabId));
  const login = got[key(tabId)] as PendingLogin | undefined;
  if (!login) return null;
  if (Date.now() - login.at > TTL_MS) {
    await clearPending(tabId);
    return null;
  }
  return login;
}

export async function clearPending(tabId: number): Promise<void> {
  await chrome.storage.session.remove(key(tabId));
  await chrome.action.setBadgeText({ tabId, text: '' });
}

/**
 * The first step of a two-step sign-in (the email or username), kept for the
 * tab so the password step that follows can be saved with it.
 */
export async function rememberIdentifier(tabId: number, username: string): Promise<void> {
  await chrome.storage.session.set({ [identKey(tabId)]: { username, at: Date.now() } });
}

export async function recallIdentifier(tabId: number): Promise<string> {
  const got = await chrome.storage.session.get(identKey(tabId));
  const ident = got[identKey(tabId)] as { username: string; at: number } | undefined;
  return ident && Date.now() - ident.at < IDENT_TTL_MS ? ident.username : '';
}

export async function forgetIdentifier(tabId: number): Promise<void> {
  await chrome.storage.session.remove(identKey(tabId));
}
