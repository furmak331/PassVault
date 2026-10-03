import { loadProfile } from './store';

/** Test builds use localhost, which their manifest already grants, so no prompt is needed. */
const ORIGINS =
  import.meta.env.MODE === 'e2e'
    ? ['http://localhost/*', 'http://127.0.0.1/*']
    : ['https://*/*', 'http://*/*'];

export const SITE_ACCESS: chrome.permissions.Permissions = { origins: ORIGINS };
const SCRIPT_ID = 'capture-logins';

export async function hasSiteAccess(): Promise<boolean> {
  return chrome.permissions.contains(SITE_ACCESS);
}

/**
 * The content script that suggests logins in sign-in fields and notices
 * submitted forms runs only once site access has been granted, and while at
 * least one of the two features is on. Without it, the extension can't see any
 * page at all.
 */
export async function syncCaptureScript(): Promise<boolean> {
  const { offerToSave, autofillMenu } = await loadProfile();
  const granted = await hasSiteAccess();
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  const want = granted && (offerToSave || autofillMenu);
  if (want && registered.length === 0) {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        js: ['content.js'],
        matches: ORIGINS,
        allFrames: true,
        runAt: 'document_idle',
      },
    ]);
    // Registered scripts start with the next page load; start in the tabs already open too.
    await startInOpenTabs();
  } else if (!want && registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
  return want;
}

async function startInOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ORIGINS });
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined || tab.discarded
        ? undefined
        : chrome.scripting
            .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] })
            .catch(() => undefined),
    ),
  );
}
