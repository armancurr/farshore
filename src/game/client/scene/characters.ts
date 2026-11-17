import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { PLAYER_HEIGHT } from "../../shared/constants";
import { type CharacterId, type SkinId, skinDef, skinTexture } from "../../shared/skins";
import { loadModel } from "./models";
import { packMaterial } from "./packs";

/*
 * The player characters: KayKit adventurers and skeletons, all on the one
 * medium rig, so every character plays the same clips (public/models/anims/
 * player.glb). A character is loaded once and copied per player; the copies
 * share geometry and, per livery, one material.
 */

const charUrl = (c: CharacterId) => `/models/characters/${c}.glb`;
const textureUrl = (name: string) => `/models/characters/${name}.png`;
export const PLAYER_ANIMS = "/models/anims/player.glb";

/*
 * How much the KayKit rig is scaled to make a person PLAYER_HEIGHT tall. The
 * characters stand about 2.2 rig units to the top of the hair (hats and
 * helmets sit above), every one on the same skeleton, so they share it.
 */
export const CHARACTER_SCALE = PLAYER_HEIGHT / 2.2;

/*
 * The bones the game moves or hangs things on. GLTFLoader drops the dots
 * from bone names, so "handslot.r" is "handslotr".
 */
export type Bones = {
  hips: THREE.Bone;
  chest: THREE.Bone;
  head: THREE.Bone;
  handR: THREE.Bone;
  handL: THREE.Bone;
};

export type Character = {
  /* Stands on the origin facing -z, PLAYER_HEIGHT tall. */
  root: THREE.Group;
  /* The skinned model inside it: what the animation mixer drives. */
  model: THREE.Object3D;
  bones: Bones;
};

/* Every piece of a character goes through this: the game's ink and shadows, one material per livery. */
function dress(model: THREE.Object3D, skin: SkinId) {
  const def = skinDef(skin);
  const mat = packMaterial(textureUrl(skinTexture(skin)));
  const hide = new Set<string>(def.hide ?? []);
  model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.material = mat;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    /* A skinned mesh's bounds are its bind pose: an arm swung out would cull the body. */
    mesh.frustumCulled = false;
    mesh.visible = !hide.has(mesh.name.split("_").pop() ?? "");
  });
}

function bone(model: THREE.Object3D, name: string) {
  const b = model.getObjectByName(name);
  if (!b) throw new Error(`character has no ${name} bone`);
  return b as THREE.Bone;
}

/* A fresh copy of a skin's character, standing ready to animate. */
export async function buildCharacter(skin: SkinId): Promise<Character> {
  const gltf = await loadModel(charUrl(skinDef(skin).character));
  const model = cloneSkinned(gltf.scene);
  dress(model, skin);
  model.scale.setScalar(CHARACTER_SCALE);
  /* KayKit faces +z; the game's forward is -z. */
  model.rotation.y = Math.PI;
  const root = new THREE.Group();
  root.add(model);
  return {
    root,
    model,
    bones: {
      hips: bone(model, "hips"),
      chest: bone(model, "chest"),
      head: bone(model, "head"),
      handR: bone(model, "handslotr"),
      handL: bone(model, "handslotl"),
    },
  };
}

/* Geometry and materials are shared and stay; only each copy's bone texture goes. */
export function disposeCharacter(c: Character) {
  c.root.removeFromParent();
  c.model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) mesh.skeleton.dispose();
  });
}

/* ---------- clips ---------- */

/* The bones below the waist: the legs keep walking while the arms swing a sword. */
const LOWER = new Set([
  "root",
  "hips",
  "upperlegl",
  "upperlegr",
  "lowerlegl",
  "lowerlegr",
  "footl",
  "footr",
  "toesl",
  "toesr",
]);

/* Each clip, split at the waist. */
export type ClipHalves = { lower: THREE.AnimationClip; upper: THREE.AnimationClip };

let clips: Promise<Map<string, ClipHalves>> | null = null;

export function playerClips(): Promise<Map<string, ClipHalves>> {
  if (!clips) {
    clips = loadModel(PLAYER_ANIMS).then((gltf) => {
      const out = new Map<string, ClipHalves>();
      for (const clip of gltf.animations) {
        const lower = clip.tracks.filter((t) => LOWER.has(t.name.split(".")[0]));
        const upper = clip.tracks.filter((t) => !LOWER.has(t.name.split(".")[0]));
        out.set(clip.name, {
          lower: new THREE.AnimationClip(`${clip.name}:lower`, clip.duration, lower),
          upper: new THREE.AnimationClip(`${clip.name}:upper`, clip.duration, upper),
        });
      }
      return out;
    });
    clips.catch(() => {
      clips = null;
    });
  }
  return clips;
}

/* Start fetching the rig's clips and the characters, so the first player to arrive shows at once. */
export function preloadCharacters(characters: readonly CharacterId[]) {
  void playerClips();
  for (const c of characters) void loadModel(charUrl(c));
}
