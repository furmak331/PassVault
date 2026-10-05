import { encode } from 'uqr';
import { useMemo } from 'react';

export interface QrCodeProps {
  value: string;
  /** Rendered width and height in CSS pixels. */
  size?: number;
  /** What the code holds, for screen readers. */
  label: string;
}

/**
 * A QR code drawn as one SVG path. Always dark on white, whatever the theme:
 * phone cameras read inverted codes poorly.
 */
export function QrCode({ value, size = 168, label }: QrCodeProps) {
  const { path, modules } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 4 });
    let d = '';
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, modules: qr.size };
  }, [value]);
  return (
    <svg
      className="pv-qr"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
    >
      <rect width={modules} height={modules} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
