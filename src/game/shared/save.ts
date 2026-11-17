import { BOUNDARY, HEALTH_MAX } from "./constants";
import {
  HOTBAR,
  type Inventory,
  isItemId,
  isToolKind,
  type ItemId,
  MAX_TOOLS,
  type Tool,
  TOOLS,
} from "./items";
import { parseMission, parsePayouts } from "./missions";
import { isSkinId, type SkinId } from "./skins";

/*
 * What an online host stores: everyone who's been on the grand map, and what
 * they carry. The islands themselves are authored (see WORLD), so they aren't
 * stored. Anything that doesn't parse is treated as nothing saved.
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
  /* Saved on a map that has since changed: wake on the Harbor, with everything you had. */
  relocate?: boolean;
};

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number): v is number =>
  num(v, lo, hi) && Number.isInteger(v);
const id = (v: unknown): v is number => int(v, 0, 2 ** 31);

/* Things that no longer exist (fish, say) are simply dropped. */
function items(v: unknown): Partial<Record<ItemId, number>> | null {
  if (!isObj(v)) return null;
  const out: Partial<Record<ItemId, number>> = {};
  for (const [k, n] of Object.entries(v)) {
    if (!isItemId(k) || !int(n, 0, 1e6)) continue;
    if (n > 0) out[k] = n;
  }
  return out;
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
    if (!isObj(t) || !id(t.id) || !int(t.uses, -1, 1000)) return null;
    /* Retired tools (the sword, the pickaxe, the flail, bought variants) are simply gone. */
    if (!isToolKind(t.kind) || t.uses === 0 || tools.some((o) => o.id === t.id)) continue;
    /* Weapons no longer wear out. */
    tools.push({ id: t.id, kind: t.kind, uses: TOOLS[t.kind].weapon ? -1 : t.uses });
  }
  if (tools.length > MAX_TOOLS) return null;
  /* Slot 1 is always fists; other slots must point at tools you have, once each. */
  const seen = new Set<number>();
  const hotbar = saved.map((h, i) => {
    if (i === 0 || !id(h) || seen.has(h) || !tools.some((t) => t.id === h)) return null;
    seen.add(h);
    return h;
  });
  /* A mission from an older board (a fishing bounty, say) is quietly let go. */
  const mission = parseMission(v.mission);
  const bed = id(v.bed) ? v.bed : null;
  return {
    coins: v.coins,
    items: its,
    tools,
    hotbar,
    slot: v.slot,
    mission,
    payouts: parsePayouts(v.payouts),
    bed,
  };
}

function player(v: unknown, relocate: boolean): SavedPlayer | null {
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
    boat: relocate ? null : id(v.boat) ? v.boat : null,
    relocate: relocate || v.relocate === true,
  };
}

/* ---------- the online grand map ---------- */

/*
 * 2: the islands are authored, and nobody settles land of their own. A
 * version 1 save still loads: its islands are dropped, and everyone keeps
 * what they carry but wakes on the Harbor.
 * 3: the islands were reshaped (terraces, places, paths). Older saves load
 * the same way: everyone keeps their things and wakes on the Harbor.
 */
export const WORLD_SAVE_VERSION = 3;

/* Someone who's been here: who they are, and where they left off. */
export type SavedProfile = {
  token: string;
  name: string;
  saved: SavedPlayer | null;
  /* What they wear; older saves have none and get the default. */
  skin?: SkinId;
};

/* Everyone who's been on the grand map, and their things. Built pieces aren't kept yet. */
export type WorldSave = {
  v: typeof WORLD_SAVE_VERSION;
  players: SavedProfile[];
  ids: { tool: number };
};

/* A stored grand map, or null if it's missing or damaged. Bad entries are dropped, not fatal. */
export function parseWorldSave(raw: unknown): WorldSave | null {
  if (!isObj(raw) || (raw.v !== 1 && raw.v !== 2 && raw.v !== WORLD_SAVE_VERSION)) return null;
  if (!Array.isArray(raw.players) || !isObj(raw.ids)) return null;
  /* Every place on an old map may now be sea, a cliff, or somewhere else entirely. */
  const relocate = raw.v !== WORLD_SAVE_VERSION;
  const players: SavedProfile[] = [];
  for (const v of raw.players) {
    if (!isObj(v) || typeof v.token !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(v.token))
      continue;
    if (typeof v.name !== "string" || v.name.length > 40) continue;
    if (players.some((p) => p.token === v.token)) continue;
    const saved = v.saved === null || v.saved === undefined ? null : player(v.saved, relocate);
    players.push({
      token: v.token,
      name: v.name,
      saved,
      skin: isSkinId(v.skin) ? v.skin : undefined,
    });
  }
  const tools = players.flatMap((p) => p.saved?.inv.tools.map((t) => t.id + 1) ?? []);
  return {
    v: WORLD_SAVE_VERSION,
    players,
    ids: { tool: Math.max(id(raw.ids.tool) ? raw.ids.tool : 1, ...tools, 1) },
  };
}
