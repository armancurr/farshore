import * as THREE from "three";
import { NO_CAST } from "./shadows";

/*
 * Fire, smoke, sparks and dust, and the bangs of kegs and guns: camera-facing sprites from the Kenney
 * particle packs (public/fx), packed into one atlas and drawn as two
 * instanced meshes, one glowing (added on top: flames, embers, sparks) and
 * one see-through (smoke, steam, dust, splinters). Every particle lives in a
 * fixed pool and is moved on the CPU, so the whole lot is two draw calls
 * whatever is burning, and a full pool simply takes no more.
 */

/* The atlas, four across and three down, in this order. */
const SPRITES = [
  "fire-01",
  "flame-06",
  "circle-05",
  "star-04",
  "smoke-black-2",
  "puff-1",
  "dirt-01",
  "smoke-07",
  "explosion-1",
  "muzzle-01",
  "flash-1",
  "smoke-02",
] as const;
const FRAME = Object.fromEntries(SPRITES.map((s, i) => [s, i])) as Record<
  (typeof SPRITES)[number],
  number
>;
const COLS = 4;
const ROWS = 3;
const CELL = 128;

let atlas: THREE.CanvasTexture | null = null;

function atlasTexture() {
  if (atlas) return atlas;
  const canvas = document.createElement("canvas");
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ctx = canvas.getContext("2d");
  SPRITES.forEach((name, i) => {
    const img = new Image();
    img.onload = () => {
      ctx?.drawImage(img, (i % COLS) * CELL, Math.floor(i / COLS) * CELL, CELL, CELL);
      tex.needsUpdate = true;
    };
    img.src = `/fx/${name}.png`;
  });
  atlas = tex;
  return tex;
}

const VERTEX = /* glsl */ `
  attribute vec3 aPos;
  attribute vec2 aSizeRot;
  attribute vec4 aColor;
  attribute float aFrame;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
    float c = cos(aSizeRot.y);
    float s = sin(aSizeRot.y);
    vec2 q = position.xy * aSizeRot.x;
    mv.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c);
    gl_Position = projectionMatrix * mv;
    float col = mod(aFrame, ${COLS}.0);
    float row = ${ROWS - 1}.0 - floor(aFrame / ${COLS}.0);
    vUv = (vec2(col, row) + uv) / vec2(${COLS}.0, ${ROWS}.0);
    vColor = aColor;
    /* Far off it thins away rather than glowing through the haze. */
    vFade = 1.0 - smoothstep(170.0, 300.0, length(mv.xyz));
  }
`;

const GLOW = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFade;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * vColor.a * vFade;
    gl_FragColor = vec4(vColor.rgb * t.rgb * a, a);
  }
`;

const VEIL = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFade;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * vColor.a * vFade;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor.rgb * t.rgb, a);
  }
`;

/* One particle's start: where, how it moves, how big, what colour, how long. */
type Spawn = {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  /* Its size at the end of its life, as a multiple of the start. */
  grow?: number;
  frame: number;
  r: number;
  g: number;
  b: number;
  a: number;
  /* Upward pull (negative: it falls), and how quickly it takes up the wind (0: never). */
  lift?: number;
  drift?: number;
  spin?: number;
};

/* A pool of sprites drawn in one call, moved here each frame. */
class Pool {
  readonly mesh: THREE.Mesh;
  private n = 0;
  private readonly sim: Float32Array;
  private readonly pos: THREE.InstancedBufferAttribute;
  private readonly sizeRot: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly frame: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.InstancedBufferGeometry;

  /* Per particle: x y z, vx vy vz, age life, size grow, rot spin, r g b a, lift drift. */
  private static readonly F = 18;

  constructor(
    readonly cap: number,
    glow: boolean,
  ) {
    this.sim = new Float32Array(cap * Pool.F);
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute("position", quad.getAttribute("position"));
    geo.setAttribute("uv", quad.getAttribute("uv"));
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.sizeRot = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.frame = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    for (const a of [this.pos, this.sizeRot, this.color, this.frame])
      a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aPos", this.pos);
    geo.setAttribute("aSizeRot", this.sizeRot);
    geo.setAttribute("aColor", this.color);
    geo.setAttribute("aFrame", this.frame);
    geo.instanceCount = 0;
    this.geo = geo;
    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: atlasTexture() } },
      vertexShader: VERTEX,
      fragmentShader: glow ? GLOW : VEIL,
      transparent: true,
      depthWrite: false,
      blending: glow ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = glow ? 6 : 5;
    this.mesh.layers.set(NO_CAST);
  }

  get count() {
    return this.n;
  }

  get room() {
    return this.cap - this.n;
  }

  add(p: Spawn) {
    if (this.n >= this.cap) return;
    const o = this.n++ * Pool.F;
    const s = this.sim;
    s[o] = p.x;
    s[o + 1] = p.y;
    s[o + 2] = p.z;
    s[o + 3] = p.vx ?? 0;
    s[o + 4] = p.vy ?? 0;
    s[o + 5] = p.vz ?? 0;
    s[o + 6] = 0;
    s[o + 7] = p.life;
    s[o + 8] = p.size;
    s[o + 9] = p.grow ?? 1;
    s[o + 10] = Math.random() * Math.PI * 2;
    s[o + 11] = p.spin ?? (Math.random() - 0.5) * 1.2;
    s[o + 12] = p.r;
    s[o + 13] = p.g;
    s[o + 14] = p.b;
    s[o + 15] = p.a;
    s[o + 16] = p.lift ?? 0;
    s[o + 17] = p.drift ?? 0;
    this.frame.array[this.n - 1] = p.frame;
  }

  update(dt: number, wx: number, wz: number) {
    const s = this.sim;
    const F = Pool.F;
    const pos = this.pos.array as Float32Array;
    const sr = this.sizeRot.array as Float32Array;
    const col = this.color.array as Float32Array;
    const fr = this.frame.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      let o = i * F;
      s[o + 6] += dt;
      if (s[o + 6] >= s[o + 7]) {
        /* Done: the last one takes its place. */
        const last = --this.n;
        if (i !== last) {
          s.copyWithin(o, last * F, last * F + F);
          fr[i] = fr[last];
        }
        i--;
        continue;
      }
      o = i * F;
      const drift = s[o + 17];
      if (drift > 0) {
        const k = Math.min(1, drift * dt);
        s[o + 3] += (wx - s[o + 3]) * k;
        s[o + 5] += (wz - s[o + 5]) * k;
      }
      s[o + 4] += s[o + 16] * dt;
      s[o] += s[o + 3] * dt;
      s[o + 1] += s[o + 4] * dt;
      s[o + 2] += s[o + 5] * dt;
      s[o + 10] += s[o + 11] * dt;
      const t = s[o + 6] / s[o + 7];
      /* In quickly, out slowly. */
      const env = Math.min(1, t * 7) * (1 - t) ** 1.3;
      pos[i * 3] = s[o];
      pos[i * 3 + 1] = s[o + 1];
      pos[i * 3 + 2] = s[o + 2];
      sr[i * 2] = s[o + 8] * (1 + (s[o + 9] - 1) * t);
      sr[i * 2 + 1] = s[o + 10];
      col[i * 4] = s[o + 12];
      col[i * 4 + 1] = s[o + 13];
      col[i * 4 + 2] = s[o + 14];
      col[i * 4 + 3] = s[o + 15] * env;
    }
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    for (const a of [this.pos, this.sizeRot, this.color, this.frame]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/* Something burning (or smouldering), as the effects need it: its footprint, height and heading. */
export type Blaze = {
  x: number;
  y: number;
  z: number;
  hx: number;
  hz: number;
  top: number;
  rot: number;
  /* Smouldering, after it burnt down: smoke only, thinning out. */
  smoulder: number;
  /* Particles owed but not yet spawned, so slow rates still come out right. */
  acc: [number, number, number, number];
};

export class Fx {
  readonly group = new THREE.Group();
  private glow = new Pool(1400, true);
  private veil = new Pool(1100, false);
  private wind = { x: 0, z: 0 };

  constructor() {
    this.group.add(this.veil.mesh, this.glow.mesh);
    this.group.layers.set(NO_CAST);
  }

  setWind(x: number, z: number) {
    this.wind.x = x;
    this.wind.z = z;
  }

  update(dt: number) {
    this.glow.update(dt, this.wind.x, this.wind.z);
    this.veil.update(dt, this.wind.x * 0.75, this.wind.z * 0.75);
  }

  /* A point on a footprint, in the world. */
  private on(b: Blaze, spread = 0.85) {
    return this.local(
      b,
      (Math.random() * 2 - 1) * b.hx * spread,
      (Math.random() * 2 - 1) * b.hz * spread,
    );
  }

  /* A point round a footprint's edge, just outside its walls, where flames can be seen. */
  private rim(b: Blaze) {
    const side = Math.random() * 2 * (b.hx + b.hz);
    const u = Math.random() * 2 - 1;
    const out = 1.05;
    if (side < 2 * b.hx) return this.local(b, u * b.hx, (side < b.hx ? 1 : -1) * b.hz * out);
    return this.local(b, (side < 2 * b.hx + b.hz ? 1 : -1) * b.hx * out, u * b.hz);
  }

  private local(b: Blaze, lx: number, lz: number) {
    const c = Math.cos(b.rot);
    const s = Math.sin(b.rot);
    return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
  }

  /*
   * A frame's worth of a fire: flames licking over it, a glow, embers
   * going up and a dark column of smoke leaning downwind. `lod` (0..1)
   * thins it out with distance.
   */
  burn(b: Blaze, dt: number, lod: number) {
    if (lod <= 0) return;
    const area = Math.min(70, Math.max(1, b.hx * b.hz * 4));
    const big = Math.min(3.2, Math.max(0.9, Math.min(b.hx, b.hz) * 0.85 + 0.4));
    const top = Math.max(1, b.top);
    const burning = b.smoulder <= 0;
    /* Flames, glow, embers, smoke, a second. */
    const rates = burning
      ? [Math.min(70, 10 + area * 1.4), 6, 3 + area * 0.2, 1.6 + area * 0.1]
      : [0, 0, 0.6, 0.6 + area * 0.04 * b.smoulder];
    for (let k = 0; k < 4; k++) {
      b.acc[k] += rates[k] * dt * lod;
      while (b.acc[k] >= 1) {
        b.acc[k] -= 1;
        this.part(k, b, big, top);
      }
    }
  }

  private part(k: number, b: Blaze, big: number, top: number) {
    const at = this.on(b, k === 3 ? 0.4 : 0.85);
    if (k === 0) {
      /* Up the walls (outside them, so they show) and over the roof. */
      const roof = Math.random() < 0.35;
      const p = roof ? this.on(b, 0.6) : this.rim(b);
      const h = roof ? top * rand(0.7, 1) : top * (0.05 + 0.8 * Math.random() ** 1.4);
      const tongue = Math.random() < 0.45;
      this.glow.add({
        x: p.x,
        y: b.y + h,
        z: p.z,
        vy: rand(1.4, 2.8),
        life: rand(0.55, 1),
        size: big * rand(1, 1.7) * (tongue ? 0.85 : 1),
        grow: 0.5,
        frame: tongue ? FRAME["flame-06"] : FRAME["fire-01"],
        r: 2.2,
        g: rand(0.6, 1.1),
        b: 0.12,
        a: 1,
        lift: 1.5,
        drift: 0.3,
        spin: tongue ? 0 : undefined,
      });
    } else if (k === 1) {
      this.glow.add({
        x: b.x,
        y: b.y + top * 0.35,
        z: b.z,
        life: 0.45,
        size: Math.max(b.hx, b.hz) * 3 + 2,
        frame: FRAME["circle-05"],
        r: 1,
        g: 0.35,
        b: 0.08,
        a: 0.35,
      });
    } else if (k === 2) {
      this.glow.add({
        x: at.x,
        y: b.y + top * rand(0.4, 1),
        z: at.z,
        vx: rand(-1, 1),
        vy: rand(2.5, 5.5),
        vz: rand(-1, 1),
        life: rand(1.4, 3),
        size: rand(0.08, 0.16),
        frame: FRAME["circle-05"],
        r: 1,
        g: rand(0.45, 0.7),
        b: 0.15,
        a: 1,
        lift: -0.4,
        drift: 0.6,
      });
    } else {
      const thin = b.smoulder > 0;
      this.veil.add({
        x: at.x,
        y: b.y + top * (thin ? 0.3 : 0.85),
        z: at.z,
        vx: rand(-0.4, 0.4),
        vy: rand(2, 3.2),
        vz: rand(-0.4, 0.4),
        life: rand(5, 8.5),
        size: big * rand(1.4, 2),
        grow: rand(2.6, 3.6),
        frame: thin ? FRAME["smoke-07"] : FRAME["smoke-black-2"],
        r: thin ? 0.35 : 0.16,
        g: thin ? 0.34 : 0.15,
        b: thin ? 0.33 : 0.14,
        a: thin ? 0.3 : 0.55,
        lift: -0.12,
        drift: 0.35,
      });
    }
  }

  /* A blow landing on something built: splinters and a little dust off wood, sparks off stone. */
  strike(x: number, y: number, z: number, stone: boolean, strength = 1) {
    const n = Math.round(6 + 6 * Math.min(1, strength));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(2, 5);
      if (stone)
        this.glow.add({
          x,
          y,
          z,
          vx: Math.cos(a) * v,
          vy: rand(1.5, 4.5),
          vz: Math.sin(a) * v,
          life: rand(0.2, 0.45),
          size: rand(0.12, 0.26),
          frame: FRAME["star-04"],
          r: 1,
          g: 0.75,
          b: 0.35,
          a: 1,
          lift: -12,
          spin: 0,
        });
      else
        this.veil.add({
          x,
          y,
          z,
          vx: Math.cos(a) * v * 0.7,
          vy: rand(1.5, 4),
          vz: Math.sin(a) * v * 0.7,
          life: rand(0.45, 0.8),
          size: rand(0.18, 0.32),
          frame: FRAME["dirt-01"],
          r: 0.42,
          g: 0.28,
          b: 0.15,
          a: 1,
          lift: -14,
          spin: rand(-8, 8),
        });
    }
    this.veil.add({
      x,
      y,
      z,
      vy: 0.6,
      life: 0.7,
      size: 0.6,
      grow: 2.4,
      frame: FRAME["puff-1"],
      r: stone ? 0.55 : 0.5,
      g: stone ? 0.53 : 0.42,
      b: stone ? 0.5 : 0.32,
      a: 0.45,
    });
  }

  /* Something coming down: a cloud of dust over its footprint and chunks flung out (and sparks, if it burnt). */
  collapse(b: Blaze, burnt: boolean) {
    const area = Math.min(60, Math.max(1, b.hx * b.hz * 4));
    const top = Math.max(1, b.top);
    const puffs = Math.round(Math.min(40, 8 + area * 0.6));
    for (let i = 0; i < puffs; i++) {
      const at = this.on(b, 1);
      const dx = at.x - b.x;
      const dz = at.z - b.z;
      const d = Math.hypot(dx, dz) || 1;
      this.veil.add({
        x: at.x,
        y: b.y + top * rand(0.05, 0.5),
        z: at.z,
        vx: (dx / d) * rand(1, 3),
        vy: rand(0.4, 1.6),
        vz: (dz / d) * rand(1, 3),
        life: rand(2.5, 4.5),
        size: rand(1.4, 2.6) * Math.min(2, 0.6 + Math.sqrt(area) * 0.12),
        grow: 2.6,
        frame: FRAME["puff-1"],
        r: burnt ? 0.22 : 0.6,
        g: burnt ? 0.21 : 0.55,
        b: burnt ? 0.2 : 0.47,
        a: 0.55,
        lift: -0.3,
        drift: 0.15,
      });
    }
    for (let i = 0; i < Math.min(24, 8 + area * 0.4); i++) {
      const at = this.on(b, 0.7);
      const a = Math.random() * Math.PI * 2;
      const v = rand(2, 6);
      this.veil.add({
        x: at.x,
        y: b.y + top * rand(0.2, 0.8),
        z: at.z,
        vx: Math.cos(a) * v,
        vy: rand(2, 6),
        vz: Math.sin(a) * v,
        life: rand(0.8, 1.4),
        size: rand(0.3, 0.6),
        frame: FRAME["dirt-01"],
        r: burnt ? 0.12 : 0.45,
        g: burnt ? 0.1 : 0.36,
        b: burnt ? 0.09 : 0.28,
        a: 1,
        lift: -16,
        spin: rand(-6, 6),
      });
    }
    if (burnt)
      for (let i = 0; i < 30; i++) {
        const at = this.on(b, 0.9);
        this.glow.add({
          x: at.x,
          y: b.y + top * rand(0.1, 0.6),
          z: at.z,
          vx: rand(-2, 2),
          vy: rand(3, 8),
          vz: rand(-2, 2),
          life: rand(1, 2.4),
          size: rand(0.1, 0.2),
          frame: FRAME["circle-05"],
          r: 1,
          g: 0.55,
          b: 0.15,
          a: 1,
          lift: -2,
          drift: 0.5,
        });
      }
  }

  /* Water on a fire: a burst of white steam over it. */
  steam(b: Blaze) {
    const top = Math.max(1, b.top);
    const n = Math.round(Math.min(30, 10 + b.hx * b.hz));
    for (let i = 0; i < n; i++) {
      const at = this.on(b, 0.8);
      this.veil.add({
        x: at.x,
        y: b.y + top * rand(0.2, 0.9),
        z: at.z,
        vx: rand(-0.6, 0.6),
        vy: rand(1.5, 3.5),
        vz: rand(-0.6, 0.6),
        life: rand(1.6, 3),
        size: rand(1, 2),
        grow: 3,
        frame: FRAME["puff-1"],
        r: 0.92,
        g: 0.94,
        b: 0.96,
        a: 0.5,
        drift: 0.4,
      });
    }
  }

  /*
   * A keg (or a cannonball, or a stone) going off: a flash, a fireball
   * rolling up into black smoke, and chunks and sparks thrown out. `size`
   * is the blast's reach.
   */
  explode(x: number, y: number, z: number, size: number, wet = false) {
    const k = Math.max(0.4, size / 6);
    this.glow.add({
      x,
      y: y + 0.6 * k,
      z,
      life: 0.18,
      size: 9 * k,
      grow: 1.4,
      frame: FRAME["flash-1"],
      r: 1.6,
      g: 1.2,
      b: 0.7,
      a: 1,
    });
    for (let i = 0; i < Math.round(10 * k + 4); i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(1, 4) * k;
      this.glow.add({
        x: x + Math.cos(a) * rand(0, 1) * k,
        y: y + rand(0.2, 1.6) * k,
        z: z + Math.sin(a) * rand(0, 1) * k,
        vx: Math.cos(a) * v,
        vy: rand(1.5, 4) * k,
        vz: Math.sin(a) * v,
        life: rand(0.45, 0.8),
        size: rand(2.4, 4) * k,
        grow: 1.8,
        frame: FRAME["explosion-1"],
        r: 2,
        g: rand(0.7, 1.1),
        b: 0.25,
        a: 1,
        lift: -1,
      });
    }
    for (let i = 0; i < Math.round(14 * k + 4); i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(1.5, 4.5) * k;
      this.veil.add({
        x: x + Math.cos(a) * rand(0, 1.5) * k,
        y: y + rand(0.5, 2.5) * k,
        z: z + Math.sin(a) * rand(0, 1.5) * k,
        vx: Math.cos(a) * v,
        vy: rand(1.5, 4) * k,
        vz: Math.sin(a) * v,
        life: rand(2.5, 5),
        size: rand(2.2, 3.6) * k,
        grow: 2.4,
        frame: wet ? FRAME["puff-1"] : FRAME["smoke-black-2"],
        r: wet ? 0.9 : 0.2,
        g: wet ? 0.92 : 0.19,
        b: wet ? 0.95 : 0.18,
        a: wet ? 0.6 : 0.75,
        lift: -0.4,
        drift: 0.3,
      });
    }
    for (let i = 0; i < Math.round(16 * k + 6); i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(4, 11) * k;
      const spark = i % 2 === 0;
      const p = {
        x,
        y: y + 0.4,
        z,
        vx: Math.cos(a) * v,
        vy: rand(3, 10) * k,
        vz: Math.sin(a) * v,
        life: rand(0.6, 1.3),
        size: spark ? rand(0.1, 0.2) : rand(0.25, 0.5) * k,
        lift: -16,
        spin: rand(-8, 8),
      };
      if (spark) this.glow.add({ ...p, frame: FRAME["circle-05"], r: 1, g: 0.6, b: 0.2, a: 1 });
      else
        this.veil.add({
          ...p,
          frame: FRAME["dirt-01"],
          r: wet ? 0.75 : 0.3,
          g: wet ? 0.8 : 0.24,
          b: wet ? 0.85 : 0.18,
          a: 1,
        });
    }
  }

  /* A gun going off: a flash at the muzzle and a cloud of white smoke rolling out the way it fired. */
  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number, size = 1) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    this.glow.add({
      x: x + ux * 0.4 * size,
      y: y + uy * 0.4 * size,
      z: z + uz * 0.4 * size,
      life: 0.12,
      size: 2.2 * size,
      frame: FRAME["muzzle-01"],
      r: 1.6,
      g: 1.1,
      b: 0.5,
      a: 1,
    });
    for (let i = 0; i < Math.round(8 * size + 2); i++) {
      const v = rand(1.5, 5) * size;
      this.veil.add({
        x: x + ux * rand(0.3, 1.2),
        y: y + uy * rand(0.3, 1.2),
        z: z + uz * rand(0.3, 1.2),
        vx: ux * v + rand(-0.5, 0.5),
        vy: uy * v + rand(0.2, 1),
        vz: uz * v + rand(-0.5, 0.5),
        life: rand(1.5, 3),
        size: rand(0.8, 1.6) * size,
        grow: 2.6,
        frame: FRAME["puff-1"],
        r: 0.9,
        g: 0.9,
        b: 0.88,
        a: 0.55,
        lift: 0.2,
        drift: 0.35,
      });
    }
  }

  /* A lit fuse: a spit of sparks and a wisp of smoke, a frame at a time. */
  fuse(x: number, y: number, z: number, dt: number) {
    if (Math.random() < dt * 40)
      this.glow.add({
        x,
        y,
        z,
        vx: rand(-1.5, 1.5),
        vy: rand(1, 3),
        vz: rand(-1.5, 1.5),
        life: rand(0.2, 0.4),
        size: rand(0.06, 0.14),
        frame: FRAME["star-04"],
        r: 1,
        g: 0.75,
        b: 0.3,
        a: 1,
        lift: -6,
        spin: 0,
      });
    if (Math.random() < dt * 6)
      this.veil.add({
        x,
        y,
        z,
        vy: 0.8,
        life: 1.2,
        size: 0.25,
        grow: 3,
        frame: FRAME["smoke-07"],
        r: 0.6,
        g: 0.6,
        b: 0.6,
        a: 0.4,
        drift: 0.4,
      });
  }

  /* A burning arrow in flight: a flicker at its head and a thread of embers behind. */
  ember(x: number, y: number, z: number) {
    this.glow.add({
      x,
      y,
      z,
      life: 0.16,
      size: rand(0.25, 0.4),
      frame: FRAME["flame-06"],
      r: 2,
      g: 0.8,
      b: 0.15,
      a: 1,
      spin: 0,
    });
  }

  /* Something into the sea: a spout of spray. */
  splash(x: number, z: number, size = 1) {
    for (let i = 0; i < Math.round(6 + 10 * size); i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(0.5, 2) * size;
      this.veil.add({
        x,
        y: 0.1,
        z,
        vx: Math.cos(a) * v,
        vy: rand(3, 7) * Math.sqrt(size),
        vz: Math.sin(a) * v,
        life: rand(0.6, 1.1),
        size: rand(0.3, 0.7) * size,
        grow: 2,
        frame: FRAME["puff-1"],
        r: 0.92,
        g: 0.96,
        b: 1,
        a: 0.7,
        lift: -12,
      });
    }
  }

  /* A smoke bomb's cloud, a frame at a time: thick grey billows that hang where it burst. */
  cloud(x: number, y: number, z: number, radius: number, dt: number, thin: number) {
    const rate = 22 * thin;
    let n = rate * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius * 0.85;
      this.veil.add({
        x: x + Math.cos(a) * r,
        y: y + rand(0.2, radius * 0.7),
        z: z + Math.sin(a) * r,
        vx: rand(-0.3, 0.3),
        vy: rand(0.1, 0.5),
        vz: rand(-0.3, 0.3),
        life: rand(2.5, 4),
        size: rand(2.6, 4.2),
        grow: 1.6,
        frame: FRAME["puff-1"],
        r: 0.7,
        g: 0.71,
        b: 0.74,
        a: 0.85,
        drift: 0.05,
      });
    }
  }

  dispose() {
    this.glow.dispose();
    this.veil.dispose();
    this.group.clear();
  }
}
