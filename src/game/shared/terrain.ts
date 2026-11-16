import { GRID, ISLAND_RADIUS, STEP_HEIGHT, TILE_SIZE } from "./constants";
import { FEATURES } from "./features";
import { islandHeights, type ShapeId } from "./islands";
import { angleTo, clamp, mulberry32, range, smoothstep } from "./math";
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
};

/*
 * Something the body collides with: a vertical cylinder, or an oriented box
 * when `box` is set (r is then its bounding radius). Standable ones can be
 * climbed onto.
 */
export type Solid = {
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
  readonly cell = TILE_SIZE / (GRID - 1);
  readonly half = TILE_SIZE / 2;
  /* The centre of the island's tile on the grand map. */
  ox = 0;
  oz = 0;
  readonly props: Prop[] = [];
  readonly solids: Solid[] = [];
  readonly structures: Structure[] = [];
  readonly ladders: Ladder[] = [];
  /* Walkable high places on the structures: where loose weapons like to lie. */
  perches: readonly Perch[] = [];
  lighthouse: Spot = { x: 0, y: 0, z: 0 };
  /* Where a new arrival wakes up: a flat, open patch near the middle of the island. */
  home: Spot & { yaw: number } = { x: 0, y: 0, z: 0, yaw: 0 };
  /* The bounty board and the keeper's stall, either side of the lighthouse door. */
  board: Site = { x: 0, y: 0, z: 0, rot: 0 };
  shop: Site = { x: 0, y: 0, z: 0, rot: 0 };
  peak = 0;
  private taken: { x: number; z: number; r: number }[] = [];
  private buckets: Solid[][] = [];
  private bucketsPerSide = Math.ceil(TILE_SIZE / BUCKET);
  /* Solids added after generation (placed prefabs), by owner key. */
  private dynamic = new Map<number, { solids: Solid[]; cells: number[] }>();

  constructor(seed: number, shape: ShapeId = "headland", origin = { x: 0, z: 0 }) {
    this.seed = seed >>> 0;
    this.shape = shape;
    this.heights = islandHeights(shape, this.seed, GRID);
    this.raiseLighthouse();
    this.raiseStructures();
    this.scatterProps();
    this.findHome();
    this.moveTo(origin.x, origin.z);
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
    at(this.lighthouse);
    at(this.home);
    at(this.board);
    at(this.shop);
  }

  /* Find the summit and level a pad for the lighthouse. */
  private raiseLighthouse() {
    let best = 0;
    for (let k = 1; k < this.heights.length; k++)
      if (this.heights[k] > this.heights[best]) best = k;
    const x = this.ox - this.half + (best % GRID) * this.cell;
    const z = this.oz - this.half + Math.floor(best / GRID) * this.cell;
    const top = this.heights[best];

    if (FEATURES.lighthouse)
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
    const j1 = Math.min(GRID - 1, Math.ceil((x + outer + this.half) / this.cell));
    const i0 = Math.max(0, Math.floor((z - outer + this.half) / this.cell));
    const i1 = Math.min(GRID - 1, Math.ceil((z + outer + this.half) / this.cell));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const d = Math.hypot(-this.half + j * this.cell - x, -this.half + i * this.cell - z);
        if (d > outer) continue;
        const k = i * GRID + j;
        const w = 1 - smoothstep(inner, outer, d);
        this.heights[k] += (y - this.heights[k]) * w;
      }
    }
  }

  /* Windmill, chapel, mast, henge, villages, watchtowers, aqueduct, wrecks, jetties. */
  private raiseStructures() {
    const plan = planStructures(this, this.seed, {
      lighthouse: FEATURES.lighthouse,
      landmarks: FEATURES.landmarks,
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
   * The board and the stall stand on the plinth either side of the door,
   * facing out. Their front (local +z) points away from the tower.
   */
  private furnishPlinth(st: Structure) {
    const base = st.y + LIGHTHOUSE.plinthHeight;
    const site = (a: number): Site => ({
      x: st.x + Math.cos(a) * 5.05,
      y: base,
      z: st.z + Math.sin(a) * 5.05,
      rot: Math.PI / 2 - a,
    });
    this.board = site(st.rot + 0.78);
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
    /* Board: two posts, a planked face, notices pinned to it, a little roof. */
    const b = this.board;
    for (const side of [-1, 1])
      B.push(
        block(b, side * 0.85, 0, {
          bottom: base,
          top: base + 2.3,
          hx: 0.06,
          hz: 0.06,
          tone: "dark",
        }),
      );
    B.push(block(b, 0, 0, { bottom: base + 0.75, top: base + 2.05, hx: 0.82, hz: 0.05 }));
    B.push(
      block(b, 0, 0.02, {
        bottom: base + 2.3,
        top: base + 2.38,
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
          bottom: base + ly - h,
          top: base + ly + h,
          hx: w,
          hz: 0.012,
          tone: "light",
          solid: false,
        }),
      );
    st.lamps.push({ x: b.x, y: base + 2.2, z: b.z });
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

  private scatterProps() {
    const rng = mulberry32(this.seed ^ 0x51ed270b);
    let id = 0;
    const taken = this.taken;
    const free = (x: number, z: number, r: number) =>
      taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);

    const scatter = (
      count: number,
      opts: { minH: number; maxH?: number; spacing: number; minNy: number },
      make: (x: number, y: number, z: number) => void,
    ) => {
      let placed = 0;
      for (let attempt = 0; attempt < count * 40 && placed < count; attempt++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * ISLAND_RADIUS * 1.05;
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
      place();
      if (on) return;
      this.props.length = props;
      this.solids.length = solids;
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

    keepIf(FEATURES.rocks, () =>
      scatter(240, { minH: 0.4, spacing: 3.2, minNy: 0.55 }, (x, y, z) => {
        const scale = rng() < 0.15 ? range(rng, 2.2, 3.4) : range(rng, 0.6, 1.9);
        const sink = scale * 0.28;
        const height = scale * range(rng, 0.8, 1.15);
        this.props.push({
          id: id++,
          kind: "rock",
          x,
          y: y - sink,
          z,
          rot: rng() * Math.PI * 2,
          scale,
          height,
          variant: Math.floor(rng() * 1e6),
        });
        this.solids.push({
          x,
          z,
          r: scale * 0.82,
          bottom: y - sink,
          top: y - sink + height * 0.86,
          standable: true,
        });
      }),
    );

    keepIf(FEATURES.trees, () =>
      scatter(140, { minH: 2.5, spacing: 5, minNy: 0.7 }, (x, y, z) => {
        const scale = range(rng, 0.8, 1.35);
        this.props.push({
          id: id++,
          kind: "tree",
          x,
          y: y - 0.3,
          z,
          rot: rng() * Math.PI * 2,
          scale,
          height: 6.5 * scale,
          variant: Math.floor(rng() * 1e6),
        });
        this.solids.push({
          x,
          z,
          r: 0.32 * scale,
          bottom: y - 1,
          top: y + 7 * scale,
          standable: false,
        });
      }),
    );

    keepIf(FEATURES.buoys, () => {
      for (let b = 0, attempt = 0; b < 20 && attempt < 600; attempt++) {
        const a = rng() * Math.PI * 2;
        const d = range(rng, ISLAND_RADIUS * 0.95, ISLAND_RADIUS * 1.15);
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
    for (let d = 0; d < ISLAND_RADIUS * 0.8 && !best; d += 5) {
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
    const gx = clamp((x - this.ox + this.half) / this.cell, 0, GRID - 1.001);
    const gz = clamp((z - this.oz + this.half) / this.cell, 0, GRID - 1.001);
    const j = Math.floor(gx);
    const i = Math.floor(gz);
    const fx = gx - j;
    const fz = gz - i;
    const k = i * GRID + j;
    const h00 = this.heights[k];
    const h10 = this.heights[k + 1];
    const h01 = this.heights[k + GRID];
    const h11 = this.heights[k + GRID + 1];
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
