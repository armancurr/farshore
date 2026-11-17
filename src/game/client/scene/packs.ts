import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { MODEL_BOUNDS, type ModelId } from "../../shared/models.gen";
import { loadModel } from "./models";

/*
 * Models from the asset packs built by scripts/build-assets.mjs. A pack's
 * models carry no texture of their own: they share the pack's colour atlas
 * (public/models/<pack>/palette.png, already recoloured to the world's
 * palette), so every model in a pack draws with one material.
 *
 * Every pack material goes through `worldShade`, which is where the world's
 * own lighting (shadows, cloud shade) joins the standard Lambert shading, so
 * a pack model sits in the world like everything else.
 */

const textures = new Map<string, THREE.Texture>();
const texLoader = new THREE.TextureLoader();

/* A pack atlas: nearest-filtered so the colour bands stay crisp, in sRGB, no flip (glTF UVs). */
export function packTexture(url: string) {
  let t = textures.get(url);
  if (!t) {
    t = texLoader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    t.generateMipmaps = true;
    textures.set(url, t);
  }
  return t;
}

type ShadeHook = (shader: THREE.WebGLProgramParametersWithUniforms) => void;
const hooks: ShadeHook[] = [];

/*
 * Register a change every pack material makes to its shader (the world's
 * shadows, say). Materials made before a hook is added pick it up the next
 * time they compile.
 */
export function addShadeHook(hook: ShadeHook) {
  hooks.push(hook);
}

/* Join a material to the world's lighting. Safe to call more than once. */
export function worldShade<M extends THREE.Material>(m: M): M {
  if (m.userData.worldShade) return m;
  m.userData.worldShade = true;
  m.onBeforeCompile = (shader) => {
    for (const h of hooks) h(shader);
  };
  /* Every pack material compiles the same hooks: one program per material kind. */
  m.customProgramCacheKey = () => `world:${hooks.length}`;
  return m;
}

const materials = new Map<string, THREE.MeshLambertMaterial>();

/*
 * The material for a pack, or for one texture of a pack (characters each have
 * their own). `key` names it so callers sharing a texture share a material.
 */
export function packMaterial(
  texture: string,
  opts: { side?: THREE.Side; alphaTest?: number } = {},
) {
  const key = `${texture}|${opts.side ?? THREE.FrontSide}|${opts.alphaTest ?? 0}`;
  let m = materials.get(key);
  if (!m) {
    m = worldShade(
      new THREE.MeshLambertMaterial({
        map: packTexture(texture),
        side: opts.side ?? THREE.FrontSide,
        alphaTest: opts.alphaTest ?? 0,
      }),
    );
    m.name = texture;
    materials.set(key, m);
  }
  return m;
}

export const packOf = (id: ModelId | string) => id.split("/")[0];
export const modelUrl = (id: ModelId | string) => `/models/${id}.glb`;
export const paletteUrl = (pack: string) => `/models/${pack}/palette.png`;

/* The model's bounds in its own units, from the build manifest. */
export function modelBounds(id: ModelId) {
  const b = MODEL_BOUNDS[id];
  return new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
}

/*
 * A fresh copy of a pack model, drawn with its pack's material (or the
 * texture given). Skinned models are cloned with their own skeleton.
 */
export async function packModel(id: ModelId | string, texture?: string): Promise<THREE.Group> {
  const gltf = await loadModel(modelUrl(id));
  const mat = packMaterial(texture ?? paletteUrl(packOf(id)));
  let skinned = false;
  gltf.scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  const root = (skinned ? cloneSkinned(gltf.scene) : gltf.scene.clone(true)) as THREE.Group;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.material = mat;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return root;
}

/*
 * A pack model baked to one geometry (all its meshes in its own frame), for
 * instancing: trees, rocks, props scattered in their hundreds.
 */
export type Baked = { geo: THREE.BufferGeometry; size: THREE.Vector3; min: THREE.Vector3 };
const baked = new Map<string, Promise<Baked>>();

export function bakeModel(id: ModelId | string): Promise<Baked> {
  let p = baked.get(id);
  if (p) return p;
  p = loadModel(modelUrl(id)).then((gltf) => {
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      /* Quantised attributes come back as normalised ints: make them floats to merge. */
      for (const name of Object.keys(g.attributes)) {
        if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
      }
      g.applyMatrix4(mesh.matrixWorld);
      parts.push(g);
    });
    const geo = mergeFloat(parts);
    geo.computeBoundingBox();
    const box = geo.boundingBox as THREE.Box3;
    return { geo, size: box.getSize(new THREE.Vector3()), min: box.min.clone() };
  });
  baked.set(id, p);
  p.catch(() => baked.delete(id));
  return p;
}

function mergeFloat(parts: THREE.BufferGeometry[]) {
  let count = 0;
  for (const g of parts) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of parts) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const u = g.attributes.uv;
    for (let i = 0; i < p.count; i++, o++) {
      pos[o * 3] = p.getX(i);
      pos[o * 3 + 1] = p.getY(i);
      pos[o * 3 + 2] = p.getZ(i);
      if (n) {
        nor[o * 3] = n.getX(i);
        nor[o * 3 + 1] = n.getY(i);
        nor[o * 3 + 2] = n.getZ(i);
      }
      if (u) {
        uv[o * 2] = u.getX(i);
        uv[o * 2 + 1] = u.getY(i);
      }
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return out;
}
