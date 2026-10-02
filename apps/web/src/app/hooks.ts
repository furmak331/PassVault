import { fingerprintRings } from '@passvaultify/core';
import { useToast } from '@passvaultify/ui';
import { useCallback, useEffect, useState } from 'react';
import type { ThemeSetting } from './profile';

/** Resolve "system" to Graphite or Porcelain, following the OS as it changes. */
export function useResolvedTheme(setting: ThemeSetting): 'graphite' | 'porcelain' {
  const [prefersLight, setPrefersLight] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setPrefersLight(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  if (setting === 'system') return prefersLight ? 'porcelain' : 'graphite';
  return setting;
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** Time of the last user activity, shared by the idle lock and its countdown. */
let lastActivity = Date.now();

/**
 * Lock after `minutes` without user activity. Uses timestamps rather than one
 * long timer, so it still fires correctly after the tab was in the background
 * (browsers throttle timers there).
 */
export function useIdleLock(enabled: boolean, minutes: number, onIdle: () => void) {
  useEffect(() => {
    if (!enabled || minutes <= 0) return;
    lastActivity = Date.now();
    const touch = () => {
      lastActivity = Date.now();
    };
    const check = () => {
      if (Date.now() - lastActivity >= minutes * 60_000) onIdle();
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, touch, { passive: true });
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 1_000);
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, touch);
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [enabled, minutes, onIdle]);
}

/** Whole seconds until the idle lock fires, or null when auto-lock is off. */
export function useAutoLockRemaining(minutes: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (minutes <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [minutes]);
  if (minutes <= 0) return null;
  return Math.max(0, Math.ceil((lastActivity + minutes * 60_000 - now) / 1000));
}

/** Relative time like "3 days ago", with the exact date available for a title tooltip. */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 86400_000],
    ['month', 30 * 86400_000],
    ['week', 7 * 86400_000],
    ['day', 86400_000],
    ['hour', 3600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  return 'just now';
}

export function exactTime(iso: string): string {
  return new Date(iso).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The fingerprint ring pattern for a vault's code (derived, so it's available while locked). */
export function useRings(code: string): Uint8Array | null {
  const [rings, setRings] = useState<{ code: string; bytes: Uint8Array } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fingerprintRings(code).then((bytes) => {
      if (!cancelled) setRings({ code, bytes });
    });
    return () => {
      cancelled = true;
    };
  }, [code]);
  return rings?.code === code ? rings.bytes : null;
}

/** Copy to the clipboard and confirm with a toast. */
export function useCopy() {
  const toast = useToast();
  return useCallback(
    (text: string, what: string) => {
      navigator.clipboard.writeText(text).then(
        () => toast(`${what} copied`),
        () =>
          toast(`Couldn't copy the ${what.toLowerCase()}. Your browser blocked clipboard access.`),
      );
    },
    [toast],
  );
}
