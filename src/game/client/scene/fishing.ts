import * as THREE from "three";
import { SEA_LEVEL } from "../../shared/constants";
import type { LineState } from "../../shared/protocol";
import { Batch, compose } from "./batch";
import { inkMaterial, lineMaterial } from "./materials";

const SEGMENTS = 18;
const FLIGHT = 0.55;

type Cast = {
  float: THREE.Group;
  line: THREE.LineSegments;
  positions: Float32Array;
  x: number;
  z: number;
  state: LineState;
  castAt: number;
  /* Where the line left the rod when it was cast, for the float's flight. */
  from: THREE.Vector3;
};

/*
 * Fishing lines in the water: a float bobbing on the surface (ducking under
 * when something bites) and a sagging line back to the rod tip.
 */
export class FishingLines {
  readonly group = new THREE.Group();
  private casts = new Map<number, Cast>();
  private floatFill = inkMaterial(0.5, { lit: 0.05 });
  private floatLine = lineMaterial(0.95);
  private lineMat = lineMaterial(0.85, 0.75);
  private floatGeo: THREE.Group;
  private tmp = new THREE.Vector3();

  constructor() {
    const b = new Batch();
    b.add(new THREE.SphereGeometry(0.09, 8, 6), compose(0, 0, 0), 40);
    b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4, 1), compose(0, 0.13, 0));
    this.floatGeo = b.build(this.floatFill, this.floatLine);
  }

  set(by: number, x: number, z: number, state: LineState, from: THREE.Vector3) {
    let c = this.casts.get(by);
    if (state === "none") {
      if (c) {
        this.group.remove(c.float, c.line);
        c.line.geometry.dispose();
        this.casts.delete(by);
      }
      return;
    }
    if (!c) {
      const float = this.floatGeo.clone();
      const positions = new Float32Array(SEGMENTS * 2 * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const line = new THREE.LineSegments(geo, this.lineMat);
      line.frustumCulled = false;
      this.group.add(float, line);
      c = {
        float,
        line,
        positions,
        x,
        z,
        state,
        castAt: performance.now() / 1000,
        from: from.clone(),
      };
      this.casts.set(by, c);
    }
    c.x = x;
    c.z = z;
    c.state = state;
  }

  has(by: number) {
    return this.casts.has(by);
  }

  /* `tipOf` says where each angler's rod tip is right now, or null to hide the line. */
  update(time: number, tipOf: (by: number, out: THREE.Vector3) => boolean) {
    const now = performance.now() / 1000;
    for (const [by, c] of this.casts) {
      const k = Math.min(1, (now - c.castAt) / FLIGHT);
      let y = SEA_LEVEL - 0.02 + Math.sin(time * 2.4 + by) * 0.03;
      if (c.state === "bite") y -= 0.1 + Math.abs(Math.sin(time * 14)) * 0.12;
      const fx = c.from.x + (c.x - c.from.x) * k;
      const fz = c.from.z + (c.z - c.from.z) * k;
      const fy = k < 1 ? c.from.y + (y - c.from.y) * k + Math.sin(k * Math.PI) * 2.2 : y;
      c.float.position.set(fx, fy, fz);

      const tip = this.tmp;
      const visible = tipOf(by, tip);
      c.line.visible = visible;
      if (!visible) continue;
      /* A slack line: a parabola that sags below the straight path, taut on a bite. */
      const sag = c.state === "bite" ? 0.15 : 0.9 * k;
      const p = c.positions;
      let j = 0;
      for (let i = 0; i < SEGMENTS * 2; i++) {
        /* Each segment's two ends: i/2 rounded down, then up. */
        const s = ((i >> 1) + (i & 1)) / SEGMENTS;
        p[j++] = tip.x + (fx - tip.x) * s;
        p[j++] = tip.y + (fy + 0.1 - tip.y) * s - Math.sin(s * Math.PI) * sag;
        p[j++] = tip.z + (fz - tip.z) * s;
      }
      (c.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  clear() {
    for (const by of [...this.casts.keys()]) this.set(by, 0, 0, "none", this.tmp);
  }

  dispose() {
    this.clear();
    this.floatGeo.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.floatFill.dispose();
    this.floatLine.dispose();
    this.lineMat.dispose();
  }
}
