import * as THREE from "three";
import type { Shot } from "../../shared/weapons";
import { packModel } from "./packs";

/*
 * What bows and spells loose, in flight: the pack's arrows (arrow_A and
 * arrow_B), and bolts of magic. The room has already worked out what each one
 * hits and how far it goes; these just fly there, and the hit lands on the
 * room's word as it arrives.
 */

/* Metres per model unit: the arrows are 1.2 model units long, so about 0.75 m. */
const ARROW_SCALE = 0.62;
/* An arrow stays stuck where it lands this long, then fades. */
const STUCK = 4;
const FADE = 0.6;

type Flight = {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  dist: number;
  speed: number;
  age: number;
  /* Arrows stay where they land; bolts burst. */
  arrow: boolean;
  /* The materials to fade, if they belong to this flight alone. */
  fades: THREE.Material[];
};

export type ShotLine = {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  dist: number;
};

const arrows = new Map<string, Promise<THREE.Group>>();
function arrowModel(id: "arrow-a" | "arrow-b") {
  let p = arrows.get(id);
  if (!p) {
    p = packModel(`weapons/${id}`);
    arrows.set(id, p);
    p.catch(() => arrows.delete(id));
  }
  return p;
}

const boltGeometry = new THREE.IcosahedronGeometry(0.16, 1);
const glowGeometry = new THREE.IcosahedronGeometry(0.32, 1);

export class Shots {
  readonly group = new THREE.Group();
  private flights: Flight[] = [];

  constructor() {
    this.group.name = "shots";
    void arrowModel("arrow-a");
    void arrowModel("arrow-b");
  }

  /*
   * Loose one. It starts a little ahead of the eye it was aimed from (so you
   * don't see it from inside), and flies on to where the room says it stops.
   */
  fire(shot: Shot, line: ShotLine) {
    const dir = new THREE.Vector3(line.dx, line.dy, line.dz).normalize();
    const from = new THREE.Vector3(line.x, line.y - 0.12, line.z).addScaledVector(dir, 0.6);
    const dist = Math.max(0, line.dist - 0.6);
    const holder = new THREE.Group();
    const flight: Flight = {
      obj: holder,
      from,
      dir,
      dist,
      speed: shot.speed,
      age: 0,
      arrow: shot.flies !== "bolt",
      fades: [],
    };
    if (shot.flies === "bolt") {
      const core = new THREE.MeshBasicMaterial({ color: 0xfff1e6, transparent: true });
      const glow = new THREE.MeshBasicMaterial({
        color: 0xc9a6ff,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      holder.add(new THREE.Mesh(boltGeometry, core), new THREE.Mesh(glowGeometry, glow));
      flight.fades = [core, glow];
    } else {
      const id = shot.flies;
      void arrowModel(id).then((model) => {
        if (!holder.parent) return;
        const arrow = model.clone(true);
        arrow.scale.setScalar(ARROW_SCALE);
        holder.add(arrow);
      });
    }
    holder.position.copy(from);
    /* Objects look down +Z, which is where the arrows point. */
    holder.lookAt(from.clone().add(dir));
    this.group.add(holder);
    this.flights.push(flight);
  }

  update(dt: number) {
    for (const f of this.flights) {
      f.age += dt;
      const flown = Math.min(f.dist, f.age * f.speed);
      f.obj.position.copy(f.from).addScaledVector(f.dir, flown);
      if (flown < f.dist) {
        if (!f.arrow) f.obj.rotation.z += dt * 9;
        continue;
      }
      /* Landed: a bolt bursts and goes; an arrow sticks, then fades. */
      const since = f.age - f.dist / f.speed;
      if (!f.arrow) {
        const t = since / 0.25;
        f.obj.scale.setScalar(1 + t * 2.5);
        for (const m of f.fades) m.opacity = Math.max(0, 1 - t) * (m === f.fades[1] ? 0.45 : 1);
        if (t >= 1) this.remove(f);
      } else if (since > STUCK + FADE) {
        this.remove(f);
      } else if (since > STUCK) {
        f.obj.scale.setScalar(Math.max(0.01, 1 - (since - STUCK) / FADE));
      }
    }
  }

  private remove(f: Flight) {
    f.obj.removeFromParent();
    for (const m of f.fades) m.dispose();
    f.age = Number.POSITIVE_INFINITY;
    this.flights = this.flights.filter((o) => o !== f);
  }

  dispose() {
    for (const f of [...this.flights]) this.remove(f);
  }
}
