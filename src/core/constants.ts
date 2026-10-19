export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Data format version of persisted records (GameState / save files). */
export const SCHEMA_VERSION = 1;
/** Version of the growth algorithm used for newly generated pixels. */
export const CURRENT_GENERATOR_VERSION = 3;

export const SAVE_FORMAT = 'dot-life-save';

/** Max age difference between a weather capture and a growth slot for the weather to apply. */
export const WEATHER_VALID_MS = 3 * HOUR_MS;

/** Clock moving backwards by more than this is reported as an anomaly. */
export const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60_000;

/** Growth slot at which a creature is complete (721 dots: 15 days at one dot per 30 minutes). */
export const COMPLETE_GROWTH_INDEX = 720;

/** Time between dots for new creatures. */
export const SLOT_MS = 30 * 60_000;
/** Creatures started before the 30-minute pace keep growing hourly. */
export const LEGACY_SLOT_MS = HOUR_MS;

/** Max length of a creature's name (characters). */
export const NAME_MAX_LENGTH = 20;
