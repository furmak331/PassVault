/** Byte arrays backed by a plain ArrayBuffer, which is what Web Crypto accepts. */
export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8(text: string): Bytes {
  return encoder.encode(text);
}

export function fromUtf8(bytes: Bytes): string {
  return decoder.decode(bytes);
}

/** base64url without padding (RFC 4648 section 5). */
export function toBase64Url(bytes: Bytes): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Invalid base64url');
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function toHex(bytes: Bytes): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Bytes {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error('Invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
