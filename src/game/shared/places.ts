import type { BiomeId } from "./islands";
import { mulberry32, range, type Rng } from "./math";
import { MODEL_BOUNDS, type ModelId } from "./models.gen";

/*
 * The places on an island: the spots someone made something of. A hunters'
 * camp round a fire, a watchtower on the high ground, a woodcutter's
 * clearing, a ring of standing stones, an old wall, a wreck on the beach, a
 * flag on the summit, and the piers where the boats come in. Each kind is
 * laid out by hand (a recipe of pack models around its centre, facing the way
 * the road comes in); this file only decides where they go. The roads
 * (shared/paths.ts) then join them up, and the trees keep clear of them.
 *
 * Everything is a pure function of the island's seed and ground, so the
 * server and every client agree. Coordinates are the island's own (its
 * centre at 0, 0) until the Terrain moves them out to the grand map.
 */

export type PlaceKind =
  | "pier"
  | "summit"
  | "camp"
  | "lookout"
  | "ruin"
  | "woodcut"
  | "wreck"
  | "stones"
  | "paddock"
  | "market"
  | "view";

/* The height of a pier's deck (and the quay at its root) above the sea. */
export const DECK = 1;

/*
 * One side of a pier where boats tie up: a line along the deck's edge, from
 * `(x, z)` near the root out to `length` metres along `(dx, dz)`, the open
 * water off to `(nx, nz)`.
 */
export type Berth = {
  x: number;
  z: number;
  dx: number;
  dz: number;
  nx: number;
  nz: number;
  length: number;
};

/* One model set down at a place. `solid` gives it collision; `stand` lets you climb on it. */
export type PlacedModel = {
  model: ModelId;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  solid: boolean;
  stand: boolean;
  /* Sunk this far into the ground (a dock's piles, a wreck's keel). */
  sink?: number;
  /* Stands on the water rather than the ground. */
  float?: boolean;
};

export type Place = {
  kind: PlaceKind;
  x: number;
  z: number;
  /* Ground level the place was levelled to. */
  y: number;
  /* The way its front faces (radians, about +y; the path arrives from there). */
  rot: number;
  /* How much ground it takes. */
  r: number;
  models: PlacedModel[];
  /* Where the road should arrive: just in front of it. */
  door: { x: number; z: number };
  /* A pier's quay: the level square at its root the road comes into. */
  quay?: { x: number; z: number; r: number };
  /* A pier's deck, which carts and cars drive onto: its middle, half extents and turn. */
  deck?: { x: number; z: number; hx: number; hz: number; rot: number };
  /* A pier's berths, one down each side. */
  berths?: Berth[];
};

/* What the planner needs to know about the ground. */
export interface PlaceGround {
  readonly radius: number;
  readonly half: number;
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number): [number, number, number];
}

type Item = [ModelId, number, number, number?, number?, ("solid" | "stand" | "deco")?];

/*
 * Recipes, in the place's own frame: +z is its front. Each item is
 * [model, x, z, rotation, scale, collision]. Scales bring each pack to metres
 * (Kenney's survival kit is about 1:3.5, the town kit 1:3).
 */
const C = 3.5;
const T = 3;

const RECIPES: Record<Exclude<PlaceKind, "pier">, (rng: Rng) => Item[]> = {
  /* A hunters' camp: two tents at the back, a fire with log seats, the kit piled to one side. */
  camp: (rng) => [
    ["camp/campfire-pit", 0, 0, rng() * 6, 4.2, "deco"],
    ["camp/campfire-stand", 0, 0, 0.3, C, "deco"],
    ["camp/tent-canvas", -3.4, -4.2, 0.35, C * 1.1, "solid"],
    ["camp/tent", 3.6, -3.8, -0.4, C * 1.1, "solid"],
    ["camp/tree-log", -2.7, 1.1, 1.25, 2.6, "stand"],
    ["camp/tree-log", 2.5, 1.7, -1.05, 2.6, "stand"],
    ["camp/bedroll", -1.2, -2.2, 0.2, 3.2, "deco"],
    ["camp/bedroll-packed", 1.3, -2.4, -0.3, C, "deco"],
    ["camp/box-large", 5.6, 0.4, 0.15, C, "stand"],
    ["camp/box", 5.4, 1.9, 0.6, C, "stand"],
    ["camp/barrel", 6.4, -1.1, 0, 3, "solid"],
    ["camp/chest", -5.2, -1.6, 1.1, C, "stand"],
    ["camp/resource-wood", -5.4, 1.4, 0.4, 4.5, "deco"],
    ["camp/resource-wood", -5.0, 2.2, 0.9, 4.5, "deco"],
    ["camp/bucket", 4.6, -1.8, 0, C, "deco"],
    ["camp/signpost-single", 1.6, 7.6, Math.PI, C, "solid"],
  ],

  /* A watchtower on the high ground with a cannon and a flag, looking out to sea. */
  lookout: () => [
    ["coast/tower-watch", 0, -1, 0, 2.3, "solid"],
    ["coast/flag-high", 2.8, -3.8, 0, 1.6, "solid"],
    ["coast/cannon", 0, 4.2, 0, 1.15, "solid"],
    ["coast/barrel", -3.6, 1.6, 0, 0.85, "solid"],
    ["coast/barrel", -4.4, 0.4, 0, 0.85, "solid"],
    ["coast/crate", 3.8, 1.4, 0.3, 1, "stand"],
    ["camp/resource-stone", -2.4, 3.8, 0, 4, "deco"],
  ],

  /* An old wall, mostly fallen: a broken ring of masonry round a few pillars. */
  ruin: (rng) => {
    const out: Item[] = [];
    const walls: ModelId[] = [
      "town/wall-broken",
      "town/wall-block",
      "town/wall-arch",
      "town/wall-block-half",
    ];
    for (let k = 0; k < 9; k++) {
      if (k === 4 || (k === 6 && rng() < 0.5)) continue; // the gaps: one is the way in
      const a = (k / 9) * Math.PI * 2 + Math.PI / 2;
      const r = 6.5;
      out.push([
        walls[(k * 3 + Math.floor(rng() * 2)) % walls.length],
        Math.cos(a) * r,
        Math.sin(a) * r,
        -a,
        T,
        "solid",
      ]);
    }
    out.push(["town/pillar-stone", -1.8, -1.2, 0, T * 1.2, "solid"]);
    out.push(["town/pillar-stone", 1.9, -1.0, 0, T * 0.8, "solid"]);
    out.push(["town/rock-large", 0.4, 2.4, rng() * 6, 1.6, "stand"]);
    out.push(["town/fountain-round", 0, -3.6, 0, 1.4, "stand"]);
    return out;
  },

  /* A woodcutter's clearing: stumps, a log pile, a cart, the bench and its tools. */
  woodcut: (rng) => [
    ["camp/workbench", 0, -3.2, 0, C, "stand"],
    ["camp/workbench-anvil", 2.4, -3.4, 0.2, C, "stand"],
    ["camp/tree-log", -3.6, -1.2, 0.1, 3, "stand"],
    ["camp/tree-log", -3.4, -0.2, 0.05, 3, "stand"],
    ["camp/tree-log", -3.5, -0.7, 0.08, 3, "stand"],
    ["camp/tree-trunk", 1.2, 1.4, rng() * 6, 4, "stand"],
    ["camp/tree-trunk", -1.6, 3.2, rng() * 6, 3.6, "stand"],
    ["camp/tree-trunk", 3.8, 2.6, rng() * 6, 4.2, "stand"],
    ["camp/tool-axe", 1.2, 1.4, 0.8, C, "deco"],
    ["camp/resource-wood", 4.6, -0.6, 0.3, 5, "deco"],
    ["camp/resource-planks", 5.2, -2.4, 1.2, C, "deco"],
    ["town/cart", -4.6, 3.6, 0.9, T, "solid"],
    ["camp/barrel", 0.8, -5.2, 0, 3, "solid"],
  ],

  /* A wreck run aground, its cargo strewn up the beach. */
  wreck: (rng) => [
    ["ships/ship-wreck", 0, -6, 0.3 + rng() * 0.4, 1.9, "solid"],
    ["coast/crate", -4.2, 3.4, rng() * 6, 1, "stand"],
    ["coast/crate-bottles", 3.6, 2.2, rng() * 6, 1, "stand"],
    ["coast/barrel", 1.4, 5.2, rng() * 6, 0.85, "solid"],
    ["coast/barrel", -1.4, 6.4, 0, 0.85, "solid"],
    ["coast/rocks-sand-a", 7, -2, rng() * 6, 1.2, "stand"],
  ],

  /* A ring of standing stones round a flat altar stone. */
  stones: (rng) => {
    const out: Item[] = [];
    const ids: ModelId[] = [
      "forest/rock-1-i",
      "forest/rock-1-g",
      "forest/rock-1-h",
      "forest/rock-1-e",
    ];
    const n = 7;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.3;
      out.push([
        ids[k % ids.length],
        Math.cos(a) * 7,
        Math.sin(a) * 7,
        rng() * 6,
        range(rng, 1.2, 1.6),
        "solid",
      ]);
    }
    out.push(["camp/rock-flat", 0, 0, rng() * 6, 2.2, "stand"]);
    return out;
  },

  /* A paddock: a fenced square with a gate on the path side, a cart and a trough of barrels. */
  paddock: (rng) => {
    const out: Item[] = [];
    const W = 7;
    const seg = 3;
    for (let s = -2; s <= 2; s++) {
      out.push(["town/fence", s * seg, -W, Math.PI / 2, T, "solid"]);
      if (s !== 0) out.push(["town/fence", s * seg, W, -Math.PI / 2, T, "solid"]);
      else out.push(["town/fence-gate", 0, W, -Math.PI / 2, T, "deco"]);
      out.push(["town/fence", -W - 0.5, s * seg, Math.PI, T, "solid"]);
      out.push(["town/fence", W + 0.5, s * seg, 0, T, "solid"]);
    }
    out.push(["town/cart-high", W + 3.6, 2, 0.4 + rng() * 0.3, T, "solid"]);
    out.push(["camp/barrel", -W - 2.4, -2, 0, 3, "solid"]);
    out.push(["camp/barrel", -W - 2.2, -0.8, 0, 3, "solid"]);
    out.push(["camp/bucket", -W - 2.6, 0.4, 0, C, "deco"]);
    return out;
  },

  /* The summit: a flag to say you made it, benches facing the view, a cairn of the stones carried up. */
  summit: (rng) => [
    ["coast/flag-high-pennant", 0, -2.5, 0, 1.8, "solid"],
    ["town/stall-bench", -3.2, 1.8, 0.35, T, "stand"],
    ["town/stall-bench", 3.2, 1.8, -0.35, T, "stand"],
    ["camp/resource-stone", -1.4, -3.6, rng() * 6, 4.5, "deco"],
    ["camp/resource-stone", -2.2, -2.8, rng() * 6, 3.5, "deco"],
    ["town/lantern", 1.6, -2.2, 0, 1.6, "solid"],
  ],

  /* A viewpoint at a road's end: a bench looking out the way the road was going, and a signpost. */
  view: () => [
    ["town/stall-bench", 0, 1.2, 0, T, "stand"],
    ["camp/signpost-single", -2.4, -0.8, 0.4, C, "solid"],
  ],

  /* A market by the lighthouse: stalls in an arc facing the square, carts and barrels between. */
  market: (rng) => {
    const out: Item[] = [];
    const stalls: ModelId[] = [
      "town/stall-red",
      "town/stall-green",
      "town/stall-red",
      "town/stall-green",
      "town/stall-red",
    ];
    for (let k = 0; k < stalls.length; k++) {
      const a = (k - 2) * 0.32;
      out.push([stalls[k], Math.sin(a) * 9, -Math.cos(a) * 9 + 2, a, T, "solid"]);
    }
    out.push(["town/cart-high", -10.5, 3.5, 0.9 + rng() * 0.2, T, "solid"]);
    out.push(["town/cart", 10.2, 4.2, -1.1, T, "solid"]);
    out.push(["town/stall-bench", -3, 1.6, 0, T, "stand"]);
    out.push(["town/stall-bench", 3, 1.6, 0, T, "stand"]);
    out.push(["camp/barrel", -6.8, -2.4, 0, 3, "solid"]);
    out.push(["camp/barrel", -7.4, -1.2, 0, 3, "solid"]);
    out.push(["coast/crate", 7.2, -1.8, 0.4, 1, "stand"]);
    out.push(["town/lantern", -5.4, 2.8, 0, 1.6, "solid"]);
    out.push(["town/lantern", 5.4, 2.8, 0, 1.6, "solid"]);
    out.push(["town/banner-red", 0, -7.4, 0, T, "deco"]);
    return out;
  },
};

/* How much flat ground each place needs, and whether it sits on the shore. */
const NEEDS: Record<PlaceKind, { r: number; shore?: boolean; high?: boolean }> = {
  camp: { r: 9 },
  lookout: { r: 6.5, high: true },
  ruin: { r: 8.5 },
  woodcut: { r: 8 },
  wreck: { r: 11, shore: true },
  stones: { r: 9 },
  paddock: { r: 11.5 },
  market: { r: 12 },
  summit: { r: 9 },
  view: { r: 4 },
  pier: { r: 10, shore: true },
};

/* What each kind of island has, in the order they're placed (after its piers, its summit or its market). */
const PLAN: Record<"harbor" | BiomeId, Exclude<PlaceKind, "pier">[]> = {
  harbor: ["camp", "paddock", "camp"],
  meadow: ["camp", "paddock", "stones", "ruin", "lookout", "camp"],
  pinewood: ["camp", "woodcut", "woodcut", "lookout", "ruin"],
  ridge: ["camp", "lookout", "lookout", "ruin", "stones"],
  marsh: ["wreck", "camp", "stones", "ruin", "woodcut"],
  fells: ["camp", "lookout", "ruin", "stones", "woodcut", "wreck"],
};

const TAU = Math.PI * 2;

/*
 * Lay out an island's places. `taken` holds what's already there (the
 * lighthouse); everything placed is added to it. `piers` are the bearings
 * the piers face, one each, back toward where the boats come from: the
 * Harbor from a hunting island; each hunting island from the Harbor (the
 * first is the main quay). A hunting island's `summit` gets its flag.
 */
export function planPlaces(
  ground: PlaceGround,
  seed: number,
  kind: "harbor" | BiomeId,
  taken: { x: number; z: number; r: number }[],
  opts: {
    piers: readonly number[];
    lighthouse?: { x: number; z: number };
    summit?: { x: number; z: number };
  },
): Place[] {
  const rng = mulberry32(seed ^ 0x2545f491);
  const places: Place[] = [];
  /* Places keep well apart, so each one is somewhere you go. */
  const spacing = kind === "harbor" ? 70 : 140;
  const free = (x: number, z: number, r: number) =>
    taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r + 4) &&
    places.every((p) => Math.hypot(p.x - x, p.z - z) > spacing);

  /* How flat a disc of ground is, and how high. */
  const level = (x: number, z: number, r: number) => {
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    for (let a = 0; a < 10; a++)
      for (const k of [0.4, 1]) {
        const h = ground.heightAt(x + Math.cos(a * 0.628) * r * k, z + Math.sin(a * 0.628) * r * k);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        sum += h;
      }
    return { lo, hi, mid: ground.heightAt(x, z), mean: sum / 20 };
  };
  const put = (place: Place) => {
    places.push(place);
    taken.push({ x: place.x, z: place.z, r: place.r });
    if (place.quay) taken.push(place.quay);
  };

  /* The piers first: they're where everyone arrives. */
  opts.piers.forEach((a, k) => {
    const main = kind === "harbor" && k === 0;
    const spec: PierSpec =
      kind === "harbor"
        ? { cols: main ? 4 : 3, depth: main ? 5 : 4.2, min: main ? 58 : 46, max: main ? 92 : 80 }
        : { cols: 3, depth: 3.4, min: 36, max: 70 };
    const site = sitePier(ground, a, spec, places);
    if (site) put(makePier(site, spec, rng, kind === "harbor" ? (main ? 3 : 2) : 1));
  });

  if (opts.summit) {
    /* The very top: a flag, facing back down toward the piers. */
    const s = opts.summit;
    const pier = places[0];
    const rot = pier ? faceAway(Math.atan2(pier.z - s.z, pier.x - s.x)) : rng() * TAU;
    put(make("summit", s.x, s.z, level(s.x, s.z, NEEDS.summit.r).mean, rot, rng));
  }

  if (kind === "harbor" && opts.lighthouse) {
    /*
     * The market faces the lighthouse square from between the first two
     * avenues (they run out to the piers, so the stalls stand clear of them).
     */
    const lh = opts.lighthouse;
    const [a0, a1 = a0 + 1.2] = opts.piers;
    const a = a0 + wrapAngle(a1 - a0) / 2;
    const x = lh.x + Math.cos(a) * 50;
    const z = lh.z + Math.sin(a) * 50;
    put(make("market", x, z, ground.heightAt(x, z), faceAway(a + Math.PI), rng));
  }

  for (const want of PLAN[kind]) {
    const need = NEEDS[want];
    let best: { x: number; z: number; score: number; rot: number } | null = null;
    for (let t = 0; t < 900; t++) {
      let x: number;
      let z: number;
      let rot: number;
      if (need.shore) {
        /* Walk in from the sea along a bearing until the ground comes up out of the water. */
        const a = rng() * TAU;
        const hit = coast(ground, a);
        if (!hit) continue;
        x = hit.x;
        z = hit.z;
        /* A wreck lies along the beach. */
        rot = faceAway(a) + Math.PI / 2;
      } else {
        const a = rng() * TAU;
        const d = Math.sqrt(rng()) * ground.radius * 0.85;
        x = Math.cos(a) * d;
        z = Math.sin(a) * d;
        rot = rng() * TAU;
      }
      if (!free(x, z, need.r)) continue;
      const lv = level(x, z, need.r);
      let score: number;
      if (need.shore) {
        if (lv.mid < -0.2 || lv.mid > 1.6) continue;
        score = -Math.abs(lv.mid - 0.6);
      } else {
        if (lv.lo < 2.2 || lv.hi - lv.lo > 2.6) continue;
        /* Flatter is better; lookouts want height, the rest want a middle height. */
        score = -(lv.hi - lv.lo) * 2 + (need.high ? lv.mid * 0.6 : -Math.abs(lv.mid - 9) * 0.15);
      }
      if (!best || score > best.score) best = { x, z, score, rot };
      if (t > 260 && best) break;
    }
    if (!best) continue;
    const y = need.shore ? 0.6 : level(best.x, best.z, need.r).mid;
    /* Inland places face the island's middle, so the road comes in at the front. */
    const rot =
      need.shore || want === "lookout" ? best.rot : faceAway(Math.atan2(-best.z, -best.x));
    put(make(want, best.x, best.z, y, rot, rng));
  }
  return places;
}

/* The rotation (about +y) that turns a place's front (+z) toward bearing a. */
function faceAway(a: number) {
  return Math.atan2(Math.cos(a), Math.sin(a));
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/* Where a bearing from the island's middle first meets the shore, coming in from the sea. */
function coast(ground: PlaceGround, a: number) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let d = ground.half * 0.95; d > 10; d -= 2) {
    if (ground.heightAt(c * d, s * d) > 0.4) return { x: c * (d + 1), z: s * (d + 1) };
  }
  return null;
}

/* A viewpoint at (x, z), the bench facing along (dx, dz). */
export function makeView(x: number, z: number, y: number, dx: number, dz: number, seed: number) {
  return make("view", x, z, y, Math.atan2(dx, dz), mulberry32(seed));
}

/* ---------- piers ---------- */

/*
 * How a pier is built: `cols` planks of decking across (each 2.5 m or so),
 * run out until the water under it is `depth` deep (a ship's draft and some),
 * but never shorter than `min` metres or longer than `max`.
 */
type PierSpec = { cols: number; depth: number; min: number; max: number };

type PierSite = { x: number; z: number; dx: number; dz: number; length: number };

const PIER_TILE: ModelId = "coast/structure-platform-dock";
/* The quay at the root: a level square on the shore, this far inland and this wide. */
const QUAY_BACK = 12;
const QUAY_R = 10;

/*
 * The best stretch of shore near bearing `a` for a pier: where the beach
 * runs straight out into deep water (no sandbar for the deck to run aground
 * on, nothing either side to scrape a hull), with low ground behind it for
 * the quay, close to the bearing, and not too long a walk out.
 */
function sitePier(
  ground: PlaceGround,
  a: number,
  spec: PierSpec,
  others: Place[],
): PierSite | null {
  const width = spec.cols * 2.6;
  let best: (PierSite & { score: number }) | null = null;
  for (let k = -8; k <= 8; k++) {
    const b = a + k * 0.045;
    const hit = coast(ground, b);
    if (!hit) continue;
    if (others.some((o) => o.kind === "pier" && Math.hypot(o.x - hit.x, o.z - hit.z) < 90))
      continue;
    /* Straight down the beach, out to sea: the shore's own fall, if it's near the bearing. */
    const e = 10;
    let dx = ground.heightAt(hit.x - e, hit.z) - ground.heightAt(hit.x + e, hit.z);
    let dz = ground.heightAt(hit.x, hit.z - e) - ground.heightAt(hit.x, hit.z + e);
    const len = Math.hypot(dx, dz);
    const bx = Math.cos(b);
    const bz = Math.sin(b);
    if (len < 1e-4 || (dx * bx + dz * bz) / len < 0.6) {
      dx = bx;
      dz = bz;
    } else {
      dx /= len;
      dz /= len;
    }
    /* Out along the deck and either side of it, until it's deep enough. */
    let reached = -1;
    let shoal = 0;
    for (let s = 4; s <= spec.max; s += 2) {
      for (const side of [-1, 0, 1]) {
        const w = side * (width / 2 + 5);
        const h = ground.heightAt(hit.x + dx * s - dz * w, hit.z + dz * s + dx * w);
        if (s > 10 && h > -0.4) shoal++;
        if (side === 0 && reached < 0 && h <= -spec.depth) reached = s;
      }
    }
    if (shoal > 3) continue;
    const length = Math.min(spec.max, Math.max(spec.min, (reached < 0 ? spec.max : reached) + 14));
    /* Low, gentle ground behind it for the quay. */
    const back = ground.heightAt(
      hit.x - dx * (QUAY_BACK + QUAY_R),
      hit.z - dz * (QUAY_BACK + QUAY_R),
    );
    if (back > 7) continue;
    const score =
      -Math.abs(k) * 1.2 - length * 0.15 - back * 1.5 - shoal * 3 - (reached < 0 ? 12 : 0);
    if (!best || score > best.score) best = { x: hit.x, z: hit.z, dx, dz, length, score };
  }
  return best;
}

/*
 * A pier: a broad deck of planking on piles, run straight out from a quay
 * on the shore, wide enough to drive a cart down. Lanterns at the end and at
 * the root, the cargo stacked on the quay to either side of the road, and
 * boats tied up along its sides (`moored` of them). Its berths are the open
 * water down each side, where boats are put when they're launched here.
 */
function makePier(site: PierSite, spec: PierSpec, rng: Rng, moored: number): Place {
  const { x, z, dx, dz, length } = site;
  const rot = Math.atan2(dx, dz);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const at = (lx: number, lz: number) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
  const models: PlacedModel[] = [];
  const add = (
    model: ModelId,
    lx: number,
    lz: number,
    r: number,
    scale: number,
    col: Item[5],
    float = false,
  ) =>
    models.push({
      model,
      ...at(lx, lz),
      y: DECK,
      rot: rot + r,
      scale,
      solid: col !== "deco",
      stand: col === "stand",
      float: float || undefined,
    });

  /* The deck: from just behind the waterline (over the quay) out to its end. */
  const b = MODEL_BOUNDS[PIER_TILE];
  const scale = 1.04;
  const across = (b.max[0] - b.min[0]) * scale;
  const along = (b.max[2] - b.min[2]) * scale;
  const width = across * spec.cols;
  const start = -4;
  const rows = Math.ceil((length - start) / along);
  const end = start + rows * along;
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < spec.cols; k++)
      add(
        PIER_TILE,
        (k - (spec.cols - 1) / 2) * across,
        start + (r + 0.5) * along,
        0,
        scale,
        "deco",
        true,
      );

  /* Lanterns at the end and the root, a flag on the quay, cargo either side of the road. */
  const edge = width / 2 - 0.35;
  for (const side of [-1, 1]) {
    add("town/lantern", side * edge, end - 0.6, 0, 1.6, "solid");
    add("town/lantern", side * (width / 2 + 1.4), -1, 0, 1.6, "solid");
  }
  add("coast/flag-high", width / 2 + 3.5, -QUAY_BACK + 2, 0, 1.4, "solid");
  add("coast/crate", -(width / 2 + 3.2), -QUAY_BACK + 3, 0.2, 1, "stand");
  add("coast/crate-bottles", -(width / 2 + 3.6), -QUAY_BACK + 1.4, 0.7, 1, "stand");
  add("coast/barrel", -(width / 2 + 5), -QUAY_BACK + 2.4, 0, 0.85, "solid");
  add("coast/barrel", width / 2 + 5.2, -QUAY_BACK - 1.5, 0, 0.85, "solid");
  add("coast/crate", width / 2 + 4.6, -QUAY_BACK - 3.2, -0.4, 1, "stand");

  /* The berths: down each side, from where the water deepens to the end. */
  const from = 8;
  const berths: Berth[] = [-1, 1].map((side) => {
    const p = at((side * width) / 2, from);
    return { ...p, dx, dz, nx: side * c, nz: -side * s, length: end - from };
  });

  /* Boats tied up alongside, bows to the sea, spread out along both sides. */
  const fleet: { model: ModelId; scale: number }[] = [
    { model: "ships/boat-row-small", scale: 1.35 },
    { model: "ships/boat-row-large", scale: 1.35 },
    { model: "ships/boat-row-small", scale: 1.35 },
  ];
  for (let k = 0; k < moored; k++) {
    const boat = fleet[k % fleet.length];
    const e = MODEL_BOUNDS[boat.model];
    const beam = ((e.max[0] - e.min[0]) / 2) * boat.scale;
    const side = k % 2 ? 1 : -1;
    /* Near the root, where the water's shallow: the deep berths are left for what's launched. */
    const lz = from + 4 + Math.floor(k / 2) * 6 + range(rng, 0, 2);
    add(
      boat.model,
      side * (width / 2 + beam + 0.4),
      lz,
      range(rng, -0.06, 0.06),
      boat.scale,
      "solid",
      true,
    );
  }

  const quay = at(0, -QUAY_BACK);
  const door = at(0, -QUAY_BACK - QUAY_R + 2);
  const mid = at(0, (start + end) / 2);
  return {
    kind: "pier",
    x,
    z,
    y: DECK,
    rot,
    r: NEEDS.pier.r,
    models,
    door,
    quay: { ...quay, r: QUAY_R },
    deck: { ...mid, hx: width / 2, hz: (end - start) / 2, rot },
    berths,
  };
}

function make(
  kind: Exclude<PlaceKind, "pier">,
  x: number,
  z: number,
  y: number,
  rot: number,
  rng: Rng,
): Place {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const models: PlacedModel[] = RECIPES[kind](rng).map(
    ([model, lx, lz, r = 0, scale = 1, col = "solid"]) => ({
      model,
      /* Local (lx, lz) turned by rot about +y, as three.js turns things. */
      x: x + lx * c + lz * s,
      y,
      z: z - lx * s + lz * c,
      rot: rot + r,
      scale,
      solid: col !== "deco",
      stand: col === "stand",
    }),
  );
  const shore = NEEDS[kind].shore;
  if (shore)
    for (const m of models)
      if (m.model.includes("dock") || m.model.includes("boat")) m.float = true;
  return {
    kind,
    x,
    z,
    y,
    rot,
    r: NEEDS[kind].r,
    models,
    /* The front (+z) points along (sin rot, cos rot): out to sea for a jetty, so its door is behind it. */
    door: {
      x: x + s * (NEEDS[kind].r + 3) * (shore ? -1 : 1),
      z: z + c * (NEEDS[kind].r + 3) * (shore ? -1 : 1),
    },
  };
}

/* A model's footprint and height at a scale, from the build's bounds. */
export function modelExtent(id: ModelId, scale: number) {
  const b = MODEL_BOUNDS[id];
  return {
    hx: ((b.max[0] - b.min[0]) / 2) * scale,
    hz: ((b.max[2] - b.min[2]) / 2) * scale,
    cx: ((b.max[0] + b.min[0]) / 2) * scale,
    cz: ((b.max[2] + b.min[2]) / 2) * scale,
    top: b.max[1] * scale,
    bottom: b.min[1] * scale,
  };
}
