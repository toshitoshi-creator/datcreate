export interface Hsl {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function wrapHue(h: number): number {
  const r = h % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed shortest hue difference b - a in (-180, 180]. */
export function hueDelta(a: number, b: number): number {
  let d = wrapHue(b) - wrapHue(a);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Move hue `from` toward `to` by fraction t. */
export function pullHue(from: number, to: number, t: number): number {
  return wrapHue(from + hueDelta(from, to) * t);
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hh = wrapHue(h) / 360;
  const ss = clamp(s, 0, 1);
  const ll = clamp(l, 0, 1);
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const conv = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const to = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  if (ss === 0) return `#${to(ll)}${to(ll)}${to(ll)}`;
  return `#${to(conv(hh + 1 / 3))}${to(conv(hh))}${to(conv(hh - 1 / 3))}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function hexToHsl(hex: string): Hsl {
  const [r8, g8, b8] = hexToRgb(hex);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/;
