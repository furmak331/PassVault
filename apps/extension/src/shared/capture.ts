import { loadProfile, saveProfile } from './store';

/** Test builds use localhost, which their manifest already grants, so no prompt is needed. */
const ORIGINS =
  import.meta.env.MODE === 'e2e'
    ? ['http://localhost/*', 'http://127.0.0.1/*']
    : ['https://*/*', 'http://*/*'];

export const SITE_ACCESS: chrome.permissions.Permissions = { origins: ORIGINS };
const SCRIPT_ID = 'capture-logins';

/**
 * The content script that notices submitted sign-in forms runs only while
 * "Offer to save new logins" is on and site access has been granted. Without
 * both, the extension can't see any page at all.
 */
export async function syncCaptureScript(): Promise<boolean> {
  const { offerToSave } = await loadProfile();
  const granted = await chrome.permissions.contains(SITE_ACCESS);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  const want = offerToSave && granted;
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
  } else if (!want && registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
  if (offerToSave && !granted) await saveProfile({ offerToSave: false });
  return want;
}
