export interface MeterProps {
  /** Filled segments, 0 to `segments`. */
  value: number;
  segments?: number;
  tone: 'danger' | 'warn' | 'ok';
  label: string;
}

const TICKS_PER_SEGMENT = 8;

/**
 * Strength meter drawn as a row of ticks, every eighth one tall, like a level
 * indicator. The label carries the meaning for screen readers.
 */
export function Meter({ value, segments = 5, tone, label }: MeterProps) {
  const ticks = segments * TICKS_PER_SEGMENT;
  const lit = Math.round((Math.max(0, Math.min(value, segments)) / segments) * ticks);
  return (
    <div
      className={`pv-meter pv-meter--${tone}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={segments}
      aria-valuenow={value}
      aria-label={label}
    >
      {Array.from({ length: ticks }, (_, i) => (
        <span key={i} className={i < lit ? 'is-on' : undefined} />
      ))}
    </div>
  );
}
