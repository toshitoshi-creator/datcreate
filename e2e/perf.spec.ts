import { expect, test } from '@playwright/test';
import { HOUR_MS, SAVE_FORMAT } from '../src/core/constants';
import { Simulation } from '../src/core/generator';
import { timeOfDayFromHour } from '../src/core/time';

/**
 * Real-time (no fake clock) rendering measurement with a 10,000-dot save,
 * imported through the normal UI. Numbers depend on the machine; they are
 * reported, and only a loose bound is asserted.
 */
test('10,000-dot save: import, render, zoom/pan frame times', async ({ page }, info) => {
  test.setTimeout(180_000);
  const N = 10_000;
  const startedAt = Date.now() - (N - 1) * HOUR_MS - 10 * 60_000;
  const game = { gameId: 'perf', startedAt, lastProcessedGrowthIndex: N - 1, schemaVersion: 1, generatorVersion: 1, initialSeed: 123456789, createdAt: startedAt, updatedAt: startedAt, lastObservedAt: startedAt };
  const sim = new Simulation(game);
  const pixels = [];
  for (let i = 0; i < N; i++) {
    const t = startedAt + i * HOUR_MS;
    const h = new Date(t).getHours();
    const pixel = sim.generateNext({ createdAt: t, env: { timeOfDay: timeOfDayFromHour(h), localHour: h, weather: 'unknown', environmentInfluence: 0.6, organicShapeBias: 0.6 }, environmentSnapshotId: null }).pixel;
    pixels.push({ ...pixel, id: `perf:${i}`, gameId: 'perf' });
  }
  const save = JSON.stringify({ format: SAVE_FORMAT, schemaVersion: 1, exportedAt: Date.now(), game, pixels, environmentLogs: [], milestones: [] });

  await page.goto('/');
  await page.getByTestId('start-button').click();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'perf.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  const t0 = Date.now();
  await page.getByTestId('confirm-import').click();
  await expect(page.getByTestId('settings-message')).toContainText('読み込みました', { timeout: 60_000 });
  const importMs = Date.now() - t0;
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('dot-count')).toHaveText('10,000');

  const t1 = Date.now();
  await page.reload();
  await expect(page.getByTestId('dot-count')).toHaveText('10,000');
  const reloadMs = Date.now() - t1;

  const canvas = page.getByTestId('creature-canvas');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/shots/perf-10k-before.png' });
  const frames: number[] = [];
  const box = (await canvas.boundingBox())!;
  for (let i = 0; i < 30; i++) {
    if (i % 3 === 0) await page.getByTestId(i % 2 ? 'zoom-in' : 'zoom-out').click();
    else {
      await page.mouse.move(box.width / 2, box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.width / 2 + (i % 2 ? 40 : -40), box.height / 2 + (i % 2 ? 20 : -20), { steps: 4 });
      await page.mouse.up();
    }
    await page.waitForTimeout(30);
    frames.push(Number(await canvas.getAttribute('data-frame-ms')));
  }
  frames.sort((a, b) => a - b);
  const median = frames[15];
  const p95 = frames[Math.floor(frames.length * 0.95)];
  const env = `headless Chromium ${page.context().browser()?.version()}, ${process.platform}/${process.arch}, viewport 390x844@3x`;
  const msg = `import ${importMs} ms, reload-to-ready ${reloadMs} ms, draw median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms (${env})`;
  console.log(`[perf] ${msg}`);
  info.annotations.push({ type: 'perf', description: msg });
  await page.getByTestId('zoom-fit').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/shots/perf-10k.png' });
  expect(median).toBeLessThan(16);
});
