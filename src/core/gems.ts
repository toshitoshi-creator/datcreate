import { hash32 } from './rng';
import type { EnvUsed } from './types';

/**
 * Precious dots (きらきらドット): now and then a new dot comes out as silver,
 * gold, platinum or diamond. They sparkle on screen and raise the creature's
 * ability total; more and rarer ones grow a stronger creature.
 *
 * Whether a dot becomes one depends on the weather, the time of day, when the
 * app was opened (the dots processed at that launch share its "luck"), and the
 * place (if location is on) — so it is partly chance, partly circumstance.
 * The result is stored on the pixel, so it never changes afterwards.
 */
export type GemKind = 'silver' | 'gold' | 'platinum' | 'diamond';

export interface GemDef {
  kind: GemKind;
  name: string;
  icon: string;
  /** Display colour (the stored colour still drives the stat leaning). */
  color: string;
  /** Ability total bonus per dot. */
  points: number;
}

export const GEMS: Record<GemKind, GemDef> = {
  silver: { kind: 'silver', name: 'シルバー', icon: '🥈', color: '#b9c4d6', points: 1 },
  gold: { kind: 'gold', name: 'ゴールド', icon: '🥇', color: '#f5c84c', points: 2 },
  platinum: { kind: 'platinum', name: 'プラチナ', icon: '💠', color: '#d8c8ff', points: 3 },
  diamond: { kind: 'diamond', name: 'ダイヤ', icon: '💎', color: '#a9f0ff', points: 6 },
};

export const GEM_ORDER: readonly GemKind[] = ['diamond', 'platinum', 'gold', 'silver'];

export interface GemContext {
  initialSeed: number;
  growthIndex: number;
  env: EnvUsed;
  /** When the app processed this dot (the launch / live moment), ms epoch. */
  processedAt: number;
  /** Coarse place code, or null when location is off. */
  place: number | null;
  /** Dots of the face (eyes, mouth...) never turn precious. */
  inFace: boolean;
}

/** Per-dot chances (before luck) under the given weather / time of day. */
export function gemRates(env: EnvUsed): Record<GemKind, number> {
  const { weather: w, timeOfDay: t } = env;
  const clear = w === 'clear';
  return {
    gold: 0.004 * (clear && (t === 'morning' || t === 'day') ? 2.5 : 1),
    silver: 0.005 * (t === 'night' ? 2 : 1) * (w === 'rain' || w === 'cloudy' ? 1.5 : 1),
    platinum: 0.0025 * (w === 'snow' || w === 'fog' ? 3 : 1) * (t === 'evening' ? 1.6 : 1),
    diamond: 0.0006 * (clear && t === 'night' ? 3 : 1) * (w === 'storm' ? 2 : 1),
  };
}

const unit = (h: number) => (h >>> 0) / 4294967296;

/** The "luck" of a launch (10-minute window) for this creature: 0.6 .. 1.6. */
export function launchLuck(initialSeed: number, processedAt: number): number {
  return 0.6 + unit(hash32(initialSeed, Math.floor(processedAt / 600_000), 'launch-luck'));
}

/** The "luck" of a place for this creature: 0.8 .. 1.4 (1 when location is off). */
export function placeLuck(initialSeed: number, place: number | null): number {
  return place === null ? 1 : 0.8 + 0.6 * unit(hash32(initialSeed, place, 'place-luck'));
}

export function rollGem(c: GemContext): GemKind | null {
  if (c.inFace || c.growthIndex < 30) return null;
  const luck = launchLuck(c.initialSeed, c.processedAt) * placeLuck(c.initialSeed, c.place);
  const rates = gemRates(c.env);
  let u = unit(hash32(c.initialSeed, c.growthIndex, c.processedAt, c.place ?? 'none', 'gem'));
  for (const k of GEM_ORDER) {
    const p = rates[k] * luck;
    if (u < p) return k;
    u -= p;
  }
  return null;
}

export function countGems(pixels: readonly { gem?: GemKind | null }[]): Record<GemKind, number> {
  const n: Record<GemKind, number> = { silver: 0, gold: 0, platinum: 0, diamond: 0 };
  for (const p of pixels) if (p.gem) n[p.gem]++;
  return n;
}

export function gemPoints(pixels: readonly { gem?: GemKind | null }[]): number {
  let s = 0;
  for (const p of pixels) if (p.gem) s += GEMS[p.gem].points;
  return s;
}
