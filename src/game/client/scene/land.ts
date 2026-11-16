import * as THREE from "three";
import { CONTOUR, GRID, WORLD_SIZE } from "../../shared/constants";
import type { Terrain } from "../../shared/terrain";
import { GLSL_COMMON, shared } from "./materials";

const TERRAIN_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/*
 * The island is drawn as a survey map: near-black ground, a white contour every
 * 2.5 m, a heavier index contour every 10 m, and hachures where it's steep.
 */
const TERRAIN_FRAGMENT = /* glsl */ `
  ${GLSL_COMMON}
  uniform float uContour;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    float diff = max(dot(n, uMoon), 0.0);
    float h = vWorld.y;

    float minor = isoLine(h / uContour, 1.1);
    float major = isoLine(h / (uContour * 4.0), 1.8);
    float lines = max(minor * 0.5, major * 0.85);

    float steep = smoothstep(0.9, 0.62, n.y);
    float hatch = isoLine((vWorld.x * 0.62 + vWorld.z * 0.78) * 1.25, 0.9) * steep * 0.2;

    /* Fine stipple on flat ground so it doesn't read as a void. */
    vec2 g = floor(vWorld.xz * 2.0);
    float grain = fract(sin(dot(g, vec2(12.9898, 78.233))) * 43758.5453);
    vec2 cellPos = fract(vWorld.xz * 2.0) - 0.5;
    float dotMask = 1.0 - smoothstep(0.05, 0.09, length(cellPos));
    float dots = step(0.94, grain) * dotMask * 0.12 * (1.0 - steep);

    float c = 0.022 + 0.11 * diff + (lines + hatch) * (0.55 + 0.45 * diff) + dots;

    /* Wet sand: a dark band just above the waterline. */
    float above = h - SEA_LEVEL;
    c *= mix(0.5, 1.0, smoothstep(0.0, 1.2, above));
    c *= mix(1.0, 0.4, step(above, 0.0));

    gl_FragColor = vec4(vec3(c * (1.0 - fogFactor(vWorld))), 1.0);
  }
`;

const WATER_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/*
 * The sea reads the island's heightmap to know its own depth: a foam line hugs
 * the shore, iso-depth ripples roll inland, and long swells cross open water.
 */
const WATER_FRAGMENT = /* glsl */ `
  ${GLSL_COMMON}
  uniform sampler2D uHeights;
  uniform float uHalf;
  uniform float uGrid;
  uniform float uCell;
  varying vec3 vWorld;
  void main() {
    vec2 uv = ((vWorld.xz + uHalf) / uCell + 0.5) / uGrid;
    float ground = texture2D(uHeights, clamp(uv, 0.0, 1.0)).r;
    float outside = step(1.0, max(abs(vWorld.x), abs(vWorld.z)) / uHalf);
    ground = mix(ground, -30.0, outside);
    float depth = SEA_LEVEL - ground;

    float lap = 0.28 + 0.14 * sin(uTime * 1.4 + vWorld.x * 0.21 + vWorld.z * 0.17);
    float foam = 1.0 - smoothstep(0.0, lap, depth);
    float foam2 = isoLine(depth * 1.6 - uTime * 0.5, 1.2) * (1.0 - smoothstep(0.1, 2.2, depth));

    float ripples = isoLine(depth * 0.9 + uTime * 0.32, 1.0) * (1.0 - smoothstep(0.6, 9.0, depth));

    float warp = sin(vWorld.x * 0.045 + uTime * 0.3) * 4.0 + sin(vWorld.x * 0.011 - uTime * 0.17) * 11.0;
    float swell = isoLine((vWorld.z + warp) * 0.22 + uTime * 0.2, 0.9) * smoothstep(1.5, 10.0, depth);

    /* The moon's path on the water, broken up by the swell. */
    vec3 view = normalize(vWorld - cameraPosition);
    vec3 r = reflect(view, vec3(0.0, 1.0, 0.0));
    float glint = pow(max(dot(r, uMoon), 0.0), 60.0);
    float sparkle = 0.5 + 0.5 * sin(vWorld.x * 2.7 + sin(vWorld.z * 1.9 + uTime * 1.3) * 2.0 + uTime * 2.2);
    glint *= 0.3 + 0.7 * sparkle * sparkle;

    float c = 0.075 + ripples * 0.32 + swell * 0.16 + foam2 * 0.4 + glint * 0.9;
    c = max(c, foam * 0.95);
    float alpha = mix(0.55, 0.95, smoothstep(0.0, 5.0, depth));
    alpha = max(alpha, foam);

    if (!gl_FrontFacing) { c = 0.12 + ripples * 0.2; alpha = 0.85; }

    gl_FragColor = vec4(vec3(c * (1.0 - fogFactor(vWorld))), alpha);
  }
`;

export function createTerrainMesh(terrain: Terrain) {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GRID - 1, GRID - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) pos.setY(k, terrain.heights[k]);
  geo.deleteAttribute("uv");
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uContour: { value: CONTOUR } },
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "terrain";
  return mesh;
}

export function createWater(terrain: Terrain) {
  const data = new Uint16Array(GRID * GRID);
  for (let k = 0; k < data.length; k++) data[k] = THREE.DataUtils.toHalfFloat(terrain.heights[k]);
  const tex = new THREE.DataTexture(data, GRID, GRID, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  const geo = new THREE.PlaneGeometry(4000, 4000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uHeights: { value: tex },
      uHalf: { value: WORLD_SIZE / 2 },
      uGrid: { value: GRID },
      uCell: { value: WORLD_SIZE / (GRID - 1) },
    },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "water";
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}
