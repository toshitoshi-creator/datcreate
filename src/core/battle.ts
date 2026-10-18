import { Rng } from './rng';
import type { Stats } from './stats';

export interface Fighter {
  name: string;
  stats: Stats;
}

export type Side = 'a' | 'b';

export interface BattleEvent {
  actor: Side;
  kind: 'attack' | 'critical' | 'dodge' | 'rest' | 'ko' | 'timeup';
  damage: number;
  hp: Record<Side, number>;
  stamina: Record<Side, number>;
}

export interface BattleResult {
  events: BattleEvent[];
  winner: Side | 'draw';
}

const ATTACK_COST = 12;
const REST_GAIN = 36;
const MAX_ROUNDS = 40;

/**
 * A small automatic battle. Speed decides who moves first and helps dodging,
 * strength vs defense sets damage, luck gives critical hits, and every attack
 * uses stamina (a tired creature rests instead). Deterministic for a seed.
 * Battles never affect growth.
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

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const sa = a.stats.speed + r.next() * 10, sb = b.stats.speed + r.next() * 10;
    const order: Side[] = sa >= sb ? ['a', 'b'] : ['b', 'a'];
    for (const me of order) {
      const you = other(me);
      if (st[me] < ATTACK_COST) {
        st[me] = Math.min(f[me].stats.stamina, st[me] + REST_GAIN);
        push(me, 'rest');
        continue;
      }
      st[me] -= ATTACK_COST;
      const dodge = f[you].stats.speed / 420 + f[you].stats.luck / 1200;
      if (r.chance(dodge)) {
        push(me, 'dodge');
        continue;
      }
      const atk = f[me].stats;
      let damage = (6 + atk.strength * 0.7) * (100 / (100 + f[you].stats.defense * 2.2)) * r.range(0.85, 1.15);
      const crit = r.chance(atk.luck / 250);
      if (crit) damage *= 1.6;
      const dmg = Math.max(1, Math.round(damage));
      hp[you] = Math.max(0, hp[you] - dmg);
      push(me, crit ? 'critical' : 'attack', dmg);
      if (hp[you] === 0) {
        push(you, 'ko');
        return { events, winner: me };
      }
    }
  }
  const ra = hp.a / a.stats.hp, rb = hp.b / b.stats.hp;
  push(ra >= rb ? 'a' : 'b', 'timeup');
  return { events, winner: Math.abs(ra - rb) < 0.02 ? 'draw' : ra > rb ? 'a' : 'b' };
}
