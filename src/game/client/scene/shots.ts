import * as THREE from "three";
import { SEA_LEVEL } from "../../shared/constants";
import type { LandOn } from "../../shared/protocol";
import {
  type Flight,
  SHOTS,
  SMOKE,
  type ShotKind,
  shotAt,
  shotFromIndex,
  shotVel,
} from "../../shared/shots";
import type { TideAudio } from "../audio";
import type { Fx } from "./fx";
import { packModel } from "./packs";

/*
 * Everything in flight, drawn. The room says where each shot set off and how
 * fast; we fly our own copy with the same sums (shotAt), so it needs nothing
 * more until it comes down. Then an arrow is left standing in whatever it
 * hit for a while, a cannonball or a stone bursts, a keg lies spitting on its
 * fuse until the room says it's gone off, and a smoke bomb lets out its cloud.
 */

type Model = { id: string; texture?: string; scale: number; tumble?: number };

const MODELS: Record<ShotKind, Model> = {
  arrow: { id: "gear/arrow-bow", texture: "/models/gear/ranger.png", scale: 0.75 },
  firearrow: { id: "gear/arrow-bow", texture: "/models/gear/ranger.png", scale: 0.75 },
  bolt: { id: "gear/arrow-crossbow", texture: "/models/gear/ranger.png", scale: 1 },
  ballista: { id: "gear/arrow-crossbow", texture: "/models/gear/ranger.png", scale: 3 },
  cannonball: { id: "coast/cannon-ball", scale: 0.6 },
  stone: { id: "buildings/projectile-catapult", scale: 3, tumble: 3 },
  keg: { id: "coast/barrel", scale: 0.36, tumble: 6 },
  smoke: { id: "gear/smokebomb", texture: "/models/gear/rogue.png", scale: 1, tumble: 9 },
};

/* Arrows left standing at once, and how long each stays. */
const STUCK_MAX = 60;
const STUCK_TIME = 30;
/* Scorch marks left by blasts at once, and how long they take to fade. */
const SCORCH_MAX = 16;
const SCORCH_TIME = 40;

type Flying = {
  id: number;
  kind: ShotKind;
  flight: Flight;
  /* Seconds since it set off, on our clock. */
  age: number;
  obj: THREE.Group;
  /* Where it comes down, once the room has said. */
  end: { at: number; p: number[]; on: LandOn } | null;
  /* A keg lying on its fuse. */
  resting: boolean;
  spin: THREE.Vector3;
};

const templates = new Map<ShotKind, Promise<THREE.Group>>();

function template(kind: ShotKind) {
  let p = templates.get(kind);
  if (!p) {
    const m = MODELS[kind];
    p = packModel(m.id, m.texture).then((g) => {
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.userData.shared = true;
      });
      return g;
    });
    templates.set(kind, p);
    p.catch(() => templates.delete(kind));
  }
  return p;
}

/* A copy of a shot's model, scaled, dropped in as soon as it's loaded. */
function build(kind: ShotKind) {
  const group = new THREE.Group();
  const holder = new THREE.Group();
  holder.scale.setScalar(MODELS[kind].scale);
  group.add(holder);
  void template(kind).then((g) => holder.add(g.clone(true)));
  return group;
}

const tmp = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/* What the view needs of the game: how loud something there is to us (1 close, 0 out of earshot), and the ground. */
export type ShotEvents = {
  near(x: number, y: number, z: number): number;
  groundAt(x: number, z: number): number;
};

export class ShotsView {
  readonly group = new THREE.Group();
  private flying = new Map<number, Flying>();
  /* Landings that arrived before the shot did (a late join): resolved on spawn. */
  private early = new Map<number, Flying["end"]>();
  private stuck: { obj: THREE.Object3D; until: number }[] = [];
  private clouds: { x: number; y: number; z: number; until: number }[] = [];
  private scorches: { mesh: THREE.Mesh; at: number }[] = [];
  private scorchMaterial: THREE.MeshBasicMaterial | null = null;
  private clock = 0;

  constructor(
    private fx: Fx,
    private audio: TideAudio,
    private ev: ShotEvents,
  ) {}

  /* One let fly: from the bow, the gun or the hand, with its crack or twang. */
  spawn(msg: { id: number; k: number; p: number[]; by: number; src: number }) {
    const kind = shotFromIndex(msg.k);
    if (!kind) return;
    const [x, y, z, vx, vy, vz] = msg.p;
    const flight: Flight = { x, y, z, vx, vy, vz, gravity: SHOTS[kind].gravity };
    const obj = build(kind);
    const tumble = MODELS[kind].tumble ?? 0;
    const f: Flying = {
      id: msg.id,
      kind,
      flight,
      age: 0,
      obj,
      end: this.early.get(msg.id) ?? null,
      resting: false,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * tumble,
        (Math.random() - 0.5) * tumble,
        (Math.random() - 0.5) * tumble,
      ),
    };
    this.early.delete(msg.id);
    this.flying.set(f.id, f);
    this.group.add(obj);
    this.place(f);
    const near = this.ev.near(x, y, z);
    if (kind === "cannonball") {
      this.fx.muzzle(x, y, z, vx, vy, vz, 1.3);
      this.audio.cannon(near);
    } else if (kind === "stone") this.audio.heave(near);
    else if (kind === "ballista") {
      this.fx.muzzle(x, y, z, vx, vy, vz, 0.4);
      this.audio.loose(true, near);
    } else if (kind === "arrow" || kind === "firearrow" || kind === "bolt")
      this.audio.loose(kind === "bolt", near);
  }

  /* Where it came down. It's shown there when our copy gets that far. */
  land(msg: { id: number; p: number[]; at: number; on: LandOn }) {
    const f = this.flying.get(msg.id);
    const end = { at: msg.at, p: msg.p, on: msg.on };
    if (!f) {
      this.early.set(msg.id, end);
      if (this.early.size > 50) this.early.delete(this.early.keys().next().value as number);
      return;
    }
    f.end = end;
  }

  /* A keg's fuse ran out. */
  boom(msg: { id: number; p: number[] }) {
    const f = this.flying.get(msg.id);
    if (f) this.drop(f);
    const [x, y, z] = msg.p;
    this.burst(x, y, z, SHOTS.keg.blast?.radius ?? 6, false);
  }

  update(dt: number) {
    this.clock += dt;
    for (const f of [...this.flying.values()]) {
      if (f.resting) {
        const p = f.obj.position;
        this.fx.fuse(p.x, p.y + 0.55, p.z, dt);
        if (Math.random() < dt * 5) this.audio.sizzle(this.ev.near(p.x, p.y, p.z));
        /* Long past its fuse with no word: give up on it. */
        f.age += dt;
        if (f.age > (SHOTS[f.kind].fuse ?? 4) + 3) this.drop(f);
        continue;
      }
      f.age += dt;
      if (f.end && f.age >= f.end.at) {
        this.come(f);
        continue;
      }
      if (f.age > SHOTS[f.kind].life + 1) {
        this.drop(f);
        continue;
      }
      this.place(f);
      if (f.kind === "firearrow") {
        const p = f.obj.position;
        this.fx.ember(p.x, p.y, p.z);
      }
    }
    for (let i = this.stuck.length - 1; i >= 0; i--)
      if (this.stuck[i].until < this.clock) {
        this.group.remove(this.stuck[i].obj);
        this.stuck.splice(i, 1);
      }
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      const left = c.until - this.clock;
      if (left <= 0) {
        this.clouds.splice(i, 1);
        continue;
      }
      this.fx.cloud(c.x, c.y, c.z, SMOKE.radius, dt, Math.min(1, left / 1.5));
    }
    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const s = this.scorches[i];
      const t = (this.clock - s.at) / SCORCH_TIME;
      if (t >= 1) {
        this.group.remove(s.mesh);
        (s.mesh.material as THREE.Material).dispose();
        this.scorches.splice(i, 1);
        continue;
      }
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t * t);
    }
  }

  /* Where it is now, pointing the way it's going (arrows), or tumbling (everything else). */
  private place(f: Flying) {
    const p = shotAt(f.flight, f.age);
    f.obj.position.set(p.x, p.y, p.z);
    if (MODELS[f.kind].tumble) {
      f.obj.rotation.set(f.spin.x * f.age, f.spin.y * f.age, f.spin.z * f.age);
      return;
    }
    const v = shotVel(f.flight, f.age);
    f.obj.lookAt(tmp.set(p.x + v.x, p.y + v.y, p.z + v.z));
  }

  /* It's got there: an arrow stays put, a ball bursts, a keg lies down to wait. */
  private come(f: Flying) {
    const end = f.end as NonNullable<Flying["end"]>;
    const [x, y, z] = end.p;
    const spec = SHOTS[f.kind];
    const near = this.ev.near(x, y, z);
    if (spec.rests) {
      if (end.on === "water") {
        this.fx.splash(x, z, 0.6);
        this.audio.splash(0.3 * near);
        this.drop(f);
        return;
      }
      if (spec.smoke) {
        this.clouds.push({ x, y, z, until: this.clock + SMOKE.time });
        this.audio.hiss(near);
        this.drop(f);
        return;
      }
      f.resting = true;
      f.obj.position.set(x, y, z);
      f.obj.rotation.set(0, Math.random() * Math.PI * 2, 0);
      this.audio.thud();
      return;
    }
    if (spec.blast) {
      this.drop(f);
      this.burst(x, y, z, spec.blast.radius, end.on === "water");
      return;
    }
    if (end.on === "water") {
      this.fx.splash(x, z, f.kind === "ballista" ? 0.6 : 0.25);
      this.audio.thock("water", near);
      this.drop(f);
      return;
    }
    const hard = end.on === "ground" || end.on === "solid" || end.on === "item";
    this.audio.thock(end.on === "solid" ? "hard" : "soft", near);
    if (!spec.sticks || !hard || end.on === "air") {
      this.drop(f);
      return;
    }
    /* Left where it struck, a little way in, pointing the way it flew. */
    this.flying.delete(f.id);
    const v = shotVel(f.flight, end.at);
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    const sink = f.kind === "ballista" ? 0.7 : 0.25;
    f.obj.position.set(x + (v.x / len) * sink, y + (v.y / len) * sink, z + (v.z / len) * sink);
    f.obj.lookAt(tmp.set(f.obj.position.x + v.x, f.obj.position.y + v.y, f.obj.position.z + v.z));
    this.stuck.push({ obj: f.obj, until: this.clock + STUCK_TIME });
    if (this.stuck.length > STUCK_MAX) {
      const old = this.stuck.shift();
      if (old) this.group.remove(old.obj);
    }
  }

  private drop(f: Flying) {
    this.flying.delete(f.id);
    this.group.remove(f.obj);
  }

  /* A blast: fire and smoke, the bang, and a scorch on the ground. */
  private burst(x: number, y: number, z: number, radius: number, wet: boolean) {
    const ground = this.ev.groundAt(x, z);
    const wetNow = wet || ground < SEA_LEVEL - 0.2;
    this.fx.explode(x, Math.max(y, wetNow ? SEA_LEVEL : ground), z, radius, wetNow);
    if (wetNow) this.fx.splash(x, z, 1.4);
    this.audio.blast(this.ev.near(x, y, z));
    if (!wetNow && Math.abs(y - ground) < 2.5) this.scorch(x, ground, z, radius);
  }

  private scorch(x: number, y: number, z: number, radius: number) {
    if (!this.scorchMaterial) {
      const map = new THREE.TextureLoader().load("/fx/scorch-01.png");
      map.colorSpace = THREE.SRGBColorSpace;
      this.scorchMaterial = new THREE.MeshBasicMaterial({
        map,
        color: 0x0c0a08,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    }
    const mesh = new THREE.Mesh(SCORCH_GEO, this.scorchMaterial.clone());
    mesh.position.set(x, y + 0.06, z);
    mesh.quaternion.setFromUnitVectors(tmp.set(0, 0, 1), UP);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.scale.setScalar(radius * 1.1);
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.scorches.push({ mesh, at: this.clock });
    if (this.scorches.length > SCORCH_MAX) {
      const old = this.scorches.shift();
      if (old) {
        this.group.remove(old.mesh);
        (old.mesh.material as THREE.Material).dispose();
      }
    }
  }

  clear() {
    for (const f of this.flying.values()) this.group.remove(f.obj);
    this.flying.clear();
    this.early.clear();
    for (const s of this.stuck) this.group.remove(s.obj);
    this.stuck = [];
    this.clouds = [];
    for (const s of this.scorches) {
      this.group.remove(s.mesh);
      (s.mesh.material as THREE.Material).dispose();
    }
    this.scorches = [];
  }
}

const SCORCH_GEO = new THREE.PlaneGeometry(1, 1);
