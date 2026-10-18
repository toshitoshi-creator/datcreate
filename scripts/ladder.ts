/**
 * Where creatures settle on the practice ladder: plays N ranked battles for a
 * few creatures and prints their final rating / rank, and how long a rival takes to make.
 *   npx vite-node scripts/ladder.ts [creatures=8] [battles=150]
 */
import { simulateBattle } from '../src/core/battle';
import { applyResult, makeRival, START_RATING, tierOf } from '../src/core/ranked';
import { statsFromColors } from '../src/core/stats';
import { growWildDot } from '../src/core/wild';

const C = Number(process.argv[2] ?? 8), B = Number(process.argv[3] ?? 150);
let made = 0, madeMs = 0;
for (let c = 0; c < C; c++) {
  const stats = statsFromColors(growWildDot(c * 7777 + 11, 721).map((p) => p.color));
  let r = START_RATING, best = r;
  for (let b = 0; b < B; b++) {
    const t = Date.now();
    const rival = makeRival(c * 100000 + b, r);
    madeMs += Date.now() - t; made++;
    const w = simulateBattle({ name: 'me', stats }, { name: rival.name, stats: rival.stats }, c * 31 + b).winner;
    r = applyResult(r, w === 'a' ? 'win' : w === 'draw' ? 'draw' : 'loss');
    best = Math.max(best, r);
  }
  console.log(`creature ${c}: rating ${r} (${tierOf(r).name}), best ${best} (${tierOf(best).name})  ${JSON.stringify(stats)}`);
}
console.log(`rival: ${(madeMs / made).toFixed(0)} ms on average`);
