import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SEA_LEVEL } from "../../shared/constants";
import { hash3, mulberry32, range } from "../../shared/math";
import { groundResources, type Resource } from "../../shared/resources";
import type { Prop, Terrain } from "../../shared/terrain";
import { Batch, compose } from "./batch";
import { inkMaterial, lineMaterial } from "./materials";
import { Structures } from "./structures";

const UP = new THREE.Vector3(0, 1, 0);

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

function segment(
  batch: Batch,
  from: THREE.Vector3,
  to: THREE.Vector3,
  r0: number,
  r1: number,
  sides = 5,
) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r1, r0, len, sides, 1);
  geo.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  batch.add(geo, new THREE.Matrix4().compose(from, q, new THREE.Vector3(1, 1, 1)), 40);
}

/* A dead, wind-bent tree: a leaning trunk that forks two or three times. */
function addTree(batch: Batch, p: Prop) {
  const rng = mulberry32(p.variant);
  const s = p.scale;
  const lean = new THREE.Vector3(range(rng, -0.25, 0.25), 1, range(rng, -0.25, 0.25)).normalize();
  const base = new THREE.Vector3(p.x, p.y, p.z);
  const trunkTop = base.clone().addScaledVector(lean, 3.4 * s);
  segment(batch, base, trunkTop, 0.3 * s, 0.17 * s, 6);

  const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, len);
    segment(batch, from, to, r, r * 0.6, depth > 1 ? 5 : 4);
    if (depth >= 3) return;
    const kids = depth === 0 ? 3 : 2;
    for (let k = 0; k < kids; k++) {
      const a = rng() * Math.PI * 2;
      const spread = range(rng, 0.45, 0.9);
      const next = dir
        .clone()
        .add(new THREE.Vector3(Math.cos(a) * spread, range(rng, 0.05, 0.35), Math.sin(a) * spread))
        .normalize();
      grow(to, next, len * range(rng, 0.55, 0.75), r * 0.6, depth + 1);
    }
  };
  const forks = 2 + Math.floor(rng() * 2);
  for (let f = 0; f < forks; f++) {
    const a = (f / forks) * Math.PI * 2 + rng();
    const dir = new THREE.Vector3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55).normalize();
    grow(trunkTop, dir, range(rng, 1.4, 2.2) * s, 0.15 * s, 1);
  }
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

function addRock(batch: Batch, p: Prop) {
  const geo = rockGeometry(p.variant, p.scale > 2 ? 2 : 1);
  batch.add(
    geo,
    compose(p.x, p.y + p.height * 0.42, p.z, p.rot, p.scale * 0.95, p.height * 0.6, p.scale),
    22,
  );
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
  readonly resources: Resource[];
  private resourceMeshes = new Map<number, { meshes: THREE.InstancedMesh[]; index: number }>();
  private trees = new Map<number, THREE.Group>();
  private structures: Structures;
  private buoys: { group: THREE.Group; phase: number; lamp: THREE.Object3D }[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(terrain: Terrain) {
    this.resources = groundResources(terrain);
    const statics = new Batch();
    for (const p of terrain.props) {
      if (p.kind === "rock") addRock(statics, p);
      else if (p.kind === "tree") {
        const tree = new Batch();
        addTree(tree, p);
        const model = tree.build(inkMaterial(0.055), lineMaterial(0.78));
        this.trees.set(p.id, model);
        this.group.add(model);
      } else if (p.kind === "column") addColumn(statics, p);
    }
    this.group.add(statics.build(inkMaterial(0.055), lineMaterial(0.78)));
    this.addGroundCover();
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

  private addGroundCover() {
    const branches: THREE.BufferGeometry[] = [];
    const branch = (from: THREE.Vector3, to: THREE.Vector3, thickness: number) => {
      const direction = to.clone().sub(from);
      const geometry = new THREE.CylinderGeometry(
        thickness * 0.45,
        thickness,
        direction.length(),
        4,
      );
      geometry.translate(0, direction.length() / 2, 0);
      geometry.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()),
      );
      geometry.translate(from.x, from.y, from.z);
      branches.push(geometry);
    };
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const fork = new THREE.Vector3(Math.cos(a) * 0.17, 0.34 + (i % 3) * 0.04, Math.sin(a) * 0.17);
      const tip = new THREE.Vector3(Math.cos(a) * 0.32, 0.65 + (i % 2) * 0.12, Math.sin(a) * 0.32);
      branch(new THREE.Vector3(0, 0, 0), fork, 0.025);
      branch(fork, tip, 0.014);
      branch(
        fork,
        new THREE.Vector3(Math.cos(a + 0.6) * 0.35, 0.53, Math.sin(a + 0.6) * 0.35),
        0.011,
      );
    }
    const bushGeometry = mergeGeometries(branches);
    for (const geometry of branches) geometry.dispose();
    const stoneGeometry = new THREE.IcosahedronGeometry(1, 0);
    const bushes = new THREE.InstancedMesh(bushGeometry, inkMaterial(0.18), 1800);
    const bushLines = new THREE.InstancedMesh(
      bushGeometry,
      new THREE.MeshBasicMaterial({ color: 0xaaaaaa, wireframe: true }),
      1800,
    );
    const stones = new THREE.InstancedMesh(stoneGeometry, inkMaterial(0.2), 900);
    const stoneLines = new THREE.InstancedMesh(
      stoneGeometry,
      new THREE.MeshBasicMaterial({ color: 0xdddddd, wireframe: true }),
      900,
    );
    let bushCount = 0;
    let stoneCount = 0;
    for (const resource of this.resources) {
      const { x, y, z, rotation, size } = resource;
      if (resource.kind === "bush") {
        const matrix = compose(x, y - 0.05, z, rotation, size, size, size);
        bushes.setMatrixAt(bushCount, matrix);
        bushLines.setMatrixAt(bushCount, matrix);
        this.resourceMeshes.set(resource.id, { meshes: [bushes, bushLines], index: bushCount++ });
      } else {
        const matrix = compose(x, y + size * 0.35, z, rotation, size, size * 0.55, size * 0.8);
        stones.setMatrixAt(stoneCount, matrix);
        stoneLines.setMatrixAt(stoneCount, matrix);
        this.resourceMeshes.set(resource.id, { meshes: [stones, stoneLines], index: stoneCount++ });
      }
    }
    bushes.count = bushLines.count = bushCount;
    stones.count = stoneLines.count = stoneCount;
    for (const mesh of [bushes, bushLines, stones, stoneLines]) mesh.computeBoundingSphere();
    this.group.add(bushes, bushLines, stones, stoneLines);
  }

  removeResource(id: number) {
    const entry = this.resourceMeshes.get(id);
    if (!entry) return;
    const matrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const mesh of entry.meshes) {
      mesh.setMatrixAt(entry.index, matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.resourceMeshes.delete(id);
  }

  hasResource(id: number) {
    return this.resourceMeshes.has(id);
  }

  removeTree(id: number) {
    const tree = this.trees.get(id);
    if (tree) tree.visible = false;
  }

  update(time: number) {
    this.structures.update(time);
    for (const b of this.buoys) {
      b.group.position.y = SEA_LEVEL - 0.25 + Math.sin(time * 1.3 + b.phase) * 0.18;
      b.group.rotation.z = Math.sin(time * 0.9 + b.phase) * 0.08;
      b.group.rotation.x = Math.cos(time * 0.7 + b.phase) * 0.08;
      b.lamp.visible = Math.sin(time * 2.2 + b.phase) > 0.6;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat && "dispose" in mat) mat.dispose();
    });
    for (const d of this.disposables) d.dispose();
  }
}
