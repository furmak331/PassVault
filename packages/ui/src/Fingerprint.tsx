/**
 * The vault fingerprint: 128 bits drawn as four rings of arc segments.
 * Ring sizes are 44 + 36 + 28 + 20 = 128 segments, one bit each, read most
 * significant bit first (spec/crypto.md, "Vault fingerprint").
 */
const RINGS = [
  { radius: 55, segments: 44 },
  { radius: 46, segments: 36 },
  { radius: 37, segments: 28 },
  { radius: 28, segments: 20 },
] as const;
const CENTER = 60;
const GAP = 0.34; // fraction of a segment left empty between runs

export interface Arc {
  ring: number;
  start: number;
  end: number;
}

/** Expand bytes into bits, most significant bit first. */
export function toBits(bytes: Uint8Array): boolean[] {
  const bits: boolean[] = [];
  for (const byte of bytes) for (let i = 7; i >= 0; i--) bits.push(((byte >> i) & 1) === 1);
  return bits;
}

/**
 * Turn 16 fingerprint bytes into arcs. Consecutive set bits on a ring merge
 * into one arc; a ring with every bit set is drawn as one full circle.
 */
export function fingerprintArcs(bytes: Uint8Array): Arc[] {
  if (bytes.length !== 16) throw new Error('A fingerprint is 16 bytes');
  const bits = toBits(bytes);
  const arcs: Arc[] = [];
  let offset = 0;
  RINGS.forEach(({ segments }, ring) => {
    const ringBits = bits.slice(offset, offset + segments);
    offset += segments;
    const seg = (Math.PI * 2) / segments;
    const firstOff = ringBits.indexOf(false);
    if (firstOff === -1) {
      arcs.push({ ring, start: 0, end: Math.PI * 2 });
      return;
    }
    let runStart: number | null = null;
    // Walk once around the ring starting just after an unset bit, so runs never wrap.
    for (let k = 1; k <= segments; k++) {
      const idx = (firstOff + k) % segments;
      if (ringBits[idx]) {
        if (runStart === null) runStart = firstOff + k;
      } else if (runStart !== null) {
        const start = runStart * seg - Math.PI / 2 + (seg * GAP) / 2;
        const end = (firstOff + k) * seg - Math.PI / 2 - (seg * GAP) / 2;
        arcs.push({ ring, start, end });
        runStart = null;
      }
    }
  });
  return arcs;
}

function arcPath(radius: number, start: number, end: number): string {
  if (end - start >= Math.PI * 2 - 1e-9) {
    // Full circle: two half arcs, since one SVG arc can't start and end at the same point.
    return `M${CENTER - radius} ${CENTER}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0`;
  }
  const x0 = CENTER + radius * Math.cos(start);
  const y0 = CENTER + radius * Math.sin(start);
  const x1 = CENTER + radius * Math.cos(end);
  const y1 = CENTER + radius * Math.sin(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${radius} ${radius} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export interface FingerprintProps {
  bytes: Uint8Array;
  size?: number;
  /** Show a lock in the middle (lock screen) or nothing (compact headers). */
  glyph?: 'lock' | 'none';
  /** Rotates rings in alternating directions, e.g. while typing a password. */
  turn?: number;
  /** Accessible description, e.g. the fingerprint code. */
  label?: string;
}

export function Fingerprint({
  bytes,
  size = 168,
  glyph = 'lock',
  turn = 0,
  label,
}: FingerprintProps) {
  const arcs = fingerprintArcs(bytes);
  const coreRadius = RINGS[3].radius - 8;
  const scale = coreRadius / 17;
  return (
    <svg
      className="pv-fp"
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {RINGS.map((r, ring) => (
        <g
          key={ring}
          className="pv-fp__ring"
          style={{ transform: `rotate(${turn * (ring % 2 ? -1 : 1) * (1 - ring * 0.18)}deg)` }}
        >
          {arcs
            .filter((a) => a.ring === ring)
            .map((a, i) => (
              <path
                key={i}
                className={ring % 2 ? 'pv-fp__b' : 'pv-fp__a'}
                d={arcPath(r.radius, a.start, a.end)}
              />
            ))}
        </g>
      ))}
      <circle className="pv-fp__core" cx={CENTER} cy={CENTER} r={coreRadius} />
      {glyph === 'lock' && (
        <g
          className="pv-fp__glyph"
          transform={`translate(${CENTER - 12 * scale} ${CENTER - 12.5 * scale}) scale(${scale})`}
        >
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </g>
      )}
    </svg>
  );
}
