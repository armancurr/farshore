import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  edges,
  flatten,
  INK_FRAGMENT,
  LINE_FRAGMENT,
  lineColor,
  shared,
  toneColor,
} from "./materials";

/*
 * One model drawn many times in two draw calls (fill and ink lines), whatever
 * the count. Each copy has a position and a heading (`aInst`); animated models
 * also get `aAnim` (leg phase, swing, roll, head tilt) and swing their legs
 * and head in the vertex shader, so nothing is rebuilt per frame.
 *
 * Parts tag their vertices: 0 is the body, 1-4 the legs (1 and 4 swing
 * together, 2 and 3 opposite), 5 the head; each limb turns about its pivot.
 */

export type Part = {
  geo: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  part?: number;
  pivot?: [number, number, number];
  /* Crease angle for the ink lines. */
  angle?: number;
};

const VERTEX = /* glsl */ `
  attribute vec4 aInst;
  #ifdef ANIMATED
    attribute vec4 aAnim;
    attribute float aPart;
    attribute vec3 aPivot;
  #endif
  varying vec3 vWorld;
  #ifdef FILL
    varying vec3 vNormal;
  #endif

  vec3 rotX(vec3 p, vec3 o, float a) {
    vec3 q = p - o;
    float c = cos(a);
    float s = sin(a);
    return o + vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c);
  }
  vec3 rotZ(vec3 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
  }
  vec3 yawed(vec3 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  }

  void main() {
    vec3 p = position;
    #ifdef FILL
      vec3 n = normal;
    #endif
    #ifdef ANIMATED
      if (aPart > 0.5 && aPart < 4.5) {
        float side = (aPart < 1.5 || aPart > 3.5) ? 1.0 : -1.0;
        p = rotX(p, aPivot, sin(aAnim.x) * aAnim.y * side);
      } else if (aPart > 4.5) {
        p = rotX(p, aPivot, aAnim.w);
      }
      p = rotZ(p, aAnim.z);
      #ifdef FILL
        n = rotZ(n, aAnim.z);
      #endif
    #endif
    vec3 world = yawed(p, aInst.w) + aInst.xyz;
    vWorld = world;
    #ifdef FILL
      vNormal = normalize(yawed(n, aInst.w));
    #endif
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

function tag(geo: THREE.BufferGeometry, part: number, pivot: [number, number, number]) {
  const n = geo.attributes.position.count;
  geo.setAttribute("aPart", new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  const pv = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pv.set(pivot, i * 3);
  geo.setAttribute("aPivot", new THREE.BufferAttribute(pv, 3));
  return geo;
}

export class InstancedModel {
  readonly group = new THREE.Group();
  readonly inst: Float32Array;
  readonly anim: Float32Array | null;
  private instAttr: THREE.InstancedBufferAttribute;
  private animAttr: THREE.InstancedBufferAttribute | null = null;
  private geos: THREE.InstancedBufferGeometry[] = [];
  private mats: THREE.ShaderMaterial[] = [];
  count = 0;

  constructor(
    parts: Part[],
    readonly max: number,
    o: {
      tone: number;
      lineTone: number;
      animated?: boolean;
      lit?: number;
      side?: THREE.Side;
      color?: THREE.ColorRepresentation;
    },
  ) {
    const animated = !!o.animated;
    const fills: THREE.BufferGeometry[] = [];
    const lines: THREE.BufferGeometry[] = [];
    for (const p of parts) {
      const fill = flatten(p.geo);
      fill.applyMatrix4(p.matrix);
      const line = edges(p.geo, p.angle ?? 28);
      line.applyMatrix4(p.matrix);
      if (animated) {
        tag(fill, p.part ?? 0, p.pivot ?? [0, 0, 0]);
        tag(line, p.part ?? 0, p.pivot ?? [0, 0, 0]);
      }
      fills.push(fill);
      lines.push(line);
      p.geo.dispose();
    }
    this.inst = new Float32Array(max * 4);
    this.instAttr = new THREE.InstancedBufferAttribute(this.inst, 4);
    this.instAttr.setUsage(THREE.DynamicDrawUsage);
    if (animated) {
      this.anim = new Float32Array(max * 4);
      this.animAttr = new THREE.InstancedBufferAttribute(this.anim, 4);
      this.animAttr.setUsage(THREE.DynamicDrawUsage);
    } else this.anim = null;

    const defines = animated ? { ANIMATED: "" } : {};
    const fillMat = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        uColor: { value: o.color !== undefined ? new THREE.Color(o.color) : toneColor(o.tone) },
        uLit: { value: o.lit ?? 0 },
        uOpacity: { value: 1 },
      },
      defines: { ...defines, FILL: "" },
      vertexShader: VERTEX,
      fragmentShader: INK_FRAGMENT,
      side: o.side ?? THREE.FrontSide,
    });
    const lineMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uColor: { value: lineColor(o.lineTone) }, uOpacity: { value: 1 } },
      defines,
      vertexShader: VERTEX,
      fragmentShader: LINE_FRAGMENT,
    });
    this.mats.push(fillMat, lineMat);

    const fill = this.instanced(mergeGeometries(fills));
    const line = this.instanced(mergeGeometries(lines));
    for (const g of [...fills, ...lines]) g.dispose();
    const fillMesh = new THREE.Mesh(fill, fillMat);
    const lineMesh = new THREE.LineSegments(line, lineMat);
    for (const m of [fillMesh, lineMesh]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  private instanced(src: THREE.BufferGeometry) {
    const g = new THREE.InstancedBufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
    g.setAttribute("aInst", this.instAttr);
    if (this.animAttr) g.setAttribute("aAnim", this.animAttr);
    g.instanceCount = 0;
    this.geos.push(g);
    return g;
  }

  /* After writing `inst` (and `anim`) for the first `count` copies. */
  commit(count: number) {
    this.count = Math.min(count, this.max);
    for (const g of this.geos) g.instanceCount = this.count;
    this.group.visible = this.count > 0;
    this.instAttr.addUpdateRange(0, this.count * 4);
    this.instAttr.needsUpdate = true;
    if (this.animAttr) {
      this.animAttr.addUpdateRange(0, this.count * 4);
      this.animAttr.needsUpdate = true;
    }
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
