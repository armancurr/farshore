import { BOUNDARY, SEA_LEVEL } from "./constants";
import { clamp, wrapAngle } from "./math";
import { overSolid, type Terrain } from "./terrain";

/*
 * A rowboat: W and S pull on the oars, A and D turn it. It glides and slows
 * on its own, runs aground in the shallows, and bumps off docks and jetties.
 * Heading uses the same convention as a body's yaw (0 faces -Z).
 */

export type BoatState = { x: number; z: number; rot: number; speed: number; turn: number };

export const ROW_SPEED = 5.4;
const BACK_SPEED = 1.8;
const ROW_ACCEL = 2.2;
const DRAG = 0.6;
const TURN_RATE = 1.15;
/* The hull draws this much water; shallower than this and you're aground. */
export const DRAFT = 0.45;
/* Where you sit, in the boat's own space, and how high your feet are. */
export const SEAT = { lz: 0.45, y: SEA_LEVEL + 0.3 };
/* How close you need to be to climb in. */
export const BOARD_REACH = 3.6;

/* Points round the hull, in its own space (bow toward -z). */
const HULL: [number, number][] = [
  [0, -1.9],
  [0.6, -1.1],
  [-0.6, -1.1],
  [0.7, 0.6],
  [-0.7, 0.6],
  [0, 1.85],
];

function hullClear(terrain: Terrain, x: number, z: number, rot: number) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const [lx, lz] of HULL) {
    const px = x + lx * c + lz * s;
    const pz = z - lx * s + lz * c;
    if (terrain.heightAt(px, pz) > SEA_LEVEL - DRAFT) return false;
    for (const sol of terrain.solidsNear(px, pz)) {
      if (sol.top < SEA_LEVEL - 0.3 || sol.bottom > SEA_LEVEL + 0.8) continue;
      if (overSolid(sol, px, pz)) return false;
    }
  }
  return true;
}

/* Returns true if the boat hit something this step. */
export function stepBoat(
  b: BoatState,
  intent: { forward: number; right: number },
  dt: number,
  terrain: Terrain,
) {
  const want =
    intent.forward > 0 ? ROW_SPEED * intent.forward : intent.forward < 0 ? -BACK_SPEED : 0;
  if (want !== 0) b.speed += clamp(want - b.speed, -ROW_ACCEL * dt, ROW_ACCEL * dt);
  else b.speed -= b.speed * Math.min(1, DRAG * dt);
  /* Turning works best with some way on, but you can pivot on the oars. */
  const target =
    -intent.right * TURN_RATE * (0.45 + 0.55 * Math.min(1, Math.abs(b.speed) / ROW_SPEED));
  b.turn += (target - b.turn) * Math.min(1, dt * 4);

  const rot = wrapAngle(b.rot + b.turn * dt);
  if (hullClear(terrain, b.x, b.z, rot)) b.rot = rot;
  else b.turn = 0;

  const nx = clamp(b.x - Math.sin(b.rot) * b.speed * dt, -BOUNDARY, BOUNDARY);
  const nz = clamp(b.z - Math.cos(b.rot) * b.speed * dt, -BOUNDARY, BOUNDARY);
  if (hullClear(terrain, nx, nz, b.rot)) {
    b.x = nx;
    b.z = nz;
    return false;
  }
  b.speed = -b.speed * 0.2;
  return true;
}

/* Where the rower sits, in the world. */
export function seatOf(b: { x: number; z: number; rot: number }) {
  return {
    x: b.x + SEAT.lz * Math.sin(b.rot),
    y: SEAT.y,
    z: b.z + SEAT.lz * Math.cos(b.rot),
  };
}
