import * as THREE from "three";
import { CONTOUR, GRAND_SIZE, MAX_ISLANDS } from "../../shared/constants";
import type { Terrain } from "../../shared/terrain";
import { GLSL_COMMON, PALETTE, shared } from "./materials";
import { pathDistance } from "../../shared/paths";
import { bakeShoreDistance } from "./shore";

/*
 * Swash: every period a wave runs up the beach quickly, then drains back
 * slowly. Only the drawn waterline moves; the game's sea level stays put.
 * Needs uTime.
 */
const GLSL_SWASH = /* glsl */ `
  const float SWASH_PERIOD = 8.0;
  const float SWASH_LOW = -0.1;
  const float SWASH_HIGH = 0.22;

  float swashPhase() {
    return fract(uTime / SWASH_PERIOD);
  }

  float swashLevel() {
    float ph = swashPhase();
    float l = ph < 0.22 ? sin(ph / 0.22 * 1.5707963) : 0.5 + 0.5 * cos((ph - 0.22) / 0.78 * 3.1415927);
    return mix(SWASH_LOW, SWASH_HIGH, l);
  }

  float swashRecede() {
    return smoothstep(0.22, 0.45, swashPhase());
  }
`;

/*
 * The ground as the shaders see it: a cubic B-spline over the heightmap, with
 * its exact gradient. The mesh itself is only linear between samples, so lines
 * drawn from its height would kink at every triangle; drawn from this they curve.
 */
const GLSL_FIELD = /* glsl */ `
  uniform highp sampler2D uHeights;
  /* The centre of this island's tile on the grand map. */
  uniform vec2 uOrigin;
  uniform float uHalf;
  uniform float uCell;
  uniform int uGrid;

  void bspline(float t, out vec4 w, out vec4 d) {
    float t2 = t * t;
    float t3 = t2 * t;
    float u = 1.0 - t;
    w = vec4(u * u * u, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
    d = vec4(-0.5 * u * u, 1.5 * t2 - 2.0 * t, -1.5 * t2 + t + 0.5, 0.5 * t2);
  }

  /* (height, dh/dx, dh/dz) at a point on the ground. */
  vec3 field(vec2 xz) {
    vec2 g = (xz - uOrigin + uHalf) / uCell;
    vec2 i = floor(g);
    vec2 f = g - i;
    vec4 wx, dx, wz, dz;
    bspline(f.x, wx, dx);
    bspline(f.y, wz, dz);
    ivec2 base = ivec2(i) - 1;
    ivec2 top = ivec2(uGrid - 1);
    float h = 0.0, hx = 0.0, hz = 0.0;
    for (int b = 0; b < 4; b++) {
      float row = 0.0, rowD = 0.0;
      for (int a = 0; a < 4; a++) {
        float s = texelFetch(uHeights, clamp(base + ivec2(a, b), ivec2(0), top), 0).r;
        row += wx[a] * s;
        rowD += dx[a] * s;
      }
      h += wz[b] * row;
      hx += wz[b] * rowD;
      hz += dz[b] * row;
    }
    return vec3(h, hx / uCell, hz / uCell);
  }

  /* Iso-lines of v, a steady px pixels wide, given v's screen-space gradient; they fade before they'd alias. */
  float isoPx(float v, vec2 dv, float px) {
    float w = max(length(dv), 1e-6);
    float d = abs(fract(v - 0.5) - 0.5) / w;
    return (1.0 - smoothstep(px * 0.5 - 0.5, px * 0.5 + 0.5, d)) * (1.0 - smoothstep(0.12, 0.3, w));
  }

  /* The single line where v is zero, px pixels wide, given |screen gradient| g. */
  float zeroPx(float v, float g, float px) {
    return 1.0 - smoothstep(px * 0.5 - 0.6, px * 0.5 + 0.6, abs(v) / max(g, 1e-6));
  }

  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + 1.0), f.x), f.y);
  }

`;

/* The palette as the land and sea shaders see it. */
const hex = (h: number) => new THREE.Color(h);
const colors = {
  uLand: { value: hex(PALETTE.land) },
  uLandLine: { value: hex(PALETTE.landLine) },
  uLandMajor: { value: hex(PALETTE.landMajor) },
  uWetLand: { value: hex(PALETTE.wetLand) },
  uLandMeadow: { value: hex(PALETTE.landMeadow) },
  uLandForest: { value: hex(PALETTE.landForest) },
  uSeabed: { value: hex(PALETTE.seabed) },
  uFoam: { value: hex(PALETTE.foam) },
  uSea: { value: hex(PALETTE.sea) },
  uSeaLine: { value: hex(PALETTE.seaLine) },
  uSeaDeep: { value: hex(PALETTE.seaDeep) },
  /* The ground's zones, all mixed from the palette: pale sand, worn earth, lavender stone. */
  uSand: { value: hex(PALETTE.paper).lerp(hex(PALETTE.plank), 0.42) },
  uDirt: { value: hex(PALETTE.land).lerp(hex(PALETTE.plank), 0.3) },
  uCobble: { value: hex(PALETTE.rock).lerp(hex(PALETTE.landMajor), 0.5) },
  uRock: { value: hex(PALETTE.rock) },
  uRockDark: { value: hex(PALETTE.landMajor).lerp(hex(PALETTE.timber), 0.35) },
};
const GLSL_COLORS = /* glsl */ `
  uniform vec3 uLand;
  uniform vec3 uLandLine;
  uniform vec3 uLandMajor;
  uniform vec3 uWetLand;
  uniform vec3 uLandMeadow;
  uniform vec3 uLandForest;
  uniform vec3 uSeabed;
  uniform vec3 uFoam;
  uniform vec3 uSea;
  uniform vec3 uSeaLine;
  uniform vec3 uSeaDeep;
  uniform vec3 uSand;
  uniform vec3 uDirt;
  uniform vec3 uCobble;
  uniform vec3 uRock;
  uniform vec3 uRockDark;
`;

const TERRAIN_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/*
 * The island in flat colour: one even ground, softly lit by the sun, with a
 * faint contour every 2.5 m and a stronger index contour every 10 m, traced
 * from the smooth field so they curve cleanly and hold one width. At the
 * water's edge the ground draws the swash itself: wet ground, a sheen as the
 * wave drains, and foam lace in thin lines.
 */
const TERRAIN_FRAGMENT = /* glsl */ `
  ${GLSL_COMMON}
  ${GLSL_COLORS}
  ${GLSL_SWASH}
  ${GLSL_FIELD}
  uniform float uContour;
  /* The island's meadows (r) and groves (g), over its tile. */
  uniform sampler2D uFlora;
  /* Distance to the nearest path (r, 0..12 m), the trampled ground of the places (g), distance inland (b, 0..32 m). */
  uniform sampler2D uZones;
  /* 1 on the Harbor: its paths are cobbled. */
  uniform float uCobbled;
  varying vec3 vWorld;

  /* Cobblestones: a cell pattern, each stone its own shade, mortar between. */
  vec2 cobble(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float d1 = 9.0, d2 = 9.0, id = 0.0;
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(hash2(i + g), hash2(i + g + 17.1)) * 0.8 + 0.1;
        float d = length(g + o - f);
        if (d < d1) { d2 = d1; d1 = d; id = hash2(i + g + 3.7); }
        else if (d < d2) d2 = d;
      }
    return vec2(d2 - d1, id);
  }

  void main() {
    vec3 hf = field(vWorld.xz);
    float h = hf.x;
    float slope = length(hf.yz);
    vec3 n = normalize(vec3(-hf.y, 1.0, -hf.z));
    float shade = worldShadow(vWorld + n * 0.1);
    float diff = sunlight(n) * shade;

    /* How fast h changes per pixel, exactly, so every line holds its width. */
    vec2 dh = vec2(dot(hf.yz, dFdx(vWorld).xz), dot(hf.yz, dFdy(vWorld).xz));
    float gpx = max(length(dh), 1e-6);

    float dist = length(cameraPosition - vWorld);
    float weight = mix(1.3, 0.9, smoothstep(15.0, 220.0, dist));
    float minor = isoPx(h / uContour, dh / uContour, 1.1 * weight);
    float major = isoPx(h / (uContour * 4.0), dh / (uContour * 4.0), 2.0 * weight);
    /* On level ground a contour would wander; let it go instead. */
    float fade = smoothstep(0.004, 0.03, slope);

    vec2 tuv = (vWorld.xz - uOrigin + uHalf) / (2.0 * uHalf);
    vec2 flora = texture2D(uFlora, tuv).rg;
    vec3 zone = texture2D(uZones, tuv).rgb;
    float grain = vnoise(vWorld.xz * 0.35);
    float blot = vnoise(vWorld.xz * 0.045);

    /* The open ground: meadow and grove tints over the bare land, mottled so it isn't flat paint. */
    vec3 ground = mix(uLand, uLandMeadow * 1.08, flora.r);
    ground = mix(ground, uLandForest, flora.g * 0.6);
    ground *= 0.94 + 0.12 * blot + 0.04 * grain;

    /* The beach: a band of pale sand above the waterline, wider where the shore is gentle. */
    float inland = zone.b * 32.0;
    float reach = 7.0 + 12.0 * blot;
    float sand = (1.0 - smoothstep(reach - 2.5, reach + 1.5, inland)) * (1.0 - smoothstep(2.5, 4.0, h)) * smoothstep(0.55, 0.8, n.y);
    ground = mix(ground, uSand * (0.95 + 0.08 * grain), sand);

    /* Cliffs: the terraces' risers show their rock, in layers, darker toward the foot. */
    float steep = smoothstep(0.8, 0.6, n.y);
    float strata = smoothstep(0.42, 0.58, fract(h * 0.55 + blot * 0.8));
    vec3 rock = mix(uRockDark, uRock, 0.35 + 0.45 * strata + 0.2 * grain);
    ground = mix(ground, rock, steep);

    /* Paths: worn earth (cobbles on the Harbor) with a soft, ragged edge; places are trampled. */
    float pd = zone.r * 12.0 + (grain - 0.5) * 0.7;
    /* Trails are a cart's width; the Harbor's cobbled lanes are wider. */
    float tw = uCobbled > 0.5 ? 1.9 : 1.15;
    float trail = 1.0 - smoothstep(tw - 0.4, tw + 0.35, pd);
    float verge = (1.0 - smoothstep(tw + 0.2, tw + 1.6, pd)) * (1.0 - trail);
    vec3 path = uDirt * (0.92 + 0.1 * grain);
    if (uCobbled > 0.5) {
      vec2 cb = cobble(vWorld.xz * 1.4);
      vec3 stone = uCobble * (0.86 + 0.18 * cb.y);
      path = mix(uDirt * 0.8, stone, smoothstep(0.04, 0.12, cb.x));
    }
    ground = mix(ground, ground * 0.9, verge * 0.6);
    ground = mix(ground, path, trail * (1.0 - steep));
    /* Round the places the ground is trodden bare. */
    float trod = zone.g * (0.5 + 0.35 * grain) * (1.0 - steep) * (1.0 - trail);
    ground = mix(ground, uDirt * (0.9 + 0.1 * grain), trod);
    float worn = max(trail, trod);

    vec3 c = ground * (0.74 + 0.4 * diff);
    /* Shadows lean cool: violet from the sky, not grey. */
    c = mix(c, c * vec3(0.86, 0.84, 1.08), (1.0 - shade) * 0.6);
    float lines = fade * (1.0 - steep) * (1.0 - worn) * (1.0 - sand);
    c = mix(c, uLandLine * (0.85 + 0.2 * diff), minor * 0.3 * lines);
    c = mix(c, uLandMajor * (0.85 + 0.2 * diff), major * 0.45 * lines);

    /* The shore. */
    float waterY = swashLevel();
    float recede = swashRecede();
    float under = waterY - h;
    float mpp = gpx / max(slope, 1e-4); /* metres per pixel, across the slope */

    float wet = 1.0 - smoothstep(SWASH_HIGH - 0.02, SWASH_HIGH + 0.06, h);
    c = mix(c, uWetLand, wet * (1.0 - smoothstep(0.0, 0.4, under)) * 0.8);
    float sheen = exp(-max(-under, 0.0) / 0.035) * step(under, 0.0) * recede;
    c += sheen * 0.08;
    /* Under the water the ground takes the sea's colour, darker as it deepens. */
    vec3 bed = mix(uSeabed * 1.08, uSeabed * 0.7, smoothstep(0.5, 8.0, under));
    c = mix(c, bed, smoothstep(0.0, 0.7, under));

    float edge = zeroPx(under, gpx, max(1.8, 0.22 / mpp));
    float lace = 0.0;
    for (int i = 1; i <= 3; i++) {
      float k = float(i);
      float li = zeroPx(under - k * (0.05 + 0.03 * recede), gpx, max(1.1, 0.07 / mpp));
      float broken = smoothstep(0.38, 0.62, vnoise(vWorld.xz * 1.1 + k * 17.3 + vec2(uTime * 0.2, -uTime * 0.13)));
      lace = max(lace, li * broken * (1.0 - k * 0.2));
    }
    float wrack = zeroPx(h - SWASH_HIGH - 0.01, gpx, max(1.0, 0.05 / mpp)) * smoothstep(0.45, 0.7, vnoise(vWorld.xz * 2.5)) * 0.45;
    float foam = max(max(edge * (1.0 - 0.45 * recede), lace * 0.7 * (1.0 - 0.55 * recede)), wrack);
    c = mix(c, uFoam, foam);

    gl_FragColor = vec4(applyFog(c, vWorld), 1.0);
  }
`;

const WATER_VERTEX = /* glsl */ `
  uniform float uTime;
  ${GLSL_SWASH}
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    world.y += swashLevel();
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/*
 * The sea is engraved like an old chart: water-lines that follow the coast,
 * close together at the beach and wider apart offshore. They roll in one per
 * swash period, so each line that reaches the shore is the wave that runs up
 * the sand. Shallow water stays clear and leaves the edge to the ground.
 */
const WATER_FRAGMENT = /* glsl */ `
  ${GLSL_COMMON}
  ${GLSL_COLORS}
  ${GLSL_SWASH}
  ${GLSL_FIELD}
  uniform sampler2D uShore;
  uniform float uShoreGrid;
  uniform float uShoreCell;
  varying vec3 vWorld;

  float shoreDistance(vec2 local) {
    vec2 uv = ((local + uHalf) / uShoreCell + 0.5) / uShoreGrid;
    return texture2D(uShore, clamp(uv, 0.0, 1.0)).r + length(max(abs(local) - uHalf, 0.0));
  }

  void main() {
    vec2 xz = vWorld.xz;
    vec2 local = xz - uOrigin;
    float edge = max(abs(local.x), abs(local.y));
    float inside = step(edge, uHalf);
    float ground = mix(-30.0, field(xz).x, inside);
    float depth = vWorld.y - ground;
    float s = shoreDistance(local);

    float ph = 7.0 * log(1.0 + s / 10.6) + uTime / SWASH_PERIOD;
    float w = max(length(vec2(dFdx(ph), dFdy(ph))), 1e-5);
    float id = floor(ph + 0.5);
    float near = exp(-s / 18.0);
    float px = mix(1.0, 2.6, near);
    float line = (1.0 - smoothstep(px * 0.5 - 0.5, px * 0.5 + 0.5, abs(ph - id) / w)) * (1.0 - smoothstep(0.15, 0.35, w));
    /* Offshore each line breaks into crests; inshore it runs the length of the beach. */
    float gaps = smoothstep(0.3, 0.52, vnoise(xz * 0.03 + vec2(id * 7.31, id * 3.17)));
    line *= mix(gaps, 1.0, smoothstep(28.0, 8.0, s));
    line *= 1.0 - smoothstep(95.0, 165.0, s);
    /* Toward the tile's edge the lines let go, so it meets the open sea (or a neighbour) without a seam. */
    line *= 1.0 - smoothstep(uHalf - 80.0, uHalf - 8.0, edge);
    /* Lines brighten toward the beach, where each one is a wave about to run up it. */
    vec3 lineColor = mix(mix(uSea, uSeaLine, 0.55), uSeaLine, near) + 0.12 * exp(-s / 2.5);

    /* The sun's path on the water. */
    vec3 view = normalize(vWorld - cameraPosition);
    vec3 r = reflect(view, vec3(0.0, 1.0, 0.0));
    float glint = pow(max(dot(r, uSun), 0.0), 60.0) * uLight;
    /* Broken into drifting glitter rather than a regular pattern. */
    float sparkle = vnoise(xz * 0.9 + uTime * vec2(0.4, 0.25)) * vnoise(xz * vec2(1.7, 2.3) - uTime * vec2(0.3, 0.5));
    glint *= 0.15 + 0.85 * smoothstep(0.12, 0.45, sparkle);

    /* A touch lighter over the shelf, the open sea's own colour beyond it. */
    vec3 water = mix(uSea, mix(uSea, uSeaLine, 0.18), exp(-s / 40.0)) + glint * 0.9;
    vec3 c = mix(water, lineColor, line);
    /* Clear in the shallows, so the ground's edge shows; solid once it's deep. */
    float alpha = 0.93 * smoothstep(0.25, 1.6, depth) + 0.07 * smoothstep(2.0, 6.0, depth);
    alpha = max(alpha, line * smoothstep(0.02, 0.25, depth));
    if (depth < 0.0) alpha = 0.0;

    if (!gl_FrontFacing) { c = uSeaDeep * 0.8 + line * 0.1; alpha = 0.85; }

    gl_FragColor = vec4(applyFog(c, vWorld), alpha);
  }
`;

/* The island's meadow and forest fields, baked small for the ground to tint by. */
function floraTexture(terrain: Terrain) {
  const n = 256;
  const data = new Uint8Array(n * n * 4);
  const f = terrain.flora;
  for (let i = 0; i < n; i++) {
    const z = ((i + 0.5) / n - 0.5) * terrain.size;
    for (let j = 0; j < n; j++) {
      const x = ((j + 0.5) / n - 0.5) * terrain.size;
      const k = (i * n + j) * 4;
      data[k] = Math.round(f.meadow(x, z) * 255);
      data[k + 1] = Math.round(f.forest(x, z) * 255);
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/*
 * The paths and places, baked fine enough to draw a trail's edge: distance to
 * the nearest path (r) and how trampled the ground is round each place (g).
 */
function zonesTexture(terrain: Terrain) {
  const res = Math.min(1024, Math.round(terrain.size / 1.6));
  const local = terrain.paths.map((line) =>
    line.map((p) => ({ x: p.x - terrain.ox, z: p.z - terrain.oz })),
  );
  const dist = pathDistance(local, terrain.half, res, 12);
  const data = new Uint8Array(res * res * 4);
  const cell = terrain.size / res;
  for (let k = 0; k < res * res; k++) data[k * 4] = Math.round((dist[k] / 12) * 255);
  for (const pl of terrain.places) {
    if (pl.kind === "landing" || pl.kind === "dock" || pl.kind === "wreck") continue;
    /* The market is a cobbled square: drawn as path, not trodden earth. */
    const square = pl.kind === "market";
    const cx = pl.x - terrain.ox + terrain.half;
    const cz = pl.z - terrain.oz + terrain.half;
    const r = pl.r + 2;
    for (
      let i = Math.max(0, Math.floor((cz - r) / cell));
      i <= Math.min(res - 1, Math.ceil((cz + r) / cell));
      i++
    )
      for (
        let j = Math.max(0, Math.floor((cx - r) / cell));
        j <= Math.min(res - 1, Math.ceil((cx + r) / cell));
        j++
      ) {
        const d = Math.hypot((j + 0.5) * cell - cx, (i + 0.5) * cell - cz);
        const v = Math.round(
          255 * (1 - Math.min(1, Math.max(0, (d - pl.r * 0.55) / (r - pl.r * 0.55)))),
        );
        const k = (i * res + j) * 4;
        if (square) {
          if (d < pl.r + 1)
            data[k] = Math.min(data[k], Math.round((Math.max(0, d - pl.r + 2) / 12) * 255));
        } else if (v > data[k + 1]) data[k + 1] = v;
      }
  }
  /* How far inland each spot is (b, 0..32 m): the beach is a band round the coast, whatever its height. */
  const inland = new Float32Array(res * res);
  for (let i = 0; i < res; i++)
    for (let j = 0; j < res; j++) {
      const x = terrain.ox - terrain.half + (j + 0.5) * cell;
      const z = terrain.oz - terrain.half + (i + 0.5) * cell;
      inland[i * res + j] = terrain.heightAt(x, z) > 0.05 ? 1e6 : 0;
    }
  chamfer(inland, res, cell);
  for (let k = 0; k < res * res; k++)
    data[k * 4 + 2] = Math.round(Math.min(1, inland[k] / 32) * 255);
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/* A two-pass chamfer distance transform, in place: zeros stay, everything else becomes its distance to one. */
function chamfer(d: Float32Array, n: number, cell: number) {
  const a = cell;
  const b = cell * Math.SQRT2;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      let v = d[k];
      if (j > 0) v = Math.min(v, d[k - 1] + a);
      if (i > 0) {
        v = Math.min(v, d[k - n] + a);
        if (j > 0) v = Math.min(v, d[k - n - 1] + b);
        if (j < n - 1) v = Math.min(v, d[k - n + 1] + b);
      }
      d[k] = v;
    }
  for (let i = n - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--) {
      const k = i * n + j;
      let v = d[k];
      if (j < n - 1) v = Math.min(v, d[k + 1] + a);
      if (i < n - 1) {
        v = Math.min(v, d[k + n] + a);
        if (j < n - 1) v = Math.min(v, d[k + n + 1] + b);
        if (j > 0) v = Math.min(v, d[k + n - 1] + b);
      }
      d[k] = v;
    }
}

function heightTexture(terrain: Terrain) {
  const tex = new THREE.DataTexture(
    new Float32Array(terrain.heights),
    terrain.grid,
    terrain.grid,
    THREE.RedFormat,
    THREE.FloatType,
  );
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/*
 * One island: its ground and the sea over its tile, sharing one height
 * texture, both placed at the island's spot on the grand map.
 */
export function createLand(terrain: Terrain) {
  const heights = heightTexture(terrain);
  const shore = bakeShoreDistance(terrain.heights, terrain.grid, terrain.size);
  const flora = floraTexture(terrain);
  const zones = zonesTexture(terrain);
  const field = {
    uHeights: { value: heights },
    uOrigin: { value: new THREE.Vector2(terrain.ox, terrain.oz) },
    uHalf: { value: terrain.half },
    uCell: { value: terrain.cell },
    uGrid: { value: terrain.grid },
  };

  const geo = new THREE.PlaneGeometry(
    terrain.size,
    terrain.size,
    terrain.grid - 1,
    terrain.grid - 1,
  );
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) pos.setY(k, terrain.heights[k]);
  geo.deleteAttribute("uv");
  geo.deleteAttribute("normal");
  geo.computeBoundingSphere();
  const groundMat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      ...colors,
      ...field,
      uContour: { value: CONTOUR },
      uFlora: { value: flora },
      uZones: { value: zones },
      uCobbled: { value: terrain.harbor ? 1 : 0 },
    },
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
  });
  const ground = new THREE.Mesh(geo, groundMat);
  ground.name = "terrain";
  ground.position.set(terrain.ox, 0, terrain.oz);

  /* A touch wider than the tile, so it overlaps the open sea rather than leaving a crack. */
  const seaGeo = new THREE.PlaneGeometry(terrain.size + 1, terrain.size + 1, 1, 1);
  seaGeo.rotateX(-Math.PI / 2);
  const seaMat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      ...colors,
      ...field,
      uShore: { value: shore.tex },
      uShoreGrid: { value: shore.grid },
      uShoreCell: { value: shore.cell },
    },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.name = "water";
  sea.renderOrder = 2;
  sea.position.set(terrain.ox, 0, terrain.oz);

  /* The textures go when the ground does: the world tears down by disposing materials. */
  groundMat.addEventListener("dispose", () => {
    heights.dispose();
    shore.tex.dispose();
    flora.dispose();
    zones.dispose();
  });

  return [ground, sea] as const;
}

/*
 * The open sea between the islands: plain deep water out to the horizon. It
 * steps aside wherever an island's own tile of sea is drawn.
 */
const OPEN_SEA_FRAGMENT = /* glsl */ `
  ${GLSL_COMMON}
  ${GLSL_COLORS}
  ${GLSL_SWASH}
  uniform vec4 uTiles[${MAX_ISLANDS}];
  uniform int uTileCount;
  varying vec3 vWorld;

  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + 1.0), f.x), f.y);
  }

  void main() {
    vec2 xz = vWorld.xz;
    for (int i = 0; i < ${MAX_ISLANDS}; i++) {
      if (i >= uTileCount) break;
      vec4 t = uTiles[i];
      if (max(abs(xz.x - t.x), abs(xz.y - t.y)) < t.z) discard;
    }
    vec3 view = normalize(vWorld - cameraPosition);
    vec3 r = reflect(view, vec3(0.0, 1.0, 0.0));
    float glint = pow(max(dot(r, uSun), 0.0), 60.0) * uLight;
    float sparkle = vnoise(xz * 0.9 + uTime * vec2(0.4, 0.25)) * vnoise(xz * vec2(1.7, 2.3) - uTime * vec2(0.3, 0.5));
    glint *= 0.15 + 0.85 * smoothstep(0.12, 0.45, sparkle);
    vec3 c = uSea + glint * 0.9;
    float alpha = 1.0;
    if (!gl_FrontFacing) { c = uSeaDeep * 0.8; alpha = 0.85; }
    gl_FragColor = vec4(applyFog(c, vWorld), alpha);
  }
`;

export class OpenSea {
  readonly mesh: THREE.Mesh;
  private tiles = Array.from({ length: MAX_ISLANDS }, () => new THREE.Vector4());
  private count = { value: 0 };

  constructor() {
    const geo = new THREE.PlaneGeometry(GRAND_SIZE + 6400, GRAND_SIZE + 6400, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, ...colors, uTiles: { value: this.tiles }, uTileCount: this.count },
      vertexShader: WATER_VERTEX,
      fragmentShader: OPEN_SEA_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = "open-sea";
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
  }

  /* Where the islands' own seas are. */
  setTiles(tiles: readonly { x: number; z: number; size: number }[]) {
    const n = Math.min(tiles.length, MAX_ISLANDS);
    for (let i = 0; i < n; i++) this.tiles[i].set(tiles[i].x, tiles[i].z, tiles[i].size / 2, 0);
    this.count.value = n;
  }
}
