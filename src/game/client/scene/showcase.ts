import * as THREE from "three";
import type { SkinId } from "../../shared/skins";
import { edges, flatten, inkMaterial, lineMaterial } from "./materials";
import { buildRig, disposeRig, type Rig } from "./skins";

/*
 * The marketplace's fitting room: one skin on a plinth, turning slowly and
 * walking on the spot. Drag to turn it yourself.
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

/* Fit the rig in view, with `margin` metres to spare above and below. */
function frame(camera: THREE.PerspectiveCamera, rig: Rig, margin = 0.45) {
  /* Taller skins (a lantern, a lighthouse) need the camera to step back. */
  const top = Math.max(2.3, rig.top);
  const mid = top / 2;
  const dist = (top / 2 + margin) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, mid + 0.35, -dist);
  camera.lookAt(0, mid, 0);
}

export class Showcase {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private rig: Rig | null = null;
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
    if (this.rig) {
      this.scene.remove(this.rig.root);
      disposeRig(this.rig);
    }
    this.rig = buildRig(skin);
    this.scene.add(this.rig.root);
    frame(this.camera, this.rig);
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
    if (!this.rig) return;
    this.rig.root.rotation.y = this.yaw;
    this.rig.update(this.clock, this.clock * WALK * this.rig.cadence, this.walk, false);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    if (this.rig) disposeRig(this.rig);
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
      frame(camera, rig, 0.75);
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
