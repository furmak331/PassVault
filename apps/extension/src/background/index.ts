import { matchingLogins, type LoginItem } from '@passvaultify/core';
import { syncCaptureScript } from '../shared/capture';
import { fillLogin } from '../shared/fill';
import type { ExtensionMessage } from '../shared/messages';
import { clearPending, setPending } from '../shared/pending';
import { AUTO_LOCK_ALARM, isUnlocked, lock, openVault, touch } from '../shared/session';
import { runSync, scheduleSync, SYNC_ALARM } from '../shared/sync';

/**
 * The background worker. It holds no secrets of its own: the session key lives
 * in chrome.storage.session, and this worker only reacts to events.
 */

async function init() {
  // Explicit, though it's the default: content scripts can't read the session.
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await syncCaptureScript();
  await scheduleSync();
}
chrome.runtime.onInstalled.addListener(() => void init());
chrome.runtime.onStartup.addListener(() => void init());

// Auto-lock after the chosen idle time, and whenever the computer locks.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) void lock();
  // Periodic sync, only while unlocked: a locked vault has no key to decrypt with.
  if (alarm.name === SYNC_ALARM) {
    void isUnlocked().then(async (unlocked) => {
      if (unlocked) await runSync();
    });
  }
});
chrome.idle.onStateChanged.addListener((state) => {
  if (state === 'locked') void lock();
});

// Site access can be revoked from Chrome's own settings at any time.
chrome.permissions.onRemoved.addListener(() => void syncCaptureScript());

chrome.tabs.onRemoved.addListener((tabId) => void clearPending(tabId));

// Ctrl/Cmd+Shift+L: fill the one login that matches this site; otherwise open the popup.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'fill-login') return;
  void (async () => {
    const vault = await openVault();
    const url = tab?.url;
    if (!vault || tab?.id === undefined || !url) {
      await chrome.action.openPopup().catch(() => undefined);
      return;
    }
    const matches = matchingLogins(vault.list(), url);
    const only = matches.length === 1 ? matches[0]?.item.data : undefined;
    if (only?.type === 'login') {
      await fillLogin(tab.id, only as LoginItem);
      await touch();
    } else {
      await chrome.action.openPopup().catch(() => undefined);
    }
  })();
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, reply) => {
  // Only this extension's own content scripts and pages may talk to the worker.
  if (sender.id !== chrome.runtime.id) return false;
  if (message.type === 'sync-capture') {
    void syncCaptureScript().then(reply);
    return true;
  }
  if (message.type === 'sync-vault') {
    // Extension pages only (their URL is this extension's): content scripts
    // report the web page's URL, and have no business starting a sync.
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
    void scheduleSync()
      .then(runSync)
      .then(reply, () => reply(null));
    return true;
  }
  if (message.type === 'captured') {
    const tabId = sender.tab?.id;
    // The page's address comes from Chrome (sender.url), never from the page itself.
    const url = sender.url ?? sender.tab?.url;
    if (tabId === undefined || !url || !message.password) return false;
    void (async () => {
      await setPending(tabId, {
        url,
        username: message.username.slice(0, 500),
        password: message.password.slice(0, 1000),
        at: Date.now(),
      });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#ec4a0f' });
      await chrome.action.setBadgeText({ tabId, text: '+' });
    })();
  }
  return false;
});
