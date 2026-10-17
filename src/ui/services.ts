import { GameRepository } from '../data/repository';
import { SettingsStore } from '../data/settings';
import { DevClock, systemClock, type Clock } from '../engine/clock';
import { GameController, browserLock } from '../engine/gameController';
import { EnvironmentService } from '../services/environmentService';
import { defaultWeatherProvider } from '../services/weather';

export interface AppServices {
  controller: GameController;
  settings: SettingsStore;
  clock: Clock;
  devClock: DevClock | null;
}

let services: Promise<AppServices> | null = null;

/** Singleton wiring of the app (created once per page). */
export function getServices(): Promise<AppServices> {
  services ??= (async () => {
    // The adjustable clock exists only in dev builds and the trial bundle;
    // the normal production build uses real time.
    const devClock = import.meta.env.DEV || import.meta.env.VITE_DEMO_TIME === '1' ? new DevClock() : null;
    const clock = devClock ?? systemClock;
    const settings = new SettingsStore();
    const repo = await GameRepository.open(indexedDB);
    const environment = new EnvironmentService({
      provider: defaultWeatherProvider(),
      geolocation: typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : null,
    });
    const controller = new GameController({ repo, environment, settings, clock, lock: browserLock() });
    return { controller, settings, clock, devClock };
  })();
  return services;
}
