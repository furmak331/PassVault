# 0006: "Tumbler", the vault as a precision instrument

**Status:** Accepted, 2026-10-02. Supersedes the visual direction in
[0005](0005-design-system.md); its decisions on tokens, fonts and self-hosting
still stand.

## Context

The first web vault used the visual defaults of a thousand recent products:
blue-black surfaces, a blue accent, rounded cards floating on soft glows, a
dotted grid behind a centered card, and small monospace eyebrows above every
heading. It worked, but it looked generated rather than designed, and nothing
about it said "safe".

## Decision

One concept carries the whole interface: the vault is a precision instrument,
in the tradition of safe dials, watch faces and well-made audio hardware.

- **The dial.** The vault fingerprint is drawn as a combination dial with a
  graduated bezel and an index mark. It is the brand mark, the onboarding
  preview, the lock screen and the sidebar status. The bezel doubles as a
  gauge: it fills with master-password strength during setup and with
  key-derivation progress while unlocking.
- **Warm neutrals, one signal color.** Porcelain is warm paper (`#f1eee6`),
  Graphite is warm black (`#0e0e0c`). The default accent is a signal orange,
  used only where something needs attention: the primary action, focus, the
  selected item, the dial's live segments. Cobalt, jade and monochrome remain
  as choices.
- **Rules, not cards.** Structure comes from hairlines and alignment. Item
  details are a spec sheet (label column, value, actions), storage choices are
  a ruled list, and the onboarding panel ends in a spec table. Radii are small
  (4 to 10 px) and shadows are reserved for things that float, such as dialogs.
- **Type with range.** Mona Sans at full width and heavy weight for display
  titles, against a quiet body size. Small expanded capitals label structure;
  monospace is kept for data (codes, counts, timestamps, secrets). The full
  stop on display titles carries the signal color. That is the one flourish.
- **Motion with a meaning.** Rings turn as a password is typed, the dial
  seals with a turn when the vault is created, and the unlock plays a short
  opening before the vault appears. All of it respects reduced motion.

## Alternatives considered

- **Polish the previous look:** better spacing and colors would still read as
  a template.
- **Editorial serif headlines:** distinctive for a magazine, but they say
  "publication", not "instrument", and have become a trope of their own.
- **Glass and gradients:** fashionable, but they say "marketing site" and work
  against the calm a password manager should have.

## Consequences

- The onboarding panel is always rendered in Graphite (it is its own
  `pv-root`), so the instrument looks the same whatever the page theme.
- Accent keys changed (`signal`, `cobalt`, `jade`, `mono`). Saved profiles
  with a retired accent fall back to the default when they're loaded.
- Components keep styling themselves only through tokens, so later surfaces
  (the extension popup, the server's admin page) inherit the language.
