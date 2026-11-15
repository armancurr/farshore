import * as THREE from "three";
import { hash3, mulberry32, range } from "../../shared/math";
import type { Pillar } from "../../shared/protocol";
import type { Prop, Terrain } from "../../shared/terrain";
import { Batch, compose } from "./batch";
import { edges, flatten, inkMaterial, lineMaterial, shared } from "./materials";
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

export type Cairn = { id: number; group: THREE.Group; x: number; y: number; z: number };

function buildCairn(p: Prop, fill: THREE.Material, line: THREE.Material, glow: THREE.Material) {
  const batch = new Batch();
  let y = 0;
  const sizes = [0.62, 0.48, 0.36, 0.24].slice(0, 3 + (p.variant % 2));
  sizes.forEach((r, i) => {
    const h = r * 0.55;
    batch.add(
      rockGeometry(p.id * 31 + i, 0, 0.6),
      compose(0, y + h * 0.6, 0, i * 1.3, r, h, r * 0.9),
      25,
    );
    y += h * 1.15;
  });
  const group = batch.build(fill, line);
  /* A faint shaft of light so you can find them from a distance. */
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 9, 6, 1, true), glow);
  shaft.position.y = 4.5 + y;
  group.add(shaft);
  group.position.set(p.x, p.y, p.z);
  group.rotation.y = p.rot;
  return group;
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
  private cairns = new Map<number, Cairn>();
  private buoys: { group: THREE.Group; phase: number; lamp: THREE.Object3D }[] = [];
  private pillars = new Map<number, { mesh: THREE.Group; born: number; height: number }>();
  private pillarFill = inkMaterial(0.07);
  private pillarLine = lineMaterial(0.9);
  private pillarGeo: THREE.BufferGeometry | null = null;
  private pillarEdges: THREE.BufferGeometry | null = null;
  private glow: THREE.Material;
  private disposables: { dispose(): void }[] = [];

  constructor(terrain: Terrain) {
    const statics = new Batch();
    for (const p of terrain.props) {
      if (p.kind === "rock") addRock(statics, p);
      else if (p.kind === "tree") addTree(statics, p);
      else if (p.kind === "column") addColumn(statics, p);
    }
    this.group.add(statics.build(inkMaterial(0.055), lineMaterial(0.78)));

    this.structures = new Structures(terrain.structures);
    this.group.add(this.structures.group);

    this.glow = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const cairnFill = inkMaterial(0.1);
    const cairnLine = lineMaterial(1);
    for (const p of terrain.cairns) {
      const group = buildCairn(p, cairnFill, cairnLine, this.glow);
      this.group.add(group);
      this.cairns.set(p.id, { id: p.id, group, x: p.x, y: p.y, z: p.z });
    }

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
    this.disposables.push(
      cairnFill,
      cairnLine,
      buoyFill,
      buoyLine,
      this.glow,
      this.pillarFill,
      this.pillarLine,
    );
  }

  setCairnTaken(id: number, taken: boolean) {
    const c = this.cairns.get(id);
    if (c) c.group.visible = !taken;
  }

  /* Basalt: a hexagonal column that grinds up out of the ground. */
  addPillar(p: Pillar, animate: boolean) {
    if (this.pillars.has(p.id)) return;
    if (!this.pillarGeo) {
      const geo = new THREE.CylinderGeometry(1, 1.06, 1, 6, 1);
      geo.translate(0, 0.5, 0);
      this.pillarGeo = flatten(geo);
      this.pillarEdges = edges(geo, 20);
      geo.dispose();
    }
    const h = p.top - p.bottom;
    const mesh = new THREE.Group();
    const fill = new THREE.Mesh(this.pillarGeo, this.pillarFill);
    const line = new THREE.LineSegments(this.pillarEdges!, this.pillarLine);
    mesh.add(fill, line);
    mesh.position.set(p.x, p.bottom, p.z);
    mesh.rotation.y = (p.id * 0.7) % Math.PI;
    mesh.scale.set(p.r, animate ? 0.01 : h, p.r);
    this.group.add(mesh);
    this.pillars.set(p.id, { mesh, born: animate ? performance.now() : 0, height: h });
  }

  update(time: number, tide: number) {
    this.structures.update(time);
    for (const b of this.buoys) {
      b.group.position.y = tide - 0.25 + Math.sin(time * 1.3 + b.phase) * 0.18;
      b.group.rotation.z = Math.sin(time * 0.9 + b.phase) * 0.08;
      b.group.rotation.x = Math.cos(time * 0.7 + b.phase) * 0.08;
      b.lamp.visible = Math.sin(time * 2.2 + b.phase) > 0.6;
    }
    const now = performance.now();
    for (const p of this.pillars.values()) {
      if (!p.born) continue;
      const k = Math.min(1, (now - p.born) / 380);
      const ease = 1 - (1 - k) ** 3;
      p.mesh.scale.y = Math.max(0.01, p.height * ease);
      if (k >= 1) p.born = 0;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && m.geometry !== this.pillarGeo && m.geometry !== this.pillarEdges)
        m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat && "dispose" in mat) mat.dispose();
    });
    this.pillarGeo?.dispose();
    this.pillarEdges?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
