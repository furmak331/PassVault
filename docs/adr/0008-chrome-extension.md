# 0008: The Chrome extension holds its own vault and asks for almost nothing

**Status:** Accepted, 2026-10-02

## Context

The extension is where a password manager meets hostile pages. It has to fill
logins without being tricked into filling the wrong site, keep the vault key
somewhere pages can't reach, and survive Manifest V3, where the background
service worker is stopped whenever it's idle. Until sync exists (P4), it also
has no server to share a vault with the web app.

## Decision

- **Its own local vault, in the same pvf1 format.** `ChromeStore` keeps the
  header and records in `chrome.storage.local`, so `Vault` from core works
  unchanged. A web-app backup restores into it and its backups restore into
  the web app; when sync arrives, both become clients of the same server.
- **The unlocked key lives in `chrome.storage.session`.** It's held in memory,
  survives the service worker being stopped, and is cleared when Chrome
  closes. Access is set to trusted contexts, so content scripts can't read it.
  Core gained `unwrapVaultKey` and `importVaultKey`/`Vault.open`, so the raw
  key bytes are only ever handled in extension pages, and every page imports
  them as a non-extractable key with the fingerprint checked.
- **Locking uses `chrome.alarms` and `chrome.idle`.** The alarm is set from the
  auto-lock choice and pushed back on use; the vault also locks when the
  computer locks. Timers in the service worker would die with it.
- **Least privilege.** Install-time permissions are `activeTab`, `scripting`,
  `storage`, `alarms` and `idle`: none of them shows a warning. Filling works
  through `activeTab`, so the extension can only touch a tab the user clicked
  it on. Site access is optional and requested only for save prompts, which
  are off by default; turning them off removes the permission and unregisters
  the content script.
- **Strict matching, checked twice.** `matchUrl` in core allows the saved host
  or its subdomains, never downgrades https to http, requires the same port
  when one is given, and treats shared hosting suffixes (github.io,
  vercel.app, pages.dev and others) as exact-match only. The fill script
  probes every frame, fills only frames whose URL matches, and re-checks the
  frame's origin right before writing, in case it navigated in between.
- **No content script by default.** Filling injects a function on request.
  Capture for save prompts is a small script, built separately, that reads a
  form only when it's submitted and hands the values to the background, which
  takes the page address from Chrome (`sender.url`), not from the page.

## Alternatives considered

- **Keep the key in the service worker's memory:** lost every time Chrome
  stops the worker, so the vault would lock after about 30 seconds idle.
- **An offscreen document holding the key:** works, but adds a permission and
  a long-lived page for what session storage already does.
- **Always-on site access (`<all_urls>`):** the usual approach, and it shows
  "read and change all your data on all websites" at install. Not needed to
  fill on click.
- **Inline autofill menus in the page:** convenient, but they put UI inside
  pages that control the DOM around it (clickjacking). Left for later, behind
  the same optional permission.
- **Sharing the web app's IndexedDB:** extensions and sites have separate
  storage; there's no supported way to share it.

## Consequences

- Until sync, a login saved in the extension reaches the web app only through
  a backup. The settings page offers download and merge both ways, and tracks
  the last backup date.
- Filling is one click (or Ctrl+Shift+L), never automatic on page load.
- Logins for http-only sites fill on http but https logins never fill on http.
- The end-to-end test runs a build that grants localhost access in its
  manifest; the packaging script refuses that build.
