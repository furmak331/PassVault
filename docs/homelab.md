# Running the sync server at home

This runs the PassVaultify sync server on a computer at home: your Windows
laptop to start with, a small always-on box later. Only your own devices can
reach it, through [Tailscale](https://tailscale.com), a private network between
them. It gets a real HTTPS address like `https://vault.tail1234.ts.net`. Nothing
is opened on your router, and the server is never on the public internet.

The setup lives in [`apps/server/deploy/homelab`](../apps/server/deploy/homelab):

- **`tailscale`** joins your tailnet as the machine `vault` and serves HTTPS.
- **`server`** is the sync server. It's reachable only through `tailscale`.
- **`backup`** copies the database once a day into a folder you choose.

It doesn't matter if the laptop is asleep or off for a while. The web vault and
the extension keep working from their own copy, and sync when the server is
back.

For a server on the public internet with your own domain instead, see
[self-hosting.md](self-hosting.md).

## 1. Tailscale

1. Create a free account at [tailscale.com](https://tailscale.com) and sign in to
   the [admin console](https://login.tailscale.com/admin).
2. On the **DNS** page, check that **MagicDNS** is on. Scroll down to **HTTPS
   Certificates** and choose **Enable HTTPS**.
3. Install Tailscale on every device that will use your vault and sign in with
   the same account: this laptop, your other computers, your phone. Tailscale
   has apps for Windows, macOS, Linux, Android and iOS.
4. Under **Settings → Keys**, choose **Generate auth key**. Leave "Reusable"
   and "Ephemeral" off. Copy the key (`tskey-auth-…`). The server uses it once
   to join.

## 2. Docker Desktop

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and
   keep the default WSL 2 setting. Docker Desktop is free for personal use.
2. In Docker Desktop's **Settings → General**, turn on **Start Docker Desktop
   when you sign in to your computer**.

## 3. Start the server

In PowerShell:

```powershell
git clone https://github.com/furmak331/PassVault.git
cd PassVault\apps\server\deploy\homelab
copy .env.example .env
notepad .env
```

In `.env`, paste your auth key after `TS_AUTHKEY=`. To keep backups in OneDrive,
set `BACKUP_DIR` too (see [Backups](#backups)). Save, then:

```powershell
docker compose up -d --build
```

The first build downloads Java and the server's libraries and takes a few
minutes. Later starts take seconds. Check that all three containers are up:

```powershell
docker compose ps
```

No Git? Download the repository as a ZIP from GitHub
(**Code → Download ZIP**), unzip it, and start from the `cd` line.

## 4. Keep the machine signed in

Tailscale signs machines out after 180 days unless told not to. In the admin
console, go to **Machines**, open the `…` menu next to **vault**, and choose
**Disable key expiry**.

The machine page also shows the server's full address, such as
`vault.tail1234.ts.net`.

## 5. Check it

On any device with Tailscale on, open these in a browser:

- `https://vault.tail1234.ts.net/health` shows `{"status":"ok"}`.
- `https://vault.tail1234.ts.net/v1/server` shows the server's `fingerprint`.
  Note it down.

The very first HTTPS request can take up to a minute while Tailscale gets the
certificate.

## 6. Connect your devices

- **Web vault:** Settings → Sync → Connect, and enter
  `https://vault.tail1234.ts.net`. Check the fingerprint matches, then create an
  account from your vault. Your account's password is your master password.
- **Chrome extension:** on its settings page, Sync → Connect, with the same
  address. Choose **Sign in** and use the email and master password from the web
  vault. If the extension had its own vault with a different password, it
  switches to the account's vault and copies its own logins in.
- **Another device:** on the web vault's welcome screen, choose "Sign in to your
  server".

Every device needs Tailscale switched on to sync. When it's off, the apps keep
working and catch up later.

## 7. Close registration

Once your account exists, stop anyone else on your tailnet from making one. In
`.env`, set:

```
PASSVAULTIFY_REGISTRATION=closed
```

Then:

```powershell
docker compose up -d
```

## Keeping a laptop server running

- Containers restart on their own after a reboot, once Docker Desktop starts.
- If you want it reachable whenever the laptop is plugged in, go to Windows
  **Settings → System → Power** and set sleep to **Never** when plugged in. In
  **Control Panel → Power Options → Choose what closing the lid does**, choose
  **Do nothing** for "Plugged in".
- The server uses at most 768 MB of memory, and next to nothing while idle.

## Backups

The `backup` container copies the database when it starts, then every
`BACKUP_INTERVAL_HOURS` (24 by default), and keeps the newest `BACKUP_KEEP` (14).
The copies are made with SQLite's own backup, which is safe while the server is
writing.

The backups are encrypted, like everything the server holds, so a cloud folder
is a fine place for them. To use OneDrive, set this in `.env` (with forward
slashes):

```
BACKUP_DIR=C:/Users/you/OneDrive/PassVaultify-backups
```

Then run `docker compose up -d`.

To take a backup right now:

```powershell
docker compose restart backup
```

Your devices also keep a full copy of the vault, and the web vault can still
download its own encrypted backup file.

### Restore a backup

Replace the date with the file you want:

```powershell
docker compose stop server
docker compose run --rm --no-deps --entrypoint sh backup -c "cp /backups/passvaultify-2026-10-03-0900.db /data/passvaultify.db && rm -f /data/passvaultify.db-wal /data/passvaultify.db-shm && chown 10001:10001 /data/passvaultify.db"
docker compose start server
```

The server's identity is stored in the database, so a restored server has the
same fingerprint, and devices carry on as before.

## Updates

```powershell
git pull
docker compose up -d --build
```

Database changes run automatically on start. Take a backup first.

## Moving to a mini PC later

A small always-on machine is the natural next step. A used business mini PC
(Lenovo ThinkCentre Tiny, Dell OptiPlex Micro, HP EliteDesk Mini) or a new
Intel N100 box uses about 10 W and has room for much more than this server.

A common setup is [Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment)
on the box, with an Ubuntu Server virtual machine running Docker. Then:

1. On the laptop, take a final backup with `docker compose restart backup`, then
   stop the stack with `docker compose down`. That keeps its data, in case you
   need to go back.
2. In the Tailscale admin console, remove the old **vault** machine so the name
   is free. Generate a new auth key.
3. On the new machine, install Docker (`curl -fsSL https://get.docker.com | sh`),
   clone the repository, and create `.env` with the new key and the same
   `TS_HOSTNAME`.
4. Copy the latest backup into its `backups` folder. Restore it with the
   `docker compose run … backup` line above (no need to stop anything first).
   Then run `docker compose up -d --build`.
5. Disable key expiry for the new **vault** machine.

The address and the fingerprint stay the same, so your devices keep syncing
without any changes.

## Troubleshooting

- **See what's happening:** `docker compose logs -f tailscale` or
  `docker compose logs -f server`.
- **No auth key, or it expired:** the `tailscale` log prints a login link. Open
  it to add the machine by hand.
- **The machine is called `vault-1`:** an older `vault` still exists. Remove it
  in the admin console, then run `docker compose up -d --force-recreate`.
- **A browser can't reach the address:** check that Tailscale is on and signed
  in on that device.
- **Certificate warning on the first visit:** wait a minute and reload; the
  certificate is still being issued.

## What this exposes

- The server is reachable only from devices signed in to your tailnet.
  Tailscale's traffic between devices is end-to-end encrypted, and the vault on
  top of it is encrypted with your master password.
- HTTPS certificates are public records, so the name `vault.tail1234.ts.net`
  appears in certificate logs. The name reveals nothing about the server's
  contents.
- If you share your tailnet with other people, they can reach the server too.
  Closing registration keeps them from creating accounts. Tailscale's access
  rules can also hide the machine from them.
