import { Fragment, useEffect, useState } from 'react';

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789#$%&*+=?@';
const MASK = '•'.repeat(12);

export type CharKind = 'digit' | 'symbol' | 'letter';

export function charKind(ch: string): CharKind {
  if (/[0-9]/.test(ch)) return 'digit';
  if (/[A-Za-z]/.test(ch)) return 'letter';
  return 'symbol';
}

interface Glyph {
  ch: string;
  scrambled: boolean;
}

/** One animation frame: the first `settled` characters are real, the rest scrambled. */
function frameFor(chars: string[], settled: number): Glyph[] {
  return chars.map((ch, i) =>
    i < settled
      ? { ch, scrambled: false }
      : { ch: GLYPHS[Math.floor(Math.random() * GLYPHS.length)] as string, scrambled: true },
  );
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface SecretTextProps {
  /** The plaintext. Only rendered while revealed. */
  value: string;
  revealed: boolean;
  size?: 'md' | 'lg';
  /** Duration of the decrypt animation in ms; 0 disables it. */
  duration?: number;
  /** Space characters in groups of four. Off for passphrases, which have their own words. */
  group?: boolean;
}

/**
 * Masked secret that resolves from scrambled characters when revealed.
 * Digits and symbols get their own colors so look-alikes are easy to tell apart.
 */
export function SecretText({
  value,
  revealed,
  size = 'md',
  duration,
  group = true,
}: SecretTextProps) {
  const [glyphs, setGlyphs] = useState<Glyph[] | null>(null);

  useEffect(() => {
    if (!revealed) return;
    const chars = [...value];
    const total = duration ?? 360 + chars.length * 8;
    const animate = total > 0 && !prefersReducedMotion();
    let frame = 0;
    const start = performance.now();
    // All state updates happen in animation-frame callbacks, never during render.
    const tick = (now: number) => {
      const progress = animate ? Math.min(1, (now - start) / total) : 1;
      setGlyphs(frameFor(chars, Math.floor(progress * chars.length)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setGlyphs(null);
    };
  }, [value, revealed, duration]);

  const className = ['pv-secret', size === 'lg' && 'pv-secret--lg'].filter(Boolean).join(' ');

  if (!revealed || glyphs === null) {
    // Fixed length, so the mask doesn't reveal how long the password is.
    return (
      <span className={className} data-revealed="false" aria-label="Hidden password">
        {MASK}
      </span>
    );
  }

  const done = glyphs.every((g) => !g.scrambled);
  return (
    <span
      className={className}
      data-revealed="true"
      data-grouped={group}
      aria-label={done ? undefined : 'Revealing password'}
    >
      {glyphs.map((g, i) => {
        if (g.scrambled) {
          return (
            <span key={i} className="pv-ch-scramble" aria-hidden="true">
              {g.ch}
            </span>
          );
        }
        const kind = charKind(g.ch);
        return (
          <Fragment key={i}>
            <span className={kind === 'letter' ? undefined : `pv-ch-${kind}`}>{g.ch}</span>
            {/* Ungrouped text (a passphrase) wraps after a separator, not mid-word. */}
            {!group && kind === 'symbol' && <wbr />}
          </Fragment>
        );
      })}
    </span>
  );
}
