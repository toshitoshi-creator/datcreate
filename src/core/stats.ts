import { hexToHsl } from './color';
import { COMPLETE_GROWTH_INDEX } from './constants';

/**
 * Battle stats derived only from a creature's dots (their colours and count).
 * Pure and deterministic: the same dots always give the same stats, and the
 * stats change as new dots are added.
 *
 *  - つよさ (strength)  : reds / oranges
 *  - すばやさ (speed)    : yellows / greens
 *  - まもり (defense)    : blues, and dark dots
 *  - 運 (luck)           : purples / pinks, and very light "sparkly" dots
 *  These four always add up to exactly 100.
 *  - HP / スタミナ: grow with body size up to 200; warm colours lean to HP,
 *    cool colours to stamina.
 */
export interface Stats {
  hp: number;
  stamina: number;
  strength: number;
  defense: number;
  speed: number;
  luck: number;
}

export const STAT_MAX = { hp: 200, stamina: 200 } as const;

export const STAT_LABEL: Record<keyof Stats, string> = {
  hp: 'HP',
  stamina: 'スタミナ',
  strength: 'つよさ',
  defense: 'まもり',
  speed: 'すばやさ',
  luck: '運',
};

const CENTRES = { strength: 15, speed: 100, defense: 225, luck: 295 } as const;
const WIDTHS = { strength: 55, speed: 70, defense: 60, luck: 50 } as const;
type Core = keyof typeof CENTRES;
const CORE: Core[] = ['strength', 'defense', 'speed', 'luck'];

const hueDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Split `total` into integers proportional to `weights` (largest remainder), each at least `min`. */
export function apportion(weights: number[], total: number, min = 0): number[] {
  const free = total - min * weights.length;
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const raw = weights.map((w) => (w / sum) * free);
  const out = raw.map((r) => Math.floor(r));
  let rest = free - out.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]]++;
  return out.map((v) => v + min);
}

export function statsFromColors(colors: readonly string[]): Stats {
  const acc: Record<Core, number> = { strength: 0, defense: 0, speed: 0, luck: 0 };
  let warm = 0, cool = 0;
  for (const hex of colors) {
    const { h, s, l } = hexToHsl(hex);
    const chroma = s * (1 - Math.abs(2 * l - 1)); // how "coloured" the dot is
    for (const k of CORE) acc[k] += chroma * Math.max(0, 1 - hueDist(h, CENTRES[k]) / WIDTHS[k]);
    const neutral = 1 - chroma;
    if (l < 0.3) acc.defense += 0.6 * neutral; // dark dots: sturdy
    else if (l > 0.85) acc.luck += 0.6 * neutral; // bright, sparkly dots: lucky
    else for (const k of CORE) acc[k] += 0.08 * neutral; // greys: a little of everything
    const isWarm = hueDist(h, 20) < 80 || hueDist(h, 330) < 30;
    if (isWarm) warm += chroma;
    else cool += chroma;
  }
  const n = colors.length;
  // a small floor keeps every stat alive, then the four add up to exactly 100
  const weights = CORE.map((k) => acc[k] + Math.max(0.5, n * 0.04));
  const [strength, defense, speed, luck] = apportion(weights, 100, 4);
  const size = Math.min(1, n / (COMPLETE_GROWTH_INDEX + 1));
  // warm share, softened so HP / stamina lean rather than flip
  const tint = 0.5 + ((warm + cool > 0 ? warm / (warm + cool) : 0.5) - 0.5) * 0.6;
  // tint is within 0.2..0.8, so the warmest / coolest grown-up bodies reach exactly 200
  const hp = Math.max(10, Math.min(STAT_MAX.hp, Math.round(STAT_MAX.hp * size * (0.8 + 0.25 * tint))));
  const stamina = Math.max(10, Math.min(STAT_MAX.stamina, Math.round(STAT_MAX.stamina * size * (0.8 + 0.25 * (1 - tint)))));
  return { hp, stamina, strength, defense, speed, luck };
}
