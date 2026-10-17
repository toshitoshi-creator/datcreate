import type { TimeOfDay } from './time';

export type Weather = 'clear' | 'cloudy' | 'rain' | 'snow' | 'storm' | 'fog' | 'unknown';

export interface GameState {
  gameId: string;
  /** ms epoch — slot i is due at startedAt + i hours. */
  startedAt: number;
  /** Highest growthIndex persisted. Pixel count = lastProcessedGrowthIndex + 1. */
  lastProcessedGrowthIndex: number;
  schemaVersion: number;
  /** Generator used for this game's future pixels. */
  generatorVersion: number;
  initialSeed: number;
  createdAt: number;
  updatedAt: number;
  /** Latest wall-clock time seen; used to detect clock rollbacks. */
  lastObservedAt: number;
}

/** Inputs that influenced a pixel, stored inline so a pixel's environment is reproducible. */
export interface EnvUsed {
  timeOfDay: TimeOfDay;
  localHour: number;
  weather: Weather;
  environmentInfluence: number;
  organicShapeBias: number;
}

export interface Pixel {
  /** `${gameId}:${growthIndex}` — deterministic so the same slot can never be stored twice. */
  id: string;
  gameId: string;
  growthIndex: number;
  x: number;
  y: number;
  color: string; // #rrggbb
  /** Scheduled growth time of the slot (ms epoch). */
  createdAt: number;
  parentId: string | null;
  seed: number;
  environmentSnapshotId: string | null;
  generatorVersion: number;
  envUsed: EnvUsed;
}

export type FetchStatus = 'ok' | 'error' | 'timeout' | 'disabled' | 'denied' | 'unavailable';

export interface EnvironmentLog {
  id: string;
  /** Owning game, or 'none' if captured before a game existed. */
  gameId: string;
  capturedAt: number;
  timeOfDay: TimeOfDay;
  localHour: number;
  weather: Weather;
  /** Raw provider code (e.g. WMO weather code), if any. */
  weatherCode: number | null;
  temperatureC: number | null;
  locationEnabled: boolean;
  /**
   * Location is intentionally NOT stored (coordinates are only kept in memory to
   * query the weather). The field exists for schema completeness and stays null.
   */
  location: null;
  source: 'open-meteo' | 'openweathermap' | 'none';
  fetchStatus: FetchStatus;
}

export interface Settings {
  soundEnabled: boolean;
  animationEnabled: boolean;
  locationEnabled: boolean;
  /** CSS px per grid cell; null = auto fit. */
  zoomLevel: number | null;
  viewCenterX: number | null;
  viewCenterY: number | null;
  /** 0..1 strength of time/weather effects on growth. */
  environmentInfluence: number;
  /** 0..1 strength of the weak face / limb bias. */
  organicShapeBias: number;
}

export type MilestoneType = string;

export interface Milestone {
  /** `${gameId}:${type}` — each type is recorded once per game. */
  id: string;
  gameId: string;
  /** Scheduled time of the growth slot at which it was detected. */
  achievedAt: number;
  type: MilestoneType;
  metadata: {
    growthIndex: number;
    pixelCount: number;
    [k: string]: number | string | boolean;
  };
}
