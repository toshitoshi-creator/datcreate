import { describe, expect, it } from 'vitest';
import { abilityTotal } from '../../src/core/stats';
import { SLOT_MS } from '../../src/core/constants';
import { GameRepository } from '../../src/data/repository';
import { resolveStyle } from '../../src/engine/gameController';
import { STARTER_PACK, giftFor } from '../../src/core/items';
import { COOL_SPECIES, CUTE_SPECIES } from '../../src/core/species';
import { FakeClock, T0, failingProvider, fakeGeolocation, makeHarness, okProvider } from '../helpers';

// New creatures grow one dot every 30 minutes (721 dots in 15 days). These tests count in
// growth steps: HOUR_MS = one dot, DAY_MS = 24 dots.
const HOUR_MS = SLOT_MS;
const DAY_MS = 24 * SLOT_MS;

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

  it('30 days -> 721 dots; growth keeps going past 30 days, but the abilities stay as they were at 30 days', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.startNewGame();
    h.clock.advance(29 * DAY_MS);
    await h.controller.checkGrowth();
    expect(h.controller.getState().completion).toBe('growing');
    h.clock.advance(DAY_MS);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(721);
    expect(h.controller.getState().completion).toBe('complete');
    const final = h.controller.currentStats();
    h.clock.advance(5 * DAY_MS + 10 * 60_000);
    await h.controller.checkGrowth();
    // left alone (no choice made): it keeps getting bigger
    expect(h.controller.getState().pixelCount).toBe(721 + 120);
    expect(h.controller.getState().completion).toBe('complete');
    expect(h.controller.pixels.slice(721).every((p) => p.gem === null)).toBe(true);
    expect(h.controller.currentStats()).toEqual(final);
    await h.controller.continueGrowing();
    expect(h.controller.getState().completion).toBe('continuing');
    h.clock.advance(DAY_MS);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(721 + 144);
    expect(h.controller.currentStats()).toEqual(final);
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
    await h.controller.continueGrowing();
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
    clock.advance(8 * 48 * SLOT_MS); // 8 real days
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

describe('GameController: creature style', () => {
  it('a chosen style is stored, survives restart and export/import', async () => {
    const clock = new FakeClock(T0);
    const a = await makeHarness({ clock });
    await a.controller.startNewGame('ghostCool');
    expect(a.controller.getState().game?.style).toBe('ghostCool');
    expect(a.controller.simulation?.genome.irisHue).toBeDefined();
    clock.advance(2 * DAY_MS);
    await a.controller.checkGrowth();
    const text = await a.controller.exportSaveText();
    expect(JSON.parse(text).game.style).toBe('ghostCool');
    a.repo.close();
    const b = await makeHarness({ clock, factory: a.factory, storage: a.storage });
    expect(b.controller.getState().game?.style).toBe('ghostCool');
    const before = fingerprint(b.controller.pixels);
    await b.controller.resetGame();
    await b.controller.importSaveText(text);
    expect(b.controller.getState().game?.style).toBe('ghostCool');
    expect(fingerprint(b.controller.pixels)).toBe(before);
  });

  it("'random' picks one of the styles; default is cute; invalid style in a save is rejected", async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.startNewGame('random');
    expect(['cute', 'cool', 'ghost', 'ghostCool']).toContain(h.controller.getState().game?.style);
    const save = JSON.parse(await h.controller.exportSaveText());
    save.game.style = 'scary';
    await expect(h.controller.importSaveText(JSON.stringify(save))).rejects.toThrow();
    await h.controller.resetGame();
    await h.controller.startNewGame();
    expect(['cute', 'ghost']).toContain(h.controller.getState().game?.style);
  });

  it("'cute' / 'cool' pick a look within their own family; every animal is reachable", () => {
    const cute = new Set<string>(), cool = new Set<string>(), random = new Set<string>();
    for (let seed = 1; seed <= 2000; seed++) {
      const a = resolveStyle('cute', seed), b = resolveStyle('cool', seed), c = resolveStyle('random', seed);
      expect(['cute', 'ghost']).toContain(a.style);
      if (a.species) expect(CUTE_SPECIES).toContain(a.species);
      expect(['cool', 'ghostCool']).toContain(b.style);
      if (b.species) expect(COOL_SPECIES).toContain(b.species);
      cute.add(a.species ?? a.style);
      cool.add(b.species ?? b.style);
      random.add(c.species ?? c.style);
    }
    expect([...cute].sort()).toEqual([...CUTE_SPECIES, 'cute', 'ghost'].sort());
    expect([...cool].sort()).toEqual([...COOL_SPECIES, 'cool', 'ghostCool'].sort());
    expect(random.size).toBe(cute.size + cool.size);
  });

  it('the animal look is stored and survives restart and export/import', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    let seed = 0;
    // find a start that becomes an animal (seeds are random per game)
    do {
      if (seed++) await h.controller.resetGame();
      await h.controller.startNewGame('cute');
    } while (!h.controller.getState().game?.species && seed < 50);
    const species = h.controller.getState().game!.species!;
    expect(CUTE_SPECIES).toContain(species);
    clock.advance(3 * DAY_MS);
    await h.controller.checkGrowth();
    const text = await h.controller.exportSaveText();
    expect(JSON.parse(text).game.species).toBe(species);
    h.repo.close();
    const b = await makeHarness({ clock, factory: h.factory, storage: h.storage });
    expect(b.controller.getState().game?.species).toBe(species);
    const before = fingerprint(b.controller.pixels);
    await b.controller.resetGame();
    await b.controller.importSaveText(text);
    expect(fingerprint(b.controller.pixels)).toBe(before);
    const bad = JSON.parse(text);
    bad.game.species = 'unicorn';
    await expect(b.controller.importSaveText(JSON.stringify(bad))).rejects.toThrow();
  });
});

describe('GameController: completion & collection', () => {
  it('putting a finished creature in the collection keeps it frozen and starts over', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.startNewGame('cute');
    clock.advance(31 * DAY_MS);
    await h.controller.checkGrowth();
    const finished = fingerprint(h.controller.pixels);
    const oldId = h.controller.getState().game!.gameId;
    await h.controller.retireToCollection('  ぷに  ');
    expect(h.controller.getState().status).toBe('no-game');

    clock.advance(10 * DAY_MS); // time passes: the archived creature must not grow
    await h.controller.startNewGame('cool');
    expect(h.controller.getState().pixelCount).toBe(1);
    const list = await h.controller.listCollection();
    expect(list.map((g) => g.gameId)).toEqual([oldId]);
    expect(list[0].lastProcessedGrowthIndex).toBe(744); // 31 days: archived as big as it had grown
    expect(list[0].name).toBe('ぷに');
    expect(fingerprint(await h.controller.loadCollectionPixels(oldId))).toBe(finished);

    // survives restart, and resetting / importing the active game leaves the collection alone
    h.repo.close();
    const b = await makeHarness({ clock, factory: h.factory, storage: h.storage });
    expect((await b.controller.listCollection()).length).toBe(1);
    const text = await b.controller.exportSaveText();
    await b.controller.resetGame();
    await b.controller.importSaveText(text);
    expect((await b.controller.listCollection()).length).toBe(1);
    expect(fingerprint(await b.controller.loadCollectionPixels(oldId))).toBe(finished);

    // deleting from the collection works only for collection entries
    await expect(b.controller.deleteFromCollection(b.controller.getState().game!.gameId)).rejects.toThrow();
    await b.controller.deleteFromCollection(oldId);
    expect(await b.controller.listCollection()).toEqual([]);
    expect(await b.repo.countPixels(oldId)).toBe(0);
  });

  it('a creature that kept growing can still be put away later', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.startNewGame();
    clock.advance(40 * DAY_MS);
    await h.controller.checkGrowth();
    await h.controller.continueGrowing();
    expect(h.controller.getState().pixelCount).toBe(961);
    await h.controller.retireToCollection('ながいき');
    expect((await h.controller.listCollection())[0].lastProcessedGrowthIndex).toBe(960);
  });
});

describe('GameController: naming collection entries', () => {
  it('names may repeat; each entry stays separate and can be renamed', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    expect(await h.controller.suggestName()).toBe('ドット1号');
    for (let i = 0; i < 2; i++) {
      await h.controller.startNewGame('cute');
      clock.advance(30 * DAY_MS);
      await h.controller.checkGrowth();
      await h.controller.retireToCollection('もち');
      clock.advance(DAY_MS);
    }
    expect(await h.controller.suggestName()).toBe('ドット3号');
    const list = await h.controller.listCollection();
    expect(list).toHaveLength(2);
    expect(list.map((g) => g.name)).toEqual(['もち', 'もち']);
    expect(new Set(list.map((g) => g.gameId)).size).toBe(2);

    const renamed = await h.controller.renameInCollection(list[1].gameId, 'もち（初代）');
    expect(renamed.name).toBe('もち（初代）');
    const again = await h.controller.listCollection();
    expect(again.find((g) => g.gameId === list[0].gameId)?.name).toBe('もち');
    expect(again.find((g) => g.gameId === list[1].gameId)?.name).toBe('もち（初代）');
  });

  it('rejects empty or too-long names without archiving anything', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.startNewGame();
    await expect(h.controller.retireToCollection('   ')).rejects.toThrow('名前を入力');
    await expect(h.controller.retireToCollection('あ'.repeat(21))).rejects.toThrow('20文字');
    expect(h.controller.getState().status).toBe('ready');
    expect(await h.controller.listCollection()).toEqual([]);
    await h.controller.retireToCollection('あ'.repeat(20));
    expect((await h.controller.listCollection())[0].name).toBe('あ'.repeat(20));
  });
});

describe('GameController: items and gifts', () => {
  it('starts with the starter pack', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    expect(h.controller.getState().inventory).toEqual(STARTER_PACK);
  });

  it('using an item never adds a dot, but brings the next growth earlier (and keeps the 30-minute rhythm)', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.startNewGame();
    clock.advance(10 * 60_000); // 20 min to the next growth (a dot every 30 min)
    const ev = await h.controller.useItem('apple'); // -10 min
    expect(ev.ms).toBe(10 * 60_000);
    expect(h.controller.getState().pixelCount).toBe(1);
    expect(h.controller.getState().inventory.apple).toBe(STARTER_PACK.apple - 1);
    clock.advance(9 * 60_000); // 19 min after start: not yet
    expect(await h.controller.checkGrowth()).toBe(0);
    clock.advance(60_000); // 20 min after start = new due time
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(2);
    expect(h.controller.pixels[1].createdAt).toBe(T0 + 20 * 60_000);
    clock.advance(30 * 60_000); // still one per 30 minutes afterwards
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(3);
  });

  it('never pulls the next growth closer than a minute; refuses when it is about to happen', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.startNewGame();
    clock.advance(25 * 60_000); // 5 min left
    const ev = await h.controller.useItem('cookie'); // -20 min requested
    expect(ev.ms).toBe(4 * 60_000); // capped: 1 min left
    expect(h.controller.getState().pixelCount).toBe(1);
    const before = h.controller.getState().inventory;
    await expect(h.controller.useItem('ball')).rejects.toThrow('もうすぐ');
    expect(h.controller.getState().inventory).toEqual(before);
    await expect(h.controller.useItem('cake')).rejects.toThrow('持っていません');
    clock.advance(60_000);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(2);
  });

  it('item effects and stock survive a restart', async () => {
    const clock = new FakeClock(T0);
    const a = await makeHarness({ clock });
    await a.controller.startNewGame();
    await a.controller.useItem('ball');
    a.repo.close();
    const b = await makeHarness({ clock, factory: a.factory, storage: a.storage });
    expect(b.controller.getState().game?.timeBonusMs).toBe(10 * 60_000);
    expect(b.controller.getState().inventory.ball).toBe(STARTER_PACK.ball - 1);
    clock.advance(20 * 60_000);
    await b.controller.checkGrowth();
    expect(b.controller.getState().pixelCount).toBe(2);
  });

  it('a completed creature gives its thank-you present exactly once', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.startNewGame();
    clock.advance(30 * DAY_MS);
    await h.controller.checkGrowth();
    const game = h.controller.getState().game!;
    expect(game.gift).toEqual(giftFor(game.initialSeed));
    const inv = h.controller.getState().inventory;
    for (const g of game.gift!) expect(inv[g.itemId]).toBe((STARTER_PACK[g.itemId] ?? 0) + g.count);
    await expect(h.controller.useItem('apple')).rejects.toThrow('完成');
    h.repo.close();
    const b = await makeHarness({ clock, factory: h.factory, storage: h.storage });
    await b.controller.continueGrowing();
    expect(b.controller.getState().inventory).toEqual(inv); // not given twice
    await b.controller.useItem(game.gift![0].itemId); // usable again while growing on
  });
});

describe('GameController: battle reward', () => {
  it('the first win of a day gives one ordinary item; later wins that day and losses give nothing', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.startNewGame();
    const total = () => Object.values(h.controller.getState().inventory).reduce((a, b) => a + b, 0);
    const before = total();
    expect(await h.controller.rewardBattle(false)).toBeNull();
    const item = await h.controller.rewardBattle(true);
    expect(item).not.toBeNull();
    expect(item!.rare).toBe(false);
    expect(total()).toBe(before + 1);
    expect(await h.controller.rewardBattle(true)).toBeNull();
    expect(total()).toBe(before + 1);
    clock.advance(48 * SLOT_MS); // the next real day
    expect(await h.controller.rewardBattle(true)).not.toBeNull();
    expect(total()).toBe(before + 2);
    expect(h.controller.getState().pixelCount).toBe(1); // battles never grow the creature
  });

  it('current stats come from the dots', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.startNewGame();
    const s = h.controller.currentStats()!;
    expect(s.strength + s.defense + s.speed + s.luck).toBe(abilityTotal(h.controller.pixels));
  });
});

describe('GameController: growth pace', () => {
  it('a new creature grows a dot every 30 minutes and is complete (721 dots) in 15 days', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.startNewGame();
    expect(h.controller.getState().game!.slotMs).toBe(30 * 60_000);
    clock.advance(30 * 60_000);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(2);
    clock.advance(15 * 48 * SLOT_MS - 30 * 60_000); // 15 real days after the start
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(721);
    expect(h.controller.getState().completion).toBe('complete');
  });

  it('a creature started before the change keeps growing hourly (no sudden jump)', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.startNewGame();
    // turn it into an hourly creature, as saved by an earlier version (no slotMs)
    const text = JSON.parse(await h.controller.exportSaveText());
    delete text.game.slotMs;
    // loading a backup of the creature being raised (same id) replaces it cleanly
    await h.controller.importSaveText(JSON.stringify(text));
    expect(await h.repo.countPixels(h.controller.getState().game!.gameId)).toBe(1);
    expect(h.controller.getState().game!.slotMs).toBeUndefined();
    clock.advance(10 * 3_600_000);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(11);
  });
});
