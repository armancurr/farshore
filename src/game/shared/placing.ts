import {
  CATALOGUE,
  type CatalogueId,
  type CatalogueItem,
  DECK,
  itemToWorld,
  type PlacedItem,
} from "./catalogue";
import { SEA_FLOOR } from "./constants";
import type { Solid, Spot } from "./terrain";

/*
 * Setting ready-made things down on your land: where they may go, what they
 * collide with once they're there, and how the ghost snaps. The room judges
 * every placement with checkItem; the client runs the same check to colour
 * its ghost.
 */

/* How far from you (to the thing's middle) you can set something down. */
export const PLACE_REACH = 26;
/* Nothing goes this close to the Hearth: the fire, its flag and lanterns. */
export const HEARTH_CLEAR = 6;
/* Ground at least this far above the sea counts as dry: a beach is fine. */
const DRY = 0.12;
/* How near a wall's end the ghost has to come to snap onto it. */
const SNAP = 3;

/* What the checks need of a plot's ground. */
export type PlotGround = {
  readonly ox: number;
  readonly oz: number;
  readonly half: number;
  readonly hearth: Spot | null;
  heightAt(x: number, z: number): number;
};

export type Verdict = { ok: true; y: number } | { ok: false; y: number; reason: string };

/* A footprint on the ground: its middle, half extents and heading. */
type Rect = { x: number; z: number; hx: number; hz: number; rot: number };

function rectOf(def: CatalogueItem, x: number, z: number, rot: number, shrink = 0): Rect {
  return { x, z, hx: Math.max(0.05, def.hx - shrink), hz: Math.max(0.05, def.hz - shrink), rot };
}

/* A wall's spine: the thin line it runs along, a little short of its ends. */
function spineOf(def: CatalogueItem, x: number, z: number, rot: number): Rect {
  return { x, z, hx: Math.max(0.05, def.hx - 0.3), hz: 0.12, rot };
}

/* Do two footprints overlap? Separating axes: each rectangle's two edges. */
export function rectsOverlap(a: Rect, b: Rect) {
  const axes = [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const t of axes) {
    /* The axis in the world, as local x turns: (cos, -sin). */
    const ax = Math.cos(t);
    const az = -Math.sin(t);
    const reach = (r: Rect) => {
      const c = Math.cos(r.rot);
      const s = Math.sin(r.rot);
      /* Local x is (c, -s) in the world, local z is (s, c). */
      return r.hx * Math.abs(c * ax - s * az) + r.hz * Math.abs(s * ax + c * az);
    };
    if (Math.abs(dx * ax + dz * az) > reach(a) + reach(b)) return false;
  }
  return true;
}

/* The two ends of a wall, in the world. */
export function wallEnds(def: CatalogueItem, x: number, z: number, rot: number) {
  return [itemToWorld(x, z, rot, -def.hx, 0), itemToWorld(x, z, rot, def.hx, 0)];
}

/* A post standing on one of a wall's ends: they're meant to meet. */
function joined(wall: CatalogueItem, w: Rect, post: Rect) {
  return wallEnds(wall, w.x, w.z, w.rot).some((e) => Math.hypot(e.x - post.x, e.z - post.z) < 0.6);
}

/*
 * Would these two be in each other's way? Walls may meet end to end at any
 * angle (only their spines must not cross), and posts may stand on wall ends.
 */
function clash(a: CatalogueItem, ar: Rect, b: CatalogueItem, br: Rect) {
  if (a.wall && b.wall)
    return rectsOverlap(spineOf(a, ar.x, ar.z, ar.rot), spineOf(b, br.x, br.z, br.rot));
  if (a.wall && b.post && joined(a, ar, br)) return false;
  if (b.wall && a.post && joined(b, br, ar)) return false;
  return rectsOverlap(rectOf(a, ar.x, ar.z, ar.rot, 0.05), rectOf(b, br.x, br.z, br.rot, 0.05));
}

/* Points over a footprint about a metre apart, edges and corners included, in the world. */
function samples(def: CatalogueItem, x: number, z: number, rot: number) {
  const nx = Math.max(2, Math.ceil((def.hx * 2) / 1.2));
  const nz = Math.max(2, Math.ceil((def.hz * 2) / 1.2));
  const out: { x: number; z: number; lz: number }[] = [];
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const lx = -def.hx + (i / nx) * def.hx * 2;
      const lz = -def.hz + (j / nz) * def.hz * 2;
      out.push({ ...itemToWorld(x, z, rot, lx, lz), lz });
    }
  return out;
}

/* Most the ground may rise and fall under something this big. */
function spreadOf(def: CatalogueItem) {
  return Math.min(1.4, 0.5 + 0.035 * Math.hypot(def.hx * 2, def.hz * 2));
}

/*
 * May this go here, on this plot? Wholly on its tile and on dry land (a
 * jetty: its back on the beach, the rest over the shallows), on ground level
 * enough, clear of the Hearth and of everything else on it. `ignore` is the
 * thing being moved. The verdict carries the height it would stand at.
 */
export function checkItem(
  ground: PlotGround,
  items: Iterable<PlacedItem>,
  kind: CatalogueId,
  x: number,
  z: number,
  rot: number,
  ignore: number | null = null,
): Verdict {
  const def = CATALOGUE[kind];
  const pts = samples(def, x, z, rot);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const h = ground.heightAt(p.x, p.z);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const shore = def.placing === "shore";
  /* On the ground, sunk a touch so it never floats; a jetty's deck is always at the same height. */
  const y = shore ? DECK - def.top : lo - 0.05;
  const no = (reason: string): Verdict => ({ ok: false, y, reason });
  const edge = ground.half - 2;
  if (pts.some((p) => Math.abs(p.x - ground.ox) > edge || Math.abs(p.z - ground.oz) > edge))
    return no("Off your land");
  if (shore) {
    const hs = pts.map((p) => ground.heightAt(p.x, p.z));
    if (!hs.some((h) => h < 0)) return no("A jetty runs out over the water");
    if (pts.some((p, k) => p.lz <= -def.hz + 0.01 && hs[k] < DRY))
      return no("Its back end has to rest on the beach");
    if (hi > DECK - 0.1) return no("The ground is too high under the deck");
    if (lo < SEA_FLOOR + 6) return no("The water is too deep there");
  } else {
    if (lo < DRY) return no("Not in the water");
    if (hi - lo > spreadOf(def)) return no("The ground is too uneven");
  }
  const h = ground.hearth;
  if (h) {
    /* The nearest point of the footprint to the Hearth's middle. */
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const dx = h.x - x;
    const dz = h.z - z;
    const lx = Math.max(-def.hx, Math.min(def.hx, dx * c - dz * s));
    const lz = Math.max(-def.hz, Math.min(def.hz, dx * s + dz * c));
    const near = itemToWorld(x, z, rot, lx, lz);
    if (Math.hypot(near.x - h.x, near.z - h.z) < HEARTH_CLEAR) return no("Too close to the Hearth");
  }
  const me: Rect = { x, z, hx: def.hx, hz: def.hz, rot };
  for (const o of items) {
    if (o.id === ignore) continue;
    const od = CATALOGUE[o.kind];
    /* Too far apart to touch. */
    if (Math.hypot(o.x - x, o.z - z) > Math.hypot(def.hx, def.hz) + Math.hypot(od.hx, od.hz))
      continue;
    if (clash(def, me, od, { x: o.x, z: o.z, hx: od.hx, hz: od.hz, rot: o.rot }))
      return no(`In the way of your ${od.name.toLowerCase()}`);
  }
  return { ok: true, y };
}

/* Collision for something placed, in the world. Rubble has none: a wall knocked down is a way through. */
export function itemSolids(p: PlacedItem): Solid[] {
  if (p.hp <= 0) return [];
  const def = CATALOGUE[p.kind];
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  return def.colliders.map((k) => {
    const at = itemToWorld(p.x, p.z, p.rot, k.x, k.z);
    const base = {
      x: at.x,
      z: at.z,
      bottom: p.y + k.bottom,
      top: p.y + k.top,
      standable: k.stand,
    };
    if ("r" in k) return { ...base, r: k.r };
    const t = p.rot + k.box.rot;
    return {
      ...base,
      r: Math.hypot(k.box.hx, k.box.hz),
      box: {
        hx: k.box.hx,
        hz: k.box.hz,
        c: k.box.rot ? Math.cos(t) : c,
        s: k.box.rot ? Math.sin(t) : s,
      },
    };
  });
}

/* Is (x, z) over this thing's footprint (with `pad` to spare)? */
export function overItem(p: PlacedItem, x: number, z: number, pad = 0) {
  const def = CATALOGUE[p.kind];
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const dx = x - p.x;
  const dz = z - p.z;
  return Math.abs(dx * c - dz * s) <= def.hx + pad && Math.abs(dx * s + dz * c) <= def.hz + pad;
}

/* ---------- snapping ---------- */

export const ROT_STEP = Math.PI / 12;
export const FINE_ROT_STEP = Math.PI / 60;
const GRID = 0.5;
const FINE_GRID = 0.1;

const snapTo = (v: number, step: number) => Math.round(v / step) * step;
/* The turn nearest `want` that's a whole number of steps from `ref`. */
const turnFrom = (ref: number, want: number, step: number) => ref + snapTo(want - ref, step);

export type Snapped = { x: number; z: number; rot: number; snapped: boolean };

/*
 * Where the ghost goes for a crosshair at (x, z) and a heading of `rot`.
 * Walls snap end to end onto the nearest wall end or post, turned a whole
 * number of steps from the one they meet, so a ring closes cleanly; posts
 * snap onto wall ends; everything else sits on a half-metre grid and turns
 * in 15° steps (`fine`: a tenth of a metre and 3°).
 */
export function snapItem(
  items: Iterable<PlacedItem>,
  kind: CatalogueId,
  x: number,
  z: number,
  rot: number,
  fine: boolean,
  ignore: number | null = null,
): Snapped {
  const def = CATALOGUE[kind];
  const step = fine ? FINE_ROT_STEP : ROT_STEP;
  const free: Snapped = {
    x: snapTo(x, fine ? FINE_GRID : GRID),
    z: snapTo(z, fine ? FINE_GRID : GRID),
    rot: snapTo(rot, step),
    snapped: false,
  };
  if (!def.wall && !def.post) return free;
  const others = [...items].filter((o) => o.id !== ignore);
  /* Where it could join: wall ends (and, for a wall, posts), each with the heading of what's there. */
  const anchors: { x: number; z: number; rot: number }[] = [];
  for (const o of others) {
    const od = CATALOGUE[o.kind];
    if (od.wall) for (const e of wallEnds(od, o.x, o.z, o.rot)) anchors.push({ ...e, rot: o.rot });
    else if (od.post && def.wall) anchors.push({ x: o.x, z: o.z, rot: o.rot });
  }
  let best: Snapped | null = null;
  let bestD = Infinity;
  for (const a of anchors) {
    if (def.post) {
      const d = Math.hypot(a.x - x, a.z - z);
      if (d < SNAP && d < bestD) {
        bestD = d;
        best = { x: a.x, z: a.z, rot: turnFrom(a.rot, rot, Math.PI / 2), snapped: true };
      }
      continue;
    }
    const r = turnFrom(a.rot, rot, step);
    const dir = { x: Math.cos(r), z: -Math.sin(r) };
    for (const side of [1, -1]) {
      const cx = a.x + dir.x * def.hx * side;
      const cz = a.z + dir.z * def.hx * side;
      /* The crosshair is near the end it would join from. */
      const near = Math.hypot(a.x - x, a.z - z);
      const d = Math.hypot(cx - x, cz - z);
      if (near > def.hx + SNAP || d > def.hx + 1) continue;
      /* Never back along a wall already there. */
      const me: Rect = { x: cx, z: cz, hx: def.hx, hz: def.hz, rot: r };
      if (
        others.some((o) => {
          const od = CATALOGUE[o.kind];
          return (
            od.wall && clash(def, me, od, { x: o.x, z: o.z, hx: od.hx, hz: od.hz, rot: o.rot })
          );
        })
      )
        continue;
      if (d < bestD) {
        bestD = d;
        best = { x: cx, z: cz, rot: r, snapped: true };
      }
    }
  }
  return best ?? free;
}

/* What keys a placed thing's solids in the world: below zero, clear of the vehicles' ids. */
export const itemKey = (id: number) => -1 - id;
