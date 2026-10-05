# Self-hosting the sync server

The PassVaultify sync server keeps your vault in step across devices. It stores
only ciphertext: your master password, master key and vault key never reach
it, so whoever runs the server, you included, can't read the vault.

To run it at home instead (on a laptop or a mini PC, reachable only from your
own devices, with no domain or open ports), see [homelab.md](homelab.md).

This guide runs it on a public server with Docker Compose behind Caddy, which
gets and renews the HTTPS certificate on its own. You need:

- a machine that's always on: a small VPS, a home server or a Raspberry Pi 4
  (512 MB of free memory is enough);
- a domain or subdomain pointing at it, such as `vault.example.com`;
- ports 80 and 443 reachable from the internet, so Let's Encrypt can issue the
  certificate;
- Docker with the Compose plugin.

HTTPS isn't optional. Browsers block an HTTPS page (the web vault) from
talking to a plain-HTTP server, and sign-in tokens must never cross a network
unencrypted.

## Start it

```bash
git clone https://github.com/furmak331/PassVault.git
cd PassVault/apps/server/deploy
cp .env.example .env
nano .env                    # set DOMAIN
docker compose up -d --build
```

Check it's up:

```bash
curl https://vault.example.com/health        # {"status":"ok"}
curl https://vault.example.com/v1/server     # version, fingerprint, registration
```

Note the `fingerprint`. When a device connects for the first time, it shows the
server's fingerprint; check it matches before you sign in. If it ever changes
without you reinstalling the server, something is wrong: don't sign in.

## Connect your devices

- **Web vault:** Settings → Sync → Connect. Enter the server's address, check
  the fingerprint matches what `https://vault.example.com/v1/server` shows,
  then create an account from your vault (or sign in to one).
- **Another browser or computer:** on the welcome screen, choose "Sign in to
  your server".
- **Chrome extension:** on its settings page, "Sign in to your server" on first
  run, or Sync → Connect later.

Your account's password is your vault's master password. The server only gets
a key derived from it.

## Close registration

By default anyone who can reach the server can create an account. Once you've
created the accounts you want, set this in `.env` and restart:

```bash
PASSVAULTIFY_REGISTRATION=closed
docker compose up -d
```

## PostgreSQL instead of SQLite

SQLite is right for a household. For more users, or if you already run
PostgreSQL backups, use the PostgreSQL override. Set `POSTGRES_PASSWORD` in
`.env`, then:

```bash
docker compose -f compose.yml -f compose.postgres.yml up -d --build
```

Switching an existing server between the two doesn't move the data. Start the
new one empty, and sign in from a device that has the vault: it uploads
everything again.

## Configuration

| Variable                       | Default        | Meaning                                                             |
| ------------------------------ | -------------- | ------------------------------------------------------------------- |
| `DOMAIN`                       | (required)     | The name Caddy serves and gets a certificate for                    |
| `PASSVAULTIFY_REGISTRATION`    | `open`         | `open` or `closed`                                                  |
| `PASSVAULTIFY_DATA_DIR`        | `/data`        | SQLite location inside the container                                |
| `PASSVAULTIFY_FORWARD_HEADERS` | `native`       | Trust `X-Forwarded-For` from private-network proxies; `none` if not |
| `SPRING_PROFILES_ACTIVE`       | `sqlite`       | `postgres` to use `DATABASE_URL`                                    |
| `DATABASE_URL`                 | (postgres)     | JDBC URL, e.g. `jdbc:postgresql://db:5432/passvaultify`             |
| `DATABASE_USER`                | `passvaultify` |                                                                     |
| `DATABASE_PASSWORD`            |                |                                                                     |

Limits built into the server: 15-minute access tokens and 30-day refresh
tokens, 256 KB per encrypted item, 20,000 items per vault, 50 devices per
account, and rate limits on sign-in, sign-up and token refresh.

## Backups

The server's data is already encrypted, but losing it still means re-uploading
from a device. Back it up like any other database.

SQLite, without stopping the server:

```bash
docker compose exec server sh -c 'cp /data/passvaultify.db /data/backup.db'
docker compose cp server:/data/backup.db ./passvaultify-$(date +%F).db
```

PostgreSQL:

```bash
docker compose exec db pg_dump -U passvaultify passvaultify > passvaultify-$(date +%F).sql
```

Your devices also keep a full copy of the vault, and the web vault's encrypted
backup file still works as before.

## Upgrades

```bash
git pull
docker compose up -d --build
```

Database changes run automatically on start. Take a backup first.

## What the server can and can't see

It stores, per account: the email, an Argon2id hash of the auth key, the vault
header (KDF settings, the wrapped vault key and the fingerprint), each item's
ciphertext with its ID, revision, update time and deleted flag, and each
signed-in device's name, kind and last-seen time.

It can see how many items a vault has, roughly how large each is, and when
they change. It can't see titles, usernames, passwords, URLs or notes, and it
can't unwrap the vault key. The cryptography is described in
[spec/crypto.md](../spec/crypto.md) and the API in
[spec/openapi.yaml](../spec/openapi.yaml).
