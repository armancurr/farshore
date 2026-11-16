import { BOARD_SIZE, type Bounty, type BountyTarget } from "./bounties";
import { BOUNDARY, HEALTH_MAX } from "./constants";
import {
  HOTBAR,
  type Inventory,
  isItemId,
  isKitId,
  isToolKind,
  type ItemId,
  MAX_TOOLS,
  RARITIES,
  type Rarity,
  type Tool,
} from "./items";
import { MAX_PREFABS, type Prefab } from "./prefabs";

/*
 * A saved island: the world (seed, clock, what's built, the board) and the
 * one player's state. Versioned; anything that doesn't parse as the current
 * version is treated as no save at all, and the game starts fresh.
 */

export const SAVE_VERSION = 1;

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

export type SaveData = {
  v: typeof SAVE_VERSION;
  seed: number;
  time: number;
  prefabs: Prefab[];
  board: Bounty[];
  player: SavedPlayer | null;
  /* Next ids to hand out, so new things never collide with saved ones. */
  ids: { tool: number; prefab: number; bounty: number };
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

function prefab(v: unknown): Prefab | null {
  if (!isObj(v) || !id(v.id) || !isKitId(v.kind)) return null;
  const lim = BOUNDARY + 50;
  if (
    !num(v.x, -lim, lim) ||
    !num(v.y, -100, 200) ||
    !num(v.z, -lim, lim) ||
    !num(v.rot, -100, 100)
  )
    return null;
  const p: Prefab = { id: v.id, kind: v.kind, x: v.x, y: v.y, z: v.z, rot: v.rot };
  if (v.kind === "chest") {
    const store = v.store === undefined ? {} : items(v.store);
    if (!store) return null;
    p.store = store;
  }
  return p;
}

function inventory(v: unknown): Inventory | null {
  if (!isObj(v) || !int(v.coins, 0, 1e9) || !int(v.slot, 0, HOTBAR - 1)) return null;
  const its = items(v.items);
  if (!its || !Array.isArray(v.tools) || !Array.isArray(v.hotbar) || v.hotbar.length !== HOTBAR)
    return null;
  const tools: Tool[] = [];
  for (const t of v.tools) {
    if (!isObj(t) || !id(t.id) || !isToolKind(t.kind) || !int(t.uses, -1, 1000)) return null;
    if (t.uses === 0 || tools.some((o) => o.id === t.id)) continue;
    tools.push({ id: t.id, kind: t.kind, uses: t.uses });
  }
  if (tools.length > MAX_TOOLS) return null;
  /* Slot 1 is always fists; other slots must point at tools you have, once each. */
  const seen = new Set<number>();
  const hotbar = v.hotbar.map((h, i) => {
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

/* A save, or null if it's missing, from another version, or damaged in any way that matters. */
export function parseSave(raw: unknown): SaveData | null {
  if (!isObj(raw) || raw.v !== SAVE_VERSION) return null;
  if (!int(raw.seed, 0, 2 ** 32 - 1) || !num(raw.time, 0, 1e9)) return null;
  if (!Array.isArray(raw.prefabs) || !Array.isArray(raw.board) || !isObj(raw.ids)) return null;
  const prefabs: Prefab[] = [];
  for (const v of raw.prefabs.slice(0, MAX_PREFABS)) {
    const p = prefab(v);
    if (!p) return null;
    if (!prefabs.some((o) => o.id === p.id)) prefabs.push(p);
  }
  const board: Bounty[] = [];
  for (const v of raw.board.slice(0, BOARD_SIZE)) {
    const b = bounty(v);
    if (!b) return null;
    board.push(b);
  }
  const pl = raw.player === null ? null : player(raw.player);
  if (raw.player !== null && !pl) return null;
  if (pl?.inv.bed !== null && pl && !prefabs.some((p) => p.id === pl.inv.bed && p.kind === "bed"))
    pl.inv.bed = null;
  /* Ids carry on past anything already in the save. */
  const ids = raw.ids;
  const next = (saved: unknown, used: number[]) =>
    Math.max(id(saved) ? saved : 1, ...used.map((u) => u + 1), 1);
  return {
    v: SAVE_VERSION,
    seed: raw.seed,
    time: raw.time,
    prefabs,
    board,
    player: pl,
    ids: {
      tool: next(ids.tool, pl?.inv.tools.map((t) => t.id) ?? []),
      prefab: next(
        ids.prefab,
        prefabs.map((p) => p.id),
      ),
      bounty: next(ids.bounty, [
        ...board.map((b) => b.id),
        ...(pl?.inv.bounty ? [pl.inv.bounty.id] : []),
      ]),
    },
  };
}
