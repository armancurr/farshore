import { BOUNDARY, SEA_LEVEL, STEEP_NY } from "./constants";
import { contact } from "./car";
import type { DriveIntent, VehicleState } from "./drive";
import { clamp, wrapAngle } from "./math";
import type { Ground } from "./terrain";

/*
 * A horse or a donkey under you. It walks on with W, gallops with Shift,
 * reins in with S and turns on the spot if it has to. It climbs what you
 * could on foot, only quicker, steps up what you could step up, wades into
 * the shallows but won't swim, and jumps with Space.
 *
 * `aux` is 1 while it's in the air.
 */

export type MountSpec = {
  /* Metres a second at a walk (the slowest it'll amble), a trot (W) and a gallop (Shift). */
  walk: number;
  trot: number;
  gallop: number;
  back: number;
  /* Radians a second, standing; less at a gallop. */
  turn: number;
  /* Take-off speed of a jump, m/s up (0: it doesn't jump). */
  jump: number;
  /* Nose to tail, the body's half width, and its height. */
  length: number;
  radius: number;
  height: number;
};

const GRAVITY = 24;
/* The highest step it takes without a jump. */
const STEP_UP = 0.7;
/* It won't go deeper than this. */
const WADE = 0.9;

/* The ground under a point, counting floors and bridges as a person would. */
function footing(terrain: Ground, x: number, z: number, from: number) {
  return terrain.groundAt(x, z, from + STEP_UP).ground;
}

/* Can it stand here at all? */
export function mountGround(terrain: Ground, spec: MountSpec, x: number, z: number, rot: number) {
  if (Math.abs(x) > BOUNDARY - 3 || Math.abs(z) > BOUNDARY - 3) return null;
  const h = terrain.heightAt(x, z);
  if (h < SEA_LEVEL - 0.3 || terrain.normalAt(x, z)[1] < 0.8) return null;
  const y = terrain.groundAt(x, z, h + 0.5).ground;
  if (blocked(terrain, spec, x, z, rot, y)) return null;
  return { y };
}

function blocked(terrain: Ground, spec: MountSpec, x: number, z: number, rot: number, y: number) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const lz of [-spec.length * 0.35, 0, spec.length * 0.35]) {
    const px = x + lz * s;
    const pz = z + lz * c;
    for (const solid of terrain.solidsNear(px, pz)) {
      if (solid.top <= y + STEP_UP || solid.bottom >= y + spec.height) continue;
      const hit = contact(solid, px, pz, spec.radius);
      if (hit) return hit;
    }
  }
  return null;
}

export function stepMount(
  b: VehicleState,
  input: DriveIntent,
  dt: number,
  terrain: Ground,
  spec: MountSpec,
) {
  let remaining = Math.min(dt, 0.25);
  let bumped = false;
  while (remaining > 1e-7) {
    const h = Math.min(remaining, 1 / 60);
    remaining -= h;
    if (stepOnce(b, input, h, terrain, spec)) bumped = true;
  }
  return bumped;
}

function stepOnce(
  b: VehicleState,
  input: DriveIntent,
  dt: number,
  terrain: Ground,
  spec: MountSpec,
) {
  const forward = clamp(input.forward, -1, 1);
  const airborne = b.aux > 0;
  const want =
    forward > 0
      ? (input.boost ? spec.gallop : spec.trot) * forward
      : forward < 0
        ? -spec.back * -forward
        : 0;
  /* No pushing off the ground in mid-air. */
  if (!airborne) {
    const accel = Math.abs(want) > Math.abs(b.speed) ? (input.boost ? 5 : 3.5) : 7;
    b.speed += clamp(want - b.speed, -accel * dt, accel * dt);
  }
  /* It turns on its hocks standing, in a long arc at a gallop. */
  const pace = Math.min(1, Math.abs(b.speed) / spec.gallop);
  const turn = -clamp(input.right, -1, 1) * spec.turn * (1 - 0.55 * pace) * (airborne ? 0.3 : 1);
  b.turn += (turn - b.turn) * Math.min(1, dt * 6);
  b.steer = clamp(input.right, -1, 1);
  b.rot = wrapAngle(b.rot + b.turn * dt);

  if (input.jump && !airborne && spec.jump > 0) {
    b.vy = spec.jump;
    b.aux = 1;
  }

  let x = clamp(b.x - Math.sin(b.rot) * b.speed * dt, -BOUNDARY + 3, BOUNDARY - 3);
  let z = clamp(b.z - Math.cos(b.rot) * b.speed * dt, -BOUNDARY + 3, BOUNDARY - 3);
  let bumped = false;

  /* Trees, rocks and walls: slide along them, losing the speed into them. */
  const hit = blocked(terrain, spec, x, z, b.rot, b.y);
  if (hit) {
    bumped = true;
    x += hit.nx * hit.depth;
    z += hit.nz * hit.depth;
    const vx = -Math.sin(b.rot) * b.speed;
    const vz = -Math.cos(b.rot) * b.speed;
    const into = Math.min(0, vx * hit.nx + vz * hit.nz);
    const keep = Math.hypot(vx - into * hit.nx, vz - into * hit.nz);
    b.speed = Math.sign(b.speed) * Math.min(Math.abs(b.speed), keep * 0.9);
    if (blocked(terrain, spec, x, z, b.rot, b.y)) {
      x = b.x;
      z = b.z;
      b.speed *= 0.3;
    }
  }

  const ground = footing(terrain, x, z, b.y);
  const sea = terrain.heightAt(x, z);
  const rise = ground - b.y;
  /* Too high a step, too steep a bank (going up it), or too deep to wade. */
  const steep = rise > 0.05 && terrain.normalAt(x, z)[1] < STEEP_NY;
  if ((!b.aux && rise > STEP_UP) || (b.aux && rise > 0.3) || steep || sea < SEA_LEVEL - WADE) {
    bumped = true;
    x = b.x;
    z = b.z;
    b.speed *= airborne ? 0.6 : 0.2;
  }
  b.x = x;
  b.z = z;

  const under = footing(terrain, b.x, b.z, b.y);
  if (b.aux > 0 || under < b.y - 0.6) {
    /* In the air: off a ledge, or over a fence. */
    b.aux = 1;
    b.vy -= GRAVITY * dt;
    b.y += b.vy * dt;
    if (b.y <= under) {
      b.y = under;
      b.vy = 0;
      b.aux = 0;
    }
  } else {
    /* Down a slope or up a step, it keeps its feet. */
    b.y = under;
    b.vy = 0;
  }

  /* Nose up a hill, nose down a slope. */
  const ahead = terrain.heightAt(b.x - Math.sin(b.rot) * 0.8, b.z - Math.cos(b.rot) * 0.8);
  const behind = terrain.heightAt(b.x + Math.sin(b.rot) * 0.8, b.z + Math.cos(b.rot) * 0.8);
  const pitch = b.aux
    ? clamp(b.vy * 0.04, -0.25, 0.25)
    : clamp(Math.atan2(ahead - behind, 1.6), -0.4, 0.4);
  b.pitch += (pitch - b.pitch) * Math.min(1, dt * 6);
  /* Leaning into a turn at speed. */
  b.roll += (clamp(-b.turn * b.speed * 0.02, -0.15, 0.15) - b.roll) * Math.min(1, dt * 5);
  return bumped;
}

/* Swing down onto clear ground beside it. */
export function mountExit(b: VehicleState, terrain: Ground, spec: MountSpec, side: number) {
  for (const [lx, lz] of [
    [1.1 * side, 0],
    [-1.1 * side, 0],
    [1.1 * side, 0.8],
    [-1.1 * side, 0.8],
    [0, spec.length * 0.7 + 0.6],
  ]) {
    const x = b.x + lx * Math.cos(b.rot) + lz * Math.sin(b.rot);
    const z = b.z - lx * Math.sin(b.rot) + lz * Math.cos(b.rot);
    const y = terrain.groundAt(x, z, b.y + 1).ground;
    if (Math.abs(y - b.y) > 1.2 || terrain.heightAt(x, z) < SEA_LEVEL - 1.2) continue;
    const clear = !terrain
      .solidsNear(x, z)
      .some((s) => s.top > y + 0.1 && s.bottom < y + 1.8 && contact(s, x, z, 0.42) !== null);
    if (clear) return { x, y, z, yaw: b.rot };
  }
  return null;
}
