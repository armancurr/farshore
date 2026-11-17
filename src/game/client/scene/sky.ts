import * as THREE from "three";
import { PALETTE, shared } from "./materials";

/*
 * The sky, following the camera. It's always day: a clear violet sky, a
 * little paler down at the horizon where distance fades into haze, and a
 * plain bright white sun high up with a soft glow round it.
 */
export class Sky {
  readonly group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];

  constructor() {
    const domeGeo = new THREE.SphereGeometry(1400, 32, 16);
    const domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uSun: shared.uSun,
        uFogColor: shared.uFogColor,
        uSky: { value: new THREE.Color(PALETTE.sky) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun;
        uniform vec3 uFogColor;
        uniform vec3 uSky;
        varying vec3 vDir;

        /* The sun's angular radius, in radians (about 5 degrees). */
        const float SUN_R = 0.09;

        void main() {
          vec3 dir = normalize(vDir);
          /* Haze at the horizon (and below it, where the far sea fades in), clear sky above. */
          vec3 sky = mix(uFogColor, uSky, smoothstep(0.0, 0.28, dir.y));

          float ang = acos(clamp(dot(dir, uSun), -1.0, 1.0));
          float disc = 1.0 - smoothstep(SUN_R - 0.004, SUN_R + 0.002, ang);
          float past = max(ang - SUN_R, 0.0);
          float glow = 0.5 * exp(-past * 18.0) + 0.12 * exp(-past * 4.0);

          vec3 c = sky + vec3(glow);
          /* Past white, so it stays blown out through the vignette. */
          c = mix(c, vec3(1.6), disc);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.renderOrder = -2;
    this.group.add(dome);
    this.disposables.push(domeGeo, domeMat);
  }

  follow(camera: THREE.Camera) {
    this.group.position.copy(camera.position);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}
