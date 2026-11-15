import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../../shared/math";
import {
  type Block,
  LIGHTHOUSE,
  type Structure,
  type Tone,
  toWorld,
} from "../../shared/structures";
import { Batch, compose } from "./batch";
import { inkMaterial, lineMaterial, shared } from "./materials";

/*
 * Meshes for everything planStructures() put on the island. The blocks it
 * emitted (walls, stairs, decks) are drawn as-is; each kind then gets its
 * decoration: roofs, sails, lattice, ribs, rails.
 */

/* Plain world-space line segments, for lattices, rails, wires and ribs. */
class Lines {
  readonly points: number[] = [];

  seg(a: THREE.Vector3Like, b: THREE.Vector3Like) {
    this.points.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  loop(pts: THREE.Vector3Like[]) {
    for (let k = 0; k < pts.length; k++) this.seg(pts[k], pts[(k + 1) % pts.length]);
  }

  build(material: THREE.Material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.points, 3));
    return new THREE.LineSegments(geo, material);
  }
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/* A triangular prism along z: a pitched roof `width` wide rising `rise`. */
function prism(width: number, rise: number, length: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  geo.translate(0, 0, -length / 2);
  return geo;
}

/* Centred on the block's mid-height, except floors with a hatch (bottom at 0). */
function blockGeometry(b: Block) {
  const h = b.top - b.bottom;
  if (b.hole) {
    const shape = new THREE.Shape();
    if (b.shape === "box") {
      shape.moveTo(-b.hx, -b.hz);
      shape.lineTo(b.hx, -b.hz);
      shape.lineTo(b.hx, b.hz);
      shape.lineTo(-b.hx, b.hz);
      shape.closePath();
    } else {
      /* Same corners as a CylinderGeometry with this many sides. */
      const n = b.sides ?? 12;
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2;
        if (k === 0) shape.moveTo(Math.sin(t) * b.hx, Math.cos(t) * b.hx);
        else shape.lineTo(Math.sin(t) * b.hx, Math.cos(t) * b.hx);
      }
      shape.closePath();
    }
    const hatch = new THREE.Path();
    hatch.absarc(b.hole.lx, b.hole.lz, b.hole.r, 0, Math.PI * 2, true);
    shape.holes.push(hatch);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: h,
      bevelEnabled: false,
      curveSegments: 10,
    });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, h, 0);
    return geo;
  }
  if (b.shape === "box") return new THREE.BoxGeometry(b.hx * 2, h, b.hz * 2);
  return new THREE.CylinderGeometry(b.hz, b.hx, h, b.sides ?? 12, 1);
}

/* Two long additive cones sweeping round from the lantern. */
function createBeam() {
  const geo = new THREE.CylinderGeometry(0.45, 5, 120, 20, 1, true);
  geo.translate(0, 60, 0);
  geo.rotateZ(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vAlong = position.x / 120.0;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vNormal = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float edge = pow(abs(dot(normalize(vNormal), vView)), 2.0);
        float a = (1.0 - smoothstep(0.0, 1.0, vAlong)) * smoothstep(0.0, 0.04, vAlong) * edge * 0.07;
        gl_FragColor = vec4(vec3(a), 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Group();
  const a = new THREE.Mesh(geo, mat);
  const b = new THREE.Mesh(geo, mat);
  b.rotation.y = Math.PI;
  a.rotation.z = b.rotation.z = -0.06;
  beam.add(a, b);
  beam.renderOrder = 3;
  return beam;
}

type Kit = Record<Tone, Batch> & { lines: Lines; faint: Lines };

export class Structures {
  readonly group = new THREE.Group();
  private sails: THREE.Object3D[] = [];
  private blinkers: { lamp: THREE.Object3D; phase: number }[] = [];
  private beams: THREE.Object3D[] = [];

  constructor(structures: readonly Structure[]) {
    const kit: Kit = {
      dark: new Batch(),
      mid: new Batch(),
      light: new Batch(),
      lines: new Lines(),
      faint: new Lines(),
    };
    const glow: THREE.BufferGeometry[] = [];
    for (const s of structures) {
      for (const b of s.blocks) {
        if (b.hidden) continue;
        const sides = b.shape === "cyl" ? (b.sides ?? 12) : 4;
        kit[b.tone].add(
          blockGeometry(b),
          compose(b.x, b.hole ? b.bottom : (b.bottom + b.top) / 2, b.z, b.rot),
          sides > 8 ? 35 : 20,
        );
      }
      /* Ladders: two rails and rungs. */
      for (const l of s.ladders) {
        const h = l.top - l.bottom + 0.9;
        for (const side of [-1, 1]) {
          const p = toWorld(l.x, l.z, l.rot, 0, side * 0.26);
          kit.dark.add(
            new THREE.BoxGeometry(0.06, h, 0.06),
            compose(p.x, l.bottom + h / 2, p.z, l.rot),
          );
        }
        const a = toWorld(l.x, l.z, l.rot, 0, -0.26);
        const b = toWorld(l.x, l.z, l.rot, 0, 0.26);
        for (let ry = l.bottom + 0.3; ry < l.top + 0.8; ry += 0.32)
          kit.lines.seg(v(a.x, ry, a.z), v(b.x, ry, b.z));
      }
      for (const p of s.lamps) {
        const g = new THREE.OctahedronGeometry(0.09, 0);
        g.translate(p.x, p.y, p.z);
        glow.push(g);
      }
      this.decorate(s, kit);
    }
    if (glow.length) {
      const merged = mergeGeometries(glow);
      for (const g of glow) g.dispose();
      this.group.add(new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: 0xffffff })));
    }

    this.group.add(
      kit.dark.build(inkMaterial(0.05), lineMaterial(0.8)),
      kit.mid.build(inkMaterial(0.15), lineMaterial(0.72)),
      kit.light.build(inkMaterial(0.56, { side: THREE.DoubleSide }), lineMaterial(0.2)),
      kit.lines.build(lineMaterial(0.78)),
      kit.faint.build(lineMaterial(0.42)),
    );
  }

  private lamp(x: number, y: number, z: number, r: number, blink: number | null) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(r, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    lamp.position.set(x, y, z);
    this.group.add(lamp);
    if (blink !== null) this.blinkers.push({ lamp, phase: blink });
  }

  private decorate(s: Structure, k: Kit) {
    const { x, y, z, rot } = s;
    const at = (lx: number, lz: number) => toWorld(x, z, rot, lx, lz);
    const rng = mulberry32(s.variant + s.id * 7919);

    switch (s.kind) {
      case "lighthouse": {
        const P = LIGHTHOUSE;
        const base = y + P.plinthHeight;
        const cap = y + s.h;
        /* A stone rim on the plinth (raised, so it never z-fights the top). */
        const coping = new THREE.CylinderGeometry(
          P.plinthRadius + 0.15,
          P.plinthRadius + 0.15,
          0.24,
          24,
          1,
          true,
        );
        k.light.add(coping, compose(x, base - 0.06, z), 35);
        const rim = new THREE.RingGeometry(P.plinthRadius - 0.45, P.plinthRadius + 0.15, 24, 1);
        rim.rotateX(-Math.PI / 2);
        k.light.add(rim, compose(x, base + 0.06, z), 35);
        /* Glazed lantern: mullions, a domed roof, the lamp and its beam. */
        const r = 1.6;
        const top: THREE.Vector3[] = [];
        const low: THREE.Vector3[] = [];
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const px = x + Math.cos(a) * r;
          const pz = z + Math.sin(a) * r;
          k.lines.seg(v(px, cap, pz), v(px, cap + 2.4, pz));
          top.push(v(px, cap + 2.4, pz));
          low.push(v(px, cap + 0.9, pz));
        }
        k.lines.loop(top);
        k.faint.loop(low);
        k.dark.add(new THREE.ConeGeometry(1.95, 1.3, 16, 1), compose(x, cap + 3.05, z), 35);
        k.dark.add(new THREE.SphereGeometry(0.22, 8, 6), compose(x, cap + 3.85, z), 40);
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.55, 16, 12),
          new THREE.MeshBasicMaterial({ color: 0xffffff }),
        );
        lamp.position.set(x, cap + 1.3, z);
        this.group.add(lamp);
        const beam = createBeam();
        beam.position.copy(lamp.position);
        this.group.add(beam);
        this.beams.push(beam);
        break;
      }
      case "windmill": {
        const R = s.w;
        k.dark.add(new THREE.ConeGeometry(R + 0.2, 3, 16, 1), compose(x, y + s.h + 1.8, z), 35);
        /* Windows punched through the wall on each floor. */
        for (const [h, a] of [
          [3.4, 2.6],
          [7.6, 0.9],
          [7.6, -2.2],
          [11, 0.4],
          [11, 2.9],
        ]) {
          const p = toWorld(x, z, rot + a, 0, -(R - 0.2));
          k.dark.add(new THREE.BoxGeometry(0.6, 0.9, 0.55), compose(p.x, y + h, p.z, rot + a));
        }
        /* Four lattice sails on a hub that faces local -z. */
        const hub = at(0, -(R + 0.35));
        const pivot = new THREE.Group();
        pivot.position.set(hub.x, y + s.h - 1.4, hub.z);
        pivot.rotation.y = rot;
        const sails = new THREE.Group();
        pivot.add(sails);
        const sail = new Batch();
        const frame = new Lines();
        for (let b = 0; b < 4; b++) {
          const a = (b / 4) * Math.PI * 2;
          const c = Math.cos(a);
          const sn = Math.sin(a);
          const along = (d: number, off: number) => v(c * d - sn * off, sn * d + c * off, 0);
          sail.add(
            new THREE.BoxGeometry(8.6, 0.2, 0.2),
            compose(c * 4.3, sn * 4.3, 0, 0, 1, 1, 1, 0, a),
          );
          frame.loop([along(1.6, 0.1), along(8.4, 0.1), along(8.4, 1.5), along(1.6, 1.5)]);
          for (let d = 2.4; d < 8.4; d += 0.85) frame.seg(along(d, 0.1), along(d, 1.5));
          frame.seg(along(1.6, 0.8), along(8.4, 0.8));
        }
        sail.add(
          new THREE.CylinderGeometry(0.45, 0.45, 0.9, 10, 1),
          compose(0, 0, 0, 0, 1, 1, 1, Math.PI / 2),
        );
        sails.add(
          sail.build(inkMaterial(0.05), lineMaterial(0.8)),
          frame.build(lineMaterial(0.85)),
        );
        this.group.add(pivot);
        this.sails.push(sails);
        break;
      }
      case "chapel": {
        k.dark.add(prism(s.w * 2 + 0.9, 3.1, s.d * 2 + 0.8), compose(x, y + s.h, z, rot), 20);
        for (const side of [-1, 1]) {
          for (let i = -1; i <= 1; i++) {
            const p = at(side * (s.w - 0.17), i * 3.2);
            k.dark.add(new THREE.BoxGeometry(0.47, 2, 0.7), compose(p.x, y + 2.8, p.z, rot));
          }
        }
        /* Rose window on the back gable. */
        const rose = at(0, s.d + 0.06);
        k.dark.add(
          new THREE.TorusGeometry(0.9, 0.14, 6, 16),
          compose(rose.x, y + s.h + 1.2, rose.z, rot),
          30,
        );
        const t = at(0, -s.d - 4.6);
        /* Slit windows up the tower, the bell, and the cross on the spire. */
        for (const [h, lx, lz] of [
          [3, -2.3, 0],
          [7.4, 2.3, 0],
          [7.4, 0, -2.3],
        ]) {
          const p = toWorld(t.x, t.z, rot, lx * 0.93, lz * 0.93);
          k.dark.add(
            new THREE.BoxGeometry(lx ? 0.45 : 0.35, 1.3, lx ? 0.35 : 0.45),
            compose(p.x, y + h, p.z, rot),
          );
        }
        k.dark.add(
          new THREE.CylinderGeometry(0.35, 0.8, 1.1, 12, 1, true),
          compose(t.x, y + 11.6, t.z, rot),
          35,
        );
        k.dark.add(new THREE.BoxGeometry(1.4, 0.2, 0.2), compose(t.x, y + 12.3, t.z, rot));
        k.lines.seg(v(t.x, y + 12.3, t.z), v(t.x, y + 11.9, t.z));
        k.lines.seg(v(t.x, y + 19, t.z), v(t.x, y + 20.6, t.z));
        const arm = toWorld(0, 0, rot, 0.5, 0);
        k.lines.seg(v(t.x - arm.x, y + 20.1, t.z - arm.z), v(t.x + arm.x, y + 20.1, t.z + arm.z));
        break;
      }
      case "mast": {
        /* Triangular lattice tapering up to an antenna and a blinking lamp, held by guy wires. */
        const radiusAt = (h: number) =>
          h <= 28 ? 1.8 - 0.9 * (h / 28) : 0.9 - 0.7 * ((h - 28) / 8);
        const legs = (h: number) => {
          const r = radiusAt(h);
          return [0, 1, 2].map((i) => {
            const a = rot + (i / 3) * Math.PI * 2;
            return v(x + Math.cos(a) * r, y + h, z + Math.sin(a) * r);
          });
        };
        const step = 1.5;
        for (let h = 0; h < s.h; h += step) {
          const lo = legs(h);
          const hi = legs(Math.min(s.h, h + step));
          for (let i = 0; i < 3; i++) {
            k.lines.seg(lo[i], hi[i]);
            k.faint.seg(lo[i], hi[(i + 1) % 3]);
            k.faint.seg(hi[i], hi[(i + 1) % 3]);
          }
        }
        for (const h of [17, 22]) {
          const a = rot + Math.PI / 3 + (h === 22 ? 2.1 : 0);
          const r = radiusAt(h) + 0.35;
          k.dark.add(
            new THREE.CylinderGeometry(0.9, 0.9, 0.3, 14, 1),
            compose(x + Math.cos(a) * r, y + h, z + Math.sin(a) * r, -a, 1, 1, 1, 0, Math.PI / 2),
            35,
          );
        }
        for (let i = 0; i < 3; i++) {
          const a = rot + (i / 3) * Math.PI * 2;
          const ax = x + Math.cos(a) * 18;
          const az = z + Math.sin(a) * 18;
          const top = legs(24);
          k.faint.seg(v(top[i].x, top[i].y, top[i].z), v(ax, y + 0.4, az));
          k.mid.add(new THREE.BoxGeometry(0.8, 0.6, 0.8), compose(ax, y + 0.1, az, a));
        }
        this.lamp(x, y + s.h + 0.3, z, 0.32, 0);
        break;
      }
      case "watchtower": {
        const deck = y + s.h;
        /* Cross-braces between the legs. */
        const corners = [
          [-1.6, -1.6],
          [1.6, -1.6],
          [1.6, 1.6],
          [-1.6, 1.6],
        ].map(([lx, lz]) => at(lx, lz));
        for (let i = 0; i < 4; i++) {
          const a = corners[i];
          const b = corners[(i + 1) % 4];
          for (const [h0, h1] of [
            [0.4, 4.4],
            [4.4, 8.4],
          ]) {
            k.faint.seg(v(a.x, y + h0, a.z), v(b.x, y + h1, b.z));
            k.faint.seg(v(b.x, y + h0, b.z), v(a.x, y + h1, a.z));
          }
        }
        this.lamp(x, deck + 2.2, z, 0.18, null);
        break;
      }
      case "house": {
        const { w, d, h } = s;
        for (const side of [-1, 1]) {
          const p = at(side * (w - 0.12), rng() * d * 0.8 - d * 0.4);
          k.dark.add(new THREE.BoxGeometry(0.34, 0.9, 0.8), compose(p.x, y + h * 0.6, p.z, rot));
        }
        if (s.variant === 0) {
          /* A low parapet round the flat roof. */
          const lip = (lx: number, lz: number, len: number, alongX: boolean) => {
            const p = at(lx, lz);
            k.light.add(
              new THREE.BoxGeometry(alongX ? len : 0.18, 0.32, alongX ? 0.18 : len),
              compose(p.x, y + h + 0.16, p.z, rot),
            );
          };
          lip(0, -d + 0.09, w * 2, true);
          lip(w - 0.09, 0, d * 2 - 0.36, false);
          lip(-w + 0.09, 0, d * 2 - 0.36, false);
          lip(-1.1, d - 0.09, w * 2 - 2.2, true);
        } else {
          k.dark.add(
            prism(d * 2 + 0.8, 1.9, w * 2 + 0.6),
            compose(x, y + h, z, rot + Math.PI / 2),
            20,
          );
          const ch = at(w * 0.5, d * 0.3);
          k.mid.add(new THREE.BoxGeometry(0.6, 1.8, 0.6), compose(ch.x, y + h + 1.4, ch.z, rot));
        }
        break;
      }
      case "well": {
        for (const side of [-1, 1]) {
          const p = at(side * 1.05, 0);
          k.dark.add(new THREE.BoxGeometry(0.16, 2.2, 0.16), compose(p.x, y + 1.9, p.z, rot));
        }
        k.dark.add(prism(2.6, 0.8, 1.8), compose(x, y + 3, z, rot + Math.PI / 2), 20);
        const a = at(-1.05, 0);
        const b = at(1.05, 0);
        k.lines.seg(v(a.x, y + 2.2, a.z), v(b.x, y + 2.2, b.z));
        k.lines.seg(v(x, y + 2.2, z), v(x, y + 1.2, z));
        break;
      }
      case "aqueduct": {
        /* Round arches between the piers, hanging from the deck. */
        const spans = s.variant;
        const len = s.w * 2;
        const gap = len / spans - 1.7;
        if (gap > 1.5) {
          for (let i = 0; i < spans; i++) {
            const lx = -s.w + ((i + 0.5) / spans) * len;
            const c = at(lx, 0);
            const r = gap / 2;
            const shape = new THREE.Shape();
            shape.moveTo(-r, 0);
            shape.lineTo(r, 0);
            shape.lineTo(r, -(r + 0.6));
            shape.absarc(0, -(r + 0.6), r, 0, Math.PI, false);
            shape.lineTo(-r, 0);
            const geo = new THREE.ExtrudeGeometry(shape, {
              depth: s.d * 2,
              bevelEnabled: false,
              curveSegments: 10,
            });
            geo.translate(0, 0, -s.d);
            k.light.add(geo, compose(c.x, s.h - 0.8, c.z, rot), 30);
          }
        }
        /* The water channel along the top. */
        for (const side of [-1, 1]) {
          const a = at(-s.w, side * (s.d - 0.15));
          const b = at(s.w, side * (s.d - 0.15));
          k.faint.seg(v(a.x, s.h + 0.3, a.z), v(b.x, s.h + 0.3, b.z));
        }
        break;
      }
      case "wreck": {
        this.hull(s, k, rng);
        break;
      }
      case "jetty": {
        /* Piles down into the sea, planks across, a lamp at the end. */
        for (let lx = -s.w + 1; lx <= s.w; lx += 3.5) {
          for (const side of [-1, 1]) {
            const p = at(lx, side * (s.d + 0.1));
            k.dark.add(
              new THREE.CylinderGeometry(0.17, 0.2, 9, 6, 1),
              compose(p.x, y - 4.2, p.z, 0),
              40,
            );
          }
        }
        for (let lx = -s.w; lx <= s.w; lx += 0.7) {
          const a = at(lx, -s.d);
          const b = at(lx, s.d);
          k.faint.seg(v(a.x, y + 0.01, a.z), v(b.x, y + 0.01, b.z));
        }
        const post = at(s.w - 0.6, s.d - 0.3);
        k.dark.add(new THREE.BoxGeometry(0.14, 2.6, 0.14), compose(post.x, y + 1.3, post.z, rot));
        this.lamp(post.x, y + 2.75, post.z, 0.2, 2.1);
        break;
      }
      case "henge":
        break;
    }
  }

  /* A beached hull lofted from U-shaped sections, holed on one side, listing. */
  private hull(s: Structure, k: Kit, rng: () => number) {
    const L = s.w;
    const B = s.d;
    const stations = 14;
    const ring = 9;
    const section = (u: number) => {
      const half = B * Math.max(0.04, 1 - Math.abs(u) ** 2.4) ** 0.5;
      const keel = -0.3;
      const gunwale = s.h + 0.2 + 0.5 * u * u;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= ring; j++) {
        const t = -Math.PI / 2 + (j / ring) * Math.PI;
        pts.push(v(u * L, keel + (gunwale - keel) * (1 - Math.cos(t)), half * Math.sin(t)));
      }
      return pts;
    };
    const grid = Array.from({ length: stations + 1 }, (_, i) => section(-1 + (2 * i) / stations));
    const pos: number[] = [];
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < stations; i++) {
      for (let j = 0; j < ring; j++) {
        /* Stove-in planks on the upper starboard side. */
        if (j >= ring - 3 && i > 3 && i < 9 && rng() < 0.7) continue;
        const a = grid[i][j];
        const b = grid[i + 1][j];
        const c = grid[i + 1][j + 1];
        const d = grid[i][j + 1];
        tri(a, b, c);
        tri(a, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const matrix = compose(s.x, s.y, s.z, s.rot, 1, 1, 1, 0.05);
    geo.applyMatrix4(matrix);
    const mesh = new THREE.Mesh(geo, inkMaterial(0.07, { side: THREE.DoubleSide }));
    this.group.add(mesh);

    /* Ribs, keel and gunwales as lines. */
    const lines = new Lines();
    const w = (p: THREE.Vector3) => p.clone().applyMatrix4(matrix);
    for (let i = 0; i <= stations; i++) {
      for (let j = 0; j < ring; j++) lines.seg(w(grid[i][j]), w(grid[i][j + 1]));
    }
    for (let i = 0; i < stations; i++) {
      for (const j of [0, Math.floor(ring / 2), ring]) lines.seg(w(grid[i][j]), w(grid[i + 1][j]));
    }
    this.group.add(lines.build(lineMaterial(0.7)));

    /* The broken mast. */
    const mast = toWorld(s.x, s.z, s.rot, 3.2, 0);
    k.dark.add(
      new THREE.CylinderGeometry(0.16, 0.24, 7, 8, 1),
      compose(mast.x, s.y + s.h + 3, mast.z, s.rot, 1, 1, 1, 0.13, 0.42),
      40,
    );
  }

  update(time: number) {
    for (const b of this.beams) b.rotation.y = time * 0.7;
    for (const s of this.sails) s.rotation.z = time * 0.55;
    for (const b of this.blinkers) b.lamp.visible = Math.sin(time * 2.4 + b.phase) > 0.2;
  }
}
