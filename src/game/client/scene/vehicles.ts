import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { wheelContacts } from "../../shared/car";
import { SEA_LEVEL } from "../../shared/constants";
import {
  createVehicle,
  riderPose,
  type SeatPose,
  toWorldFrame,
  unpackVehicle,
  type VehicleSnap,
  type VehicleState,
} from "../../shared/drive";
import { clamp, lerp, wrapAngle } from "../../shared/math";
import type { Ground } from "../../shared/terrain";
import {
  afloat,
  VEHICLES,
  type VehicleDef,
  type VehicleKind,
  vehicleFromIndex,
} from "../../shared/vehicles";
import { windAt } from "../../shared/wind";
import { PALETTE } from "./materials";
import { flatten, loadModel, measure } from "./models";
import { packModel, worldShade } from "./packs";

/*
 * Everything people ride, drawn with the asset packs' own models: hulls that
 * bob and heel, oars that pull, sails that trim to the wind and fill with
 * it, flags that stream, propellers that spin, wheels that roll, steer and
 * follow the ground, and horses that walk, gallop and jump under a saddle.
 *
 * Other people's vehicles ease along the room's snapshots a moment behind,
 * as the avatars do, so whoever rides one stays in their seat. The one you
 * steer is drawn where your own driving has it.
 */

/* ---------- models ---------- */

type Pivot = { node: THREE.Object3D; base: THREE.Euler };

/* One vehicle's model and the parts of it that move. */
export type Built = {
  /* In the vehicle's own frame: forward -z, origin on the waterline or the ground. */
  root: THREE.Group;
  /* What heels, bobs and rolls on top of the vehicle's own pose. */
  sway: THREE.Group;
  /* The body of a car, which rolls and dives on its springs. */
  body: THREE.Object3D | null;
  wheels: {
    node: THREE.Object3D;
    front: boolean;
    restY: number;
    base: THREE.Quaternion;
    lx: number;
    lz: number;
  }[];
  oars: Pivot[];
  /* Fore-and-aft sails (swing on the mast), and square sails (braced, furled up to the yard). */
  sails: Pivot[];
  squares: Pivot[];
  /* `fly` is the heading the flag points along at rest, in the vehicle's frame. */
  flags: (Pivot & { fly: number })[];
  fans: THREE.Object3D[];
  mixer: THREE.AnimationMixer | null;
  clips: Partial<Record<"idle" | "walk" | "run" | "jump", THREE.AnimationClip>>;
};

/* Turn a model round to face -z, scale it to metres and put its origin where the vehicle's is. */
function hold(def: VehicleDef, model: THREE.Object3D) {
  const holder = new THREE.Group();
  holder.add(model);
  holder.scale.setScalar(def.scale);
  holder.rotation.y = Math.PI;
  holder.position.set(0, def.offset.y, def.offset.z);
  return holder;
}

/*
 * Wrap a part in a pivot at `at` (in its parent's space), so it turns about
 * that point rather than its own origin.
 */
function pivotAt(node: THREE.Object3D, at: THREE.Vector3): Pivot {
  const parent = node.parent as THREE.Object3D;
  const pivot = new THREE.Group();
  pivot.position.copy(at);
  parent.add(pivot);
  node.position.sub(at);
  pivot.add(node);
  return { node: pivot, base: pivot.rotation.clone() };
}

/* A node's bounds in its parent's space. */
function boundsIn(node: THREE.Object3D) {
  const parent = node.parent as THREE.Object3D;
  parent.updateMatrixWorld(true);
  const inv = parent.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  node.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.computeBoundingBox();
    box.union(
      (m.geometry.boundingBox as THREE.Box3).clone().applyMatrix4(m.matrixWorld).applyMatrix4(inv),
    );
  });
  return box;
}

/*
 * A rowboat's oars are one mesh across the boat. Split it down the middle so
 * each oar can sweep on its own rowlock.
 */
function splitOars(node: THREE.Object3D): Pivot[] {
  const mesh = node as THREE.Mesh;
  if (!mesh.isMesh) return [];
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  const pos = src.attributes.position;
  const box = boundsIn(node);
  const out: Pivot[] = [];
  for (const side of [1, -1]) {
    const keep: number[] = [];
    for (let t = 0; t < pos.count; t += 3) {
      const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
      if (cx * side > 0) keep.push(t, t + 1, t + 2);
    }
    const g = new THREE.BufferGeometry();
    for (const name of Object.keys(src.attributes)) {
      const a = src.attributes[name] as THREE.BufferAttribute;
      const arr = new Float32Array(keep.length * a.itemSize);
      keep.forEach((v, i) => {
        for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(v, k);
      });
      g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    const half = new THREE.Mesh(g, mesh.material);
    half.castShadow = true;
    half.position.copy(mesh.position);
    half.quaternion.copy(mesh.quaternion);
    half.scale.copy(mesh.scale);
    (mesh.parent as THREE.Object3D).add(half);
    /* The rowlock: on the gunwale, half way out to the blade's root. */
    out.push(
      pivotAt(half, new THREE.Vector3(side * 0.62, box.max.y - 0.08, (box.min.z + box.max.z) / 2)),
    );
  }
  mesh.removeFromParent();
  src.dispose();
  return out;
}

const SADDLE = {
  leather: 0x5a3a2c,
  dark: 0x3e2820,
  blanket: PALETTE.accent,
  trim: PALETTE.whitewash,
  iron: PALETTE.outline,
};
const saddleMats = new Map<number, THREE.MeshLambertMaterial>();
function saddleMat(color: number) {
  let m = saddleMats.get(color);
  if (!m) {
    m = worldShade(new THREE.MeshLambertMaterial({ color, flatShading: true }));
    saddleMats.set(color, m);
  }
  return m;
}

/*
 * A saddle in the vehicle's frame, its seat at the origin: a coral blanket
 * with a cream edge draped over the back, a dark leather seat dipped between
 * a pommel and a cantle, skirts over the blanket, and stirrups hanging on
 * their leathers. `size` scales it to the animal (1 for a horse).
 */
function buildSaddle(size: number) {
  const g = new THREE.Group();
  const add = (
    geo: THREE.BufferGeometry,
    color: number,
    x: number,
    y: number,
    z: number,
    rz = 0,
    rx = 0,
  ) => {
    const m = new THREE.Mesh(geo, saddleMat(color));
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  /* The blanket: across the back, then down each flank, following the barrel. */
  add(new THREE.BoxGeometry(0.34, 0.025, 0.58), SADDLE.blanket, 0, -0.075, 0.01);
  for (const s of [1, -1]) {
    add(
      new THREE.BoxGeometry(0.022, 0.24, 0.58),
      SADDLE.blanket,
      s * 0.235,
      -0.165,
      0.01,
      s * 0.55,
    );
    add(new THREE.BoxGeometry(0.024, 0.035, 0.6), SADDLE.trim, s * 0.302, -0.268, 0.01, s * 0.55);
  }
  /* The seat, its pommel in front and its cantle behind. */
  add(new THREE.BoxGeometry(0.26, 0.05, 0.4), SADDLE.leather, 0, -0.04, 0.02);
  add(new THREE.BoxGeometry(0.16, 0.08, 0.07), SADDLE.dark, 0, 0.005, -0.19, 0, 0.4);
  add(new THREE.BoxGeometry(0.24, 0.1, 0.06), SADDLE.dark, 0, 0.012, 0.215, 0, -0.35);
  for (const s of [1, -1]) {
    /* A skirt over the blanket, and the stirrup on its leather. */
    add(new THREE.BoxGeometry(0.02, 0.16, 0.3), SADDLE.leather, s * 0.17, -0.12, 0.02, s * 0.5);
    add(new THREE.BoxGeometry(0.018, 0.42, 0.03), SADDLE.dark, s * 0.25, -0.36, -0.03, s * 0.12);
    add(new THREE.BoxGeometry(0.09, 0.022, 0.06), SADDLE.iron, s * 0.285, -0.58, -0.03);
  }
  g.scale.setScalar(size);
  return g;
}

/* Animal clips by what they're for, best match first ("AnimalArmature|Gallop"). */
const MOUNT_CLIPS = {
  idle: ["Idle"],
  walk: ["Walk"],
  run: ["Gallop"],
  jump: ["Gallop_Jump"],
} as const;

function pickClip(clips: readonly THREE.AnimationClip[], wanted: readonly string[]) {
  const bare = (n: string) => n.split("|").pop()!.toLowerCase();
  for (const w of wanted) {
    const hit = clips.find((c) => bare(c.name) === w.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

/* A horse or donkey, the right size, facing -z, saddled. */
async function buildMount(def: VehicleDef): Promise<Built> {
  const gltf = await loadModel(def.model);
  const scene = cloneSkinned(gltf.scene);
  flatten(scene);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) worldShade(mat);
  });
  const holder = new THREE.Group();
  holder.add(scene);
  const size = measure(scene).getSize(new THREE.Vector3());
  scene.scale.multiplyScalar(def.scale / Math.max(size.y, 1e-3));
  scene.rotation.y += Math.PI;
  scene.position.y -= measure(scene).min.y;
  const sway = new THREE.Group();
  sway.add(holder);
  const root = new THREE.Group();
  root.add(sway);

  /* The saddle rides on the back: on the torso's bone, so it moves as the animal does. */
  const seat = def.seats[0];
  const saddle = buildSaddle(def.scale / 2);
  root.updateMatrixWorld(true);
  let bone: THREE.Object3D | null = null;
  scene.traverse((o) => {
    if (!bone && (o as THREE.Bone).isBone && o.name.endsWith("Torso")) bone = o;
  });
  saddle.position.set(0, seat.y, seat.z);
  saddle.updateMatrix();
  if (bone) {
    const b = bone as THREE.Object3D;
    const local = b.matrixWorld.clone().invert().multiply(saddle.matrix);
    local.decompose(saddle.position, saddle.quaternion, saddle.scale);
    b.add(saddle);
  } else sway.add(saddle);

  const mixer = new THREE.AnimationMixer(scene);
  const clips: Built["clips"] = {};
  for (const [name, wanted] of Object.entries(MOUNT_CLIPS) as [
    keyof Built["clips"],
    readonly string[],
  ][]) {
    const c = pickClip(gltf.animations, wanted);
    if (c) clips[name] = c;
  }
  return {
    root,
    sway,
    body: null,
    wheels: [],
    oars: [],
    sails: [],
    squares: [],
    flags: [],
    fans: [],
    mixer,
    clips,
  };
}

/* A cask to sit on, for a seat on deck: its lid at the seat, its foot on the deck. */
async function caskAt(seat: { x: number; y: number; z: number; cask?: number }) {
  const b = await packModel("camp/barrel");
  const tall = seat.cask ?? 0.5;
  const k = tall / 0.344;
  b.scale.set(Math.min(k, 0.5 / 0.344) * 1.1, k, Math.min(k, 0.5 / 0.344) * 1.1);
  b.position.set(seat.x, seat.y - tall, seat.z);
  return b;
}

/* Build one vehicle's model, with its moving parts found and pivoted. */
export async function buildVehicle(kind: VehicleKind): Promise<Built> {
  const def = VEHICLES[kind];
  if (def.class === "mount") return buildMount(def);
  const model = await packModel(def.model);
  const holder = hold(def, model);
  const sway = new THREE.Group();
  sway.add(holder);
  const root = new THREE.Group();
  root.add(sway);
  root.updateMatrixWorld(true);

  const named = (name: string) => {
    const out: THREE.Object3D[] = [];
    model.traverse((o) => {
      if (o.name === name || o.name.startsWith(`${name}_`)) out.push(o);
    });
    return out;
  };
  const built: Built = {
    root,
    sway,
    body: null,
    wheels: [],
    oars: [],
    sails: [],
    squares: [],
    flags: [],
    fans: [],
    mixer: null,
    clips: {},
  };

  if (def.class === "car") {
    built.body = named("body")[0] ?? null;
    for (const name of [
      "wheel-front-left",
      "wheel-front-right",
      "wheel-back-left",
      "wheel-back-right",
    ]) {
      const node = named(name)[0];
      if (!node) continue;
      /* Where the wheel sits in the vehicle's frame, for its contact with the ground. */
      const at = node.getWorldPosition(new THREE.Vector3());
      built.wheels.push({
        node,
        front: name.includes("front"),
        restY: node.position.y,
        base: node.quaternion.clone(),
        lx: at.x,
        lz: at.z,
      });
    }
  }
  for (const node of named("paddles")) built.oars.push(...splitOars(node));
  for (const node of named("sail")) {
    /* The mast is at the sail's own origin: swing it there. */
    built.sails.push({ node, base: node.rotation.clone() });
  }
  for (const name of ["sail-a", "sail-b"])
    for (const node of named(name)) {
      /* A square sail hangs from its yard: furl it up to there. */
      const box = boundsIn(node);
      built.squares.push(
        pivotAt(node, new THREE.Vector3(0, box.max.y, (box.min.z + box.max.z) / 2)),
      );
    }
  for (const name of ["flag-a", "flag-b", "flag-c"])
    for (const node of named(name)) {
      /* A flag flies from its pole: the end nearer the middle of the ship. */
      const box = boundsIn(node);
      const aft = Math.abs(box.min.z) > Math.abs(box.max.z);
      const z = aft ? box.max.z : box.min.z;
      built.flags.push({
        ...pivotAt(node, new THREE.Vector3(0, (box.min.y + box.max.y) / 2, z)),
        fly: aft ? Math.PI : 0,
      });
    }
  built.fans.push(...named("fan"));

  if (def.seats.some((s) => s.cask)) {
    const casks = await Promise.all(def.seats.filter((s) => s.cask).map(caskAt));
    for (const c of casks) sway.add(c);
  }
  return built;
}

export function disposeBuilt(b: Built) {
  b.mixer?.stopAllAction();
  b.root.removeFromParent();
}

/* ---------- the wake ---------- */

let wakeTexture: THREE.CanvasTexture | null = null;

/* A V of foam spreading behind the stern, fading as it goes. */
function wakeMap() {
  if (wakeTexture) return wakeTexture;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const img = g.createImageData(64, 128);
  for (let y = 0; y < 128; y++) {
    const v = y / 127;
    for (let x = 0; x < 64; x++) {
      const u = (x / 63) * 2 - 1;
      /* Two arms of foam opening out from the stern, and churned water in between. */
      const arm = Math.abs(Math.abs(u) - (0.12 + v * 0.85));
      const ridge = Math.max(0, 1 - arm / (0.06 + v * 0.1));
      const churn = Math.max(0, 1 - Math.abs(u) / (0.15 + v * 0.35)) * 0.45;
      const a = Math.min(1, ridge + churn) * (1 - v) ** 1.4;
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  wakeTexture = new THREE.CanvasTexture(c);
  return wakeTexture;
}

function buildWake(def: VehicleDef) {
  const mat = new THREE.MeshBasicMaterial({
    map: wakeMap(),
    color: PALETTE.foam,
    transparent: true,
    depthWrite: false,
    opacity: 0,
    fog: true,
  });
  const len = Math.max(8, def.length * 3.2);
  const geo = new THREE.PlaneGeometry(def.beam * 2.4 + len * 0.25, len);
  geo.rotateX(-Math.PI / 2);
  /* The plane's near edge at the stern. */
  geo.translate(0, 0, len / 2);
  const mesh = new THREE.Mesh(geo, mat);
  /* After the sea, which is see-through and drawn late (renderOrder 2). */
  mesh.renderOrder = 3;
  return mesh;
}

/* ---------- the view ---------- */

const UP = new THREE.Vector3(0, 1, 0);
const AXLE = new THREE.Vector3(1, 0, 0);
const SPIN = new THREE.Quaternion();

type Pose = Pick<
  VehicleState,
  "x" | "y" | "z" | "rot" | "pitch" | "roll" | "speed" | "steer" | "turn" | "aux"
>;

type Sample = { t: number; s: Pose };

type Shown = {
  id: number;
  kind: VehicleKind;
  buf: Sample[];
  /* Who's in each seat (member ids, 0 for nobody). */
  seats: number[];
  /* Where it's drawn, and the same with its bob and heel for the riders' seats. */
  pose: Pose;
  look: Pose;
  /* Steered by us: drawn where our own driving has it. */
  mine: boolean;
  built: Built | null;
  loading: boolean;
  wake: THREE.Mesh | null;
  spin: number;
  stroke: number;
  rowing: number;
  lastSpeed: number;
  dive: number;
  gait: keyof Built["clips"] | null;
  /* The suspension, wheel by wheel, in metres. */
  travel: number[];
};

/* Cars with nothing round the driver: their wheels are part of the view. */
/* Open cockpits (the racers and tractors, all put away for now): "racer", "prototype", "tractor", "loader". */
const OPEN = new Set<VehicleKind>([]);

/* Past this, a vehicle isn't drawn (the fog has it anyway). */
const DRAW_RANGE = 700;

const emptyPose = (): Pose => ({
  x: 0,
  y: 0,
  z: 0,
  rot: 0,
  pitch: 0,
  roll: 0,
  speed: 0,
  steer: 0,
  turn: 0,
  aux: 0,
});

export class VehicleView {
  readonly group = new THREE.Group();
  private shown = new Map<number, Shown>();
  /* Who rides what: member id to vehicle and seat. */
  private riders = new Map<number, { id: number; seat: number }>();
  private stamp = 0;
  private seen = new Map<number, number>();

  /* A snapshot's worth of vehicles, at server time `t`. Anything not in it has gone. */
  setAll(snaps: readonly VehicleSnap[], t: number) {
    this.stamp++;
    this.riders.clear();
    for (const snap of snaps) {
      const v = unpackVehicle(snap);
      const kind = vehicleFromIndex(v.index);
      if (!kind) continue;
      let s = this.shown.get(v.id);
      if (!s || s.kind !== kind) {
        if (s) this.drop(s);
        s = {
          id: v.id,
          kind,
          buf: [],
          seats: [],
          pose: { ...emptyPose(), ...v.state },
          look: { ...emptyPose(), ...v.state },
          mine: false,
          built: null,
          loading: false,
          wake: null,
          spin: 0,
          stroke: 0,
          rowing: 0,
          lastSpeed: 0,
          dive: 0,
          gait: null,
          travel: [0, 0, 0, 0],
        };
        this.shown.set(v.id, s);
      }
      s.seats = v.seats;
      v.seats.forEach((m, seat) => {
        if (m) this.riders.set(m, { id: v.id, seat });
      });
      const last = s.buf[s.buf.length - 1];
      if (!last || t > last.t) s.buf.push({ t, s: v.state });
      if (s.buf.length > 12) s.buf.shift();
      this.seen.set(v.id, this.stamp);
    }
    for (const [id, s] of this.shown) {
      if (this.seen.get(id) === this.stamp) continue;
      this.drop(s);
      this.shown.delete(id);
      this.seen.delete(id);
    }
  }

  kindOf(id: number) {
    return this.shown.get(id)?.kind ?? null;
  }

  /* The seats and who's in them. */
  seatsOf(id: number) {
    return this.shown.get(id)?.seats ?? [];
  }

  /* Which vehicle and seat a member is in, if any. */
  riding(member: number) {
    return this.riders.get(member) ?? null;
  }

  /* The one we steer: drawn from our own state from now on (null hands it back to the snapshots). */
  steer(id: number, state: VehicleState | null) {
    const s = this.shown.get(id);
    if (!s) return;
    s.mine = state !== null;
    if (state) Object.assign(s.pose, pick(state));
  }

  /*
   * The one the camera sits in. A closed car's body can't be seen from
   * inside (its faces point out), but its wheels' inner faces can: hide them.
   * An open racer's wheels stay, as a driver would see them.
   */
  inside(id: number | null) {
    for (const s of this.shown.values()) {
      const hide = s.id === id && VEHICLES[s.kind].class === "car" && !OPEN.has(s.kind);
      for (const w of s.built?.wheels ?? []) w.node.visible = !hide;
    }
  }

  /* Where it's drawn right now, bob and heel included: seats go with this. */
  look(id: number): Pose | null {
    return this.shown.get(id)?.look ?? null;
  }

  /* Where it is by the latest snapshot. */
  latest(id: number): Pose | null {
    const s = this.shown.get(id);
    const last = s?.buf[s.buf.length - 1];
    return last ? last.s : null;
  }

  /* All of them, for picking one to climb into. */
  list() {
    return this.shown.values();
  }

  /* Where a rider sits, for their avatar: null if they aren't aboard anything we can see. */
  riderPose(member: number): SeatPose | null {
    const r = this.riders.get(member);
    const s = r ? this.shown.get(r.id) : null;
    if (!r || !s) return null;
    return riderPose(s.kind, s.look, r.seat);
  }

  /*
   * Move everything on: interpolate the snapshots at `renderTime` (server
   * time, a moment behind), then animate. `worldTime` drives the wind.
   */
  update(dt: number, renderTime: number, worldTime: number, eye: THREE.Vector3, ground?: Ground) {
    const wind = windAt(worldTime);
    for (const s of this.shown.values()) {
      if (!s.mine) this.interpolate(s, renderTime);
      const def = VEHICLES[s.kind];
      const far = Math.hypot(s.pose.x - eye.x, s.pose.z - eye.z) > DRAW_RANGE;
      if (!s.built) {
        if (!far && !s.loading) this.load(s);
        Object.assign(s.look, s.pose);
        continue;
      }
      const b = s.built;
      b.root.visible = !far;
      if (s.wake) s.wake.visible = !far;
      if (far) {
        Object.assign(s.look, s.pose);
        continue;
      }
      const p = s.pose;
      const accel = dt > 0 ? (p.speed - s.lastSpeed) / dt : 0;
      s.lastSpeed = p.speed;
      s.dive += (clamp(accel * 0.012, -0.06, 0.06) - s.dive) * Math.min(1, dt * 6);
      b.root.position.set(p.x, p.y, p.z);
      b.root.rotation.set(p.pitch, p.rot, p.roll, "YXZ");
      Object.assign(s.look, p);
      if (afloat(s.kind)) this.float(s, def, dt, worldTime, wind);
      else if (def.class === "car") this.drive(s, def, dt, ground);
      else this.ride(s, dt);
    }
  }

  private interpolate(s: Shown, t: number) {
    const buf = s.buf;
    if (!buf.length) return;
    let a = buf[0];
    let b = buf[0];
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= t) {
        a = buf[i];
        b = buf[Math.min(i + 1, buf.length - 1)];
        break;
      }
    }
    const span = b.t - a.t;
    const k = span > 0 ? clamp((t - a.t) / span, 0, 1) : 1;
    const p = s.pose;
    p.x = lerp(a.s.x, b.s.x, k);
    p.y = lerp(a.s.y, b.s.y, k);
    p.z = lerp(a.s.z, b.s.z, k);
    p.rot = a.s.rot + wrapAngle(b.s.rot - a.s.rot) * k;
    p.pitch = lerp(a.s.pitch, b.s.pitch, k);
    p.roll = lerp(a.s.roll, b.s.roll, k);
    p.speed = lerp(a.s.speed, b.s.speed, k);
    p.steer = lerp(a.s.steer, b.s.steer, k);
    p.turn = lerp(a.s.turn, b.s.turn, k);
    p.aux = lerp(a.s.aux, b.s.aux, k);
  }

  private load(s: Shown) {
    s.loading = true;
    buildVehicle(s.kind).then(
      (built) => {
        s.loading = false;
        if (this.shown.get(s.id) !== s) {
          disposeBuilt(built);
          return;
        }
        s.built = built;
        this.group.add(built.root);
        if (afloat(s.kind)) {
          s.wake = buildWake(VEHICLES[s.kind]);
          this.group.add(s.wake);
        }
      },
      () => {
        s.loading = false;
      },
    );
  }

  /* Afloat: the swell under it, the wind in its sails, the oars, the propeller, the wake. */
  private float(
    s: Shown,
    def: VehicleDef,
    dt: number,
    time: number,
    wind: ReturnType<typeof windAt>,
  ) {
    const b = s.built as Built;
    const p = s.pose;
    /* Small boats ride the swell; a galleon hardly notices it. */
    const size = clamp(6 / def.length, 0.25, 1.2);
    const bob = Math.sin(time * 1.3 + s.id) * 0.05 * size;
    const rock = Math.sin(time * 0.9 + s.id * 1.7) * 0.03 * size;
    const pitch = Math.cos(time * 1.1 + s.id) * 0.02 * size;
    b.sway.position.y = bob;
    b.sway.rotation.set(pitch, 0, rock, "YXZ");
    s.look.y = p.y + bob;
    s.look.pitch = p.pitch + pitch;
    s.look.roll = p.roll + rock;

    const pace = clamp(Math.abs(p.speed) / (def.hull?.speed ?? 10), 0, 1);
    if (s.wake) {
      const w = s.wake;
      const stern = def.length / 2 - 0.2;
      w.position.set(
        p.x + Math.sin(p.rot) * stern,
        SEA_LEVEL + 0.04,
        p.z + Math.cos(p.rot) * stern,
      );
      w.rotation.y = p.rot;
      const mat = w.material as THREE.MeshBasicMaterial;
      /* Oars barely mark the water; a hull on the plane throws a white V. */
      const churn = def.class === "row" ? 0.35 : def.class === "sail" ? 0.6 : 1;
      const want = p.speed > 0.4 ? Math.min(0.85, pace * 1.1) * churn : 0;
      mat.opacity += (want - mat.opacity) * Math.min(1, dt * 3);
      w.scale.z = 0.4 + pace * 0.8;
    }

    /* The oars: a measured pull through the water, then a slower raised recovery. */
    if (b.oars.length) {
      const target = Math.min(1, Math.abs(p.speed) / 1.2 + Math.abs(p.turn) * 0.6);
      s.rowing += (target - s.rowing) * (1 - Math.exp(-dt * 2));
      if (s.rowing > 0.01) s.stroke = (s.stroke + dt * (0.4 + pace * 0.35)) % 1;
      const drive = s.stroke < 0.42;
      const u = drive ? s.stroke / 0.42 : (s.stroke - 0.42) / 0.58;
      const e = u * u * (3 - 2 * u);
      const sweep = (drive ? -1 + 2 * e : 1 - 2 * e) * 0.5 * s.rowing * Math.sign(p.speed || 1);
      const dip = (drive ? Math.sin(u * Math.PI) : -0.2 * Math.sin(u * Math.PI)) * 0.2 * s.rowing;
      /* Turning on the spot: one oar pulls while the other backs. */
      const twist = clamp(p.turn, -1, 1) * 0.35 * (1 - pace);
      b.oars.forEach((o, i) => {
        const side = i === 0 ? 1 : -1;
        o.node.rotation.set(
          o.base.x,
          o.base.y + side * (sweep + twist * side),
          o.base.z + side * dip,
        );
      });
    }

    /*
     * The wind across the deck: the true wind less the way she's making.
     * Sails swing out to leeward, the more the further off the wind; they
     * fill with what's set; flags stream with it.
     */
    const vx = -Math.sin(p.rot) * p.speed;
    const vz = -Math.cos(p.rot) * p.speed;
    const ax = wind.x - vx;
    const az = wind.z - vz;
    const apparent = Math.atan2(-ax, -az);
    const off = wrapAngle(p.rot - apparent);
    const strength = Math.min(1, Math.hypot(ax, az) / 12);
    const set = def.class === "sail" ? p.aux : 0;
    const out = clamp((Math.PI - Math.abs(off)) * 0.5, 0.15, 1.35) * Math.sign(off || 1);
    const luff = (1 - set) * Math.sin(time * 9 + s.id) * 0.06;
    for (const sail of b.sails) {
      const n = sail.node;
      n.rotation.y +=
        (sail.base.y + out * (0.35 + 0.65 * set) + luff - n.rotation.y) * Math.min(1, dt * 2);
      n.scale.x = 0.55 + 0.9 * set * strength;
    }
    for (const sq of b.squares) {
      const n = sq.node;
      /* Square sails are braced round on their yards, never far. */
      const brace = clamp(out * 0.45, -0.6, 0.6);
      n.rotation.y += (sq.base.y + brace - n.rotation.y) * Math.min(1, dt * 1.5);
      const furl = 0.18 + 0.82 * set;
      n.scale.y += (furl - n.scale.y) * Math.min(1, dt * 2);
      n.scale.z = 0.5 + 1.1 * set * strength + Math.sin(time * 2.3 + s.id) * 0.04 * set;
    }
    for (const f of b.flags) {
      const n = f.node;
      /* Streaming downwind (the flag's fly points aft when the wind's from ahead). */
      const stream = wrapAngle(apparent - p.rot - f.fly);
      const flutter = Math.sin(time * (6 + strength * 8) + s.id * 3) * 0.12;
      n.rotation.y = f.base.y + stream + flutter;
    }
    for (const fan of b.fans) fan.rotation.z += dt * (6 + Math.abs(p.aux) * 40);
  }

  /* On wheels: roll, steer, keep each tyre on the ground, and lean on the springs. */
  private drive(s: Shown, def: VehicleDef, dt: number, ground?: Ground) {
    const b = s.built as Built;
    const p = s.pose;
    const spec = def.car!;
    s.spin += (p.speed * dt) / Math.max(0.1, spec.tire);
    const contacts = ground ? wheelContacts(ground, spec, p.x, p.z, p.rot) : null;
    b.wheels.forEach((w, i) => {
      /* Steer about the upright, spin about the axle, both in the car's frame. */
      w.node.quaternion
        .setFromAxisAngle(UP, w.front ? p.steer : 0)
        .multiply(SPIN.setFromAxisAngle(AXLE, s.spin))
        .multiply(w.base);
      if (!contacts) return;
      /* Wheel order in the model: front left, front right, back left, back right. */
      const idx = (w.front ? 0 : 2) + (w.lx > 0 ? 1 : 0);
      const rest = toWorldFrame(p, w.lx, spec.tire, w.lz).y;
      const want = clamp(contacts[idx] + spec.tire - rest, -0.14, 0.18);
      s.travel[i] += (want - s.travel[i]) * Math.min(1, dt * 30);
      w.node.position.y = w.restY + s.travel[i] / def.scale;
    });
    if (b.body) {
      /*
       * Lean out of a turn, squat as it pulls away and dive under braking.
       * The model is turned round inside the vehicle, so its x and z axes
       * point the other way: a positive roll here is the car's right side down.
       */
      const lean = clamp(p.turn * p.speed * 0.01, -0.07, 0.07);
      b.body.rotation.z += (lean - b.body.rotation.z) * Math.min(1, dt * 6);
      b.body.rotation.x = -s.dive;
    }
  }

  /* A mount: its gait from its speed, and a jump when it leaves the ground. */
  private ride(s: Shown, dt: number) {
    const b = s.built as Built;
    const mixer = b.mixer;
    if (!mixer) return;
    const p = s.pose;
    const speed = Math.abs(p.speed);
    const want: keyof Built["clips"] =
      p.aux > 0.5 && b.clips.jump ? "jump" : speed > 3.6 ? "run" : speed > 0.25 ? "walk" : "idle";
    if (want !== s.gait) {
      const clip = b.clips[want] ?? b.clips.idle;
      if (clip) {
        const next = mixer.clipAction(clip);
        const prev = s.gait ? b.clips[s.gait] : null;
        next.reset();
        if (want === "jump") {
          next.setLoop(THREE.LoopOnce, 1);
          next.clampWhenFinished = true;
        }
        next.play();
        if (prev && prev !== clip) next.crossFadeFrom(mixer.clipAction(prev), 0.25, false);
      }
      s.gait = want;
    }
    const act =
      s.gait && b.clips[s.gait] ? mixer.clipAction(b.clips[s.gait] as THREE.AnimationClip) : null;
    if (act) {
      /* The clips' own pace is about a walk of 1.6 m/s and a gallop of 12. */
      if (s.gait === "walk") act.timeScale = clamp(speed / 1.6, 0.5, 2.2) * Math.sign(p.speed || 1);
      else if (s.gait === "run") act.timeScale = clamp(0.45 + speed / 16, 0.6, 1.4);
      else act.timeScale = 1;
    }
    mixer.update(dt);
  }

  private drop(s: Shown) {
    if (s.built) disposeBuilt(s.built);
    s.built = null;
    if (s.wake) {
      s.wake.removeFromParent();
      s.wake.geometry.dispose();
      (s.wake.material as THREE.Material).dispose();
      s.wake = null;
    }
  }

  clear() {
    for (const s of this.shown.values()) this.drop(s);
    this.shown.clear();
    this.riders.clear();
    this.seen.clear();
  }

  dispose() {
    this.clear();
  }
}

function pick(v: VehicleState): Pose {
  return {
    x: v.x,
    y: v.y,
    z: v.z,
    rot: v.rot,
    pitch: v.pitch,
    roll: v.roll,
    speed: v.speed,
    steer: v.steer,
    turn: v.turn,
    aux: v.aux,
  };
}

/* A state to drive from, starting where a snapshot left it. */
export function stateFrom(p: Pose): VehicleState {
  const v = createVehicle(p.x, p.y, p.z, p.rot);
  return { ...v, ...p, supportY: p.y };
}
