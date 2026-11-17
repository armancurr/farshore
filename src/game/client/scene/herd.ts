import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { wrapAngle } from "../../shared/math";
import { ANIMAL_FLAG, ANIMAL_STATE, type AnimalSnap } from "../../shared/protocol";
import { ALPHA, type Role, SPECIES, SPECIES_IDS, type SpeciesId } from "../../shared/species";
import { disposeModel, flatten, loadModel, measure } from "./models";

/*
 * The animals near you, as the room last reported them, drawn with their
 * models from the asset packs: each one a skinned copy with its own
 * animation mixer, easing toward where the room says it is and blending
 * between grazing, walking, running, attacking and falling.
 */

type ClipName = "idle" | "graze" | "walk" | "run" | "attack" | "death" | "alert" | "hit";

/* Which clips in a pack's file play each part, best match first. */
const CLIPS: Record<ClipName, readonly string[]> = {
  idle: ["Idle", "Idle_A"],
  graze: ["Eating", "Idle_Eating", "Idle_Headlow", "Idle_2_HeadLow", "Idle"],
  walk: ["Walk"],
  run: ["Gallop", "Run", "Walk"],
  attack: ["Attack_Headbutt", "Attack", "Headbutt", "Attack_Kick"],
  death: ["Death", "Dead"],
  alert: ["Idle_2", "Idle"],
  hit: ["Idle_HitReact1", "HitReact", "Idle"],
};

type ModelDef = {
  url: string;
  /* An alpha of this kind can wear a different coat. */
  alphaUrl?: string;
  /* How tall it stands, in metres (an alpha is ALPHA.scale times that). */
  height: number;
  /* Turn the model so its nose points down -z, the game's forward. */
  yaw?: number;
  /* A pack with only a walk: run plays it this much faster. */
  stride?: number;
  /* Lift a model whose feet don't reach its own floor. */
  lift?: number;
};

const Q = "/models/animals/";
export const ANIMAL_MODELS: Record<SpeciesId, ModelDef> = {
  deer: { url: `${Q}deer.glb`, height: 1.55 },
  stag: { url: `${Q}stag.glb`, height: 2.1 },
  alpaca: { url: `${Q}alpaca.glb`, height: 1.8 },
  horse: { url: `${Q}horse.glb`, alphaUrl: `${Q}horse_white.glb`, height: 2 },
  donkey: { url: `${Q}donkey.glb`, height: 1.5 },
  rabbit: { url: `${Q}hare.glb`, height: 0.55, stride: 2.6 },
  fox: { url: `${Q}fox.glb`, height: 0.7 },
  goat: { url: `${Q}goat.glb`, height: 1.15, stride: 2.2 },
  ram: { url: `${Q}ram.glb`, height: 1.25, stride: 2.2 },
  boar: { url: `${Q}boar.glb`, height: 1, stride: 2.2 },
  bull: { url: `${Q}bull.glb`, height: 1.75 },
  wolf: { url: `${Q}wolf.glb`, height: 1.05 },
};

/* A loaded pack model, ready to copy: its scene at the right size, and its clips by part. */
type Template = {
  scene: THREE.Object3D;
  clips: Partial<Record<ClipName, THREE.AnimationClip>>;
  stride: number;
};

export type Shown = {
  id: number;
  species: SpeciesId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  tx: number;
  ty: number;
  tz: number;
  tyaw: number;
  state: number;
  health: number;
  flags: number;
  seen: number;
  /* Drawn once its model has loaded. */
  view: {
    root: THREE.Object3D;
    mixer: THREE.AnimationMixer;
    actions: Partial<Record<ClipName, THREE.AnimationAction>>;
    playing: ClipName | null;
  } | null;
};

/* Past this, an animal isn't drawn (the fog has it by then anyway). */
const DRAW_RANGE = 300;
/* Past this, its animation steps less often. */
const NEAR_RANGE = 90;

function pickClip(clips: readonly THREE.AnimationClip[], wanted: readonly string[]) {
  /* Packs prefix clip names with their armature ("AnimalArmature|Walk"); match the last part. */
  const bare = (n: string) => n.split("|").pop()!.toLowerCase();
  for (const w of wanted) {
    const hit = clips.find((c) => bare(c.name) === w.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

export class HerdView {
  readonly group = new THREE.Group();
  private shown = new Map<number, Shown>();
  private stamp = 0;
  /* By model file: an alpha may wear its own. */
  private templates = new Map<string, Template | "loading" | "failed">();
  private frame = 0;

  /* Start fetching the models, so they're ready by the time anyone reaches an island. */
  preload() {
    for (const s of SPECIES_IDS) this.template(s, false);
  }

  private template(species: SpeciesId, alpha: boolean): Template | null {
    const def = ANIMAL_MODELS[species];
    const url = alpha && def.alphaUrl ? def.alphaUrl : def.url;
    const have = this.templates.get(url);
    if (have === "loading" || have === "failed") return null;
    if (have) return have;
    this.templates.set(url, "loading");
    loadModel(url).then(
      (gltf) => {
        const scene = gltf.scene;
        flatten(scene);
        scene.traverse((o) => {
          o.frustumCulled = false;
        });
        /* Stand it on the ground, the right height, facing -z. */
        const holder = new THREE.Group();
        holder.add(scene);
        const box = measure(scene);
        const size = box.getSize(new THREE.Vector3());
        const k = def.height / Math.max(size.y, 1e-3);
        scene.scale.multiplyScalar(k);
        scene.rotation.y += def.yaw ?? Math.PI;
        const after = measure(scene);
        scene.position.y -= after.min.y - (def.lift ?? 0);
        const clips: Template["clips"] = {};
        for (const name of Object.keys(CLIPS) as ClipName[]) {
          const c = pickClip(gltf.animations, CLIPS[name]);
          if (c) clips[name] = c;
        }
        this.templates.set(url, { scene: holder, clips, stride: def.stride ?? 1 });
      },
      () => this.templates.set(url, "failed"),
    );
    return null;
  }

  /* Whether this species index runs, fights back, or hunts. */
  roleOf(index: number): Role {
    const s = SPECIES_IDS[index];
    return s ? SPECIES[s].role : "prey";
  }

  /* Where the crosshair should look on it: about its middle. */
  aimHeight(a: Shown) {
    return ANIMAL_MODELS[a.species].height * 0.6 * (a.flags & ANIMAL_FLAG.alpha ? ALPHA.scale : 1);
  }

  nameOf(a: Shown) {
    const name = SPECIES[a.species].name;
    return a.flags & ANIMAL_FLAG.alpha ? `Alpha ${name.toLowerCase()}` : name;
  }

  set(snaps: readonly AnimalSnap[]) {
    this.stamp++;
    for (const [id, kind, x, y, z, yaw, state, health, flags] of snaps) {
      const species = SPECIES_IDS[kind];
      if (!species) continue;
      let s = this.shown.get(id);
      if (!s || s.species !== species) {
        if (s) this.drop(s);
        s = {
          id,
          species,
          x,
          y,
          z,
          yaw,
          tx: x,
          ty: y,
          tz: z,
          tyaw: yaw,
          state,
          health,
          flags: flags ?? 0,
          seen: this.stamp,
          view: null,
        };
        this.shown.set(id, s);
      }
      s.tx = x;
      s.ty = y;
      s.tz = z;
      s.tyaw = yaw;
      s.state = state;
      s.health = health;
      s.flags = flags ?? 0;
      s.seen = this.stamp;
    }
    for (const [id, s] of this.shown) {
      if (s.seen === this.stamp) continue;
      this.drop(s);
      this.shown.delete(id);
    }
  }

  list(): ReadonlyMap<number, Shown> {
    return this.shown;
  }

  private build(s: Shown, t: Template) {
    const root = cloneSkinned(t.scene);
    if (s.flags & ANIMAL_FLAG.alpha) root.scale.setScalar(ALPHA.scale);
    const mixer = new THREE.AnimationMixer(root);
    const actions: Partial<Record<ClipName, THREE.AnimationAction>> = {};
    for (const [name, clip] of Object.entries(t.clips) as [ClipName, THREE.AnimationClip][]) {
      const a = mixer.clipAction(clip);
      if (name === "death" || name === "attack" || name === "hit") {
        a.setLoop(THREE.LoopOnce, 1);
        /* Hold the last frame rather than dropping back to the bind pose. */
        a.clampWhenFinished = true;
      }
      if (name === "run" && t.clips.run === t.clips.walk) a.timeScale = t.stride;
      actions[name] = a;
    }
    /* A different moment in the loop for each, so a herd doesn't move in step. */
    mixer.setTime((s.id * 0.37) % 3);
    this.group.add(root);
    s.view = { root, mixer, actions, playing: null };
  }

  private drop(s: Shown) {
    if (!s.view) return;
    s.view.mixer.stopAllAction();
    this.group.remove(s.view.root);
    s.view = null;
  }

  private play(s: Shown, want: ClipName) {
    const v = s.view!;
    if (v.playing === want) return;
    const next = v.actions[want] ?? v.actions.idle;
    if (!next) return;
    const prev = v.playing ? v.actions[v.playing] : null;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (prev && prev !== next) next.crossFadeFrom(prev, want === "death" ? 0.15 : 0.25, false);
    next.play();
    v.playing = want;
  }

  /* What it should be doing, from what the room says and how fast it's going. */
  private clipFor(s: Shown, speed: number): ClipName {
    switch (s.state) {
      case ANIMAL_STATE.dead:
        return "death";
      case ANIMAL_STATE.attack:
        return "attack";
      case ANIMAL_STATE.alert:
        return "alert";
      case ANIMAL_STATE.graze:
        return speed > 0.5 ? "walk" : "graze";
      default:
        return speed > 3.2 ? "run" : speed > 0.25 ? "walk" : "idle";
    }
  }

  update(dt: number, eye: THREE.Vector3) {
    this.frame++;
    const k = 1 - Math.exp(-dt * 12);
    for (const s of this.shown.values()) {
      const px = s.x;
      const pz = s.z;
      s.x += (s.tx - s.x) * k;
      s.y += (s.ty - s.y) * k;
      s.z += (s.tz - s.z) * k;
      s.yaw = wrapAngle(s.yaw + wrapAngle(s.tyaw - s.yaw) * k);
      const speed = dt > 0 ? Math.hypot(s.x - px, s.z - pz) / dt : 0;

      const d = Math.hypot(s.x - eye.x, s.z - eye.z);
      if (d > DRAW_RANGE) {
        if (s.view) s.view.root.visible = false;
        continue;
      }
      if (!s.view) {
        const t = this.template(s.species, (s.flags & ANIMAL_FLAG.alpha) !== 0);
        if (!t) continue;
        this.build(s, t);
      }
      const v = s.view!;
      v.root.visible = true;
      v.root.position.set(s.x, s.y, s.z);
      v.root.rotation.y = s.yaw;
      this.play(s, this.clipFor(s, speed));
      /* Faraway animals animate every few frames, at the same pace overall. */
      const step = d < NEAR_RANGE ? 1 : 3;
      if ((this.frame + s.id) % step === 0) v.mixer.update(dt * step);
    }
  }

  clear() {
    for (const s of this.shown.values()) this.drop(s);
    this.shown.clear();
  }

  dispose() {
    this.clear();
    for (const t of this.templates.values()) if (typeof t === "object") disposeModel(t.scene);
    this.templates.clear();
  }
}
