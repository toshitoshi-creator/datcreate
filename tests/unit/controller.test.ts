import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/core/constants';
import { GameRepository } from '../../src/data/repository';
import { FakeClock, HOUR_MS, T0, failingProvider, fakeGeolocation, makeHarness, okProvider } from '../helpers';

const fingerprint = (ps: { x: number; y: number; color: string; growthIndex: number }[]) =>
  ps.map((p) => `${p.growthIndex}:${p.x},${p.y}${p.color}`).join('|');

describe('GameController: time-based growth', () => {
  it('a new game has exactly 1 dot', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    expect(h.controller.getState().status).toBe('no-game');
    await h.controller.startNewGame();
    expect(h.controller.getState().pixelCount).toBe(1);
    expect(await h.repo.countPixels(h.controller.getState().game!.gameId)).toBe(1);
  });

  it('no growth before an hour; +1 dot after 1 hour; +24 after 24 hours', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.startNewGame();
    h.clock.advance(HOUR_MS - 1000);
    expect(await h.controller.checkGrowth()).toBe(0);
    expect(h.controller.getState().pixelCount).toBe(1);
    h.clock.advance(1000);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(2);
    h.clock.advance(23 * HOUR_MS);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(25);
  });

  it('30 days -> 721 dots, and growth continues beyond 30 days', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.startNewGame();
    h.clock.advance(30 * DAY_MS);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(721);
    h.clock.advance(5 * DAY_MS + 30 * 60_000);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(721 + 120);
  });

  it('offline growth is applied on the next launch (restart with a later clock)', async () => {
    const clock = new FakeClock(T0);
    const a = await makeHarness({ clock });
    await a.controller.startNewGame();
    a.repo.close();
    clock.advance(3 * DAY_MS + 10 * 60_000); // app closed for 3 days
    const b = await makeHarness({ clock, factory: a.factory, storage: a.storage });
    expect(b.controller.getState().pixelCount).toBe(73);
    expect(await b.repo.countPixels(b.controller.getState().game!.gameId)).toBe(73);
  });

  it('restart keeps positions and colours exactly', async () => {
    const clock = new FakeClock(T0);
    const a = await makeHarness({ clock });
    await a.controller.startNewGame();
    clock.advance(10 * DAY_MS);
    await a.controller.checkGrowth();
    const before = fingerprint(a.controller.pixels);
    a.repo.close();
    const b = await makeHarness({ clock, factory: a.factory, storage: a.storage });
    expect(fingerprint(b.controller.pixels)).toBe(before);
    b.repo.close();
    const c = await makeHarness({ clock, factory: a.factory, storage: a.storage });
    expect(fingerprint(c.controller.pixels)).toBe(before);
  });

  it('concurrent checks never generate the same slot twice', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.startNewGame();
    h.clock.advance(50 * HOUR_MS);
    await Promise.all([h.controller.checkGrowth(), h.controller.checkGrowth(), h.controller.checkGrowth()]);
    expect(h.controller.getState().pixelCount).toBe(51);
    expect(await h.repo.countPixels(h.controller.getState().game!.gameId)).toBe(51);
  });

  it('two app instances (tabs) on one DB do not duplicate slots', async () => {
    const clock = new FakeClock(T0);
    const a = await makeHarness({ clock });
    await a.controller.startNewGame();
    const b = await makeHarness({ clock, factory: a.factory, storage: a.storage });
    clock.advance(40 * HOUR_MS);
    await Promise.all([a.controller.checkGrowth(), b.controller.checkGrowth()]);
    await a.controller.checkGrowth();
    await b.controller.checkGrowth();
    const gameId = a.controller.getState().game!.gameId;
    expect(await a.repo.countPixels(gameId)).toBe(41);
    expect(fingerprint(a.controller.pixels)).toBe(fingerprint(b.controller.pixels));
  });

  it('clock moving backwards neither duplicates nor deletes dots', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.startNewGame();
    h.clock.advance(10 * HOUR_MS);
    await h.controller.checkGrowth();
    const before = fingerprint(h.controller.pixels);
    h.clock.advance(-5 * HOUR_MS); // user sets the clock back
    expect(await h.controller.checkGrowth()).toBe(0);
    expect(h.controller.getState().clockWarning).toBe(true);
    expect(fingerprint(h.controller.pixels)).toBe(before);
    h.clock.advance(4 * HOUR_MS); // still before the last processed slot
    expect(await h.controller.checkGrowth()).toBe(0);
    h.clock.advance(2 * HOUR_MS); // now one hour past the previous maximum
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(12);
    expect(fingerprint(h.controller.pixels).startsWith(before)).toBe(true);
    expect(await h.repo.countPixels(h.controller.getState().game!.gameId)).toBe(12);
  });

  it('a clock set before the game start causes no growth and no damage', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.startNewGame();
    h.clock.advance(-400 * DAY_MS);
    expect(await h.controller.checkGrowth()).toBe(0);
    expect(h.controller.getState().pixelCount).toBe(1);
  });

  it('a crash mid-growth (failed write) leaves no duplicates and recovers', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.startNewGame();
    h.clock.advance(500 * HOUR_MS);
    const orig = h.repo.appendGrowth.bind(h.repo);
    let calls = 0;
    h.repo.appendGrowth = async (...args) => {
      if (++calls === 2) throw new Error('simulated crash');
      return orig(...args);
    };
    await h.controller.checkGrowth();
    const gameId = h.controller.getState().game!.gameId;
    expect(await h.repo.countPixels(gameId)).toBe(201); // first chunk committed only
    expect(h.controller.getState().pixelCount).toBe(201);
    h.repo.appendGrowth = orig;
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(501);
    expect(await h.repo.countPixels(gameId)).toBe(501);
  });

  it('long-term growth keeps every dot (1 year ≈ 8,761 dots)', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.startNewGame();
    h.clock.advance(365 * DAY_MS);
    await h.controller.checkGrowth();
    const gameId = h.controller.getState().game!.gameId;
    expect(h.controller.getState().pixelCount).toBe(8761);
    const stored = await h.repo.loadPixels(gameId);
    expect(stored).toHaveLength(8761);
    expect(new Set(stored.map((p) => `${p.x},${p.y}`)).size).toBe(8761);
    stored.forEach((p, i) => expect(p.growthIndex).toBe(i));
  });
});

describe('GameController: environment', () => {
  it('weather API failure does not stop growth', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0), provider: failingProvider() });
    h.settings.update({ locationEnabled: true });
    await h.controller.startNewGame();
    await h.controller.refreshEnvironment(true);
    expect(h.controller.getState().latestEnv?.fetchStatus).toBe('error');
    h.clock.advance(5 * HOUR_MS);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(6);
    expect(h.controller.pixels.at(-1)!.envUsed.weather).toBe('unknown');
  });

  it('location denial keeps the game fully working and turns the setting off', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0), geolocation: fakeGeolocation('deny') });
    await h.controller.startNewGame();
    const status = await h.controller.setLocationEnabled(true);
    expect(status).toBe('denied');
    expect(h.settings.get().locationEnabled).toBe(false);
    h.clock.advance(3 * HOUR_MS);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(4);
  });

  it('works when geolocation is not available at all', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0), geolocation: null });
    await h.controller.startNewGame();
    expect(await h.controller.setLocationEnabled(true)).toBe('unavailable');
    h.clock.advance(2 * HOUR_MS);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(3);
  });

  it('successful weather is recorded as a snapshot and used for nearby slots only', async () => {
    const provider = okProvider('snow');
    const h = await makeHarness({ clock: new FakeClock(T0), provider });
    h.settings.update({ locationEnabled: true });
    await h.controller.startNewGame();
    const log = await h.controller.refreshEnvironment(true);
    expect(log?.fetchStatus).toBe('ok');
    expect(log?.location).toBeNull(); // coordinates are never stored
    h.clock.advance(10 * HOUR_MS);
    await h.controller.checkGrowth();
    const ps = h.controller.pixels;
    expect(ps[1].envUsed.weather).toBe('snow'); // 1h after capture
    expect(ps[1].environmentSnapshotId).toBe(log!.id);
    expect(ps[10].envUsed.weather).toBe('unknown'); // 10h later: too old to apply
    expect(await h.repo.getEnvironmentLog(log!.id)).toMatchObject({ weather: 'snow', fetchStatus: 'ok' });
  });

  it('with location disabled, no weather request is made', async () => {
    const provider = okProvider('rain');
    const h = await makeHarness({ clock: new FakeClock(T0), provider });
    await h.controller.startNewGame();
    await h.controller.refreshEnvironment(true);
    expect(provider.calls).toBe(0);
    expect(h.controller.getState().latestEnv?.fetchStatus).toBe('disabled');
  });
});

describe('GameController: history & save data', () => {
  it('history (dots + milestones) survives restart', async () => {
    const clock = new FakeClock(T0);
    const a = await makeHarness({ clock });
    await a.controller.startNewGame();
    clock.advance(8 * DAY_MS);
    await a.controller.checkGrowth();
    const ms = a.controller.getState().milestones.map((m) => m.id);
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.some((id) => id.endsWith('count:100'))).toBe(true);
    expect(ms.some((id) => id.endsWith('day:7'))).toBe(true);
    a.repo.close();
    const b = await makeHarness({ clock, factory: a.factory, storage: a.storage });
    expect(b.controller.getState().milestones.map((m) => m.id)).toEqual(ms);
    expect(b.controller.pixels.map((p) => p.createdAt)).toEqual(a.controller.pixels.map((p) => p.createdAt));
  });

  it('export -> reset -> import restores the same individual and it keeps growing', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.startNewGame();
    clock.advance(4 * DAY_MS);
    await h.controller.checkGrowth();
    const text = await h.controller.exportSaveText();
    const before = fingerprint(h.controller.pixels);
    await h.controller.resetGame();
    expect(h.controller.getState().status).toBe('no-game');
    await h.controller.importSaveText(text);
    expect(fingerprint(h.controller.pixels)).toBe(before);
    clock.advance(2 * HOUR_MS);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(97 + 2);
  });

  it('import catches up time elapsed since the export', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.startNewGame();
    const text = await h.controller.exportSaveText();
    clock.advance(DAY_MS);
    const other = await makeHarness({ clock });
    await other.controller.importSaveText(text);
    expect(other.controller.getState().pixelCount).toBe(25);
  });

  it('invalid import is rejected and the existing save stays intact', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.startNewGame();
    clock.advance(30 * HOUR_MS);
    await h.controller.checkGrowth();
    const before = fingerprint(h.controller.pixels);
    const good = JSON.parse(await h.controller.exportSaveText());

    const bad1 = structuredClone(good);
    bad1.pixels[5].x = bad1.pixels[4].x; // duplicate cell
    bad1.pixels[5].y = bad1.pixels[4].y;
    const bad2 = structuredClone(good);
    bad2.pixels.pop(); // missing dot
    const bad3 = structuredClone(good);
    bad3.schemaVersion = 999;
    const bad4 = structuredClone(good);
    bad4.pixels[3].color = 'red';

    for (const bad of [bad1, bad2, bad3, bad4]) {
      await expect(h.controller.importSaveText(JSON.stringify(bad))).rejects.toThrow();
    }
    await expect(h.controller.importSaveText('{not json')).rejects.toThrow();
    expect(fingerprint(h.controller.pixels)).toBe(before);
    h.repo.close();
    const r = await GameRepository.open(h.factory);
    const stored = await r.loadPixels(h.controller.getState().game!.gameId);
    expect(fingerprint(stored)).toBe(before);
  });
});
