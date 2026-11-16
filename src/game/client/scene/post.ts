import * as THREE from "three";

/*
 * The last pass: everything to grey (but the build ghost), a fine ordered dither so gradients break
 * into texture, a vignette, and the moods — underwater murk, a gasping pulse
 * when breath runs low, a white flash when someone shoves you.
 */
const FRAGMENT = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uUnder;
  uniform float uBreath;
  uniform float uFlash;
  uniform float uFade;
  varying vec2 vUv;

  float bayer4(vec2 p) {
    vec2 q = mod(floor(p), 4.0);
    float i = q.x + q.y * 4.0;
    float m[16];
    m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
    m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
    for (int k = 0; k < 16; k++) if (float(k) == i) return m[k] / 16.0;
    return 0.0;
  }

  void main() {
    vec2 uv = vUv;
    if (uUnder > 0.0) {
      uv.x += sin(uv.y * 24.0 + uTime * 2.1) * 0.0035 * uUnder;
      uv.y += cos(uv.x * 19.0 + uTime * 1.7) * 0.0025 * uUnder;
    }
    vec3 col = texture2D(tScene, uv).rgb;
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    /* The world is grey; the only colour that ever reaches here is the build ghost's, kept as is. */
    vec3 chroma = col - vec3(l);

    /* Underwater: lifted blacks, crushed highlights, a murky falloff. */
    float murk = mix(l, 0.09 + l * 0.45, uUnder);
    l = murk;

    vec2 c = vUv - 0.5;
    c.x *= uResolution.x / uResolution.y;
    float r = length(c);
    float vignette = 1.0 - smoothstep(0.45, 1.15, r) * 0.75;

    /* Breath: the edges close in and pulse when you're running out of air. */
    float gasp = 1.0 - uBreath;
    float pulse = 0.5 + 0.5 * sin(uTime * (4.0 + gasp * 6.0));
    float tunnel = smoothstep(0.85 - gasp * 0.55, 0.05, r);
    l *= mix(1.0, tunnel, gasp * (0.65 + 0.35 * pulse));
    l *= vignette;

    l += uFlash * 0.35 * (1.0 - r);

    float grain = fract(sin(dot(gl_FragCoord.xy + uTime * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
    l += (grain - 0.5) * 0.025;

    float levels = 28.0;
    l = floor(l * levels + bayer4(gl_FragCoord.xy)) / levels;
    l *= uFade;
    gl_FragColor = vec4(clamp(vec3(l) + chroma * uFade, 0.0, 1.0), 1.0);
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
    uBreath: { value: number };
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
      uBreath: { value: 1 },
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
