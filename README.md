# PassVaultify

A zero-knowledge password manager. You choose where your vault lives: only on
your machine, on a server you run, or in the cloud. In every mode it's
encrypted on your device first, so nobody else can read it.

> **Status:** P2 complete (Chrome extension). The web vault works end to end on
> one device and installs as an offline app: create or restore a vault, import
> from other password managers, and keep encrypted backups. The Chrome
> extension fills logins only on their own site and moves vaults to and from
> the web app with those backups. Sync comes next. This is an educational
> project and has not been independently audited.

**Try it:** [furmak331.github.io/PassVault](https://furmak331.github.io/PassVault/).
Pick "Explore the demo vault" for sample data (password
`correct horse battery staple`), or create your own. Nothing leaves the browser.
The design system lives at [`specimen.html`](https://furmak331.github.io/PassVault/specimen.html).

## What's here

```
apps/
  web/         React + Vite web vault, plus the design-system specimen
  extension/   Chrome extension (Manifest V3): popup, settings page, autofill
  cli/         The original Java CLI (becomes a pvf1 client in P5)
packages/
  core/        Crypto (pvf1), vault model, generator, strength. Web Crypto only
  ui/          Design tokens, styles and React components
spec/
  crypto.md    The crypto format, the source of truth for every client
  vectors/     Test vectors from an independent implementation
  openapi.yaml The sync API contract (implemented in P4)
docs/adr/      Architecture decision records
snap/          Snap packaging for the CLI
```

## Develop

Requires Node 22+ and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev          # vault at http://localhost:5173, specimen at /specimen.html
pnpm test         # unit tests for core, ui and web
pnpm typecheck
pnpm lint         # ESLint + Prettier
pnpm build
pnpm spec:lint    # validate the OpenAPI spec
```

Regenerate the crypto test vectors (needs Python 3.11+):

```bash
pip install -r spec/vectors/requirements.txt
python3 spec/vectors/generate.py
```

The generator first checks published RFC 7914, RFC 5869 and NIST GCM vectors,
then writes `spec/vectors/pvf1.json`. CI fails if the committed file differs
from a fresh run.

## The web vault

The design treats the vault as a precision instrument: the vault fingerprint
is a combination dial, structure comes from hairlines rather than cards, and a
single signal color marks what needs attention. The reasoning is in
[ADR 0006](docs/adr/0006-tumbler-visual-language.md).

- **Onboarding** that explains the one thing users must know: there's no
  password reset. Master-password strength is estimated with zxcvbn, shown as
  the offline guessing time against a stolen copy.
- **Lock screen with a vault fingerprint.** Each vault has a unique ring
  pattern and code. A phishing page can't reproduce it, so users learn to look
  for it before typing.
- **Logins and secure notes** with favorites, tags, search, password history
  and a reused-password warning.
- **Trash with Undo**, kept for 30 days. Permanent deletes leave a tombstone so
  future sync can propagate them.
- **Generator** for random passwords, EFF-wordlist passphrases and PINs, with
  entropy and crack-time estimates.
- **Auto-lock** after inactivity, measured by timestamps so it still fires
  after the tab was in the background.
- **Local-only storage** in IndexedDB. The store only ever receives the vault
  header and encrypted records.
- **Command palette (⌘K / Ctrl K)** to find any item or run any action, and
  single-key shortcuts (`/` search, `N` new, `J`/`K` move, `C` copy password,
  `?` for the full list).
- **Import** from Chrome, Edge, Brave, Firefox, Bitwarden and 1Password CSV
  exports, with a preview, duplicate detection and a reminder to delete the
  plain-text file afterwards.
- **Encrypted backups** that are the vault itself: download one from Settings,
  restore it on any device from the welcome screen, or merge it into another
  vault. A reminder appears when a local-only vault has no recent backup.
- **Installable and offline.** A build-time service worker caches the exact
  files of each release, so the app opens with no connection; a new version is
  offered, never forced. A strict Content Security Policy allows code and data
  from this origin only.

## The Chrome extension

The extension keeps its own encrypted vault in the browser, in the same format
as the web vault. The reasoning is in
[ADR 0008](docs/adr/0008-chrome-extension.md).

- **Fills only where a login belongs:** the saved site or its subdomains,
  https never downgraded to http, and shared hosts such as `github.io` matched
  exactly. The page's address is checked again right before filling.
- **No permission warnings at install.** It can only touch a tab you click it
  on. Save prompts for new logins are optional and off by default; turning
  them on asks for site access, turning them off removes it.
- **Locks itself** after the idle time you choose, when the computer locks,
  or when Chrome closes. While unlocked, the key is held in Chrome's
  in-memory session storage, out of reach of web pages.
- **Popup** with the lock dial, the logins for the current site, search, copy,
  fill (Ctrl+Shift+L), a generator and quick add.
- **Works with the web vault through backups:** restore a web-app backup to
  set it up, then download or merge backups either way.

```bash
pnpm --filter @passvaultify/extension build     # unpacked build in apps/extension/dist
pnpm --filter @passvaultify/extension package   # store zip in apps/extension/release
```

Load `apps/extension/dist` from `chrome://extensions` with Developer mode on.
To run the end-to-end test in a real Chromium:

```bash
pnpm --filter @passvaultify/extension build:e2e
CHROMIUM_PATH=/path/to/chrome node apps/extension/e2e/run.mjs
```

Publishing to the Chrome Web Store is covered step by step in
[docs/publishing-extension.md](docs/publishing-extension.md). The store text
and images are in [`apps/extension/store`](apps/extension/store), and the
privacy policy is at
[furmak331.github.io/PassVault/privacy.html](https://furmak331.github.io/PassVault/privacy.html).

## How the crypto works

Summary of [spec/crypto.md](spec/crypto.md):

1. Your master password goes through PBKDF2-SHA256 (600,000 iterations) to
   make a master key. It never leaves your device.
2. HKDF splits that into an **auth key** (proves who you are to a sync server)
   and a **wrap key** (locks your vault key).
3. A random **vault key** encrypts every item with AES-256-GCM, bound to the
   item's ID.
4. Changing your master password re-wraps one key; nothing is re-encrypted.
5. A **vault fingerprint** derived from the vault key appears on the lock
   screen. A phishing page can't draw it.

Design decisions and their trade-offs are recorded in [docs/adr](docs/adr).

## The Java CLI

The original command-line app lives in `apps/cli`.

```bash
cd apps/cli
mvn package
java -jar target/passvaultify.jar
```

| How it runs           | Database location                        |
| --------------------- | ---------------------------------------- |
| `PASSVAULT_DB` is set | that path                                |
| installed as a snap   | `~/snap/passvaultify/common/passpass.db` |
| otherwise             | `passpass.db` in the current directory   |

### Snap

[`snap/snapcraft.yaml`](snap/snapcraft.yaml) bundles its own Java runtime, so
users don't need Java installed.

```bash
sudo snap install snapcraft --classic
sudo snap install lxd && sudo lxd init --auto   # snapcraft builds inside an LXD container

snapcraft pack                                  # run from the repo root
sudo snap install --dangerous ./passvaultify_1.0_amd64.snap
passvaultify
```
