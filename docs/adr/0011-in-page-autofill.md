# 0011: Autofill on web pages

**Status:** Accepted, 2026-10-03. Supersedes the parts of
[0008](0008-chrome-extension.md) about save prompts and the content script.

## Context

Until now the extension did nothing on a page until the person clicked its
toolbar icon. Filling took a click on the icon and then on Fill. Saving a new
login meant noticing a "+" badge and opening the popup. People expect a
password manager to meet them in the sign-in field: suggest the login for the
site, offer a strong password on a sign-up form, and ask to save or update
after they sign in.

Doing that means running code in web pages, which are hostile ground. The page
can read and change anything in its own DOM, fake clicks and events, restyle
or hide whatever an extension adds, and frame or overlay it. The master
password and the logins must stay out of its reach, and only the logins saved
for that exact site may ever be filled.

## Decision

- **Site access stays optional, asked for once, in plain words.** The manifest
  still asks for no host access, so there's no warning at install and no
  re-approval when an update ships. The settings page opens with a card that
  explains what turning autofill on does, and the popup has a one-line link to
  it. One grant covers both features. Two switches then turn each feature on or
  off, and "Turn off" hands the access back.
- **The content script runs only once access is granted.** It's registered
  dynamically, and also started in the tabs already open. It reacts to the
  field being focused and to forms being submitted, and reads nothing else.
- **The menu and the save bar are extension frames.** They're
  `chrome-extension://` iframes inside a closed shadow root, so the page can't
  read them, script them, or see the master password typed into them. The
  content script only places them and fills fields.
- **Frames act on Chrome's word, not the page's.** Each page's content script
  registers a random token. The background stores the tab, frame, document ID
  and address that Chrome reports for the sender. The frames carry only the
  token. They ask the background what it belongs to, match logins against that
  address, and send fills to that exact document. A page that copies the token
  gets nothing, because it resolves to the page that registered it, and a fill
  can't reach a document the frame has since navigated to.
- **A fill needs the person.** The content script accepts a fill only while
  focus is inside its own menu frame, and only while the menu is visibly on
  screen. A page can't focus that frame (it can't reach into the closed shadow
  root), so a hidden copy of the menu, or ours buried under something else,
  can't be used to fill fields without the person knowing. The menu's icon
  ignores clicks that a script synthesised.
- **The menu opens by itself only when it has something to offer.** That means
  logins for the site, a way to unlock when the vault is locked, or a strong
  password on a new-password field. Otherwise only the small icon appears. Once
  the person dismisses it, the menu stays closed on that page until the icon is
  clicked. Arrow keys and Enter work as in a native autocomplete.
- **Saving follows the sign-in.** A submitted form, an Enter in a login field,
  or a click on a submit-like button sends the username and password to the
  background. The background checks the switches and the site's "never" list.
  If the login is already saved exactly, nothing happens; otherwise the save
  bar appears in the top frame. A sign-in that moves to another page gets the
  bar there too, for up to two minutes and three pages. A two-step sign-in's
  email is remembered for the tab so the password step can be saved with it.
  Everything captured is held in session memory and dropped after five
  minutes.
- **Save or update.** A changed password for a known username (or for the
  site's only login, if the form had no username field) updates that login,
  and the old password goes into its history. Anything else is saved as a new
  login, and the person can correct the username first. If the vault is
  locked, the bar asks for the master password in the same frame.

## Alternatives considered

- **Mandatory host access in the manifest:** works from install, but shows a
  "read and change all your data" warning up front, and the store reviews it
  more strictly. Asking at the moment of use explains why.
- **Drawing the menu in the page's DOM:** simpler, but the page could read the
  logins in it and the master password typed into it.
- **Messaging between the page and the frames with `postMessage`:** the page
  can listen to and forge those messages. Chrome's extension messaging can't
  be reached from the page.
- **Filling on page load without a click:** convenient, and the classic way
  for a hidden form or a script injected into the page to harvest passwords.
- **A dynamic resource URL (`use_dynamic_url`)** to stop pages detecting the
  extension: the frame then failed to load, because `runtime.getURL` returns
  the extension's fixed address. Being detectable reveals that the extension
  is installed, nothing more.

## Consequences

- Once access is granted, the extension runs a small script on every site. It
  stays idle until a login field is focused.
- Sites that build sign-in forms in unusual ways (custom elements with closed
  shadow roots, canvas, cross-origin frames inside frames) may get no menu.
  The popup and Ctrl+Shift+L still work there.
- A sign-in that fails still gets a save offer, since the extension can't see
  whether the server accepted it. "Not now" and "Never" cover that.
- Pages can tell the extension is installed by probing for its frame page.
