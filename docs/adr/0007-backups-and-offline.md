# 0007: Backups are the vault; offline support without a framework

**Status:** Accepted, 2026-10-02

## Context

A local-only vault lives in one browser. Clearing site data, a reinstall or a
lost laptop erases it, so people need backups. They also need a way in from
other password managers, and a password manager should open without a
connection.

## Decision

- **A backup is the stored vault, wrapped in JSON:** the plaintext header and
  the pvf1 records, exactly as IndexedDB holds them (spec/crypto.md, "Backup
  file"). No second password and no new crypto, so a backup is exactly as
  strong as the vault and opens with the master password it was made with.
- **Restoring is all or nothing.** The reader validates every field, caps the
  KDF iteration count (a backup is untrusted input), then unwraps the vault key
  and decrypts every record before writing anything.
- **Merging rebuilds items field by field** under the destination vault's key
  with new IDs, so a backup can't smuggle unknown fields into a vault.
- **CSV import happens in the browser** and shows a preview with duplicates
  before writing. Afterwards the app says plainly to delete the CSV, which
  holds every password in plain text.
- **The service worker is generated at build time** by a 60-line Vite plugin
  from the exact list of built files, with a cache named after their hash. No
  Workbox: the app has no API calls to cache, so the job is small enough to
  own, read and test.
- **Updates are offered, not forced.** A new version waits until the user
  clicks Reload, so an unlocked vault is never reloaded from under them.

## Alternatives considered

- **Backups encrypted with a separate export password:** one more password to
  forget, and a second KDF and format to maintain and audit.
- **Plain-text CSV export:** it's what most managers offer, and it's how
  vaults leak. Left out until there's a reason that outweighs the risk.
- **vite-plugin-pwa / Workbox:** a solid choice for apps with runtime caching
  rules. Here it would add a dependency tree larger than the problem.

## Consequences

- A backup made before a master-password change needs the old password.
  The restore screen says so.
- A restored vault keeps its fingerprint, so the lock screen looks exactly as
  it did on the original device.
- The Content Security Policy is applied at build time only, because the Vite
  dev server needs an inline script for hot reload.
