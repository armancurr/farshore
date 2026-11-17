import { type PlacedItem, TEAMS, type Team } from "./catalogue";
import { BOUNDARY } from "./constants";
import type { Hand } from "./crew";
import { type IslandInfo, type PlotShapeId, plotReach } from "./islands";

/*
 * Land of your own. A plot is bought in the marketplace, set down anywhere on
 * the open sea with room round it, and raised like any other island from its
 * shape, seed and size. One each, and it's never lost. Every plot has a
 * Hearth at its middle, where its owner wakes.
 */

export const PLOT_SIZE_IDS = ["cove", "isle", "holm", "reach"] as const;
export type PlotSizeId = (typeof PLOT_SIZE_IDS)[number];

export const isPlotSize = (v: unknown): v is PlotSizeId =>
  typeof v === "string" && (PLOT_SIZE_IDS as readonly string[]).includes(v);

export type PlotSizeDef = {
  name: string;
  /* The tile's side, and the spacing of its height samples, in metres. */
  size: number;
  cell: number;
  price: number;
  /* How many things bought from the marketplace it holds. */
  items: number;
  /* How many men it can house: the most crew you can hire. */
  crew: number;
};

/* Coarse cells keep the biggest grid near 160 a side: cheap for the room to hold. */
export const PLOT_SIZES: Record<PlotSizeId, PlotSizeDef> = {
  cove: { name: "Cove", size: 160, cell: 2, price: 600, items: 40, crew: 3 },
  isle: { name: "Isle", size: 240, cell: 2.5, price: 2500, items: 90, crew: 6 },
  holm: { name: "Holm", size: 340, cell: 2.5, price: 8000, items: 170, crew: 10 },
  reach: { name: "Reach", size: 480, cell: 3, price: 25000, items: 300, crew: 16 },
};

/* Plots take island ids from here up; the authored islands keep the low ones. */
export const PLOT_ID_BASE = 100;

/* Open sea kept between a plot's coast and anyone else's. */
export const PLOT_GAP = 150;

/* Ground at least this level (the y of its normal) takes a building: about 1 in 4 at worst. */
export const BUILD_NY = 0.97;

/* A plot as the room keeps it, with everything set down on it. */
export type Plot = {
  id: number;
  size: PlotSizeId;
  shape: PlotShapeId;
  seed: number;
  x: number;
  z: number;
  items: PlacedItem[];
  /* The men who live there (see crew.ts); older saves have none. */
  crew?: Hand[];
  /* Shielded until then (the room's clock, seconds): nobody can raid it. */
  shield?: number;
  /* Who took its Hearth, when the shield is from a raid: their colours fly there till it drops. */
  captor?: Captor;
};

export type Captor = { name: string; team: Team };

/*
 * Every plot flies a team colour, on its roofs, banners and trim. It comes
 * from the plot's id, so neighbours bought one after another differ.
 */
export const plotTeam = (id: number): Team => TEAMS[id % TEAMS.length];

export const plotName = (owner: string, size: PlotSizeId) => `${owner}'s ${PLOT_SIZES[size].name}`;

/* ---------- shields ---------- */

/* Once its Hearth is captured an isle is shielded this long (seconds), so nobody else can loot it. */
export const SHIELD_TIME = 8 * 3600;
/* New land starts shielded this long: nobody raids a brand-new player before they've built a thing. */
export const STARTER_SHIELD = 2 * 3600;

export const shielded = (p: { shield?: number }, now: number) => (p.shield ?? 0) > now;

/* The island a plot raises, named for its owner. */
export function plotIsland(p: Omit<Plot, "items">, owner: string, mine = false): IslandInfo {
  const def = PLOT_SIZES[p.size];
  return {
    id: p.id,
    shape: p.shape,
    seed: p.seed,
    x: p.x,
    z: p.z,
    size: def.size,
    cell: def.cell,
    lift: 1,
    name: plotName(owner, p.size),
    plot: { size: p.size, owner, mine },
  };
}

/* The bigger sizes a plot can grow to, smallest first. */
export function upgradesOf(size: PlotSizeId): PlotSizeId[] {
  return PLOT_SIZE_IDS.slice(PLOT_SIZE_IDS.indexOf(size) + 1);
}

/* ---------- where a plot may go ---------- */

/* What the spacing check needs to know of an island already out there. */
type Ground = {
  readonly heights: Float32Array;
  readonly grid: number;
  readonly cell: number;
  readonly half: number;
  readonly ox: number;
  readonly oz: number;
};

/*
 * An island's coast, as points about 8 m apart: every dry sample with water
 * next to it. Islands never change, so each is worked out once.
 */
const coasts = new WeakMap<Ground, Float32Array>();

export function coastOf(t: Ground): Float32Array {
  const known = coasts.get(t);
  if (known) return known;
  const g = t.grid;
  const step = Math.max(1, Math.round(8 / t.cell));
  const dry = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < g && j < g && t.heights[i * g + j] > 0;
  const pts: number[] = [];
  for (let i = 0; i < g; i += step)
    for (let j = 0; j < g; j += step) {
      if (!dry(i, j)) continue;
      if (dry(i - step, j) && dry(i + step, j) && dry(i, j - step) && dry(i, j + step)) continue;
      pts.push(t.ox - t.half + j * t.cell, t.oz - t.half + i * t.cell);
    }
  const out = new Float32Array(pts);
  coasts.set(t, out);
  return out;
}

export type SpotCheck = { ok: true } | { ok: false; reason: string };

/*
 * Can a plot of this size go here? Its whole tile on the map and clear of
 * every other island's tile, and its coast (taken as far as any shape can
 * reach) PLOT_GAP of open sea from anyone else's. `ignore` is the plot being
 * grown in place. The client checks the same way to draw its preview.
 */
export function checkPlotSpot(
  islands: Iterable<{ info: IslandInfo; terrain: Ground }>,
  size: PlotSizeId,
  x: number,
  z: number,
  ignore: number | null = null,
): SpotCheck {
  const def = PLOT_SIZES[size];
  const half = def.size / 2;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: "Nowhere" };
  if (Math.abs(x) + half > BOUNDARY || Math.abs(z) + half > BOUNDARY)
    return { ok: false, reason: "Too near the edge of the map" };
  const reach = plotReach(def.size);
  const clear = reach + PLOT_GAP;
  for (const { info, terrain } of islands) {
    if (info.id === ignore) continue;
    const span = (info.size + def.size) / 2;
    if (Math.abs(info.x - x) < span && Math.abs(info.z - z) < span)
      return { ok: false, reason: `Too close to ${info.name}` };
    /* Too far off for any of its coast to matter. */
    if (Math.max(Math.abs(info.x - x), Math.abs(info.z - z)) - info.size / 2 > clear) continue;
    const pts = coastOf(terrain);
    for (let k = 0; k < pts.length; k += 2) {
      const dx = pts[k] - x;
      const dz = pts[k + 1] - z;
      if (dx * dx + dz * dz < clear * clear)
        return { ok: false, reason: `Keep ${PLOT_GAP} m of sea from ${info.name}` };
    }
  }
  return { ok: true };
}

/* ---------- how much of it you can build on ---------- */

/*
 * The dry ground on an island, and the share of it level enough to build
 * on (its normal at least BUILD_NY upright).
 */
export function flatness(t: {
  heights: Float32Array;
  grid: number;
  cell: number;
  half: number;
  ox: number;
  oz: number;
  normalAt(x: number, z: number): [number, number, number];
}) {
  let land = 0;
  let flat = 0;
  const g = t.grid;
  for (let i = 0; i < g; i++)
    for (let j = 0; j < g; j++) {
      if (t.heights[i * g + j] <= 0) continue;
      land++;
      if (t.normalAt(t.ox - t.half + j * t.cell, t.oz - t.half + i * t.cell)[1] >= BUILD_NY) flat++;
    }
  return { area: land * t.cell * t.cell, flat: land ? flat / land : 0 };
}
