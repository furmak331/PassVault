# PassVaultify

A zero-knowledge password manager. You choose where your vault lives: only on
your machine, on a server you run, or in the cloud. In every mode it's
encrypted on your device first, so nobody else can read it.

> **Status:** P0 (foundations). The crypto core, design system and API
> contract are in place; the web vault and Chrome extension come next. This is
> an educational project and has not been independently audited.

## What's here

```
apps/
  web/         React + Vite. Today: the live design-system specimen
  cli/         The original Java CLI (becomes a pvf1 client in P5)
packages/
  core/        Crypto (pvf1), encoding, secure randomness. Web Crypto only
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
pnpm dev          # specimen at http://localhost:5173
pnpm test         # unit tests for core and ui
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
