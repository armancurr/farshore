import type { FloraKind } from "./flora";
import type { ModelId } from "./models.gen";

/*
 * What grows where. Trees grow in groves of one species (a grove of
 * umbrella trees, a stand of pines), never a random mix, so each patch of
 * woodland has a character; a few big specimens stand alone in the open as
 * landmarks. Colours come from the pack's palette variants: coral (the
 * world's foliage), teal (pines and grass), peach (blossom).
 */

export type Leaf = "coral" | "teal" | "peach" | "bare";

export type Species = {
  /* The sizes the pack draws it at, smallest first: a grove's edge uses the first. */
  models: readonly ModelId[];
  leaf: Leaf;
  /* How tall a full-grown one stands, in metres. */
  height: number;
  /* How far apart they grow, in metres. */
  spacing: number;
  /* The trunk's collision radius at full size. */
  trunk: number;
};

export const SPECIES_TREES = {
  round: {
    models: ["forest/tree-1-a", "forest/tree-1-b", "forest/tree-1-c"],
    leaf: "coral",
    height: 8,
    spacing: 5,
    trunk: 0.45,
  },
  umbrella: {
    models: ["forest/tree-3-a", "forest/tree-3-b", "forest/tree-3-c"],
    leaf: "coral",
    height: 8.5,
    spacing: 7,
    trunk: 0.5,
  },
  blossom: {
    models: ["forest/tree-1-a", "forest/tree-1-b", "forest/tree-1-c"],
    leaf: "peach",
    height: 7,
    spacing: 5,
    trunk: 0.4,
  },
  boxwood: {
    models: [
      "forest/tree-2-a",
      "forest/tree-2-b",
      "forest/tree-2-c",
      "forest/tree-2-d",
      "forest/tree-2-e",
    ],
    leaf: "coral",
    height: 9,
    spacing: 4.5,
    trunk: 0.35,
  },
  pine: {
    models: ["forest/tree-4-a", "forest/tree-4-b", "forest/tree-4-c"],
    leaf: "teal",
    height: 11,
    spacing: 3.6,
    trunk: 0.35,
  },
  snag: {
    models: ["forest/tree-bare-2-a", "forest/tree-bare-2-b", "forest/tree-bare-2-c"],
    leaf: "bare",
    height: 7,
    spacing: 4,
    trunk: 0.25,
  },
  deadwood: {
    models: ["forest/tree-bare-1-a", "forest/tree-bare-1-b", "forest/tree-bare-1-c"],
    leaf: "bare",
    height: 5,
    spacing: 5,
    trunk: 0.4,
  },
} as const satisfies Record<string, Species>;

export type TreeSpecies = keyof typeof SPECIES_TREES;
export const TREE_SPECIES = Object.keys(SPECIES_TREES) as TreeSpecies[];

/* Per island kind: the groves' species (weighted), and the landmark trees out in the open. Plots grow none. */
export const WOODLAND: Record<
  Exclude<FloraKind, "plot">,
  { groves: [TreeSpecies, number][]; lone: TreeSpecies }
> = {
  harbor: {
    groves: [
      ["round", 3],
      ["blossom", 2],
      ["umbrella", 2],
    ],
    lone: "umbrella",
  },
  meadow: {
    groves: [
      ["umbrella", 3],
      ["round", 2],
      ["blossom", 2],
    ],
    lone: "umbrella",
  },
  pinewood: {
    groves: [
      ["pine", 6],
      ["boxwood", 1],
      ["snag", 1],
    ],
    lone: "pine",
  },
  ridge: {
    groves: [
      ["pine", 4],
      ["boxwood", 2],
      ["deadwood", 1],
    ],
    lone: "deadwood",
  },
  marsh: {
    groves: [
      ["snag", 3],
      ["round", 2],
      ["boxwood", 1],
    ],
    lone: "snag",
  },
  fells: {
    groves: [
      ["boxwood", 3],
      ["pine", 3],
      ["deadwood", 1],
    ],
    lone: "boxwood",
  },
};

/* Boulders that lie about, and the stacked stone columns that stand on high ground and at cliff feet. */
export const BOULDERS: readonly ModelId[] = [
  "forest/rock-3-a",
  "forest/rock-3-b",
  "forest/rock-3-c",
  "forest/rock-3-d",
  "forest/rock-3-e",
  "forest/rock-3-f",
  "forest/rock-3-g",
  "forest/rock-3-h",
  "forest/rock-3-i",
  "forest/rock-3-j",
  "forest/rock-3-k",
  "forest/rock-3-l",
];
export const COLUMNS: readonly ModelId[] = [
  "forest/rock-1-d",
  "forest/rock-1-e",
  "forest/rock-1-f",
  "forest/rock-1-g",
  "forest/rock-1-h",
  "forest/rock-1-j",
  "forest/rock-1-k",
  "forest/rock-1-l",
  "forest/rock-1-m",
];

/* The palette image a leaf colour draws from. */
export const LEAF_PALETTE: Record<Leaf, string> = {
  coral: "/models/forest/palette.png",
  teal: "/models/forest/palette-teal.png",
  peach: "/models/forest/palette-peach.png",
  bare: "/models/forest/palette.png",
};
