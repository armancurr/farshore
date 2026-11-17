import { BOUNDARY, SEA_LEVEL } from "./constants";
import { clamp, wrapAngle } from "./math";
import type { Ground, Solid } from "./terrain";

/** A grounded trail bike. The server drives it; clients interpolate snapshots.
 * Swept tire contacts climb low steps/rounded rocks; damped suspension absorbs
 * bumps and contact normals preserve tangential motion on glancing impacts.
 * No changes to pedestrian or boat physics. */
export type BikeState = {
  x: number;
  y: number;
  z: number;
  rot: number;
  speed: number;
  steer: number;
  pitch: number;
  roll: number;
  /** Server-only suspension and lateral tire slip; snapshots keep their existing layout. */
  verticalSpeed?: number;
  supportY?: number;
  slipX?: number;
  slipZ?: number;
};
export type BikeIntent = { forward: number; right: number; brake: boolean };
export const BIKE_SPEED = 20; // 72 km/h; sprinting is 9.8 m/s.
export const BIKE_SEAT = 0.72;
export const BIKE_WHEELBASE = 1.65;
const WHEELBASE = BIKE_WHEELBASE;
const HALF_LENGTH = 1.15;
const RADIUS = 0.43;
const MAX_SLOPE = 0.72; // About 36 degrees, in either direction.

function overlaps(s: Solid, x: number, z: number, radius: number) {
  const dx = x - s.x,
    dz = z - s.z;
  if (!s.box) return Math.hypot(dx, dz) < s.r + radius;
  const { c, s: sn, hx, hz } = s.box;
  const lx = dx * c - dz * sn,
    lz = dx * sn + dz * c;
  if (radius === 0) return Math.abs(lx) <= hx && Math.abs(lz) <= hz;
  return Math.hypot(Math.max(0, Math.abs(lx) - hx), Math.max(0, Math.abs(lz) - hz)) < radius;
}

export const BIKE_STEP_HEIGHT = 0.32;
export const BIKE_ROCK_HEIGHT = 0.8;
const TIRE_RADIUS = 0.415;
const BELLY_CLEARANCE = 0.34;
type Support = { y: number; pitch: number; roll: number };
type Contact = { nx: number; nz: number; depth: number };

/** Closest-point contact for a padded circle against a cylinder or rotated box. */
function contact(s: Solid, x: number, z: number, radius: number): Contact | null {
  const dx = x - s.x,
    dz = z - s.z;
  if (!s.box) {
    const distance = Math.hypot(dx, dz);
    if (distance >= s.r + radius) return null;
    return {
      nx: distance > 1e-7 ? dx / distance : 1,
      nz: distance > 1e-7 ? dz / distance : 0,
      depth: s.r + radius - distance,
    };
  }
  const { c, s: sn, hx, hz } = s.box;
  const lx = dx * c - dz * sn,
    lz = dx * sn + dz * c;
  const qx = lx - clamp(lx, -hx, hx),
    qz = lz - clamp(lz, -hz, hz);
  const distance = Math.hypot(qx, qz);
  if (distance >= radius) return null;
  let nx: number, nz: number, depth: number;
  if (distance > 1e-7) {
    nx = qx / distance;
    nz = qz / distance;
    depth = radius - distance;
  } else if (hx - Math.abs(lx) < hz - Math.abs(lz)) {
    nx = Math.sign(lx) || 1;
    nz = 0;
    depth = radius + hx - Math.abs(lx);
  } else {
    nx = 0;
    nz = Math.sign(lz) || 1;
    depth = radius + hz - Math.abs(lz);
  }
  return { nx: nx * c + nz * sn, nz: -nx * sn + nz * c, depth };
}

function nearby(terrain: Ground, x: number, z: number, rot: number) {
  const solids = new Set<Solid>();
  const c = Math.cos(rot),
    s = Math.sin(rot);
  for (const lz of [-1.6, -0.8, 0, 0.8, 1.6])
    for (const lx of [-0.6, 0, 0.6]) {
      for (const solid of terrain.solidsNear(x + lx * c + lz * s, z - lx * s + lz * c))
        solids.add(solid);
    }
  return [...solids];
}

function rideable(s: Solid, terrain: Ground) {
  if (!s.standable) return false; // Never climb vehicles, tree trunks or walls.
  const base = terrain.heightAt(s.x, s.z);
  const rise = s.top - base;
  return (
    s.bottom <= base + 0.12 &&
    rise > 0 &&
    rise <= (s.surface === "rounded" ? BIKE_ROCK_HEIGHT : BIKE_STEP_HEIGHT)
  );
}

function surface(s: Solid, terrain: Ground, x: number, z: number) {
  if (s.surface === "rounded" && !s.box) {
    const u = Math.min(1, Math.hypot(x - s.x, z - s.z) / s.r);
    const base = terrain.heightAt(s.x, s.z);
    // Smooth shoulders rather than the invisible vertical cylinder used by pedestrians.
    return base + (s.top - base) * (1 - u * u) ** 2;
  }
  return overlaps(s, x, z, 0) ? s.top : terrain.heightAt(x, z);
}

/** Sweep the circular tire profile over ground and small solid surfaces. The
 * circle's lower arc turns a curb into continuous wheel travel, not a teleport. */
function wheelHeight(terrain: Ground, solids: Solid[], x: number, z: number, rot: number) {
  const c = Math.cos(rot),
    s = Math.sin(rot);
  let height = terrain.heightAt(x, z);
  for (const offset of [-1, -0.8, -0.5, 0, 0.5, 0.8, 1]) {
    const along = offset * TIRE_RADIUS;
    const arc = TIRE_RADIUS - Math.sqrt(Math.max(0, TIRE_RADIUS ** 2 - along ** 2));
    for (const side of [-0.1, 0, 0.1]) {
      const px = x + along * s + side * c,
        pz = z + along * c - side * s;
      let ground = terrain.heightAt(px, pz);
      for (const solid of solids) {
        if (overlaps(solid, px, pz, 0.02))
          ground = Math.max(ground, surface(solid, terrain, px, pz));
      }
      height = Math.max(height, ground - arc);
    }
  }
  return height;
}

/** Wheel support for suspension visuals; non-standable vehicle hulls are excluded. */
export function bikeWheelContacts(terrain: Ground, x: number, z: number, rot: number) {
  const solids = nearby(terrain, x, z, rot).filter((s) => rideable(s, terrain));
  const dx = (Math.sin(rot) * WHEELBASE) / 2,
    dz = (Math.cos(rot) * WHEELBASE) / 2;
  return {
    front: wheelHeight(terrain, solids, x - dx, z - dz, rot),
    rear: wheelHeight(terrain, solids, x + dx, z + dz, rot),
  };
}

function probe(
  terrain: Ground,
  x: number,
  z: number,
  rot: number,
): { ground: Support | null; hit: Contact | null } {
  const invalid = { ground: null, hit: null };
  if (Math.abs(x) > BOUNDARY - 1.5 || Math.abs(z) > BOUNDARY - 1.5) return invalid;
  const c = Math.cos(rot),
    s = Math.sin(rot),
    center = terrain.heightAt(x, z);
  if (center < SEA_LEVEL + 0.3) return invalid;
  const solids = nearby(terrain, x, z, rot);
  const supports = solids.filter((solid) => rideable(solid, terrain));
  const front = wheelHeight(
    terrain,
    supports,
    x - (s * WHEELBASE) / 2,
    z - (c * WHEELBASE) / 2,
    rot,
  );
  const rear = wheelHeight(
    terrain,
    supports,
    x + (s * WHEELBASE) / 2,
    z + (c * WHEELBASE) / 2,
    rot,
  );
  const left = terrain.heightAt(x - c * RADIUS, z + s * RADIUS);
  const right = terrain.heightAt(x + c * RADIUS, z - s * RADIUS);
  const pitch = Math.atan2(front - rear, WHEELBASE),
    roll = Math.atan2(right - left, RADIUS * 2);
  if (Math.abs(pitch) > MAX_SLOPE || Math.abs(roll) > MAX_SLOPE) return invalid;
  let y = Math.max(center, (front + rear) / 2);
  // The skid plate can skim a low rounded crest between the wheels. Without
  // this third support a short boulder traps the frame after the front passes.
  for (const lz of [-0.5, 0, 0.5]) {
    const px = x + s * lz,
      pz = z + c * lz;
    for (const solid of supports) {
      if (overlaps(solid, px, pz, 0))
        y = Math.max(y, surface(solid, terrain, px, pz) - BELLY_CLEARANCE + lz * Math.tan(pitch));
    }
  }
  let hit: Contact | null = null;
  for (const lz of [-HALF_LENGTH, -HALF_LENGTH / 2, 0, HALF_LENGTH / 2, HALF_LENGTH]) {
    const px = x + s * lz,
      pz = z + c * lz,
      h = terrain.heightAt(px, pz);
    if (h < SEA_LEVEL + 0.3 || Math.abs(h - center) > 1) return invalid;
    const chassis = y - lz * Math.tan(pitch);
    // Ground in between the two wheels must also clear the engine/skid plate.
    if (h > chassis + BELLY_CLEARANCE) return invalid;
    for (const solid of solids) {
      if (solid.top <= chassis + 0.12 || solid.bottom >= chassis + 2.1) continue;
      const touching = contact(solid, px, pz, RADIUS);
      if (!touching) continue;
      if (
        supports.includes(solid) &&
        surface(solid, terrain, px, pz) <= chassis + BELLY_CLEARANCE + 1e-6
      )
        continue;
      if (!hit || touching.depth > hit.depth) hit = touching;
    }
  }
  return { ground: hit ? null : { y, pitch, roll }, hit };
}

/** Shared placement/spawn query; riding uses the same wheel and body contacts. */
export function bikeGround(terrain: Ground, x: number, z: number, rot: number) {
  return probe(terrain, x, z, rot).ground;
}

function suspend(b: BikeState, ground: Support, dt: number) {
  const supportVelocity = clamp((ground.y - (b.supportY ?? ground.y)) / dt, -5, 5);
  b.supportY = ground.y;
  const spring = (ground.y - b.y) * 120 - ((b.verticalSpeed ?? 0) - supportVelocity) * 22;
  b.verticalSpeed = clamp((b.verticalSpeed ?? 0) + spring * dt, -5, 5);
  b.y += b.verticalSpeed * dt;
  // Bump stops bound compression/extension; this is a supported trail model, not flight.
  const bounded = clamp(b.y, ground.y - 0.12, ground.y + 0.18);
  if (bounded !== b.y)
    b.verticalSpeed = b.y < bounded ? Math.max(0, b.verticalSpeed) : Math.min(0, b.verticalSpeed);
  b.y = bounded;
  b.pitch += (ground.pitch - b.pitch) * (1 - Math.exp(-dt * 16));
}

export function createBike(x: number, y: number, z: number, rot: number): BikeState {
  return {
    x,
    y,
    z,
    rot,
    speed: 0,
    steer: 0,
    pitch: 0,
    roll: 0,
    supportY: y,
    verticalSpeed: 0,
    slipX: 0,
    slipZ: 0,
  };
}

export function bikeSolid(b: Pick<BikeState, "x" | "y" | "z" | "rot">): Solid {
  return {
    x: b.x,
    z: b.z,
    r: 1.25,
    bottom: b.y + 0.15,
    top: b.y + 1.35,
    standable: false,
    box: { hx: 0.43, hz: 1.15, c: Math.cos(b.rot), s: Math.sin(b.rot) },
  };
}

export function stepBike(b: BikeState, input: BikeIntent, dt: number, terrain: Ground) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const forward = clamp(input.forward, -1, 1),
    right = clamp(input.right, -1, 1);
  let remaining = Math.min(dt, 0.25);
  while (remaining > 1e-7) {
    const h = Math.min(remaining, 1 / 120);
    remaining -= h;
    // Pressing S at speed brakes first, then reverses at walking pace.
    const target = input.brake ? 0 : forward >= 0 ? forward * BIKE_SPEED : forward * 3;
    const braking = input.brake || b.speed * forward < 0;
    const accel = braking ? 16 : forward === 0 ? 3.5 : 7;
    const slope = Math.sin(b.pitch) * 5;
    const want = input.brake || forward === 0 ? target : clamp(target - slope, -3, BIKE_SPEED);
    b.speed += clamp(want - b.speed, -accel * h, accel * h);
    const steering = -right * (0.52 / (1 + Math.abs(b.speed) / 12));
    b.steer += (steering - b.steer) * (1 - Math.exp(-h * 9));
    const yawRate = (b.speed / WHEELBASE) * Math.tan(b.steer);
    const rot = wrapAngle(b.rot + yawRate * h);
    const grip = Math.exp(-h * (input.brake ? 12 : 2.5));
    b.slipX = (b.slipX ?? 0) * grip;
    b.slipZ = (b.slipZ ?? 0) * grip;
    let vx = -Math.sin(rot) * b.speed + b.slipX;
    let vz = -Math.cos(rot) * b.speed + b.slipZ;
    const magnitude = Math.hypot(vx, vz);
    if (magnitude > BIKE_SPEED) {
      vx *= BIKE_SPEED / magnitude;
      vz *= BIKE_SPEED / magnitude;
    }
    let x = b.x + vx * h,
      z = b.z + vz * h;
    let result = probe(terrain, x, z, rot);
    let heading = rot;
    if (result.hit) {
      const { nx, nz } = result.hit;
      const incoming = Math.min(0, vx * nx + vz * nz);
      // Remove the impact-normal velocity, retaining the tangent with contact friction.
      // Very low restitution prevents repeated pinball rebounds from rocks/walls.
      const friction = Math.exp(-h * 1.5);
      vx = (vx - incoming * 1.04 * nx) * friction;
      vz = (vz - incoming * 1.04 * nz) * friction;
      heading = b.rot; // Don't rotate the chassis further into an obstacle.
      x = b.x + vx * h;
      z = b.z + vz * h;
      b.speed = vx * -Math.sin(heading) + vz * -Math.cos(heading);
      b.slipX = vx + Math.sin(heading) * b.speed;
      b.slipZ = vz + Math.cos(heading) * b.speed;
      result = probe(terrain, x, z, heading);
    }
    const ground = result.ground;
    const travel = Math.hypot(vx, vz) * h;
    const previousSupport = b.supportY ?? b.y;
    if (!ground || Math.abs(ground.y - previousSupport) > 0.12 + travel * Math.tan(MAX_SLOPE)) {
      // Terrain safety boundaries have no collision normal to slide along.
      b.speed *= 0.15;
      b.slipX = 0;
      b.slipZ = 0;
      b.steer *= 0.8;
      const rest = probe(terrain, b.x, b.z, b.rot).ground;
      if (rest) suspend(b, rest, h);
      continue;
    }
    // Rising contact consumes energy instead of maintaining road speed over every bump.
    const rise = Math.max(0, ground.y - previousSupport);
    if (rise > 0) {
      const loss = Math.min(
        Math.abs(b.speed) * 0.4,
        (9.81 * rise) / Math.max(2, Math.abs(b.speed)),
      );
      b.speed -= Math.sign(b.speed) * loss;
    }
    b.x = x;
    b.z = z;
    b.rot = heading;
    suspend(b, ground, h);
    const lean = clamp((-yawRate * b.speed) / 35, -0.3, 0.3);
    b.roll += (clamp(ground.roll * 0.35 + lean, -0.42, 0.42) - b.roll) * (1 - Math.exp(-h * 9));
  }
}

/** Dismount only onto clear dry ground, within a small step of the seat. */
export function bikeExit(b: BikeState, terrain: Ground) {
  for (const [lx, lz] of [
    [1.15, 0],
    [-1.15, 0],
    [1.2, 1.3],
    [-1.2, 1.3],
  ]) {
    const x = b.x + lx * Math.cos(b.rot) + lz * Math.sin(b.rot);
    const z = b.z - lx * Math.sin(b.rot) + lz * Math.cos(b.rot);
    const y = terrain.heightAt(x, z);
    if (Math.abs(x) > BOUNDARY || Math.abs(z) > BOUNDARY || y < 0.3 || Math.abs(y - b.y) > 0.8)
      continue;
    if (terrain.normalAt(x, z)[1] < 0.75) continue;
    if (
      terrain
        .solidsNear(x, z)
        .some((s) => s.top > y + 0.1 && s.bottom < y + 1.8 && overlaps(s, x, z, 0.5))
    )
      continue;
    return { x, y, z, yaw: b.rot };
  }
  return null;
}
