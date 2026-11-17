import * as THREE from "three";
import { GLSL_SHADOW_SAMPLING, shared } from "./materials";
import { addShadeHook } from "./packs";

/*
 * The sun's shadows. It's always day and the sun never moves, so every
 * shadow falls the same way: two depth maps seen from the sun, one tight
 * round you (crisp shadows under your feet and the trees beside you) and one
 * wide (whole groves shading the hillside across the valley). Both follow
 * you, snapped to whole texels so the edges don't crawl as you walk.
 *
 * Only what's on layer 0 casts. The sky, the sea, the clouds and the name
 * labels live on NO_CAST, which the main camera draws and the sun's doesn't.
 *
 * Every material samples the maps through GLSL_WORLD_LIGHT (in materials.ts):
 * the hand-written ones directly, the pack models' Lambert ones through a
 * shade hook that scales their direct sunlight.
 */

export const NO_CAST = 1;

type Cascade = {
  target: THREE.WebGLRenderTarget;
  camera: THREE.OrthographicCamera;
  /* Half the width of ground it covers, and how often it's redrawn (frames). */
  half: number;
  every: number;
  matrix: THREE.Matrix4;
};

const SIZE = 2048;
/* How far along the sun's ray the maps reach, either side of you. */
const DEPTH = 700;

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

export class SunShadows {
  private cascades: Cascade[];
  private depth = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  private frame = 0;
  private hidden: THREE.Object3D[] = [];
  private tmp = new THREE.Vector3();
  private lightRot = new THREE.Matrix4();
  private lightInv = new THREE.Matrix4();

  constructor() {
    this.cascades = [
      { half: 60, every: 1 },
      { half: 420, every: 3 },
    ].map(({ half, every }) => {
      const target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
        depthBuffer: true,
        depthTexture: new THREE.DepthTexture(SIZE, SIZE, THREE.UnsignedIntType),
      });
      const tex = target.depthTexture as THREE.DepthTexture;
      tex.compareFunction = THREE.LessEqualCompare;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0, DEPTH * 2);
      camera.layers.set(0);
      return { target, camera, half, every, matrix: new THREE.Matrix4() };
    });
    shared.uShadow0.value = this.cascades[0].target.depthTexture;
    shared.uShadow1.value = this.cascades[1].target.depthTexture;
    shared.uShadowM0.value = this.cascades[0].matrix;
    shared.uShadowM1.value = this.cascades[1].matrix;
    shared.uShadowRange.value.set(this.cascades[0].half, this.cascades[1].half);

    /* The sun's frame: looking down its ray. */
    const sun = shared.uSun.value;
    const look = new THREE.Matrix4().lookAt(
      new THREE.Vector3(),
      sun.clone().negate(),
      new THREE.Vector3(0, 1, 0),
    );
    this.lightRot.extractRotation(look);
    this.lightInv.copy(this.lightRot).invert();
  }

  /* Draw the maps round `focus` (the camera, usually). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, focus: THREE.Vector3) {
    this.frame++;
    const sun = shared.uSun.value;
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevAuto = renderer.autoClear;
    const prevBg = scene.background;
    /* Glass, water, ghosts, name labels and anything marked noCast don't cast: hide them for the sun's look. */
    const hidden = this.hidden;
    hidden.length = 0;
    scene.traverseVisible((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const see =
        o.userData.noCast ||
        (o as THREE.Sprite).isSprite ||
        (m && !Array.isArray(m) && m.transparent);
      if (see) hidden.push(o);
    });
    for (const o of hidden) o.visible = false;
    scene.overrideMaterial = this.depth;
    scene.background = null;
    renderer.autoClear = true;
    this.cascades.forEach((c, i) => {
      if (i > 0 && this.frame % c.every !== 0 && this.frame > 3) return;
      /* Snap the focus to a whole texel in the sun's frame, so the edges stay put. */
      const texel = (c.half * 2) / SIZE;
      const p = this.tmp.copy(focus).applyMatrix4(this.lightInv);
      p.x = Math.round(p.x / texel) * texel;
      p.y = Math.round(p.y / texel) * texel;
      p.applyMatrix4(this.lightRot);
      c.camera.position.copy(p).addScaledVector(sun, DEPTH);
      c.camera.quaternion.setFromRotationMatrix(this.lightRot);
      c.camera.updateMatrixWorld(true);
      c.camera.updateProjectionMatrix();
      c.matrix
        .multiplyMatrices(BIAS, c.camera.projectionMatrix)
        .multiply(c.camera.matrixWorldInverse);
      renderer.setRenderTarget(c.target);
      renderer.clear(false, true, false);
      renderer.render(scene, c.camera);
    });
    for (const o of hidden) o.visible = true;
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(prevTarget);
    shared.uShadowOn.value = 1;
  }

  dispose() {
    for (const c of this.cascades) {
      c.target.depthTexture?.dispose();
      c.target.dispose();
    }
    this.depth.dispose();
  }
}

/*
 * The pack models' Lambert materials: carry their world position (nudged
 * off the surface along its normal, so a face doesn't shadow itself) to the
 * fragment shader, and dim the sun's direct light by the shadow there.
 */
addShadeHook((shader) => {
  Object.assign(shader.uniforms, {
    uShadow0: shared.uShadow0,
    uShadow1: shared.uShadow1,
    uShadowM0: shared.uShadowM0,
    uShadowM1: shared.uShadowM1,
    uShadowOn: shared.uShadowOn,
    uShadowRange: shared.uShadowRange,
    uCloudMap: shared.uCloudMap,
    uCloudArea: shared.uCloudArea,
    uSun: shared.uSun,
  });
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vShadowWorld;")
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      {
        vec4 sw = vec4(transformed, 1.0);
        vec3 sn = objectNormal;
        #ifdef USE_INSTANCING
          sw = instanceMatrix * sw;
          sn = mat3(instanceMatrix) * sn;
        #endif
        sw = modelMatrix * sw;
        sn = normalize(mat3(modelMatrix) * sn);
        vShadowWorld = sw.xyz + sn * 0.06;
      }`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>\nvarying vec3 vShadowWorld;\nuniform vec3 uSun;\n${GLSL_SHADOW_SAMPLING}`,
    )
    .replace(
      "#include <lights_fragment_end>",
      `#include <lights_fragment_end>
      {
        float lit = worldShadow(vShadowWorld);
        reflectedLight.directDiffuse *= lit;
        reflectedLight.indirectDiffuse *= mix(0.86, 1.0, lit);
      }`,
    );
});
