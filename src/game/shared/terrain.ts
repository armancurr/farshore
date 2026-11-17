import { BASE_TILE, ISLAND_RADIUS, STEP_HEIGHT } from "./constants";
import { FEATURES } from "./features";
import { type Flora, floraFor } from "./flora";
import {
  type BiomeId,
  gridOf,
  type IslandInfo,
  islandHeights,
  type ShapeId,
  WORLD,
} from "./islands";
import { angleTo, clamp, mulberry32, range, type Rng, smoothstep } from "./math";
import type { ModelId } from "./models.gen";
import { BOULDERS, COLUMNS, SPECIES_TREES, type TreeSpecies, WOODLAND } from "./nature";
import { type PathPoint, pathDistance, ROAD_GRADE, ROAD_HALF, RoadNet } from "./paths";
import { type Berth, DECK, makeView, modelExtent, type Place, planPlaces } from "./places";
import {
  type Block,
  type Ladder,
  LIGHTHOUSE,
  type Perch,
  planStructures,
  type Structure,
  toWorld,
} from "./structures";

export { LIGHTHOUSE };

export type PropKind = "rock" | "tree" | "column" | "cairn" | "buoy";

export type Prop = {
  id: number;
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  /* Height of the visible object above y. */
  height: number;
  variant: number;
  /* The pack model drawn for it (trees and rocks), and for a tree, its species. */
  model?: ModelId;
  species?: TreeSpecies;
};

/*
 * Something the body collides with: a vertical cylinder, or an oriented box
 * when `box` is set (r is then its bounding radius). Standable ones can be
 * climbed onto.
 */
export type Solid = {
  /* Bike tires may roll over the rounded shoulders of low natural rocks. */
  surface?: "rounded";
  /* A deck to drive onto, however far below it the ground or the sea floor is (a pier). */
  deck?: boolean;
  x: number;
  z: number;
  r: number;
  bottom: number;
  top: number;
  standable: boolean;
  box?: { hx: number; hz: number; c: number; s: number };
  /* A round hatch: nothing to collide with or stand on inside it. */
  hole?: { x: number; z: number; r: number };
};

export type Spot = { x: number; y: number; z: number };

/* A place on the lighthouse plinth: its centre and the way its front faces. */
export type Site = Spot & { rot: number };

const BUCKET = 12;

/* The lighthouse square on the Harbor: its radius, cobbled and level, every avenue running into it. */
export const PLAZA = 30;

const NO_SOLIDS: Solid[] = [];

export function blockSolid(b: Block): Solid {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const hole = b.hole
    ? {
        x: b.x + b.hole.lx * c + b.hole.lz * s,
        z: b.z - b.hole.lx * s + b.hole.lz * c,
        r: b.hole.r,
      }
    : undefined;
  if (b.shape === "cyl")
    return {
      x: b.x,
      z: b.z,
      r: Math.max(b.hx, b.hz),
      bottom: b.bottom,
      top: b.top,
      standable: b.standable,
      hole,
    };
  return {
    x: b.x,
    z: b.z,
    r: Math.hypot(b.hx, b.hz),
    bottom: b.bottom,
    top: b.top,
    standable: b.standable,
    box: { hx: b.hx, hz: b.hz, c, s },
    hole,
  };
}

/* Is (x, z) inside the solid's hatch? */
export function inHole(s: Solid, x: number, z: number) {
  const h = s.hole;
  return !!h && (x - h.x) ** 2 + (z - h.z) ** 2 < h.r * h.r;
}

/* Is (x, z) over the solid's footprint? */
export function overSolid(s: Solid, x: number, z: number) {
  if (inHole(s, x, z)) return false;
  const dx = x - s.x;
  const dz = z - s.z;
  if (!s.box) return dx * dx + dz * dz <= s.r * s.r;
  const lx = dx * s.box.c - dz * s.box.s;
  const lz = dx * s.box.s + dz * s.box.c;
  return Math.abs(lx) <= s.box.hx && Math.abs(lz) <= s.box.hz;
}

/*
 * What the body, the boats and the builder need to know about the ground.
 * One island (Terrain) answers it, and so does the whole grand map
 * (Archipelago), which hands each question to the island underneath.
 */
export interface Ground {
  readonly ladders: readonly Ladder[];
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number): [number, number, number];
  groundAt(x: number, z: number, feetY: number): { ground: number; onSolid: boolean };
  solidsNear(x: number, z: number): readonly Solid[];
  addSolids(key: number, solids: readonly Solid[]): void;
  removeSolids(key: number): void;
}

/*
 * One island. Everything here is a pure function of its shape and seed, so
 * the server (or the in-browser room) and every client build the same land.
 * It's generated round the origin, then moved to its place on the grand map:
 * after that every position it holds or takes is in world coordinates.
 */
export class Terrain implements Ground {
  readonly seed: number;
  readonly shape: ShapeId;
  readonly heights: Float32Array;
  /* The tile's side, samples a side, and the spacing between them, in metres. */
  readonly size: number;
  readonly grid: number;
  readonly cell: number;
  readonly half: number;
  /* How far out the land reaches, roughly: the shape's radius stretched to this tile. */
  readonly radius: number;
  readonly biome: BiomeId | null;
  /* Where groves, meadows and outcrops are (local coordinates). */
  readonly flora: Flora;
  /* The centre of the island's tile on the grand map. */
  ox = 0;
  oz = 0;
  readonly props: Prop[] = [];
  readonly solids: Solid[] = [];
  readonly structures: Structure[] = [];
  readonly ladders: Ladder[] = [];
  /* The places someone made something of (piers, camps, lookouts), and the roads between them. */
  readonly places: Place[] = [];
  paths: PathPoint[][] = [];
  /* Where boats tie up: down both sides of every pier. */
  readonly berths: Berth[] = [];
  /* Distance to the nearest path, sampled every pathCell metres over the tile (island-local grid). */
  pathField: Float32Array = new Float32Array(1);
  pathRes = 1;
  pathCell = 1;
  /* Walkable high places on the structures. */
  perches: readonly Perch[] = [];
  lighthouse: Spot = { x: 0, y: 0, z: 0 };
  /* Where a new arrival wakes up: a flat, open patch near the middle of the island. */
  home: Spot & { yaw: number } = { x: 0, y: 0, z: 0, yaw: 0 };
  /* The Guild Board on the lantern deck, and the keeper's stall beside the lighthouse door. */
  board: Site = { x: 0, y: 0, z: 0, rot: 0 };
  shop: Site = { x: 0, y: 0, z: 0, rot: 0 };
  peak = 0;
  private taken: { x: number; z: number; r: number }[] = [];
  private buckets: Solid[][] = [];
  private bucketsPerSide: number;
  /* Solids added after generation (placed prefabs), by owner key. */
  private dynamic = new Map<number, { solids: Solid[]; cells: number[] }>();
  /* While the roads are cut: the height samples already under one, which later roads leave be. */
  private paved: Uint8Array | null = null;

  /* The Harbor: the lighthouse at its centre, whatever the features say. */
  readonly harbor: boolean;

  constructor(
    info: Pick<IslandInfo, "seed" | "shape" | "x" | "z" | "size" | "cell" | "lift" | "harbor"> & {
      biome?: BiomeId;
    },
  ) {
    this.seed = info.seed >>> 0;
    this.shape = info.shape;
    this.harbor = !!info.harbor;
    this.biome = info.biome ?? null;
    this.size = info.size;
    this.grid = gridOf(info);
    this.cell = this.size / (this.grid - 1);
    this.half = this.size / 2;
    this.radius = ISLAND_RADIUS * (this.size / BASE_TILE);
    this.bucketsPerSide = Math.ceil(this.size / BUCKET);
    this.flora = floraFor(this.seed, this.harbor ? "harbor" : (this.biome ?? "meadow"), this.size);
    this.heights = islandHeights(info.shape, this.seed, this.grid, info.lift);
    this.raiseLighthouse();
    this.raiseStructures();
    /*
     * A hunting island's pier faces the Harbor; the Harbor has a pier facing
     * each hunting island (the first, due north, is the main quay).
     */
    const piers = this.harbor
      ? WORLD.filter((o) => !o.harbor).map((o) => Math.atan2(o.z - info.z, o.x - info.x))
      : [Math.atan2(-info.z, -info.x)];
    this.layPlaces(piers);
    this.scatterProps();
    this.findHome();
    this.moveTo(info.x, info.z);
    this.indexSolids();
  }

  /* Is (x, z) on this island's tile? */
  contains(x: number, z: number, margin = 0) {
    return (
      Math.abs(x - this.ox) <= this.half + margin && Math.abs(z - this.oz) <= this.half + margin
    );
  }

  /* Carry everything generated round the origin out to (x, z). */
  private moveTo(x: number, z: number) {
    this.ox = x;
    this.oz = z;
    if (!x && !z) return;
    /* Some things are shared between lists (a structure's ladders, say): move each once. */
    const moved = new Set<object>();
    const at = (p: { x: number; z: number }) => {
      if (moved.has(p)) return;
      moved.add(p);
      p.x += x;
      p.z += z;
    };
    for (const p of this.props) at(p);
    for (const s of this.solids) {
      at(s);
      if (s.hole) at(s.hole);
    }
    for (const st of this.structures) {
      at(st);
      for (const b of st.blocks) at(b);
      for (const l of st.ladders) at(l);
      for (const l of st.lamps) at(l);
    }
    /* Ladders are shared with the structures above; perches are their own. */
    for (const p of this.perches) {
      at(p);
      for (const r of p.route) at(r);
    }
    for (const t of this.taken) at(t);
    for (const pl of this.places) {
      at(pl);
      at(pl.door);
      if (pl.quay) at(pl.quay);
      if (pl.deck) at(pl.deck);
      for (const m of pl.models) at(m);
    }
    for (const b of this.berths) at(b);
    for (const line of this.paths) for (const pt of line) at(pt);
    at(this.lighthouse);
    at(this.home);
    at(this.board);
    at(this.shop);
  }

  /* Level a pad for the lighthouse: at the Harbor's very centre, or on another island's summit. */
  private raiseLighthouse() {
    const g = this.grid;
    let best = 0;
    if (this.harbor) best = Math.floor(g / 2) * g + Math.floor(g / 2);
    else
      for (let k = 1; k < this.heights.length; k++)
        if (this.heights[k] > this.heights[best]) best = k;
    const x = this.ox - this.half + (best % g) * this.cell;
    const z = this.oz - this.half + Math.floor(best / g) * this.cell;
    const top = this.heights[best];

    if (FEATURES.lighthouse || this.harbor)
      this.levelPad(x, z, LIGHTHOUSE.plinthRadius - 1, LIGHTHOUSE.plinthRadius + 5, top);

    this.lighthouse = { x, y: top, z };
    /* The lantern deck, built with the other structures. */
    this.peak = top + LIGHTHOUSE.plinthHeight + LIGHTHOUSE.towerHeight;
  }

  /* Blend the ground within `outer` of (x, z) toward height y, flat inside `inner`. */
  levelPad(wx: number, wz: number, inner: number, outer: number, y: number) {
    const x = wx - this.ox;
    const z = wz - this.oz;
    const j0 = Math.max(0, Math.floor((x - outer + this.half) / this.cell));
    const j1 = Math.min(this.grid - 1, Math.ceil((x + outer + this.half) / this.cell));
    const i0 = Math.max(0, Math.floor((z - outer + this.half) / this.cell));
    const i1 = Math.min(this.grid - 1, Math.ceil((z + outer + this.half) / this.cell));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const d = Math.hypot(-this.half + j * this.cell - x, -this.half + i * this.cell - z);
        if (d > outer) continue;
        const k = i * this.grid + j;
        const w = 1 - smoothstep(inner, outer, d);
        this.heights[k] += (y - this.heights[k]) * w;
      }
    }
  }

  /* Windmill, chapel, mast, henge, villages, watchtowers, aqueduct, wrecks, jetties. */
  private raiseStructures() {
    const plan = planStructures(this, this.seed, {
      lighthouse: FEATURES.lighthouse || this.harbor,
      landmarks: FEATURES.landmarks && !this.harbor,
    });
    this.structures.push(...plan.structures);
    this.perches = plan.perches;
    this.taken = plan.footprints;
    const lighthouse = plan.structures.find((st) => st.kind === "lighthouse");
    if (lighthouse) this.furnishPlinth(lighthouse);
    for (const st of plan.structures) {
      for (const b of st.blocks) if (b.solid) this.solids.push(blockSolid(b));
      this.ladders.push(...st.ladders);
    }
  }

  /*
   * The Guild Board stands on the lantern deck at the very top, across from
   * the ladder, facing whoever climbs up. The stall stands on the plinth
   * beside the door, facing out. A site's front (local +z) faces its visitors.
   */
  private furnishPlinth(st: Structure) {
    const base = st.y + LIGHTHOUSE.plinthHeight;
    const site = (a: number): Site => ({
      x: st.x + Math.cos(a) * 5.05,
      y: base,
      z: st.z + Math.sin(a) * 5.05,
      rot: Math.PI / 2 - a,
    });
    const deck = base + LIGHTHOUSE.towerHeight;
    const lad = st.ladders[st.ladders.length - 1];
    const toLadder = lad ? Math.atan2(lad.z - st.z, lad.x - st.x) : st.rot;
    this.board = {
      x: st.x - Math.cos(toLadder) * 1.15,
      y: deck,
      z: st.z - Math.sin(toLadder) * 1.15,
      rot: Math.atan2(Math.cos(toLadder), Math.sin(toLadder)),
    };
    this.shop = site(st.rot - 0.78);
    const B = st.blocks;
    const block = (
      s: Site,
      lx: number,
      lz: number,
      b: Partial<Block> & Pick<Block, "bottom" | "top" | "hx" | "hz">,
    ): Block => {
      const p = toWorld(s.x, s.z, s.rot, lx, lz);
      return {
        shape: "box",
        rot: s.rot,
        tone: "mid",
        solid: true,
        standable: false,
        ...b,
        x: p.x,
        z: p.z,
      };
    };
    /* Only what's switched on is built. */
    if (FEATURES.board) {
      /* Board: two posts, a planked face, notices pinned to it, a little roof. */
      const b = this.board;
      const top = b.y;
      for (const side of [-1, 1])
        B.push(
          block(b, side * 0.85, 0, {
            bottom: top,
            top: top + 2.3,
            hx: 0.06,
            hz: 0.06,
            tone: "dark",
            solid: false,
          }),
        );
      B.push(
        block(b, 0, 0, {
          bottom: top + 0.75,
          top: top + 2.05,
          hx: 0.82,
          hz: 0.05,
          solid: false,
        }),
      );
      B.push(
        block(b, 0, 0.02, {
          bottom: top + 2.3,
          top: top + 2.38,
          hx: 1.05,
          hz: 0.28,
          tone: "dark",
          solid: false,
        }),
      );
      for (const [lx, ly, w, h] of [
        [-0.45, 1.6, 0.17, 0.2],
        [0.05, 1.68, 0.15, 0.22],
        [0.5, 1.55, 0.18, 0.18],
        [-0.2, 1.05, 0.2, 0.17],
        [0.35, 1.08, 0.14, 0.2],
      ])
        B.push(
          block(b, lx, 0.065, {
            bottom: top + ly - h,
            top: top + ly + h,
            hx: w,
            hz: 0.012,
            tone: "light",
            solid: false,
          }),
        );
      st.lamps.push({ x: b.x, y: top + 2.2, z: b.z });
    }
    if (FEATURES.shop) {
      /* Stall: a counter, two posts holding up an awning, a crate beside it. */
      const s = this.shop;
      B.push(
        block(s, 0, 0.05, { bottom: base, top: base + 1.05, hx: 1.0, hz: 0.38, standable: true }),
      );
      B.push(
        block(s, 0, 0.05, {
          bottom: base + 1.05,
          top: base + 1.12,
          hx: 1.08,
          hz: 0.45,
          tone: "dark",
          standable: true,
        }),
      );
      for (const side of [-1, 1])
        B.push(
          block(s, side * 0.95, -0.25, {
            bottom: base,
            top: base + 2.45,
            hx: 0.06,
            hz: 0.06,
            tone: "dark",
          }),
        );
      B.push(
        block(s, 0, 0.1, {
          bottom: base + 2.45,
          top: base + 2.53,
          hx: 1.2,
          hz: 0.75,
          tone: "light",
          solid: false,
        }),
      );
      B.push(
        block(s, 1.45, 0.2, { bottom: base, top: base + 0.6, hx: 0.3, hz: 0.3, standable: true }),
      );
      st.lamps.push({ x: s.x, y: base + 2.3, z: s.z });
    }
  }

  /*
   * The island's places and the roads between them. Places get level ground
   * (a pier a quay at deck height), then the roads are laid one by one, each
   * found across the ground as it then stands and cut straight into it, and
   * only then is everything set down on the ground (so a crate sits on the
   * road's cutting, not on the hill that was there).
   */
  private layPlaces(piers: number[]) {
    const kind = this.harbor ? "harbor" : (this.biome ?? "meadow");
    const lh = this.lighthouse;
    /* What the roads must go round: the lighthouse and anything else built before the places. */
    const built = [...this.taken];
    const places = planPlaces(this, this.seed, kind, this.taken, {
      piers,
      lighthouse: this.harbor ? lh : undefined,
      summit: this.harbor ? undefined : lh,
    });
    for (const pl of places) {
      if (pl.quay) this.levelPad(pl.quay.x, pl.quay.z, pl.quay.r * 0.85, pl.quay.r + 7, DECK);
      else if (pl.kind !== "wreck") this.levelPad(pl.x, pl.z, pl.r * 0.85, pl.r + 7, pl.y);
      if (pl.berths) this.berths.push(...pl.berths);
    }
    this.places.push(...places);

    const net = new RoadNet(this);
    this.paved = new Uint8Array(this.grid * this.grid);
    for (const t of built) net.avoid(t.x, t.z, t.r + 2);
    for (const pl of places) if (pl.kind !== "pier") net.avoid(pl.x, pl.z, pl.r + 1);
    const lay = (line: PathPoint[] | null) => {
      if (!line || line.length < 2) return;
      this.carveRoad(line);
      net.mark(line);
      this.paths.push(line);
    };
    const quays = places.filter((pl) => pl.kind === "pier");
    for (const q of quays)
      if (q.quay) {
        net.markArea(q.quay.x, q.quay.z, q.quay.r);
        this.pave(q.quay.x, q.quay.z, q.quay.r * 0.85);
      }

    if (this.harbor) {
      /* The lighthouse square: the hub every avenue runs into. */
      this.levelPad(lh.x, lh.z, PLAZA, PLAZA + 9, lh.y);
      net.markArea(lh.x, lh.z, PLAZA - 2);
      this.pave(lh.x, lh.z, PLAZA);
      /* An avenue from every pier to the square, each on its own line. */
      const avenues: PathPoint[][] = [];
      for (const q of quays) {
        const a = Math.atan2(q.z - lh.z, q.x - lh.x);
        const end = { x: lh.x + Math.cos(a) * (PLAZA - 3), z: lh.z + Math.sin(a) * (PLAZA - 3) };
        const line = net.route(q.door, end, false);
        lay(line);
        if (line) avenues.push(line);
      }
      /* Two ring roads crossing the avenues: one round the town, one along the waterfront. */
      for (const frac of [0.4, 0.74]) this.ringRoad(net, lay, avenues, frac);
    } else {
      /* The trunk road: from the pier to the very top. */
      const pier = quays[0];
      const summit = places.find((pl) => pl.kind === "summit");
      if (pier && summit) lay(net.route(pier.door, summit.door));
      /* A ring road round the island's middle, so every part of it is a short way from a road. */
      this.ringRoad(net, lay, [], 0.6);
    }
    /* A track from each place to the nearest road. */
    for (const pl of places)
      if (pl.kind !== "pier" && !net.reaches(pl.door)) lay(net.join(pl.door));
    /* Out to the far corners: wherever the land is still a long way from a road, one out to its high ground. */
    for (const view of this.reachOut(net, lay, this.harbor ? 120 : 115)) {
      this.levelPad(view.x, view.z, view.r, view.r + 5, view.y);
      places.push(view);
      this.places.push(view);
    }
    /* And if any piece came out on its own, join it on. */
    for (let k = 0; k < 12; k++) {
      const line = net.stitch();
      if (!line) break;
      lay(line);
    }

    /* The road field: roads are drawn from it, and trees keep off it. */
    this.pathRes = Math.round(this.size / 4);
    this.pathCell = this.size / this.pathRes;
    this.pathField = pathDistance(this.paths, this.half, this.pathRes, 24);

    this.paved = null;
    for (const pl of places) this.seatPlace(pl);
  }

  /* Mark a level square as already paved, so no road cut later disturbs it. */
  private pave(x: number, z: number, r: number) {
    const paved = this.paved;
    if (!paved) return;
    const g = this.grid;
    for (let i = 0; i < g; i++) {
      const pz = -this.half + i * this.cell;
      if (Math.abs(pz - z) > r) continue;
      for (let j = 0; j < g; j++)
        if (Math.hypot(-this.half + j * this.cell - x, pz - z) <= r) paved[i * g + j] = 1;
    }
  }

  /*
   * Spurs out to whatever open ground is still more than `gap` metres from
   * any road, each ending on the high point near there (the view's the
   * reason to go), until nowhere is that far.
   */
  private reachOut(net: RoadNet, lay: (line: PathPoint[] | null) => void, gap: number) {
    const views: Place[] = [];
    const step = 16;
    const spots: { x: number; z: number; y: number }[] = [];
    for (let z = -this.half + step / 2; z < this.half; z += step)
      for (let x = -this.half + step / 2; x < this.half; x += step) {
        const y = this.heightAt(x, z);
        if (y < 3 || this.normalAt(x, z)[1] < 0.86) continue;
        if (this.taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 6)) continue;
        spots.push({ x, z, y });
      }
    for (let round = 0; round < 10; round++) {
      const points = this.paths.flat();
      let best: { x: number; z: number; score: number } | null = null;
      for (const p of spots) {
        let d = Infinity;
        for (const q of points) {
          const e = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
          if (e < d) d = e;
        }
        d = Math.sqrt(d);
        if (d < gap) continue;
        const score = d + p.y * 1.5;
        if (!best || score > best.score) best = { x: p.x, z: p.z, score };
      }
      if (!best) return views;
      /* Up onto the rise nearby, if there is one. */
      let top = { x: best.x, z: best.z, y: this.heightAt(best.x, best.z) };
      for (let a = 0; a < 12; a++)
        for (const r of [12, 24, 36]) {
          const x = best.x + Math.cos(a * 0.524) * r;
          const z = best.z + Math.sin(a * 0.524) * r;
          const y = this.heightAt(x, z);
          if (y > top.y && this.normalAt(x, z)[1] > 0.86) top = { x, z, y };
        }
      const line = net.join(top);
      if (!line) {
        /* Nothing reaches it: don't ask again. */
        const out = spots.filter((p) => Math.hypot(p.x - best.x, p.z - best.z) > gap);
        spots.length = 0;
        spots.push(...out);
        continue;
      }
      lay(line);
      /* A bench at the end, looking on the way the road came. */
      const a = line[1] ?? line[0];
      const b = line[0];
      views.push(
        makeView(b.x, b.z, this.heightAt(b.x, b.z), b.x - a.x, b.z - a.z, this.seed + round * 7919),
      );
    }
    return views;
  }

  /*
   * A ring road round the island's middle, `frac` of the way out to the
   * coast on every bearing. Where an avenue runs out that way, the ring
   * crosses it there; between, it bends through the best ground it finds.
   */
  private ringRoad(
    net: RoadNet,
    lay: (line: PathPoint[] | null) => void,
    avenues: PathPoint[][],
    frac: number,
  ) {
    const c = this.landCentre();
    type Node = { x: number; z: number; a: number };
    const nodes: Node[] = [];
    for (const line of avenues) {
      const far = line[0];
      const a = Math.atan2(far.z - c.z, far.x - c.x);
      const want = frac * this.coastDistance(c, a);
      let best = line[0];
      for (const p of line)
        if (
          Math.abs(Math.hypot(p.x - c.x, p.z - c.z) - want) <
          Math.abs(Math.hypot(best.x - c.x, best.z - c.z) - want)
        )
          best = p;
      nodes.push({ ...best, a });
    }
    /* Fill in between (or all the way round, with no avenues) so no stretch is long. */
    const sorted = () => nodes.sort((p, q) => p.a - q.a);
    const count = avenues.length ? avenues.length * 2 : 10;
    if (!avenues.length)
      for (let k = 0; k < count; k++) {
        const node = this.ringNode(c, (k / count) * Math.PI * 2, frac);
        if (node) nodes.push(node);
      }
    else {
      sorted();
      const n = nodes.length;
      for (let k = 0; k < n; k++) {
        const a0 = nodes[k].a;
        let a1 = nodes[(k + 1) % n].a;
        if (a1 <= a0) a1 += Math.PI * 2;
        const node = this.ringNode(c, (a0 + a1) / 2, frac);
        if (node) nodes.push(node);
      }
    }
    sorted();
    /*
     * Plan every leg, then drop any waypoint the ring only reaches by
     * doubling back on itself (a spur up onto a bench and down again): the
     * legs either side of it are replanned as one.
     */
    const leg = (a: Node, b: Node) =>
      /* Too far round to be a ring (a bay in the way): leave that stretch out. */
      Math.hypot(a.x - b.x, a.z - b.z) > this.radius * 1.2 ? null : net.route(a, b, false);
    const legs = nodes.map((a, k) => leg(a, nodes[(k + 1) % nodes.length]));
    for (let k = 0; k < nodes.length && nodes.length > 3; ) {
      const into = legs[(k - 1 + nodes.length) % nodes.length];
      const out = legs[k];
      if (!into || !out || !hairpin(into, out)) {
        k++;
        continue;
      }
      const prev = (k - 1 + nodes.length) % nodes.length;
      nodes.splice(k, 1);
      legs.splice(k, 1);
      const p = k > prev ? prev : prev - 1;
      legs[p] = leg(nodes[p], nodes[(p + 1) % nodes.length]);
      k = Math.max(0, p);
    }
    for (const line of legs) lay(line);
  }

  /* The middle of the land: where the rings are drawn round. */
  private landCentre() {
    let x = 0;
    let z = 0;
    let n = 0;
    const step = this.size / 64;
    for (let i = 0; i < 64; i++)
      for (let j = 0; j < 64; j++) {
        const px = -this.half + (j + 0.5) * step;
        const pz = -this.half + (i + 0.5) * step;
        if (this.heightAt(px, pz) < 1) continue;
        x += px;
        z += pz;
        n++;
      }
    return n ? { x: x / n, z: z / n } : { x: 0, z: 0 };
  }

  /* How far from c the land runs along bearing a, out to the last of the shore. */
  private coastDistance(c: { x: number; z: number }, a: number) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let d = this.half; d > 0; d -= 4)
      if (this.heightAt(c.x + ca * d, c.z + sa * d) > 0.5) return d;
    return 0;
  }

  /*
   * A ring road's waypoint on bearing a: `frac` of the way out to the coast,
   * shifted to the most level open ground near there (not a camp, not the sea).
   */
  private ringNode(c: { x: number; z: number }, a: number, frac: number) {
    const reach = this.coastDistance(c, a);
    if (reach < 60) return null;
    const d0 = frac * reach;
    let best: { x: number; z: number; a: number; score: number } | null = null;
    for (const dd of [-24, -12, 0, 12, 24])
      for (const da of [-16, 0, 16]) {
        const d = d0 + dd;
        const b = a + da / Math.max(d, 1);
        const x = c.x + Math.cos(b) * d;
        const z = c.z + Math.sin(b) * d;
        const y = this.heightAt(x, z);
        if (y < 2) continue;
        if (this.places.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + ROAD_HALF + 4)) continue;
        const slope = 1 - this.normalAt(x, z)[1];
        const score = -slope * 60 - Math.abs(dd) * 0.04 - Math.abs(da) * 0.04;
        if (!best || score > best.score) best = { x, z, a, score };
      }
    return best;
  }

  /*
   * Cut a road into the ground: its own profile along its length, smoothed,
   * held to an even grade, then levelled flat across its width with a
   * shoulder blending back into the land either side. The ends keep the
   * ground's own height, so a road meets the road (or the quay) it joins.
   */
  private carveRoad(line: PathPoint[]) {
    const g = this.grid;
    const paved = this.paved;
    const raw = line.map((p) => this.heightAt(p.x, p.z));
    const last = raw.length - 1;
    /*
     * Where it runs onto a road already cut (a crossing, a junction, a
     * stretch shared) it takes that road's surface, and its ends keep the
     * ground they start from (a quay, a door); in between it's the ground's
     * own line, smoothed, and held to an even grade either way from each of
     * those, so it eases in and out of every junction.
     */
    const rise = (k: number) =>
      ROAD_GRADE * Math.hypot(line[k + 1].x - line[k].x, line[k + 1].z - line[k].z);
    const pin: (number | null)[] = line.map((p, k) => {
      if (k === 0 || k === last) return raw[k];
      if (!paved) return null;
      /* On it, not merely brushing its edge. */
      const near =
        Math.round((p.z + this.half) / this.cell) * g + Math.round((p.x + this.half) / this.cell);
      if (paved[near] !== 1) return null;
      const j = Math.floor((p.x + this.half) / this.cell);
      const i = Math.floor((p.z + this.half) / this.cell);
      let sum = 0;
      let n = 0;
      for (const [di, dj] of [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ]) {
        const o = (i + di) * g + j + dj;
        if (i + di < g && j + dj < g && i + di >= 0 && j + dj >= 0 && paved[o] === 1) {
          sum += this.heights[o];
          n++;
        }
      }
      return n ? sum / n : null;
    });
    const prof = raw.map((h, k) => {
      const at = pin[k];
      if (at !== null) return at;
      let sum = 0;
      let n = 0;
      for (let j = Math.max(0, k - 6); j <= Math.min(last, k + 6); j++) {
        sum += raw[j];
        n++;
      }
      return Math.max(DECK, sum / n);
    });
    /* Between two fixed heights too far apart to join at that grade, an even ramp: steeper, never a step. */
    for (let k = 0, from = 0; k <= last; k++) {
      if (pin[k] === null) continue;
      if (k > from + 1) {
        let run = 0;
        for (let j = from; j < k; j++) run += rise(j) / ROAD_GRADE;
        const a = pin[from] as number;
        const b = pin[k] as number;
        if (Math.abs(b - a) > ROAD_GRADE * run) {
          let at = 0;
          for (let j = from + 1; j < k; j++) {
            at += rise(j - 1) / ROAD_GRADE;
            pin[j] = a + ((b - a) * at) / run;
          }
        }
      }
      from = k;
    }
    for (let k = 0; k <= last; k++) prof[k] = pin[k] ?? prof[k];
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 1; k <= last; k++) {
        const at = pin[k];
        prof[k] = at ?? clamp(prof[k], prof[k - 1] - rise(k - 1), prof[k - 1] + rise(k - 1));
      }
      for (let k = last - 1; k >= 0; k--) {
        const at = pin[k];
        prof[k] = at ?? clamp(prof[k], prof[k + 1] - rise(k), prof[k + 1] + rise(k));
      }
    }

    /* Flat across its whole width, however coarse the island's height samples. */
    const flat = ROAD_HALF + 0.75 + this.cell * 0.35;
    const reach = flat + 7;
    const best = new Map<number, { d: number; y: number }>();
    for (let k = 0; k < last; k++) {
      const a = line[k];
      const b = line[k + 1];
      const j0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach + this.half) / this.cell));
      const j1 = Math.min(g - 1, Math.ceil((Math.max(a.x, b.x) + reach + this.half) / this.cell));
      const i0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach + this.half) / this.cell));
      const i1 = Math.min(g - 1, Math.ceil((Math.max(a.z, b.z) + reach + this.half) / this.cell));
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      for (let i = i0; i <= i1; i++) {
        const pz = -this.half + i * this.cell;
        for (let j = j0; j <= j1; j++) {
          const px = -this.half + j * this.cell;
          const t = clamp(((px - a.x) * dx + (pz - a.z) * dz) / len2, 0, 1);
          const d = Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
          if (d > reach) continue;
          const o = i * g + j;
          const had = best.get(o);
          if (!had || d < had.d) best.set(o, { d, y: prof[k] + (prof[k + 1] - prof[k]) * t });
        }
      }
    }
    for (const [o, { d, y }] of best) {
      if (this.heights[o] < 0.2 || paved?.[o] === 1) continue;
      const w = 1 - smoothstep(flat, reach, d);
      this.heights[o] += (y - this.heights[o]) * w;
    }
    if (paved) for (const [o, { d }] of best) if (d <= flat) paved[o] = 1;
  }

  /* Set a place's models on the ground (or the water) and give the solid ones collision. */
  private seatPlace(pl: Place) {
    if (pl.deck) {
      /* One deck to walk and drive on, the planks drawn over it. */
      const d = pl.deck;
      this.solids.push({
        x: d.x,
        z: d.z,
        r: Math.hypot(d.hx, d.hz),
        bottom: DECK - 3,
        top: DECK,
        standable: true,
        deck: true,
        box: { hx: d.hx, hz: d.hz, c: Math.cos(d.rot), s: Math.sin(d.rot) },
      });
    }
    for (const m of pl.models) {
      const e = modelExtent(m.model, m.scale);
      if (m.float) {
        /* The pier's planking stands on piles in the sea; boats ride at their waterline beside it. */
        m.y = m.model.includes("boat") ? -0.28 : DECK - e.top;
      } else if (m.model === "ships/ship-wreck") {
        m.y = this.heightAt(m.x, m.z) - 1.4;
      } else {
        m.y = this.heightAt(m.x, m.z) - 0.04;
      }
      if (!m.solid) continue;
      const c = Math.cos(m.rot);
      const s = Math.sin(m.rot);
      /* The model's footprint may sit off its pivot; find its middle in the world. */
      const x = m.x + e.cx * c + e.cz * s;
      const z = m.z - e.cx * s + e.cz * c;
      const hx = Math.max(0.15, e.hx * 0.92);
      const hz = Math.max(0.15, e.hz * 0.92);
      this.solids.push({
        x,
        z,
        r: Math.hypot(hx, hz),
        bottom: m.y - 2,
        top: m.y + e.top * (m.stand ? 1 : 1.05),
        standable: m.stand,
        box: { hx, hz, c, s },
      });
    }
  }

  /* A tree of a species at a size (1 = full grown): its model, its trunk's collision. */
  private addTree(
    id: number,
    rng: Rng,
    x: number,
    y: number,
    z: number,
    sp: TreeSpecies,
    age: number,
    grid: Map<number, { x: number; z: number; r: number }[]>,
    cellOf: (x: number, z: number) => number,
  ) {
    const def = SPECIES_TREES[sp];
    /* Younger trees use the pack's smaller models; each model is then sized to its age. */
    const n = def.models.length;
    const model =
      def.models[
        Math.min(n - 1, Math.floor(clamp((age - 0.45) / 0.7, 0, 0.999) * n + rng() * 0.8))
      ];
    const height = def.height * age * range(rng, 0.9, 1.1);
    this.props.push({
      id,
      kind: "tree",
      x,
      y: y - 0.15,
      z,
      rot: rng() * Math.PI * 2,
      scale: age,
      height,
      variant: Math.floor(rng() * 1e6),
      model,
      species: sp,
    });
    this.solids.push({
      x,
      z,
      r: def.trunk * Math.max(0.6, age),
      bottom: y - 1,
      top: y + height,
      standable: false,
    });
    const key = cellOf(x, z);
    const spot = { x, z, r: def.spacing * 0.5 * Math.max(0.7, age) };
    const list = grid.get(key);
    if (list) list.push(spot);
    else grid.set(key, [spot]);
  }

  /* A rock of a model at a scale, its collision a rounded cylinder you can climb onto. */
  private addRock(
    id: number,
    rng: Rng,
    x: number,
    y: number,
    z: number,
    model: ModelId,
    scale: number,
  ) {
    const e = modelExtent(model, scale);
    const sink = Math.max(0, -e.bottom) + scale * 0.06;
    const height = e.top;
    this.props.push({
      id,
      kind: "rock",
      x,
      y: y - sink,
      z,
      rot: rng() * Math.PI * 2,
      scale,
      height,
      variant: 0,
      model,
    });
    /*
     * Collision for what shows above the ground, not the whole model: a
     * boulder sunk past its middle shows only a low cap, narrower than the
     * stone (taken as an ellipsoid). Wholly buried, there's nothing to hit.
     */
    const exposed = height - sink;
    if (exposed <= 0.02) return;
    const middle = (e.top + e.bottom) / 2;
    const reach = (e.top - e.bottom) / 2;
    const cut = reach > 0 ? Math.max(0, (sink - middle) / reach) : 0;
    const r = Math.max(e.hx, e.hz) * 0.85 * Math.sqrt(Math.max(0, 1 - cut * cut));
    this.solids.push({
      x,
      z,
      r: Math.max(0.2, r),
      bottom: y - sink,
      top: y + exposed * 0.9,
      standable: true,
      surface: "rounded",
    });
  }

  /* How much (x, z) is at the foot of a cliff: level ground with steep ground just beside it. */
  cliffFoot(x: number, z: number) {
    if (this.normalAt(x, z)[1] < 0.85) return 0;
    let steep = 0;
    for (let a = 0; a < 6; a++) {
      const n = this.normalAt(x + Math.cos(a * 1.047) * 5, z + Math.sin(a * 1.047) * 5)[1];
      steep = Math.max(steep, smoothstep(0.75, 0.5, n));
    }
    return steep;
  }

  /* How far (x, z) is from the nearest path, in metres (24 or more: nowhere near one). */
  pathAt(x: number, z: number) {
    const j = Math.floor((x - this.ox + this.half) / this.pathCell);
    const i = Math.floor((z - this.oz + this.half) / this.pathCell);
    if (i < 0 || j < 0 || i >= this.pathRes || j >= this.pathRes) return 24;
    return this.pathField[i * this.pathRes + j];
  }

  private scatterProps() {
    const rng = mulberry32(this.seed ^ 0x51ed270b);
    let id = 0;
    const taken = this.taken;
    const free = (x: number, z: number, r: number) =>
      taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);

    /* Bigger islands get proportionally more of everything. */
    const area = (this.size / BASE_TILE) ** 2;
    const scatter = (
      wanted: number,
      opts: { minH: number; maxH?: number; spacing: number; minNy: number },
      make: (x: number, y: number, z: number) => void,
    ) => {
      const count = Math.round(wanted * area);
      let placed = 0;
      for (let attempt = 0; attempt < count * 40 && placed < count; attempt++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * this.radius * 1.05;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        const y = this.heightAt(x, z);
        if (y < opts.minH || y > (opts.maxH ?? 999)) continue;
        if (this.normalAt(x, z)[1] < opts.minNy) continue;
        if (!free(x, z, opts.spacing)) continue;
        taken.push({ x, z, r: opts.spacing });
        make(x, y, z);
        placed++;
      }
    };

    /*
     * Every kind is scattered (so everything always lands in the same places),
     * but a kind that's switched off is taken straight back out again.
     */
    const keepIf = (on: boolean, place: () => void) => {
      const props = this.props.length;
      const solids = this.solids.length;
      const held = taken.length;
      place();
      if (on) return;
      this.props.length = props;
      this.solids.length = solids;
      /* Nor does it keep anything else from growing where it would have stood. */
      taken.length = held;
    };

    /* Ruins: broken columns climbing in a ring, a parkour stair to a high perch. */
    keepIf(FEATURES.ruins, () =>
      scatter(8, { minH: 5, spacing: 11, minNy: 0.8 }, (cx, cy, cz) => {
        const n = 5 + Math.floor(rng() * 3);
        const start = rng() * Math.PI * 2;
        const turn = range(rng, 0.65, 0.85) * (rng() < 0.5 ? -1 : 1);
        const radius = range(rng, 4.2, 5.6);
        let top = cy;
        for (let c = 0; c < n; c++) {
          const a = start + c * turn;
          const x = cx + Math.cos(a) * radius;
          const z = cz + Math.sin(a) * radius;
          const ground = this.heightAt(x, z);
          top = Math.max(top + range(rng, 0.95, 1.2), ground + 1.1);
          const scale = range(rng, 0.62, 0.74);
          this.props.push({
            id: id++,
            kind: "column",
            x,
            y: ground - 0.4,
            z,
            rot: rng() * Math.PI,
            scale,
            height: top - ground + 0.4,
            variant: c === n - 1 && rng() < 0.6 ? 1 : 0,
          });
          this.solids.push({ x, z, r: scale, bottom: ground - 1, top, standable: true });
        }
      }),
    );

    /* Stacked stones left by whoever was here before. */
    keepIf(FEATURES.cairns, () =>
      scatter(30, { minH: 1.5, spacing: 18, minNy: 0.75 }, (x, y, z) => {
        this.props.push({
          id: id++,
          kind: "cairn",
          x,
          y,
          z,
          rot: rng() * Math.PI * 2,
          scale: 1,
          height: 1.1,
          variant: Math.floor(rng() * 3),
        });
      }),
    );

    /*
     * Trees and boulders follow the island's fields: thick in the groves and
     * on the outcrops, a stray one here and there between. `per` is how many
     * per 1000 m² at a spot; a quick grid keeps them their spacing apart.
     */
    const flora = this.flora;
    const CELL = 6;
    const grid = new Map<number, { x: number; z: number; r: number }[]>();
    const cellOf = (x: number, z: number) =>
      Math.floor(x / CELL + 2048) * 4096 + Math.floor(z / CELL + 2048);
    const clear = (x: number, z: number, r: number) => {
      const cx = Math.floor(x / CELL + 2048);
      const cz = Math.floor(z / CELL + 2048);
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const o of grid.get((cx + i) * 4096 + cz + j) ?? [])
            if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
      return true;
    };
    const reach = this.radius * 1.1;
    const grow = (
      per: (x: number, z: number) => number,
      most: number,
      opts: { minH: number; spacing: number; minNy: number },
      make: (x: number, y: number, z: number, here: number) => void,
    ) => {
      const tries = Math.round(((Math.PI * reach * reach) / 1000) * most * 1.25);
      for (let t = 0; t < tries; t++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * reach;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        const here = per(x, z);
        if (rng() * most > here) continue;
        const y = this.heightAt(x, z);
        if (y < opts.minH || this.normalAt(x, z)[1] < opts.minNy) continue;
        if (!free(x, z, opts.spacing) || !clear(x, z, opts.spacing)) continue;
        const key = cellOf(x, z);
        const list = grid.get(key);
        const spot = { x, z, r: opts.spacing };
        if (list) list.push(spot);
        else grid.set(key, [spot]);
        make(x, y, z, here / most);
      }
    };

    const f = flora.def;
    const kind = this.harbor ? "harbor" : (this.biome ?? "meadow");
    /* Nothing grows on a path, on a cliff, or down on the beach. */
    const growable = (x: number, z: number, y: number, clearPath: number) =>
      y > 2.3 && this.normalAt(x, z)[1] > 0.84 && this.pathAt(x, z) > clearPath;

    keepIf(FEATURES.rocks, () => {
      /* Boulders lie about the stony ground, and gather at the feet of the cliffs. */
      grow(
        (x, z) => f.strays + (f.rocks - f.strays) * flora.stone(x, z) + 6 * this.cliffFoot(x, z),
        f.rocks + 6,
        { minH: 0.4, spacing: 2.6, minNy: 0.55 },
        (x, y, z, k) => {
          if (this.pathAt(x, z) < ROAD_HALF + 2) return;
          const big = rng() < 0.1 + 0.25 * k;
          const scale = big ? range(rng, 2.2, 3.6) : range(rng, 0.7, 1.8);
          this.addRock(id++, rng, x, y, z, BOULDERS[Math.floor(rng() * BOULDERS.length)], scale);
        },
      );
      /* Stacked stone columns stand on the high benches of the rugged islands. */
      const columns = kind === "ridge" || kind === "fells" ? 26 : kind === "pinewood" ? 10 : 4;
      scatter(columns, { minH: 8, spacing: 22, minNy: 0.86 }, (x, y, z) => {
        if (this.pathAt(x, z) < ROAD_HALF + 4) return;
        const model = COLUMNS[Math.floor(rng() * COLUMNS.length)];
        this.addRock(id++, rng, x, y, z, model, range(rng, 1.1, 1.8));
      });
    });

    keepIf(FEATURES.trees, () => {
      const wood = WOODLAND[kind];
      const total = wood.groves.reduce((a, [, w]) => a + w, 0);
      const pick = () => {
        let r = rng() * total;
        for (const [sp, w] of wood.groves) if ((r -= w) <= 0) return sp;
        return wood.groves[0][0];
      };
      /*
       * Groves: each a stand of one species, biggest in the middle and
       * thinning to saplings at the edge, so a wood reads as a wood.
       */
      const reachR = this.radius * 1.05;
      const groves = Math.round(
        ((Math.PI * reachR * reachR) / 1e6) * 40 * f.forest * (f.dense / 12),
      );
      for (let gi = 0, tries = 0; gi < groves && tries < groves * 30; tries++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * reachR;
        const cx = Math.cos(a) * d;
        const cz = Math.sin(a) * d;
        if (flora.forest(cx, cz) < 0.45) continue;
        if (!growable(cx, cz, this.heightAt(cx, cz), ROAD_HALF + 7)) continue;
        gi++;
        const sp = pick();
        const def = SPECIES_TREES[sp];
        const radius = range(rng, 18, 46);
        const want = Math.round(((Math.PI * radius * radius) / (def.spacing * def.spacing)) * 0.5);
        for (let t = 0; t < want * 3; t++) {
          const u = Math.sqrt(rng());
          const b = rng() * Math.PI * 2;
          /* Ragged edges: the grove's outline wobbles. */
          const edge = radius * (0.75 + 0.25 * Math.sin(b * 3 + gi) * Math.cos(b * 2 - gi));
          const x = cx + Math.cos(b) * u * edge;
          const z = cz + Math.sin(b) * u * edge;
          const y = this.heightAt(x, z);
          if (!growable(x, z, y, ROAD_HALF + 2.3 + def.spacing * 0.3)) continue;
          if (!free(x, z, 1.2) || !clear(x, z, def.spacing * 0.5)) continue;
          /* Big in the heart of the grove, young at its rim. */
          const age = 1 - u * u * 0.6 + range(rng, -0.12, 0.12);
          this.addTree(id++, rng, x, y, z, sp, clamp(age, 0.45, 1.15), grid, cellOf);
        }
      }
      /* Landmark trees: a few big ones alone in the open, the kind you steer by. */
      scatter(kind === "harbor" ? 10 : 7, { minH: 3, spacing: 40, minNy: 0.88 }, (x, y, z) => {
        if (flora.forest(x, z) > 0.3 || this.pathAt(x, z) < ROAD_HALF + 5) return;
        this.addTree(id++, rng, x, y, z, wood.lone, range(rng, 1.25, 1.5), grid, cellOf);
      });
      /* Strays: the odd tree between groves, so the open ground isn't bald. */
      grow(
        (x, z) => f.sparse * (0.4 + flora.forest(x, z)),
        f.sparse * 1.4,
        { minH: 2.4, spacing: 6, minNy: 0.86 },
        (x, y, z) => {
          if (this.pathAt(x, z) < ROAD_HALF + 3) return;
          this.addTree(id++, rng, x, y, z, pick(), range(rng, 0.55, 0.9), grid, cellOf);
        },
      );
      /* Palms lean over the Harbor's beaches in twos and threes. */
      if (this.harbor) {
        for (let c = 0, tries = 0; c < 26 && tries < 3000; tries++) {
          const a = rng() * Math.PI * 2;
          let d = this.half * 0.9;
          while (d > 20 && this.heightAt(Math.cos(a) * d, Math.sin(a) * d) < 0.9) d -= 2;
          const bx = Math.cos(a) * (d - range(rng, 4, 14));
          const bz = Math.sin(a) * (d - range(rng, 4, 14));
          const by = this.heightAt(bx, bz);
          if (by < 0.9 || by > 3.2 || !free(bx, bz, 3) || this.pathAt(bx, bz) < ROAD_HALF + 3)
            continue;
          c++;
          const n = 2 + Math.floor(rng() * 2);
          for (let k = 0; k < n; k++) {
            const x = bx + range(rng, -3.5, 3.5);
            const z = bz + range(rng, -3.5, 3.5);
            const y = this.heightAt(x, z);
            if (y < 0.7 || !clear(x, z, 1.4)) continue;
            const model: ModelId = rng() < 0.6 ? "coast/palm-bend" : "coast/palm-straight";
            const scale = range(rng, 1.25, 1.7);
            /* Bent palms lean out toward the sea. */
            const rot =
              model === "coast/palm-bend"
                ? Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI / 2 + range(rng, -0.5, 0.5)
                : rng() * 6.28;
            this.props.push({
              id: id++,
              kind: "tree",
              x,
              y: y - 0.1,
              z,
              rot,
              scale,
              height: 4.2 * scale,
              variant: 0,
              model,
            });
            this.solids.push({
              x,
              z,
              r: 0.3 * scale,
              bottom: y - 1,
              top: y + 4 * scale,
              standable: false,
            });
            const key = cellOf(x, z);
            const spot = { x, z, r: 1.4 };
            const list = grid.get(key);
            if (list) list.push(spot);
            else grid.set(key, [spot]);
          }
        }
      }
    });

    keepIf(FEATURES.buoys, () => {
      for (let b = 0, attempt = 0; b < 20 && attempt < 600; attempt++) {
        const a = rng() * Math.PI * 2;
        const d = range(rng, this.radius * 0.95, this.radius * 1.15);
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (this.heightAt(x, z) > -3) continue;
        this.props.push({
          id: id++,
          kind: "buoy",
          x,
          y: 0,
          z,
          rot: rng() * 6.28,
          scale: 1,
          height: 3,
          variant: b,
        });
        b++;
      }
    });
  }

  /* Bucket every solid by the cells its footprint (plus a body) overlaps. */
  private indexSolids() {
    const n = this.bucketsPerSide;
    this.buckets = Array.from({ length: n * n }, () => []);
    for (const s of this.solids) {
      const pad = s.r + 1;
      const j0 = this.bucketX(s.x - pad);
      const j1 = this.bucketX(s.x + pad);
      const i0 = this.bucketZ(s.z - pad);
      const i1 = this.bucketZ(s.z + pad);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.buckets[i * n + j].push(s);
    }
  }

  private bucketX(x: number) {
    return clamp(Math.floor((x - this.ox + this.half) / BUCKET), 0, this.bucketsPerSide - 1);
  }

  private bucketZ(z: number) {
    return clamp(Math.floor((z - this.oz + this.half) / BUCKET), 0, this.bucketsPerSide - 1);
  }

  /* The solids a body standing at (x, z) could touch, placed prefabs included. */
  solidsNear(x: number, z: number): readonly Solid[] {
    if (!this.buckets.length) return this.solids;
    return this.buckets[this.bucketZ(z) * this.bucketsPerSide + this.bucketX(x)] ?? NO_SOLIDS;
  }

  /* Add collision for something built after generation; `key` removes it again. */
  addSolids(key: number, solids: readonly Solid[]) {
    this.removeSolids(key);
    const n = this.bucketsPerSide;
    const cells: number[] = [];
    for (const s of solids) {
      const pad = s.r + 1;
      const j0 = this.bucketX(s.x - pad);
      const j1 = this.bucketX(s.x + pad);
      const i0 = this.bucketZ(s.z - pad);
      const i1 = this.bucketZ(s.z + pad);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          this.buckets[i * n + j].push(s);
          cells.push(i * n + j);
        }
      }
    }
    this.dynamic.set(key, { solids: [...solids], cells });
  }

  removeSolids(key: number) {
    const entry = this.dynamic.get(key);
    if (!entry) return;
    const gone = new Set(entry.solids);
    for (const c of new Set(entry.cells)) {
      this.buckets[c] = this.buckets[c].filter((s) => !gone.has(s));
    }
    this.dynamic.delete(key);
  }

  /*
   * Walk outward from the middle of the island in rings and take the first
   * patch that is dry, level, and clear of buildings, rocks and trees.
   */
  private findHome() {
    const lh = this.lighthouse;
    const open = (x: number, z: number, r: number) =>
      this.taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);
    const level = (x: number, z: number, r: number) => {
      let lo = this.heightAt(x, z);
      let hi = lo;
      for (let a = 0; a < 8; a++) {
        for (const k of [0.5, 1]) {
          const h = this.heightAt(x + Math.cos(a * 0.785) * r * k, z + Math.sin(a * 0.785) * r * k);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
      return { lo, hi };
    };
    let best: { x: number; z: number } | null = null;
    for (let d = 0; d < this.radius * 0.8 && !best; d += 5) {
      const steps = Math.max(1, Math.round((d * Math.PI * 2) / 5));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (Math.hypot(x - lh.x, z - lh.z) < 22) continue;
        const { lo, hi } = level(x, z, 7);
        if (lo < 2.5 || hi > 34 || hi - lo > 1.8) continue;
        if (!open(x, z, 3) || !this.clearOfSolids(x, z, 5)) continue;
        best = { x, z };
        break;
      }
    }
    best ??= { x: lh.x + 16, z: lh.z };
    this.home = {
      ...best,
      y: this.heightAt(best.x, best.z),
      yaw: angleTo(lh.x - best.x, lh.z - best.z),
    };
  }

  clearOfSolids(x: number, z: number, margin = 1) {
    return this.solids.every((s) => Math.hypot(s.x - x, s.z - z) > s.r + margin);
  }

  heightAt(x: number, z: number) {
    const g = this.grid;
    const gx = clamp((x - this.ox + this.half) / this.cell, 0, g - 1.001);
    const gz = clamp((z - this.oz + this.half) / this.cell, 0, g - 1.001);
    const j = Math.floor(gx);
    const i = Math.floor(gz);
    const fx = gx - j;
    const fz = gz - i;
    const k = i * g + j;
    const h00 = this.heights[k];
    const h10 = this.heights[k + 1];
    const h01 = this.heights[k + g];
    const h11 = this.heights[k + g + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  normalAt(x: number, z: number): [number, number, number] {
    const e = this.cell;
    const dx = this.heightAt(x - e, z) - this.heightAt(x + e, z);
    const dz = this.heightAt(x, z - e) - this.heightAt(x, z + e);
    const len = Math.hypot(dx, 2 * e, dz);
    return [dx / len, (2 * e) / len, dz / len];
  }

  /* Highest surface under (x, z) that a body with feet at feetY could stand on. */
  groundAt(x: number, z: number, feetY: number) {
    let ground = this.heightAt(x, z);
    let onSolid = false;
    for (const s of this.solidsNear(x, z)) {
      if (s.standable && s.top > ground && s.top <= feetY + STEP_HEIGHT && overSolid(s, x, z)) {
        ground = s.top;
        onSolid = true;
      }
    }
    return { ground, onSolid };
  }
}

/* Does a road arriving along `into` have to turn right back to leave along `out`? */
function hairpin(into: PathPoint[], out: PathPoint[]) {
  const a = into[Math.max(0, into.length - 7)];
  const b = into[into.length - 1];
  const c = out[Math.min(out.length - 1, 6)];
  const ux = b.x - a.x;
  const uz = b.z - a.z;
  const vx = c.x - b.x;
  const vz = c.z - b.z;
  const cos = (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) || 1);
  return cos < -0.35;
}
