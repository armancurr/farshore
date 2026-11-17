import {
  CATALOGUE,
  type CatalogueId,
  itemToWorld,
  type Material,
  type PlacedItem,
} from "./catalogue";
import { shielded } from "./plots";
import type { WeaponDef } from "./weapons";
import type { Wind } from "./wind";

/*
 * What happens to the things built on a plot when someone comes for them:
 * blows that wear them down, fire that spreads through anything wooden, and
 * the slow mending afterwards. The rules live here, shared, so the room and
 * the tests (and the client, for its looks and prices) agree on them.
 */

/* ---------- blows ---------- */

/* How much of a blow gets through: stone shrugs off most of what a hand weapon does. */
export const MELEE_RESIST: Record<Material, number> = { wood: 1, stone: 0.25 };

/* Health a blow of `damage` takes from something built of `material`, with this weapon. */
export function siegeDamage(def: WeaponDef, damage: number, material: Material) {
  return damage * def.siege * MELEE_RESIST[material];
}

/* Who's swinging: whose land it is they're on is what matters. */
export type Raider = { token: string | null; creative: boolean };

/*
 * May this person damage (or set fire to) what stands on this plot at `now`?
 * Never your own, never in creative, only someone the room knows, and never
 * while its shield is up. The Hearth isn't one of the plot's things at all,
 * so nothing here can touch it: raids capture it instead.
 */
export function canDamageItem(attacker: Raider, plot: { owner: string; shield?: number }, now = 0) {
  if (shielded(plot, now)) return false;
  return !!attacker.token && attacker.token !== plot.owner && !attacker.creative;
}

/* Swung at the things round you (the warhammer's slam): it breaks into this many at most. */
export const SLAM_ITEMS = 2;

/*
 * Where a blow from (x, y, z), facing (fx, fz), would land on this thing,
 * if it reaches: the nearest point of its collision (or, for something you
 * can walk through, its footprint) that's within reach and inside the
 * swing's arc. Tried from where you stand and from the middle of the
 * swing, so a long wall at an angle is as easy to hit as a post.
 */
export function strikeOn(
  p: PlacedItem,
  x: number,
  y: number,
  z: number,
  fx: number,
  fz: number,
  reach: number,
  arc: number,
): { d: number; x: number; y: number; z: number } | null {
  const def = CATALOGUE[p.kind];
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const parts = def.colliders.length
    ? def.colliders
    : [{ x: 0, z: 0, bottom: 0, top: def.top, box: { hx: def.hx, hz: def.hz, rot: 0 } }];
  const from = [
    [x, z],
    [x + fx * reach * 0.6, z + fz * reach * 0.6],
  ] as const;
  let best: { d: number; x: number; y: number; z: number } | null = null;
  for (const k of parts) {
    const lo = p.y + Math.max(0, k.bottom);
    const hi = p.y + k.top;
    if (hi < y - 0.3 || lo > y + 2.2) continue;
    for (const [wx, wz] of from) {
      /* Into the thing's own space, then the part's. */
      const dx = wx - p.x;
      const dz = wz - p.z;
      const lx = dx * c - dz * s - k.x;
      const lz = dx * s + dz * c - k.z;
      let nx: number;
      let nz: number;
      if ("r" in k) {
        const d = Math.hypot(lx, lz);
        const t = d > k.r ? k.r / d : 1;
        nx = lx * t;
        nz = lz * t;
      } else {
        const bc = Math.cos(k.box.rot);
        const bs = Math.sin(k.box.rot);
        const bx = Math.max(-k.box.hx, Math.min(k.box.hx, lx * bc - lz * bs));
        const bz = Math.max(-k.box.hz, Math.min(k.box.hz, lx * bs + lz * bc));
        nx = bx * bc + bz * bs;
        nz = -bx * bs + bz * bc;
      }
      const w = itemToWorld(p.x, p.z, p.rot, nx + k.x, nz + k.z);
      const ox = w.x - x;
      const oz = w.z - z;
      const d = Math.hypot(ox, oz);
      if (d > reach + 0.35) continue;
      if (arc > -1 && d > 0.6 && (ox * fx + oz * fz) / d < arc - 0.15) continue;
      if (!best || d < best.d) best = { d, x: w.x, y: Math.max(lo, Math.min(hi, y + 1.2)), z: w.z };
    }
  }
  return best;
}

/* ---------- how it looks ---------- */

/* Below this share of its health a thing looks the worse for it: scorched, a little askew. */
export const DAMAGED = 0.5;

export type Look = "intact" | "damaged" | "rubble";

export function lookOf(kind: CatalogueId, hp: number): Look {
  if (hp <= 0) return "rubble";
  return hp < CATALOGUE[kind].health * DAMAGED ? "damaged" : "intact";
}

/* ---------- mending ---------- */

/* Nothing mends until it's been left alone this long (seconds). */
export const HEAL_WAIT = 120;
/* From nothing to whole, mending by itself; and rubble stands up again after this. */
export const HEAL_TIME = 3 * 3600;
export const REBUILD_TIME = 6 * 3600;

/*
 * A thing's health at `now`. What's stored is its health just after it was
 * last hurt (`hitAt`); from HEAL_WAIT after that it mends steadily, whole in
 * HEAL_TIME from nothing. Rubble stays rubble until REBUILD_TIME has passed,
 * then stands up whole. A fire keeps hurting it, so nothing mends while it burns.
 */
export function healthAt(p: PlacedItem, now: number) {
  const max = CATALOGUE[p.kind].health;
  if (p.hitAt === undefined || p.hp >= max) return Math.min(p.hp, max);
  const since = now - p.hitAt;
  if (p.hp <= 0) return since >= REBUILD_TIME ? max : 0;
  return Math.min(max, p.hp + Math.max(0, since - HEAL_WAIT) * (max / HEAL_TIME));
}

/* Mending it at once costs up to this share of its price: all of that for rubble. */
export const REPAIR_SHARE = 0.4;

/* Coins to make it whole now, from `hp`: in proportion to what's missing. */
export function repairCost(kind: CatalogueId, hp: number) {
  const def = CATALOGUE[kind];
  const missing = 1 - Math.max(0, Math.min(1, hp / def.health));
  if (missing <= 0) return 0;
  return Math.max(1, Math.ceil(def.price * REPAIR_SHARE * missing));
}

/* ---------- fire ---------- */

export const FIRE = {
  /* Seconds between the fire's steps in the room. */
  step: 0.5,
  /* A fire burns this long (seconds, somewhere between) before it dies down by itself. */
  life: [40, 90] as const,
  /* Seconds to burn something whole to the ground, and the least it burns a second. */
  burnTime: 50,
  minBurn: 4,
  /* Seconds alight before it can set anything else going, or before a barrel douses it. */
  catchDelay: 4,
  douseDelay: 2.5,
  /* Chance a second of catching from a fire right alongside, in still air. */
  spread: 0.1,
  /* Metres of gap past which nothing catches, even downwind. */
  reach: 10,
  /* Seconds before something can catch again: burnt out, or soaked. */
  cooldown: 120,
  soaked: 30,
  /* Fires at once: in the whole room, and on one plot. */
  maxRoom: 40,
  maxPlot: 24,
};

/* How far a fire on this thing reaches out from its middle. */
export function fireRadius(kind: CatalogueId) {
  const def = CATALOGUE[kind];
  return Math.max(def.hx, def.hz);
}

/*
 * The chance, over `dt` seconds, that a fire on `from` sets `to` alight.
 * It falls off with the open ground between them, and the wind bends it:
 * downwind it reaches further and catches sooner (up to about three times
 * as likely in a stiff breeze), upwind hardly at all.
 */
export function spreadChance(
  from: { x: number; z: number; kind: CatalogueId },
  to: { x: number; z: number; kind: CatalogueId },
  wind: Wind,
  dt: number,
) {
  if (CATALOGUE[to.kind].material !== "wood") return 0;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const gap = Math.max(0, d - fireRadius(from.kind) - fireRadius(to.kind));
  if (gap > FIRE.reach) return 0;
  const speed = Math.hypot(wind.x, wind.z) || 1;
  const along = d > 0.01 ? (dx * wind.x + dz * wind.z) / (d * speed) : 0;
  const bias = Math.max(0.1, 1 + 2.2 * wind.strength * along);
  const fall = 2 + 3 * wind.strength * Math.max(0, along);
  const rate = FIRE.spread * bias * Math.exp(-gap / fall);
  return 1 - Math.exp(-rate * dt);
}
