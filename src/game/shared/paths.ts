/*
 * The paths on an island: worn trails (cobbles on the Harbor) joining its
 * places, found the way people find them, by walking the easy way round:
 * across the benches, along the contours, up the gentlest slope through a
 * terrace rather than straight over its cliff. Once found they're smoothed
 * into easy curves, and the Terrain cuts them into the ground with an even
 * grade, which is what turns a riser into a ramp.
 *
 * Pure functions of the ground, so every machine finds the same paths.
 */

export type PathPoint = { x: number; z: number };

export interface PathGround {
  readonly half: number;
  heightAt(x: number, z: number): number;
}

/* The search grid's spacing, in metres. Coarse is fine: the result is smoothed. */
const STEP = 8;

/*
 * Join the doors into one network: a minimum spanning tree by distance (so
 * every place is reachable and there's no clutter of duplicate roads), each
 * edge walked by A* over the ground.
 */
export function planPaths(ground: PathGround, doors: PathPoint[]): PathPoint[][] {
  if (doors.length < 2) return [];
  const n = Math.ceil((ground.half * 2) / STEP) + 1;
  const h = new Float32Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      h[i * n + j] = ground.heightAt(-ground.half + j * STEP, -ground.half + i * STEP);
  /* Cells a path already uses are cheaper, so later paths join earlier ones instead of running beside them. */
  const used = new Uint8Array(n * n);
  const cellOf = (p: PathPoint) => {
    const j = Math.max(0, Math.min(n - 1, Math.round((p.x + ground.half) / STEP)));
    const i = Math.max(0, Math.min(n - 1, Math.round((p.z + ground.half) / STEP)));
    return i * n + j;
  };

  /* Prim's tree over the doors. */
  const inTree = [0];
  const edges: [number, number][] = [];
  const left = new Set(doors.map((_, k) => k).slice(1));
  while (left.size) {
    let best: [number, number, number] | null = null;
    for (const a of inTree)
      for (const b of left) {
        const d = Math.hypot(doors[a].x - doors[b].x, doors[a].z - doors[b].z);
        if (!best || d < best[2]) best = [a, b, d];
      }
    if (!best) break;
    edges.push([best[0], best[1]]);
    inTree.push(best[1]);
    left.delete(best[1]);
  }

  const lines: PathPoint[][] = [];
  for (const [a, b] of edges) {
    const route = astar(h, n, used, cellOf(doors[a]), cellOf(doors[b]));
    if (!route) continue;
    for (const c of route) used[c] = 1;
    const pts = route.map((c) => ({
      x: -ground.half + (c % n) * STEP,
      z: -ground.half + Math.floor(c / n) * STEP,
    }));
    /* End exactly at the doors. */
    pts[0] = { ...doors[a] };
    pts[pts.length - 1] = { ...doors[b] };
    lines.push(resample(chaikin(chaikin(chaikin(pts))), 2));
  }
  return lines;
}

function astar(
  h: Float32Array,
  n: number,
  used: Uint8Array,
  from: number,
  to: number,
): number[] | null {
  const g = new Float32Array(n * n).fill(Infinity);
  const came = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  const heap = new MinHeap();
  const tx = to % n;
  const tz = Math.floor(to / n);
  const guess = (c: number) => Math.hypot((c % n) - tx, Math.floor(c / n) - tz) * STEP * 0.9;
  g[from] = 0;
  heap.push(from, guess(from));
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
  while (heap.size) {
    const c = heap.pop();
    if (c === to) break;
    if (closed[c]) continue;
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
      const rise = Math.abs(h[k] - h[c]);
      const grade = rise / run;
      /* Steep is slow and a cliff is all but impassable; the sea is out of the question. */
      let cost = run * (1 + 18 * grade * grade + (grade > 0.45 ? 40 : 0));
      if (h[k] < 0.9) cost *= 60;
      if (used[k]) cost *= 0.45;
      const next = g[c] + cost;
      if (next < g[k]) {
        g[k] = next;
        came[k] = c;
        heap.push(k, next + guess(k));
      }
    }
  }
  if (came[to] < 0 && to !== from) return null;
  const out = [to];
  let c = to;
  while (c !== from) {
    c = came[c];
    if (c < 0) return null;
    out.push(c);
  }
  return out.reverse();
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
