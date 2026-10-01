# 0004: Java 21 + Spring Boot server, OpenAPI spec-first

**Status:** Accepted, 2026-10-01

## Context

The server stores ciphertext, verifies auth keys and pushes change
notifications to connected devices. It must scale horizontally for the cloud
and stay small enough to self-host on a Raspberry Pi.

## Decision

- **Java 21 + Spring Boot 3.** Virtual threads make thousands of open
  Server-Sent Events connections cheap. Spring Security is mature. Java is the
  project owner's strongest language and the most common enterprise backend.
- **OpenAPI 3.1, spec-first.** [spec/openapi.yaml](../../spec/openapi.yaml) is
  the contract. The TypeScript client and the Java interfaces are generated
  from it, so the languages can't drift.
- **Stateless API instances** behind a load balancer, with PostgreSQL for data,
  Redis for rate limits and pub/sub fan-out, and S3-compatible storage for
  encrypted attachments.
- **A SQLite profile** for single-household self-hosting.

## Alternatives considered

- **Go:** excellent for small binaries and concurrency, but new to the owner,
  which slows delivery and weakens the interview story.
- **Node.js:** one language end to end, but weaker for CPU-heavy Argon2id
  hashing at sign-in.
- **GraphQL:** flexible querying isn't needed for "changes since revision N".
- **tRPC:** TypeScript-only; doesn't fit a Java server.

## Consequences

- Two languages in the repo, kept in step by the OpenAPI spec and the shared
  crypto test vectors.
- The cloud scales by adding identical instances; self-hosting is one container.
