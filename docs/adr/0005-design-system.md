# 0005: Own design system, self-hosted fonts

**Status:** Accepted, 2026-10-01

## Context

The product must look considered rather than templated, and privacy promises
rule out third-party requests, including font CDNs and favicon services.

## Decision

- **Graphite** (dark, default) and **Porcelain** (light) themes, four accents,
  all as CSS custom properties in `@passvaultify/ui`. Components style
  themselves only through tokens.
- **Mona Sans** for interface and headings (its width axis gives headings
  presence) and **Atkinson Hyperlegible Mono** for secrets, codes and
  fingerprints, because misreading l/1/I or O/0 is a real failure in a password
  manager.
- Fonts ship with the app via Fontsource packages. The P0 specimen makes zero
  external requests.
- Signature details each do a security job: the vault fingerprint
  (anti-phishing), the decrypt reveal (decryption happens here), the data
  location chip, and the network ledger.
- Accessible primitives (Radix) will be added for menus and dialogs in P1;
  P0 components are simple enough to build directly.

## Alternatives considered

- **A component kit with default styling (for example shadcn/ui):** fast, but
  instantly recognizable.
- **Google Fonts CDN:** leaks every visit to a third party. Rejected.

## Consequences

- Theme switching is a data attribute on the root element.
- The specimen page (`apps/web`) is the living reference for the system.
