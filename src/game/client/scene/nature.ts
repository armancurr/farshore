import * as THREE from "three";
import { mulberry32, range } from "../../shared/math";
import { MODEL_BOUNDS, type ModelId } from "../../shared/models.gen";
import { ROAD_HALF } from "../../shared/paths";
import { LEAF_PALETTE, SPECIES_TREES } from "../../shared/nature";
import type { Terrain } from "../../shared/terrain";
import { bakeModel, packMaterial, packOf, paletteUrl } from "./packs";

/*
 * What grows on an island and what people left there, drawn with the KayKit
 * forest and the Kenney kits, recoloured to the world's palette.
 *
 * Trees, rocks and the places' props are the terrain's own (the room
 * collides with them). Grass, shrubs and the stones along the paths are only
 * for looking at, grown here from the island's seed: in clumps, in the
 * meadows and along the edges of the groves, and never on a path. Every model
 * is one instanced mesh per island (per patch, for the small things, which
 * are only drawn near you).
 */

/* Where one copy of a model goes, and how its colour is nudged. */
type Place = {
  x: number;
  y: number;
  z: number;
  rot: number;
  s: number;
  sy?: number;
  tint?: number;
};

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/* The little things come in patches this wide, each drawn only near you. */
const PATCH = 120;
/* Trees and rocks are chunked this wide; past FAR a chunk draws its simplified models. */
const CHUNK = 140;
const FAR = 230;

const GRASS: ModelId[] = [
  "forest/grass-1-b",
  "forest/grass-1-c",
  "forest/grass-2-c",
  "forest/grass-2-d",
];
const SHRUBS: ModelId[] = [
  "forest/bush-1-c",
  "forest/bush-1-f",
  "forest/bush-3-b",
  "forest/bush-4-e",
];
const PEBBLES: ModelId[] = [
  "forest/rock-3-a",
  "forest/rock-3-c",
  "forest/rock-3-e",
  "forest/rock-3-f",
];

export class Nature {
  readonly group = new THREE.Group();
  private patches: { mesh: THREE.InstancedMesh; x: number; z: number; range: number }[] = [];
  private chunks: {
    near: THREE.InstancedMesh;
    far: THREE.InstancedMesh | null;
    x: number;
    z: number;
  }[] = [];
  private disposed = false;

  constructor(private terrain: Terrain) {
    this.plantProps();
    this.setPlaces();
    this.plantDecor();
  }

  /*
   * Trees, rocks and palms, each sized to what the room collides with. They're
   * split into chunks, so the camera (and the sun) can skip the ones out of
   * view, and a chunk far from you swaps to the simplified models.
   */
  private plantProps() {
    type Batch = {
      model: ModelId;
      palette: string;
      fit: "height" | "scale";
      list: Place[];
      cx: number;
      cz: number;
    };
    const batches = new Map<string, Batch>();
    const t = this.terrain;
    const add = (model: ModelId, palette: string, fit: "height" | "scale", p: Place) => {
      const i = Math.floor((p.x - t.ox + t.half) / CHUNK);
      const j = Math.floor((p.z - t.oz + t.half) / CHUNK);
      const key = `${model}|${palette}|${i},${j}`;
      let b = batches.get(key);
      if (!b)
        batches.set(
          key,
          (b = {
            model,
            palette,
            fit,
            list: [],
            cx: t.ox - t.half + (i + 0.5) * CHUNK,
            cz: t.oz - t.half + (j + 0.5) * CHUNK,
          }),
        );
      b.list.push(p);
    };
    for (const p of t.props) {
      if (!p.model) continue;
      if (p.kind === "tree" && p.species) {
        const leaf = SPECIES_TREES[p.species].leaf;
        /* A tree's colour wanders a little from its neighbours'. */
        add(p.model, LEAF_PALETTE[leaf], "height", {
          x: p.x,
          y: p.y,
          z: p.z,
          rot: p.rot,
          s: p.height,
          tint: (p.variant % 1000) / 1000,
        });
      } else {
        add(p.model, paletteUrl(packOf(p.model)), "scale", {
          x: p.x,
          y: p.y,
          z: p.z,
          rot: p.rot,
          s: p.scale,
        });
      }
    }
    for (const b of batches.values()) {
      const far = `${b.model}-far` as ModelId;
      const hasFar = far in MODEL_BOUNDS;
      void Promise.all([bakeModel(b.model), hasFar ? bakeModel(far) : null]).then(([baked, lo]) => {
        if (this.disposed) return;
        /* Trees are sized to their height; everything else is drawn at its scale. */
        const top = baked.min.y + baked.size.y;
        const places =
          b.fit === "height" ? b.list.map((p) => ({ ...p, s: p.s / Math.max(top, 0.01) })) : b.list;
        /* Leaves stir in the wind; rocks don't. */
        const mat = packMaterial(b.palette, b.fit === "height" ? { sway: 0.05 } : {});
        const near = this.instance(baked.geo, mat, places, b.fit === "height");
        this.group.add(near);
        const farMesh = lo ? this.instance(lo.geo, mat, places, b.fit === "height") : null;
        if (farMesh) {
          farMesh.visible = false;
          this.group.add(farMesh);
        }
        this.chunks.push({ near, far: farMesh, x: b.cx, z: b.cz });
      });
    }
  }

  /* The places' props: tents, towers, jetties, stalls. */
  private setPlaces() {
    const byModel = new Map<ModelId, Place[]>();
    for (const pl of this.terrain.places)
      for (const m of pl.models) {
        let list = byModel.get(m.model);
        if (!list) byModel.set(m.model, (list = []));
        list.push({ x: m.x, y: m.y, z: m.z, rot: m.rot, s: m.scale });
      }
    for (const [model, list] of byModel) {
      void bakeModel(model).then((baked) => {
        if (this.disposed) return;
        this.group.add(
          this.instance(baked.geo, packMaterial(paletteUrl(packOf(model))), list, false),
        );
      });
    }
  }

  /* Grass in the meadows, shrubs along the groves and paths, pebbles at the paths' edges. */
  private plantDecor() {
    const t = this.terrain;
    const f = t.flora;
    const rng = mulberry32(t.seed ^ 0x2c9277b5);
    const reach = t.radius * 1.1;
    const area = Math.PI * reach * reach;
    const lh = t.lighthouse;
    type Layer = {
      models: ModelId[];
      palette: string;
      want: (x: number, z: number, path: number) => number;
      per: number;
      clump: [number, number, number];
      scale: [number, number];
      range: number;
      /* Keep this far off the paths. */
      clear: number;
    };
    const teal = LEAF_PALETTE.teal;
    const layers: Layer[] = [
      /* Tussocks in the meadows: thick clumps with open ground between. */
      {
        models: GRASS,
        palette: teal,
        want: (x, z) => f.meadow(x, z) * (1 - 0.7 * f.forest(x, z)),
        per: f.def.grass * 0.3,
        clump: [5, 12, 3.2],
        scale: [1.4, 2.4],
        range: 140,
        clear: ROAD_HALF + 0.6,
      },
      /* Shrubs at the rims of the groves. */
      {
        models: SHRUBS,
        palette: LEAF_PALETTE.coral,
        want: (x, z) => {
          const w = f.forest(x, z);
          return Math.min(1, 4 * w * (1 - w));
        },
        per: 14,
        clump: [2, 5, 3],
        scale: [1.4, 2.6],
        range: 300,
        clear: ROAD_HALF + 1.6,
      },
      /* Flowering shrubs out in the open grass. */
      {
        models: ["forest/bush-1-e", "forest/bush-1-f", "forest/bush-1-g", "forest/bush-3-a"],
        palette: LEAF_PALETTE.peach,
        want: (x, z) => f.meadow(x, z) * (1 - f.forest(x, z)),
        per: t.harbor || t.biome === "meadow" ? 3 : 1.2,
        clump: [2, 4, 2.5],
        scale: [1.5, 2.6],
        range: 260,
        clear: ROAD_HALF + 1.6,
      },
    ];

    const patches = new Map<
      string,
      { range: number; palette: string; models: Map<ModelId, Place[]> }
    >();
    for (const layer of layers) {
      const [lo, hi, spread] = layer.clump;
      const clumps = Math.round(((area / 1000) * layer.per) / ((lo + hi) / 2));
      for (let c = 0; c < clumps; c++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * reach;
        const cx = Math.cos(a) * r;
        const cz = Math.sin(a) * r;
        const pathC = t.pathAt(t.ox + cx, t.oz + cz);
        if (rng() > layer.want(cx, cz, pathC)) continue;
        const n = lo + Math.floor(rng() * (hi - lo + 1));
        const main = layer.models[Math.floor(rng() * layer.models.length)];
        for (let k = 0; k < n; k++) {
          const d = spread * Math.sqrt(-2 * Math.log(1 - rng() * 0.95)) * 0.6;
          const b = rng() * Math.PI * 2;
          const x = t.ox + cx + Math.cos(b) * d;
          const z = t.oz + cz + Math.sin(b) * d;
          const y = t.heightAt(x, z);
          if (y < 2.2 || t.normalAt(x, z)[1] < 0.8) continue;
          if (t.pathAt(x, z) < layer.clear) continue;
          if (Math.hypot(x - lh.x, z - lh.z) < 14) continue;
          if (t.solidsNear(x, z).some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 0.4)) continue;
          if (t.places.some((p) => Math.hypot(p.x - x, p.z - z) < p.r)) continue;
          const model = rng() < 0.75 ? main : layer.models[Math.floor(rng() * layer.models.length)];
          const s = range(rng, layer.scale[0], layer.scale[1]);
          const key = `${layer.range}:${layer.palette}:${Math.floor((x - t.ox + t.half) / PATCH)},${Math.floor((z - t.oz + t.half) / PATCH)}`;
          let patch = patches.get(key);
          if (!patch)
            patches.set(
              key,
              (patch = { range: layer.range, palette: layer.palette, models: new Map() }),
            );
          let list = patch.models.get(model);
          if (!list) patch.models.set(model, (list = []));
          list.push({
            x,
            y: y - 0.04,
            z,
            rot: rng() * Math.PI * 2,
            s,
            sy: s * range(rng, 0.85, 1.2),
            tint: rng(),
          });
        }
      }
    }
    /*
     * The roads' edges, walked rather than scattered: tufts of grass along
     * both verges where walkers don't tread, and the odd stone kicked aside.
     */
    const put = (model: ModelId, palette: string, range: number, p: Place) => {
      const key = `${range}:${palette}:${Math.floor((p.x - t.ox + t.half) / PATCH)},${Math.floor((p.z - t.oz + t.half) / PATCH)}`;
      let patch = patches.get(key);
      if (!patch) patches.set(key, (patch = { range, palette, models: new Map() }));
      let list = patch.models.get(model);
      if (!list) patch.models.set(model, (list = []));
      list.push(p);
    };
    const halfWidth = ROAD_HALF + 0.2;
    for (const line of t.paths) {
      for (let k = 1; k < line.length - 1; k++) {
        const a = line[k - 1];
        const b = line[k + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        /* Across the path: left and right of its direction. */
        const nx = -(b.z - a.z) / len;
        const nz = (b.x - a.x) / len;
        for (const side of [-1, 1]) {
          const r = rng();
          if (r > 0.55) continue;
          const stone = r < 0.06;
          const off = halfWidth + (stone ? range(rng, 0.2, 0.7) : range(rng, 0.8, 2.6));
          const x = line[k].x + nx * side * off + range(rng, -0.6, 0.6);
          const z = line[k].z + nz * side * off + range(rng, -0.6, 0.6);
          const y = t.heightAt(x, z);
          if (y < 2.2 || t.normalAt(x, z)[1] < 0.8) continue;
          if (t.places.some((p) => Math.hypot(p.x - x, p.z - z) < p.r)) continue;
          if (t.solidsNear(x, z).some((so) => Math.hypot(so.x - x, so.z - z) < so.r + 0.3))
            continue;
          if (stone)
            put(PEBBLES[Math.floor(rng() * PEBBLES.length)], paletteUrl("forest"), 130, {
              x,
              y: y - 0.05,
              z,
              rot: rng() * 6.28,
              s: range(rng, 0.35, 0.8),
            });
          else {
            const s = range(rng, 1.1, 2);
            put(GRASS[Math.floor(rng() * GRASS.length)], teal, 150, {
              x,
              y: y - 0.04,
              z,
              rot: rng() * 6.28,
              s,
              sy: s * range(rng, 0.8, 1.25),
              tint: rng(),
            });
          }
        }
      }
    }

    for (const [key, patch] of patches) {
      const [i, j] = key.split(":")[2].split(",").map(Number);
      const cx = t.ox - t.half + (i + 0.5) * PATCH;
      const cz = t.oz - t.half + (j + 0.5) * PATCH;
      for (const [model, places] of patch.models) {
        void bakeModel(model).then((baked) => {
          if (this.disposed) return;
          const mesh = this.instance(
            baked.geo,
            packMaterial(patch.palette, { sway: 0.12 }),
            places,
            true,
          );
          /* Grass and pebbles are too small to throw a shadow worth its cost. */
          mesh.userData.noCast = true;
          mesh.visible = false;
          this.group.add(mesh);
          this.patches.push({ mesh, x: cx, z: cz, range: patch.range });
        });
      }
    }
  }

  private instance(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    places: readonly Place[],
    tinted: boolean,
  ) {
    const mesh = new THREE.InstancedMesh(geo, mat, places.length);
    places.forEach((p, i) => {
      tmpQ.setFromAxisAngle(UP, p.rot);
      tmpM.compose(tmpP.set(p.x, p.y, p.z), tmpQ, tmpS.set(p.s, p.sy ?? p.s, p.s));
      mesh.setMatrixAt(i, tmpM);
      /* Living things vary: a touch lighter or darker, warmer or cooler, each. */
      const k = tinted ? (p.tint ?? 0.5) : 0.5;
      mesh.setColorAt(i, tmpC.setRGB(0.9 + k * 0.16, 0.92 + k * 0.12, 0.94 + (1 - k) * 0.1));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /* Only the patches of small things near you are drawn. */
  update(eye: THREE.Vector3) {
    for (const c of this.chunks) {
      if (!c.far) continue;
      const far = Math.hypot(c.x - eye.x, c.z - eye.z) > FAR + CHUNK * 0.71;
      c.near.visible = !far;
      c.far.visible = far;
    }
    const half = PATCH * 0.71;
    for (const p of this.patches)
      p.mesh.visible = Math.hypot(p.x - eye.x, p.z - eye.z) < p.range + half;
  }

  dispose() {
    this.disposed = true;
    /* Geometry and materials are shared by every island; only the instance buffers are ours. */
    for (const o of this.group.children) (o as THREE.InstancedMesh).dispose?.();
    this.group.clear();
    this.patches = [];
    this.chunks = [];
  }
}
