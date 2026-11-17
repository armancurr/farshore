import type { Material } from "./catalogue";

/*
 * Everything that flies: arrows and bolts, cannonballs, stones from the
 * siege engines, and kegs and smoke bombs lobbed by hand. The room flies
 * them and decides what they hit; every client is told where each one set
 * off from and how fast, and flies its own copy with the same sums, so they
 * agree without a stream of positions. No drag, just gravity, so where a
 * shot is at any moment is a closed form (shotAt).
 */

export const SHOT_KINDS = [
  "arrow",
  "bolt",
  "firearrow",
  "ballista",
  "cannonball",
  "stone",
  "keg",
  "smoke",
] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];

export const shotIndex = (k: ShotKind) => SHOT_KINDS.indexOf(k);
export const shotFromIndex = (i: number): ShotKind | null => SHOT_KINDS[i] ?? null;

/*
 * A burst where it lands: everything within `radius` takes some of it, the
 * whole of it within `full`, falling away to `edge` of it at the rim.
 */
export type Blast = {
  radius: number;
  full: number;
  edge: number;
  /* Health off a person, off something built (before its material), off a hull. */
  damage: number;
  siege: number;
  hull: number;
  /* The shove at the middle (m/s, outward and up). */
  knock: number;
  lift: number;
};

export type ShotSpec = {
  /* Pull down (m/s²): arrows barely drop, stones and kegs arc. */
  gravity: number;
  /* How fat it is, for what it hits. */
  radius: number;
  /* Seconds before it's given up on (gone over the horizon). */
  life: number;
  /* A direct hit: health off a person, off something built, off a hull. */
  damage: number;
  siege: number;
  hull: number;
  /* How much of a hit gets through to what it's built of: arrows glance off stone. */
  resist: Record<Material, number>;
  knock: number;
  lift: number;
  /* Bursts where it lands (or, for a keg, when its fuse runs out) instead of a plain hit. */
  blast?: Blast;
  /* Left standing in what it hit, for a while. */
  sticks?: boolean;
  /* Comes to rest where it lands rather than ending there: a keg, a smoke bomb. */
  rests?: boolean;
  /* Seconds from the throw until it goes off. */
  fuse?: number;
  /* Sets wood alight where it strikes. */
  ignites?: boolean;
  /* Lets out a cloud where it lands. */
  smoke?: boolean;
};

const ARROWY: Record<Material, number> = { wood: 1, stone: 0.2 };
const HEAVY: Record<Material, number> = { wood: 1, stone: 1 };

export const SHOTS: Record<ShotKind, ShotSpec> = {
  arrow: {
    gravity: 5,
    radius: 0.08,
    life: 5,
    damage: 16,
    siege: 5,
    hull: 4,
    resist: ARROWY,
    knock: 2,
    lift: 0.8,
    sticks: true,
  },
  bolt: {
    gravity: 4.5,
    radius: 0.08,
    life: 4,
    damage: 34,
    siege: 12,
    hull: 10,
    resist: ARROWY,
    knock: 4,
    lift: 1.2,
    sticks: true,
  },
  firearrow: {
    gravity: 6,
    radius: 0.08,
    life: 5,
    damage: 12,
    siege: 4,
    hull: 6,
    resist: ARROWY,
    knock: 1.5,
    lift: 0.6,
    sticks: true,
    ignites: true,
  },
  /* A ballista's bolt: a spear, near enough. */
  ballista: {
    gravity: 4,
    radius: 0.16,
    life: 5,
    damage: 38,
    siege: 40,
    hull: 45,
    resist: { wood: 1, stone: 0.4 },
    knock: 10,
    lift: 4,
    sticks: true,
  },
  cannonball: {
    gravity: 9.8,
    radius: 0.2,
    life: 8,
    damage: 0,
    siege: 0,
    hull: 0,
    resist: HEAVY,
    knock: 0,
    lift: 0,
    blast: {
      radius: 3,
      full: 1,
      edge: 0.25,
      damage: 50,
      siege: 220,
      hull: 130,
      knock: 13,
      lift: 6,
    },
  },
  stone: {
    gravity: 9.8,
    radius: 0.3,
    life: 10,
    damage: 0,
    siege: 0,
    hull: 0,
    resist: HEAVY,
    knock: 0,
    lift: 0,
    blast: {
      radius: 4,
      full: 1.2,
      edge: 0.25,
      damage: 45,
      siege: 240,
      hull: 170,
      knock: 12,
      lift: 6,
    },
  },
  keg: {
    gravity: 14,
    radius: 0.3,
    life: 6,
    damage: 0,
    siege: 0,
    hull: 0,
    resist: HEAVY,
    knock: 0,
    lift: 0,
    rests: true,
    fuse: 4,
    blast: {
      radius: 6,
      full: 1.5,
      edge: 0.35,
      damage: 75,
      siege: 1300,
      hull: 500,
      knock: 20,
      lift: 9,
    },
  },
  smoke: {
    gravity: 14,
    radius: 0.15,
    life: 6,
    damage: 0,
    siege: 0,
    hull: 0,
    resist: HEAVY,
    knock: 0,
    lift: 0,
    rests: true,
    smoke: true,
  },
};

/* Shots in the air (and kegs on their fuses) at once, in the whole room. */
export const MAX_SHOTS = 160;

/* ---------- flight ---------- */

/* Where a shot set off from, how fast, and how hard it's pulled down. */
export type Flight = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
};

/* Where it is `t` seconds out. */
export function shotAt(f: Flight, t: number) {
  return { x: f.x + f.vx * t, y: f.y + f.vy * t - 0.5 * f.gravity * t * t, z: f.z + f.vz * t };
}

/* Which way it's going `t` seconds out. */
export function shotVel(f: Flight, t: number) {
  return { x: f.vx, y: f.vy - f.gravity * t, z: f.vz };
}

/*
 * The velocity that carries a shot from `from` to `to` at `speed`, pulled
 * down by `gravity`: the flat way (the lower of the two arcs) or lobbed high
 * over walls. Null when it can't reach.
 */
export function aimAt(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  speed: number,
  gravity: number,
  high = false,
) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return { x: 0, y: dy >= 0 ? speed : -speed, z: 0 };
  const v2 = speed * speed;
  const root = v2 * v2 - gravity * (gravity * d * d + 2 * dy * v2);
  if (root < 0) return null;
  const tan = (v2 + (high ? 1 : -1) * Math.sqrt(root)) / (gravity * d);
  const cos = 1 / Math.sqrt(1 + tan * tan);
  const sin = tan * cos;
  return { x: (dx / d) * speed * cos, y: speed * sin, z: (dz / d) * speed * cos };
}

/*
 * Aimed to meet something moving at (vx, vz): where it'll be by the time
 * the shot gets there, worked out a few times over.
 */
export function leadAt(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  vel: { x: number; z: number },
  speed: number,
  gravity: number,
  high = false,
) {
  let at = to;
  let v = aimAt(from, at, speed, gravity, high);
  for (let i = 0; i < 3 && v; i++) {
    const flat = Math.hypot(v.x, v.z) || 1;
    const t = Math.hypot(at.x - from.x, at.z - from.z) / flat;
    at = { x: to.x + vel.x * t, y: to.y, z: to.z + vel.z * t };
    v = aimAt(from, at, speed, gravity, high) ?? v;
  }
  return v;
}

/* How much of a blast reaches `d` metres from its middle (0 past its rim). */
export function blastShare(b: Blast, d: number) {
  if (d <= b.full) return 1;
  if (d >= b.radius) return 0;
  return 1 - (1 - b.edge) * ((d - b.full) / (b.radius - b.full));
}

/* ---------- smoke ---------- */

/* A smoke bomb's cloud: how wide, how long it hangs, and how high its middle sits off the ground. */
export const SMOKE = { radius: 5.5, time: 8, rise: 1.8 };

export type Cloud = { x: number; y: number; z: number; until: number };

/* Does the line from `a` to `b` pass through any of these clouds at `now`? */
export function smokeBlocks(
  clouds: readonly Cloud[],
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  now: number,
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz || 1;
  for (const c of clouds) {
    if (c.until <= now) continue;
    const cy = c.y + SMOKE.rise;
    const t = Math.max(
      0,
      Math.min(1, ((c.x - a.x) * dx + (cy - a.y) * dy + (c.z - a.z) * dz) / len2),
    );
    const px = a.x + dx * t - c.x;
    const py = a.y + dy * t - cy;
    const pz = a.z + dz * t - c.z;
    if (px * px + py * py + pz * pz < SMOKE.radius * SMOKE.radius) return true;
  }
  return false;
}
