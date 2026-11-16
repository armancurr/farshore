import * as THREE from "three";
import { shared } from "./materials";

/*
 * The sky, following the camera. It's always day: one fixed grey, and a large
 * white sun high up, etched with warped contour rings that creep slowly inward.
 * Below the horizon the dome is the fog tone, which the far sea fades into;
 * above, it steps straight down to a darker grey, so sea meets sky on a crisp line.
 */
export class Sky {
  readonly group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];

  constructor() {
    const domeGeo = new THREE.SphereGeometry(1400, 32, 16);
    const domeMat = new THREE.ShaderMaterial({
      uniforms: { uSun: shared.uSun, uFogTone: shared.uFogTone, uTime: shared.uTime },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun;
        uniform float uFogTone;
        uniform float uTime;
        varying vec3 vDir;

        /* The sun's angular radius, in radians (about 7.5 degrees). */
        const float SUN_R = 0.13;
        const float RINGS = 7.0;

        /* An anti-aliased iso-line of v, roughly px pixels wide. */
        float isoLine(float v, float px) {
          float w = fwidth(v);
          float d = abs(fract(v - 0.5) - 0.5);
          return 1.0 - smoothstep(w * (px - 0.5), w * (px + 0.5), d);
        }

        void main() {
          vec3 dir = normalize(vDir);

          float above = mix(uFogTone * 0.5, uFogTone * 0.3, smoothstep(0.0, 0.8, dir.y));
          float sky = mix(uFogTone, above, smoothstep(-0.001, 0.002, dir.y));

          /* Polar coordinates around the sun: angle from its centre, and bearing. */
          vec3 t = normalize(cross(uSun, vec3(0.0, 1.0, 0.0)));
          vec3 b = cross(t, uSun);
          vec2 p = vec2(dot(dir, t), dot(dir, b));
          float ang = atan(length(p), dot(dir, uSun));
          float theta = atan(p.y, p.x);
          float r = ang / SUN_R;

          /* Contour rings, bent unevenly like the island's, drifting inward. */
          float warp = 0.06 * sin(theta * 3.0 + uTime * 0.11)
                     + 0.035 * sin(theta * 5.0 - 1.7 + r * 4.0)
                     + 0.02 * sin(theta * 9.0 + 2.3 - uTime * 0.07);
          float rings = isoLine(r * (1.0 + warp) * RINGS + uTime * 0.12, 1.6);
          rings *= smoothstep(0.08, 0.2, r);

          float disc = 1.0 - smoothstep(1.0 - fwidth(r) * 1.5, 1.0, r);
          float face = 1.0 - rings * 0.5;

          /* A tight white corona and a wide, faint haze. */
          float past = max(ang - SUN_R, 0.0);
          float corona = 0.45 * exp(-past * 16.0) + 0.1 * exp(-past * 3.0);

          float c = mix(sky + corona, face, disc);
          gl_FragColor = vec4(vec3(c), 1.0);
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
