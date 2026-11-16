import * as THREE from "three";

/*
 * One light, one fog: every material reads the same uniforms. They're fixed:
 * it's always day. `uSun` is the direction to the sun (high in the sky, where
 * the sky draws it), `uLight` how much it shapes things, and `uFogTone` the
 * grey distance fades to.
 */
export const shared = {
  uFog: { value: 0.0012 },
  uFogTone: { value: 0.1 },
  uSun: { value: new THREE.Vector3(-0.33, 0.82, -0.47).normalize() },
  uLight: { value: 1 },
  uTime: { value: 0 },
};

export const GLSL_COMMON = /* glsl */ `
  uniform float uFog;
  uniform float uFogTone;
  uniform vec3 uSun;
  uniform float uLight;
  uniform float uTime;
  const float SEA_LEVEL = 0.0;

  float fogFactor(vec3 world) {
    float d = length(cameraPosition - world);
    return 1.0 - exp(-uFog * uFog * d * d);
  }

  /* Distance fades into the fog's grey. */
  float applyFog(float c, vec3 world) {
    return mix(c, uFogTone, fogFactor(world));
  }

  /* Diffuse light, flattened when the light source sits on the horizon. */
  float sunlight(vec3 n) {
    return mix(0.45, max(dot(n, uSun), 0.0), uLight);
  }

  /* Lifts the dark ink toward soft greys. */
  float lift(float c) {
    return min(c * 2.5 + 0.045, 0.97);
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

export const INK_FRAGMENT = /* glsl */ `
  ${GLSL_COMMON}
  uniform float uTone;
  uniform float uLit;
  uniform float uOpacity;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    float diff = sunlight(n);
    float rim = pow(1.0 - abs(dot(n, normalize(cameraPosition - vWorld))), 3.0);
    float c = lift(uTone * (0.35 + 0.65 * diff) + rim * 0.05) + uLit;
    /* Anything below the waterline reads as submerged. */
    c *= mix(1.0, 0.45, step(vWorld.y, SEA_LEVEL));
    gl_FragColor = vec4(vec3(applyFog(c, vWorld)), uOpacity);
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

export const LINE_FRAGMENT = /* glsl */ `
  ${GLSL_COMMON}
  uniform float uTone;
  uniform float uOpacity;
  varying vec3 vWorld;
  void main() {
    float c = uTone * mix(1.0, 0.35, step(vWorld.y, SEA_LEVEL));
    gl_FragColor = vec4(vec3(applyFog(c, vWorld)), uOpacity);
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
