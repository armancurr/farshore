/* World */
export const WORLD_SIZE = 760; // metres, square
export const GRID = 305; // height samples per side (2.5 m apart)
export const ISLAND_RADIUS = 300;
export const MAX_HEIGHT = 46;
export const CONTOUR = 2.5; // metres between contour lines
export const SEA_FLOOR = -14;
export const BOUNDARY = WORLD_SIZE / 2 - 6;

/* Room */
export const MAX_PLAYERS = 8;
export const TICK_HZ = 20;
export const COUNTDOWN_SOLO = 3;
export const COUNTDOWN_ONLINE = 6;
export const RESULTS_TIME = 8;

/* Tide: a grace period, then a surge every interval that lifts the sea one step. */
export const TIDE_START = 0;
export const GRACE = 12;
export const SURGE_INTERVAL = 11;
export const SURGE_DURATION = 4.5;
export const SURGE_STEP = 3.6;
export const SURGE_WARNING = 3.5;
/* Once every human is out, the sea hurries the bots along. */
export const HURRY_RATE = 2.4; // m/s

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

/* Shove */
export const SHOVE_RANGE = 2.9;
export const SHOVE_CONE = 0.35; // cos of the half-angle
export const SHOVE_COOLDOWN = 1.3;
export const SHOVE_FORCE = 12.5;
export const SHOVE_LIFT = 5.5;
export const SHOVE_CREDIT = 7; // seconds a shove counts toward an elimination

/* Stones */
export const STONES_START = 2;
export const STONES_MAX = 5;
export const PILLAR_HEIGHT = 3.2;
export const PILLAR_RADIUS = 1.05;
export const CAIRN_REACH = 1.9;
