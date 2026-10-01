# 0001: One monorepo with pnpm workspaces and Turborepo

**Status:** Accepted, 2026-10-01

## Context

PassVaultify has an extension, a web vault, a landing site, a Java server and
a Java CLI. The browser apps share the crypto core and the design system, and
every client must agree on one crypto format and one API contract.

## Decision

Keep everything in one repository:

- `apps/` for deployable things, `packages/` for shared TypeScript, `spec/`
  for contracts (crypto format, OpenAPI, test vectors), `docs/` for decisions.
- pnpm workspaces link internal packages without publishing them. Internal
  packages export their TypeScript source directly, so there's no build step
  between them.
- Turborepo runs `build`, `typecheck` and `test` across packages and caches
  results, so CI only redoes work for what changed.

## Alternatives considered

- **Separate repositories:** a change to the crypto format would need
  coordinated releases across repos. Rejected.
- **Nx:** more powerful, but more configuration than a project this size needs.

## Consequences

- A single PR can change the spec, the TypeScript core and the Java client
  together, and CI checks them against the same test vectors.
- The Java apps build with Maven, outside Turborepo. CI runs both.
