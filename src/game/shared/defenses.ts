import { CATALOGUE, type CatalogueId } from "./catalogue";
import type { Ground } from "./terrain";
import { overSolid } from "./terrain";
import { type Cloud, type Flight, type ShotKind, shotAt, smokeBlocks } from "./shots";

/*
 * The things on the Defenses shelf (and the towers) that fight for their
 * owner, whether he's there or not: archers in the towers, a ballista, a
 * shore cannon, catapults and a trebuchet. Each picks a raider (or a ship
 * carrying raiders) within its range that it can see, swings round to it
 * and lets fly. Rubble doesn't fight. The numbers live here, shared, so the
 * room, the tests and the marketplace agree.
 */

export type DefenseSpec = {
  /* What it looses, how fast, and how far it reaches (and how close it can't). */
  shot: ShotKind;
  speed: number;
  range: number;
  min: number;
  /* Seconds between shots. */
  cooldown: number;
  /* Where the shot leaves it: height over its base, as a share of how tall it stands. */
  muzzle: number;
  /* Radians a second it swings round; Infinity for archers, who just turn and shoot. */
  turn: number;
  /* Lobbed high over walls (and needing no clear line, only to see through the smoke). */
  lob: boolean;
  /* How far off true each shot goes (radians). */
  spread: number;
  /* Whom it shoots at: raiders, their ships, or both (ships first). */
  targets: "people" | "ships" | "both";
  /* Raiders at most this far off, for a gun that's mostly for ships (a cannon on the beach). */
  people?: number;
  /* A direct hit's health off a person (arrows), or how much harder its blast is than the shot's own. */
  damage?: number;
  scale?: number;
  /* Archers: one in each tower, or a pair. */
  archers?: number;
};

/* A tower's archers. Bigger towers see further. */
const archers = (range: number, more = 1): DefenseSpec => ({
  shot: "arrow",
  speed: 55,
  range,
  min: 0,
  cooldown: 2 / more,
  muzzle: 0.8,
  turn: Number.POSITIVE_INFINITY,
  lob: false,
  spread: 0.012,
  targets: "people",
  damage: 13,
  archers: more,
});

export const DEFENSES: Partial<Record<CatalogueId, DefenseSpec>> = {
  watchtower: archers(45),
  wallTower: archers(40),
  bastion: archers(45),
  roundTower: archers(50),
  spireTower: archers(55),
  greatTower: archers(60),
  keep: archers(60, 2),
  ballista: {
    shot: "ballista",
    speed: 75,
    range: 90,
    min: 0,
    cooldown: 5,
    muzzle: 0.55,
    turn: 1.2,
    lob: false,
    spread: 0.006,
    targets: "both",
  },
  cannon: {
    shot: "cannonball",
    speed: 70,
    range: 110,
    min: 0,
    cooldown: 7,
    muzzle: 0.7,
    turn: 0.8,
    lob: false,
    spread: 0.01,
    targets: "both",
    people: 60,
  },
  catapult: {
    shot: "stone",
    speed: 34,
    range: 100,
    min: 15,
    cooldown: 9,
    muzzle: 0.7,
    turn: 0.6,
    lob: true,
    spread: 0.02,
    targets: "both",
  },
  trebuchet: {
    shot: "stone",
    speed: 42,
    range: 150,
    min: 20,
    cooldown: 12,
    muzzle: 0.8,
    turn: 0.4,
    lob: true,
    spread: 0.02,
    targets: "both",
    scale: 1.3,
  },
  catapultTower: {
    shot: "stone",
    speed: 36,
    range: 110,
    min: 15,
    cooldown: 9,
    muzzle: 1,
    turn: Number.POSITIVE_INFINITY,
    lob: true,
    spread: 0.02,
    targets: "both",
  },
};

export const defenseOf = (kind: CatalogueId): DefenseSpec | null => DEFENSES[kind] ?? null;

/* An archery range on the land drills the archers: they loose this much more often. */
export const DRILLED = 1.35;

/* The line a defense shoots along, starting this far up it. */
export function muzzleOf(item: { kind: CatalogueId; x: number; y: number; z: number }) {
  const spec = DEFENSES[item.kind];
  const top = CATALOGUE[item.kind].top;
  return { x: item.x, y: item.y + top * (spec?.muzzle ?? 0.8), z: item.z };
}

/* Metres between the samples along a line of sight. */
const LOOK_STEP = 1;

/*
 * Can something at `a` see `b`? Not through the ground, nor through
 * anything solid (walls, rocks, trees, hulls) unless `solid` is false (a
 * lobbed shot only needs to see over it), never through smoke. `skip`
 * leaves out what's near either end: the defense itself, the ship it's
 * looking at.
 */
export function lineOfSight(
  ground: Ground,
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  opts: {
    clouds?: readonly Cloud[];
    now?: number;
    solid?: boolean;
    skip?: (x: number, y: number, z: number) => boolean;
  } = {},
) {
  if (opts.clouds && smokeBlocks(opts.clouds, a, b, opts.now ?? 0)) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  const n = Math.floor(len / LOOK_STEP);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    const z = a.z + dz * t;
    if (opts.skip?.(x, y, z)) continue;
    if (ground.heightAt(x, z) > y + 0.1) return false;
    if (opts.solid === false) continue;
    for (const s of ground.solidsNear(x, z))
      if (y > s.bottom && y < s.top && overSolid(s, x, z)) return false;
  }
  return true;
}

/*
 * Would a shot flying this arc get to (within `stop` of) `to` without
 * hitting the ground or anything solid on the way? A lob only has to clear
 * the ground. `skip` leaves out what's near either end, as for a line of sight.
 */
export function arcClear(
  ground: Ground,
  f: Flight,
  to: { x: number; z: number },
  opts: { solid?: boolean; skip?: (x: number, y: number, z: number) => boolean } = {},
) {
  const flat = Math.hypot(f.vx, f.vz) || 1;
  const t1 = Math.hypot(to.x - f.x, to.z - f.z) / flat;
  const n = Math.max(2, Math.ceil((t1 * Math.hypot(f.vx, f.vy, f.vz)) / LOOK_STEP));
  for (let i = 1; i < n; i++) {
    const p = shotAt(f, (t1 * i) / n);
    if (opts.skip?.(p.x, p.y, p.z)) continue;
    if (ground.heightAt(p.x, p.z) > p.y) return false;
    if (opts.solid === false) continue;
    for (const s of ground.solidsNear(p.x, p.z))
      if (p.y > s.bottom && p.y < s.top && overSolid(s, p.x, p.z)) return false;
  }
  return true;
}
