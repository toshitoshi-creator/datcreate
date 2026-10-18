import { Rng } from './rng';
import type { Stats } from './stats';

export interface Fighter {
  name: string;
  stats: Stats;
}

export type Side = 'a' | 'b';

export interface BattleEvent {
  actor: Side;
  kind: 'attack' | 'critical' | 'dodge' | 'rest' | 'quick' | 'ko' | 'timeup';
  damage: number;
  hp: Record<Side, number>;
  stamina: Record<Side, number>;
}

export interface BattleResult {
  events: BattleEvent[];
  winner: Side | 'draw';
}

/*
 * Tuned so that no leading stat dominates: over many grown creatures, those
 * led by つよさ / まもり / すばやさ / 運 each win about half their battles
 * (scripts/balance.ts reports it; tests/unit/stats.test.ts guards it).
 */
const ATTACK_COST = 18;
const REST_GAIN = 36;
const MAX_ROUNDS = 40;
const BASE_DAMAGE = 18;
/** Strength / defense scale damage by (1 + s / 54) / (1 + d / 39). */
const STRENGTH_SCALE = 54;
const DEFENSE_SCALE = 39;
/** Dodge: a base chance, plus being faster than the attacker, plus a little luck. */
const DODGE_BASE = 0.08;
const DODGE_PER_SPEED = 0.0037;
const DODGE_PER_LUCK = 0.0044;
/** Critical hits come from luck (at most 60%). */
const CRIT_PER_LUCK = 0.0095;
const CRIT_MAX = 0.6;
const CRIT_MULT = 2.1;
/** The faster one sometimes gets a quick extra move. */
const QUICK_PER_SPEED = 0.0047;
/** Tired creatures hit softer: damage scales from (1 - FATIGUE) at no stamina to full at 200. */
const FATIGUE = 0.4;

/**
 * A small automatic battle. Speed decides who moves first, helps dodging and
 * can give a quick extra move; strength vs defense sets damage; luck gives
 * critical hits and a little dodging; every attack uses stamina (a tired
 * creature rests instead). Deterministic for a seed. Battles never affect growth.
 */
export function simulateBattle(a: Fighter, b: Fighter, seed: number): BattleResult {
  const r = new Rng(seed);
  const f: Record<Side, Fighter> = { a, b };
  const hp: Record<Side, number> = { a: a.stats.hp, b: b.stats.hp };
  const st: Record<Side, number> = { a: a.stats.stamina, b: b.stats.stamina };
  const events: BattleEvent[] = [];
  const push = (actor: Side, kind: BattleEvent['kind'], damage = 0) =>
    events.push({ actor, kind, damage, hp: { ...hp }, stamina: { ...st } });
  const other = (s: Side): Side => (s === 'a' ? 'b' : 'a');

  /** One move; true when it knocked the other out. */
  const act = (me: Side): boolean => {
    const you = other(me);
    const atk = f[me].stats, def = f[you].stats;
    if (st[me] < ATTACK_COST) {
      st[me] = Math.min(atk.stamina, st[me] + REST_GAIN);
      push(me, 'rest');
      return false;
    }
    const vigor = 1 - FATIGUE + (FATIGUE * st[me]) / 200;
    st[me] -= ATTACK_COST;
    const dodge = Math.min(0.5, Math.max(0.03, DODGE_BASE + (def.speed - atk.speed) * DODGE_PER_SPEED + def.luck * DODGE_PER_LUCK));
    if (r.chance(dodge)) {
      push(me, 'dodge');
      return false;
    }
    let damage = ((BASE_DAMAGE * (1 + atk.strength / STRENGTH_SCALE)) / (1 + def.defense / DEFENSE_SCALE)) * vigor * r.range(0.85, 1.15);
    const crit = r.chance(Math.min(CRIT_MAX, atk.luck * CRIT_PER_LUCK));
    if (crit) damage *= CRIT_MULT;
    const dmg = Math.max(1, Math.round(damage));
    hp[you] = Math.max(0, hp[you] - dmg);
    push(me, crit ? 'critical' : 'attack', dmg);
    if (hp[you] === 0) {
      push(you, 'ko');
      return true;
    }
    return false;
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const sa = a.stats.speed + r.next() * 10, sb = b.stats.speed + r.next() * 10;
    const order: Side[] = sa >= sb ? ['a', 'b'] : ['b', 'a'];
    for (const me of order) {
      if (act(me)) return { events, winner: me };
      const edge = (f[me].stats.speed - f[other(me)].stats.speed) * QUICK_PER_SPEED;
      if (edge > 0 && r.chance(edge)) {
        push(me, 'quick');
        if (act(me)) return { events, winner: me };
      }
    }
  }
  const ra = hp.a / a.stats.hp, rb = hp.b / b.stats.hp;
  push(ra >= rb ? 'a' : 'b', 'timeup');
  return { events, winner: Math.abs(ra - rb) < 0.02 ? 'draw' : ra > rb ? 'a' : 'b' };
}
