import * as THREE from "three";

/* One moon, one fog: every material reads the same uniforms. */
export const MOON_DIR = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();

export const shared = {
  uFog: { value: 0.0033 },
  uMoon: { value: MOON_DIR },
  uTime: { value: 0 },
};

export const GLSL_COMMON = /* glsl */ `
  uniform float uFog;
  uniform vec3 uMoon;
  uniform float uTime;
  const float SEA_LEVEL = 0.0;

  float fogFactor(vec3 world) {
    float d = length(cameraPosition - world);
    return 1.0 - exp(-uFog * uFog * d * d);
  }

  /* An anti-aliased iso-line of v, roughly px pixels wide, fading out where it would alias. */
  float isoLine(float v, float px) {
    float w = fwidth(v);
    float d = abs(fract(v - 0.5) - 0.5);
    return (1.0 - smoothstep(w * (px - 0.5), w * (px + 0.5), d)) * (1.0 - smoothstep(0.18, 0.45, w));
  }
`;

const INK_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  #include <common>
  void main() {
    #ifdef USE_INSTANCING
      vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    #else
      vec4 world = modelMatrix * vec4(position, 1.0);
      vNormal = normalize(mat3(modelMatrix) * normal);
    #endif
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const INK_FRAGMENT = /* glsl */ `
  ${GLSL_COMMON}
  uniform float uTone;
  uniform float uLit;
  uniform float uOpacity;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    float diff = max(dot(n, uMoon), 0.0);
    float rim = pow(1.0 - abs(dot(n, normalize(cameraPosition - vWorld))), 3.0);
    float c = uTone * (0.35 + 0.65 * diff) + rim * 0.05 + uLit;
    /* Anything below the waterline reads as submerged. */
    c *= mix(1.0, 0.45, step(vWorld.y, SEA_LEVEL));
    gl_FragColor = vec4(vec3(c * (1.0 - fogFactor(vWorld))), uOpacity);
  }
`;

/* Matte surfaces: faces in near-black (or white for the lighthouse stripes). */
export function inkMaterial(tone = 0.06, opts: { lit?: number; side?: THREE.Side } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uTone: { value: tone },
      uLit: { value: opts.lit ?? 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: INK_VERTEX,
    fragmentShader: INK_FRAGMENT,
    side: opts.side ?? THREE.FrontSide,
  });
}

const LINE_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const LINE_FRAGMENT = /* glsl */ `
  ${GLSL_COMMON}
  uniform float uTone;
  uniform float uOpacity;
  varying vec3 vWorld;
  void main() {
    float c = uTone * mix(1.0, 0.35, step(vWorld.y, SEA_LEVEL));
    gl_FragColor = vec4(vec3(c * (1.0 - fogFactor(vWorld))), uOpacity);
  }
`;

/* Ink outlines: the white edges that draw every object. */
export function lineMaterial(tone = 0.82, opacity = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uTone: { value: tone }, uOpacity: { value: opacity } },
    vertexShader: LINE_VERTEX,
    fragmentShader: LINE_FRAGMENT,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
  });
}

/* Strip a geometry down to flat-shaded position + normal so pieces can be merged. */
export function flatten(geo: THREE.BufferGeometry) {
  const out = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(out.attributes)) {
    if (name !== "position") out.deleteAttribute(name);
  }
  out.computeVertexNormals();
  return out;
}

export function edges(geo: THREE.BufferGeometry, angle = 28) {
  const e = new THREE.EdgesGeometry(geo, angle);
  return e;
}
