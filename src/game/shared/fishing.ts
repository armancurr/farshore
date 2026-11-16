import { SEA_LEVEL } from "./constants";
import { FISH_IDS, type FishId, ITEMS, type Rarity, rarityRank, type RodDef } from "./items";
import type { Rng } from "./math";

/*
 * Fishing. Cast at water, wait for a bite, then strike while a needle sweeping
 * across a bar is inside the catch window. Deeper water holds rarer fish, and
 * rarer fish give you a narrower window and a faster needle.
 */

export type Waters = "shallow" | "mid" | "deep";

/* How deep the water is (metres) where the line goes in. */
export function depthAt(ground: number) {
  return SEA_LEVEL - ground;
}

export function watersFor(depth: number): Waters {
  return depth < 2.5 ? "shallow" : depth < 7 ? "mid" : "deep";
}

export const WATERS_LABEL: Record<Waters, string> = {
  shallow: "Shallows",
  mid: "Open water",
  deep: "Deep water",
};

/* The line has to land in at least this much water. */
export const MIN_CAST_DEPTH = 0.5;
/* Seconds you have to strike once something bites. */
export const BITE_WINDOW = 3.2;

type FishDef = {
  /* Relative odds in shallow, mid and deep water. */
  odds: [number, number, number];
  night?: "only" | "more";
};

export const FISH: Record<FishId, FishDef> = {
  sprat: { odds: [10, 4, 1] },
  mackerel: { odds: [7, 8, 3] },
  mullet: { odds: [3, 4, 1] },
  bass: { odds: [1, 4, 3] },
  cod: { odds: [0, 1.5, 5] },
  eel: { odds: [0.3, 1, 1.5], night: "more" },
  moonfish: { odds: [0, 0.25, 2.2] },
  lanternfish: { odds: [0, 0, 0.7], night: "only" },
};

/* Per rarity: the catch window (fraction of the bar) and the needle's speed (sweeps a second). */
const STRIKE: Record<Rarity, { width: number; speed: number }> = {
  common: { width: 0.3, speed: 0.55 },
  uncommon: { width: 0.22, speed: 0.72 },
  rare: { width: 0.15, speed: 0.92 },
  legendary: { width: 0.1, speed: 1.15 },
};

export function pickFish(rng: Rng, depth: number, rod: RodDef, night: boolean): FishId {
  const w = watersFor(depth);
  const zone = w === "shallow" ? 0 : w === "mid" ? 1 : 2;
  /* Out past the shelf, rare things come closer to the surface. */
  const open = depth > 11 ? 1.5 : 1;
  let total = 0;
  const odds = FISH_IDS.map((id) => {
    const def = FISH[id];
    const rank = rarityRank(ITEMS[id].rarity ?? "common");
    let o = def.odds[zone] * (1 + rod.luck * rank * 0.6) * (rank >= 2 ? open : 1);
    if (def.night === "only" && !night) o = 0;
    if (def.night === "more" && night) o *= 3;
    total += o;
    return o;
  });
  let r = rng() * total;
  for (let i = 0; i < odds.length; i++) {
    r -= odds[i];
    if (r <= 0) return FISH_IDS[i];
  }
  return "sprat";
}

export type Strike = {
  /* Centre and width of the catch window, as fractions of the bar. */
  c: number;
  w: number;
  speed: number;
  rarity: Rarity;
};

export function strikeFor(rng: Rng, fish: FishId, rod: RodDef): Strike {
  const rarity = ITEMS[fish].rarity ?? "common";
  const s = STRIKE[rarity];
  const w = Math.min(0.5, s.width * rod.window);
  return { c: w / 2 + 0.08 + rng() * (0.84 - w), w, speed: s.speed, rarity };
}

/* Where the needle is, 0..1, `elapsed` seconds after the bite: it sweeps back and forth. */
export function needleAt(elapsed: number, speed: number) {
  const p = (Math.max(0, elapsed) * speed) % 2;
  return p < 1 ? p : 2 - p;
}

export function struck(s: Strike, elapsed: number) {
  return Math.abs(needleAt(elapsed, s.speed) - s.c) <= s.w / 2;
}

export const BITE_TEXT: Record<Rarity, string> = {
  common: "A tug on the line",
  uncommon: "A strong pull",
  rare: "The line runs hard",
  legendary: "Something enormous",
};
