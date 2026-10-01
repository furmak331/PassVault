# 0003: Three storage modes with identical crypto

**Status:** Accepted, 2026-10-01

## Context

Users trust different things. Some want nothing to leave their machine, some
want sync on hardware they control, and some want convenience.

## Decision

Offer three modes, chosen at onboarding and changeable later:

| Mode                 | Where ciphertext lives | Sync                  |
| -------------------- | ---------------------- | --------------------- |
| Local only (default) | This browser           | Encrypted backup file |
| Self-hosted          | A server the user runs | Automatic             |
| PassVaultify Cloud   | Our servers            | Automatic             |

The crypto is identical in all three. Only the storage target changes.
Self-hosted and cloud run the same server build.

Supporting privacy features: a visible "where your data lives" label on every
screen, a network ledger listing every outbound request, and an offline mode
that blocks all network access.

## Alternatives considered

- **Cloud only:** simplest, but asks every user to trust us with availability
  and metadata.
- **Local only:** maximally private, but no multi-device story.

## Consequences

- The vault model carries sync metadata (IDs, revisions, tombstones) from day
  one, so moving from local to a server is an upload of existing ciphertext.
- Self-hosted servers need a trust step: the client shows the server's
  fingerprint on first connect, then pins it.
