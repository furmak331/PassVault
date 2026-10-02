# Chrome Web Store listing

Everything the developer dashboard asks for, ready to paste. The images in this
folder are sized for the store. [`docs/publishing-extension.md`](../../../docs/publishing-extension.md)
says where each part goes.

## Store listing tab

**Name** (from the manifest): PassVaultify

**Summary** (from the manifest, 132 characters max):

> A zero-knowledge password manager. Fills logins only on the site they belong to.

**Category:** Tools

**Language:** English

**Description:**

```
PassVaultify is a password manager that keeps your vault sealed in your own browser. It fills a login only on the site it was saved for, and locks itself when you walk away.

FILLS WHERE IT BELONGS
• Logins show up only on their own site, or its subdomains.
• A look-alike address gets nothing. A page that moved from https to http gets nothing.
• Shared hosting domains (github.io, vercel.app and friends) need an exact match, so one site can't fill another's login.
• Fill from the popup, or press Ctrl+Shift+L (Cmd+Shift+L on a Mac).

ZERO KNOWLEDGE
• Your vault is encrypted on your device with AES-256-GCM, using a key derived from your master password (PBKDF2-SHA256, 600,000 iterations).
• Your master password is never stored or sent anywhere.
• No accounts, no servers, no analytics, no ads. PassVaultify makes no network requests with your data.

LOCKS ITSELF
• After 1, 5, 15 or 60 idle minutes, or only when Chrome closes. You choose.
• Also locks the moment your computer locks.
• While unlocked, the key lives in memory, never on disk.

ASKS FOR ALMOST NOTHING
• No permission warnings at install. PassVaultify can only touch a tab when you click it.
• "Offer to save new logins" is off by default. Turn it on and Chrome asks you first; turn it off and the access goes with it.

ALSO
• Password generator: random characters or a passphrase of real words, colour-coded so a 0 never passes for an O.
• Works with the PassVaultify web vault: bring your vault across with an encrypted backup, and send new logins back the same way.
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

**Store icon** (128 × 128): `apps/extension/public/icons/icon-128.png`

**Homepage URL:** https://github.com/furmak331/PassVault

**Support URL:** https://github.com/furmak331/PassVault/issues

## Privacy practices tab

**Single purpose:**

> PassVaultify stores the user's passwords in an encrypted vault in their browser and fills them into sign-in forms on the sites they were saved for.

**Permission justifications:**

| Permission                                               | Justification                                                                                                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`                                              | Lets PassVaultify read the address of the tab the user opened it on, to show the logins saved for that site, and fill one when the user asks. No access to any other tab.                                                         |
| `scripting`                                              | Fills a username and password into the current page's sign-in form when the user chooses Fill or presses the fill shortcut. Also registers the save-prompt script, only if the user turns that feature on and grants site access. |
| `storage`                                                | Keeps the encrypted vault and the user's preferences in the extension's local storage, and the vault key in session storage (memory only) while the vault is unlocked.                                                            |
| `alarms`                                                 | Locks the vault after the idle time the user picked.                                                                                                                                                                              |
| `idle`                                                   | Locks the vault when the computer locks.                                                                                                                                                                                          |
| Host permissions (optional, `https://*/*`, `http://*/*`) | Requested only when the user turns on "Offer to save new logins". Used to notice when a sign-in form is submitted so the extension can offer to save that login. Removed when the feature is turned off.                          |

**Are you using remote code?** No, I am not using remote code. (All scripts
are in the package. The extension pages' content security policy is
`script-src 'self'`.)

**Data usage.** Tick these, because the extension handles them on the user's
device:

- Personally identifiable information: no
- Health information: no
- Financial and payment information: no
- **Authentication information: yes** (the passwords the user saves)
- Personal communications: no
- Location: no
- Web history: no
- User activity: no
- **Website content: yes** (only the username and password in a sign-in form the user submits, when save prompts are on)

Then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://furmak331.github.io/PassVault/privacy.html

## Distribution tab

- **Visibility:** Public (or Unlisted for a soft launch: only people with the link can find it).
- **Regions:** All regions.
- **Pricing:** Free.
