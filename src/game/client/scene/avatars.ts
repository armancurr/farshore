import * as THREE from "three";
import { FLAG } from "../../shared/protocol";
import type { WeaponKind } from "../../shared/weapons";
import { edges, flatten, inkMaterial, lineMaterial } from "./materials";
import { buildWeapon } from "./weapons";

/* The skull from the site's logo, extruded into a mask. */
function maskShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.62);
  s.bezierCurveTo(0.42, 0.62, 0.53, 0.3, 0.5, 0.05);
  s.bezierCurveTo(0.48, -0.14, 0.37, -0.2, 0.33, -0.32);
  s.lineTo(0.25, -0.56);
  s.quadraticCurveTo(0, -0.68, -0.25, -0.56);
  s.lineTo(-0.33, -0.32);
  s.bezierCurveTo(-0.37, -0.2, -0.48, -0.14, -0.5, 0.05);
  s.bezierCurveTo(-0.53, 0.3, -0.42, 0.62, 0, 0.62);

  const eye = (cx: number) => {
    const p = new THREE.Path();
    p.absellipse(cx, -0.02, 0.135, 0.12, 0, Math.PI * 2, true, 0);
    return p;
  };
  const nose = new THREE.Path();
  nose.moveTo(0, -0.12);
  nose.lineTo(-0.065, -0.27);
  nose.lineTo(0.065, -0.27);
  nose.lineTo(0, -0.12);
  s.holes.push(eye(-0.2), eye(0.2), nose);
  return s;
}

type Kit = {
  robe: THREE.BufferGeometry;
  robeEdges: THREE.BufferGeometry;
  hood: THREE.BufferGeometry;
  hoodEdges: THREE.BufferGeometry;
  mask: THREE.BufferGeometry;
  maskEdges: THREE.BufferGeometry;
  teeth: THREE.BufferGeometry;
  robeFill: THREE.Material;
  maskFill: THREE.Material;
  line: THREE.Material;
  dark: THREE.Material;
};

function lathe(points: [number, number][], segments: number) {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

function createKit(): Kit {
  const robe = lathe(
    [
      [0.001, 0.02],
      [0.5, 0.02],
      [0.45, 0.35],
      [0.36, 0.8],
      [0.34, 1.05],
      [0.41, 1.27],
      [0.33, 1.4],
      [0.15, 1.46],
      [0.001, 1.47],
    ],
    7,
  );
  const hood = lathe(
    [
      [0.001, 2.02],
      [0.1, 1.95],
      [0.22, 1.84],
      [0.28, 1.68],
      [0.27, 1.52],
      [0.2, 1.42],
      [0.001, 1.41],
    ],
    8,
  );
  hood.translate(0, -1.45, 0.03);

  const mask = new THREE.ExtrudeGeometry(maskShape(), {
    depth: 0.07,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.015,
    bevelSegments: 1,
    curveSegments: 10,
  });
  /* Face forward (-Z), sized to sit in the hood. */
  mask.rotateY(Math.PI);
  mask.scale(0.36, 0.36, 0.36);
  mask.translate(0, 0.2, -0.24);

  const teethPts: number[] = [];
  for (const x of [-0.14, -0.05, 0.05, 0.14]) teethPts.push(x, -0.41, 0, x, -0.55, 0);
  teethPts.push(-0.24, -0.41, 0, 0.24, -0.41, 0);
  const teeth = new THREE.BufferGeometry();
  teeth.setAttribute("position", new THREE.Float32BufferAttribute(teethPts, 3));
  teeth.rotateY(Math.PI);
  teeth.scale(0.36, 0.36, 0.36);
  teeth.translate(0, 0.2, -0.24 - 0.04);

  return {
    robe: flatten(robe),
    robeEdges: edges(robe, 18),
    hood: flatten(hood),
    hoodEdges: edges(hood, 18),
    mask: flatten(mask),
    maskEdges: edges(mask, 50),
    teeth,
    robeFill: inkMaterial(0.045, { side: THREE.DoubleSide }),
    maskFill: inkMaterial(0.78, { lit: 0.06 }),
    line: lineMaterial(0.85),
    dark: lineMaterial(0.02),
  };
}

let kit: Kit | null = null;
let kitUsers = 0;

function nameTexture(name: string, stagger = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.font = '500 38px "Google Sans Code", ui-monospace, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = stagger > 0 ? `${name}  ${stagger}%` : name;
  const text = label.toUpperCase().split("").join(" ");
  const w = Math.min(500, ctx.measureText(text).width + 36);
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(256 - w / 2, 18, w, 60);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(256 - w / 2 + 1, 19, w - 2, 58);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, 256, 49);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class Avatar {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private label: THREE.Sprite;
  private lunge = 0;
  private stride = 0;
  private last = new THREE.Vector3();
  private sway = 0;
  private hand = new THREE.Group();
  private weapon: WeaponKind | null = null;
  private stagger = 0;
  private swing = 0;
  private spin = 0;

  constructor(
    readonly id: number,
    private name: string,
  ) {
    kit ??= createKit();
    kitUsers++;
    const k = kit;
    this.body.add(new THREE.Mesh(k.robe, k.robeFill), new THREE.LineSegments(k.robeEdges, k.line));
    this.head.add(
      new THREE.Mesh(k.hood, k.robeFill),
      new THREE.LineSegments(k.hoodEdges, k.line),
      new THREE.Mesh(k.mask, k.maskFill),
      new THREE.LineSegments(k.teeth, k.dark),
    );
    this.head.position.y = 1.45;
    this.body.add(this.head);
    /* Right hand, out at the robe's side, holding whatever they picked up. */
    this.hand.position.set(0.42, 1.0, -0.12);
    this.body.add(this.hand);
    this.group.add(this.body);

    this.label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: nameTexture(name),
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.label.scale.set(1.7, 0.32, 1);
    this.label.position.y = 2.55;
    this.label.renderOrder = 5;
    this.group.add(this.label);
  }

  /* Show what they're holding and how battered they are. */
  setGear(weapon: WeaponKind | null, stagger: number) {
    if (weapon !== this.weapon) {
      this.weapon = weapon;
      for (const c of [...this.hand.children]) this.hand.remove(c);
      if (weapon) {
        const model = buildWeapon(weapon);
        if (weapon === "shield") {
          model.position.set(-0.3, 0, -0.25);
          model.rotation.y = 0.4;
        } else if (weapon === "spear") model.position.y = -0.5;
        this.hand.add(model);
      }
    }
    const s = Math.round(stagger / 5) * 5;
    if (s !== this.stagger) {
      this.stagger = s;
      const mat = this.label.material;
      mat.map?.dispose();
      mat.map = nameTexture(this.name, s);
      mat.needsUpdate = true;
    }
  }

  /* A swing seen from outside. */
  strike() {
    this.swing = 1;
  }

  setPose(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    flags: number,
    dt: number,
    camera: THREE.Vector3,
  ) {
    const moved = Math.hypot(x - this.last.x, z - this.last.z);
    this.last.set(x, y, z);
    const speed = dt > 0 ? Math.min(12, moved / dt) : 0;
    const grounded = (flags & FLAG.grounded) !== 0;
    if (grounded) this.stride += moved * 1.7;
    this.sway += ((speed > 0.5 ? 1 : 0) - this.sway) * Math.min(1, dt * 6);

    if (flags & FLAG.shove && this.lunge <= 0) this.lunge = 1;
    this.lunge = Math.max(0, this.lunge - dt * 4);
    const thrust = Math.sin(this.lunge * Math.PI) * 0.45;

    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.body.position.z = -thrust;
    this.body.position.y = Math.abs(Math.sin(this.stride)) * 0.07 * this.sway;
    this.body.rotation.z = Math.sin(this.stride) * 0.05 * this.sway;
    this.body.rotation.x = -thrust * 0.5 - Math.min(speed, 10) * 0.012;
    this.head.rotation.x = -pitch * 0.6;

    /* The weapon arm: at rest it hangs forward; swings arc down; a shield comes up. */
    this.swing = Math.max(0, this.swing - dt * 3.2);
    const arc = Math.sin(this.swing * Math.PI);
    const blocking = (flags & FLAG.block) !== 0;
    const charging = (flags & FLAG.charge) !== 0;
    if (charging && this.weapon === "flail") this.spin += dt * 14;
    this.hand.rotation.set(
      -0.9 + arc * -1.4 + (this.swing > 0.5 ? 0 : arc * 2.2) + (charging ? -1.2 : 0),
      charging && this.weapon === "flail" ? this.spin : 0,
      -0.15,
    );
    this.hand.position.x = blocking ? 0.1 : 0.42;

    const d = camera.distanceTo(this.group.position);
    const mat = this.label.material;
    mat.opacity = Math.max(0, Math.min(1, (60 - d) / 25, (d - 2.5) / 2));
    this.label.visible = mat.opacity > 0.02;
  }

  dispose() {
    this.label.material.map?.dispose();
    this.label.material.dispose();
    kitUsers--;
    if (kitUsers === 0 && kit) {
      for (const v of Object.values(kit)) (v as { dispose(): void }).dispose();
      kit = null;
    }
  }
}
