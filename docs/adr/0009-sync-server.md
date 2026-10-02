# 0009: The sync server: opaque sessions, one revision per vault, contract-tested

**Status:** Accepted, 2026-10-02. Refines [0004](0004-server-stack.md).

## Context

ADR 0004 chose Java 21 with Spring Boot, and an OpenAPI spec as the contract.
Building it raised questions 0004 left open: how sessions work, how sync finds
changes and detects conflicts, how the Java side stays true to the spec, and
how one build serves both a Raspberry Pi and a hosted service on a
$5–10/month budget.

## Decision

- **Spring Boot 4.1 on Java 21, virtual threads on.** Open change-notification
  streams cost almost nothing, so one small instance holds many devices.
- **Opaque tokens, looked up on every request.** Access tokens (15 minutes) and
  refresh tokens (30 days) are random 256-bit strings, stored only as SHA-256
  hashes. Checking the session on every request makes "sign this device out"
  and "change master password" take effect immediately, which signed JWTs
  can't do without a revocation list. Refresh tokens rotate on each use;
  presenting a used one ends the session, since two parties hold it.
- **Argon2id over the auth key**, at OWASP settings (19 MiB, 2 passes), with
  the number of concurrent hashes capped so a burst of sign-ins can't exhaust
  a small server's memory. Unknown emails get a dummy hash (same timing) and
  stable fake KDF settings at prelogin, so accounts can't be enumerated there.
- **One revision counter per vault.** Every write takes the vault's next
  revision and the item records it. "Changes since n" is one indexed query;
  deletions are tombstones. A write sends the item revision it last saw: if
  the server has a newer one, it answers 409 with its copy. Taking the vault
  revision first locks the account row in PostgreSQL, so two writes to one
  item can't both pass the check (tested with eight at once).
- **SQLite and PostgreSQL from the same SQL.** The schema avoids
  vendor-specific types, so self-hosting needs no database server and the
  hosted service runs on PostgreSQL. The whole API test suite runs against
  both.
- **No Spring Security filter chain.** Authentication is one interceptor that
  hashes the bearer token and loads the session. It's short enough to read in
  full, which matters more here than framework features we don't use.
- **CORS open to any origin, without credentials.** Nothing rides on cookies,
  so a page on another origin gains nothing; this lets the web vault, the
  extension and self-hosted copies of the web vault all reach any server.
- **Spec-first by contract test, not Java code generation.** The TypeScript
  client's types are generated from `spec/openapi.yaml` (CI fails if they're
  stale). An interop test drives the real server with that client, validates
  every response against the spec with a JSON Schema validator, and fails if
  any operation goes unexercised. Java DTOs are hand-written records.
- **In-memory rate limits and event fan-out.** Right for one instance. ADR
  0004's Redis comes in when the hosted service needs a second instance; each
  lives in a single class, so that change stays contained.

## Alternatives considered

- **JWT access tokens:** no lookup per request, but revocation needs a
  denylist, which is a lookup anyway.
- **Java interfaces generated with openapi-generator:** its Spring templates
  lag behind Spring Boot 4 and Jackson 3, and generated code is harder to
  review than ten records. The contract test catches drift either way.
- **Per-item revision clocks or CRDTs:** more than a password vault needs.
  Conflicts are rare, and the spec has the client keep both versions when they happen.
- **Spring Security with a custom token filter:** works, but adds a large
  configuration surface for a single bearer check.

## Consequences

- A request costs one indexed lookup of the session. At this scale that's
  negligible; a cache can come later if it isn't.
- The server can tell how many items a vault has, their sizes and when they
  change. It can't read them.
- Browsers' `EventSource` can't send an Authorization header, so clients read
  the event stream with `fetch`. The TypeScript client does this.
- A second server instance needs Redis for rate limits and events before it's
  added.
