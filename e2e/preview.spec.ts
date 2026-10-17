import { test } from '@playwright/test';

/**
 * Dev tool (skipped by default): renders individuals in the real app for visual
 * tuning. PREVIEW_DIR=/some/dir PREVIEW=seedIndex:dots,... npx playwright test preview
 */
test.skip(!process.env.PREVIEW_DIR, 'set PREVIEW_DIR to render previews');
import { HOUR_MS, SAVE_FORMAT } from '../src/core/constants';
import { Simulation } from '../src/core/generator';
import { timeOfDayFromHour } from '../src/core/time';

const CASES = (process.env.PREVIEW ?? '17:250,17:720,18:720,19:720,20:720,21:2200').split(',');
for (const c of CASES) {
  const [k, n] = c.split(':').map(Number);
  test(`preview ${c}`, async ({ page }) => {
    const seed = (k * 2654435761) >>> 0;
    const startedAt = Date.now() - (n - 1) * HOUR_MS - 60_000;
    const game = { gameId: 'pv', startedAt, lastProcessedGrowthIndex: n - 1, schemaVersion: 1, generatorVersion: 3, initialSeed: seed, style: (process.env.STYLE ?? 'cute') as 'cute' | 'cool' | 'ghost' | 'ghostCool', createdAt: startedAt, updatedAt: startedAt, lastObservedAt: startedAt };
    const sim = new Simulation(game);
    const pixels = [];
    for (let i = 0; i < n; i++) {
      const t = startedAt + i * HOUR_MS, h = new Date(t).getHours();
      pixels.push(sim.generateNext({ createdAt: t, env: { timeOfDay: timeOfDayFromHour(h), localHour: h, weather: (['clear', 'cloudy', 'rain', 'unknown'] as const)[Math.floor(i / 20) % 4], environmentInfluence: 0.6, organicShapeBias: 0.6 }, environmentSnapshotId: null }).pixel);
    }
    await page.goto('/');
    await page.getByTestId('start-button').click();
    await page.getByTestId('open-settings').click();
    await page.getByTestId('import-file').setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: SAVE_FORMAT, schemaVersion: 1, exportedAt: 0, game, pixels, environmentLogs: [], milestones: [] })) });
    await page.getByTestId('confirm-import').click();
    await page.getByTestId('settings-message').waitFor();
    await page.getByTestId('close-settings').click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${process.env.PREVIEW_DIR}/${c.replace(':', '-')}.png` });
  });
}
