import * as THREE from "three";
import { FLAG } from "../../shared/protocol";
import type { SkinId } from "../../shared/skins";
import type { WeaponKind } from "../../shared/weapons";
import { buildRig, disposeRig, type Rig } from "./skins";
import { buildWeapon } from "./weapons";

/* Radians of walk cycle per metre walked, at the wanderer's cadence. */
const STRIDE = 1.7;

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

/* Another player, as you see them: their skin, what they hold, and their name. */
export class Avatar {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private rig: Rig;
  private label: THREE.Sprite;
  private lunge = 0;
  private stride = 0;
  private clock = 0;
  private last = new THREE.Vector3();
  private sway = 0;
  /* Holds the weapon, inside the rig's right hand. */
  private hand = new THREE.Group();
  private weapon: WeaponKind | null = null;
  private stagger = 0;
  private swing = 0;
  private spin = 0;

  constructor(
    readonly id: number,
    private name: string,
    private skin: SkinId,
  ) {
    this.rig = buildRig(skin);
    this.rig.hand.add(this.hand);
    this.body.add(this.rig.root);
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
    this.label.position.y = this.rig.top + 0.1;
    this.label.renderOrder = 5;
    this.group.add(this.label);
    /* Start mid-way through idle motions so a crowd doesn't move in step. */
    this.clock = (id * 0.37) % 5;
  }

  /* Change what they look like, keeping whatever they hold. */
  setSkin(skin: SkinId) {
    if (skin === this.skin) return;
    this.skin = skin;
    this.body.remove(this.rig.root);
    this.rig.hand.remove(this.hand);
    disposeRig(this.rig);
    this.rig = buildRig(skin);
    this.rig.hand.add(this.hand);
    this.body.add(this.rig.root);
    this.label.position.y = this.rig.top + 0.1;
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
    if (grounded) this.stride += moved * STRIDE * this.rig.cadence;
    this.sway += ((speed > 0.5 && grounded ? 1 : 0) - this.sway) * Math.min(1, dt * 6);
    this.clock += dt;

    if (flags & FLAG.shove && this.lunge <= 0) this.lunge = 1;
    this.lunge = Math.max(0, this.lunge - dt * 4);
    const thrust = Math.sin(this.lunge * Math.PI) * 0.45;

    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.body.position.z = -thrust;
    this.body.rotation.x = -thrust * 0.5 - Math.min(speed, 10) * 0.012;

    const holding = this.weapon !== null;
    this.rig.update(this.clock, this.stride, this.sway, holding);
    this.rig.head.rotation.x += -pitch * 0.6;

    /*
     * The weapon: at rest it points forward; swings arc down; a shield comes
     * across the body. The arm already lifts it by `hold`, so take that off.
     */
    this.swing = Math.max(0, this.swing - dt * 3.2);
    const arc = Math.sin(this.swing * Math.PI);
    const blocking = (flags & FLAG.block) !== 0;
    const charging = (flags & FLAG.charge) !== 0;
    if (charging && this.weapon === "flail") this.spin += dt * 14;
    this.hand.rotation.set(
      -0.9 -
        this.rig.hold +
        arc * -1.4 +
        (this.swing > 0.5 ? 0 : arc * 2.2) +
        (charging ? -1.2 : 0),
      charging && this.weapon === "flail" ? this.spin : 0,
      -0.15,
    );
    this.hand.position.x = blocking ? -0.32 : 0;

    const d = camera.distanceTo(this.group.position);
    const mat = this.label.material;
    mat.opacity = Math.max(0, Math.min(1, (60 - d) / 25, (d - 2.5) / 2));
    this.label.visible = mat.opacity > 0.02;
  }

  dispose() {
    this.label.material.map?.dispose();
    this.label.material.dispose();
    disposeRig(this.rig);
  }
}
