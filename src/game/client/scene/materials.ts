import * as THREE from "three";

/*
 * The world's colours. The sea and the land are the two big fields; the
 * foliage pair dresses everything that grows; the rest are picked to sit with
 * them. Hex, as three.js takes them.
 */
export const PALETTE = {
  sky: 0x705eff,
  /* The haze low on the horizon, which distance fades into. */
  horizon: 0x8c7fff,
  sea: 0x48b3af,
  seaLine: 0xa6e6e2,
  seaDeep: 0x2f8f8b,
  seabed: 0x2b7e7b,
  land: 0x555879,
  landLine: 0x6e7196,
  landMajor: 0x8184ab,
  wetLand: 0x45476a,
  foam: 0xf2fbfa,
  foliage: 0xff8882,
  bark: 0x194350,
  rock: 0x9c9ebe,
  /* Built things: painted wood and whitewash, with a coral accent on the lighthouse. */
  timber: 0x3d4270,
  plank: 0xc9a27e,
  whitewash: 0xf4efe6,
  accent: 0xf2665e,
  /* Outlines on built things and gear. */
  outline: 0x262a4a,
  /* The two ends of the ramp anything without its own colour is tinted along. */
  ink: 0x1d2242,
  paper: 0xf4efe6,
} as const;

const INK = new THREE.Color(PALETTE.ink);
const PAPER = new THREE.Color(PALETTE.paper);

/* A grey tone (0 black, 1 white) as a colour on the world's navy-to-cream ramp. */
export function toneColor(tone: number) {
  const t = Math.min(1, Math.max(0, tone / 0.62)) ** 0.85;
  return INK.clone().lerp(PAPER, t);
}

/*
 * One light, one fog: every material reads the same uniforms. They're fixed:
 * it's always day. `uSun` is the direction to the sun (high in the sky, where
 * the sky draws it), `uLight` how much it shapes things, and `uFogColor` the
 * haze distance fades to.
 */
export const shared = {
  uFog: { value: 0.00055 },
  uFogColor: { value: new THREE.Color(PALETTE.horizon) },
  uSun: { value: new THREE.Vector3(-0.33, 0.82, -0.47).normalize() },
  uLight: { value: 1 },
  uTime: { value: 0 },
};

export const GLSL_COMMON = /* glsl */ `
  uniform float uFog;
  uniform vec3 uFogColor;
  uniform vec3 uSun;
  uniform float uLight;
  uniform float uTime;
  const float SEA_LEVEL = 0.0;

  float fogFactor(vec3 world) {
    float d = length(cameraPosition - world);
    return 1.0 - exp(-uFog * uFog * d * d);
  }

  /* Distance fades into the haze on the horizon. */
  vec3 applyFog(vec3 c, vec3 world) {
    return mix(c, uFogColor, fogFactor(world));
  }

  /* Diffuse light, flattened when the light source sits on the horizon. */
  float sunlight(vec3 n) {
    return mix(0.45, max(dot(n, uSun), 0.0), uLight);
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
  uniform vec3 uColor;
  uniform float uLit;
  uniform float uOpacity;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    float diff = sunlight(n);
    /* Flat colour, shaded in two or three soft steps by the sun. */
    vec3 c = uColor * (0.62 + 0.48 * diff) + uLit;
    /* Anything below the waterline takes on the sea. */
    c = mix(c, c * vec3(0.45, 0.78, 0.76), step(vWorld.y, SEA_LEVEL));
    gl_FragColor = vec4(applyFog(c, vWorld), uOpacity);
  }
`;

/* Matte surfaces in flat colour: their own, or a tone along the navy-to-cream ramp. */
export function inkMaterial(
  tone = 0.06,
  opts: { lit?: number; side?: THREE.Side; color?: THREE.ColorRepresentation } = {},
) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uColor: { value: opts.color !== undefined ? new THREE.Color(opts.color) : toneColor(tone) },
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
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vWorld;
  void main() {
    vec3 c = uColor * mix(1.0, 0.6, step(vWorld.y, SEA_LEVEL));
    gl_FragColor = vec4(applyFog(c, vWorld), uOpacity);
  }
`;

/* The colour an outline of this tone takes: a dark edge, a shade lighter for brighter lines. */
export function lineColor(tone: number) {
  return new THREE.Color(PALETTE.outline).lerp(new THREE.Color(PALETTE.landLine), tone * 0.35);
}

/* Outlines: the thin dark edges that draw every built thing. */
export function lineMaterial(tone = 0.82, opacity = 1, color?: THREE.ColorRepresentation) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uColor: { value: color !== undefined ? new THREE.Color(color) : lineColor(tone) },
      uOpacity: { value: opacity },
    },
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
