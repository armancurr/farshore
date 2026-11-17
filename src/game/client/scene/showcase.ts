import * as THREE from "three";
import type { SkinId } from "../../shared/skins";
import { afloat, VEHICLES, type VehicleKind } from "../../shared/vehicles";
import type { WeaponKind } from "../../shared/weapons";
import { edges, flatten, inkMaterial, lineMaterial, PALETTE } from "./materials";
import { measure } from "./models";
import { buildRig, disposeRig, type Rig } from "./skins";
import { buildVehicle, disposeBuilt } from "./vehicles";
import { buildWeapon, WEAPON_SPAN } from "./weapons";

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

/* A weapon on display: stood on its pommel just over the plinth, about as tall as a person. */
function displayWeapon(kind: WeaponKind) {
  const span = WEAPON_SPAN[kind];
  const length = span.to - span.from;
  const scale = Math.min(kind === "shield" ? 1.6 : 3, 1.85 / length);
  const model = buildWeapon(kind);
  model.scale.setScalar(scale);
  /* Lift it so the bottom clears the plinth, then lean it a touch. */
  model.position.y = -span.from * scale;
  const tilt = new THREE.Group();
  tilt.add(model);
  tilt.position.y = 0.25;
  tilt.rotation.z = kind === "shield" ? 0 : 0.12;
  const root = new THREE.Group();
  root.add(tilt);
  return root;
}

/*
 * A vehicle on display, as a model on a turntable: scaled so a rowboat and a
 * galleon both fill the view, keel or wheels on the plinth, sails set and
 * wheels square. Its lights come with it: the pack models are lit, not inked.
 */
const DISPLAY = 3;
async function displayVehicle(kind: VehicleKind) {
  const built = await buildVehicle(kind);
  const def = VEHICLES[kind];
  const model = built.root;
  /* Sails full, as if under way. */
  for (const sq of built.squares) sq.node.scale.z = 1.3;
  for (const sail of built.sails) sail.node.scale.x = 1.2;
  /* A horse standing square, a moment into its idle. */
  if (built.mixer && built.clips.idle) {
    built.mixer.clipAction(built.clips.idle).play();
    built.mixer.update(0.8);
  }
  const box = measure(model);
  const size = box.getSize(new THREE.Vector3());
  const k = DISPLAY / Math.max(size.x, size.z, size.y * 1.15);
  const holder = new THREE.Group();
  holder.add(model);
  model.scale.setScalar(k);
  model.position.y = -box.min.y * k + (afloat(kind) ? 0.04 : 0);
  /* Centred on its footprint, not its origin (a towboat's is off to one end). */
  model.position.x = -((box.min.x + box.max.x) / 2) * k;
  model.position.z = -((box.min.z + box.max.z) / 2) * k;
  holder.add(...displayLights());
  holder.userData.height = size.y * k;
  holder.userData.built = built;
  holder.userData.length = def.length;
  return holder;
}

function displayLights() {
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(-3, 6, -4);
  const sky = new THREE.HemisphereLight(0xd9d3ff, PALETTE.land, 1.4);
  return [sun, sky];
}

/* Look down on a vehicle from three-quarters up, `dist` metres off. */
function frameVehicle(camera: THREE.PerspectiveCamera, dist: number, height = 1) {
  const mid = Math.min(1.4, height * 0.4);
  camera.position.set(0, mid + dist * 0.38, -dist);
  camera.lookAt(0, mid, 0);
}

/* A vehicle's model shares its pack's geometry and materials: just let go of it. */
function disposeVehicle(root: THREE.Object3D) {
  disposeBuilt(root.userData.built);
  root.removeFromParent();
}

/* A weapon's geometry is its own; its materials are shared and stay. */
function disposeWeapon(root: THREE.Object3D) {
  root.traverse((o) => {
    if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
  });
}

export class Showcase {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private rig: Rig | null = null;
  /* A weapon or a vehicle: something that stands still and turns. */
  private weapon: THREE.Group | null = null;
  private yaw = 0.55;
  /* Counts what's been asked to show, so a slow-loading vehicle doesn't land on top of the next. */
  private shown = 0;
  private disposed = false;
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
    this.scene.add(this.weapon);
    frame(this.camera, 2.3);
  }

  showVehicle(kind: VehicleKind) {
    this.clear();
    const shown = ++this.shown;
    void displayVehicle(kind).then((root) => {
      /* Something else was picked while it loaded. */
      if (shown !== this.shown || this.disposed) {
        disposeVehicle(root);
        return;
      }
      this.weapon = root;
      this.scene.add(root);
      frameVehicle(this.camera, 7.2, root.userData.height);
    });
  }

  private clear() {
    this.shown++;
    if (this.rig) {
      this.scene.remove(this.rig.root);
      disposeRig(this.rig);
      this.rig = null;
    }
    if (this.weapon) {
      this.scene.remove(this.weapon);
      if (this.weapon.userData.built) disposeVehicle(this.weapon);
      else disposeWeapon(this.weapon);
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
    this.disposed = true;
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

/* The same for the weapons: each stood up and turned three-quarters on. */
const weaponPortraits = new Map<WeaponKind, string>();

export function weaponPortraitsOf(
  kinds: readonly WeaponKind[],
  width = 224,
): Map<WeaponKind, string> {
  const missing = kinds.filter((k) => !weaponPortraits.has(k));
  if (missing.length) {
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, Math.round(width * 1.25), false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 0.8, 0.1, 50);
    frame(camera, 2.3, 0.6);
    for (const kind of missing) {
      const root = displayWeapon(kind);
      root.rotation.y = kind === "shield" ? 0.4 : 0.6;
      scene.add(root);
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

/* And the vehicles, seen from three-quarters up. They load their models first. */
const vehiclePortraits = new Map<VehicleKind, string>();

export async function vehiclePortraitsOf(
  kinds: readonly VehicleKind[],
  width = 224,
): Promise<Map<VehicleKind, string>> {
  const missing = kinds.filter((k) => !vehiclePortraits.has(k));
  if (missing.length) {
    const shown = await Promise.all(missing.map((k) => displayVehicle(k).catch(() => null)));
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, Math.round(width * 1.25), false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 0.8, 0.1, 50);
    missing.forEach((kind, i) => {
      const root = shown[i];
      if (!root) return;
      root.rotation.y = 0.7;
      frameVehicle(camera, 7.8, root.userData.height);
      scene.add(root);
      renderer.render(scene, camera);
      vehiclePortraits.set(kind, canvas.toDataURL("image/png"));
      scene.remove(root);
      disposeVehicle(root);
    });
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return new Map(kinds.map((k) => [k, vehiclePortraits.get(k) ?? ""]));
}
