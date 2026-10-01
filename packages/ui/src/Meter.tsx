export interface MeterProps {
  /** Filled segments, 0 to `segments`. */
  value: number;
  segments?: number;
  tone: 'danger' | 'warn' | 'ok';
  label: string;
}

/** Segmented strength meter. The label carries the meaning for screen readers. */
export function Meter({ value, segments = 5, tone, label }: MeterProps) {
  return (
    <div
      className={`pv-meter pv-meter--${tone}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={segments}
      aria-valuenow={value}
      aria-label={label}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < value ? 'is-on' : undefined} />
      ))}
    </div>
  );
}
