import type * as THREE from "three";

/*
 * The world's own lighting for standard three.js materials: every material
 * passed through worldShade compiles the hooks registered here (the sun's
 * shadows, the clouds' shade, the wind's sway; see scene/shadows.ts), so a
 * model from a pack sits in the world like everything hand-written does.
 */

type ShadeHook = (shader: THREE.WebGLProgramParametersWithUniforms) => void;
const hooks: ShadeHook[] = [];

/*
 * Register a change every pack material makes to its shader (the world's
 * shadows, say). Materials made before a hook is added pick it up the next
 * time they compile.
 */
export function addShadeHook(hook: ShadeHook) {
  hooks.push(hook);
}

/* Join a material to the world's lighting. Safe to call more than once. */
export function worldShade<M extends THREE.Material>(m: M): M {
  if (m.userData.worldShade) return m;
  m.userData.worldShade = true;
  m.onBeforeCompile = (shader) => {
    for (const h of hooks) h(shader);
  };
  /* Every pack material compiles the same hooks: one program per material kind. */
  m.customProgramCacheKey = () => `world:${hooks.length}:${m.defines?.SWAY_AMP ?? ""}`;
  return m;
}
