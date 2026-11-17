import * as THREE from "three";
import { SEA_LEVEL } from "../../shared/constants";
import { FISH_IDS, type FishId } from "../../shared/items";
import type { Terrain } from "../../shared/terrain";
import { shared } from "./materials";

/* Ambient shoals use the same species as the fishing inventory. */
const SHAPES: Record<FishId, [number, number, number]> = {
  sprat: [0.48, 0.12, 0.09],
  mackerel: [0.8, 0.17, 0.12],
  mullet: [0.75, 0.23, 0.15],
  bass: [1.05, 0.3, 0.17],
  cod: [1.15, 0.28, 0.2],
  eel: [1.25, 0.09, 0.09],
  moonfish: [0.75, 0.48, 0.13],
  lanternfish: [0.55, 0.18, 0.12],
};

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const fragmentShader = /* glsl */ `
  uniform float uTone;
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    float light = 0.45 + 0.55 * abs(dot(normalize(vNormal), normalize(vec3(-0.3, 0.8, -0.4))));
    float shimmer = 0.94 + 0.06 * sin(vWorld.x * 2.0 + vWorld.z * 1.5 + uTime * 2.0);
    float tone = uTone * light * shimmer;
    gl_FragColor = vec4(vec3(tone), 1.0);
  }
`;

export class FishShoals {
  readonly group = new THREE.Group();
  private fish: { model: THREE.Group; tail: THREE.Mesh; index: number; elapsed: number }[] = [];
  private lastTime: number | null = null;

  constructor(private terrain: Terrain) {
    for (let i = 0; i < 49; i++) {
      const species = FISH_IDS[i % FISH_IDS.length];
      const [length, height, width] = SHAPES[species];
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTone: { value: species === "lanternfish" ? 0.8 : 0.38 + (i % 3) * 0.08 },
          uTime: shared.uTime,
        },
        vertexShader,
        fragmentShader,
      });
      const model = new THREE.Group();
      model.name = `fish-${species}`;
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), material);
      body.scale.set(length / 2, height, width);
      model.add(body);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(height * 0.9, length * 0.35, 4), material);
      tail.rotation.z = -Math.PI / 2;
      tail.position.x = -length * 0.55;
      model.add(tail);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(height * 0.55, height * 0.8, 4), material);
      fin.position.set(0, height * 0.9, 0);
      model.add(fin);
      if (species === "mackerel" || species === "bass" || species === "cod") {
        const second = new THREE.Mesh(
          new THREE.ConeGeometry(height * 0.4, height * 0.65, 4),
          material,
        );
        second.position.set(-length * 0.23, height * 0.8, 0);
        model.add(second);
      }
      if (species === "moonfish") {
        fin.scale.set(0.65, 2.1, 0.65);
        const lower = new THREE.Mesh(new THREE.ConeGeometry(height * 0.3, height, 4), material);
        lower.rotation.z = Math.PI;
        lower.position.y = -height;
        model.add(lower);
      }
      if (species === "eel") {
        fin.scale.set(1.8, 0.3, 0.5);
        tail.scale.set(0.5, 1, 0.5);
      }
      if (species === "lanternfish") {
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), material);
        glow.position.set(length * 0.2, -height * 0.6, width * 0.8);
        model.add(glow);
      }
      const outline = new THREE.LineBasicMaterial({ color: 0xffffff });
      for (const part of [...model.children]) {
        if (!(part instanceof THREE.Mesh)) continue;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(part.geometry, 30), outline);
        part.add(edges);
      }
      this.group.add(model);
      this.fish.push({ model, tail, index: i, elapsed: 0 });
    }
  }

  update(time: number, camera: THREE.Vector3) {
    const cell = 18;
    const cx = Math.floor(camera.x / cell);
    const cz = Math.floor(camera.z / cell);
    const dt = this.lastTime === null ? 0 : Math.min(time - this.lastTime, 0.1);
    this.lastTime = time;
    for (const fish of this.fish) {
      const { model, tail, index } = fish;
      // Assign each pooled model to a fixed cell modulo seven. Only the far
      // edge is recycled as the viewer crosses a cell boundary.
      const wrap = (value: number) => ((value % 7) + 7) % 7;
      const gx = cx - 3 + wrap((index % 7) - (cx - 3));
      const gz = cz - 3 + wrap(Math.floor(index / 7) - (cz - 3));
      const centerX = (gx + 0.5) * cell;
      const centerZ = (gz + 0.5) * cell;
      if (Math.hypot(centerX - camera.x, centerZ - camera.z) > 42) {
        model.visible = false;
        continue;
      }
      const depth = SEA_LEVEL - this.terrain.heightAt(centerX, centerZ);
      model.visible = depth > 2;
      if (!model.visible) continue;
      fish.elapsed += dt;
      const seed = Math.sin(gx * 127.1 + gz * 311.7) * 43758.5453;
      const phase = (seed - Math.floor(seed)) * Math.PI * 2;
      const angle = fish.elapsed * 0.14 + phase;
      const x = centerX + Math.cos(angle);
      const z = centerZ + Math.sin(angle);
      const localDepth = SEA_LEVEL - this.terrain.heightAt(x, z);
      model.position.set(
        x,
        SEA_LEVEL - Math.max(0.2, Math.min(localDepth - 0.2, 0.8 + (index % 4) * 0.6)),
        z,
      );
      model.rotation.y = -angle - Math.PI / 2;
      tail.rotation.y = Math.sin(fish.elapsed * 7 + phase) * 0.38;
    }
  }
}
