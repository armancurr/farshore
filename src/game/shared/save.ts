import type { Bounty, BountyTarget } from "./bounties";
import { BOUNDARY, HEALTH_MAX, MAX_ISLANDS } from "./constants";
import { type IslandInfo, isShapeId, PLACE_LIMIT, tilesOverlap } from "./islands";
import {
  HOTBAR,
  type Inventory,
  isItemId,
  isToolKind,
  type ItemId,
  MAX_TOOLS,
  RARITIES,
  type Rarity,
  type Tool,
} from "./items";
import { isSkinId, type SkinId } from "./skins";

/*
 * What an online host stores: the grand map, and everyone who's been on it.
 * Anything that doesn't parse as the current version is treated as nothing
 * saved, and the map starts empty.
 */

export type SavedPlayer = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  inv: Inventory;
  /* The rowboat you were sitting in. */
  boat: number | null;
};

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number): v is number =>
  num(v, lo, hi) && Number.isInteger(v);
const id = (v: unknown): v is number => int(v, 0, 2 ** 31);

function items(v: unknown): Partial<Record<ItemId, number>> | null {
  if (!isObj(v)) return null;
  const out: Partial<Record<ItemId, number>> = {};
  for (const [k, n] of Object.entries(v)) {
    if (!isItemId(k) || !int(n, 0, 1e6)) return null;
    if (n > 0) out[k] = n;
  }
  return out;
}

function target(v: unknown): BountyTarget | null {
  if (!isObj(v)) return null;
  if (v.kind === "item" && isItemId(v.item)) return { kind: "item", item: v.item };
  if (v.kind === "rarity" && RARITIES.includes(v.rarity as Rarity))
    return { kind: "rarity", rarity: v.rarity as Rarity };
  return null;
}

function bounty(v: unknown): Bounty | null {
  if (!isObj(v) || !id(v.id) || !int(v.count, 1, 20) || !int(v.reward, 0, 1e5)) return null;
  const t = target(v.target);
  return t ? { id: v.id, target: t, count: v.count, reward: v.reward } : null;
}

function inventory(v: unknown): Inventory | null {
  if (!isObj(v) || !int(v.coins, 0, 1e9) || !int(v.slot, 0, HOTBAR - 1)) return null;
  const its = items(v.items);
  /* Older saves have a shorter belt; the new slots start empty. */
  if (!its || !Array.isArray(v.tools) || !Array.isArray(v.hotbar) || v.hotbar.length > HOTBAR)
    return null;
  const saved: unknown[] = [...v.hotbar, ...Array(HOTBAR - v.hotbar.length).fill(null)];
  const tools: Tool[] = [];
  for (const t of v.tools) {
    if (!isObj(t) || !id(t.id) || !isToolKind(t.kind) || !int(t.uses, -1, 1000)) return null;
    if (t.uses === 0 || tools.some((o) => o.id === t.id)) continue;
    tools.push({ id: t.id, kind: t.kind, uses: t.uses });
  }
  if (tools.length > MAX_TOOLS) return null;
  /* Slot 1 is always fists; other slots must point at tools you have, once each. */
  const seen = new Set<number>();
  const hotbar = saved.map((h, i) => {
    if (i === 0 || !id(h) || seen.has(h) || !tools.some((t) => t.id === h)) return null;
    seen.add(h);
    return h;
  });
  const b = v.bounty === null || v.bounty === undefined ? null : bounty(v.bounty);
  if (v.bounty && !b) return null;
  const bed = id(v.bed) ? v.bed : null;
  return { coins: v.coins, items: its, tools, hotbar, slot: v.slot, bounty: b, bed };
}

function player(v: unknown): SavedPlayer | null {
  if (!isObj(v)) return null;
  const lim = BOUNDARY + 10;
  if (!num(v.x, -lim, lim) || !num(v.y, -60, 200) || !num(v.z, -lim, lim) || !num(v.yaw, -100, 100))
    return null;
  if (!num(v.health, 0, HEALTH_MAX)) return null;
  const inv = inventory(v.inv);
  if (!inv) return null;
  return {
    x: v.x,
    y: v.y,
    z: v.z,
    yaw: v.yaw,
    health: Math.max(1, v.health),
    inv,
    boat: id(v.boat) ? v.boat : null,
  };
}

/* ---------- the online grand map ---------- */

export const WORLD_SAVE_VERSION = 1;

/* Someone who's been here: who they are, their island, and where they left off. */
export type SavedProfile = {
  token: string;
  name: string;
  island: number | null;
  saved: SavedPlayer | null;
  /* What they wear; older saves have none and get the default. */
  skin?: SkinId;
};

/*
 * The shared grand map, as an online host stores it: the islands, who owns
 * each, and every player's things. Built pieces aren't kept yet.
 */
export type WorldSave = {
  v: typeof WORLD_SAVE_VERSION;
  islands: IslandInfo[];
  players: SavedProfile[];
  ids: { island: number; tool: number };
};

function island(v: unknown): IslandInfo | null {
  if (!isObj(v) || !id(v.id) || !isShapeId(v.shape) || !int(v.seed, 0, 2 ** 32 - 1)) return null;
  if (!num(v.x, -PLACE_LIMIT - 1, PLACE_LIMIT + 1) || !num(v.z, -PLACE_LIMIT - 1, PLACE_LIMIT + 1))
    return null;
  if (typeof v.name !== "string" || v.name.length > 40) return null;
  return { id: v.id, shape: v.shape, seed: v.seed, x: v.x, z: v.z, name: v.name };
}

/* A stored grand map, or null if it's missing or damaged. Bad entries are dropped, not fatal. */
export function parseWorldSave(raw: unknown): WorldSave | null {
  if (!isObj(raw) || raw.v !== WORLD_SAVE_VERSION || !Array.isArray(raw.islands)) return null;
  if (!Array.isArray(raw.players) || !isObj(raw.ids)) return null;
  const islands: IslandInfo[] = [];
  for (const v of raw.islands) {
    const o = island(v);
    if (!o || islands.length >= MAX_ISLANDS) continue;
    if (islands.some((p) => p.id === o.id || tilesOverlap(p.x, p.z, o.x, o.z))) continue;
    islands.push(o);
  }
  const players: SavedProfile[] = [];
  for (const v of raw.players) {
    if (!isObj(v) || typeof v.token !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(v.token))
      continue;
    if (typeof v.name !== "string" || v.name.length > 40) continue;
    if (players.some((p) => p.token === v.token)) continue;
    const isl = id(v.island) && islands.some((o) => o.id === v.island) ? v.island : null;
    const saved = v.saved === null || v.saved === undefined ? null : player(v.saved);
    players.push({
      token: v.token,
      name: v.name,
      island: isl,
      saved: isl === null ? null : saved,
      skin: isSkinId(v.skin) ? v.skin : undefined,
    });
  }
  const tools = players.flatMap((p) => p.saved?.inv.tools.map((t) => t.id + 1) ?? []);
  return {
    v: WORLD_SAVE_VERSION,
    islands,
    players,
    ids: {
      island: Math.max(id(raw.ids.island) ? raw.ids.island : 1, ...islands.map((o) => o.id + 1), 1),
      tool: Math.max(id(raw.ids.tool) ? raw.ids.tool : 1, ...tools, 1),
    },
  };
}
