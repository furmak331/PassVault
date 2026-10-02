# 0010: Sync in the web vault and the extension

**Status:** Accepted, 2026-10-02. Builds on [0009](0009-sync-server.md).

## Context

The sync server (ADR 0009) stores ciphertext and hands out changes by vault
revision. The clients have to decide what "in step" means: what each device
remembers about the server, what happens when two devices change the same item
before either has synced, how the extension syncs when Chrome keeps stopping
its background worker, and how several tabs or extension contexts share one
sign-in without tripping the server's refresh-token reuse detection.

## Decision

- **Each stored record remembers its server revision and whether it's
  pending.** `base` is the server revision the local copy was built on; `pending`
  means it changed here and the server hasn't accepted it. Every local write
  sets `pending`. A push sends `base` as the expected revision, so the server
  can refuse a stale write.
- **One engine in core, shared by both clients.** `SyncEngine` pulls changes
  since the last revision, then pushes pending records, then pulls once more to
  catch up past its own writes. It keeps no state of its own beyond the settings
  it's given, so it can be thrown away and recreated at any time.
- **Conflicts keep both versions.** When this device and the server both
  changed an item: if the contents match, nothing to do. Otherwise the server's
  version keeps the item and this device's version is saved beside it, titled
  "(conflict)" and tagged `conflict`, and the person is told. An edit beats a
  deletion on either side. A record that doesn't decrypt (tampered, or moved to
  another item's ID) is skipped and the local copy kept.
- **One password.** An account's credential is the auth key derived from the
  vault's master password, so there's nothing extra to remember. Connecting a
  device that already has a vault either uploads it as a new account, merges it
  with the same vault on the account (same fingerprint), or, for a different
  vault, switches the device to the account's vault and copies its items in,
  skipping duplicates.
- **The server's fingerprint is pinned when a device connects.** The person
  sees it, drawn as a dial like a vault's, before signing in. If it ever changes,
  sync pauses with a message instead of talking to a different server.
- **Web: live.** While unlocked, the web vault holds the server's event stream
  (read with `fetch`, since `EventSource` can't send a token), syncs after each
  write, and retries with backoff when offline.
- **Extension: on demand.** Chrome stops the background worker when idle, so
  there's no lasting connection. The worker syncs on unlock, when the popup
  opens, after any write, and every five minutes while unlocked. It opens the
  vault fresh for each run, because the popup or settings page may have written
  in between.
- **Shared tokens, one refresh at a time.** Tabs and extension contexts share
  the stored tokens. Refreshing happens inside a Web Lock, and re-reads the
  stored tokens first: if another context already refreshed, it uses those
  instead of presenting a refresh token the server would treat as stolen.
- **The web vault's CSP allows any HTTPS origin for `connect-src`**, plus
  localhost over HTTP for a server on the same machine. Sync servers can live
  anywhere; nothing else in the page makes requests.

## Alternatives considered

- **Last write wins:** simple, and silently loses one device's edit.
- **Field-level merging (CRDTs):** could merge, say, a new username on one
  device with a new password on another. More machinery than a password
  manager's rare conflicts justify; a visible copy is easier to trust.
- **Ask the person during sync:** blocks a background process on a dialog, and
  the extension's worker has no UI.
- **An offscreen document holding the extension's event stream:** works, but
  needs another permission and a page kept alive for a five-minute saving.
- **A separate account password:** one more secret to lose, and no stronger.

## Consequences

- Conflict copies need tidying by hand. They're rare, tagged, and nothing is
  lost.
- The extension can be up to five minutes behind until its popup opens.
- Opening the vault in several tabs is safe: they share tokens, and each runs
  its own engine against the same records.
- A device that was offline for a long time sends everything it changed when it
  reconnects; the server's revision check sorts out what's stale.
