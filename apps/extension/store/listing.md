# Chrome Web Store listing

Everything the developer dashboard asks for, ready to paste. The images in this
folder are sized for the store. [`docs/publishing-extension.md`](../../../docs/publishing-extension.md)
says where each part goes.

## Store listing tab

**Name** (from the manifest): PassVaultify

**Summary** (from the manifest, 132 characters max):

> A zero-knowledge password manager. Fills logins only on the site they belong to.

**Category:** Privacy & Security (under "Make Chrome Yours"). Not Developer Tools.

**Language:** English

**Description:**

```
PassVaultify is a password manager that keeps your vault sealed in your own browser. It fills a login only on the site it was saved for, and locks itself when you walk away.

FILLS WHERE IT BELONGS
• Click into a sign-in field and your logins for that site appear right under it. One click fills.
• Sign-up forms get a strong password, ready to use.
• After you sign in, PassVaultify offers to save the login, or update it if the password changed. Two-step sign-ins too.
• Logins show up only on their own site, or its subdomains.
• A look-alike address gets nothing. A page that moved from https to http gets nothing.
• Shared hosting domains (github.io, vercel.app and friends) need an exact match, so one site can't fill another's login.
• Or fill from the toolbar popup, or press Ctrl+Shift+L (Cmd+Shift+L on a Mac).

ZERO KNOWLEDGE
• Your vault is encrypted on your device with AES-256-GCM, using a key derived from your master password (PBKDF2-SHA256, 600,000 iterations).
• Your master password is never stored or sent anywhere.
• No analytics, no ads. Without sync, nothing leaves your browser.

LOCKS ITSELF
• After 1, 5, 15 or 60 idle minutes, or only when Chrome closes. You choose.
• Also locks the moment your computer locks.
• While unlocked, the key lives in memory, never on disk.

ASKS FOR ALMOST NOTHING
• No permission warnings at install. Until you turn on autofill, PassVaultify can only touch a tab when you click it.
• Turn on autofill and Chrome asks you first. It looks only at login fields; turn it off and the access goes with it.
• The suggestion menu and save bar are PassVaultify's own sealed frames: the website can't read them, or the master password you type into them.

SYNC, IF YOU WANT IT
• Keep the extension and the PassVaultify web vault in step through a sync server you run.
• The server only ever holds ciphertext, and only a key derived from your master password: it can't read your vault.
• Check the server's fingerprint before you sign in, see your signed-in devices, and sign any of them out.

ALSO
• Password generator: random characters or a passphrase of real words, colour-coded so a 0 never passes for an O.
• No server? Bring your vault across from the web vault with an encrypted backup instead.
• Light and dark themes, four signal colours.

PassVaultify is open source: github.com/furmak331/PassVault
It is an educational project and has not been independently audited.
```

**Screenshots** (1280 × 800, in this order):

1. `screenshot-1-autofill.png`
2. `screenshot-2-auto-lock.png`
3. `screenshot-3-save.png`
4. `screenshot-4-generator.png`
5. `screenshot-5-settings.png`

**Small promo tile** (440 × 280): `promo-small-440x280.png`

**Marquee promo tile** (1400 × 560, optional): `promo-marquee-1400x560.png`

**Store icon** (128 × 128): `store-icon-128.png`. The same file as the icon in
the package: 96 × 96 artwork with 16 px of transparent padding, and a faint
light glow so the dark plate stays visible on dark backgrounds.

**Official URL:** None. It only lists sites verified in Google Search Console;
leave it empty.

**Homepage URL:** https://furmak331.github.io/PassVault/

**Support URL:** https://github.com/furmak331/PassVault/issues

**Mature content:** off.

## Privacy practices tab

**Single purpose:**

> PassVaultify stores the user's passwords in an encrypted vault in their browser and fills them into sign-in forms on the sites they were saved for, optionally keeping the encrypted vault in step with the user's other devices through a sync server the user chooses.

**Permission justifications:**

| Permission                                               | Justification                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`                                              | Lets PassVaultify read the address of the tab the user opened it on, to show the logins saved for that site, and fill one when the user asks. No access to any other tab.                                                                                                          |
| `scripting`                                              | Fills a username and password into the current page's sign-in form when the user chooses Fill or presses the fill shortcut. Also registers the autofill script, only after the user turns autofill on and grants site access.                                                      |
| `storage`                                                | Keeps the encrypted vault and the user's preferences in the extension's local storage, and the vault key in session storage (memory only) while the vault is unlocked.                                                                                                             |
| `alarms`                                                 | Locks the vault after the idle time the user picked.                                                                                                                                                                                                                               |
| `idle`                                                   | Locks the vault when the computer locks.                                                                                                                                                                                                                                           |
| Host permissions (optional, `https://*/*`, `http://*/*`) | Requested only when the user turns on autofill on websites. Used to show the logins saved for a site in its sign-in fields, suggest a strong password on sign-up forms, and offer to save or update a login when a sign-in form is submitted. Removed when autofill is turned off. |

**Are you using remote code?** No, I am not using remote code. (All scripts
are in the package. The extension pages' content security policy is
`script-src 'self'`.)

**Data usage.** Tick these, because the extension handles them on the user's
device:

- Personally identifiable information: no
- Health information: no
- Financial and payment information: no
- **Authentication information: yes** (the passwords the user saves; if the
  user connects a sync server, they're sent to it encrypted, along with the
  account email)
- Personal communications: no
- Location: no
- Web history: no
- User activity: no
- **Website content: yes** (only the username and password in a sign-in form the user submits, when autofill is on)

Then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://furmak331.github.io/PassVault/privacy.html

## Distribution tab

- **Visibility:** Public (or Unlisted for a soft launch: only people with the link can find it).
- **Regions:** All regions.
- **Pricing:** Free.

## Updating to 0.2.0 (sync)

Version 0.2.0 adds optional sync. When you upload it, in the dashboard:

1. **Store listing:** replace the description with the one above (it gains the
   "Sync, if you want it" section).
2. **Privacy practices:** replace the single-purpose statement with the one
   above. Keep the same data-usage boxes; the "Authentication information" note
   now covers the encrypted copy sent to the sync server the user chooses.
   That's sending data to provide the feature the user turned on, which the
   certifications allow.
3. **Privacy policy:** nothing to change in the dashboard. The page at
   `furmak331.github.io/PassVault/privacy.html` already describes sync once
   this version's code is merged.

No new permissions: the extension talks to the server like any web page
would, and the server's CORS settings allow it.

## Updating to 0.3.0 (autofill on websites)

Version 0.3.0 suggests logins in sign-in fields and offers to save or update
them, once the user turns autofill on. When you upload it, in the dashboard:

1. **Store listing:** replace the description with the one above ("Fills where
   it belongs" and "Asks for almost nothing" changed). Swap in new screenshots
   showing the menu under a field and the save bar if you have them.
2. **Privacy practices:** replace the `scripting` and host-permission
   justifications with the ones above. The data-usage boxes stay the same.
3. **Privacy policy:** nothing to change in the dashboard; the page describes
   autofill once this version's code is merged.

The permissions are unchanged: site access is still optional and requested
when the user turns autofill on, so existing users aren't asked to approve
anything on update. The new `web_accessible_resources` entry (the menu and
save bar page) needs no justification.
