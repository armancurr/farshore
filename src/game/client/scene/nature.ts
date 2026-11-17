import * as THREE from "three";
import type { BiomeId } from "../../shared/islands";
import { mulberry32, range } from "../../shared/math";
import type { Prop, Terrain } from "../../shared/terrain";
import { PALETTE } from "./materials";
import { flatten, loadModel } from "./models";

/*
 * What grows on an island, drawn with models from the Kenney Nature Kit and
 * recoloured to the world's palette: coral leaves and petals, deep teal bark
 * and grass, lavender stone.
 *
 * Trees and rocks are the terrain's own props (the room collides with them);
 * bushes, grass, flowers and mushrooms are only for looking at, scattered
 * here from the island's seed. Every model is one instanced mesh per island
 * (or per patch of it, for the small things, which are only drawn near you).
 */

const N = "/models/nature/";

/* The pack's materials, by name, to the palette. */
function recolor(name: string): THREE.ColorRepresentation | null {
  const n = name.toLowerCase();
  if (n.startsWith("leafsdark")) return 0xf0726c;
  if (n.startsWith("leafs")) return PALETTE.foliage;
  if (n.startsWith("woodbark")) return PALETTE.bark;
  if (n.startsWith("woodinner")) return PALETTE.whitewash;
  /* Grass a few shades up from the bark, so it reads against the land rather than speckling it. */
  if (n === "grass") return 0x2f7383;
  if (n === "dirt" || n === "stone") return PALETTE.rock;
  if (n.startsWith("color")) return PALETTE.foliage;
  if (n === "_defaultmat") return PALETTE.whitewash;
  return null;
}

type Kind = "harbor" | BiomeId;

/* Which trees and rocks grow where. */
const TREES: Record<Kind, string[]> = {
  harbor: ["tree_default", "tree_oak", "tree_fat", "tree_detailed"],
  meadow: ["tree_oak", "tree_default", "tree_fat", "tree_simple"],
  pinewood: [
    "tree_pineRoundA",
    "tree_pineRoundB",
    "tree_pineRoundC",
    "tree_pineRoundD",
    "tree_pineTallA",
    "tree_pineTallB",
    "tree_pineTallC",
    "tree_cone",
  ],
  ridge: ["tree_pineSmallA", "tree_pineSmallB", "tree_pineTallA", "tree_pineTallC", "tree_cone"],
  marsh: ["tree_thin", "tree_tall", "tree_detailed", "tree_plateau"],
  fells: ["tree_pineGroundA", "tree_pineGroundB", "tree_plateau", "tree_pineSmallA"],
};

const ROCKS: Record<Kind, string[]> = {
  harbor: ["stone_largeA", "stone_largeC", "stone_smallB"],
  meadow: ["rock_largeA", "rock_largeB", "rock_smallA", "rock_smallC"],
  pinewood: ["rock_largeC", "rock_largeD", "rock_tallA", "rock_smallE"],
  ridge: ["rock_tallA", "rock_tallB", "rock_tallC", "rock_tallD", "rock_tallE", "stone_tallA"],
  marsh: ["rock_largeA", "rock_smallA", "rock_smallC", "rock_largeB"],
  fells: ["stone_tallA", "stone_tallB", "stone_tallD", "rock_tallB", "rock_largeD"],
};

/*
 * The little things, in layers. Each grows in clumps where its field is
 * strong: grass in the meadows, bushes and logs along the edges of the
 * groves, mushrooms and ferns under the trees, flowers out in the open grass.
 * `per` is how many per 1000 m² where the field is full; `clump` how many
 * come together and how wide a clump spreads; `range` how near you it's drawn.
 */
type Where = "meadow" | "edge" | "forest" | "open";
type Layer = {
  models: string[];
  where: Where;
  per: number;
  clump: [number, number, number];
  scale: [number, number];
  range: number;
};

const GRASS = ["grass_leafsLarge", "grass_leafs", "grass_leafsLarge", "grass"];
const FLOWERS = [
  "flower_redA",
  "flower_redB",
  "flower_yellowA",
  "flower_yellowC",
  "flower_purpleB",
];
const BUSHES = ["plant_bush", "plant_bushLarge", "plant_bushSmall", "plant_bushDetailed"];

function layers(kind: Kind, grass: number): Layer[] {
  const out: Layer[] = [
    /* Grass: thick tussocks in the meadows, thinning to nothing between them. */
    { models: GRASS, where: "meadow", per: grass, clump: [6, 14, 5], scale: [3, 5.5], range: 190 },
    /* A few stray tufts everywhere, so even bare ground isn't bald. */
    {
      models: GRASS,
      where: "open",
      per: grass * 0.18,
      clump: [1, 3, 3],
      scale: [2.5, 4],
      range: 150,
    },
    /* Bushes gather along the edges of the groves. */
    { models: BUSHES, where: "edge", per: 12, clump: [2, 5, 6], scale: [3.5, 6], range: 320 },
  ];
  /* Flowers come up in drifts among the grass. */
  const flowers = kind === "meadow" || kind === "harbor" ? 22 : kind === "marsh" ? 6 : 9;
  out.push({
    models: FLOWERS,
    where: "meadow",
    per: flowers,
    clump: [5, 12, 4],
    scale: [1.5, 2.3],
    range: 200,
  });
  const floor = kind === "pinewood" || kind === "marsh" ? 7 : 3;
  out.push({
    models: ["mushroom_red", "mushroom_tanGroup", "grass_leafsLarge", "plant_bushTriangle"],
    where: "forest",
    per: floor,
    clump: [2, 5, 4],
    scale: [3, 4.5],
    range: 200,
  });
  out.push({
    models: ["log", "stump_old", "stump_round"],
    where: "edge",
    per: kind === "pinewood" ? 1.6 : 0.7,
    clump: [1, 1, 0],
    scale: [3.5, 5],
    range: 320,
  });
  return out;
}

/* The small things come in patches this wide, each drawn only near you. */
const PATCH = 100;

/* A model from the pack as one geometry (with a group per material) and its materials. */
type Piece = { geo: THREE.BufferGeometry; mats: THREE.Material[]; size: THREE.Vector3 };

const pieces = new Map<string, Promise<Piece>>();

function piece(name: string): Promise<Piece> {
  let p = pieces.get(name);
  if (p) return p;
  p = loadModel(`${N}${name}.glb`).then((gltf) => {
    const root = gltf.scene;
    flatten(root, (n) => recolor(n));
    root.updateMatrixWorld(true);
    /* Bake every mesh into one geometry, a group per material. */
    const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      parts.push({ geo: g, mat: mesh.material as THREE.Material });
    });
    const mats: THREE.Material[] = [];
    const positions: number[] = [];
    const normals: number[] = [];
    const out = new THREE.BufferGeometry();
    let start = 0;
    for (const { geo, mat } of parts) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      const pos = g.attributes.position;
      const nor = g.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        if (nor) normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        else normals.push(0, 1, 0);
      }
      let mi = mats.indexOf(mat);
      if (mi < 0) mi = mats.push(mat) - 1;
      out.addGroup(start, pos.count, mi);
      start += pos.count;
      geo.dispose();
      if (g !== geo) g.dispose();
    }
    out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    out.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    out.computeBoundingBox();
    const size = out.boundingBox!.getSize(new THREE.Vector3());
    /* Stand it on its own floor. */
    out.translate(0, -out.boundingBox!.min.y, 0);
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return { geo: out, mats, size };
  });
  pieces.set(name, p);
  p.catch(() => pieces.delete(name));
  return p;
}

/* Where one copy of a model goes. */
type Place = { x: number; y: number; z: number; rot: number; sx: number; sy: number; sz: number };

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Nature {
  readonly group = new THREE.Group();
  private patches: { mesh: THREE.InstancedMesh; x: number; z: number; range: number }[] = [];
  private disposed = false;

  constructor(private terrain: Terrain) {
    const kind: Kind = terrain.harbor ? "harbor" : (terrain.biome ?? "meadow");
    this.plantProps(kind);
    this.plantDecor(kind);
  }

  /* The terrain's trees and rocks, each a model sized to what the room collides with. */
  private plantProps(kind: Kind) {
    const byModel = new Map<string, { prop: Prop; fit: (s: THREE.Vector3) => Place }[]>();
    const add = (name: string, prop: Prop, fit: (s: THREE.Vector3) => Place) => {
      let list = byModel.get(name);
      if (!list) byModel.set(name, (list = []));
      list.push({ prop, fit });
    };
    for (const p of this.terrain.props) {
      if (p.kind === "tree") {
        const names = TREES[kind];
        add(names[p.variant % names.length], p, (s) => {
          /* As tall as the room thinks it is. */
          const k = p.height / Math.max(s.y, 1e-3);
          return { x: p.x, y: p.y, z: p.z, rot: p.rot, sx: k, sy: k, sz: k };
        });
      } else if (p.kind === "rock") {
        const names = ROCKS[kind];
        add(names[p.variant % names.length], p, (s) => {
          /* As wide as its collision, as tall as its height. */
          const w = (p.scale * 0.82 * 2) / Math.max(s.x, s.z, 1e-3);
          return {
            x: p.x,
            y: p.y,
            z: p.z,
            rot: p.rot,
            sx: w,
            sy: p.height / Math.max(s.y, 1e-3),
            sz: w,
          };
        });
      }
    }
    for (const [name, list] of byModel) {
      void piece(name).then((pc) => {
        if (this.disposed) return;
        const places = list.map((o) => o.fit(pc.size));
        this.group.add(this.instance(pc, places));
      });
    }
  }

  /* Grass, flowers, bushes: grown in clumps over the land, in patches drawn only near you. */
  private plantDecor(kind: Kind) {
    const t = this.terrain;
    const f = t.flora;
    const rng = mulberry32(t.seed ^ 0x2c9277b5);
    const lh = t.lighthouse;
    const reach = t.radius * 1.1;
    const area = Math.PI * reach * reach;
    /* How strongly each layer wants a spot (local coordinates), 0..1. */
    const want: Record<Where, (x: number, z: number) => number> = {
      meadow: (x, z) => f.meadow(x, z),
      edge: (x, z) => {
        const w = f.forest(x, z);
        return Math.min(1, 4 * w * (1 - w) + 0.15 * w);
      },
      forest: (x, z) => f.forest(x, z),
      open: (x, z) => 1 - 0.85 * f.forest(x, z),
    };
    const patches = new Map<string, { range: number; models: Map<string, Place[]> }>();
    for (const layer of layers(kind, f.def.grass)) {
      const [lo, hi, spread] = layer.clump;
      const clumps = Math.round(((area / 1000) * layer.per) / ((lo + hi) / 2));
      const field = want[layer.where];
      for (let c = 0; c < clumps; c++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * reach;
        const cx = Math.cos(a) * r;
        const cz = Math.sin(a) * r;
        if (rng() > field(cx, cz)) continue;
        const n = lo + Math.floor(rng() * (hi - lo + 1));
        /* A clump mostly keeps to one or two kinds. */
        const main = layer.models[Math.floor(rng() * layer.models.length)];
        for (let k = 0; k < n; k++) {
          /* Thick in the middle of the clump, thinner at its edge. */
          const d = spread * Math.sqrt(-2 * Math.log(1 - rng() * 0.95)) * 0.6;
          const b = rng() * Math.PI * 2;
          const x = t.ox + cx + Math.cos(b) * d;
          const z = t.oz + cz + Math.sin(b) * d;
          const y = t.heightAt(x, z);
          if (y < 0.7 || t.normalAt(x, z)[1] < 0.72) continue;
          /* Clear of the lighthouse and anything built or growing there. */
          if (Math.hypot(x - lh.x, z - lh.z) < 12) continue;
          if (t.solidsNear(x, z).some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 0.3)) continue;
          const name = rng() < 0.7 ? main : layer.models[Math.floor(rng() * layer.models.length)];
          const s = range(rng, layer.scale[0], layer.scale[1]);
          const key = `${layer.range}:${Math.floor((x - t.ox + t.half) / PATCH)},${Math.floor((z - t.oz + t.half) / PATCH)}`;
          let patch = patches.get(key);
          if (!patch) patches.set(key, (patch = { range: layer.range, models: new Map() }));
          let list = patch.models.get(name);
          if (!list) patch.models.set(name, (list = []));
          list.push({
            x,
            y: y - 0.05,
            z,
            rot: rng() * Math.PI * 2,
            sx: s,
            sy: s * range(rng, 0.8, 1.25),
            sz: s,
          });
        }
      }
    }
    for (const [key, patch] of patches) {
      const [i, j] = key.split(":")[1].split(",").map(Number);
      const cx = t.ox - t.half + (i + 0.5) * PATCH;
      const cz = t.oz - t.half + (j + 0.5) * PATCH;
      for (const [name, places] of patch.models) {
        void piece(name).then((pc) => {
          if (this.disposed) return;
          const mesh = this.instance(pc, places);
          mesh.visible = false;
          this.group.add(mesh);
          this.patches.push({ mesh, x: cx, z: cz, range: patch.range });
        });
      }
    }
  }

  private instance(pc: Piece, places: readonly Place[]) {
    const mesh = new THREE.InstancedMesh(pc.geo, pc.mats, places.length);
    places.forEach((p, i) => {
      tmpQ.setFromAxisAngle(UP, p.rot);
      tmpM.compose(tmpP.set(p.x, p.y, p.z), tmpQ, tmpS.set(p.sx, p.sy, p.sz));
      mesh.setMatrixAt(i, tmpM);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  /* Only the patches of small things near you are drawn. */
  update(eye: THREE.Vector3) {
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
  }
}
