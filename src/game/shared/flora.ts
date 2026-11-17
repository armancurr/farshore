import type { BiomeId } from "./islands";
import { createNoise2D, fbm, mulberry32, smoothstep } from "./math";

/*
 * Where things grow on an island. Three smooth fields over its ground, each
 * 0..1, all from the island's seed so every machine grows the same island:
 *
 *   forest   groves of trees, with clearings between them
 *   meadow   thick patches of grass, with bare ground between them
 *   stone    outcrops where boulders gather
 *
 * Coordinates are local to the island (its centre at 0, 0), in metres.
 */

/* The kinds of island: the Harbor, the hunting islands' biomes, and a bought plot. */
export type FloraKind = "harbor" | BiomeId | "plot";

export type FloraDef = {
  /* How much of the land is forest (0..1), and trees per 1000 m² in it and out of it. */
  forest: number;
  dense: number;
  sparse: number;
  /* How much is meadow, and grass tufts per 1000 m² at its thickest. */
  meadow: number;
  grass: number;
  /* How much is stony, and boulders per 1000 m² there and elsewhere. */
  stone: number;
  rocks: number;
  strays: number;
};

export const FLORA: Record<FloraKind, FloraDef> = {
  harbor: {
    forest: 0.3,
    dense: 10,
    sparse: 0.25,
    meadow: 0.68,
    grass: 140,
    stone: 0.15,
    rocks: 3,
    strays: 0.08,
  },
  meadow: {
    forest: 0.25,
    dense: 12,
    sparse: 0.3,
    meadow: 0.75,
    grass: 182,
    stone: 0.15,
    rocks: 3,
    strays: 0.1,
  },
  pinewood: {
    forest: 0.68,
    dense: 18,
    sparse: 1,
    meadow: 0.45,
    grass: 126,
    stone: 0.2,
    rocks: 4,
    strays: 0.15,
  },
  ridge: {
    forest: 0.4,
    dense: 13,
    sparse: 0.5,
    meadow: 0.4,
    grass: 112,
    stone: 0.45,
    rocks: 6,
    strays: 0.4,
  },
  marsh: {
    forest: 0.45,
    dense: 14,
    sparse: 0.6,
    meadow: 0.7,
    grass: 196,
    stone: 0.12,
    rocks: 3,
    strays: 0.1,
  },
  /* A plot is bare: grass, no trees, no stones (it gets a few of its own on the beach). */
  plot: {
    forest: 0,
    dense: 0,
    sparse: 0,
    meadow: 0.7,
    grass: 150,
    stone: 0,
    rocks: 0,
    strays: 0,
  },
  fells: {
    forest: 0.28,
    dense: 11,
    sparse: 0.3,
    meadow: 0.45,
    grass: 112,
    stone: 0.5,
    rocks: 7,
    strays: 0.4,
  },
};

export type Flora = {
  def: FloraDef;
  forest(x: number, z: number): number;
  meadow(x: number, z: number): number;
  stone(x: number, z: number): number;
};

/* How three-octave fbm is spread (measured): the value below which a share q of it falls. */
const SPREAD: [number, number][] = [
  [0, -0.6],
  [0.1, -0.231],
  [0.25, -0.119],
  [0.4, -0.045],
  [0.5, -0.002],
  [0.6, 0.04],
  [0.75, 0.117],
  [0.9, 0.226],
  [1, 0.6],
];

function quantile(q: number) {
  for (let i = 1; i < SPREAD.length; i++) {
    const [q1, v1] = SPREAD[i];
    const [q0, v0] = SPREAD[i - 1];
    if (q <= q1) return v0 + ((q - q0) / (q1 - q0)) * (v1 - v0);
  }
  return 0.6;
}

/*
 * A patchy field: low-frequency noise, cut at a level that leaves `cover` of
 * the land inside a patch, with soft edges a few tens of metres wide.
 */
function patches(seed: number, scale: number, cover: number) {
  const noise = createNoise2D(mulberry32(seed));
  const cut = quantile(1 - cover);
  return (x: number, z: number) => {
    const n = fbm(noise, x / scale, z / scale, 3);
    return smoothstep(cut - 0.06, cut + 0.06, n);
  };
}

export function floraFor(seed: number, kind: FloraKind, size: number): Flora {
  const def = FLORA[kind];
  /* Bigger islands get bigger groves, though not in proportion. */
  const s = Math.sqrt(size / 760);
  const forest = patches(seed ^ 0x6a09e667, 210 * s, def.forest);
  const meadow = patches(seed ^ 0xbb67ae85, 120 * s, def.meadow);
  const stone = patches(seed ^ 0x3c6ef372, 150 * s, def.stone);
  /* The Harbor keeps its middle clear round the lighthouse. */
  const plaza =
    kind === "harbor" ? (x: number, z: number) => smoothstep(45, 90, Math.hypot(x, z)) : () => 1;
  return {
    def,
    forest: (x, z) => forest(x, z) * plaza(x, z),
    /* Grass thins out under the thickest forest, where the canopy shades it. */
    meadow: (x, z) => meadow(x, z) * (1 - 0.5 * forest(x, z)) * (0.6 + 0.4 * plaza(x, z)),
    stone: (x, z) => stone(x, z),
  };
}
