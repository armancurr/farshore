/* One island: a square tile of land and sea. */
export const TILE_SIZE = 760; // metres, square
export const GRID = 305; // height samples per side (2.5 m apart)
export const ISLAND_RADIUS = 300;
export const MAX_HEIGHT = 46;
export const CONTOUR = 2.5; // metres between contour lines
export const SEA_FLOOR = -14;
export const SEA_LEVEL = 0;
/* The grand map: open sea that every player's island sits in. */
export const GRAND_SIZE = 3800; // metres, square: room for 5 x 5 tiles
export const MAX_ISLANDS = 16;
export const BOUNDARY = GRAND_SIZE / 2 - 6;

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

/* Creative: fly anywhere, fast, and nothing hurts you. */
export const FLY_SPEED = 22;
export const FLY_BOOST = 85; // double-tap W
export const FLY_CLIMB = 16; // up and down
export const FLY_CEILING = 320; // metres above the sea

export const STAMINA_MAX = 100;
export const SPRINT_DRAIN = 20;
export const STAMINA_REGEN = 15;
export const JUMP_COST = 10;

/* Health: falls and animals wear it down; it comes back slowly once you're safe. The sea never does. */
export const HEALTH_MAX = 100;
export const FALL_SAFE_SPEED = 13; // m/s at impact, about a 3.5 m drop
export const FALL_DAMAGE = 7; // per m/s beyond that
export const HEALTH_REGEN = 1.2; // per second
export const REGEN_DELAY = 8; // seconds after the last hurt
export const RESPAWN_DELAY = 3.5;
