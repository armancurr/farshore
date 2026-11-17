import * as THREE from "three";
import { BIKE_WHEELBASE, bikeWheelContacts, createBike, type BikeState } from "../../shared/bike";
import { wrapAngle } from "../../shared/math";
import type { BikeSnap } from "../../shared/protocol";
import type { Ground } from "../../shared/terrain";
import { Batch, compose } from "./batch";
import { inkMaterial, lineMaterial } from "./materials";

let materials: [THREE.Material, THREE.Material, THREE.Material] | null = null;

/** Angular rally silhouette, exposed tube frame, knobbly tires, pale number
 * plate and tank. Uses the same lit ink and outline shaders as the island. */
export function buildDesertBike() {
  materials ??= [inkMaterial(0.075), inkMaterial(0.48), lineMaterial(0.82)];
  const [dark, pale, line] = materials;
  const root = new THREE.Group();
  const chassis = new Batch(),
    body = new Batch();
  const tube = (a: number[], b: number[], radius = 0.035) => {
    const start = new THREE.Vector3(...a),
      end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const matrix = new THREE.Matrix4().compose(
      start.add(end).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.clone().normalize(),
      ),
      new THREE.Vector3(1, 1, 1),
    );
    chassis.add(new THREE.CylinderGeometry(radius, radius, direction.length(), 6), matrix);
  };
  for (const side of [-0.17, 0.17]) {
    tube([side, 0.47, 0.78], [side, 0.66, -0.4]);
    tube([side, 0.66, -0.4], [side, 1.12, -0.48]);
    tube([side, 1.12, -0.48], [side, 1.02, 0.58]);
    tube([side, 1.02, 0.58], [side, 0.47, 0.78]);
    tube([side, 0.55, 0.08], [side, 1.02, 0.58]);
  }
  // Finned engine, skid plate, narrow saddle and rear luggage rack.
  chassis.add(new THREE.BoxGeometry(0.42, 0.35, 0.4), compose(0, 0.65, 0.04));
  for (let i = 0; i < 5; i++)
    body.add(new THREE.BoxGeometry(0.45, 0.018, 0.39), compose(0, 0.52 + i * 0.055, 0.04));
  chassis.add(new THREE.BoxGeometry(0.43, 0.07, 0.6), compose(0, 0.43, 0.08));
  chassis.add(new THREE.BoxGeometry(0.35, 0.12, 0.75), compose(0, 1.06, 0.3));
  body.add(new THREE.BoxGeometry(0.42, 0.3, 0.5), compose(0, 1.03, -0.3, 0, 1, 1, 1, -0.12));
  body.add(new THREE.BoxGeometry(0.32, 0.07, 0.42), compose(0, 0.93, 0.87, 0, 1, 1, 1, 0.16));
  chassis.add(new THREE.BoxGeometry(0.48, 0.05, 0.34), compose(0, 1.09, 0.86));
  tube([0.27, 0.65, 0.24], [0.27, 0.9, 0.83], 0.065);
  // Coil-over shock and engine protection bars.
  tube([0, 0.52, 0.6], [0, 0.96, 0.35], 0.065);
  tube([-0.36, 0.53, 0.15], [0.36, 0.53, 0.15], 0.04);
  root.add(chassis.build(dark, line), body.build(pale, line));

  const wheel = (name: string) => {
    const b = new Batch(),
      spokes = new Batch();
    const tire = new THREE.TorusGeometry(0.32, 0.095, 5, 16);
    tire.rotateY(Math.PI / 2);
    b.add(tire, compose(0, 0, 0));
    const hub = new THREE.CylinderGeometry(0.095, 0.095, 0.22, 8);
    hub.rotateZ(Math.PI / 2);
    spokes.add(hub, compose(0, 0, 0));
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6;
      b.add(
        new THREE.BoxGeometry(0.19, 0.065, 0.11),
        compose(0, Math.cos(angle) * 0.4, Math.sin(angle) * 0.4, 0, 1, 1, 1, angle),
      );
      spokes.add(new THREE.BoxGeometry(0.025, 0.56, 0.018), compose(0, 0, 0, 0, 1, 1, 1, angle));
    }
    const g = new THREE.Group();
    g.name = name;
    g.add(b.build(dark, line), spokes.build(pale, line));
    return g;
  };
  const rear = wheel("rear-wheel");
  rear.position.set(0, 0.44, 0.825);
  root.add(rear);
  const steering = new THREE.Group();
  steering.name = "steering";
  steering.position.set(0, 0, -0.825);
  const front = wheel("front-wheel");
  front.position.y = 0.44;
  steering.add(front);
  const forks = new Batch(),
    plate = new Batch();
  for (const side of [-0.16, 0.16]) {
    forks.add(
      new THREE.CylinderGeometry(0.035, 0.045, 0.86, 6),
      compose(side, 0.84, 0.12, 0, 1, 1, 1, 0.27),
    );
  }
  forks.add(new THREE.BoxGeometry(0.86, 0.045, 0.07), compose(0, 1.28, 0.22));
  for (const side of [-1, 1])
    forks.add(new THREE.BoxGeometry(0.2, 0.065, 0.08), compose(side * 0.4, 1.28, 0.22));
  plate.add(new THREE.BoxGeometry(0.32, 0.32, 0.055), compose(0, 1.12, -0.02, 0, 1, 1, 1, -0.14));
  plate.add(new THREE.BoxGeometry(0.22, 0.05, 0.64), compose(0, 0.91, -0.08, 0, 1, 1, 1, -0.08));
  steering.add(forks.build(dark, line), plate.build(pale, line));
  root.add(steering);
  return root;
}

type Shown = { root: THREE.Group; pose: BikeState; target: BikeState; spin: number };
export class BikeView {
  readonly group = new THREE.Group();
  private bikes = new Map<number, Shown>();
  set(snap: BikeSnap, immediate = false) {
    const [id, x, y, z, rot, speed, steer, pitch, roll] = snap;
    const target = { x, y, z, rot, speed, steer, pitch, roll };
    let b = this.bikes.get(id);
    if (!b) {
      const root = buildDesertBike();
      this.group.add(root);
      b = { root, pose: createBike(x, y, z, rot), target, spin: 0 };
      this.bikes.set(id, b);
      immediate = true;
    }
    b.target = target;
    if (immediate) Object.assign(b.pose, target);
  }
  pose(id: number) {
    return this.bikes.get(id)?.pose;
  }
  update(dt: number, terrain?: Ground) {
    const k = 1 - Math.exp(-dt * 22);
    for (const b of this.bikes.values()) {
      const p = b.pose,
        t = b.target;
      for (const field of ["x", "y", "z", "speed", "steer", "pitch", "roll"] as const)
        p[field] += (t[field] - p[field]) * k;
      p.rot = wrapAngle(p.rot + wrapAngle(t.rot - p.rot) * k);
      b.root.position.set(p.x, p.y, p.z);
      b.root.rotation.set(p.pitch, p.rot, p.roll, "YXZ");
      b.spin -= (p.speed * dt) / 0.415;
      b.root.getObjectByName("rear-wheel")!.rotation.x = b.spin;
      b.root.getObjectByName("front-wheel")!.rotation.x = b.spin;
      b.root.getObjectByName("steering")!.rotation.y = p.steer;
      if (terrain) {
        const contacts = bikeWheelContacts(terrain, p.x, p.z, p.rot);
        // Independent wheel travel keeps the tires planted while the sprung
        // chassis pitches and compresses. Account for the chassis rotation.
        for (const [name, height, lz] of [
          ["front-wheel", contacts.front, -BIKE_WHEELBASE / 2],
          ["rear-wheel", contacts.rear, BIKE_WHEELBASE / 2],
        ] as const) {
          const wheel = b.root.getObjectByName(name)!;
          const y =
            (height + 0.44 - p.y + Math.sin(p.pitch) * lz) / (Math.cos(p.pitch) * Math.cos(p.roll));
          const target = THREE.MathUtils.clamp(y, 0.12, 0.76);
          wheel.position.y += (target - wheel.position.y) * (1 - Math.exp(-dt * 35));
        }
      }
    }
  }
  remove(id: number) {
    const b = this.bikes.get(id);
    if (!b) return;
    this.group.remove(b.root);
    b.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.bikes.delete(id);
  }
  clear() {
    for (const id of this.bikes.keys()) this.remove(id);
  }
  dispose() {
    this.clear();
  }
}
