import * as THREE from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { worldShade } from "./shade";

/*
 * Models from the asset packs (public/models), loaded once and shared. The
 * packs' own materials are swapped for flat Lambert ones lit by the scene's
 * sun and sky, and fogged like everything else.
 */

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const cache = new Map<string, Promise<GLTF>>();

export function loadModel(url: string): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url);
    cache.set(url, p);
    /* A failed load can be tried again later. */
    p.catch(() => cache.delete(url));
  }
  return p;
}

/*
 * Swap every material under `root` for a flat Lambert one. `recolor` can
 * replace a material's colour by its name (foliage, bark, stone); textures
 * are kept, so a textured animal keeps its coat.
 */
export function flatten(
  root: THREE.Object3D,
  recolor?: (name: string, color: THREE.Color) => THREE.ColorRepresentation | null,
) {
  const swapped = new Map<THREE.Material, THREE.Material>();
  const swap = (m: THREE.Material) => {
    let out = swapped.get(m);
    if (out) return out;
    const src = m as THREE.MeshStandardMaterial;
    const color = src.color ? src.color.clone() : new THREE.Color(1, 1, 1);
    const want = recolor?.(m.name ?? "", color);
    out = worldShade(
      new THREE.MeshLambertMaterial({
        name: m.name,
        color: want !== null && want !== undefined ? new THREE.Color(want) : color,
        map: src.map ?? null,
        flatShading: true,
        side: src.side,
        transparent: src.transparent,
        alphaTest: src.alphaTest,
      }),
    );
    swapped.set(m, out);
    return out;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

/* The size of `root` as it stands, bind pose included for skinned meshes. */
export function measure(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  /* Skinned bounds follow the bones, which only move once the skeleton is updated. */
  root.traverse((o) => (o as THREE.SkinnedMesh).skeleton?.update());
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      const sk = mesh as THREE.SkinnedMesh;
      sk.computeBoundingBox();
      tmp.copy(sk.boundingBox!).applyMatrix4(sk.matrixWorld);
    } else {
      mesh.geometry.computeBoundingBox();
      tmp.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
    }
    box.union(tmp);
  });
  return box;
}

export function disposeModel(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
  });
}
