import {
  type FishId,
  FISH_IDS,
  type Inventory,
  ITEMS,
  type ItemId,
  type Rarity,
  rarityRank,
} from "./items";
import type { Rng } from "./math";

/*
 * Bounties are the only way to earn coins. The board at the lighthouse posts
 * a few; you take one, bring back what it asks for (it counts what's in your
 * pack), and hand it over at the board to be paid.
 */

export type BountyTarget =
  | { kind: "item"; item: ItemId }
  /* Any fish of at least this rarity. */
  | { kind: "rarity"; rarity: Rarity };

export type Bounty = { id: number; target: BountyTarget; count: number; reward: number };

export const BOARD_SIZE = 4;
/* An offer nobody takes is replaced after this long (world seconds). */
export const BOARD_REFRESH = 8 * 60;
/* How close to the board you need to be to deal with it. */
export const BOARD_REACH = 6;

const key = (t: BountyTarget) => (t.kind === "item" ? t.item : `rarity:${t.rarity}`);

function matches(t: BountyTarget, id: ItemId) {
  if (t.kind === "item") return id === t.item;
  const r = ITEMS[id].rarity;
  return ITEMS[id].kind === "fish" && !!r && rarityRank(r) >= rarityRank(t.rarity);
}

export function bountyTitle(b: Bounty) {
  const t = b.target;
  if (t.kind === "rarity") return `Catch ${b.count} ${t.rarity} fish`;
  const def = ITEMS[t.item];
  const name = b.count === 1 ? def.name.toLowerCase() : def.plural;
  if (def.kind === "game") {
    const animal = t.item === "deer" ? "deer" : "boar";
    return `Hunt ${b.count} ${animal}`;
  }
  return b.count === 1 ? `Catch a ${name}` : `Catch ${b.count} ${name}`;
}

/* A hint about where to look. */
export function bountyNote(b: Bounty) {
  const t = b.target;
  if (t.kind === "rarity")
    return t.rarity === "legendary"
      ? "Only in deep water, only at night."
      : "Rare fish keep to deep water: fish from a dock, or row out.";
  return ITEMS[t.item].note;
}

/* How much of it is in your pack right now. */
export function progress(inv: Inventory, b: Bounty) {
  let n = 0;
  for (const [id, c] of Object.entries(inv.items) as [ItemId, number][])
    if (c && matches(b.target, id)) n += c;
  return Math.min(n, b.count);
}

/* Hand the goods over: the least valuable matches go first. */
export function consume(inv: Inventory, b: Bounty) {
  let left = b.count;
  const ids = (Object.keys(inv.items) as ItemId[])
    .filter((id) => matches(b.target, id))
    .sort(
      (a, c) => rarityRank(ITEMS[a].rarity ?? "common") - rarityRank(ITEMS[c].rarity ?? "common"),
    );
  for (const id of ids) {
    const take = Math.min(left, inv.items[id] ?? 0);
    inv.items[id] = (inv.items[id] ?? 0) - take;
    if (!inv.items[id]) delete inv.items[id];
    left -= take;
    if (left <= 0) break;
  }
}

type Template = {
  weight: number;
  make: (rng: Rng) => { target: BountyTarget; count: number; reward: number };
};

const pick = <T>(rng: Rng, xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
const between = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const fishOf = (r: Rarity) => FISH_IDS.filter((f) => ITEMS[f].rarity === r);

const TEMPLATES: Template[] = [
  {
    weight: 4,
    make: (rng) => {
      const count = between(rng, 3, 5);
      return {
        target: { kind: "item", item: pick<FishId>(rng, fishOf("common")) },
        count,
        reward: 6 + count * 5,
      };
    },
  },
  {
    weight: 3,
    make: (rng) => {
      const count = between(rng, 2, 3);
      return {
        target: { kind: "item", item: pick<FishId>(rng, fishOf("uncommon")) },
        count,
        reward: 10 + count * 13,
      };
    },
  },
  { weight: 2, make: () => ({ target: { kind: "rarity", rarity: "rare" }, count: 1, reward: 60 }) },
  {
    weight: 1,
    make: (rng) => ({
      target: { kind: "item", item: pick<FishId>(rng, fishOf("rare")) },
      count: 1,
      reward: 80,
    }),
  },
  {
    weight: 0.4,
    make: () => ({ target: { kind: "item", item: "lanternfish" }, count: 1, reward: 180 }),
  },
  {
    weight: 2.5,
    make: (rng) => {
      const count = between(rng, 1, 2);
      return { target: { kind: "item", item: "deer" }, count, reward: 12 + count * 30 };
    },
  },
  {
    weight: 2.5,
    make: (rng) => {
      const count = between(rng, 1, 2);
      return { target: { kind: "item", item: "boar" }, count, reward: 14 + count * 36 };
    },
  },
];

/* Something a newcomer can do from the beach. */
export function isEasy(b: Bounty) {
  return b.target.kind === "item" && ITEMS[b.target.item].rarity === "common";
}

/*
 * A fresh offer, not asking for the same thing as any of `others`. `easy`
 * forces a common-fish job, so the board always has one for a newcomer.
 */
export function makeBounty(rng: Rng, id: number, others: readonly Bounty[], easy = false): Bounty {
  const taken = new Set(others.map((b) => key(b.target)));
  const total = TEMPLATES.reduce((s, t) => s + t.weight, 0);
  for (let tries = 0; tries < 30; tries++) {
    let r = rng() * total;
    const tpl = easy ? TEMPLATES[0] : (TEMPLATES.find((t) => (r -= t.weight) <= 0) ?? TEMPLATES[0]);
    const b = { id, ...tpl.make(rng) };
    if (!taken.has(key(b.target))) return b;
  }
  return { id, target: { kind: "item", item: "mackerel" }, count: 3, reward: 21 };
}
