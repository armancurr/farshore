import * as THREE from "three";
import { daylight, dayFraction, sunElevation } from "../../shared/daylight";
import { lerp, mulberry32, smoothstep } from "../../shared/math";
import { shared } from "./materials";

function moonTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;
  const halo = ctx.createRadialGradient(c, c, 30, c, c, c);
  halo.addColorStop(0, "rgba(255,255,255,0.35)");
  halo.addColorStop(0.35, "rgba(255,255,255,0.08)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(c, c, 36, 0, Math.PI * 2);
  ctx.fillStyle = "#e9e9e9";
  ctx.fill();
  /* Maria and craters, in grey. */
  const rng = mulberry32(7);
  ctx.save();
  ctx.clip();
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * 30;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, 2 + rng() * (i < 4 ? 12 : 4), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(90,90,90,${0.18 + rng() * 0.25})`;
    ctx.fill();
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* A soft white disc in a wide haze: the sun, drawn in the same grey as everything else. */
function sunTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;
  const halo = ctx.createRadialGradient(c, c, 20, c, c, c);
  halo.addColorStop(0, "rgba(255,255,255,0.5)");
  halo.addColorStop(0.3, "rgba(255,255,255,0.12)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(c, c, 26, 0, Math.PI * 2);
  ctx.fillStyle = "#f4f4f4";
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* Fog density and tone at night and by day. */
const FOG_NIGHT = 0.0033;
const FOG_DAY = 0.0031;
const FOG_TONE_DAY = 0.3;

/*
 * The sky, following the camera: black with stars and a moon by night, a soft
 * grey haze with a pale sun by day. It also drives the shared light and fog.
 */
export class Sky {
  readonly group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private moon: THREE.Sprite;
  private sun: THREE.Sprite;
  private sunDir = new THREE.Vector3();
  private moonDir = new THREE.Vector3();
  private starAlpha: { value: number };

  constructor() {
    const domeGeo = new THREE.SphereGeometry(1400, 32, 16);
    const domeMat = new THREE.ShaderMaterial({
      uniforms: { uMoon: shared.uMoon, uDay: shared.uDay, uFogTone: shared.uFogTone },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uMoon;
        uniform float uDay;
        uniform float uFogTone;
        varying vec3 vDir;
        void main() {
          float horizon = exp(-abs(vDir.y) * 9.0) * 0.07;
          float glow = pow(max(dot(vDir, uMoon), 0.0), 18.0) * mix(0.08, 0.14, uDay);
          /* By day: the fog tone at the horizon, a little darker overhead. */
          float day = mix(uFogTone, uFogTone * 0.72, smoothstep(0.0, 0.8, vDir.y));
          gl_FragColor = vec4(vec3(mix(horizon, day, uDay) + glow), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.renderOrder = -2;
    this.group.add(dome);

    const rng = mulberry32(99);
    const count = 2200;
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const u = rng() * 2 - 1;
      const y = 0.02 + Math.abs(u) * 0.98;
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 1300, y * 1300, Math.sin(a) * r * 1300], i * 3);
      size[i] = rng() < 0.04 ? 2.6 + rng() * 1.6 : 0.8 + rng() * 1.4;
      seed[i] = rng() * 100;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    starGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uScale: { value: 1 }, uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aSeed;
        uniform float uTime;
        uniform float uScale;
        uniform float uAlpha;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float twinkle = 0.65 + 0.35 * sin(uTime * (0.8 + fract(aSeed) * 2.0) + aSeed);
          vAlpha = twinkle * smoothstep(0.0, 0.15, normalize(position).y) * uAlpha;
          gl_PointSize = aSize * uScale;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = (1.0 - smoothstep(0.2, 0.5, d)) * vAlpha;
          gl_FragColor = vec4(vec3(a), 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.renderOrder = -1;
    this.group.add(stars);

    const moonMap = moonTexture();
    const moonMat = new THREE.SpriteMaterial({
      map: moonMap,
      depthWrite: false,
      fog: false,
      transparent: true,
    });
    this.moon = new THREE.Sprite(moonMat);
    this.moon.scale.setScalar(260);
    this.moon.renderOrder = -1;
    this.group.add(this.moon);

    const sunMap = sunTexture();
    const sunMat = new THREE.SpriteMaterial({
      map: sunMap,
      depthWrite: false,
      fog: false,
      transparent: true,
    });
    this.sun = new THREE.Sprite(sunMat);
    this.sun.scale.setScalar(420);
    this.sun.renderOrder = -1;
    this.group.add(this.sun);

    this.disposables.push(domeGeo, domeMat, starGeo, starMat, moonMap, moonMat, sunMap, sunMat);
    this.starScale = starMat.uniforms.uScale;
    this.starAlpha = starMat.uniforms.uAlpha;
    this.update(0);
  }

  /*
   * Set the sky for a world clock. The sun and moon ride opposite each other
   * on a tilted circle; the light comes from whichever is up, and shading
   * flattens out as they cross the horizon so the swap never shows.
   */
  update(time: number) {
    const a = (dayFraction(time) - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(a) * 0.82, Math.sin(a) * 0.86, -0.42).normalize();
    this.moonDir.set(-Math.cos(a) * 0.62, -Math.sin(a) * 0.86, -0.64).normalize();
    const elev = sunElevation(time);
    const day = daylight(time);

    const light = shared.uMoon.value.copy(elev > 0 ? this.sunDir : this.moonDir);
    light.y = Math.max(light.y, 0.3);
    light.normalize();
    shared.uLight.value = smoothstep(0.02, 0.22, Math.abs(elev));
    shared.uDay.value = day;
    shared.uFogTone.value = FOG_TONE_DAY * day;
    shared.uFog.value = lerp(FOG_NIGHT, FOG_DAY, day);

    this.moon.position.copy(this.moonDir).multiplyScalar(1200);
    this.sun.position.copy(this.sunDir).multiplyScalar(1200);
    (this.moon.material as THREE.SpriteMaterial).opacity =
      smoothstep(-0.05, 0.1, this.moonDir.y) * (1 - day * 0.75);
    (this.sun.material as THREE.SpriteMaterial).opacity =
      smoothstep(-0.05, 0.12, this.sunDir.y) * 0.8;
    this.starAlpha.value = 1 - smoothstep(0, 0.6, day);
  }

  private starScale: { value: number };

  setPixelRatio(ratio: number) {
    this.starScale.value = ratio;
  }

  follow(camera: THREE.Camera) {
    this.group.position.copy(camera.position);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}
