import * as THREE from "three";
import { GRAND_SIZE } from "../../shared/constants";
import { createNoise2D, mulberry32, range } from "../../shared/math";
import { windDrift } from "../../shared/wind";
import { GLSL_COMMON, shared } from "./materials";
import { NO_CAST } from "./shadows";

/*
 * Fair-weather cumulus: faceted white heaps with flat grey-violet bellies,
 * the same low-poly hand as the trees. They ride the wind (shared/wind.ts)
 * from world time, so every player sees the same sky, and they creep along at
 * a few metres a second, slowly enough that it's the world that seems to turn.
 *
 * The sky is a torus as wide as the grand map, wrapped round wherever you
 * are; a cloud leaving the far edge dissolves into the haze and comes back on
 * the other side. Their shadows are a small footprint map, redrawn now and
 * then, that the ground and everything on it sample (cloudShade in GLSL).
 */

const COUNT = 58;
const VARIANTS = 10;
const SPAN = GRAND_SIZE;
/* Cloud bases sit between these heights: above the tallest hill, below the creative ceiling. */
const BASE_LO = 150;
const BASE_HI = 230;
/* The height their shadows are cast from: about the middle of the heaps. */
const SHADE_ALT = 205;

/* A puff of a cloud, in the cloud's own frame (for the shadow map). */
type Puff = { x: number; z: number; r: number };
type Variant = { geo: THREE.BufferGeometry; puffs: Puff[] };

/* One heap: a row of puffs, biggest in the middle, a few riding on top, the bottom sheared flat. */
function heap(seed: number): Variant {
  const rng = mulberry32(seed);
  const noise = createNoise2D(rng);
  const length = range(rng, 70, 150);
  const R = range(rng, 15, 24);
  const n = 4 + Math.floor(rng() * 4);
  const puffs: (Puff & { y: number })[] = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    const r = R * (0.55 + 0.6 * Math.sin(Math.PI * u)) * range(rng, 0.85, 1.15);
    puffs.push({
      x: (u - 0.5) * length,
      y: r * range(rng, 0.15, 0.4),
      z: range(rng, -0.35, 0.35) * R,
      r,
    });
  }
  /* A couple of towers on top, toward the middle. */
  const tops = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < tops; i++) {
    const r = R * range(rng, 0.5, 0.8);
    puffs.push({
      x: range(rng, -0.25, 0.25) * length,
      y: R * range(rng, 0.7, 1.05),
      z: range(rng, -0.2, 0.2) * R,
      r,
    });
  }
  const parts: THREE.BufferGeometry[] = [];
  for (const p of puffs) {
    const g = new THREE.IcosahedronGeometry(p.r, 1);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      let x = pos.getX(k);
      let y = pos.getY(k);
      let z = pos.getZ(k);
      /* Lumpy, not round: push each corner in or out a little. */
      const bump = 1 + 0.16 * noise((x + p.x) * 0.045, (z + p.z + y) * 0.045);
      x *= bump;
      y *= bump;
      z *= bump;
      x += p.x;
      y += p.y;
      z += p.z;
      /* The flat belly every fair-weather cloud has, where the rising air condenses. */
      y = Math.max(y, 0);
      pos.setXYZ(k, x, y, z);
    }
    parts.push(g);
  }
  let count = 0;
  for (const g of parts) count += g.attributes.position.count;
  const merged = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    merged.set(g.attributes.position.array as Float32Array, o);
    o += g.attributes.position.array.length;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(merged, 3));
  /* Unshared corners: every face lit flat, a facet each. */
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return { geo, puffs: puffs.map(({ x, z, r }) => ({ x, z, r })) };
}

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vBelly;
  void main() {
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vWorld = world.xyz;
    /* How near the flat base this corner is (in the cloud's own height). */
    vBelly = 1.0 - smoothstep(0.0, 10.0, position.y);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  ${GLSL_COMMON}
  uniform vec3 uTop;
  uniform vec3 uShade;
  uniform vec3 uBelly;
  uniform float uFar;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vBelly;

  void main() {
    /* Toward the edge of the wrapped sky a cloud melts into the haze, so it never pops. */
    float d = length(vWorld.xz - cameraPosition.xz);
    float gone = smoothstep(uFar * 0.7, uFar * 0.97, d);

    vec3 n = normalize(vNormal);
    float sun = max(dot(n, uSun), 0.0);
    /* Bright where the sun strikes, violet in the turned-away facets, greyer still underneath. */
    vec3 c = mix(uShade, uTop, smoothstep(0.0, 0.75, sun) * 0.85 + 0.15 * max(n.y, 0.0));
    c = mix(c, uBelly, vBelly * smoothstep(0.2, -0.6, n.y));
    /* Far clouds sink into the haze, but more gently than the ground: they're high in clear air. */
    float f = max(fogFactor(vWorld) * 0.75, gone);
    gl_FragColor = vec4(mix(c, uFogColor, f), 1.0);
  }
`;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

type Cloud = { variant: number; x: number; z: number; y: number; yaw: number; scale: number };

export class Clouds {
  readonly group = new THREE.Group();
  private variants: Variant[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private clouds: Cloud[] = [];
  private material: THREE.ShaderMaterial;
  /* The shadow footprint: a small map round you, redrawn every so often. */
  private shadeData: Uint8Array;
  private shade: THREE.DataTexture;
  private shadeAt = -1;
  private placed: { x: number; z: number; yaw: number; scale: number; variant: number }[] = [];

  static readonly SHADE_SIZE = 2600;
  static readonly SHADE_RES = 256;

  constructor(seed = 0x5eed) {
    for (let v = 0; v < VARIANTS; v++) this.variants.push(heap(seed * 31 + v * 977));
    const rng = mulberry32(seed ^ 0x9e3779b9);
    /* Spread them evenly-ish: one per cell of a jittered grid over the torus. */
    const side = Math.ceil(Math.sqrt(COUNT));
    const cell = SPAN / side;
    for (let i = 0; i < COUNT; i++) {
      const gx = i % side;
      const gz = Math.floor(i / side);
      this.clouds.push({
        variant: Math.floor(rng() * VARIANTS),
        x: (gx + range(rng, 0.1, 0.9)) * cell,
        z: (gz + range(rng, 0.1, 0.9)) * cell,
        y: range(rng, BASE_LO, BASE_HI),
        /* Heaps line up loosely with the wind, as they do. */
        yaw: -0.62 + range(rng, -0.5, 0.5),
        scale: range(rng, 0.75, 1.45),
      });
    }
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        uTop: { value: new THREE.Color(0xffffff) },
        uShade: { value: new THREE.Color(0xd9d2ff) },
        uBelly: { value: new THREE.Color(0xa99ff0) },
        uFar: { value: SPAN / 2 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
    for (let v = 0; v < VARIANTS; v++) {
      const n = this.clouds.filter((c) => c.variant === v).length;
      const mesh = new THREE.InstancedMesh(this.variants[v].geo, this.material, Math.max(1, n));
      mesh.count = n;
      mesh.frustumCulled = false;
      mesh.layers.set(NO_CAST);
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.group.layers.set(NO_CAST);

    const res = Clouds.SHADE_RES;
    this.shadeData = new Uint8Array(res * res);
    this.shade = new THREE.DataTexture(this.shadeData, res, res, THREE.RedFormat);
    this.shade.magFilter = THREE.LinearFilter;
    this.shade.minFilter = THREE.LinearFilter;
    this.shade.wrapS = THREE.ClampToEdgeWrapping;
    this.shade.wrapT = THREE.ClampToEdgeWrapping;
    this.shade.needsUpdate = true;
    shared.uCloudMap.value = this.shade;
  }

  /* Move every cloud to where the wind has carried it by world time t, wrapped round `eye`. */
  update(t: number, eye: THREE.Vector3) {
    const drift = windDrift(t);
    const counts = new Array(VARIANTS).fill(0);
    const wrap = (v: number, c: number) => v - Math.round((v - c) / SPAN) * SPAN;
    this.placed.length = 0;
    for (const c of this.clouds) {
      const x = wrap(c.x + drift.x, eye.x);
      const z = wrap(c.z + drift.z, eye.z);
      tmpQ.setFromAxisAngle(UP, c.yaw);
      tmpM.compose(tmpP.set(x, c.y, z), tmpQ, tmpS.setScalar(c.scale));
      this.meshes[c.variant].setMatrixAt(counts[c.variant]++, tmpM);
      this.placed.push({ x, z, yaw: c.yaw, scale: c.scale, variant: c.variant });
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;

    /* The shade map follows you in whole steps, redrawn twice a second. */
    if (t - this.shadeAt > 0.5 || this.shadeAt < 0) {
      this.shadeAt = t;
      this.drawShade(eye);
    }
  }

  private drawShade(eye: THREE.Vector3) {
    const res = Clouds.SHADE_RES;
    const size = Clouds.SHADE_SIZE;
    const texel = size / res;
    const cx = Math.round(eye.x / texel) * texel;
    const cz = Math.round(eye.z / texel) * texel;
    const data = this.shadeData;
    data.fill(0);
    const x0 = cx - size / 2;
    const z0 = cz - size / 2;
    for (const c of this.placed) {
      const cos = Math.cos(c.yaw);
      const sin = Math.sin(c.yaw);
      for (const p of this.variants[c.variant].puffs) {
        /* The puff's centre on the map; rotation by yaw about +y (three's convention). */
        const px = c.x + (p.x * cos + p.z * sin) * c.scale;
        const pz = c.z + (-p.x * sin + p.z * cos) * c.scale;
        const r = p.r * c.scale * 1.05;
        const i0 = Math.max(0, Math.floor((px - r - x0) / texel));
        const i1 = Math.min(res - 1, Math.ceil((px + r - x0) / texel));
        const j0 = Math.max(0, Math.floor((pz - r - z0) / texel));
        const j1 = Math.min(res - 1, Math.ceil((pz + r - z0) / texel));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const dx = x0 + (i + 0.5) * texel - px;
            const dz = z0 + (j + 0.5) * texel - pz;
            const d = Math.sqrt(dx * dx + dz * dz) / r;
            if (d >= 1) continue;
            /* Soft at the rim, full in the middle. */
            const v = d < 0.55 ? 255 : Math.round(255 * (1 - (d - 0.55) / 0.45));
            const k = j * res + i;
            if (v > data[k]) data[k] = v;
          }
        }
      }
    }
    this.shade.needsUpdate = true;
    shared.uCloudArea.value.set(cx, cz, size, SHADE_ALT);
  }

  dispose() {
    for (const v of this.variants) v.geo.dispose();
    for (const m of this.meshes) m.dispose();
    this.material.dispose();
    this.shade.dispose();
    shared.uCloudMap.value = null;
    shared.uCloudArea.value.set(0, 0, 0, 0);
  }
}
