import { BOUNDARY, SEA_LEVEL } from "./constants";
import type { DriveIntent, VehicleState } from "./drive";
import { clamp, wrapAngle } from "./math";
import { type Ground, overSolid } from "./terrain";
import { sailPolar, windAt } from "./wind";

/*
 * Anything that floats: rowboats, sailboats, ships and motorboats share one
 * hull. It glides and slows on its own, runs aground in the shallows, and
 * bumps off docks, jetties and other boats. What drives it differs:
 *
 *   row    W and S pull on the oars; you can pivot on them at a standstill
 *   sail   W and S set and take in sail, and the wind (wind.ts) does the rest:
 *          fastest on a reach, slow dead downwind, barely creeping head to wind
 *   motor  W opens the throttle, S goes astern; the hull banks into turns and
 *          lifts its bow as it gets up on the plane
 *
 * Heading uses the same convention as a body's yaw (0 faces -Z).
 */

export type HullSpec = {
  mode: "row" | "sail" | "motor";
  /* Metres: overall length and beam, and how much water the hull draws. */
  length: number;
  beam: number;
  draft: number;
  /* Top speed (with the wind on the beam, for a sail), astern, and how quickly it gets there. */
  speed: number;
  reverse: number;
  accel: number;
  /* How fast it loses way with nothing driving it. */
  drag: number;
  /* Most turn, radians a second, with way on. */
  turn: number;
};

/* How quickly sail is set or taken in, as a share of all of it a second. */
const SAIL_RATE = 0.55;

/* Points round the waterline, in the hull's own space (bow toward -z). */
function hullPoints(spec: HullSpec): [number, number][] {
  const l = spec.length / 2;
  const w = spec.beam / 2;
  return [
    [0, -l],
    [w * 0.7, -l * 0.5],
    [-w * 0.7, -l * 0.5],
    [w, 0],
    [-w, 0],
    [w * 0.9, l * 0.6],
    [-w * 0.9, l * 0.6],
    [w * 0.6, l * 0.98],
    [-w * 0.6, l * 0.98],
  ];
}

const POINTS = new WeakMap<HullSpec, [number, number][]>();

/* Is the hull clear of the bottom, the shore and anything built in the water? */
export function hullClear(terrain: Ground, spec: HullSpec, x: number, z: number, rot: number) {
  let pts = POINTS.get(spec);
  if (!pts) {
    pts = hullPoints(spec);
    POINTS.set(spec, pts);
  }
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  /* The bow and stern taper, so they need less water than the middle. */
  for (const [lx, lz] of pts) {
    const px = x + lx * c + lz * s;
    const pz = z - lx * s + lz * c;
    if (Math.abs(px) > BOUNDARY - 2 || Math.abs(pz) > BOUNDARY - 2) return false;
    const end = Math.abs(lz) > spec.length * 0.4 ? 0.6 : 1;
    if (terrain.heightAt(px, pz) > SEA_LEVEL - spec.draft * end) return false;
    for (const sol of terrain.solidsNear(px, pz)) {
      if (sol.top < SEA_LEVEL - 0.3 || sol.bottom > SEA_LEVEL + 0.8) continue;
      if (overSolid(sol, px, pz)) return false;
    }
  }
  return true;
}

/* What the wind can give a sail heading `rot`, as a share of its best. */
export function sailDrive(rot: number, time: number) {
  const w = windAt(time);
  /* How far the heading is from where the wind blows: 0 running before it. */
  const off = wrapAngle(rot - w.angle);
  return { off, power: sailPolar(off) * (0.45 + 0.55 * w.strength), wind: w };
}

/* Step a hull. Returns true if it hit something. */
export function stepHull(
  b: VehicleState,
  input: DriveIntent,
  dt: number,
  terrain: Ground,
  spec: HullSpec,
  time: number,
) {
  let hit = false;
  let remaining = Math.min(dt, 0.25);
  while (remaining > 1e-7) {
    const h = Math.min(remaining, 1 / 60);
    remaining -= h;
    if (stepOnce(b, input, h, terrain, spec, time)) hit = true;
  }
  return hit;
}

function stepOnce(
  b: VehicleState,
  input: DriveIntent,
  dt: number,
  terrain: Ground,
  spec: HullSpec,
  time: number,
) {
  const forward = clamp(input.forward, -1, 1);
  let want: number | null;
  let accel = spec.accel;
  let heel = 0;
  if (spec.mode === "sail") {
    /* W and S set and take in sail; what's set stays set. */
    b.aux = clamp(b.aux + forward * SAIL_RATE * dt, 0, 1);
    const drive = sailDrive(b.rot, time);
    want = b.aux > 0.02 ? spec.speed * drive.power * b.aux : forward < 0 ? -spec.reverse : null;
    /* She heels away from the wind, the more so with more sail on the beam. */
    heel = -Math.sign(drive.off) * Math.sin(Math.abs(drive.off)) * b.aux * drive.wind.strength;
    /* A big ship takes a while to gather way. */
    accel = spec.accel * 0.6;
  } else {
    b.aux += (forward - b.aux) * Math.min(1, dt * 3);
    want = forward > 0 ? spec.speed * forward : forward < 0 ? -spec.reverse : null;
  }
  if (want !== null) b.speed += clamp(want - b.speed, -accel * dt * 1.5, accel * dt);
  else b.speed -= b.speed * Math.min(1, spec.drag * dt);

  /* A rudder needs water flowing past it; oars can pivot the boat at a standstill. */
  const way = Math.min(1, Math.abs(b.speed) / Math.max(1, spec.speed * 0.4));
  const grip =
    spec.mode === "row"
      ? 0.45 + 0.55 * way
      : spec.mode === "sail"
        ? 0.35 + 0.65 * way
        : 0.15 + 0.85 * way;
  const target = -clamp(input.right, -1, 1) * spec.turn * grip;
  b.turn += (target - b.turn) * Math.min(1, dt * (spec.mode === "motor" ? 5 : 3));
  b.steer = clamp(input.right, -1, 1);

  /* The way it sits in the water: bow up on the plane, banked into turns, heeled by the wind. */
  const pace = clamp(b.speed / spec.speed, -1, 1);
  const pitch = spec.mode === "motor" ? Math.max(0, pace) * 0.07 * (1.2 - pace * 0.5) : 0;
  const roll =
    spec.mode === "motor"
      ? clamp(-b.turn * pace * 0.22, -0.2, 0.2)
      : spec.mode === "sail"
        ? heel * 0.14
        : -b.turn * 0.03;
  b.pitch += (pitch - b.pitch) * Math.min(1, dt * 2);
  b.roll += (roll - b.roll) * Math.min(1, dt * 2);
  b.y = SEA_LEVEL;

  const rot = wrapAngle(b.rot + b.turn * dt);
  if (hullClear(terrain, spec, b.x, b.z, rot)) b.rot = rot;
  else b.turn = 0;

  const nx = clamp(b.x - Math.sin(b.rot) * b.speed * dt, -BOUNDARY, BOUNDARY);
  const nz = clamp(b.z - Math.cos(b.rot) * b.speed * dt, -BOUNDARY, BOUNDARY);
  if (hullClear(terrain, spec, nx, nz, b.rot)) {
    b.x = nx;
    b.z = nz;
    return false;
  }
  b.speed = -b.speed * 0.2;
  return true;
}
