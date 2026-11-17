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

/* The little things: per 1000 m² of land, and what they are. */
type Decor = { models: string[]; per: number; scale: [number, number] };
const DECOR: Record<Kind, Decor[]> = {
  harbor: [
    { models: ["grass", "grass_large", "grass_leafs"], per: 3, scale: [3, 4.5] },
    { models: ["flower_redA", "flower_yellowA", "flower_purpleA"], per: 1, scale: [3, 4] },
    { models: ["plant_bush", "plant_bushDetailed"], per: 0.25, scale: [3.5, 5] },
  ],
  meadow: [
    { models: ["grass", "grass_large", "grass_leafsLarge"], per: 5, scale: [3, 5] },
    {
      models: ["flower_redA", "flower_redB", "flower_yellowA", "flower_yellowC", "flower_purpleB"],
      per: 3,
      scale: [3, 4.5],
    },
    { models: ["plant_bush", "plant_bushLarge", "plant_bushSmall"], per: 0.4, scale: [3.5, 5] },
  ],
  pinewood: [
    { models: ["grass_leafs", "grass_leafsLarge", "grass"], per: 2.5, scale: [3, 4.5] },
    { models: ["mushroom_red", "mushroom_tanGroup"], per: 0.5, scale: [3, 4.5] },
    {
      models: ["plant_bushTriangle", "plant_bushDetailed", "stump_round", "log"],
      per: 0.5,
      scale: [3, 4.5],
    },
  ],
  ridge: [
    { models: ["grass_leafs", "grass"], per: 2, scale: [3, 4] },
    { models: ["plant_bushSmall", "stump_old"], per: 0.25, scale: [3, 4] },
  ],
  marsh: [
    { models: ["grass_large", "grass_leafsLarge", "grass"], per: 4.5, scale: [3.5, 5.5] },
    { models: ["mushroom_red", "mushroom_tanGroup", "flower_purpleA"], per: 1, scale: [3, 4] },
    {
      models: ["plant_bushLarge", "plant_bushDetailed", "log", "stump_old"],
      per: 0.5,
      scale: [3.5, 5],
    },
  ],
  fells: [
    { models: ["grass_leafs", "grass"], per: 2, scale: [3, 4] },
    { models: ["flower_yellowA", "flower_redB"], per: 0.5, scale: [3, 4] },
    { models: ["plant_bushSmall"], per: 0.2, scale: [3, 4] },
  ],
};

/* The small things come in patches this wide, drawn only near you. */
const PATCH = 160;
const DECOR_RANGE = 230;

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
  private patches: { mesh: THREE.InstancedMesh; x: number; z: number }[] = [];
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

  /* Grass, flowers, bushes: scattered over the land, in patches drawn only near you. */
  private plantDecor(kind: Kind) {
    const t = this.terrain;
    const rng = mulberry32(t.seed ^ 0x2c9277b5);
    const lh = t.lighthouse;
    /* Land area, roughly: the shape's radius squared. */
    const area = Math.PI * (t.radius * 1.05) ** 2;
    const patches = new Map<string, Map<string, Place[]>>();
    for (const d of DECOR[kind]) {
      const count = Math.round((area / 1000) * d.per);
      for (let i = 0, tries = 0; i < count && tries < count * 4; tries++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * t.radius * 1.1;
        const x = t.ox + Math.cos(a) * r;
        const z = t.oz + Math.sin(a) * r;
        const y = t.heightAt(x, z);
        if (y < 0.7 || t.normalAt(x, z)[1] < 0.72) continue;
        /* Clear of the lighthouse and anything built or growing there. */
        if (Math.hypot(x - lh.x, z - lh.z) < 12) continue;
        if (t.solidsNear(x, z).some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 0.4)) continue;
        i++;
        const name = d.models[Math.floor(rng() * d.models.length)];
        const k = range(rng, d.scale[0], d.scale[1]);
        const key = `${Math.floor((x - t.ox + t.half) / PATCH)},${Math.floor((z - t.oz + t.half) / PATCH)}`;
        let patch = patches.get(key);
        if (!patch) patches.set(key, (patch = new Map()));
        let list = patch.get(name);
        if (!list) patch.set(name, (list = []));
        list.push({ x, y: y - 0.05, z, rot: rng() * Math.PI * 2, sx: k, sy: k, sz: k });
      }
    }
    for (const [key, patch] of patches) {
      const [i, j] = key.split(",").map(Number);
      const cx = t.ox - t.half + (i + 0.5) * PATCH;
      const cz = t.oz - t.half + (j + 0.5) * PATCH;
      for (const [name, places] of patch) {
        void piece(name).then((pc) => {
          if (this.disposed) return;
          const mesh = this.instance(pc, places);
          mesh.visible = false;
          this.group.add(mesh);
          this.patches.push({ mesh, x: cx, z: cz });
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
    const reach = DECOR_RANGE + PATCH * 0.71;
    for (const p of this.patches) p.mesh.visible = Math.hypot(p.x - eye.x, p.z - eye.z) < reach;
  }

  dispose() {
    this.disposed = true;
    /* Geometry and materials are shared by every island; only the instance buffers are ours. */
    for (const o of this.group.children) (o as THREE.InstancedMesh).dispose?.();
    this.group.clear();
    this.patches = [];
  }
}
