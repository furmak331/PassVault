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
}

const key = (tabId: number) => `pending:${tabId}`;
const TTL_MS = 5 * 60_000;

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
