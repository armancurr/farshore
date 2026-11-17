import { CATALOGUE, isCatalogueId, type PlacedItem, TEAMS, type Team } from "./catalogue";
import { BOUNDARY, HEALTH_MAX } from "./constants";
import { CREW_ID_BASE, type Hand, isCrewName } from "./crew";
import { isPlotShape } from "./islands";
import {
  HOTBAR,
  type Inventory,
  isItemId,
  toToolKind,
  type ItemId,
  MAX_TOOLS,
  type Tool,
} from "./items";
import { parseMission, parsePayouts } from "./missions";
import { type Captor, isPlotSize, PLOT_ID_BASE, PLOT_SIZES, type Plot } from "./plots";
import { isSkinId, type SkinId } from "./skins";
import { migrateKind, type VehicleKind } from "./vehicles";
import { isThrown, STACK, toWeaponKind } from "./weapons";

/*
 * What an online host stores: everyone who's been on the grand map, what
 * they carry, and the plots they've bought. The other islands are authored
 * (see WORLD), so they aren't stored; a plot is a few numbers from which its
 * island is raised again. Anything that doesn't parse is treated as nothing
 * saved.
 */

export type SavedPlayer = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  inv: Inventory;
  /* The vehicle you had out, and whether you were at its helm. */
  vehicle: SavedVehicle | null;
  /* Saved on a map that has since changed: wake on the Harbor, with everything you had. */
  relocate?: boolean;
};

export type SavedVehicle = {
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  aboard: boolean;
};

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number): v is number =>
  num(v, lo, hi) && Number.isInteger(v);
const id = (v: unknown): v is number => int(v, 0, 2 ** 31);

/* Things that no longer exist (fish, building kits) are simply dropped. */
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
    /*
     * Retired weapons come back as their heirs; other retired tools (the
     * pickaxe, the flail, bought variants) are simply gone.
     */
    const kind = toToolKind(t.kind);
    if (!kind || t.uses === 0 || tools.some((o) => o.id === t.id)) continue;
    /* Weapons no longer wear out; kegs and smoke bombs are counted, a stack of them. */
    const stack = isThrown(kind);
    if (stack && t.uses < 1) continue;
    tools.push({ id: t.id, kind, uses: stack ? Math.min(STACK, t.uses) : -1 });
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
  return {
    coins: v.coins,
    items: its,
    tools,
    hotbar,
    slot: v.slot,
    mission,
    payouts: parsePayouts(v.payouts),
  };
}

/*
 * The vehicle someone left with. Older saves kept a rowboat's id (`boat`) for
 * someone sitting in one: that's a rowboat where they sat. A desert bike, or
 * anything else that's gone, is simply dropped.
 */
function vehicle(v: Obj): SavedVehicle | null {
  const lim = BOUNDARY + 10;
  const at = v.vehicle;
  if (isObj(at)) {
    const kind = migrateKind(at.kind);
    if (
      !kind ||
      !num(at.x, -lim, lim) ||
      !num(at.y, -60, 200) ||
      !num(at.z, -lim, lim) ||
      !num(at.rot, -100, 100)
    )
      return null;
    return { kind, x: at.x, y: at.y, z: at.z, rot: at.rot, aboard: at.aboard === true };
  }
  if (id(v.boat))
    return {
      kind: "rowboat",
      x: v.x as number,
      y: 0,
      z: v.z as number,
      rot: v.yaw as number,
      aboard: true,
    };
  return null;
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
    vehicle: relocate ? null : vehicle(v),
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
 * 4: plots of land. A version 3 save loads as it was, with nobody owning any.
 * 5: things bought for a plot (houses, walls, towers) stand on it. A version
 * 4 save loads as it was, every plot still bare.
 * 6: things can be battered and burnt: each keeps when it was last hurt
 * (`hitAt`, for its mending) and whether it burnt down. A version 5 save
 * loads as it was: whatever was short of health mends from long ago, so whole.
 * 7: raids. A plot keeps when its shield drops (`shield`) and, if a raid
 * brought it on, whose colours fly on its Hearth till then (`captor`). A
 * version 6 save loads with every plot unshielded.
 * 8: crew. A plot keeps the men hired for it (`crew`): each one's name, look
 * and weapon. A version 7 save loads with nobody hired.
 */
export const WORLD_SAVE_VERSION = 8;

/* Someone who's been here: who they are, and where they left off. */
export type SavedProfile = {
  token: string;
  name: string;
  saved: SavedPlayer | null;
  /* What they wear; older saves have none and get the default. */
  skin?: SkinId;
};

/* A plot, and whose it is (their profile's token: never sent to anyone else). */
export type SavedPlot = Plot & { owner: string };

/* Everyone who's been on the grand map, their things, and their land. */
export type WorldSave = {
  v: typeof WORLD_SAVE_VERSION;
  players: SavedProfile[];
  plots: SavedPlot[];
  ids: { tool: number; plot: number; item: number; crew: number };
};

/* What stands on a plot: things that no longer exist, or are off its tile, are dropped. */
function placed(v: unknown, size: number, x: number, z: number): PlacedItem[] {
  if (!Array.isArray(v)) return [];
  const out: PlacedItem[] = [];
  const half = size / 2;
  for (const o of v) {
    if (!isObj(o) || !id(o.id) || !isCatalogueId(o.kind)) continue;
    if (!num(o.x, x - half, x + half) || !num(o.z, z - half, z + half)) continue;
    if (!num(o.y, -20, 200) || !num(o.rot, -100, 100)) continue;
    if (out.some((p) => p.id === o.id)) continue;
    const max = CATALOGUE[o.kind].health;
    const hp = num(o.hp, 0, max) ? o.hp : max;
    const item: PlacedItem = { id: o.id, kind: o.kind, x: o.x, y: o.y, z: o.z, rot: o.rot, hp };
    /* Hurt, and when: without a time it's been mending since long ago. */
    if (hp < max) item.hitAt = num(o.hitAt, 0, 1e12) ? o.hitAt : 0;
    if (hp <= 0 && o.burnt === true) item.burnt = true;
    out.push(item);
  }
  return out;
}

/* The plots in a save: one each, for someone who's still in it, all on the map. */
function plots(v: unknown, players: readonly SavedProfile[]): SavedPlot[] {
  if (!Array.isArray(v)) return [];
  const out: SavedPlot[] = [];
  for (const p of v) {
    if (!isObj(p) || !int(p.id, PLOT_ID_BASE, 2 ** 31) || !isPlotSize(p.size)) continue;
    if (!isPlotShape(p.shape) || !int(p.seed, 0, 2 ** 32 - 1)) continue;
    const lim = BOUNDARY - PLOT_SIZES[p.size].size / 2;
    if (!num(p.x, -lim, lim) || !num(p.z, -lim, lim)) continue;
    if (typeof p.owner !== "string" || !players.some((o) => o.token === p.owner)) continue;
    if (out.some((o) => o.id === p.id || o.owner === p.owner)) continue;
    const plot: SavedPlot = {
      id: p.id,
      size: p.size,
      shape: p.shape,
      seed: p.seed,
      x: p.x,
      z: p.z,
      owner: p.owner,
      /* Before version 5 nothing stood on a plot. */
      items: placed(p.items, PLOT_SIZES[p.size].size, p.x, p.z),
    };
    /* Before version 8 nobody was hired. */
    const men = crewOf(p.crew, PLOT_SIZES[p.size].crew);
    if (men.length) plot.crew = men;
    /* Before version 7 nothing was shielded. */
    if (num(p.shield, 0, 1e12)) {
      plot.shield = p.shield;
      const captor = captorOf(p.captor);
      if (captor) plot.captor = captor;
    }
    out.push(plot);
  }
  return out;
}

/* A plot's crew: anyone malformed is dropped, and never more than the land houses. */
function crewOf(v: unknown, cap: number): Hand[] {
  if (!Array.isArray(v)) return [];
  const out: Hand[] = [];
  for (const o of v) {
    if (out.length >= cap) break;
    if (!isObj(o) || !int(o.id, CREW_ID_BASE, 2 ** 31) || !isCrewName(o.name)) continue;
    if (!isSkinId(o.skin)) continue;
    const weapon = o.weapon === null || o.weapon === undefined ? null : toWeaponKind(o.weapon);
    out.push({ id: o.id, name: o.name, skin: o.skin, weapon });
  }
  return out;
}

function captorOf(v: unknown): Captor | null {
  if (!isObj(v) || typeof v.name !== "string" || v.name.length > 40) return null;
  if (!(TEAMS as readonly unknown[]).includes(v.team)) return null;
  return { name: v.name, team: v.team as Team };
}

/* A stored grand map, or null if it's missing or damaged. Bad entries are dropped, not fatal. */
export function parseWorldSave(raw: unknown): WorldSave | null {
  if (!isObj(raw) || !int(raw.v, 1, WORLD_SAVE_VERSION)) return null;
  if (!Array.isArray(raw.players) || !isObj(raw.ids)) return null;
  /* Before version 3 every place on the map may now be sea, a cliff, or somewhere else entirely. */
  const relocate = raw.v < 3;
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
  const land = plots(raw.plots, players);
  /* Ids are unique across every plot: a thing (or a man) that shares one with another is dropped. */
  const seen = new Set<number>();
  for (const p of land)
    p.items = p.items.filter((o) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });
  const hands = new Set<number>();
  for (const p of land) {
    if (!p.crew) continue;
    p.crew = p.crew.filter((o) => {
      if (hands.has(o.id)) return false;
      hands.add(o.id);
      return true;
    });
    if (!p.crew.length) delete p.crew;
  }
  return {
    v: WORLD_SAVE_VERSION,
    players,
    plots: land,
    ids: {
      tool: Math.max(id(raw.ids.tool) ? raw.ids.tool : 1, ...tools, 1),
      plot: Math.max(
        id(raw.ids.plot) ? raw.ids.plot : 0,
        ...land.map((p) => p.id + 1),
        PLOT_ID_BASE,
      ),
      item: Math.max(id(raw.ids.item) ? raw.ids.item : 1, ...[...seen].map((n) => n + 1), 1),
      crew: Math.max(
        id(raw.ids.crew) ? raw.ids.crew : CREW_ID_BASE,
        ...[...hands].map((n) => n + 1),
        CREW_ID_BASE,
      ),
    },
  };
}
