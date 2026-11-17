import * as THREE from "three";
import { ROW_SPEED } from "../../shared/boat";
import { SEA_LEVEL } from "../../shared/constants";
import { wrapAngle } from "../../shared/math";
import { Batch, compose } from "./batch";
import { inkMaterial, lineMaterial } from "./materials";

/* The hull's outline from above, bow toward -z. */
const OUTLINE: [number, number][] = [
  [0, -1.95],
  [0.5, -1.35],
  [0.72, -0.3],
  [0.68, 1.2],
  [0.48, 1.85],
  [-0.48, 1.85],
  [-0.68, 1.2],
  [-0.72, -0.3],
  [-0.5, -1.35],
];

function hull(batch: Batch) {
  const shape = new THREE.Shape();
  OUTLINE.forEach(([x, z], i) =>
    i ? shape.lineTo(x * 0.92, -z * 0.92) : shape.moveTo(x * 0.92, -z * 0.92),
  );
  shape.closePath();
  const bottom = new THREE.ExtrudeGeometry(shape, { depth: 0.32, bevelEnabled: false });
  bottom.rotateX(-Math.PI / 2);
  batch.add(bottom, compose(0, -0.28, 0), 25);
  /* Planked sides, flaring out a little, round the outline. */
  for (let i = 0; i < OUTLINE.length; i++) {
    const [ax, az] = OUTLINE[i];
    const [bx, bz] = OUTLINE[(i + 1) % OUTLINE.length];
    const len = Math.hypot(bx - ax, bz - az);
    const a = Math.atan2(bx - ax, bz - az);
    batch.add(
      new THREE.BoxGeometry(0.05, 0.36, len + 0.04),
      compose((ax + bx) / 2, 0.2, (az + bz) / 2, a),
    );
  }
  /* Thwarts: a seat for the rower and one at the bow. */
  batch.add(new THREE.BoxGeometry(1.32, 0.05, 0.28), compose(0, 0.18, 0.45));
  batch.add(new THREE.BoxGeometry(1.2, 0.05, 0.24), compose(0, 0.18, -0.9));
}

function oar() {
  const b = new Batch();
  const shaft = new THREE.CylinderGeometry(0.025, 0.025, 2.3, 5);
  shaft.rotateZ(Math.PI / 2);
  b.add(shaft, compose(1.0, 0, 0));
  b.add(new THREE.BoxGeometry(0.5, 0.02, 0.16), compose(2.0, 0, 0));
  return b;
}

let showMaterials: [THREE.Material, THREE.Material] | null = null;

/*
 * One rowboat on its own, oars at rest, for the marketplace to show. Its
 * geometry is its own to dispose of; the materials are shared and stay.
 */
export function buildRowboat(): THREE.Group {
  showMaterials ??= [inkMaterial(0.11), lineMaterial(0.85)];
  const [fill, line] = showMaterials;
  const h = new Batch();
  hull(h);
  const group = new THREE.Group();
  group.add(h.build(fill, line));
  for (const side of [1, -1]) {
    const o = oar().build(fill, line);
    o.scale.x = side;
    o.position.set(0.66 * side, 0.42, 0.25);
    o.rotation.set(0, 0, -0.25 * side);
    group.add(o);
  }
  return group;
}

type Shown = {
  group: THREE.Group;
  oars: [THREE.Group, THREE.Group];
  x: number;
  z: number;
  rot: number;
  tx: number;
  tz: number;
  trot: number;
  speed: number;
  phase: number;
  rowing: number;
};

/* Rowboats on the sea, a handful at most, each with oars that pull as it moves. */
export class BoatView {
  readonly group = new THREE.Group();
  private boats = new Map<number, Shown>();
  private fill = inkMaterial(0.11);
  private line = lineMaterial(0.85);
  private hullGeo: THREE.Group;
  private oarGeo: THREE.Group;

  constructor() {
    const h = new Batch();
    hull(h);
    this.hullGeo = h.build(this.fill, this.line);
    this.oarGeo = oar().build(this.fill, this.line);
  }

  /* Where a boat is, as the room (or our own rowing) says. `snap` jumps there at once. */
  set(id: number, x: number, z: number, rot: number, speed: number, snap = false) {
    let b = this.boats.get(id);
    if (!b) {
      const group = new THREE.Group();
      group.add(this.hullGeo.clone());
      const oars: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
      oars.forEach((o, i) => {
        const m = this.oarGeo.clone();
        if (i) m.scale.x = -1;
        o.add(m);
        o.position.set(i ? -0.66 : 0.66, 0.42, 0.25);
        group.add(o);
      });
      this.group.add(group);
      b = { group, oars, x, z, rot, tx: x, tz: z, trot: rot, speed, phase: 0, rowing: 0 };
      this.boats.set(id, b);
    }
    b.tx = x;
    b.tz = z;
    b.trot = rot;
    b.speed = speed;
    if (snap) {
      b.x = x;
      b.z = z;
      b.rot = rot;
    }
  }

  /* The same stroke that drives the visible oars, for the seated rower. */
  stroke(id: number) {
    const b = this.boats.get(id);
    if (!b) return 0;
    const drive = b.phase < 0.42;
    const p = drive ? b.phase / 0.42 : (b.phase - 0.42) / 0.58;
    const eased = p * p * (3 - 2 * p);
    return (drive ? -1 + 2 * eased : 1 - 2 * eased) * b.rowing * Math.sign(b.speed || 1);
  }

  clear() {
    for (const id of [...this.boats.keys()]) this.remove(id);
  }

  remove(id: number) {
    const b = this.boats.get(id);
    if (!b) return;
    this.group.remove(b.group);
    this.boats.delete(id);
  }

  update(time: number, dt: number) {
    const k = 1 - Math.exp(-dt * 10);
    for (const [id, b] of this.boats) {
      b.x += (b.tx - b.x) * k;
      b.z += (b.tz - b.z) * k;
      b.rot = wrapAngle(b.rot + wrapAngle(b.trot - b.rot) * k);
      const g = b.group;
      g.position.set(b.x, SEA_LEVEL + Math.sin(time * 1.3 + id) * 0.04, b.z);
      g.rotation.set(
        Math.sin(time * 0.9 + id) * 0.025,
        b.rot,
        Math.cos(time * 1.1 + id) * 0.035,
        "YXZ",
      );
      /* A measured pull through the water, then a slower raised recovery. */
      const targetRowing = Math.min(1, Math.abs(b.speed) / 1.5);
      b.rowing += (targetRowing - b.rowing) * (1 - Math.exp(-dt * 2));
      if (b.rowing > 0.01)
        b.phase = (b.phase + dt * (0.32 + Math.min(1, Math.abs(b.speed) / ROW_SPEED) * 0.1)) % 1;
      const drive = b.phase < 0.42;
      const progress = drive ? b.phase / 0.42 : (b.phase - 0.42) / 0.58;
      const eased = progress * progress * (3 - 2 * progress);
      const stroke = drive ? -1 + 2 * eased : 1 - 2 * eased;
      const sweep = stroke * 0.42 * b.rowing * Math.sign(b.speed || 1);
      const dip =
        (drive ? Math.sin(progress * Math.PI) : -0.16 * Math.sin(progress * Math.PI)) *
        0.18 *
        b.rowing;
      b.oars[0].rotation.set(0, sweep, -0.25 - dip);
      b.oars[1].rotation.set(0, -sweep, 0.25 + dip);
    }
  }

  dispose() {
    this.clear();
    this.hullGeo.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.oarGeo.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.fill.dispose();
    this.line.dispose();
  }
}
