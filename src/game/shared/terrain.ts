import {
  GRID,
  ISLAND_RADIUS,
  MAX_HEIGHT,
  MAX_PLAYERS,
  SEA_FLOOR,
  STEP_HEIGHT,
  WORLD_SIZE,
} from "./constants";
import { angleTo, clamp, createNoise2D, fbm, mulberry32, range, smoothstep } from "./math";
import {
  type Block,
  type Ladder,
  LIGHTHOUSE,
  type Perch,
  planStructures,
  type Structure,
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

export type Spot = { x: number; y: number; z: number; ladder?: boolean };

/* A perch the bots can aim for; `route` lists the footholds that lead up to it. */
export type HighSpot = Spot & { route?: Spot[] };

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
 * The island. Everything here is a pure function of the seed, so the server
 * (or the in-browser room) and every client build the same world.
 */
export class Terrain {
  readonly seed: number;
  readonly heights = new Float32Array(GRID * GRID);
  readonly cell = WORLD_SIZE / (GRID - 1);
  readonly half = WORLD_SIZE / 2;
  readonly props: Prop[] = [];
  readonly solids: Solid[] = [];
  readonly cairns: Prop[] = [];
  readonly highSpots: HighSpot[] = [];
  readonly spawns: (Spot & { yaw: number })[] = [];
  readonly structures: Structure[] = [];
  readonly ladders: Ladder[] = [];
  lighthouse: Spot = { x: 0, y: 0, z: 0 };
  peak = 0;
  private perches: Perch[] = [];
  private taken: { x: number; z: number; r: number }[] = [];
  private propSolidsFrom = 0;
  private buckets: Solid[][] = [];
  private bucketsPerSide = Math.ceil(WORLD_SIZE / BUCKET);

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.generateHeights();
    this.raiseLighthouse();
    this.raiseStructures();
    this.scatterProps();
    this.findHighSpots();
    this.indexSolids();
    this.findSpawns();
  }

  private generateHeights() {
    const rng = mulberry32(this.seed);
    const rolling = createNoise2D(rng);
    const warp = createNoise2D(rng);
    const ridges = createNoise2D(rng);

    /*
     * One main massif for the lighthouse, a ring of secondary peaks for the
     * other landmarks, and smaller knolls in between so the rising sea breaks
     * the island into separate hills.
     */
    const hills: { x: number; z: number; r: number; h: number }[] = [];
    const at = (angle: number, dist: number, r: number, h: number) =>
      hills.push({ x: Math.cos(angle) * dist, z: Math.sin(angle) * dist, r, h });
    at(rng() * Math.PI * 2, rng() * 50, range(rng, 58, 72), 1);
    const peaks = 5 + Math.floor(rng() * 2);
    const turn = rng() * Math.PI * 2;
    for (let p = 0; p < peaks; p++) {
      const angle = turn + ((p + range(rng, -0.25, 0.25)) / peaks) * Math.PI * 2;
      at(angle, range(rng, 125, 195), range(rng, 34, 52), range(rng, 0.5, 0.78));
    }
    for (let k = 0; k < 9; k++)
      at(rng() * Math.PI * 2, range(rng, 60, 240), range(rng, 18, 34), range(rng, 0.18, 0.42));

    const raw = new Float32Array(GRID * GRID);
    const masks = new Float32Array(GRID * GRID);
    let maxRaw = 0;

    for (let i = 0; i < GRID; i++) {
      const z = -this.half + i * this.cell;
      for (let j = 0; j < GRID; j++) {
        const x = -this.half + j * this.cell;
        const wx = x + warp(x * 0.005, z * 0.005) * 62;
        const wz = z + warp(x * 0.005 + 31.7, z * 0.005 - 12.3) * 62;
        const d = Math.hypot(wx, wz) / ISLAND_RADIUS;
        const mask = 1 - smoothstep(0.55, 1.02, d);

        let hill = 0;
        for (const h of hills) {
          const dx = x - h.x;
          const dz = z - h.z;
          hill += h.h * Math.exp(-(dx * dx + dz * dz) / (h.r * h.r));
        }
        const roll = fbm(rolling, x * 0.009, z * 0.009, 4);
        const ridge = 1 - Math.abs(fbm(ridges, x * 0.014, z * 0.014, 3));

        const v = mask * Math.max(0, 0.14 + hill * 0.8 + roll * 0.18 + ridge * ridge * 0.09);
        const k = i * GRID + j;
        raw[k] = v;
        masks[k] = mask;
        if (v > maxRaw) maxRaw = v;
      }
    }

    for (let k = 0; k < raw.length; k++) {
      const land = (raw[k] / maxRaw) * MAX_HEIGHT - 1.4;
      this.heights[k] = land + (1 - masks[k]) * (SEA_FLOOR + 1.4);
    }
  }

  /* Find the summit and level a pad for the lighthouse. */
  private raiseLighthouse() {
    let best = 0;
    for (let k = 1; k < this.heights.length; k++)
      if (this.heights[k] > this.heights[best]) best = k;
    const x = -this.half + (best % GRID) * this.cell;
    const z = -this.half + Math.floor(best / GRID) * this.cell;
    const top = this.heights[best];

    this.levelPad(x, z, LIGHTHOUSE.plinthRadius - 1, LIGHTHOUSE.plinthRadius + 5, top);

    this.lighthouse = { x, y: top, z };
    /* The lantern deck, built with the other structures. */
    this.peak = top + LIGHTHOUSE.plinthHeight + LIGHTHOUSE.towerHeight;
  }

  /* Blend the ground within `outer` of (x, z) toward height y, flat inside `inner`. */
  levelPad(x: number, z: number, inner: number, outer: number, y: number) {
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
    const plan = planStructures(this, this.seed);
    this.structures.push(...plan.structures);
    this.perches = plan.perches;
    this.taken = plan.footprints;
    for (const st of plan.structures) {
      for (const b of st.blocks) if (b.solid) this.solids.push(blockSolid(b));
      this.ladders.push(...st.ladders);
    }
    this.propSolidsFrom = this.solids.length;
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

    /* Ruins: broken columns climbing in a ring, a parkour stair to a high perch. */
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
    });

    scatter(30, { minH: 1.5, spacing: 18, minNy: 0.75 }, (x, y, z) => {
      const cairn: Prop = {
        id: id++,
        kind: "cairn",
        x,
        y,
        z,
        rot: rng() * Math.PI * 2,
        scale: 1,
        height: 1.1,
        variant: Math.floor(rng() * 3),
      };
      this.props.push(cairn);
      this.cairns.push(cairn);
    });

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
    });

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
    });

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
  }

  /* Perches the bots aim for: local summits, rock tops, column tops, the plinth. */
  private findHighSpots() {
    const spots: HighSpot[] = [];
    const stride = 6;
    for (let i = stride; i < GRID - stride; i += stride) {
      for (let j = stride; j < GRID - stride; j += stride) {
        const h = this.heights[i * GRID + j];
        if (h < 4) continue;
        let summit = true;
        for (let di = -1; di <= 1 && summit; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            if ((di || dj) && this.heights[(i + di * stride) * GRID + j + dj * stride] > h) {
              summit = false;
              break;
            }
          }
        }
        if (summit)
          spots.push({ x: -this.half + j * this.cell, y: h, z: -this.half + i * this.cell });
      }
    }
    /* Rocks and columns (structures bring their own perches, with routes). */
    for (let k = this.propSolidsFrom; k < this.solids.length; k++) {
      const s = this.solids[k];
      if (s.standable && s.top - this.heightAt(s.x, s.z) > 0.6)
        spots.push({ x: s.x, y: s.top, z: s.z });
    }
    spots.sort((a, b) => b.y - a.y);
    this.highSpots.push(...spots.slice(0, 120), ...this.perches);
  }

  /* Bucket every solid by the cells its footprint (plus a body) overlaps. */
  private indexSolids() {
    const n = this.bucketsPerSide;
    this.buckets = Array.from({ length: n * n }, () => []);
    for (const s of this.solids) {
      const pad = s.r + 1;
      const j0 = this.bucketOf(s.x - pad);
      const j1 = this.bucketOf(s.x + pad);
      const i0 = this.bucketOf(s.z - pad);
      const i1 = this.bucketOf(s.z + pad);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.buckets[i * n + j].push(s);
    }
  }

  private bucketOf(v: number) {
    return clamp(Math.floor((v + this.half) / BUCKET), 0, this.bucketsPerSide - 1);
  }

  /* The solids a body standing at (x, z) could touch. */
  solidsNear(x: number, z: number): readonly Solid[] {
    if (!this.buckets.length) return this.solids;
    return this.buckets[this.bucketOf(z) * this.bucketsPerSide + this.bucketOf(x)] ?? NO_SOLIDS;
  }

  /* One spawn per player, spread round the island on low ground, facing inland. */
  private findSpawns() {
    const rng = mulberry32(this.seed ^ 0x2545f491);
    const offset = rng() * Math.PI * 2;
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const a = offset + (p / MAX_PLAYERS) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      /* Walk inland from the sea and take the first flat patch of beach. */
      let spot: { x: number; z: number } | null = null;
      let fallback = { x: dx * 30, z: dz * 30 };
      let seenLand = false;
      for (let d = ISLAND_RADIUS * 1.2; d > 10; d -= 1.5) {
        const x = dx * d;
        const z = dz * d;
        const h = this.heightAt(x, z);
        if (h > 2.5 && !seenLand) {
          seenLand = true;
          fallback = { x, z };
        }
        if (h > 2.5 && h < 9 && this.normalAt(x, z)[1] > 0.8 && this.clearOfSolids(x, z)) {
          spot = { x, z };
          break;
        }
      }
      spot ??= fallback;
      this.spawns.push({
        ...spot,
        y: this.heightAt(spot.x, spot.z),
        yaw: angleTo(-dx, -dz),
      });
    }
  }

  private clearOfSolids(x: number, z: number) {
    return this.solids.every((s) => Math.hypot(s.x - x, s.z - z) > s.r + 1);
  }

  heightAt(x: number, z: number) {
    const gx = clamp((x + this.half) / this.cell, 0, GRID - 1.001);
    const gz = clamp((z + this.half) / this.cell, 0, GRID - 1.001);
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
  groundAt(x: number, z: number, feetY: number, extra: readonly Solid[] = []) {
    let ground = this.heightAt(x, z);
    let onSolid = false;
    const check = (s: Solid) => {
      if (s.standable && s.top > ground && s.top <= feetY + STEP_HEIGHT && overSolid(s, x, z)) {
        ground = s.top;
        onSolid = true;
      }
    };
    for (const s of this.solidsNear(x, z)) check(s);
    for (const s of extra) check(s);
    return { ground, onSolid };
  }
}
