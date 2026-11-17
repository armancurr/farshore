import type { FloraKind } from "./flora";
import { mulberry32, range, type Rng } from "./math";
import { MODEL_BOUNDS, type ModelId } from "./models.gen";

/*
 * The places on an island: the spots someone made something of. A hunters'
 * camp round a fire, a watchtower on the high ground, a woodcutter's
 * clearing, a ring of standing stones, an old wall, a wreck on the beach, the
 * landing stage where the boats come in. Each kind is laid out by hand (a
 * recipe of pack models around its centre, facing the way the path comes
 * in); this file only decides where they go. The paths (shared/paths.ts) then
 * join them up, and the trees keep clear of them.
 *
 * Everything is a pure function of the island's seed and ground, so the
 * server and every client agree. Coordinates are the island's own (its
 * centre at 0, 0) until the Terrain moves them out to the grand map.
 */

export type PlaceKind =
  | "landing"
  | "camp"
  | "lookout"
  | "ruin"
  | "woodcut"
  | "wreck"
  | "stones"
  | "paddock"
  | "market"
  | "dock"
  | "hearth";

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
  /* Stands this high over the place's ground (on a plinth, say) rather than on the ground. */
  lift?: number;
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
  /* Where the path should arrive: just in front of it. */
  door: { x: number; z: number };
};

/* What the planner needs to know about the ground. */
export interface PlaceGround {
  readonly radius: number;
  readonly half: number;
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number): [number, number, number];
}

type Item = [
  ModelId,
  number,
  number,
  number?,
  number?,
  ("solid" | "stand" | "deco")?,
  /* How high over the ground it stands. */
  number?,
];

/*
 * Recipes, in the place's own frame: +z is its front. Each item is
 * [model, x, z, rotation, scale, collision]. Scales bring each pack to metres
 * (Kenney's survival kit is about 1:3.5, the town kit 1:3).
 */
const C = 3.5;
const T = 3;

const RECIPES: Record<PlaceKind, (rng: Rng) => Item[]> = {
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

  /* The landing stage: a jetty out over the water, a moored rowboat, crates waiting. */
  landing: () => {
    const out: Item[] = [];
    for (let k = 0; k < 5; k++)
      out.push(["coast/structure-platform-dock", 0, 4 + k * 2.4, 0, 1, "stand"]);
    out.push(["ships/boat-row-small", 2.6, 10, 0.08, 1.35, "deco"]);
    out.push(["coast/crate", -1.8, 0, 0.2, 1, "stand"]);
    out.push(["coast/barrel", -2.6, 1.6, 0, 0.85, "solid"]);
    out.push(["coast/barrel", 1.9, -0.6, 0, 0.85, "solid"]);
    out.push(["coast/flag", 1.4, 3.4, 0, 1.4, "solid"]);
    out.push(["town/lantern", -1.2, 3.4, 0, 1.6, "solid"]);
    return out;
  },

  /* The Harbor's quays: like a landing, but longer and busier. */
  dock: () => {
    const out: Item[] = [];
    for (let k = 0; k < 7; k++)
      out.push(["coast/structure-platform-dock", 0, 4 + k * 2.4, 0, 1, "stand"]);
    out.push(["coast/structure-platform-dock", 2.4, 4 + 6 * 2.4, 0, 1, "stand"]);
    out.push(["ships/boat-row-small", -2.8, 12, -0.1, 1.35, "deco"]);
    out.push(["ships/boat-row-small", 3, 9, 0.12, 1.35, "deco"]);
    out.push(["coast/crate", -1.8, 0.4, 0.2, 1, "stand"]);
    out.push(["coast/crate-bottles", -2.2, 1.8, 0.7, 1, "stand"]);
    out.push(["coast/barrel", 2.2, 0.2, 0, 0.85, "solid"]);
    out.push(["coast/barrel", 2.9, 1.3, 0, 0.85, "solid"]);
    out.push(["town/lantern", 1.3, 3.2, 0, 1.6, "solid"]);
    out.push(["town/lantern", -1.3, 3.2, 0, 1.6, "solid"]);
    return out;
  },

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

  /*
   * The Hearth on a plot: the fire burns on top of the stone plinth
   * (structures.ts HEARTH, a metre high), the owner's flag flies behind it
   * and two lanterns light the way in.
   */
  hearth: () => [
    ["camp/campfire-pit", 0, 0, 0, 4.6, "deco", 1],
    ["camp/campfire-stand", 0, 0, 0.3, C, "deco", 1],
    ["coast/flag-high", -0.6, -4.6, 0, 1.6, "solid"],
    ["town/lantern", -3.6, 3.4, 0, 1.6, "solid"],
    ["town/lantern", 3.6, 3.4, 0, 1.6, "solid"],
  ],
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
  landing: { r: 5, shore: true },
  dock: { r: 5, shore: true },
  market: { r: 12 },
  hearth: { r: 8 },
};

/* What each kind of island has, in the order they're placed (the landing first: it's where you arrive). */
const PLAN: Record<FloraKind, PlaceKind[]> = {
  harbor: ["dock", "dock", "dock", "camp", "paddock", "camp"],
  meadow: ["landing", "camp", "paddock", "stones", "ruin", "lookout", "camp"],
  pinewood: ["landing", "camp", "woodcut", "woodcut", "lookout", "ruin"],
  ridge: ["landing", "camp", "lookout", "lookout", "ruin", "stones"],
  marsh: ["landing", "wreck", "camp", "stones", "ruin", "woodcut"],
  fells: ["landing", "camp", "lookout", "ruin", "stones", "woodcut", "wreck"],
  /* A plot has only its Hearth, at its very middle (see below). */
  plot: [],
};

const TAU = Math.PI * 2;

/*
 * Lay out an island's places. `taken` holds what's already there (the
 * lighthouse); everything placed is added to it. `toward` is the direction
 * the landing faces: back toward the Harbor, where the boats come from.
 */
export function planPlaces(
  ground: PlaceGround,
  seed: number,
  kind: FloraKind,
  taken: { x: number; z: number; r: number }[],
  opts: { toward: number; lighthouse?: { x: number; z: number } },
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
    for (let a = 0; a < 10; a++)
      for (const k of [0.4, 1]) {
        const h = ground.heightAt(x + Math.cos(a * 0.628) * r * k, z + Math.sin(a * 0.628) * r * k);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    return { lo, hi, mid: ground.heightAt(x, z) };
  };

  if (kind === "plot") {
    /* The Hearth stands in the middle of the plot, its front toward the Harbor. */
    const hearth = make("hearth", 0, 0, ground.heightAt(0, 0), faceAway(opts.toward), rng);
    taken.push({ x: 0, z: 0, r: hearth.r });
    return [hearth];
  }

  if (kind === "harbor" && opts.lighthouse) {
    /* The market fills the square in front of the lighthouse, facing the main quay. */
    const lh = opts.lighthouse;
    const a = opts.toward;
    const x = lh.x + Math.cos(a) * 30;
    const z = lh.z + Math.sin(a) * 30;
    const market = make("market", x, z, ground.heightAt(x, z), faceAway(a + Math.PI), rng);
    places.push(market);
    taken.push({ x, z, r: market.r });
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
        const first = places.every((p) => p.kind !== want);
        const a =
          want === "landing" || (want === "dock" && first)
            ? opts.toward + range(rng, -0.5, 0.5)
            : rng() * TAU;
        const hit = coast(ground, a);
        if (!hit) continue;
        x = hit.x;
        z = hit.z;
        /* Jetties run out to sea; a wreck lies along the beach. */
        rot = faceAway(a);
        if (want === "wreck") rot += Math.PI / 2;
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
    /* Inland places face the island's middle, so the path comes in at the front. */
    const rot =
      need.shore || want === "lookout" ? best.rot : faceAway(Math.atan2(-best.z, -best.x));
    const place = make(want, best.x, best.z, y, rot, rng);
    places.push(place);
    taken.push({ x: place.x, z: place.z, r: place.r });
  }
  return places;
}

/* The rotation (about +y) that turns a place's front (+z) toward bearing a. */
function faceAway(a: number) {
  return Math.atan2(Math.cos(a), Math.sin(a));
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

function make(kind: PlaceKind, x: number, z: number, y: number, rot: number, rng: Rng): Place {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const models: PlacedModel[] = RECIPES[kind](rng).map(
    ([model, lx, lz, r = 0, scale = 1, col = "solid", lift]) => ({
      model,
      /* Local (lx, lz) turned by rot about +y, as three.js turns things. */
      x: x + lx * c + lz * s,
      y,
      z: z - lx * s + lz * c,
      rot: rot + r,
      scale,
      solid: col !== "deco",
      stand: col === "stand",
      lift,
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
