import * as THREE from "three";
import { CATALOGUE, type CatalogueId, piecePalette, type Team } from "../../shared/catalogue";
import type { SkinId } from "../../shared/skins";
import { afloat, VEHICLES, type VehicleKind } from "../../shared/vehicles";
import { gripOf, type WeaponKind } from "../../shared/weapons";
import {
  buildCharacter,
  type Character,
  type ClipHalves,
  disposeCharacter,
  playerClips,
} from "./characters";
import { edges, flatten, inkMaterial, lineMaterial, PALETTE } from "./materials";
import { measure } from "./models";
import { packModel } from "./packs";
import { buildVehicle, disposeBuilt } from "./vehicles";
import { buildWeapon, WEAPON_SPAN, weaponsReady } from "./weapons";

/*
 * The marketplace's fitting room: one skin on a plinth, turning slowly and
 * walking on the spot, or one weapon or vehicle over it. Drag to turn any.
 */

/* How tall a character stands in the frame, hat and all. */
const FIGURE_HEIGHT = 2.3;

/* Characters are lit like the island: a warm sun, the violet sky above, the land below. */
function light(scene: THREE.Scene) {
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(-3, 6, -5);
  scene.add(sun, new THREE.HemisphereLight(0xd9d3ff, 0x6b5a8e, 1.4));
}

/* A character on display: its own mixer, idling and walking on the spot as `walk` (0..1) says. */
type Figure = {
  char: Character;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction[];
  idle: THREE.AnimationAction[];
};

function figure(char: Character, clips: Map<string, ClipHalves>): Figure {
  const mixer = new THREE.AnimationMixer(char.model);
  const play = (name: string) => {
    const halves = clips.get(name);
    if (!halves) return [];
    return [halves.lower, halves.upper].map((c) => mixer.clipAction(c).play());
  };
  return { char, mixer, walk: play("Walking_A"), idle: play("Idle_A") };
}

function disposeFigure(f: Figure) {
  f.mixer.stopAllAction();
  f.mixer.uncacheRoot(f.char.model);
  disposeCharacter(f.char);
}

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
  /* A bow or a crossbow is stood on end. */
  if (span.lies) model.rotation.x = -Math.PI / 2;
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

/*
 * Something from the build shelves, whole, in the owner's colours: scaled
 * down so a hedge and a keep both fill the view, standing on the plinth.
 */
async function displayItem(kind: CatalogueId, team: Team) {
  const def = CATALOGUE[kind];
  const model = new THREE.Group();
  const parts = await Promise.all(def.pieces.map((p) => packModel(p.model, piecePalette(p, team))));
  def.pieces.forEach((p, k) => {
    const m = parts[k];
    m.position.set(p.x, p.y, p.z);
    m.rotation.y = p.rot;
    m.scale.setScalar(p.scale);
    model.add(m);
  });
  const box = measure(model);
  const size = box.getSize(new THREE.Vector3());
  const k = DISPLAY / Math.max(size.x, size.z, size.y * 1.15);
  const holder = new THREE.Group();
  holder.add(model);
  model.scale.setScalar(k);
  model.position.y = -box.min.y * k;
  model.position.x = -((box.min.x + box.max.x) / 2) * k;
  model.position.z = -((box.min.z + box.max.z) / 2) * k;
  holder.add(...displayLights());
  holder.userData.height = size.y * k;
  holder.userData.item = true;
  return holder;
}

/* A vehicle's model shares its pack's geometry and materials: just let go of it. */
function disposeVehicle(root: THREE.Object3D) {
  disposeBuilt(root.userData.built);
  root.removeFromParent();
}

/*
 * A weapon's geometry is its own; its materials are shared and stay. A
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
  private figure: Figure | null = null;
  /* Bumped on every change, so a character that loads after you've moved on is dropped. */
  private showing = 0;
  /* A weapon or a vehicle: something that stands still and turns. */
  private weapon: THREE.Group | null = null;
  private lights = weaponLights();
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
    light(this.scene);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(canvas);
    this.fit();
    this.raf = requestAnimationFrame(this.tick);
  }

  show(skin: SkinId) {
    this.clear();
    const ticket = this.showing;
    frame(this.camera, FIGURE_HEIGHT);
    void Promise.all([buildCharacter(skin), playerClips()]).then(([char, clips]) => {
      const f = figure(char, clips);
      if (ticket !== this.showing) {
        disposeFigure(f);
        return;
      }
      this.figure = f;
      this.scene.add(char.root);
    });
  }

  showWeapon(kind: WeaponKind) {
    this.clear();
    this.weapon = displayWeapon(kind);
    this.scene.add(this.weapon, this.lights);
    frame(this.camera, 2.3);
  }

  showItem(kind: CatalogueId, team: Team) {
    this.clear();
    const shown = ++this.shown;
    void displayItem(kind, team).then((root) => {
      if (shown !== this.shown || this.disposed) {
        root.removeFromParent();
        return;
      }
      this.weapon = root;
      this.scene.add(root);
      frameVehicle(this.camera, 7.2, root.userData.height);
    });
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
    this.showing++;
    this.shown++;
    if (this.figure) {
      disposeFigure(this.figure);
      this.figure = null;
    }
    if (this.weapon) {
      this.scene.remove(this.weapon, this.lights);
      if (this.weapon.userData.built) disposeVehicle(this.weapon);
      /* Pack models share their geometry: nothing of the item's own to let go of. */ else if (
        !this.weapon.userData.item
      )
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
    } else if (this.figure) {
      const f = this.figure;
      f.char.root.rotation.y = this.yaw;
      for (const a of f.walk) a.weight = this.walk;
      for (const a of f.idle) a.weight = 1 - this.walk;
      f.mixer.update(dt);
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
 * borrowed renderer and kept as image URLs. The characters load first, and
 * every texture has to be in before anything is drawn.
 */
const portraits = new Map<SkinId, string>();

/* Portraits are 4:5, the shape of a marketplace tile. */
export async function portraitsOf(
  skins: readonly SkinId[],
  width = 224,
): Promise<Map<SkinId, string>> {
  const missing = skins.filter((s) => !portraits.has(s));
  if (missing.length) {
    const [chars, clips] = await Promise.all([
      Promise.all(missing.map((s) => buildCharacter(s))),
      playerClips(),
    ]);
    await texturesLoaded(chars.map((c) => c.root));
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, Math.round(width * 1.25), false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    light(scene);
    const camera = new THREE.PerspectiveCamera(28, 0.8, 0.1, 50);
    /* Plenty of room around it, so the tile reads as a card, not a crop. */
    frame(camera, FIGURE_HEIGHT - 0.25, 0.5);
    missing.forEach((skin, i) => {
      const f = figure(chars[i], clips);
      /* Straight on, a moment into the idle, turned a touch so the face has some shape. */
      for (const a of f.walk) a.weight = 0;
      f.mixer.update(0.4);
      f.char.root.rotation.y = 0.35;
      scene.add(f.char.root);
      renderer.render(scene, camera);
      portraits.set(skin, canvas.toDataURL("image/png"));
      disposeFigure(f);
    });
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return new Map(skins.map((s) => [s, portraits.get(s) as string]));
}

/* Wait (a few seconds at most) for every texture under these roots to have its image. */
async function texturesLoaded(roots: THREE.Object3D[]) {
  for (let tries = 0; tries < 100; tries++) {
    let waiting = false;
    for (const root of roots)
      root.traverse((o) => {
        const map = ((o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined)?.map;
        const img = map?.image as HTMLImageElement | undefined;
        if (map && (!img || img.complete === false)) waiting = true;
      });
    if (!waiting) return;
    await new Promise((done) => setTimeout(done, 50));
  }
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
    case "bow":
      /* Side on, its string toward you, leaning like a blade. */
      model.rotation.set(0, Math.PI / 2, 0);
      root.rotation.z = -0.62;
      break;
    case "crossbow":
      /* Three-quarters on, so the bow and the stock both show. */
      model.rotation.set(0.35, -Math.PI / 2 + 0.6, 0);
      break;
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

/* And the vehicles, seen from three-quarters up. They load their models first. */
const vehiclePortraits = new Map<VehicleKind, string>();

export async function vehiclePortraitsOf(
  kinds: readonly VehicleKind[],
  width = 224,
): Promise<Map<VehicleKind, string>> {
  const missing = kinds.filter((k) => !vehiclePortraits.has(k));
  if (missing.length) {
    const shown = await Promise.all(missing.map((k) => displayVehicle(k).catch(() => null)));
    /* The pack palettes load on their own: drawn before they arrive, a boat is a black silhouette. */
    await texturesLoaded(shown.filter((r): r is THREE.Group => r !== null));
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

/* And everything on the build shelves, in one team's colours. */
const itemPortraits = new Map<string, string>();

export async function itemPortraitsOf(
  kinds: readonly CatalogueId[],
  team: Team,
  width = 224,
): Promise<Map<CatalogueId, string>> {
  const key = (k: CatalogueId) => `${k}|${team}`;
  const missing = kinds.filter((k) => !itemPortraits.has(key(k)));
  if (missing.length) {
    const shown = await Promise.all(missing.map((k) => displayItem(k, team).catch(() => null)));
    await texturesLoaded(shown.filter((r): r is THREE.Group => r !== null));
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
      root.rotation.y = 0.6 + Math.PI;
      frameVehicle(camera, 7.8, root.userData.height);
      scene.add(root);
      renderer.render(scene, camera);
      itemPortraits.set(key(kind), canvas.toDataURL("image/png"));
      scene.remove(root);
    });
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return new Map(kinds.map((k) => [k, itemPortraits.get(key(k)) ?? ""]));
}
