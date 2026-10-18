import { GameRepository } from '../data/repository';
import { SettingsStore } from '../data/settings';
import { DevClock, systemClock, type Clock } from '../engine/clock';
import { CompletionNotifier } from '../engine/completionNotifier';
import { GameController, browserLock } from '../engine/gameController';
import { EnvironmentService } from '../services/environmentService';
import { nativeNotificationPort } from '../services/nativeNotifications';
import { nativeStorePort } from '../services/storePurchases';
import { testPurchasePort } from '../engine/purchases';
import { COIN_PACKS } from '../core/shop';
import { defaultWeatherProvider } from '../services/weather';

export interface AppServices {
  controller: GameController;
  settings: SettingsStore;
  clock: Clock;
  devClock: DevClock | null;
  /** Completion notices are available (the iOS / Android app). */
  notifications: boolean;
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
    // Coins: the real store in the app; a free test store only in dev / the trial build.
    const store = nativeStorePort(COIN_PACKS) ?? (devClock ? testPurchasePort(COIN_PACKS) : null);
    if (store) void controller.attachStore(store).catch(() => undefined);
    const port = nativeNotificationPort();
    if (port) new CompletionNotifier(controller, settings, clock, port);
    return { controller, settings, clock, devClock, notifications: !!port };
  })();
  return services;
}
