-- PassVaultify sync server schema. Portable SQL: runs unchanged on SQLite
-- (self-hosting) and PostgreSQL (cloud). Times are epoch milliseconds.
--
-- Nothing here is secret on its own: the server holds ciphertext, the vault
-- header (KDF settings, wrapped vault key, fingerprint), an Argon2id hash of
-- each account's auth key, and SHA-256 hashes of session tokens.

-- One row: a random secret that identifies this server. Its fingerprint is
-- shown to clients on first connect, and it keys the fake KDF settings that
-- prelogin returns for unknown emails.
CREATE TABLE server_identity (
  id         INTEGER PRIMARY KEY,
  secret     VARCHAR(64) NOT NULL,
  created_at BIGINT      NOT NULL
);

CREATE TABLE accounts (
  id          VARCHAR(36)  PRIMARY KEY,
  email       VARCHAR(320) NOT NULL UNIQUE,
  auth_hash   VARCHAR(200) NOT NULL,
  -- The vault header as JSON: format, kdf, wrappedVaultKey, fingerprint.
  header_json TEXT         NOT NULL,
  -- Bumped on every item write; items carry the revision they were written at.
  revision    BIGINT       NOT NULL,
  created_at  BIGINT       NOT NULL
);

-- A signed-in device. Its ID is the device ID in the API.
CREATE TABLE sessions (
  id                 VARCHAR(36) PRIMARY KEY,
  account_id         VARCHAR(36) NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  device_name        VARCHAR(80) NOT NULL,
  device_kind        VARCHAR(16) NOT NULL,
  access_hash        VARCHAR(64) NOT NULL UNIQUE,
  access_expires_at  BIGINT      NOT NULL,
  refresh_expires_at BIGINT      NOT NULL,
  created_at         BIGINT      NOT NULL,
  last_seen_at       BIGINT      NOT NULL
);
CREATE INDEX sessions_account ON sessions (account_id);

-- Every refresh token ever issued for a live session. A token works once; a
-- second use means it was stolen, and the whole session is revoked.
CREATE TABLE refresh_tokens (
  token_hash VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  used       BOOLEAN     NOT NULL
);
CREATE INDEX refresh_tokens_session ON refresh_tokens (session_id);

CREATE TABLE items (
  account_id VARCHAR(36) NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  id         VARCHAR(36) NOT NULL,
  revision   BIGINT      NOT NULL,
  updated_at BIGINT      NOT NULL,
  deleted    BOOLEAN     NOT NULL,
  data       TEXT,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX items_account_revision ON items (account_id, revision);
