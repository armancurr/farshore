import * as THREE from "three";
import type { GroundWeapon } from "../../shared/protocol";
import { type WeaponKind, weaponDef } from "../../shared/weapons";
import { Batch, compose } from "./batch";
import { inkMaterial, lineMaterial } from "./materials";

/*
 * The eight weapons as small ink-and-line models (grip at the origin, the
 * business end up +Y), plus the glowing pickups on the ground and the
 * first-person view of whatever you're holding.
 */

type Mats = {
  steel: THREE.Material;
  dark: THREE.Material;
  line: THREE.Material;
  faint: THREE.Material;
};
let mats: Mats | null = null;
function materials(): Mats {
  mats ??= {
    steel: inkMaterial(0.62, { lit: 0.04, side: THREE.DoubleSide }),
    dark: inkMaterial(0.07, { side: THREE.DoubleSide }),
    line: lineMaterial(0.9),
    faint: lineMaterial(0.35),
  };
  return mats;
}

/* A flat blade outline with a point, extruded thin. */
function blade(width: number, length: number, thick = 0.018) {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(width / 2, length * 0.82);
  s.lineTo(0, length);
  s.lineTo(-width / 2, length * 0.82);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  geo.translate(0, 0, -thick / 2);
  return geo;
}

const rod = (r: number, len: number, sides = 6) => {
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1);
  g.translate(0, len / 2, 0);
  return g;
};

export function buildWeapon(kind: WeaponKind): THREE.Group {
  const m = materials();
  const steel = new Batch();
  const dark = new Batch();
  const group = new THREE.Group();
  switch (kind) {
    case "sword":
      dark.add(rod(0.032, 0.2), compose(0, -0.02, 0));
      dark.add(new THREE.BoxGeometry(0.3, 0.045, 0.07), compose(0, 0.2, 0));
      dark.add(new THREE.SphereGeometry(0.045, 8, 6), compose(0, -0.04, 0), 40);
      steel.add(blade(0.075, 0.88), compose(0, 0.22, 0), 20);
      break;
    case "axe": {
      dark.add(rod(0.03, 0.95), compose(0, -0.05, 0));
      const head = new THREE.Shape();
      head.moveTo(0, -0.07);
      head.lineTo(0.12, -0.1);
      head.quadraticCurveTo(0.3, -0.2, 0.32, 0.02);
      head.quadraticCurveTo(0.3, 0.24, 0.12, 0.14);
      head.lineTo(0, 0.1);
      head.closePath();
      const g = new THREE.ExtrudeGeometry(head, { depth: 0.04, bevelEnabled: false });
      g.translate(0, 0, -0.02);
      steel.add(g, compose(0.02, 0.78, 0), 25);
      dark.add(new THREE.BoxGeometry(0.06, 0.12, 0.06), compose(-0.03, 0.8, 0));
      break;
    }
    case "spear":
      dark.add(rod(0.024, 2), compose(0, -0.6, 0));
      steel.add(new THREE.ConeGeometry(0.06, 0.32, 4, 1), compose(0, 1.56, 0), 20);
      dark.add(new THREE.CylinderGeometry(0.035, 0.03, 0.07, 6), compose(0, 1.38, 0));
      break;
    case "hammer":
      dark.add(rod(0.035, 1.1), compose(0, -0.1, 0));
      dark.add(new THREE.BoxGeometry(0.46, 0.24, 0.24), compose(0, 1.02, 0));
      steel.add(new THREE.BoxGeometry(0.06, 0.26, 0.26), compose(0.2, 1.02, 0));
      steel.add(new THREE.BoxGeometry(0.06, 0.26, 0.26), compose(-0.2, 1.02, 0));
      break;
    case "pickaxe": {
      dark.add(rod(0.03, 0.95), compose(0, -0.05, 0));
      const pick = new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6, 1);
      pick.rotateZ(Math.PI / 2);
      steel.add(pick, compose(0, 0.85, 0));
      steel.add(
        new THREE.ConeGeometry(0.035, 0.22, 6),
        compose(0.36, 0.82, 0, 0, 1, 1, 1, 0, -Math.PI / 2 - 0.25),
        30,
      );
      steel.add(
        new THREE.ConeGeometry(0.035, 0.22, 6),
        compose(-0.36, 0.82, 0, 0, 1, 1, 1, 0, Math.PI / 2 + 0.25),
        30,
      );
      break;
    }
    case "daggers":
      dark.add(rod(0.025, 0.12), compose(0, -0.02, 0));
      dark.add(new THREE.BoxGeometry(0.13, 0.03, 0.05), compose(0, 0.1, 0));
      steel.add(blade(0.05, 0.32, 0.012), compose(0, 0.11, 0), 20);
      break;
    case "shield": {
      const disc = new THREE.CylinderGeometry(0.45, 0.45, 0.05, 20, 1);
      disc.rotateX(Math.PI / 2);
      dark.add(disc, compose(0, 0, 0), 35);
      const rim = new THREE.TorusGeometry(0.45, 0.03, 4, 24);
      steel.add(rim, compose(0, 0, 0), 40);
      steel.add(
        new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        compose(0, 0, -0.03, 0, 1, 1, 1, -Math.PI / 2),
        40,
      );
      steel.add(new THREE.BoxGeometry(0.05, 0.84, 0.02), compose(0, 0, -0.03));
      steel.add(new THREE.BoxGeometry(0.84, 0.05, 0.02), compose(0, 0, -0.03));
      break;
    }
    case "flail": {
      dark.add(rod(0.03, 0.45), compose(0, -0.05, 0));
      const head = new THREE.Group();
      head.name = "head";
      head.position.y = 0.42;
      const ball = new Batch();
      ball.add(new THREE.IcosahedronGeometry(0.12, 0), compose(0, -0.45, 0), 25);
      for (const [x, y, z] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
        [0, -1, 0],
      ]) {
        const spike = new THREE.ConeGeometry(0.025, 0.1, 4);
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(x, y, z),
        );
        const mtx = new THREE.Matrix4().compose(
          new THREE.Vector3(x * 0.15, -0.45 + y * 0.15, z * 0.15),
          q,
          new THREE.Vector3(1, 1, 1),
        );
        ball.add(spike, mtx, 30);
      }
      head.add(ball.build(m.steel, m.line));
      const chain = new THREE.BufferGeometry();
      const pts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const y0 = (-i * 0.33) / 6;
        const y1 = (-(i + 1) * 0.33) / 6;
        pts.push(i % 2 ? 0.02 : -0.02, y0, 0, i % 2 ? -0.02 : 0.02, y1, 0);
      }
      chain.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      head.add(new THREE.LineSegments(chain, m.line));
      group.add(head);
      break;
    }
  }
  group.add(steel.build(m.steel, m.line), dark.build(m.dark, m.faint));
  return group;
}

/* ---------- pickups on the ground ---------- */

const BEAM_HEIGHT = 46;

export class WeaponDrops {
  readonly group = new THREE.Group();
  private items = new Map<
    number,
    { root: THREE.Group; spin: THREE.Group; ring: THREE.Mesh; w: GroundWeapon }
  >();
  private beamGeo: THREE.BufferGeometry;
  private beamMat: THREE.ShaderMaterial;
  private ringGeo: THREE.BufferGeometry;
  private ringMat: THREE.MeshBasicMaterial;

  constructor() {
    this.beamGeo = new THREE.CylinderGeometry(0.16, 0.3, BEAM_HEIGHT, 10, 1, true);
    this.beamGeo.translate(0, BEAM_HEIGHT / 2, 0);
    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying float vUp;
        varying float vDist;
        void main() {
          vUp = position.y / ${BEAM_HEIGHT.toFixed(1)};
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          vDist = -view.z;
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vUp;
        varying float vDist;
        void main() {
          /* Bright from afar, a faint shaft when you're standing in it. */
          float a = pow(1.0 - vUp, 2.2) * 0.32 * mix(0.12, 1.0, smoothstep(2.0, 16.0, vDist));
          gl_FragColor = vec4(vec3(a), 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.ringGeo = new THREE.RingGeometry(0.8, 0.86, 40);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  add(w: GroundWeapon) {
    if (this.items.has(w.id)) return;
    const root = new THREE.Group();
    root.position.set(w.x, w.y, w.z);
    const spin = new THREE.Group();
    const model = buildWeapon(w.kind);
    const len = w.kind === "spear" ? 0.55 : w.kind === "daggers" ? 1.6 : 1;
    model.scale.setScalar(len);
    model.position.y = -0.4 * len;
    spin.add(model);
    spin.position.y = 1;
    spin.rotation.z = w.kind === "shield" ? 0 : 0.5;
    const beam = new THREE.Mesh(this.beamGeo, this.beamMat);
    beam.renderOrder = 3;
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat.clone());
    ring.position.y = 0.05;
    root.add(spin, beam, ring);
    this.group.add(root);
    this.items.set(w.id, { root, spin, ring, w });
  }

  remove(id: number) {
    const item = this.items.get(id);
    if (!item) return;
    this.group.remove(item.root);
    (item.ring.material as THREE.Material).dispose();
    this.items.delete(id);
  }

  clear() {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  list() {
    return [...this.items.values()].map((i) => i.w);
  }

  nearest(x: number, y: number, z: number, reach: number) {
    let best: GroundWeapon | null = null;
    let bestD = reach;
    for (const { w } of this.items.values()) {
      const d = Math.hypot(w.x - x, w.z - z);
      if (d < bestD && Math.abs(w.y - y) < 2) {
        best = w;
        bestD = d;
      }
    }
    return best;
  }

  update(time: number) {
    for (const { spin, ring, w } of this.items.values()) {
      spin.rotation.y = time * 1.4 + w.id;
      spin.position.y = 1 + Math.sin(time * 2 + w.id) * 0.12;
      const k = (time * 0.8 + w.id * 0.37) % 1;
      ring.scale.setScalar(0.6 + k * 1.6);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - k);
    }
  }

  dispose() {
    this.clear();
    this.beamGeo.dispose();
    this.beamMat.dispose();
    this.ringGeo.dispose();
    this.ringMat.dispose();
  }
}

/* ---------- first person ---------- */

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/*
 * The weapon in your hands, drawn in its own little scene after the world so
 * it never clips into walls. It sits far above the sea (y = 1000) so the
 * shaders' below-the-waterline darkening never touches it.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.01, 20);
  private holder = new THREE.Group();
  private right = new THREE.Group();
  private left = new THREE.Group();
  private kind: WeaponKind | null = null;
  private swingAt = -10;
  private heavy = false;
  private side = 1;
  private equipAt = -10;
  private spinAngle = 0;
  private flailHead: THREE.Object3D | null = null;
  private block = 0;

  constructor() {
    this.camera.position.set(0, 1000, 0);
    this.scene.add(this.camera);
    this.camera.add(this.holder);
    this.holder.add(this.right, this.left);
  }

  get visible() {
    return this.kind !== null;
  }

  set(kind: WeaponKind | null) {
    if (kind === this.kind) return;
    this.kind = kind;
    for (const g of [this.right, this.left]) {
      for (const c of [...g.children]) g.remove(c);
    }
    this.flailHead = null;
    if (!kind) return;
    /* Held models are scaled down: they sit half a metre from your eye. */
    const scale: Record<WeaponKind, number> = {
      sword: 0.5,
      axe: 0.5,
      spear: 0.42,
      hammer: 0.45,
      pickaxe: 0.5,
      daggers: 0.85,
      shield: 0.55,
      flail: 0.42,
    };
    const model = buildWeapon(kind);
    model.scale.setScalar(scale[kind]);
    this.right.add(model);
    if (kind === "daggers") {
      const other = buildWeapon(kind);
      other.scale.setScalar(scale[kind]);
      this.left.add(other);
    }
    if (kind === "flail") this.flailHead = model.getObjectByName("head") ?? null;
    if (kind === "shield") {
      this.right.remove(model);
      this.left.add(model);
    }
    this.equipAt = performance.now() / 1000;
  }

  swing(heavy: boolean) {
    this.swingAt = performance.now() / 1000;
    this.heavy = heavy;
    this.side = -this.side;
  }

  update(
    dt: number,
    o: {
      aspect: number;
      bob: number;
      bobAmp: number;
      charge: number | null;
      blocking: boolean;
      kick: number;
    },
  ) {
    this.camera.aspect = o.aspect;
    this.camera.updateProjectionMatrix();
    const kind = this.kind;
    if (!kind) return;
    const now = performance.now() / 1000;
    const def = weaponDef(kind);
    const t = now - this.swingAt;
    const wind = def.windup;
    const strike = 0.13;
    /* 0 → 1 while winding up, 1 → 2 through the strike, 2 → 3 on the way back. */
    const phase =
      t < wind
        ? t / Math.max(wind, 0.001)
        : t < wind + strike
          ? 1 + (t - wind) / strike
          : 2 + Math.min(1, (t - wind - strike) / 0.28);
    const swinging = t < wind + strike + 0.28;
    const up = swinging ? (phase < 1 ? ease(phase) : phase < 2 ? 1 - ease(phase - 1) : 0) : 0;
    const hit = swinging ? (phase < 1 ? 0 : phase < 2 ? ease(phase - 1) : 1 - ease(phase - 2)) : 0;

    const sway = Math.sin(o.bob * 0.5) * 0.02 * o.bobAmp;
    const dip = Math.abs(Math.cos(o.bob * 0.5)) * 0.02 * o.bobAmp;
    const equip = 1 - ease((now - this.equipAt) / 0.35);
    this.block += ((o.blocking ? 1 : 0) - this.block) * Math.min(1, dt * 14);

    const R = this.right;
    const L = this.left;
    R.position.set(0.3 + sway, -0.3 - dip - equip * 0.4, -0.55);
    R.rotation.set(-0.95, 0.15, -0.2);
    L.position.set(-0.3 + sway, -0.3 - dip - equip * 0.4, -0.55);
    L.rotation.set(-0.95, -0.15, 0.2);

    switch (kind) {
      case "sword":
        if (this.heavy) {
          R.rotation.x += up * 1.2 - hit * 1.3;
          R.position.y += up * 0.15 - hit * 0.1;
        } else {
          R.rotation.z += up * -0.9 + hit * 1.8;
          R.rotation.y += up * 0.5 - hit * 0.9;
          R.position.x += up * 0.1 - hit * 0.35;
        }
        break;
      case "axe":
      case "pickaxe":
        /* Back over the shoulder, then down through the target. */
        R.rotation.x += up * 1.2 - hit * 1.4;
        R.position.y += up * 0.2 - hit * 0.15;
        R.position.z += hit * -0.1;
        break;
      case "spear":
        R.rotation.set(-1.45, 0.05, -0.05);
        R.position.set(0.22 + sway, -0.26 - dip - equip * 0.4, -0.25 + up * 0.25 - hit * 0.75);
        break;
      case "hammer": {
        const c = o.charge ?? 0;
        R.rotation.x += 1.2 * Math.max(c, up) - hit * 1.5;
        R.position.y += 0.18 * Math.max(c, up) - hit * 0.2;
        break;
      }
      case "daggers": {
        const g = this.side > 0 ? R : L;
        g.position.z += up * 0.08 - hit * 0.4;
        g.rotation.x += -0.4 * hit;
        L.rotation.x = R.rotation.x;
        break;
      }
      case "shield":
        L.rotation.set(-0.15 * (1 - this.block), 0.5 * (1 - this.block), 0);
        L.position.set(
          -0.32 + 0.24 * this.block + sway,
          -0.32 + 0.12 * this.block - dip - equip * 0.4,
          -0.6 + 0.12 * this.block - hit * 0.35,
        );
        break;
      case "flail": {
        const c = o.charge;
        if (c !== null) this.spinAngle += dt * (6 + c * 14);
        else this.spinAngle *= 0.9;
        if (this.flailHead) {
          this.flailHead.rotation.set(c !== null ? 1.2 : hit * 2, this.spinAngle, 0);
        }
        R.rotation.x -= hit * 0.8;
        break;
      }
    }
    R.rotation.x += o.kick * 0.1;
  }

  dispose() {
    this.set(null);
  }
}
