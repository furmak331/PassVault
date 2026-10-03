import { matchingLogins, type LoginItem, type Vault } from '@passvaultify/core';
import { syncCaptureScript } from '../shared/capture';
import { fillLogin } from '../shared/fill';
import { forgetTab, registerFrame, resolveFrame } from '../shared/frames';
import { loginsFor, saveIntent, siteHost } from '../shared/logins';
import type { ContentMessage, ExtensionMessage, FieldCheck } from '../shared/messages';
import {
  clearPending,
  forgetIdentifier,
  getPending,
  recallIdentifier,
  rememberIdentifier,
  setPending,
} from '../shared/pending';
import { AUTO_LOCK_ALARM, hasVault, isUnlocked, lock, openVault, touch } from '../shared/session';
import { loadProfile } from '../shared/store';
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

// Site access can be granted from the popup (which closes as Chrome asks) or
// revoked from Chrome's own settings at any time.
chrome.permissions.onAdded.addListener(() => void syncCaptureScript());
chrome.permissions.onRemoved.addListener(() => void syncCaptureScript());

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearPending(tabId);
  void forgetIdentifier(tabId);
  void forgetTab(tabId);
});

/**
 * The open vault, kept between messages while the worker is awake, since a
 * field check comes with every focused login field. Dropped whenever the vault
 * or the session changes (a save elsewhere, a lock, a sync).
 */
let vaultCache: Promise<Vault | null> | null = null;
const currentVault = () => (vaultCache ??= openVault().catch(() => null));
chrome.storage.onChanged.addListener((changes, area) => {
  const keys = Object.keys(changes);
  if (
    (area === 'local' && keys.some((k) => k.startsWith('vault:'))) ||
    (area === 'session' && keys.includes('session'))
  ) {
    vaultCache = null;
  }
});

/** A content script on a web page (not an extension page, which also has a URL). */
function fromWebPage(sender: chrome.runtime.MessageSender) {
  return (
    sender.tab?.id !== undefined &&
    sender.frameId !== undefined &&
    /^https?:/.test(sender.url ?? '') &&
    !fromExtensionPage(sender)
  );
}

/**
 * One of this extension's own pages, including the menu and save bar framed
 * inside web pages. (Their address can use a per-session ID rather than the
 * extension's, so the scheme is what's checked; sender.id was checked first.)
 */
const fromExtensionPage = (sender: chrome.runtime.MessageSender) =>
  Boolean(sender.url?.startsWith('chrome-extension://'));

/** How long after a submit the save bar still appears on the next page, and on how many pages. */
const PROMPT_WINDOW_MS = 2 * 60_000;
const PROMPT_PAGES = 3;

async function fieldCheck(url: string): Promise<FieldCheck> {
  const profile = await loadProfile();
  if (!profile.autofillMenu || !(await hasVault()))
    return { menu: false, locked: true, matches: 0 };
  const vault = await currentVault();
  return { menu: true, locked: !vault, matches: vault ? loginsFor(vault, url).length : 0 };
}

/** A sign-in or sign-up form was submitted: offer to save or update it. */
async function captured(tabId: number, url: string, username: string, password: string) {
  const profile = await loadProfile();
  if (!profile.offerToSave || !(await hasVault())) return;
  if (profile.neverSave.includes(siteHost(url))) return;
  if (!password) {
    // The first step of a two-step sign-in: keep the username for the password step.
    if (username) await rememberIdentifier(tabId, username);
    return;
  }
  const user = username || (await recallIdentifier(tabId));
  const vault = await currentVault();
  // Already saved exactly like this (say, it was just filled): nothing to ask.
  if (vault && saveIntent(vault, url, user, password).kind === 'same') return;
  await setPending(tabId, { url, username: user, password, at: Date.now(), shown: 1 });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#ec4a0f' });
  await chrome.action.setBadgeText({ tabId, text: '+' });
  // The bar belongs to the whole page, so it's the top frame's to show.
  const show: ContentMessage = { type: 'show-save' };
  await chrome.tabs.sendMessage(tabId, show, { frameId: 0 }).catch(() => undefined);
}

/** On page load: show the save bar if a sign-in a moment ago left one waiting. */
async function promptCheck(tabId: number): Promise<{ show: boolean }> {
  const [pending, profile] = await Promise.all([getPending(tabId), loadProfile()]);
  if (
    !pending ||
    !profile.offerToSave ||
    Date.now() - pending.at > PROMPT_WINDOW_MS ||
    (pending.shown ?? 0) >= PROMPT_PAGES
  ) {
    return { show: false };
  }
  await setPending(tabId, { ...pending, shown: (pending.shown ?? 0) + 1 });
  return { show: true };
}

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
    if (!fromExtensionPage(sender)) return false;
    void scheduleSync()
      .then(runSync)
      .then(reply, () => reply(null));
    return true;
  }
  if (message.type === 'frame-resolve') {
    // Only the extension's own in-page frames learn where a token belongs.
    if (!fromExtensionPage(sender)) return false;
    void resolveFrame(message.token).then(reply, () => reply(null));
    return true;
  }

  // Everything below comes from content scripts. The page's address is always
  // the one Chrome reports (sender.url), never anything the page says.
  if (!fromWebPage(sender)) return false;
  const tabId = sender.tab?.id as number;
  const url = sender.url as string;
  if (message.type === 'frame-register') {
    if (!sender.documentId) return false;
    void registerFrame(message.token, {
      tabId,
      frameId: sender.frameId as number,
      documentId: sender.documentId,
      url,
    }).then(
      () => reply(true),
      () => reply(false),
    );
    return true;
  }
  if (message.type === 'field-check') {
    void fieldCheck(url).then(reply, () => reply(null));
    return true;
  }
  if (message.type === 'prompt-check') {
    // Top frames only: the bar is the page's, not an embedded frame's.
    if (sender.frameId !== 0) return false;
    void promptCheck(tabId).then(reply, () => reply({ show: false }));
    return true;
  }
  if (message.type === 'captured') {
    void captured(
      tabId,
      url,
      String(message.username).slice(0, 500),
      String(message.password).slice(0, 1000),
    );
  }
  return false;
});
