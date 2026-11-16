import * as THREE from "three";
import type { AnimalKind } from "../../shared/items";
import { clamp, wrapAngle } from "../../shared/math";
import { ANIMAL_STATE, type AnimalSnap } from "../../shared/protocol";
import { compose } from "./batch";
import { InstancedModel, type Part } from "./instanced";

const MAX = 32;
const LEG = { fl: 1, fr: 2, bl: 3, br: 4 } as const;
const HEAD = 5;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
/* A cylinder lying along z (the animal's length). */
const barrel = (r0: number, r1: number, len: number, sides = 7) =>
  new THREE.CylinderGeometry(r1, r0, len, sides, 1).rotateX(Math.PI / 2);

/* Four legs hanging from hips at (±x, top, ±z). */
function legs(parts: Part[], x: number, z: number, top: number, w: number) {
  for (const [part, sx, sz] of [
    [LEG.fl, -1, -1],
    [LEG.fr, 1, -1],
    [LEG.bl, -1, 1],
    [LEG.br, 1, 1],
  ] as const) {
    parts.push({
      geo: box(w, top, w),
      matrix: compose(sx * x, top / 2, sz * z),
      part,
      pivot: [sx * x, top, sz * z],
    });
  }
}

/* A deer, facing -z: long legs, a slim barrel, a raised neck and head, antlers. */
function deerParts(): Part[] {
  const parts: Part[] = [];
  parts.push({ geo: barrel(0.23, 0.26, 1.1), matrix: compose(0, 1.08, 0) });
  parts.push({ geo: box(0.08, 0.14, 0.12), matrix: compose(0, 1.18, 0.6, 0, 1, 1, 1, 0.5) });
  legs(parts, 0.14, 0.4, 0.98, 0.075);
  const neck: [number, number, number] = [0, 1.2, -0.42];
  parts.push({
    geo: box(0.15, 0.6, 0.17),
    matrix: compose(0, 1.45, -0.55, 0, 1, 1, 1, -0.45),
    part: HEAD,
    pivot: neck,
  });
  parts.push({
    geo: box(0.17, 0.18, 0.4),
    matrix: compose(0, 1.72, -0.78, 0, 1, 1, 1, 0.15),
    part: HEAD,
    pivot: neck,
  });
  for (const s of [-1, 1]) {
    parts.push({
      geo: new THREE.ConeGeometry(0.05, 0.18, 4),
      matrix: compose(s * 0.11, 1.86, -0.66, 0, 1, 1, 1, 0, s * -0.5),
      part: HEAD,
      pivot: neck,
    });
    /* Antlers: a tine up and one forward. */
    parts.push({
      geo: new THREE.CylinderGeometry(0.012, 0.02, 0.42, 4),
      matrix: compose(s * 0.1, 2.02, -0.7, 0, 1, 1, 1, -0.2, s * -0.35),
      part: HEAD,
      pivot: neck,
      angle: 60,
    });
    parts.push({
      geo: new THREE.CylinderGeometry(0.01, 0.015, 0.22, 4),
      matrix: compose(s * 0.16, 2.08, -0.8, 0, 1, 1, 1, -0.9, s * -0.2),
      part: HEAD,
      pivot: neck,
      angle: 60,
    });
  }
  return parts;
}

/* A boar, facing -z: low and heavy, a bristled ridge, a long snout and tusks. */
function boarParts(): Part[] {
  const parts: Part[] = [];
  parts.push({ geo: barrel(0.32, 0.36, 1.05), matrix: compose(0, 0.66, 0, 0, 1, 1.15, 1) });
  parts.push({ geo: box(0.07, 0.12, 0.8), matrix: compose(0, 1.06, -0.05) });
  parts.push({ geo: box(0.05, 0.16, 0.05), matrix: compose(0, 0.72, 0.56, 0, 1, 1, 1, 0.6) });
  legs(parts, 0.19, 0.32, 0.44, 0.1);
  const neck: [number, number, number] = [0, 0.7, -0.45];
  parts.push({
    geo: box(0.36, 0.34, 0.36),
    matrix: compose(0, 0.66, -0.66),
    part: HEAD,
    pivot: neck,
  });
  parts.push({
    geo: new THREE.CylinderGeometry(0.1, 0.13, 0.3, 6).rotateX(Math.PI / 2),
    matrix: compose(0, 0.58, -0.96),
    part: HEAD,
    pivot: neck,
  });
  for (const s of [-1, 1]) {
    parts.push({
      geo: new THREE.ConeGeometry(0.025, 0.16, 4),
      matrix: compose(s * 0.1, 0.56, -1.0, 0, 1, 1, 1, -0.6, s * 0.4),
      part: HEAD,
      pivot: neck,
    });
    parts.push({
      geo: new THREE.ConeGeometry(0.06, 0.14, 3),
      matrix: compose(s * 0.13, 0.9, -0.6, 0, 1, 1, 1, -0.3, s * -0.4),
      part: HEAD,
      pivot: neck,
    });
  }
  return parts;
}

type Shown = {
  id: number;
  kind: AnimalKind;
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
  phase: number;
  swing: number;
  roll: number;
  head: number;
  seen: number;
};

/* Every animal on the island in four draw calls, eased toward the room's latest word. */
export class HerdView {
  readonly group = new THREE.Group();
  private models: Record<AnimalKind, InstancedModel>;
  private shown = new Map<number, Shown>();
  private stamp = 0;

  constructor() {
    this.models = {
      deer: new InstancedModel(deerParts(), MAX, { tone: 0.13, lineTone: 0.85, animated: true }),
      boar: new InstancedModel(boarParts(), MAX, { tone: 0.06, lineTone: 0.8, animated: true }),
    };
    this.group.add(this.models.deer.group, this.models.boar.group);
  }

  set(snaps: readonly AnimalSnap[]) {
    this.stamp++;
    for (const [id, kind, x, y, z, yaw, state, health] of snaps) {
      let s = this.shown.get(id);
      if (!s) {
        s = {
          id,
          kind: kind === 0 ? "deer" : "boar",
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
          phase: id,
          swing: 0,
          roll: 0,
          head: 0,
          seen: this.stamp,
        };
        this.shown.set(id, s);
      }
      s.tx = x;
      s.ty = y;
      s.tz = z;
      s.tyaw = yaw;
      s.state = state;
      s.health = health;
      s.seen = this.stamp;
    }
    for (const [id, s] of this.shown) if (s.seen !== this.stamp) this.shown.delete(id);
  }

  list(): ReadonlyMap<number, Shown> {
    return this.shown;
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 12);
    const counts = { deer: 0, boar: 0 };
    for (const s of this.shown.values()) {
      const px = s.x;
      const pz = s.z;
      s.x += (s.tx - s.x) * k;
      s.y += (s.ty - s.y) * k;
      s.z += (s.tz - s.z) * k;
      s.yaw = wrapAngle(s.yaw + wrapAngle(s.tyaw - s.yaw) * k);
      const speed = dt > 0 ? Math.hypot(s.x - px, s.z - pz) / dt : 0;
      const dead = s.state === ANIMAL_STATE.dead;
      s.phase += speed * (s.kind === "deer" ? 2.4 : 4.2) * dt;
      s.swing += (clamp(speed / 5, 0, 1) * 0.65 - s.swing) * Math.min(1, dt * 8);
      s.roll += ((dead ? Math.PI / 2 : 0) - s.roll) * Math.min(1, dt * 6);
      const head =
        s.state === ANIMAL_STATE.graze
          ? -0.75
          : s.state === ANIMAL_STATE.charge
            ? -0.3
            : s.state === ANIMAL_STATE.alert
              ? 0.15
              : 0;
      s.head += (head - s.head) * Math.min(1, dt * 4);

      const m = this.models[s.kind];
      const i = counts[s.kind]++;
      if (i >= m.max) continue;
      m.inst[i * 4] = s.x;
      m.inst[i * 4 + 1] = s.y - (dead ? 0.2 : 0);
      m.inst[i * 4 + 2] = s.z;
      m.inst[i * 4 + 3] = s.yaw;
      const a = m.anim!;
      a[i * 4] = s.phase;
      a[i * 4 + 1] = dead ? 0 : s.swing;
      a[i * 4 + 2] = s.roll;
      a[i * 4 + 3] = s.head;
    }
    this.models.deer.commit(counts.deer);
    this.models.boar.commit(counts.boar);
  }

  clear() {
    this.shown.clear();
    this.update(0);
  }

  dispose() {
    this.models.deer.dispose();
    this.models.boar.dispose();
  }
}
