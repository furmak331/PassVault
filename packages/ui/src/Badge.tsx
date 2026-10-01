import type { HTMLAttributes } from 'react';

export type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

/** Status labels. Status colors are never used as decoration. */
export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return (
    <span
      className={['pv-badge', `pv-badge--${tone}`, className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
