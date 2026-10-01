# 0002: The pvf1 crypto format

**Status:** Accepted, 2026-10-01

## Context

The original CLI used AES-CBC without an integrity check, and the same salt for
both the login hash and the encryption key. PassVaultify needs a format that is
zero-knowledge, tamper-evident, cheap to re-key, and implementable identically
in TypeScript and Java.

## Decision

Adopt `pvf1`, specified in [spec/crypto.md](../../spec/crypto.md):

- PBKDF2-HMAC-SHA256 with 600,000 iterations turns the master password into a
  master key. KDF settings are stored per vault.
- HKDF splits the master key into an auth key (proves identity to a server)
  and a wrap key (protects the vault key).
- A random 256-bit vault key encrypts items with AES-256-GCM. Each item's ID is
  bound in as additional authenticated data.
- A vault fingerprint is derived from the vault key and shown on the lock
  screen as an anti-phishing check.
- Test vectors come from an independent implementation (Python
  `cryptography`), plus published RFC and NIST vectors.

## Alternatives considered

- **Argon2id from day one:** memory-hard and better against GPUs, but not built
  into Web Crypto or the JDK. Deferred; KDF settings are stored per vault so it
  can be added without breaking anything.
- **Encrypting items directly with the master-password key:** a password change
  would re-encrypt the whole vault. Rejected in favor of a wrapped vault key.
- **AES-CBC + HMAC:** works, but GCM gives authentication in one primitive that
  every platform supports natively.

## Consequences

- Changing the master password re-wraps one key.
- A server, even a malicious self-hosted one, only ever holds ciphertext.
- Every client must pass `spec/vectors/pvf1.json`. The TypeScript core does
  today; the Java CLI will when it becomes a client in P5.
