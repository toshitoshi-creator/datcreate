/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENWEATHER_API_KEY?: string;
  readonly VITE_WEATHER_API_BASE?: string;
  /** '1' builds the trial bundle with the time-skip panel. */
  readonly VITE_DEMO_TIME?: string;
  /** AdMob rewarded ad unit ids (app only). Unset = Google's test ads. */
  readonly VITE_ADMOB_REWARDED_IOS?: string;
  readonly VITE_ADMOB_REWARDED_ANDROID?: string;
}
