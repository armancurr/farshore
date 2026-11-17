/*
 * The roads on an island: wide enough for two carts to pass, laid out the
 * way a town plans them rather than the way feet wear them. Every island's
 * network starts at its pier on the shore; on a hunting island a trunk road
 * climbs from there to the very top, a ring road runs round the island's
 * middle, and tracks branch off to each of its places. On the Harbor an
 * avenue runs from every pier to the lighthouse square, and two ring roads
 * tie the avenues together. Each road is found the way a surveyor finds one:
 * along the contours, up the gentlest slope, round a cliff rather than over
 * it; then it's smoothed into easy curves, and the Terrain cuts it into the
 * ground with an even grade, which is what turns a riser into a ramp.
 *
 * Pure functions of the ground, so every machine finds the same roads.
 */

export type PathPoint = { x: number; z: number };

export interface PathGround {
  readonly half: number;
  heightAt(x: number, z: number): number;
}

/* Half a road's width: room for two carts (or two cars) to pass, with a stride to spare. */
export const ROAD_HALF = 4;
/* The steepest a road is cut, rise over run: 15 %. */
export const ROAD_GRADE = 0.15;
/* What a road hopes to climb at most, as rise over run: past this it winds round instead. */
const EASY_GRADE = 0.13;

/* The search grid's spacing, in metres. Coarse is fine: the result is smoothed. */
const STEP = 8;

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [2, 1],
  [1, 2],
  [-2, 1],
  [-1, 2],
  [2, -1],
  [1, -2],
  [-2, -1],
  [-1, -2],
];

/*
 * An island's road network, laid one road at a time. Each road is found
 * across the ground as it stands when it's asked for (so a road planned after
 * another is cut sees that one's cutting, and meets it level), by A* over a
 * coarse grid: a gentle grade is cheap, a steep one dear (so roads wind up a
 * hill rather than charge it), a cliff all but impassable and the sea out of
 * the question. Found, it's smoothed into easy curves; the Terrain cuts it in.
 */
export class RoadNet {
  private readonly n: number;
  private readonly half: number;
  /* Cells on a road (or a square): where the network already is. */
  private readonly on: Uint8Array;
  /* Cells to keep off: a camp, the lighthouse. */
  private readonly off: Uint8Array;
  /* Every road point laid, to end a joining road exactly on one. */
  private readonly points: PathPoint[] = [];

  constructor(private readonly ground: PathGround) {
    this.half = ground.half;
    this.n = Math.ceil((ground.half * 2) / STEP) + 1;
    this.on = new Uint8Array(this.n * this.n);
    this.off = new Uint8Array(this.n * this.n);
  }

  private cellOf(p: PathPoint) {
    const n = this.n;
    const j = Math.max(0, Math.min(n - 1, Math.round((p.x + this.half) / STEP)));
    const i = Math.max(0, Math.min(n - 1, Math.round((p.z + this.half) / STEP)));
    return i * n + j;
  }

  private pointOf(c: number): PathPoint {
    return { x: -this.half + (c % this.n) * STEP, z: -this.half + Math.floor(c / this.n) * STEP };
  }

  private disc(x: number, z: number, r: number, into: Uint8Array) {
    const n = this.n;
    const j0 = Math.max(0, Math.floor((x - r + this.half) / STEP));
    const j1 = Math.min(n - 1, Math.ceil((x + r + this.half) / STEP));
    const i0 = Math.max(0, Math.floor((z - r + this.half) / STEP));
    const i1 = Math.min(n - 1, Math.ceil((z + r + this.half) / STEP));
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        if (Math.hypot(-this.half + j * STEP - x, -this.half + i * STEP - z) <= r)
          into[i * n + j] = 1;
  }

  /* Somewhere the roads go round. */
  avoid(x: number, z: number, r: number) {
    this.disc(x, z, r, this.off);
  }

  /* Somewhere already part of the network: a square, a quay. */
  markArea(x: number, z: number, r: number) {
    this.disc(x, z, r, this.on);
    this.points.push({ x, z });
  }

  /* A road laid: its cells are the network now. */
  mark(line: PathPoint[]) {
    for (const p of line) {
      this.on[this.cellOf(p)] = 1;
      this.points.push(p);
    }
  }

  /* Is (x, z) on the network (within a cell of a road)? */
  reaches(p: PathPoint) {
    return this.on[this.cellOf(p)] === 1;
  }

  /*
   * A road from a to b. `merge` lets it run along roads already laid (a
   * track joining the network); an avenue or a ring road keeps its own line.
   */
  route(a: PathPoint, b: PathPoint, merge = true): PathPoint[] | null {
    const from = this.cellOf(a);
    const to = this.cellOf(b);
    const cells = this.search(from, (c) => c === to, to, merge);
    if (!cells) return null;
    return this.finish(cells, a, b);
  }

  /* A road from a to the nearest part of the network, ending exactly on it. */
  join(a: PathPoint): PathPoint[] | null {
    const from = this.cellOf(a);
    if (this.on[from]) return null;
    const cells = this.search(from, (c) => this.on[c] === 1, -1, true);
    if (!cells) return null;
    const end = this.pointOf(cells[cells.length - 1]);
    return this.finish(cells, a, this.nearestPoint(end));
  }

  /*
   * If the network has come apart (a ring that never met the trunk), a road
   * joining the smallest stray piece to the rest; null once it's all one.
   */
  stitch(): PathPoint[] | null {
    const n = this.n;
    const part = new Int32Array(n * n).fill(-1);
    const sizes: number[] = [];
    for (let c = 0; c < n * n; c++) {
      if (!this.on[c] || part[c] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [c];
      part[c] = id;
      while (stack.length) {
        const k = stack.pop() as number;
        size++;
        const kx = k % n;
        const kz = Math.floor(k / n);
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const x = kx + dx;
            const z = kz + dz;
            if (x < 0 || z < 0 || x >= n || z >= n) continue;
            const o = z * n + x;
            if (this.on[o] && part[o] < 0) {
              part[o] = id;
              stack.push(o);
            }
          }
      }
      sizes.push(size);
    }
    if (sizes.length < 2) return null;
    let main = 0;
    for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[main]) main = k;
    let stray = main === 0 ? 1 : 0;
    for (let k = 0; k < sizes.length; k++) if (k !== main && sizes[k] < sizes[stray]) stray = k;
    /* Search out from every cell of the stray piece at once, to the nearest of the rest. */
    const starts: number[] = [];
    for (let c = 0; c < n * n; c++) if (part[c] === stray) starts.push(c);
    const cells = this.search(starts, (c) => this.on[c] === 1 && part[c] !== stray, -1, false);
    if (!cells) {
      /* Nothing can reach it: let it go rather than ask forever. */
      for (const c of starts) this.on[c] = 0;
      return this.stitch();
    }
    const a = this.nearestPoint(this.pointOf(cells[0]));
    const b = this.nearestPoint(this.pointOf(cells[cells.length - 1]));
    return this.finish(cells, a, b);
  }

  private nearestPoint(p: PathPoint) {
    let best = p;
    let d = Infinity;
    for (const q of this.points) {
      const e = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (e < d) {
        d = e;
        best = q;
      }
    }
    return { ...best };
  }

  /* The cells found, as an even, smooth line from exactly a to exactly b. */
  private finish(cells: number[], a: PathPoint, b: PathPoint) {
    const pts = cells.map((c) => this.pointOf(c));
    pts[0] = { ...a };
    if (pts.length < 2) pts.push({ ...b });
    else pts[pts.length - 1] = { ...b };
    let line = resample(chaikin(chaikin(chaikin(pts))), 2);
    /* Then ease it a little more, so it reads as laid out rather than wandered, and space it evenly again. */
    for (let pass = 0; pass < 2; pass++) line = relax(line, 3);
    return resample(line, 2);
  }

  /*
   * A* (or, with no target cell, Dijkstra) from `from` until `done`. Returns
   * the cells, start to end.
   */
  private search(
    from: number | number[],
    done: (c: number) => boolean,
    target: number,
    merge: boolean,
  ): number[] | null {
    const n = this.n;
    const h = new Float32Array(n * n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        h[i * n + j] = this.ground.heightAt(-this.half + j * STEP, -this.half + i * STEP);
    const g = new Float32Array(n * n).fill(Infinity);
    const came = new Int32Array(n * n).fill(-1);
    const closed = new Uint8Array(n * n);
    const heap = new MinHeap();
    const tx = target % n;
    const tz = Math.floor(target / n);
    const guess =
      target < 0
        ? () => 0
        : (c: number) => Math.hypot((c % n) - tx, Math.floor(c / n) - tz) * STEP * 0.95;
    const starts = Array.isArray(from) ? from : [from];
    for (const s of starts) {
      g[s] = 0;
      heap.push(s, guess(s));
    }
    let end = -1;
    while (heap.size) {
      const c = heap.pop();
      if (closed[c]) continue;
      if (done(c) && !starts.includes(c)) {
        end = c;
        break;
      }
      closed[c] = 1;
      const cx = c % n;
      const cz = Math.floor(c / n);
      for (const [dx, dz] of DIRS) {
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || z < 0 || x >= n || z >= n) continue;
        const k = z * n + x;
        if (closed[k]) continue;
        const run = Math.hypot(dx, dz) * STEP;
        const grade = Math.abs(h[k] - h[c]) / run;
        /* Gentle is cheap, past an easy grade dear, a cliff all but impassable. */
        let cost = run * (1 + 8 * grade * grade);
        if (grade > EASY_GRADE) cost += run * 45 * (grade - EASY_GRADE);
        if (grade > 0.45) cost += run * 40;
        /* The sea is out of the question; a camp or a tower is walked round. */
        if (h[k] < 0.9) cost *= 60;
        if (this.off[k] && !done(k)) cost *= 12;
        /* Along a road already there: cheaper, so a track joins it rather than running beside it. */
        if (merge && this.on[k]) cost *= 0.45;
        const next = g[c] + cost;
        if (next < g[k]) {
          g[k] = next;
          came[k] = c;
          heap.push(k, next + guess(k));
        }
      }
    }
    if (end < 0) return null;
    const out = [end];
    let c = end;
    while (came[c] >= 0) {
      c = came[c];
      out.push(c);
    }
    return out.reverse();
  }
}

/* Each point pulled toward the mean of its neighbours (the ends stay put). */
function relax(pts: PathPoint[], reach: number) {
  if (pts.length < 3) return pts;
  const out = pts.map((p) => ({ ...p }));
  for (let k = 1; k < pts.length - 1; k++) {
    const r = Math.min(reach, k, pts.length - 1 - k);
    let x = 0;
    let z = 0;
    for (let j = k - r; j <= k + r; j++) {
      x += pts[j].x;
      z += pts[j].z;
    }
    out[k] = { x: x / (2 * r + 1), z: z / (2 * r + 1) };
  }
  return out;
}

/* Corner-cutting: each pass rounds every bend a little more. */
function chaikin(pts: PathPoint[]) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
    out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/* Even spacing along the line, `step` metres apart. */
function resample(pts: PathPoint[], step: number) {
  const out = [pts[0]];
  let carry = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let t = step - carry;
    while (t <= len) {
      out.push({ x: a.x + ((b.x - a.x) * t) / len, z: a.z + ((b.z - a.z) * t) / len });
      t += step;
    }
    carry = len - (t - step);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop() {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop() as number;
    const lastKey = keys.pop() as number;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && keys[r] < keys[l] ? r : l;
        if (keys[m] >= lastKey) break;
        ids[i] = ids[m];
        keys[i] = keys[m];
        i = m;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

/*
 * Distance from each sample of a grid to the nearest path, out to `reach`
 * metres (further is left at `reach`): what the ground paints the trails
 * from, and what keeps the trees off them.
 */
export function pathDistance(lines: PathPoint[][], half: number, res: number, reach: number) {
  const out = new Float32Array(res * res).fill(reach);
  const cell = (half * 2) / res;
  for (const line of lines) {
    for (let k = 0; k < line.length - 1; k++) {
      const a = line[k];
      const b = line[k + 1];
      const j0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach + half) / cell));
      const j1 = Math.min(res - 1, Math.ceil((Math.max(a.x, b.x) + reach + half) / cell));
      const i0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach + half) / cell));
      const i1 = Math.min(res - 1, Math.ceil((Math.max(a.z, b.z) + reach + half) / cell));
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      for (let i = i0; i <= i1; i++) {
        const pz = -half + (i + 0.5) * cell;
        for (let j = j0; j <= j1; j++) {
          const px = -half + (j + 0.5) * cell;
          const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / len2));
          const d = Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
          const o = i * res + j;
          if (d < out[o]) out[o] = d;
        }
      }
    }
  }
  return out;
}
