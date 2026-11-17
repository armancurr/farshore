import * as THREE from "three";

/*
 * The last pass: a soft vignette, the faintest grain so flat colour doesn't
 * band, and the moods — underwater, a teal murk; a white flash when someone
 * shoves you; the fade when you black out.
 */
const FRAGMENT = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uUnder;
  uniform float uFlash;
  uniform float uFade;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    if (uUnder > 0.0) {
      uv.x += sin(uv.y * 24.0 + uTime * 2.1) * 0.0035 * uUnder;
      uv.y += cos(uv.x * 19.0 + uTime * 1.7) * 0.0025 * uUnder;
    }
    /* The scene is drawn in linear light (three.js colours are); show it in sRGB. */
    vec3 lin = max(texture2D(tScene, uv).rgb, vec3(0.0));
    vec3 col = mix(lin * 12.92, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, lin));

    /* Underwater: everything sinks into a deep teal. */
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 murk = vec3(0.07, 0.33, 0.34) + col * vec3(0.25, 0.45, 0.45) + l * 0.08;
    col = mix(col, murk, uUnder);

    vec2 c = vUv - 0.5;
    c.x *= uResolution.x / uResolution.y;
    float r = length(c);
    col *= 1.0 - smoothstep(0.55, 1.25, r) * 0.45;

    col += uFlash * 0.3 * (1.0 - r);

    float grain = fract(sin(dot(gl_FragCoord.xy + uTime * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
    col += (grain - 0.5) * 0.012;

    gl_FragColor = vec4(clamp(col * uFade, 0.0, 1.0), 1.0);
  }
`;

export class PostPass {
  readonly target: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  readonly uniforms: {
    tScene: { value: THREE.Texture };
    uResolution: { value: THREE.Vector2 };
    uTime: { value: number };
    uUnder: { value: number };
    uFlash: { value: number };
    uFade: { value: number };
  };

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      samples: 4,
    });
    this.uniforms = {
      tScene: { value: this.target.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uUnder: { value: 0 },
      uFlash: { value: 0 },
      uFade: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setSize(width: number, height: number) {
    this.target.setSize(width, height);
    this.uniforms.uResolution.value.set(width, height);
  }

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    overlay?: { scene: THREE.Scene; camera: THREE.Camera },
  ) {
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    /* The held weapon goes on top with fresh depth, so it never clips into walls. */
    if (overlay) {
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(overlay.scene, overlay.camera);
      renderer.autoClear = auto;
    }
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    (this.scene.children[0] as THREE.Mesh).geometry.dispose();
  }
}
