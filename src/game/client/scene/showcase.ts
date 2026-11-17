import * as THREE from "three";
import type { SkinId } from "../../shared/skins";
import type { VehicleKind } from "../../shared/vehicles";
import { gripOf, type WeaponKind } from "../../shared/weapons";
import { buildRowboat } from "./boats";
import { buildDesertBike } from "./bikes";
import { edges, flatten, inkMaterial, lineMaterial, PALETTE } from "./materials";
import { buildRig, disposeRig, type Rig } from "./skins";
import { buildWeapon, WEAPON_SPAN, weaponsReady } from "./weapons";

/*
 * The marketplace's fitting room: one skin on a plinth, turning slowly and
 * walking on the spot, or one weapon or vehicle over it. Drag to turn any.
 */

/* Steps per second when a showcase skin walks on the spot. */
const WALK = 7.5;

function plinth() {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(1.05, 1.1, 0.08, 10);
  g.add(new THREE.Mesh(flatten(geo), inkMaterial(0.015)));
  g.add(new THREE.LineSegments(edges(geo, 25), lineMaterial(0.3)));
  geo.dispose();
  g.position.y = -0.04;
  return g;
}

/* Fit something `height` metres tall in view, with `margin` metres to spare above and below. */
function frame(camera: THREE.PerspectiveCamera, height: number, margin = 0.45) {
  /* Taller skins (a lantern, a lighthouse) need the camera to step back. */
  const top = Math.max(2.3, height);
  const mid = top / 2;
  const dist = (top / 2 + margin) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, mid + 0.35, -dist);
  camera.lookAt(0, mid, 0);
}

/*
 * A weapon on display: stood on its pommel just over the plinth, about as
 * tall as a person, its flat (or a shield's face) toward the camera.
 */
function displayWeapon(kind: WeaponKind) {
  const span = WEAPON_SPAN[kind];
  const length = span.to - span.from;
  const shield = gripOf(kind) === "shield";
  /* Knuckledusters are a hand's width: they'd be a speck stood up at a person's height. */
  const scale = Math.min(shield ? 1.6 : kind === "knuckles" ? 9 : 3, 1.85 / length);
  const model = buildWeapon(kind);
  model.scale.setScalar(scale);
  /* Lift it so the bottom clears the plinth, then lean it a touch. */
  model.position.y = -span.from * scale;
  if (shield) model.rotation.y = Math.PI;
  /* Knuckledusters lie flat in the hand's frame: tip them up so the rings face out. */
  if (kind === "knuckles") model.rotation.x = -1.2;
  const tilt = new THREE.Group();
  tilt.add(model);
  tilt.position.y = kind === "knuckles" ? 0.75 : 0.25;
  tilt.rotation.z = shield ? 0 : 0.12;
  const root = new THREE.Group();
  root.add(tilt);
  return root;
}

/*
 * The weapons are lit models (the skins and vehicles are inked): a sun over
 * the camera's shoulder and the world's violet sky, so they look as they do
 * out on the islands.
 */
function weaponLights() {
  const g = new THREE.Group();
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(-2.5, 4, -4);
  g.add(sun, new THREE.HemisphereLight(0xd9d3ff, PALETTE.land, 1.35));
  return g;
}

/* A vehicle on display: shrunk to sit on the plinth, a little above it as if afloat. */
function displayVehicle(kind: VehicleKind) {
  const root = new THREE.Group();
  switch (kind) {
    case "desertbike": {
      const bike = buildDesertBike();
      bike.scale.setScalar(0.78);
      root.add(bike);
      break;
    }
    case "rowboat": {
      const boat = buildRowboat();
      /* Oar tip to oar tip it's nearly six metres; the plinth is two across. */
      boat.scale.setScalar(0.42);
      boat.position.y = 0.32;
      root.add(boat);
      break;
    }
  }
  return root;
}

/* Look down on a vehicle from three-quarters up, `dist` metres off. */
function frameVehicle(camera: THREE.PerspectiveCamera, dist: number) {
  camera.position.set(0, dist * 0.42, -dist);
  camera.lookAt(0, 0.45, 0);
}

/*
 * A vehicle's geometry is its own; its materials are shared and stay. A
 * weapon's model is shared with every copy of it (userData.shared), so it stays too.
 */
function disposeWeapon(root: THREE.Object3D) {
  root.traverse((o) => {
    if ((o as THREE.Mesh).geometry && !o.userData.shared) (o as THREE.Mesh).geometry.dispose();
  });
}

export class Showcase {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private rig: Rig | null = null;
  /* A weapon or a vehicle: something that stands still and turns. */
  private weapon: THREE.Group | null = null;
  private lights = weaponLights();
  private yaw = 0.55;
  private spinning = true;
  private walking = true;
  private walk = 1;
  private clock = 0;
  private last = performance.now();
  private raf = 0;
  private resize: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement) {
    /* Transparent, so the skin stands on whatever the marketplace sits over. */
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(plinth());
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(canvas);
    this.fit();
    this.raf = requestAnimationFrame(this.tick);
  }

  show(skin: SkinId) {
    this.clear();
    this.rig = buildRig(skin);
    this.scene.add(this.rig.root);
    frame(this.camera, this.rig.top);
  }

  showWeapon(kind: WeaponKind) {
    this.clear();
    this.weapon = displayWeapon(kind);
    this.scene.add(this.weapon, this.lights);
    frame(this.camera, 2.3);
  }

  showVehicle(kind: VehicleKind) {
    this.clear();
    this.weapon = displayVehicle(kind);
    this.scene.add(this.weapon);
    frameVehicle(this.camera, 6);
  }

  private clear() {
    if (this.rig) {
      this.scene.remove(this.rig.root);
      disposeRig(this.rig);
      this.rig = null;
    }
    if (this.weapon) {
      this.scene.remove(this.weapon, this.lights);
      disposeWeapon(this.weapon);
      this.weapon = null;
    }
  }

  /* Turn by a drag of `dx` pixels. Turning by hand stops the turntable. */
  turn(dx: number) {
    this.yaw += dx * 0.012;
    this.spinning = false;
  }

  setWalking(walking: boolean) {
    this.walking = walking;
  }

  setSpinning(spinning: boolean) {
    this.spinning = spinning;
  }

  private fit() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    this.walk += ((this.walking ? 1 : 0) - this.walk) * Math.min(1, dt * 4);
    if (this.spinning) this.yaw += dt * 0.45;
    if (this.weapon) {
      this.weapon.rotation.y = this.yaw;
      this.weapon.position.y = Math.sin(this.clock * 1.6) * 0.04;
    } else if (this.rig) {
      this.rig.root.rotation.y = this.yaw;
      this.rig.update(this.clock, this.clock * WALK * this.rig.cadence, this.walk, false);
    } else return;
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/*
 * Still portraits of each skin for the marketplace grid, drawn once with a
 * borrowed renderer and kept as image URLs.
 */
const portraits = new Map<SkinId, string>();

/* Portraits are 4:5, the shape of a marketplace tile. */
export function portraitsOf(skins: readonly SkinId[], width = 224): Map<SkinId, string> {
  const missing = skins.filter((s) => !portraits.has(s));
  if (missing.length) {
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, Math.round(width * 1.25), false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 0.8, 0.1, 50);
    for (const skin of missing) {
      const rig = buildRig(skin);
      /* Straight on, facing the camera. */
      rig.root.rotation.y = 0;
      /* A moment into the idle, so lanterns and flames are lit. */
      rig.update(1.3, 0, 0, false);
      scene.add(rig.root);
      /* Plenty of room around it, so the tile reads as a card, not a crop. */
      frame(camera, rig.top, 0.75);
      renderer.render(scene, camera);
      portraits.set(skin, canvas.toDataURL("image/png"));
      scene.remove(rig.root);
      disposeRig(rig);
    }
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return new Map(skins.map((s) => [s, portraits.get(s) as string]));
}

/*
 * The same for the weapons. Each is leant corner to corner across its tile,
 * so a dagger fills it as well as a halberd does, and framed to its own size
 * with room left at the bottom for the name. Their models load first, so
 * this one answers once they have.
 */
const weaponPortraits = new Map<WeaponKind, string>();

function portraitWeapon(kind: WeaponKind) {
  const model = buildWeapon(kind);
  const root = new THREE.Group();
  root.add(model);
  switch (gripOf(kind)) {
    case "shield":
      /* Face on, turned a little. */
      model.rotation.y = Math.PI + 0.35;
      break;
    case "dual":
      if (kind === "knuckles") {
        /* Looked down on, so the finger rings show. */
        model.rotation.set(-1.1, 0.4, 0);
        break;
      }
    /* falls through: a dagger leans like any blade */
    default:
      model.rotation.y = -0.35;
      root.rotation.z = -0.62;
  }
  root.updateMatrixWorld(true);
  return root;
}

/* Back the camera off until `box` fits the tile, its name clear underneath. */
function framePortrait(camera: THREE.PerspectiveCamera, box: THREE.Box3) {
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const tall = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const fit = Math.max(size.y / 0.78, size.x / 0.86 / camera.aspect) / 2;
  const dist = fit / tall + size.z / 2;
  /* Nudge it up a little so the caption sits under it, not over it. */
  camera.position.set(centre.x, centre.y - fit * 0.12, centre.z - dist);
  camera.lookAt(centre.x, centre.y - fit * 0.12, centre.z);
}

export async function weaponPortraitsOf(
  kinds: readonly WeaponKind[],
  width = 224,
): Promise<Map<WeaponKind, string>> {
  const missing = kinds.filter((k) => !weaponPortraits.has(k));
  if (missing.length) {
    await weaponsReady(missing);
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    /* Twice over, so the small ones stay crisp on a sharp screen. */
    renderer.setPixelRatio(2);
    renderer.setSize(width, Math.round(width * 1.25), false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(24, 0.8, 0.01, 50);
    scene.add(weaponLights());
    for (const kind of missing) {
      const root = portraitWeapon(kind);
      scene.add(root);
      framePortrait(camera, new THREE.Box3().setFromObject(root));
      renderer.render(scene, camera);
      weaponPortraits.set(kind, canvas.toDataURL("image/png"));
      scene.remove(root);
      disposeWeapon(root);
    }
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return new Map(kinds.map((k) => [k, weaponPortraits.get(k) as string]));
}

/* And the vehicles, seen from three-quarters up. */
const vehiclePortraits = new Map<VehicleKind, string>();

export function vehiclePortraitsOf(
  kinds: readonly VehicleKind[],
  width = 224,
): Map<VehicleKind, string> {
  const missing = kinds.filter((k) => !vehiclePortraits.has(k));
  if (missing.length) {
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, Math.round(width * 1.25), false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 0.8, 0.1, 50);
    frameVehicle(camera, 7.5);
    for (const kind of missing) {
      const root = displayVehicle(kind);
      root.rotation.y = 0.7;
      scene.add(root);
      renderer.render(scene, camera);
      vehiclePortraits.set(kind, canvas.toDataURL("image/png"));
      scene.remove(root);
      disposeWeapon(root);
    }
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return new Map(kinds.map((k) => [k, vehiclePortraits.get(k) as string]));
}
