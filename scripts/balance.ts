/**
 * Battle balance report: grows real creatures, then plays everyone against
 * everyone and reports win rates by leading stat and per-stat correlation.
 *   npx vite-node scripts/balance.ts [creatures=60] [seedsPerPair=20]
 */
import { simulateBattle } from '../src/core/battle';
import { statsFromColors, statsOf, type Stats } from '../src/core/stats';
import { growWildDot } from '../src/core/wild';

const N = Number(process.argv[2] ?? 60);
const S = Number(process.argv[3] ?? 20);
const CORE = ['strength', 'defense', 'speed', 'luck'] as const;

const t0 = Date.now();
const pool: Stats[] = [];
// EQUAL=1: everyone at total 100 (pure leaning balance); otherwise real totals with precious dots
const EQUAL = process.env.EQUAL === '1';
for (let k = 0; k < N; k++) {
  const px = growWildDot((k * 2654435761 + 17) >>> 0, 721);
  pool.push(EQUAL ? statsFromColors(px.map((p) => p.color)) : statsOf(px));
}
console.log(`grew ${N} creatures in ${Date.now() - t0} ms`);

const wins = new Array(N).fill(0), games = new Array(N).fill(0);
for (let i = 0; i < N; i++)
  for (let j = 0; j < N; j++) {
    if (i === j) continue;
    for (let s = 0; s < S; s++) {
      const r = simulateBattle({ name: 'a', stats: pool[i] }, { name: 'b', stats: pool[j] }, i * 100003 + j * 101 + s);
      games[i]++;
      games[j]++;
      if (r.winner === 'a') wins[i]++;
      else if (r.winner === 'b') wins[j]++;
      else { wins[i] += 0.5; wins[j] += 0.5; }
    }
  }
const rate = pool.map((_, i) => wins[i] / games[i]);
const top = (s: Stats) => CORE.reduce((a, b) => (s[a] >= s[b] ? a : b));
const by: Record<string, number[]> = {};
pool.forEach((s, i) => (by[top(s)] ??= []).push(rate[i]));
for (const k of CORE) {
  const r = by[k] ?? [];
  const tt = pool.filter((s) => top(s) === k).map((s) => s.strength + s.defense + s.speed + s.luck);
  console.log(`${k.padEnd(9)} n=${String(r.length).padStart(3)} win=${r.length ? ((r.reduce((a, b) => a + b, 0) / r.length) * 100).toFixed(1) : '-'}%  avg total ${tt.length ? (tt.reduce((a, b) => a + b, 0) / tt.length).toFixed(1) : '-'}`);
}
const corr = (xs: number[], ys: number[]) => {
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
  return sxy / Math.sqrt(sxx * syy || 1);
};
{
  const tot = pool.map((s) => s.strength + s.defense + s.speed + s.luck);
  console.log(`corr total     ${corr(tot, rate).toFixed(2)}  range ${Math.min(...tot)}-${Math.max(...tot)}`);
}
for (const k of ['hp', 'stamina', ...CORE] as const) {
  const xs = pool.map((s) => s[k]);
  console.log(`corr ${k.padEnd(9)} ${corr(xs, rate).toFixed(2)}  range ${Math.min(...xs)}-${Math.max(...xs)}`);
}
const sorted = rate.map((r, i) => [r, i] as const).sort((a, b) => b[0] - a[0]);
console.log('best', sorted.slice(0, 3).map(([r, i]) => `${(r * 100).toFixed(0)}% ${JSON.stringify(pool[i])}`).join('\n     '));
console.log('worst', sorted.slice(-3).map(([r, i]) => `${(r * 100).toFixed(0)}% ${JSON.stringify(pool[i])}`).join('\n      '));
console.log(`spread: ${(sorted.at(-1)![0] * 100).toFixed(0)}% .. ${(sorted[0][0] * 100).toFixed(0)}%`);
