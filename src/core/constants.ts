export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Data format version of persisted records (GameState / save files). */
export const SCHEMA_VERSION = 1;
/** Version of the growth algorithm used for newly generated pixels. */
export const CURRENT_GENERATOR_VERSION = 2;

export const SAVE_FORMAT = 'dot-life-save';

/** Max age difference between a weather capture and a growth slot for the weather to apply. */
export const WEATHER_VALID_MS = 3 * HOUR_MS;

/** Clock moving backwards by more than this is reported as an anomaly. */
export const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60_000;
