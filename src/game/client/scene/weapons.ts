import * as THREE from "three";
import { type WeaponKind, weaponDef } from "../../shared/weapons";
import { Batch, compose } from "./batch";
import { inkMaterial, lineMaterial } from "./materials";

/*
 * The weapons as small ink-and-line models (grip at the origin, the business
 * end up +Y), and the first-person view of whatever you're holding.
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

/* A flat outline, extruded thin and centred on z = 0. */
function plate(shape: THREE.Shape, thick: number) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thick,
    bevelEnabled: false,
    curveSegments: 10,
  });
  geo.translate(0, 0, -thick / 2);
  return geo;
}

/* The same outline drawn facing +x and mirrored to face -x, for heads that face both ways. */
function mirrored(draw: (s: THREE.Shape, side: number) => void) {
  return [1, -1].map((side) => {
    const s = new THREE.Shape();
    draw(s, side);
    return s;
  });
}

const rod = (r: number, len: number, sides = 6) => {
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1);
  g.translate(0, len / 2, 0);
  return g;
};

/* A leather or cord wrap round a grip running up +Y from `y0`, one band every `step`. */
function wrap(b: Batch, r: number, y0: number, len: number, step = 0.05) {
  for (let y = y0 + step / 2; y < y0 + len; y += step)
    b.add(new THREE.TorusGeometry(r, 0.006, 3, 10), compose(0, y, 0, 0, 1, 1, 1, Math.PI / 2), 70);
}

/* A diamond-section point (four-sided cone), tip up. */
const point = (r: number, len: number) => new THREE.ConeGeometry(r, len, 4, 1);

export function buildWeapon(kind: WeaponKind): THREE.Group {
  const m = materials();
  const steel = new Batch();
  const dark = new Batch();
  const group = new THREE.Group();
  switch (kind) {
    case "daggers": {
      /* A short, leaf-bladed fighting knife: one for each hand. */
      dark.add(rod(0.022, 0.12), compose(0, -0.02, 0));
      wrap(dark, 0.024, -0.01, 0.1, 0.03);
      dark.add(new THREE.SphereGeometry(0.03, 8, 6), compose(0, -0.035, 0), 40);
      steel.add(new THREE.BoxGeometry(0.13, 0.025, 0.045), compose(0, 0.1, 0));
      const leaf = new THREE.Shape();
      leaf.moveTo(-0.022, 0);
      leaf.lineTo(0.022, 0);
      leaf.quadraticCurveTo(0.036, 0.2, 0, 0.34);
      leaf.quadraticCurveTo(-0.036, 0.2, -0.022, 0);
      steel.add(plate(leaf, 0.012), compose(0, 0.11, 0), 20);
      break;
    }
    case "sickle": {
      /* A turned wooden handle and a thin crescent blade sweeping forward and round. */
      dark.add(
        new THREE.CylinderGeometry(0.026, 0.02, 0.2, 8, 1).translate(0, 0.1, 0),
        compose(0, -0.08, 0),
      );
      dark.add(new THREE.SphereGeometry(0.03, 8, 6), compose(0, -0.09, 0), 40);
      steel.add(new THREE.CylinderGeometry(0.028, 0.028, 0.035, 8, 1), compose(0, 0.13, 0));
      const c = new THREE.Shape();
      c.moveTo(-0.012, 0.14);
      c.quadraticCurveTo(-0.03, 0.42, 0.18, 0.44);
      c.quadraticCurveTo(0.33, 0.44, 0.38, 0.3);
      c.quadraticCurveTo(0.31, 0.38, 0.18, 0.385);
      c.quadraticCurveTo(0.03, 0.37, 0.016, 0.14);
      c.closePath();
      steel.add(plate(c, 0.012), compose(0, 0, 0), 20);
      break;
    }
    case "machete": {
      /* Riveted slab grip, no guard; a broad blade that bellies out toward a clipped tip. */
      const grip = new THREE.BoxGeometry(0.05, 0.16, 0.034);
      grip.translate(0, 0.06, 0);
      dark.add(grip, compose(0, -0.02, 0));
      for (const y of [0.0, 0.08])
        steel.add(
          new THREE.CylinderGeometry(0.008, 0.008, 0.04, 6, 1),
          compose(0, y, 0, 0, 1, 1, 1, Math.PI / 2),
          60,
        );
      steel.add(new THREE.BoxGeometry(0.066, 0.022, 0.03), compose(0.004, 0.13, 0));
      const b = new THREE.Shape();
      b.moveTo(-0.026, 0);
      b.lineTo(0.03, 0);
      b.quadraticCurveTo(0.085, 0.36, 0.068, 0.55);
      b.quadraticCurveTo(0.058, 0.63, 0.005, 0.66);
      b.quadraticCurveTo(-0.022, 0.6, -0.03, 0.54);
      b.lineTo(-0.026, 0);
      steel.add(plate(b, 0.014), compose(0, 0.14, 0), 20);
      break;
    }
    case "boardaxe": {
      /* A short haft and a bearded head: the blade's long lower hook drags people in. */
      dark.add(rod(0.026, 0.82), compose(0, -0.12, 0));
      wrap(dark, 0.028, -0.1, 0.22, 0.04);
      dark.add(new THREE.CylinderGeometry(0.036, 0.03, 0.04, 6, 1), compose(0, -0.13, 0));
      const head = new THREE.Shape();
      head.moveTo(0.028, 0.05);
      head.lineTo(0.09, 0.055);
      head.quadraticCurveTo(0.16, 0.07, 0.2, 0.115);
      head.quadraticCurveTo(0.245, -0.04, 0.175, -0.26);
      head.quadraticCurveTo(0.12, -0.12, 0.06, -0.075);
      head.lineTo(0.028, -0.05);
      head.closePath();
      steel.add(plate(head, 0.03), compose(0, 0.64, 0), 25);
      /* The eye, and a short hooked spike behind it. */
      steel.add(new THREE.BoxGeometry(0.06, 0.11, 0.05), compose(0, 0.64, 0));
      steel.add(point(0.022, 0.12), compose(-0.08, 0.62, 0, 0, 1, 1, 1, 0, Math.PI / 2 + 0.35), 30);
      break;
    }
    case "spear": {
      /* An ash shaft, a binding below a winged socket, and a long leaf head. */
      dark.add(rod(0.024, 2), compose(0, -0.6, 0));
      wrap(dark, 0.026, 1.24, 0.12, 0.03);
      dark.add(new THREE.CylinderGeometry(0.034, 0.028, 0.1, 6), compose(0, 1.38, 0));
      steel.add(new THREE.BoxGeometry(0.16, 0.022, 0.022), compose(0, 1.43, 0));
      const leaf = new THREE.Shape();
      leaf.moveTo(-0.025, 0);
      leaf.lineTo(0.025, 0);
      leaf.quadraticCurveTo(0.07, 0.12, 0, 0.36);
      leaf.quadraticCurveTo(-0.07, 0.12, -0.025, 0);
      steel.add(plate(leaf, 0.02), compose(0, 1.43, 0), 20);
      steel.add(plate(leaf.clone(), 0.02), compose(0, 1.43, 0, Math.PI / 2), 20);
      break;
    }
    case "trident": {
      /* A banded haft, a curved crossbar, and three barbed tines. */
      dark.add(rod(0.024, 1.95), compose(0, -0.6, 0));
      for (const y of [-0.1, 0.5, 1.0])
        steel.add(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8, 1), compose(0, y, 0));
      dark.add(new THREE.CylinderGeometry(0.036, 0.028, 0.12, 8, 1), compose(0, 1.39, 0));
      /* The crossbar: half a ring, open upward. */
      const bar = new THREE.TorusGeometry(0.15, 0.018, 5, 14, Math.PI);
      steel.add(bar, compose(0, 1.6, 0, 0, 1, 1, 1, 0, Math.PI), 35);
      for (const side of [-1, 0, 1]) {
        const x = side * 0.15;
        const base = side ? 1.6 : 1.45;
        const len = side ? 0.2 : 0.38;
        steel.add(rod(0.016, len), compose(x, base, 0));
        steel.add(point(0.032, 0.13), compose(x, base + len + 0.06, 0), 20);
        /* A barb on the outside of each tine (both sides for the middle one). */
        for (const out of side ? [side] : [-1, 1])
          steel.add(
            point(0.014, 0.07),
            compose(x + out * 0.028, base + len + 0.02, 0, 0, 1, 1, 1, 0, Math.PI - out * 0.5),
            30,
          );
      }
      break;
    }
    case "mace": {
      /* A wrapped haft and a flanged head: six steel fins round a core, a knob on top. */
      dark.add(rod(0.026, 0.72), compose(0, -0.12, 0));
      wrap(dark, 0.028, -0.1, 0.24, 0.035);
      dark.add(new THREE.SphereGeometry(0.035, 8, 6), compose(0, -0.13, 0), 40);
      dark.add(rod(0.045, 0.26), compose(0, 0.5, 0));
      const fin = new THREE.Shape();
      fin.moveTo(0.03, 0);
      fin.lineTo(0.07, 0.02);
      fin.lineTo(0.105, 0.11);
      fin.lineTo(0.07, 0.22);
      fin.lineTo(0.03, 0.25);
      fin.closePath();
      for (let k = 0; k < 6; k++)
        steel.add(plate(fin.clone(), 0.018), compose(0, 0.5, 0, (k * Math.PI) / 3), 25);
      steel.add(new THREE.SphereGeometry(0.04, 8, 6), compose(0, 0.78, 0), 40);
      steel.add(new THREE.CylinderGeometry(0.05, 0.05, 0.025, 8, 1), compose(0, 0.49, 0));
      break;
    }
    case "halberd": {
      /* A long pole carrying a cleaver blade, a back hook, and a spike on top. */
      dark.add(rod(0.026, 2.25), compose(0, -0.55, 0));
      wrap(dark, 0.028, 0.05, 0.25, 0.04);
      dark.add(new THREE.CylinderGeometry(0.036, 0.03, 0.1, 6), compose(0, 1.52, 0));
      /* Langets: steel straps running down the pole from the head. */
      for (const z of [-0.028, 0.028])
        steel.add(new THREE.BoxGeometry(0.02, 0.3, 0.006), compose(0, 1.45, z));
      const blade = new THREE.Shape();
      blade.moveTo(0.03, 0.13);
      blade.lineTo(0.12, 0.15);
      blade.lineTo(0.3, 0.26);
      blade.quadraticCurveTo(0.24, 0.02, 0.31, -0.2);
      blade.lineTo(0.12, -0.1);
      blade.lineTo(0.03, -0.08);
      blade.closePath();
      steel.add(plate(blade, 0.022), compose(0, 1.74, 0, 0, 1.4, 1.4, 1), 25);
      const hook = new THREE.Shape();
      hook.moveTo(-0.03, 0.05);
      hook.quadraticCurveTo(-0.14, 0.05, -0.25, -0.08);
      hook.quadraticCurveTo(-0.12, -0.01, -0.03, -0.04);
      hook.closePath();
      steel.add(plate(hook, 0.022), compose(0, 1.74, 0, 0, 1.4, 1.4, 1), 25);
      steel.add(new THREE.BoxGeometry(0.08, 0.3, 0.05), compose(0, 1.74, 0));
      steel.add(point(0.05, 0.5), compose(0, 2.14, 0), 20);
      break;
    }
    case "axe": {
      /* A battle axe: two broad bits either side, a top spike, on a long haft. */
      dark.add(rod(0.03, 1.05), compose(0, -0.12, 0));
      wrap(dark, 0.032, -0.1, 0.3, 0.04);
      for (const head of mirrored((s, side) => {
        s.moveTo(side * 0.03, -0.07);
        s.lineTo(side * 0.11, -0.09);
        s.quadraticCurveTo(side * 0.3, -0.22, side * 0.33, 0.02);
        s.quadraticCurveTo(side * 0.3, 0.26, side * 0.11, 0.13);
        s.lineTo(side * 0.03, 0.1);
        s.closePath();
      }))
        steel.add(plate(head, 0.036), compose(0, 0.78, 0), 25);
      dark.add(new THREE.BoxGeometry(0.07, 0.2, 0.06), compose(0, 0.8, 0));
      steel.add(point(0.03, 0.2), compose(0, 0.98, 0), 20);
      break;
    }
    case "greatsword": {
      /* Two hands of wrapped grip, a heavy pommel, swept quillons, and a long fullered blade. */
      dark.add(rod(0.03, 0.38), compose(0, -0.16, 0));
      wrap(dark, 0.032, -0.15, 0.36, 0.04);
      steel.add(new THREE.OctahedronGeometry(0.06, 0), compose(0, -0.2, 0, Math.PI / 4), 30);
      const guard = new THREE.Shape();
      guard.moveTo(-0.3, 0.07);
      guard.quadraticCurveTo(-0.22, 0.0, 0, 0.0);
      guard.quadraticCurveTo(0.22, 0.0, 0.3, 0.07);
      guard.lineTo(0.3, 0.1);
      guard.quadraticCurveTo(0.2, 0.05, 0, 0.05);
      guard.quadraticCurveTo(-0.2, 0.05, -0.3, 0.1);
      guard.closePath();
      steel.add(plate(guard, 0.05), compose(0, 0.21, 0), 25);
      /* The ricasso, then the blade. */
      steel.add(new THREE.BoxGeometry(0.07, 0.12, 0.024), compose(0, 0.32, 0));
      const b = new THREE.Shape();
      b.moveTo(-0.05, 0);
      b.lineTo(0.05, 0);
      b.lineTo(0.04, 1.2);
      b.lineTo(0, 1.34);
      b.lineTo(-0.04, 1.2);
      b.closePath();
      steel.add(plate(b, 0.02), compose(0, 0.38, 0), 20);
      /* The fuller: a dark groove down both faces. */
      for (const z of [-0.011, 0.011])
        dark.add(new THREE.BoxGeometry(0.016, 0.95, 0.002), compose(0, 0.88, z));
      break;
    }
    case "hammer": {
      /* A long haft, a heavy square head with a spike on top and a beak behind. */
      dark.add(rod(0.035, 1.15), compose(0, -0.12, 0));
      wrap(dark, 0.037, -0.1, 0.3, 0.045);
      for (const z of [-0.035, 0.035])
        steel.add(new THREE.BoxGeometry(0.025, 0.32, 0.006), compose(0, 0.88, z));
      dark.add(new THREE.BoxGeometry(0.46, 0.24, 0.24), compose(0, 1.04, 0));
      steel.add(new THREE.BoxGeometry(0.06, 0.27, 0.27), compose(0.2, 1.04, 0));
      steel.add(new THREE.BoxGeometry(0.06, 0.27, 0.27), compose(-0.2, 1.04, 0));
      steel.add(point(0.05, 0.22), compose(0, 1.27, 0), 20);
      break;
    }
    case "shield": {
      /* A round shield: planked face, an iron rim, a boss, and rivets round the edge. */
      const disc = new THREE.CylinderGeometry(0.45, 0.45, 0.05, 20, 1);
      disc.rotateX(Math.PI / 2);
      dark.add(disc, compose(0, 0, 0), 35);
      steel.add(new THREE.TorusGeometry(0.45, 0.03, 4, 24), compose(0, 0, 0), 40);
      steel.add(
        new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        compose(0, 0, -0.03, 0, 1, 1, 1, -Math.PI / 2),
        40,
      );
      steel.add(new THREE.BoxGeometry(0.05, 0.84, 0.02), compose(0, 0, -0.03));
      steel.add(new THREE.BoxGeometry(0.84, 0.05, 0.02), compose(0, 0, -0.03));
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + Math.PI / 12;
        steel.add(
          new THREE.SphereGeometry(0.016, 6, 4),
          compose(Math.cos(a) * 0.38, Math.sin(a) * 0.38, -0.028),
          50,
        );
      }
      break;
    }
  }
  group.add(steel.build(m.steel, m.line), dark.build(m.dark, m.faint));
  return group;
}

/* How long each weapon is, grip to tip, for framing it in a picture. */
export const WEAPON_SPAN: Record<WeaponKind, { from: number; to: number }> = {
  daggers: { from: -0.06, to: 0.46 },
  sickle: { from: -0.12, to: 0.46 },
  machete: { from: -0.1, to: 0.81 },
  boardaxe: { from: -0.15, to: 0.78 },
  spear: { from: -0.6, to: 1.8 },
  trident: { from: -0.6, to: 1.9 },
  mace: { from: -0.17, to: 0.83 },
  halberd: { from: -0.55, to: 2.39 },
  axe: { from: -0.14, to: 1.1 },
  greatsword: { from: -0.27, to: 1.73 },
  hammer: { from: -0.14, to: 1.39 },
  shield: { from: -0.48, to: 0.48 },
};

/* A fishing rod: cork grip, a reel, a long whippy blank, and a "tip" marker for the line. */
export function buildRod(): THREE.Group {
  const m = materials();
  const steel = new Batch();
  const dark = new Batch();
  const group = new THREE.Group();
  dark.add(rod(0.03, 0.42, 8), compose(0, -0.12, 0));
  const blank = new THREE.CylinderGeometry(0.006, 0.018, 1.5, 6, 1);
  blank.translate(0, 0.75, 0);
  dark.add(blank, compose(0, 0.3, 0));
  const reel = new THREE.CylinderGeometry(0.055, 0.055, 0.05, 12, 1);
  steel.add(reel, compose(0.06, 0.05, 0, 0, 1, 1, 1, 0, Math.PI / 2), 30);
  for (const y of [0.55, 0.95, 1.3, 1.6]) {
    steel.add(new THREE.TorusGeometry(0.018, 0.004, 4, 8), compose(0.02, y, 0, Math.PI / 2), 60);
  }
  group.add(steel.build(m.steel, m.line), dark.build(m.dark, m.faint));
  const tip = new THREE.Object3D();
  tip.name = "tip";
  tip.position.y = 1.8;
  group.add(tip);
  return group;
}

/* ---------- first person ---------- */

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/*
 * The weapon in your hands, drawn in its own little scene after the world so
 * it never clips into walls. It sits far above the sea (y = 1000) so the
 * shaders' below-the-waterline darkening never touches it.
 */
export type HeldModel = WeaponKind | "rod";

/* What a held rod is doing: resting, with a line out, or with something on it. */
export type RodPose = "idle" | "out" | "bite";

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.01, 20);
  private holder = new THREE.Group();
  private right = new THREE.Group();
  private left = new THREE.Group();
  private kind: HeldModel | null = null;
  private tip: THREE.Object3D | null = null;
  private swingAt = -10;
  private heavy = false;
  private side = 1;
  private equipAt = -10;
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

  set(kind: HeldModel | null) {
    if (kind === this.kind) return;
    this.kind = kind;
    for (const g of [this.right, this.left]) {
      for (const c of [...g.children]) g.remove(c);
    }
    this.tip = null;
    if (!kind) return;
    if (kind === "rod") {
      const model = buildRod();
      model.scale.setScalar(0.55);
      this.right.add(model);
      this.tip = model.getObjectByName("tip") ?? null;
      this.equipAt = performance.now() / 1000;
      return;
    }
    /* Held models are scaled down: they sit half a metre from your eye. */
    const scale: Record<WeaponKind, number> = {
      daggers: 0.85,
      sickle: 0.8,
      machete: 0.6,
      boardaxe: 0.55,
      spear: 0.42,
      trident: 0.42,
      mace: 0.6,
      halberd: 0.36,
      axe: 0.5,
      greatsword: 0.42,
      hammer: 0.45,
      shield: 0.55,
    };
    const model = buildWeapon(kind);
    model.scale.setScalar(scale[kind]);
    this.right.add(model);
    if (kind === "daggers") {
      const other = buildWeapon(kind);
      other.scale.setScalar(scale[kind]);
      this.left.add(other);
    }
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
      rod?: RodPose;
    },
  ) {
    this.camera.aspect = o.aspect;
    this.camera.updateProjectionMatrix();
    const kind = this.kind;
    if (!kind) return;
    if (kind === "rod") {
      this.poseRod(o.rod ?? "idle", o.bob, o.bobAmp);
      return;
    }
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
      case "machete":
        if (this.heavy) {
          /* The third swing: up over the head and straight down. */
          R.rotation.x += up * 1.3 - hit * 1.4;
          R.position.y += up * 0.18 - hit * 0.12;
        } else {
          /* A diagonal hack, alternating sides. */
          R.rotation.z += (up * -0.9 + hit * 1.8) * this.side;
          R.rotation.y += (up * 0.5 - hit * 0.9) * this.side;
          R.position.x += (up * 0.1 - hit * 0.35) * this.side;
        }
        break;
      case "sickle": {
        /* Hooked out across the body, then hauled back toward you. */
        const pull = swinging && phase > 2 ? Math.sin((phase - 2) * Math.PI) : 0;
        R.rotation.z += up * -0.6 + hit * 1.5;
        R.rotation.y += up * 0.4 - hit * 0.7;
        R.position.x += up * 0.12 - hit * 0.3;
        R.position.z += pull * 0.14;
        break;
      }
      case "boardaxe": {
        /* Down through the target, then a yank back on the beard. */
        const pull = swinging && phase > 2 ? Math.sin((phase - 2) * Math.PI) : 0;
        R.rotation.x += up * 1.2 - hit * 1.4 + pull * 0.4;
        R.position.y += up * 0.2 - hit * 0.15;
        R.position.z += hit * -0.1 + pull * 0.16;
        break;
      }
      case "axe":
      case "mace":
        /* Back over the shoulder, then down through the target. */
        R.rotation.x += up * 1.2 - hit * 1.4;
        R.position.y += up * 0.2 - hit * 0.15;
        R.position.z += hit * -0.1;
        break;
      case "spear":
      case "trident":
        R.rotation.set(-1.45, 0.05, -0.05);
        R.position.set(0.22 + sway, -0.26 - dip - equip * 0.4, -0.25 + up * 0.25 - hit * 0.75);
        break;
      case "halberd":
        /* Held low and long; the sweep comes right across the view. */
        R.rotation.set(-1.25 + up * 0.25, 0.1 + up * 0.7 - hit * 1.6, -0.5 + up * -0.4 + hit * 1.3);
        R.position.set(
          0.26 + sway + up * 0.12 - hit * 0.42,
          -0.3 - dip - equip * 0.4 + up * 0.08,
          -0.45 - hit * 0.12,
        );
        break;
      case "greatsword":
      case "hammer": {
        /* Raised while you hold the button, brought down on release. */
        const c = o.charge ?? 0;
        R.rotation.x += 1.2 * Math.max(c, up) - hit * 1.5;
        R.position.y += 0.18 * Math.max(c, up) - hit * 0.2;
        if (kind === "greatsword") R.rotation.z += 0.3 * Math.max(c, up) - hit * 0.3;
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
    }
    R.rotation.x += o.kick * 0.1;
  }

  /* The rod rests angled out ahead; a cast flicks it over, a line out holds it up, a bite shakes it. */
  private poseRod(pose: RodPose, bob: number, bobAmp: number) {
    const now = performance.now() / 1000;
    const t = now - this.swingAt;
    const flick = t < 0.45 ? Math.sin((t / 0.45) * Math.PI) : 0;
    const equip = 1 - ease((now - this.equipAt) / 0.35);
    const sway = Math.sin(bob * 0.5) * 0.02 * bobAmp;
    const R = this.right;
    const up = pose === "idle" ? 0 : 0.2;
    R.position.set(0.3 + sway, -0.36 - equip * 0.4, -0.45);
    R.rotation.set(-1.2 + up + flick * 0.9, 0.1, -0.38);
    if (pose === "bite") {
      R.rotation.x += Math.sin(now * 37) * 0.04 - 0.12;
      R.rotation.z += Math.sin(now * 23) * 0.05;
    }
  }

  /* Where the rod tip is on screen (normalised device coordinates), if a rod is held. */
  rodTip(out: THREE.Vector3) {
    if (!this.tip) return false;
    this.camera.updateMatrixWorld();
    this.tip.getWorldPosition(out);
    out.project(this.camera);
    return true;
  }

  dispose() {
    this.set(null);
  }
}
