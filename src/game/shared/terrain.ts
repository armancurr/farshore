import { BASE_TILE, ISLAND_RADIUS, STEP_HEIGHT } from "./constants";
import { FEATURES } from "./features";
import { type Flora, type FloraKind, floraFor } from "./flora";
import { type BiomeId, gridOf, type IslandInfo, islandHeights, type ShapeId } from "./islands";
import { angleTo, clamp, mulberry32, range, type Rng, smoothstep } from "./math";
import type { ModelId } from "./models.gen";
import { BOULDERS, COLUMNS, SPECIES_TREES, type TreeSpecies, WOODLAND } from "./nature";
import { type PathPoint, pathDistance, planPaths } from "./paths";
import { modelExtent, type Place, planPlaces } from "./places";
import {
  type Block,
  hearthStructure,
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
  /* The places someone made something of (camps, lookouts, jetties), and the paths between them. */
  readonly places: Place[] = [];
  paths: PathPoint[][] = [];
  /* Distance to the nearest path, sampled every pathCell metres over the tile (island-local grid). */
  pathField: Float32Array = new Float32Array(1);
  pathRes = 1;
  pathCell = 1;
  /* Walkable high places on the structures. */
  perches: readonly Perch[] = [];
  lighthouse: Spot = { x: 0, y: 0, z: 0 };
  /* Where a new arrival wakes up: a flat, open patch near the middle of the island. */
  home: Spot & { yaw: number } = { x: 0, y: 0, z: 0, yaw: 0 };
  /* The Guild Board on the lantern deck. */
  board: Site = { x: 0, y: 0, z: 0, rot: 0 };
  peak = 0;
  private taken: { x: number; z: number; r: number }[] = [];
  private buckets: Solid[][] = [];
  private bucketsPerSide: number;
  /* Solids added after generation (vehicles), by owner key. */
  private dynamic = new Map<number, { solids: Solid[]; cells: number[] }>();

  /* The Harbor: the lighthouse at its centre, whatever the features say. */
  readonly harbor: boolean;
  /* Someone's plot: bare land with the Hearth at its middle, and nothing else built. */
  readonly plot: boolean;
  /* The Hearth's fire, on a plot. */
  hearth: Spot | null = null;

  constructor(
    info: Pick<
      IslandInfo,
      "seed" | "shape" | "x" | "z" | "size" | "cell" | "lift" | "harbor" | "plot"
    > & {
      biome?: BiomeId;
    },
  ) {
    this.seed = info.seed >>> 0;
    this.shape = info.shape;
    this.harbor = !!info.harbor;
    this.plot = !!info.plot;
    this.biome = info.biome ?? null;
    this.size = info.size;
    this.grid = gridOf(info);
    this.cell = this.size / (this.grid - 1);
    this.half = this.size / 2;
    this.radius = ISLAND_RADIUS * (this.size / BASE_TILE);
    this.bucketsPerSide = Math.ceil(this.size / BUCKET);
    this.flora = floraFor(this.seed, this.kind, this.size);
    this.heights = islandHeights(info.shape, this.seed, this.grid, info.lift, this.size);
    this.raiseLighthouse();
    if (!this.plot) this.raiseStructures();
    /* Where the Harbor is from here: the landing faces it. The Harbor's main quay faces north. */
    const toward = this.harbor ? -Math.PI / 2 : Math.atan2(-info.z, -info.x);
    this.layPlaces(toward);
    if (this.plot) this.raiseHearth();
    this.scatterProps();
    this.findHome();
    this.moveTo(info.x, info.z);
    this.indexSolids();
  }

  /* What sort of island this is, for what grows and what's built on it. */
  get kind(): FloraKind {
    return this.harbor ? "harbor" : this.plot ? "plot" : (this.biome ?? "meadow");
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
      for (const m of pl.models) at(m);
    }
    for (const line of this.paths) for (const pt of line) at(pt);
    at(this.lighthouse);
    at(this.home);
    at(this.board);
    if (this.hearth) at(this.hearth);
  }

  /* Level a pad for the lighthouse: at the Harbor's very centre, or on another island's summit. */
  private raiseLighthouse() {
    const g = this.grid;
    let best = 0;
    /* The Harbor's is at its centre; a plot keeps its centre for the Hearth. */
    if (this.harbor || this.plot) best = Math.floor(g / 2) * g + Math.floor(g / 2);
    else
      for (let k = 1; k < this.heights.length; k++)
        if (this.heights[k] > this.heights[best]) best = k;
    const x = this.ox - this.half + (best % g) * this.cell;
    const z = this.oz - this.half + Math.floor(best / g) * this.cell;
    const top = this.heights[best];

    if ((FEATURES.lighthouse && !this.plot) || this.harbor)
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
   * the ladder, facing whoever climbs up. A site's front (local +z) faces
   * its visitors.
   */
  private furnishPlinth(st: Structure) {
    const base = st.y + LIGHTHOUSE.plinthHeight;
    const deck = base + LIGHTHOUSE.towerHeight;
    const lad = st.ladders[st.ladders.length - 1];
    const toLadder = lad ? Math.atan2(lad.z - st.z, lad.x - st.x) : st.rot;
    this.board = {
      x: st.x - Math.cos(toLadder) * 1.15,
      y: deck,
      z: st.z - Math.sin(toLadder) * 1.15,
      rot: Math.atan2(Math.cos(toLadder), Math.sin(toLadder)),
    };
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
  }

  /*
   * The island's places and the paths between them. Places get level ground,
   * the paths are found across the ground as it then stands and cut into it
   * with an even grade, and only then is everything set down on the ground
   * (so a crate sits on the path's cutting, not on the hill that was there).
   */
  private layPlaces(toward: number) {
    const kind = this.kind;
    const places = planPlaces(this, this.seed, kind, this.taken, {
      toward,
      lighthouse: this.harbor ? this.lighthouse : undefined,
    });
    for (const pl of places) {
      if (pl.kind === "landing" || pl.kind === "dock" || pl.kind === "wreck") continue;
      this.levelPad(pl.x, pl.z, pl.r * 0.85, pl.r + 7, pl.y);
    }
    this.places.push(...places);

    const doors = places.map((pl) => pl.door);
    if (this.harbor) {
      /* Every path on the Harbor leads back to the lighthouse door. */
      const lh = this.lighthouse;
      doors.unshift({ x: lh.x, z: lh.z + 16 });
    }
    this.paths = planPaths(this, doors);
    this.carvePaths();

    /* The path field: trails are drawn from it, and trees keep off it. */
    this.pathRes = Math.round(this.size / 4);
    this.pathCell = this.size / this.pathRes;
    this.pathField = pathDistance(this.paths, this.half, this.pathRes, 24);

    for (const pl of places) this.seatPlace(pl);
  }

  /* Cut each path into the ground: its own profile, smoothed and held to an easy grade. */
  private carvePaths() {
    const MAX_GRADE = 0.42; // metres per 2 m sample, about 12°
    const g = this.grid;
    const best = new Float32Array(g * g).fill(99);
    const target = new Float32Array(g * g);
    for (const line of this.paths) {
      const raw = line.map((p) => this.heightAt(p.x, p.z));
      /* Smooth it along its length, then clamp the grade both ways. */
      const prof = raw.map((_, k) => {
        let sum = 0;
        let n = 0;
        for (let j = Math.max(0, k - 5); j <= Math.min(raw.length - 1, k + 5); j++) {
          sum += raw[j];
          n++;
        }
        return Math.max(0.7, sum / n);
      });
      for (let k = 1; k < prof.length; k++)
        prof[k] = clamp(prof[k], prof[k - 1] - MAX_GRADE, prof[k - 1] + MAX_GRADE);
      for (let k = prof.length - 2; k >= 0; k--)
        prof[k] = clamp(prof[k], prof[k + 1] - MAX_GRADE, prof[k + 1] + MAX_GRADE);
      const reach = 6;
      for (let k = 0; k < line.length - 1; k++) {
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
            const o = i * g + j;
            if (d < best[o]) {
              best[o] = d;
              target[o] = prof[k] + (prof[k + 1] - prof[k]) * t;
            }
          }
        }
      }
    }
    for (let o = 0; o < g * g; o++) {
      if (best[o] > 6 || this.heights[o] < 0.2) continue;
      const w = 1 - smoothstep(1.6, 6, best[o]);
      this.heights[o] += (target[o] - this.heights[o]) * w;
    }
  }

  /* Set a place's models on the ground (or the water) and give the solid ones collision. */
  private seatPlace(pl: Place) {
    for (const m of pl.models) {
      const e = modelExtent(m.model, m.scale);
      if (m.float) {
        /* Jetties stand on piles in the sea, their deck a step up from the beach. */
        m.y = m.model.includes("boat") ? -0.28 : 0.95 - e.top;
      } else if (m.model === "ships/ship-wreck") {
        m.y = this.heightAt(m.x, m.z) - 1.4;
      } else if (m.lift !== undefined) {
        m.y = pl.y + m.lift;
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

  /*
   * A plot's Hearth: the stone plinth over the middle of the levelled place,
   * solid and climbable, with the fire on top (the place's models).
   */
  private raiseHearth() {
    const pl = this.places.find((p) => p.kind === "hearth");
    if (!pl) return;
    const st = hearthStructure(pl.x, pl.y, pl.z, pl.rot);
    this.structures.push(st);
    for (const b of st.blocks) if (b.solid) this.solids.push(blockSolid(b));
    this.hearth = { x: pl.x, y: pl.y + st.h, z: pl.z };
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
    this.solids.push({
      x,
      z,
      r: Math.max(e.hx, e.hz) * 0.85,
      bottom: y - sink,
      top: y - sink + height * 0.9,
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

    /* A plot is left bare for building: only a few stones washed up on its beach. */
    if (this.plot) {
      if (!FEATURES.rocks) return;
      const want = Math.round(this.size / 120);
      for (let placed = 0, t = 0; placed < want && t < 400; t++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * this.half;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        const y = this.heightAt(x, z);
        if (y < 0.3 || y > 1.4 || !free(x, z, 6)) continue;
        taken.push({ x, z, r: 6 });
        const model = BOULDERS[Math.floor(rng() * BOULDERS.length)];
        this.addRock(id++, rng, x, y, z, model, range(rng, 0.7, 1.4));
        placed++;
      }
      return;
    }

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
          if (this.pathAt(x, z) < 3) return;
          const big = rng() < 0.1 + 0.25 * k;
          const scale = big ? range(rng, 2.2, 3.6) : range(rng, 0.7, 1.8);
          this.addRock(id++, rng, x, y, z, BOULDERS[Math.floor(rng() * BOULDERS.length)], scale);
        },
      );
      /* Stacked stone columns stand on the high benches of the rugged islands. */
      const columns = kind === "ridge" || kind === "fells" ? 26 : kind === "pinewood" ? 10 : 4;
      scatter(columns, { minH: 8, spacing: 22, minNy: 0.86 }, (x, y, z) => {
        if (this.pathAt(x, z) < 5) return;
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
        if (!growable(cx, cz, this.heightAt(cx, cz), 8)) continue;
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
          if (!growable(x, z, y, 3.5 + def.spacing * 0.3)) continue;
          if (!free(x, z, 1.2) || !clear(x, z, def.spacing * 0.5)) continue;
          /* Big in the heart of the grove, young at its rim. */
          const age = 1 - u * u * 0.6 + range(rng, -0.12, 0.12);
          this.addTree(id++, rng, x, y, z, sp, clamp(age, 0.45, 1.15), grid, cellOf);
        }
      }
      /* Landmark trees: a few big ones alone in the open, the kind you steer by. */
      scatter(kind === "harbor" ? 10 : 7, { minH: 3, spacing: 40, minNy: 0.88 }, (x, y, z) => {
        if (flora.forest(x, z) > 0.3 || this.pathAt(x, z) < 6) return;
        this.addTree(id++, rng, x, y, z, wood.lone, range(rng, 1.25, 1.5), grid, cellOf);
      });
      /* Strays: the odd tree between groves, so the open ground isn't bald. */
      grow(
        (x, z) => f.sparse * (0.4 + flora.forest(x, z)),
        f.sparse * 1.4,
        { minH: 2.4, spacing: 6, minNy: 0.86 },
        (x, y, z) => {
          if (this.pathAt(x, z) < 4) return;
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
          if (by < 0.9 || by > 3.2 || !free(bx, bz, 3) || this.pathAt(bx, bz) < 4) continue;
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

  /* The solids a body standing at (x, z) could touch, vehicles included. */
  solidsNear(x: number, z: number): readonly Solid[] {
    if (!this.buckets.length) return this.solids;
    return this.buckets[this.bucketZ(z) * this.bucketsPerSide + this.bucketX(x)] ?? NO_SOLIDS;
  }

  /* Add collision for something set down after generation (a vehicle); `key` removes it again. */
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
    /* On a plot you wake in front of the Hearth, facing it. */
    const pl = this.places.find((p) => p.kind === "hearth");
    if (this.plot && pl) {
      const x = pl.x + Math.sin(pl.rot) * (pl.r - 1.5);
      const z = pl.z + Math.cos(pl.rot) * (pl.r - 1.5);
      this.home = { x, y: this.heightAt(x, z), z, yaw: angleTo(pl.x - x, pl.z - z) };
      return;
    }
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
