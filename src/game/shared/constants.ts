/* World */
export const WORLD_SIZE = 760; // metres, square
export const GRID = 305; // height samples per side (2.5 m apart)
export const ISLAND_RADIUS = 300;
export const MAX_HEIGHT = 46;
export const CONTOUR = 2.5; // metres between contour lines
export const SEA_FLOOR = -14;
export const SEA_LEVEL = 0;
export const BOUNDARY = WORLD_SIZE / 2 - 6;

/* Room */
export const MAX_PLAYERS = 8;
export const TICK_HZ = 20;

/* Body */
export const PLAYER_RADIUS = 0.42;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
export const STEP_HEIGHT = 0.55;
export const WALK_SPEED = 6.4;
export const SPRINT_SPEED = 9.8;
export const WATER_SPEED = 0.48; // multiplier when waist-deep
export const ACCEL_GROUND = 55;
export const ACCEL_AIR = 9;
export const GRAVITY = 24;
export const JUMP_SPEED = 8.3; // ~1.45 m of lift
export const STEEP_NY = 0.66; // ground steeper than this slides you down
export const SLIDE_ACCEL = 20;

export const STAMINA_MAX = 100;
export const SPRINT_DRAIN = 20;
export const STAMINA_REGEN = 15;
export const JUMP_COST = 10;

/* Breath: wading chills you slowly, going under drowns you fast. */
export const BREATH_MAX = 100;
export const BREATH_WADE = 7;
export const BREATH_UNDER = 30;
export const BREATH_REGEN = 14;

/* Health: drowning, falls and animals wear it down; it comes back slowly once you're safe. */
export const HEALTH_MAX = 100;
export const DROWN_DAMAGE = 14; // per second with no breath left
export const FALL_SAFE_SPEED = 13; // m/s at impact, about a 3.5 m drop
export const FALL_DAMAGE = 7; // per m/s beyond that
export const HEALTH_REGEN = 1.2; // per second
export const REGEN_DELAY = 8; // seconds after the last hurt
export const RESPAWN_DELAY = 3.5;

/* Day and night: one full day, in seconds, and where on it a new island starts (0 = midnight). */
export const DAY_LENGTH = 20 * 60;
export const DAY_START = 0.3;
