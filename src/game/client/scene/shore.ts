import * as THREE from "three";
import { SEA_LEVEL } from "../../shared/constants";

/* The shore field is sampled this many times finer than the heightmap. */
export const SHORE_SUB = 4;

/* Uniform cubic B-spline weights at t in [0, 1): the same smoothing the shaders use. */
function bspline(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const u = 1 - t;
  return [(u * u * u) / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6];
}

const FAR = 1e20;

/* Felzenszwalb's 1-D squared distance transform of f, written into d. */
function edt1d(f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number) {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;
  for (let q = 1; q < n; q++) {
    let r = v[k];
    let s = (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r);
    while (s <= z[k]) {
      k--;
      r = v[k];
      s = (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/* A box blur of radius r along rows (step 1) or columns (step m), edges clamped by count. */
function boxBlur(src: Float32Array, dst: Float32Array, m: number, r: number, alongRows: boolean) {
  for (let line = 0; line < m; line++) {
    const at = (i: number) => (alongRows ? line * m + i : i * m + line);
    let sum = 0;
    let count = 0;
    for (let i = 0; i <= r && i < m; i++) {
      sum += src[at(i)];
      count++;
    }
    for (let i = 0; i < m; i++) {
      dst[at(i)] = sum / count;
      const add = i + r + 1;
      const drop = i - r;
      if (add < m) {
        sum += src[at(add)];
        count++;
      }
      if (drop >= 0) {
        sum -= src[at(drop)];
        count--;
      }
    }
  }
}

/*
 * Distance from every patch of sea to the nearest shore, in metres. The sea's
 * water-lines are its iso-lines, so they follow the coast. Built once per world
 * from the smoothed heightmap: an exact distance transform on a fine grid, then
 * softened a touch so the lines don't stair-step.
 */
export function bakeShoreDistance(heights: Float32Array, n: number, size: number) {
  const m = (n - 1) * SHORE_SUB + 1;
  const SHORE_CELL = size / (m - 1);
  const sub = SHORE_SUB;
  const weights = Array.from({ length: sub }, (_, s) => bspline(s / sub));
  const clampN = (i: number) => (i < 0 ? 0 : i > n - 1 ? n - 1 : i);

  /* Smooth heights on the fine grid, upsampled one axis at a time. */
  const rows = new Float32Array(n * m);
  for (let i = 0; i < n; i++) {
    for (let J = 0; J < m; J++) {
      const j = Math.floor(J / sub);
      const w = weights[J % sub];
      let h = 0;
      for (let a = 0; a < 4; a++) h += w[a] * heights[i * n + clampN(j + a - 1)];
      rows[i * m + J] = h;
    }
  }
  const f = new Float64Array(m * m);
  for (let I = 0; I < m; I++) {
    const i = Math.floor(I / sub);
    const w = weights[I % sub];
    for (let J = 0; J < m; J++) {
      let h = 0;
      for (let b = 0; b < 4; b++) h += w[b] * rows[clampN(i + b - 1) * m + J];
      f[I * m + J] = h > SEA_LEVEL ? 0 : FAR;
    }
  }

  const line = new Float64Array(m);
  const out = new Float64Array(m);
  const v = new Int32Array(m);
  const z = new Float64Array(m + 1);
  for (let J = 0; J < m; J++) {
    for (let I = 0; I < m; I++) line[I] = f[I * m + J];
    edt1d(line, out, v, z, m);
    for (let I = 0; I < m; I++) f[I * m + J] = out[I];
  }
  for (let I = 0; I < m; I++) {
    for (let J = 0; J < m; J++) line[J] = f[I * m + J];
    edt1d(line, out, v, z, m);
    for (let J = 0; J < m; J++) f[I * m + J] = out[J];
  }

  const dist = new Float32Array(m * m);
  for (let k = 0; k < dist.length; k++)
    dist[k] = f[k] > 0 ? Math.max(0, Math.sqrt(f[k]) * SHORE_CELL - SHORE_CELL * 0.5) : 0;
  const tmp = new Float32Array(m * m);
  for (let pass = 0; pass < 2; pass++) {
    boxBlur(dist, tmp, m, 3, true);
    boxBlur(tmp, dist, m, 3, false);
  }

  const half = new Uint16Array(m * m);
  for (let k = 0; k < half.length; k++) half[k] = THREE.DataUtils.toHalfFloat(dist[k]);
  const tex = new THREE.DataTexture(half, m, m, THREE.RedFormat, THREE.HalfFloatType);
  tex.unpackAlignment = 2;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, grid: m, cell: SHORE_CELL };
}
