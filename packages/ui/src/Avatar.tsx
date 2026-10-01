import type { CSSProperties } from 'react';

/**
 * Monogram avatar for vault items. Drawn locally: fetching favicons from a
 * third-party service would leak the user's list of sites.
 */
const HUES = [
  '#8aa2ff',
  '#4fd1a5',
  '#f0b650',
  '#ff8aa5',
  '#b79cff',
  '#5ec8e5',
  '#f2707f',
  '#9ad66b',
];

export function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length] as string;
}

export function monogram(title: string): string {
  const letter = title.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return letter ? letter.toUpperCase() : '?';
}

export interface AvatarProps {
  title: string;
  /** Stable seed for the color, e.g. the site's host. Defaults to the title. */
  seed?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Avatar({ title, seed, size = 'md' }: AvatarProps) {
  return (
    <span
      className={`pv-avatar pv-avatar--${size}`}
      style={{ '--pv-av': avatarColor((seed ?? title).toLowerCase()) } as CSSProperties}
      aria-hidden="true"
    >
      {monogram(title)}
    </span>
  );
}
