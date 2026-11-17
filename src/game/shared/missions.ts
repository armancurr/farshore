import type { Inventory } from "./items";
import type { Rng } from "./math";
import { isSpeciesId, SPECIES, type SpeciesId } from "./species";

/*
 * The Guild Board, at the top of the lighthouse: the only way to earn coins.
 *
 *   Contracts   one at a time: bring back so many carcasses of a kind and hand
 *               them over at the board.
 *   Alpha       a named beast roams one island for a while. Whoever brings it
 *               down earns the bounty.
 *   Cull        an island is overrun. Everyone who helps clear it is paid from
 *               the pot, by their share of the kills.
 *
 * Alphas and culls pay into your purse at the board: their rewards wait in
 * your pack (as payouts) until you climb up and collect them.
 */

export type Contract = {
  id: number;
  species: SpeciesId;
  count: number;
  reward: number;
  /* The island it's most often found on, as a hint. */
  island: number | null;
};

export type AlphaHunt = {
  id: number;
  species: SpeciesId;
  name: string;
  island: number;
  reward: number;
  /* World time it leaves, if nobody brings it down. */
  endsAt: number;
  /* Who brought it down, once someone has. */
  slainBy: string | null;
};

export type Cull = {
  id: number;
  species: SpeciesId;
  island: number;
  /* Kills needed to clear the island, and kills so far. */
  need: number;
  done: number;
  pot: number;
  endsAt: number;
  state: "active" | "cleared" | "failed";
  /* Kills so far by name, for the board. */
  hunters: { name: string; kills: number }[];
};

/* A reward waiting to be collected at the board. */
export type Payout = { title: string; reward: number };

export type BoardState = {
  contracts: Contract[];
  alpha: AlphaHunt | null;
  cull: Cull | null;
  /* World time of the next alpha or cull, while there's none. */
  nextAlpha: number | null;
  nextCull: number | null;
};

export const BOARD_SIZE = 4;
/* A contract nobody takes is replaced after this long (world seconds). */
export const BOARD_REFRESH = 8 * 60;
/* How close to the board you need to be to deal with it. */
export const BOARD_REACH = 4.5;
/* An alpha roams this long; then a pause before the next. */
export const ALPHA_TIME = 20 * 60;
export const ALPHA_GAP = [4 * 60, 8 * 60] as const;
/* A cull runs this long; then a pause before the next. */
export const CULL_TIME = 15 * 60;
export const CULL_GAP = [6 * 60, 12 * 60] as const;
/* A cull that runs out still pays this share of what each hunter earned. */
export const CULL_FAIL_SHARE = 0.4;
export const MAX_PAYOUTS = 20;

export function contractTitle(c: Contract) {
  const def = SPECIES[c.species];
  return `Hunt ${c.count} ${c.count === 1 ? def.name.toLowerCase() : def.plural}`;
}

/* How many carcasses of the kind are in your pack right now. */
export function progress(inv: Inventory, c: Contract) {
  return Math.min(inv.items[c.species] ?? 0, c.count);
}

/* Hand the carcasses over. */
export function consume(inv: Inventory, c: Contract) {
  const left = (inv.items[c.species] ?? 0) - c.count;
  if (left > 0) inv.items[c.species] = left;
  else delete inv.items[c.species];
}

const between = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

/*
 * A fresh contract, not asking for the same kind as any of `others`. `where`
 * says which islands hold each kind; `easy` asks for something a newcomer can
 * manage with fists and patience.
 */
export function makeContract(
  rng: Rng,
  id: number,
  others: readonly Contract[],
  where: (s: SpeciesId) => number[],
  easy = false,
): Contract {
  const taken = new Set(others.map((c) => c.species));
  const kinds = (Object.keys(SPECIES) as SpeciesId[]).filter(
    (s) => !taken.has(s) && where(s).length > 0,
  );
  const gentle = kinds.filter((s) => SPECIES[s].role === "prey");
  const pool = easy && gentle.length ? gentle : kinds.length ? kinds : ["deer" as SpeciesId];
  const species = pool[Math.floor(rng() * pool.length)];
  const def = SPECIES[species];
  /* Small game comes by the handful; the big and dangerous one or two at a time. */
  const count =
    def.value < 15 ? between(rng, 3, 5) : def.value < 50 ? between(rng, 1, 3) : between(rng, 1, 2);
  const risk = def.role === "predator" ? 1.35 : def.role === "defender" ? 1.15 : 1;
  const reward = Math.round((10 + def.value * count * risk) / 5) * 5;
  const homes = where(species);
  return { id, species, count, reward, island: homes[Math.floor(rng() * homes.length)] ?? null };
}

/* Is (cull, alpha) still worth showing as live? */
export const cullLive = (c: Cull | null) => !!c && c.state === "active";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/* A stored contract, or null (anything from an older board is let go). */
export function parseMission(v: unknown): Contract | null {
  if (!isObj(v) || !int(v.id, 0, 2 ** 31) || !isSpeciesId(v.species)) return null;
  if (!int(v.count, 1, 20) || !int(v.reward, 0, 1e5)) return null;
  const island = int(v.island, 0, 1000) ? v.island : null;
  return { id: v.id, species: v.species, count: v.count, reward: v.reward, island };
}

export function parsePayouts(v: unknown): Payout[] {
  if (!Array.isArray(v)) return [];
  const out: Payout[] = [];
  for (const p of v) {
    if (!isObj(p) || typeof p.title !== "string" || p.title.length > 80) continue;
    if (!int(p.reward, 0, 1e6)) continue;
    out.push({ title: p.title, reward: p.reward });
    if (out.length >= MAX_PAYOUTS) break;
  }
  return out;
}
