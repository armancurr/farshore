import * as THREE from "three";
import { mulberry32 } from "../../shared/math";
import { MOON_DIR, shared } from "./materials";

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

/* Black sky, a faint horizon, a field of stars and a moon. It follows the camera. */
export class Sky {
  readonly group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];

  constructor() {
    const domeGeo = new THREE.SphereGeometry(1400, 32, 16);
    const domeMat = new THREE.ShaderMaterial({
      uniforms: { uMoon: shared.uMoon },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uMoon;
        varying vec3 vDir;
        void main() {
          float horizon = exp(-abs(vDir.y) * 9.0) * 0.07;
          float moonGlow = pow(max(dot(vDir, uMoon), 0.0), 18.0) * 0.08;
          gl_FragColor = vec4(vec3(horizon + moonGlow), 1.0);
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
      uniforms: { uTime: shared.uTime, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aSeed;
        uniform float uTime;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float twinkle = 0.65 + 0.35 * sin(uTime * (0.8 + fract(aSeed) * 2.0) + aSeed);
          vAlpha = twinkle * smoothstep(0.0, 0.15, normalize(position).y);
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
    const moonMat = new THREE.SpriteMaterial({ map: moonMap, depthWrite: false, fog: false });
    const moon = new THREE.Sprite(moonMat);
    moon.position.copy(MOON_DIR).multiplyScalar(1200);
    moon.scale.setScalar(260);
    moon.renderOrder = -1;
    this.group.add(moon);

    this.disposables.push(domeGeo, domeMat, starGeo, starMat, moonMap, moonMat);
    this.starScale = starMat.uniforms.uScale;
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
