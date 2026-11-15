import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { edges, flatten } from "./materials";

/* Collects pieces in world space and bakes them into one fill mesh + one line mesh. */
export class Batch {
  fills: THREE.BufferGeometry[] = [];
  lines: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, angle = 28) {
    const fill = flatten(geo);
    fill.applyMatrix4(matrix);
    this.fills.push(fill);
    const line = edges(geo, angle);
    line.applyMatrix4(matrix);
    this.lines.push(line);
    geo.dispose();
  }

  build(fill: THREE.Material, line: THREE.Material) {
    const group = new THREE.Group();
    if (this.fills.length) group.add(new THREE.Mesh(mergeGeometries(this.fills), fill));
    if (this.lines.length) group.add(new THREE.LineSegments(mergeGeometries(this.lines), line));
    for (const g of [...this.fills, ...this.lines]) g.dispose();
    return group;
  }
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpE = new THREE.Euler();

export function compose(
  x: number,
  y: number,
  z: number,
  rotY = 0,
  sx = 1,
  sy = 1,
  sz = 1,
  rx = 0,
  rz = 0,
) {
  tmpQ.setFromEuler(tmpE.set(rx, rotY, rz, "YXZ"));
  return tmpM.clone().compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
}
