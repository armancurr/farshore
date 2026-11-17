import * as THREE from "three";
import { SEA_LEVEL } from "../../shared/constants";
import { hash3, mulberry32 } from "../../shared/math";
import type { Prop, Terrain } from "../../shared/terrain";
import { Batch, compose } from "./batch";
import { inkMaterial, lineMaterial } from "./materials";
import { Nature } from "./nature";
import { Structures } from "./structures";

/* Unit rock: an icosahedron with every shared corner nudged the same way, top shaved flat. */
function rockGeometry(seed: number, detail = 1, flatTop = 0.72) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    const z = pos.getZ(k);
    const kx = Math.round(x * 1000);
    const ky = Math.round(y * 1000);
    const kz = Math.round(z * 1000);
    const j = 0.78 + hash3(kx, ky, kz, seed) * 0.4;
    pos.setXYZ(k, x * j, Math.min(y * j, flatTop), z * j);
  }
  return geo;
}

/* A classical column: plinth, fluted shaft, capital — or a broken stump. */
function addColumn(batch: Batch, p: Prop) {
  const r = p.scale * 0.86;
  const h = p.height;
  batch.add(
    new THREE.BoxGeometry(2.3 * p.scale, 0.55, 2.3 * p.scale),
    compose(p.x, p.y + 0.27, p.z, p.rot),
  );
  const broken = p.variant === 1;
  const shaftTop = broken ? h : h - 0.32;
  const shaft = new THREE.CylinderGeometry(r * 0.92, r, shaftTop - 0.55, 12, 1);
  shaft.translate(0, (shaftTop - 0.55) / 2 + 0.55, 0);
  batch.add(shaft, compose(p.x, p.y, p.z, p.rot), 20);
  if (!broken) {
    batch.add(
      new THREE.BoxGeometry(2.1 * p.scale, 0.32, 2.1 * p.scale),
      compose(p.x, p.y + h - 0.16, p.z, p.rot),
    );
  } else {
    /* The fallen drum lies beside it. */
    const rng = mulberry32(p.id * 977);
    const a = rng() * Math.PI * 2;
    const drum = new THREE.CylinderGeometry(r * 0.9, r * 0.9, 1.1, 12, 1);
    batch.add(
      drum,
      compose(
        p.x + Math.cos(a) * 2.2,
        p.y + 0.4 + r * 0.6,
        p.z + Math.sin(a) * 2.2,
        a,
        1,
        1,
        1,
        Math.PI / 2,
        0.3,
      ),
      20,
    );
  }
}

/* A cairn: a few flat stones stacked by whoever was here before. */
function addCairn(batch: Batch, p: Prop) {
  let y = 0;
  const sizes = [0.62, 0.48, 0.36, 0.24].slice(0, 3 + (p.variant % 2));
  sizes.forEach((r, i) => {
    const h = r * 0.55;
    batch.add(
      rockGeometry(p.id * 31 + i, 0, 0.6),
      compose(p.x, p.y + y + h * 0.6, p.z, p.rot + i * 1.3, r, h, r * 0.9),
      25,
    );
    y += h * 1.15;
  });
}

function buildBuoy(fill: THREE.Material, line: THREE.Material) {
  const batch = new Batch();
  const hull = new THREE.CylinderGeometry(0.55, 0.8, 1.1, 10, 1);
  batch.add(hull, compose(0, 0.1, 0), 25);
  const cage = new THREE.CylinderGeometry(0.25, 0.42, 1.8, 4, 1, true);
  batch.add(cage, compose(0, 1.55, 0), 10);
  batch.add(new THREE.ConeGeometry(0.32, 0.4, 4, 1), compose(0, 2.65, 0));
  const group = batch.build(fill, line);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  lamp.position.y = 2.25;
  lamp.name = "lamp";
  group.add(lamp);
  return group;
}

export class WorldProps {
  readonly group = new THREE.Group();
  private structures: Structures;
  private nature: Nature;
  private buoys: { group: THREE.Group; phase: number; lamp: THREE.Object3D }[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(terrain: Terrain) {
    /* Trees, rocks, bushes, grass and flowers: models from the nature pack. */
    this.nature = new Nature(terrain);
    this.group.add(this.nature.group);

    const statics = new Batch();
    for (const p of terrain.props) if (p.kind === "column") addColumn(statics, p);
    this.group.add(statics.build(inkMaterial(0.055), lineMaterial(0.78)));
    const cairns = new Batch();
    for (const p of terrain.props) if (p.kind === "cairn") addCairn(cairns, p);
    this.group.add(cairns.build(inkMaterial(0.1), lineMaterial(0.9)));

    this.structures = new Structures(terrain.structures);
    this.group.add(this.structures.group);

    const buoyFill = inkMaterial(0.08);
    const buoyLine = lineMaterial(0.85);
    for (const p of terrain.props) {
      if (p.kind !== "buoy") continue;
      const group = buildBuoy(buoyFill, buoyLine);
      group.position.set(p.x, 0, p.z);
      group.rotation.y = p.rot;
      this.group.add(group);
      this.buoys.push({ group, phase: p.variant * 1.7, lamp: group.getObjectByName("lamp")! });
    }
    this.disposables.push(buoyFill, buoyLine);
  }

  update(time: number, eye?: THREE.Vector3) {
    this.structures.update(time);
    if (eye) this.nature.update(eye);
    for (const b of this.buoys) {
      b.group.position.y = SEA_LEVEL - 0.25 + Math.sin(time * 1.3 + b.phase) * 0.18;
      b.group.rotation.z = Math.sin(time * 0.9 + b.phase) * 0.08;
      b.group.rotation.x = Math.cos(time * 0.7 + b.phase) * 0.08;
      b.lamp.visible = Math.sin(time * 2.2 + b.phase) > 0.6;
    }
  }

  dispose() {
    this.nature.dispose();
    this.group.remove(this.nature.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat && "dispose" in mat) mat.dispose();
    });
    for (const d of this.disposables) d.dispose();
  }
}
