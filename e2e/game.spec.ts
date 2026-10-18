import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const START = new Date('2026-10-17T09:37:00+09:00');
const HOUR = 3_600_000;

async function startGame(page: Page) {
  await page.clock.install({ time: START });
  await page.goto('/');
  await page.getByTestId('start-button').click();
  await expect(page.getByTestId('dot-count')).toHaveText('1');
}

async function disableAnimation(page: Page) {
  await page.getByTestId('open-settings').click();
  await page.getByTestId('toggle-animation').click();
  await page.getByTestId('close-settings').click();
}

/** Jump the page clock forward (like the app being left alone for `ms`). */
async function jump(page: Page, ms: number) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(now + ms);
}

/** Type and animal names must never be shown (it is a surprise). */
const HIDDEN_WORDS = /かわいい|かっこいい|おばけ|くま|いぬ|ひよこ|かえる|ハムスター|ぶた|ペンギン|きつね|おおかみ|こうもり|ふくろう|とら|ドラゴン/;

const count = (page: Page) => page.getByTestId('dot-count');

/** Wait until rendering settles, then read the canvas pixels. */
async function canvasSnapshot(page: Page) {
  await page.waitForTimeout(400);
  return page.getByTestId('creature-canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL());
}

test('a new game starts with one dot and grows one dot per real hour', async ({ page }) => {
  await startGame(page);
  await page.clock.fastForward(HOUR - 5_000);
  await page.waitForTimeout(1500);
  await expect(count(page)).toHaveText('1');
  await page.clock.fastForward(10_000);
  await expect(count(page)).toHaveText('2');
  await jump(page, 23 * HOUR);
  await expect(count(page)).toHaveText('25');
});

test('30 days -> 721 dots, keeps growing afterwards, offline growth applied on relaunch', async ({ page }) => {
  await startGame(page);
  await jump(page, 30 * 24 * HOUR);
  await expect(count(page)).toHaveText('721');
  await expect(page.getByTestId('completion-dialog')).toBeVisible();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/shots/day30.png' });
  // "close" the app (reload) and come back later: still waiting for the choice
  await jump(page, 48 * HOUR);
  await page.reload();
  await expect(count(page)).toHaveText('721');
  await page.getByTestId('keep-growing').click();
  await expect(count(page)).toHaveText('769');
  await expect(page.getByTestId('completion-dialog')).toHaveCount(0);
});

test('reload keeps positions and colours identical, and history persists', async ({ page }) => {
  await startGame(page);
  await disableAnimation(page);
  await jump(page, 10 * 24 * HOUR);
  await expect(count(page)).toHaveText('241');
  const before = await canvasSnapshot(page);
  await page.getByTestId('open-history').click();
  const milestonesBefore = await page.getByTestId('milestones').locator('li').count();
  expect(milestonesBefore).toBeGreaterThan(0);

  await page.reload();
  await expect(count(page)).toHaveText('241');
  expect(await canvasSnapshot(page)).toBe(before);
  await page.getByTestId('open-history').click();
  await expect(page.getByTestId('milestones').locator('li')).toHaveCount(milestonesBefore);
  await page.getByTestId('tab-dots').click();
  await expect(page.getByTestId('dot-log').locator('li').first()).toContainText('#241');
  await page.screenshot({ path: 'test-results/shots/history.png' });
});

test('clock moved backwards does not duplicate or remove dots', async ({ page }) => {
  await startGame(page);
  await jump(page, 5 * HOUR);
  await expect(count(page)).toHaveText('6');
  await page.clock.setSystemTime(START.getTime() - 2 * HOUR);
  await page.reload();
  await expect(page.getByTestId('clock-warning')).toBeVisible();
  await expect(count(page)).toHaveText('6');
});

test('weather API failure and denied location do not break growth', async ({ page, context }) => {
  await context.route(/open-meteo|openweathermap/, (r) => r.abort());
  await context.clearPermissions(); // geolocation not granted
  await startGame(page);
  await page.getByTestId('open-settings').click();
  await page.getByTestId('toggle-location').click();
  await expect(page.getByTestId('settings-message')).toBeVisible();
  await expect(page.getByTestId('toggle-location')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('close-settings').click();
  await jump(page, 3 * HOUR);
  await expect(count(page)).toHaveText('4');
});

test('weather failure with location granted still grows', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 35.68, longitude: 139.76 });
  await context.route(/open-meteo|openweathermap/, (r) => r.fulfill({ status: 500, body: 'down' }));
  await startGame(page);
  await page.getByTestId('open-settings').click();
  await page.getByTestId('toggle-location').click();
  await expect(page.getByTestId('weather-status')).toContainText('取得失敗');
  await page.getByTestId('close-settings').click();
  await jump(page, 2 * HOUR);
  await expect(count(page)).toHaveText('3');
});

test('weather success is shown and stored without showing coordinates', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 35.6812, longitude: 139.7671 });
  await context.route(/open-meteo/, (r) => r.fulfill({ json: { current: { weather_code: 61, temperature_2m: 14 } } }));
  await startGame(page);
  await page.getByTestId('open-settings').click();
  await page.getByTestId('toggle-location').click();
  await expect(page.getByTestId('weather-status')).toContainText('雨');
  await expect(page.locator('body')).not.toContainText('35.68');
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('weather')).toHaveText('雨');
});

test('export, reset with confirmation, and import restore the same individual', async ({ page }) => {
  await startGame(page);
  await disableAnimation(page);
  await jump(page, 3 * 24 * HOUR);
  await expect(count(page)).toHaveText('73');
  const before = await canvasSnapshot(page);

  await page.getByTestId('open-settings').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
  const file = await download.path();
  const json = JSON.parse(readFileSync(file!, 'utf8'));
  expect(json.format).toBe('dot-life-save');
  expect(json.pixels).toHaveLength(73);

  await page.getByTestId('reset-game').click();
  await expect(page.getByTestId('confirm-reset')).toBeDisabled();
  await page.getByTestId('reset-understood').check();
  await page.getByTestId('confirm-reset').click();
  await expect(page.getByTestId('start-button')).toBeVisible();

  await page.getByTestId('start-button').click();
  await page.getByTestId('open-settings').click();
  // invalid file is rejected and leaves the new game alone
  await page.getByTestId('import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"x"}') });
  await page.getByTestId('confirm-import').click();
  await expect(page.getByTestId('settings-message')).toContainText('セーブデータではありません');
  await page.getByTestId('import-file').setInputFiles(file!);
  await page.getByTestId('confirm-import').click();
  await expect(page.getByTestId('settings-message')).toContainText('読み込みました');
  await page.getByTestId('close-settings').click();
  await expect(count(page)).toHaveText('73');
  await page.getByTestId('zoom-fit').click();
  expect(await canvasSnapshot(page)).toBe(before);
});

test('10,000 dots: main screen renders, zooms and pans', async ({ page }, info) => {
  test.setTimeout(240_000);
  await startGame(page);
  const t0 = Date.now();
  await jump(page, 10_000 * HOUR);
  await page.getByTestId('keep-growing').click({ timeout: 60_000 });
  await expect(count(page)).toHaveText('10,001', { timeout: 180_000 });
  const catchUpMs = Date.now() - t0;
  const canvas = page.getByTestId('creature-canvas');
  await page.waitForTimeout(3000); // let the progressive reveal finish
  await page.screenshot({ path: 'test-results/shots/10k.png' });

  const zoom0 = Number(await canvas.getAttribute('data-zoom'));
  await page.getByTestId('zoom-in').click();
  await page.getByTestId('zoom-in').click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThan(zoom0 * 1.5);

  const x0 = Number(await canvas.getAttribute('data-cam-x'));
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.width / 2, box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.width / 2 + 120, box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number(await canvas.getAttribute('data-cam-x'))).toBeLessThan(x0);

  // pinch (two synthetic touch pointers moving apart)
  const z1 = Number(await canvas.getAttribute('data-zoom'));
  await canvas.evaluate((c) => {
    const ev = (type: string, id: number, x: number) =>
      c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: 400, pointerType: 'touch', bubbles: true }));
    ev('pointerdown', 11, 180); ev('pointerdown', 12, 210);
    for (let i = 1; i <= 10; i++) { ev('pointermove', 11, 180 - i * 6); ev('pointermove', 12, 210 + i * 6); }
    ev('pointerup', 11, 120); ev('pointerup', 12, 270);
  });
  await expect.poll(async () => Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThan(z1 * 1.5);

  await page.mouse.wheel(0, 600);
  console.log(`[perf] in-browser catch-up of 10,000 slots (generate + IndexedDB): ${catchUpMs} ms wall`);
  info.annotations.push({ type: 'perf', description: `catch-up 10,000 slots: ${catchUpMs} ms` });
});

test('start offers only cute / cool / random; the choice is kept after reload', async ({ page }) => {
  await page.clock.install({ time: START });
  await page.goto('/');
  await expect(page.locator('.style-option')).toHaveCount(3);
  await page.getByTestId('style-cool').click();
  await page.screenshot({ path: 'test-results/shots/start.png' });
  await page.getByTestId('start-button').click();
  await expect(count(page)).toHaveText('1');
  await page.reload();
  await expect(count(page)).toHaveText('1');
  // what the creature will become is a surprise: no type / animal names anywhere
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings-screen')).not.toContainText(HIDDEN_WORDS);
});

test('after 30 days a finished creature goes to the collection and a new one starts', async ({ page }) => {
  await startGame(page);
  await jump(page, 30 * 24 * HOUR);
  await expect(page.getByTestId('completion-dialog')).toBeVisible();
  await expect(page.getByTestId('gift')).toContainText('お礼のプレゼント');
  await page.getByTestId('start-new-creature').click();
  await expect(page.getByTestId('name-input')).toHaveValue('ドット1号');
  await page.getByTestId('name-input').fill('');
  await page.waitForTimeout(1500); // the screen re-renders every second; a cleared field must stay cleared
  await expect(page.getByTestId('name-input')).toHaveValue('');
  await page.getByTestId('name-submit').click();
  await expect(page.getByTestId('name-error')).toContainText('名前を入力');
  await page.getByTestId('name-input').fill('もちまる');
  await page.screenshot({ path: 'test-results/shots/naming.png' });
  await page.getByTestId('name-submit').click();
  await expect(page.getByTestId('start-button')).toBeVisible();
  await expect(page.getByTestId('start-open-collection')).toHaveText('図鑑を見る（1）');
  await page.getByTestId('style-random').click();
  await page.getByTestId('start-button').click();
  await expect(count(page)).toHaveText('1');

  // a second creature may share the same name
  await jump(page, 30 * 24 * HOUR);
  await page.getByTestId('start-new-creature').click();
  await page.getByTestId('name-input').fill('もちまる');
  await page.getByTestId('name-submit').click();
  await page.getByTestId('start-button').click();
  await expect(count(page)).toHaveText('1');

  await page.getByTestId('open-collection').click();
  await expect(page.getByTestId('collection-item')).toHaveCount(2);
  await expect(page.getByTestId('collection-name')).toHaveText(['もちまる', 'もちまる']);
  await expect(page.getByTestId('collection-item').first()).toContainText('721 dots');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/shots/collection.png' });
  await expect(page.getByTestId('collection-screen')).not.toContainText(HIDDEN_WORDS);
  await page.getByTestId('collection-item').last().click();
  await expect(page.getByTestId('collection-detail')).toContainText('721');
  await expect(page.getByTestId('collection-detail')).not.toContainText(HIDDEN_WORDS);
  await page.getByTestId('rename').click();
  await page.getByTestId('name-input').fill('もちまる初代');
  await page.getByTestId('name-submit').click();
  await expect(page.getByTestId('detail-name')).toHaveText('もちまる初代');
  await page.reload();
  await page.getByTestId('open-collection').click();
  await expect(page.getByTestId('collection-name')).toHaveText(['もちまる', 'もちまる初代']);
});

test('feeding and playing: no dot is added, the next growth comes sooner, stock goes down', async ({ page }) => {
  await startGame(page);
  await expect(page.getByTestId('countdown')).toHaveText(/^(1:00:00|59:5\d)$/);
  await page.getByTestId('open-food').click();
  await expect(page.getByTestId('count-apple')).toHaveText('×3');
  await page.screenshot({ path: 'test-results/shots/items.png' });
  await page.getByTestId('item-apple').click();
  await expect(page.getByTestId('item-toast')).toContainText('10分はやくなった');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/shots/reaction.png' });
  await expect(count(page)).toHaveText('1');
  await expect(page.getByTestId('countdown')).toHaveText(/^(50:00|49:5\d)$/);
  await page.getByTestId('open-toy').click();
  await page.getByTestId('item-ball').click();
  await expect(page.getByTestId('countdown')).toHaveText(/^(40:00|39:5\d)$/);
  await page.reload();
  await expect(page.getByTestId('countdown')).toHaveText(/^(40:00|39:5\d)$/);
  await page.getByTestId('open-food').click();
  await expect(page.getByTestId('count-apple')).toHaveText('×2');
  await page.getByTestId('close-items').click();
  await jump(page, 40 * 60_000);
  await expect(count(page)).toHaveText('2');
});

test('a small battle against a wild dot, with stats from colours and no names revealed', async ({ page }) => {
  await startGame(page);
  await jump(page, 10 * 24 * HOUR);
  await expect(count(page)).toHaveText('241');
  await page.getByTestId('open-battle').click();
  const sum = async (id: string) => {
    const box = page.getByTestId(id);
    const v = await Promise.all(['strength', 'defense', 'speed', 'luck'].map(async (k) => Number(await box.getByTestId(`stat-${k}`).textContent())));
    return v.reduce((a, b) => a + b, 0);
  };
  await expect(page.getByTestId('their-stats')).toBeVisible();
  expect(await sum('mine-stats')).toBe(100);
  expect(await sum('their-stats')).toBe(100);
  expect(Number(await page.getByTestId('mine-stats').getByTestId('stat-hp').textContent())).toBeLessThanOrEqual(200);
  await expect(page.getByTestId('battle-screen')).not.toContainText(HIDDEN_WORDS);
  await page.screenshot({ path: 'test-results/shots/battle-pick.png' });
  await page.getByTestId('start-battle').click();
  await expect(page.getByTestId('battle-log').locator('li').first()).toBeVisible();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: 'test-results/shots/battle-fight.png' });
  await page.getByTestId('skip-battle').click();
  await expect(page.getByTestId('battle-result')).toContainText(/かち|まけ|ひきわけ/);
  await expect(page.getByTestId('battle-screen')).not.toContainText(HIDDEN_WORDS);
  await page.screenshot({ path: 'test-results/shots/battle-result.png' });
  await page.getByTestId('close-battle').click();
  await page.getByTestId('close-battle').click();
  await expect(count(page)).toHaveText('241'); // battles never grow the creature
});

test('production build exposes no time-travel controls', async ({ page }) => {
  await startGame(page);
  await expect(page.locator('.dev-panel')).toHaveCount(0);
});
