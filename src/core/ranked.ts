import { simulateBattle } from './battle';
import { hash32, Rng } from './rng';
import { statsFromColors, type Stats } from './stats';
import { growWildDot } from './wild';
import type { Pixel } from './types';

/*
 * Practice ranked battles (ランク戦・練習): the player's representative (a
 * finished creature from the collection) fights CPU rivals for rank points;
 * more points bring stronger rivals, so a
 * creature's points settle where its win rate drops to about 43%.
 * Seasons are calendar months.
 * Everything here is pure; storage lives in the repository.
 */

export const START_RATING = 1000;
export const RANKED_DAILY_LIMIT = 10;
/** Rank points per result. Wins count a little more than losses, so steady play climbs. */
export const WIN_POINTS = 20;
export const DRAW_POINTS = 5;
export const LOSS_POINTS = -15;

export interface RankTier {
  id: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
  name: string;
  icon: string;
  min: number;
  /** Coins given once for the best rank reached in a season. */
  seasonCoins: number;
}

export const TIERS: readonly RankTier[] = [
  { id: 'bronze', name: 'ブロンズ', icon: '🥉', min: 1000, seasonCoins: 10 },
  { id: 'silver', name: 'シルバー', icon: '🥈', min: 1100, seasonCoins: 20 },
  { id: 'gold', name: 'ゴールド', icon: '🥇', min: 1250, seasonCoins: 40 },
  { id: 'platinum', name: 'プラチナ', icon: '💠', min: 1400, seasonCoins: 70 },
  { id: 'diamond', name: 'ダイヤ', icon: '💎', min: 1600, seasonCoins: 100 },
];

export function tierOf(rating: number): RankTier {
  let t = TIERS[0];
  for (const x of TIERS) if (rating >= x.min) t = x;
  return t;
}

/** The next tier and the points still needed, or null at the top. */
export function nextTier(rating: number): { tier: RankTier; need: number } | null {
  const t = TIERS.find((x) => x.min > rating);
  return t ? { tier: t, need: t.min - rating } : null;
}

/** New points after a result. A loss never drops you below the rank you are in. */
export function applyResult(rating: number, result: 'win' | 'loss' | 'draw'): number {
  const delta = result === 'win' ? WIN_POINTS : result === 'draw' ? DRAW_POINTS : LOSS_POINTS;
  return Math.max(tierOf(rating).min, rating + delta);
}

/** Season key: the local calendar month. */
export function seasonOf(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function seasonLabel(season: string): string {
  const [y, m] = season.split('-');
  return `${y}年${Number(m)}月シーズン`;
}

/** A new season starts one rank lower than where the last one ended (never below the start). */
export function softReset(r: number): number {
  const i = TIERS.indexOf(tierOf(r));
  return TIERS[Math.max(0, i - 1)].min;
}

const RIVAL_NAMES = ['ぴこ', 'もこ', 'ぷに', 'るる', 'ちび', 'まる', 'こむぎ', 'しらたま', 'ぽん', 'みかん', 'くるみ', 'あずき', 'ソラ', 'ハク', 'ジン', 'レオ', 'カイ', 'ノア', 'ルカ', 'ミオ'];

/** A fixed, balanced yardstick used to compare rival candidates. */
const YARDSTICK: Stats[] = [
  { hp: 185, stamina: 185, strength: 25, defense: 25, speed: 25, luck: 25 },
  { hp: 200, stamina: 170, strength: 40, defense: 20, speed: 20, luck: 20 },
  { hp: 170, stamina: 200, strength: 20, defense: 20, speed: 20, luck: 40 },
];

/** Rough strength: win share against the yardstick (deterministic). */
export function powerOf(stats: Stats): number {
  let w = 0, n = 0;
  YARDSTICK.forEach((y, k) => {
    for (let s = 0; s < 8; s++) {
      const r = simulateBattle({ name: 'x', stats }, { name: 'y', stats: y }, hash32(k * 31 + s, 'yardstick'));
      w += r.winner === 'a' ? 1 : r.winner === 'draw' ? 0.5 : 0;
      n++;
    }
  });
  return w / n;
}

/** Candidates grown per rival; one is picked by strength to suit the rating. */
export const RIVAL_CANDIDATES = 6;

/** 0..1: how strong a rival to pick among the candidates (weakest .. strongest) for the points. */
export function rivalStrength(rating: number): number {
  return Math.max(0, Math.min(1, (rating - START_RATING) / 600));
}

export interface Rival {
  name: string;
  rating: number;
  pixels: Pixel[];
  stats: Stats;
}

/**
 * A CPU rival for a player at `rating`, grown with the normal rules (so its
 * stats come from its colours): low ratings meet weaker rivals, high ratings
 * stronger ones, so a creature settles where it wins about half the time.
 */
export function makeRival(seed: number, rating: number): Rival {
  const r = new Rng(hash32(seed, 'rival'));
  const cands = Array.from({ length: RIVAL_CANDIDATES }, (_, i) => {
    const pixels = growWildDot(hash32(seed, `rival-${i}`), 721);
    const stats = statsFromColors(pixels.map((p) => p.color));
    return { pixels, stats, power: powerOf(stats) };
  }).sort((a, b) => a.power - b.power);
  const pick = cands[Math.round(rivalStrength(rating) * (RIVAL_CANDIDATES - 1))];
  return { name: `ライバル・${r.pick(RIVAL_NAMES)}`, rating: Math.max(START_RATING, rating + r.int(41) - 20), pixels: pick.pixels, stats: pick.stats };
}

export interface RankedRecord {
  season: string;
  rating: number;
  best: number;
  wins: number;
  losses: number;
  draws: number;
  /** Ranked battles played on `day` (daily limit). */
  day: string;
  played: number;
  history: { at: number; rival: string; rivalRating: number; result: 'win' | 'loss' | 'draw'; delta: number }[];
  /** Seasons whose reward was already given. */
  rewarded: string[];
}

export function freshRecord(season: string, day: string): RankedRecord {
  return { season, rating: START_RATING, best: START_RATING, wins: 0, losses: 0, draws: 0, day, played: 0, history: [], rewarded: [] };
}

/**
 * Roll a record into the current season and day. A finished season gives its
 * reward (by the best rank reached) once, then the rating is soft-reset.
 */
export function rollRecord(rec: RankedRecord, season: string, day: string): { rec: RankedRecord; reward: { season: string; tier: RankTier } | null } {
  let reward: { season: string; tier: RankTier } | null = null;
  let next = rec;
  if (rec.season !== season) {
    const played = rec.wins + rec.losses + rec.draws > 0;
    if (played && !rec.rewarded.includes(rec.season)) reward = { season: rec.season, tier: tierOf(rec.best) };
    const r = softReset(rec.rating);
    next = { ...rec, season, rating: r, best: r, wins: 0, losses: 0, draws: 0, history: [], rewarded: reward ? [...rec.rewarded, rec.season].slice(-24) : rec.rewarded };
  }
  if (next.day !== day) next = { ...next, day, played: 0 };
  return { rec: next, reward };
}
