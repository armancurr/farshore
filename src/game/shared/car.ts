import { BOUNDARY, SEA_LEVEL } from "./constants";
import type { DriveIntent, VehicleState } from "./drive";
import { clamp, wrapAngle } from "./math";
import type { Ground, Solid } from "./terrain";

/*
 * Four wheels over the hills. The swept tyre contacts climb low steps and
 * rounded rocks; damped suspension absorbs bumps; contact normals keep the
 * tangential motion on a glancing impact, so a wall turns you along it rather
 * than stopping you dead. Steep hills are a fight: past MAX_TILT the climb
 * eats more and more of the engine, until somewhere short of WALL the car
 * rolls back down. Only a face steeper than WALL, or a step higher than the
 * tyres, stops it outright (sliding along it where it slants).
 *
 * Going down there's no limit: over a steep drop or a cliff edge the car
 * leaves the ground, falls, and lands on its wheels. However the ground lies,
 * the body never tilts past MAX_TILT, so it can't roll over: you can always
 * drive on.
 *
 * Into the sea it goes too, but deeper than WADE it's swamped: the engine
 * dies, the water stops it, and it settles on the bottom. The room drowns
 * whoever stays in it.
 *
 * Steering is kinematic: the yaw follows the front wheels' lock over the
 * wheelbase, with a little lateral slip that the tyres scrub away.
 */

export type CarSpec = {
  /* Top speed, reverse, and how hard it accelerates and brakes (m/s, m/s²). */
  speed: number;
  reverse: number;
  accel: number;
  brake: number;
  /* The axles along the car's own z (front is negative: ahead), and the track between the wheels. */
  front: number;
  back: number;
  track: number;
  tire: number;
  /* The body, for collisions: half its length and width, and its height. */
  halfLength: number;
  halfWidth: number;
  height: number;
  /* What may pass under the middle without touching. */
  clearance: number;
  /* Most steering lock, at walking pace. */
  steer: number;
};

/* Low steps a tyre rolls up, and the rounded shoulders of rocks it rides over. */
export const STEP_RISE = 0.34;
export const ROCK_RISE = 0.8;
/* Sideways, m/s²: how hard the tyres can pull it round a bend. */
const GRIP = 14;
/* About 37 degrees, either way: the most the body tilts, and where hills start to fight back. */
const MAX_TILT = 0.65;
/* About 70 degrees: a face of rock, more wall than hill. Nothing on wheels goes up that. */
const WALL = 1.22;
const WALL_NY = Math.cos(WALL);
/* Water over the wheels deeper than this swamps a car (its floor, near enough). */
export const WADE = 0.6;
/* Sinking through water, m/s. */
const SINK = 1.4;
/* Falling, m/s²; and the fastest fall (under what the room believes of a report). */
const GRAVITY = 9.81;
const MAX_FALL = 28;
/* Clear of the ground by more than this, the wheels have nothing to push on. */
const AIRBORNE = 0.2;

/* `steep`: a wall the wheels can't climb (fine to go down, or across). */
type Support = { y: number; pitch: number; roll: number; steep: boolean };
type Contact = { nx: number; nz: number; depth: number };

function overlaps(s: Solid, x: number, z: number, radius: number) {
  const dx = x - s.x;
  const dz = z - s.z;
  if (!s.box) return Math.hypot(dx, dz) < s.r + radius;
  const { c, s: sn, hx, hz } = s.box;
  const lx = dx * c - dz * sn;
  const lz = dx * sn + dz * c;
  if (radius === 0) return Math.abs(lx) <= hx && Math.abs(lz) <= hz;
  return Math.hypot(Math.max(0, Math.abs(lx) - hx), Math.max(0, Math.abs(lz) - hz)) < radius;
}

/* Closest-point contact for a padded circle against a cylinder or rotated box. */
export function contact(s: Solid, x: number, z: number, radius: number): Contact | null {
  const dx = x - s.x;
  const dz = z - s.z;
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
  const lx = dx * c - dz * sn;
  const lz = dx * sn + dz * c;
  const qx = lx - clamp(lx, -hx, hx);
  const qz = lz - clamp(lz, -hz, hz);
  const distance = Math.hypot(qx, qz);
  if (distance >= radius) return null;
  let nx: number;
  let nz: number;
  let depth: number;
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

/* Points over the body, for the solids worth asking about. */
function nearby(terrain: Ground, spec: CarSpec, x: number, z: number, rot: number) {
  const solids = new Set<Solid>();
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const l = spec.halfLength;
  const w = spec.halfWidth;
  for (const lz of [-l, -l / 2, 0, l / 2, l])
    for (const lx of [-w, 0, w]) {
      for (const solid of terrain.solidsNear(x + lx * c + lz * s, z - lx * s + lz * c))
        solids.add(solid);
    }
  return [...solids];
}

/* Low stones and kerbs a tyre can climb, and a pier's deck. Never vehicles, tree trunks or walls. */
function rideable(s: Solid, terrain: Ground) {
  if (!s.standable) return false;
  if (s.deck) return true;
  const base = terrain.heightAt(s.x, s.z);
  const rise = s.top - base;
  return (
    s.bottom <= base + 0.12 && rise > 0 && rise <= (s.surface === "rounded" ? ROCK_RISE : STEP_RISE)
  );
}

function surface(s: Solid, terrain: Ground, x: number, z: number) {
  if (s.surface === "rounded" && !s.box) {
    const u = Math.min(1, Math.hypot(x - s.x, z - s.z) / s.r);
    const base = terrain.heightAt(s.x, s.z);
    /* Smooth shoulders rather than the vertical cylinder a person bumps into. */
    return base + (s.top - base) * (1 - u * u) ** 2;
  }
  return overlaps(s, x, z, 0) ? s.top : terrain.heightAt(x, z);
}

/*
 * Sweep a tyre's profile over the ground and small solids: the lower arc of
 * the circle turns a kerb into continuous wheel travel, not a teleport.
 */
function wheelHeight(
  terrain: Ground,
  solids: Solid[],
  tire: number,
  x: number,
  z: number,
  rot: number,
) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  let height = terrain.heightAt(x, z);
  for (const offset of [-1, -0.8, -0.5, 0, 0.5, 0.8, 1]) {
    const along = offset * tire;
    const arc = tire - Math.sqrt(Math.max(0, tire ** 2 - along ** 2));
    for (const side of [-0.1, 0, 0.1]) {
      const px = x + along * s + side * c;
      const pz = z + along * c - side * s;
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

/* Where each wheel touches: front left, front right, back left, back right. */
export function wheelContacts(terrain: Ground, spec: CarSpec, x: number, z: number, rot: number) {
  const solids = nearby(terrain, spec, x, z, rot).filter((s) => rideable(s, terrain));
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const half = spec.track / 2;
  const at = (lx: number, lz: number) =>
    wheelHeight(terrain, solids, spec.tire, x + lx * c + lz * s, z - lx * s + lz * c, rot);
  return [
    at(-half, spec.front),
    at(half, spec.front),
    at(-half, spec.back),
    at(half, spec.back),
  ] as const;
}

/*
 * Where the car would rest at (x, z) facing `rot`, or what it would hit there.
 * `strict` (putting one down) wants ground it could have driven onto; driving,
 * any ground will do and the body's tilt is held within MAX_TILT. `body` is
 * where the car actually is: up in the air, over a drop, it's that body that
 * meets things, not one resting on the ground far below it.
 */
function probe(
  terrain: Ground,
  spec: CarSpec,
  x: number,
  z: number,
  rot: number,
  strict = false,
  body?: Pick<VehicleState, "y" | "pitch">,
): { ground: Support | null; hit: Contact | null } {
  const invalid = { ground: null, hit: null };
  const l = spec.halfLength;
  const w = spec.halfWidth;
  if (Math.abs(x) > BOUNDARY - l - 1 || Math.abs(z) > BOUNDARY - l - 1) return invalid;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const center = terrain.heightAt(x, z);
  /* Put down only on dry land; driven, into the sea it goes (and is swamped). */
  if (strict && center < SEA_LEVEL + 0.1) return invalid;
  /* A wall of rock: no tyre climbs that. Too steep even to stand a car on, for putting one down. */
  const ny = terrain.normalAt(x, z)[1];
  if (strict && ny < STRICT_NY) return invalid;
  let steep = ny < WALL_NY;
  const solids = nearby(terrain, spec, x, z, rot);
  const supports = solids.filter((solid) => rideable(solid, terrain));
  const half = spec.track / 2;
  const at = (lx: number, lz: number) =>
    wheelHeight(terrain, supports, spec.tire, x + lx * c + lz * s, z - lx * s + lz * c, rot);
  const fl = at(-half, spec.front);
  const fr = at(half, spec.front);
  const bl = at(-half, spec.back);
  const br = at(half, spec.back);
  const base = spec.back - spec.front;
  const tiltPitch = Math.atan2((fl + fr) / 2 - (bl + br) / 2, base);
  const tiltRoll = Math.atan2((fr + br) / 2 - (fl + bl) / 2, spec.track);
  const tilted = Math.abs(tiltPitch) > MAX_TILT || Math.abs(tiltRoll) > MAX_TILT;
  if (tilted && strict) return invalid;
  steep ||= Math.abs(tiltPitch) > WALL || Math.abs(tiltRoll) > WALL;
  /* Never more than MAX_TILT: whatever the ground does, the car stays the right way up. */
  const pitch = clamp(tiltPitch, -MAX_TILT, MAX_TILT);
  const roll = clamp(tiltRoll, -MAX_TILT, MAX_TILT);
  /* The body's height at its middle, from the plane through the four wheels. */
  const mid = (spec.front + spec.back) / 2;
  let y = Math.max(center, (fl + fr + bl + br) / 4 + mid * Math.tan(pitch));
  if (tilted) {
    /* Held flatter than the ground: it rests on whichever wheels are highest. */
    const tp = Math.tan(pitch);
    const tr = Math.tan(roll);
    y = Math.max(
      y,
      fl + (spec.front - mid) * tp + half * tr,
      fr + (spec.front - mid) * tp - half * tr,
      bl + (spec.back - mid) * tp + half * tr,
      br + (spec.back - mid) * tp - half * tr,
    );
  }
  /* The floor can skim a low rounded crest between the wheels. */
  for (const lz of [spec.front / 2, 0, spec.back / 2]) {
    const px = x + s * lz;
    const pz = z + c * lz;
    for (const solid of supports) {
      if (overlaps(solid, px, pz, 0))
        y = Math.max(y, surface(solid, terrain, px, pz) - spec.clearance - lz * Math.tan(pitch));
    }
  }
  let hit: Contact | null = null;
  /* Clear of the ground beneath: what it can hit is what's up there with it. */
  const flying = !!body && body.y > y + AIRBORNE;
  /* The body as rows of circles down its length: a middle row, so a tree dead ahead is hit square. */
  const r = Math.min(w, 0.7);
  const rows = w > r ? [-(w - r), 0, w - r] : [0];
  for (const lz of [-(l - r), -(l - r) / 2, 0, (l - r) / 2, l - r]) {
    const chassis = y - lz * Math.tan(pitch);
    for (const lx of rows) {
      const px = x + lx * c + s * lz;
      const pz = z - lx * s + c * lz;
      const h = terrain.heightAt(px, pz);
      if (strict && (h < SEA_LEVEL || Math.abs(h - center) > 1.6)) return invalid;
      /* Ground under the body must clear its floor (driving, the body rides up over it). */
      if (h > chassis + spec.clearance) {
        if (strict) return invalid;
        y += h - chassis - spec.clearance;
      }
      const hull = flying && body ? body.y - lz * Math.tan(body.pitch) : chassis;
      for (const solid of solids) {
        if (solid.top <= hull + 0.12 || solid.bottom >= hull + spec.height) continue;
        const touching = contact(solid, px, pz, r);
        if (!touching) continue;
        if (
          supports.includes(solid) &&
          surface(solid, terrain, px, pz) <= hull + spec.clearance + 1e-6
        )
          continue;
        if (!hit || touching.depth > hit.depth) hit = touching;
      }
    }
  }
  return { ground: hit ? null : { y, pitch, roll, steep }, hit };
}

/* Ground a car can be put down on: what a tyre always held (about 48 degrees). */
const STRICT_NY = 0.66;

/* Water over the wheels: the engine's drowned and it's going nowhere. */
export function swamped(v: Pick<VehicleState, "y">) {
  return v.y < SEA_LEVEL - WADE;
}

/*
 * How steep the ground is along the way the car faces: positive uphill. The
 * terrain's own slope, not the body's, which never tilts past MAX_TILT.
 */
function grade(terrain: Ground, x: number, z: number, rot: number) {
  const [nx, ny, nz] = terrain.normalAt(x, z);
  return Math.atan2(nx * Math.sin(rot) + nz * Math.cos(rot), Math.max(1e-3, ny));
}

/* Can a car stand here? The room asks before it puts one down. */
export function carGround(terrain: Ground, spec: CarSpec, x: number, z: number, rot: number) {
  return probe(terrain, spec, x, z, rot, true).ground;
}

/*
 * Off the ground: it falls, keeps its way on, and the nose follows where it's
 * headed, within MAX_TILT. Back on its wheels once it reaches `ground`.
 */
function fall(b: VehicleState, ground: Support, dt: number) {
  /* Water slows a fall to a sink. */
  const most = b.y < SEA_LEVEL ? SINK : MAX_FALL;
  b.vy = Math.max(-most, b.vy - GRAVITY * dt);
  b.y += b.vy * dt;
  b.supportY = ground.y;
  const nose = clamp(Math.atan2(b.vy, Math.max(4, Math.abs(b.speed))) * 0.6, -MAX_TILT, MAX_TILT);
  b.pitch += (nose - b.pitch) * (1 - Math.exp(-dt * 3));
  b.roll += (0 - b.roll) * (1 - Math.exp(-dt * 3));
  if (b.y > ground.y) return 0;
  /* Landed: the springs take what they can, a hard landing costs some speed. */
  const impact = -b.vy;
  b.y = ground.y;
  b.vy = 0;
  if (impact > 6) b.speed *= 0.8;
  return impact;
}

/* The way down the slope at (x, z), as a contact normal to slide along, or null on the flat. */
function downhill(terrain: Ground, x: number, z: number): Contact | null {
  const [nx, , nz] = terrain.normalAt(x, z);
  const flat = Math.hypot(nx, nz);
  if (flat < 0.05) return null;
  return { nx: nx / flat, nz: nz / flat, depth: 0 };
}

function suspend(b: VehicleState, ground: Support, dt: number) {
  const supportVelocity = clamp((ground.y - b.supportY) / dt, -5, 5);
  b.supportY = ground.y;
  const spring = (ground.y - b.y) * 120 - (b.vy - supportVelocity) * 22;
  b.vy = clamp(b.vy + spring * dt, -5, 5);
  b.y += b.vy * dt;
  /* Bump stops bound compression and extension: a sprung car, not a flying one. */
  const bounded = clamp(b.y, ground.y - 0.12, ground.y + 0.18);
  if (bounded !== b.y) b.vy = b.y < bounded ? Math.max(0, b.vy) : Math.min(0, b.vy);
  b.y = bounded;
  b.pitch += (ground.pitch - b.pitch) * (1 - Math.exp(-dt * 16));
  b.roll += (ground.roll - b.roll) * (1 - Math.exp(-dt * 12));
}

/* Put a car down where `carGround` found room for it. */
export function settleCar(b: VehicleState, terrain: Ground, spec: CarSpec) {
  const ground = carGround(terrain, spec, b.x, b.z, b.rot);
  if (!ground) return false;
  b.y = b.supportY = ground.y;
  b.pitch = ground.pitch;
  b.roll = ground.roll;
  b.vy = 0;
  return true;
}

export function stepCar(
  b: VehicleState,
  input: DriveIntent,
  dt: number,
  terrain: Ground,
  spec: CarSpec,
) {
  if (!Number.isFinite(dt) || dt <= 0) return false;
  const forward = clamp(input.forward, -1, 1);
  const right = clamp(input.right, -1, 1);
  const wheelbase = spec.back - spec.front;
  let bumped = false;
  let remaining = Math.min(dt, 0.25);
  while (remaining > 1e-7) {
    const h = Math.min(remaining, 1 / 120);
    remaining -= h;
    /* In the air, or swamped, the wheels have nothing to push on, steer by or brake against. */
    const flying = b.y > b.supportY + AIRBORNE;
    const drowned = swamped(b);
    const helpless = flying || drowned;
    /* S at speed brakes first, then reverses at a crawl. */
    const target = input.brake ? 0 : forward >= 0 ? forward * spec.speed : forward * spec.reverse;
    const braking = input.brake || b.speed * forward < 0;
    const accel = braking ? spec.brake : forward === 0 ? 3 : spec.accel;
    /*
     * Hills: gravity along the slope, eased by the engine. Past MAX_TILT it
     * eats more and more of it, until the car can't hold and rolls back.
     */
    const rake = grade(terrain, b.x, b.z, b.rot);
    const steepness = Math.abs(rake) > MAX_TILT ? rake : b.pitch;
    const slope =
      Math.sin(steepness) * 9.81 * (0.55 + 5.8 * Math.max(0, Math.abs(steepness) - MAX_TILT));
    const want =
      input.brake || forward === 0 ? target : clamp(target - slope, -spec.reverse, spec.speed);
    if (!helpless) b.speed += clamp(want - b.speed, -accel * h, accel * h);
    /* Wading slows it; swamped, the water brings it to a stop. */
    if (b.y < SEA_LEVEL) b.speed *= Math.exp(-h * (drowned ? 2.5 : 0.8));
    b.aux = forward;
    /*
     * Full lock at walking pace; at speed, only as much as the tyres can
     * hold through the turn, so a flick of the keys doesn't spin you.
     */
    const lock = Math.min(spec.steer, Math.atan((wheelbase * GRIP) / Math.max(1, b.speed ** 2)));
    const steering = -right * lock;
    b.steer += (steering - b.steer) * (1 - Math.exp(-h * 8));
    const yawRate = helpless ? 0 : (b.speed / wheelbase) * Math.tan(b.steer);
    b.turn = yawRate;
    const rot = wrapAngle(b.rot + yawRate * h);
    /* A handbrake lets the back step out; the tyres scrub the slide away. */
    const grip = Math.exp(-h * (input.brake ? 1.2 : 4));
    b.slipX *= grip;
    b.slipZ *= grip;
    if (input.brake && Math.abs(b.speed) > 4) {
      b.slipX += Math.cos(rot) * yawRate * Math.abs(b.speed) * 0.25 * h;
      b.slipZ -= Math.sin(rot) * yawRate * Math.abs(b.speed) * 0.25 * h;
    }
    let vx = -Math.sin(rot) * b.speed + b.slipX;
    let vz = -Math.cos(rot) * b.speed + b.slipZ;
    const magnitude = Math.hypot(vx, vz);
    if (magnitude > spec.speed) {
      vx *= spec.speed / magnitude;
      vz *= spec.speed / magnitude;
    }
    let x = b.x + vx * h;
    let z = b.z + vz * h;
    let result = probe(terrain, spec, x, z, rot, false, b);
    let heading = rot;
    if (result.hit) {
      bumped = true;
      const { nx, nz } = result.hit;
      const incoming = Math.min(0, vx * nx + vz * nz);
      /*
       * Take away the velocity into the obstacle and keep the rest, less a
       * little contact friction. Hardly any bounce, so rocks and walls don't
       * play pinball with you.
       */
      const friction = Math.exp(-h * 1.5);
      vx = (vx - incoming * 1.04 * nx) * friction;
      vz = (vz - incoming * 1.04 * nz) * friction;
      /* Don't turn the body further into it. */
      heading = b.rot;
      x = b.x + vx * h;
      z = b.z + vz * h;
      b.speed = vx * -Math.sin(heading) + vz * -Math.cos(heading);
      b.slipX = vx + Math.sin(heading) * b.speed;
      b.slipZ = vz + Math.cos(heading) * b.speed;
      result = probe(terrain, spec, x, z, heading, false, b);
    }
    let ground = result.ground;
    /*
     * Up into ground the wheels can't climb (a cliff face, ahead or met in
     * mid-air): slide along it where it slants, as off a wall.
     */
    const wall = (g: Support | null, tx: number, tz: number) => {
      if (!g) return false;
      const travel = Math.hypot(tx - b.x, tz - b.z);
      if (b.y > b.supportY + AIRBORNE) return g.y > b.y + STEP_RISE;
      const rise = g.y - b.supportY;
      return rise > 0.12 + travel * Math.tan(WALL) || (rise > 0.01 && g.steep);
    };
    if (wall(ground, x, z)) {
      bumped = true;
      const slope = downhill(terrain, x, z);
      const incoming = slope ? Math.min(0, vx * slope.nx + vz * slope.nz) : 0;
      ground = null;
      if (slope && incoming < 0) {
        vx -= incoming * 1.04 * slope.nx;
        vz -= incoming * 1.04 * slope.nz;
        x = b.x + vx * h;
        z = b.z + vz * h;
        const along = probe(terrain, spec, x, z, heading, false, b).ground;
        if (!wall(along, x, z)) {
          ground = along;
          b.speed = vx * -Math.sin(heading) + vz * -Math.cos(heading);
          b.slipX = vx + Math.sin(heading) * b.speed;
          b.slipZ = vz + Math.cos(heading) * b.speed;
        }
      }
    }
    if (!ground) {
      /* The world's edge, a wall dead ahead: stop (falling, if it's in the air). */
      bumped = true;
      b.speed *= 0.15;
      b.slipX = 0;
      b.slipZ = 0;
      b.steer *= 0.8;
      const rest = probe(terrain, spec, b.x, b.z, b.rot, false, b).ground;
      if (rest && b.y > rest.y + AIRBORNE) fall(b, rest, h);
      else if (rest) suspend(b, rest, h);
      continue;
    }
    b.x = x;
    b.z = z;
    b.rot = heading;
    /* Over a drop: off the ground until it comes back up to meet the wheels. */
    if (b.y > ground.y + AIRBORNE) {
      if (fall(b, ground, h) > 4) bumped = true;
      continue;
    }
    /*
     * Climbing a bump costs speed rather than keeping road pace over every
     * stone. (Steep hills have their own cost, in `slope` above.)
     */
    const rise = Math.max(0, ground.y - b.supportY);
    if (rise > 0 && Math.abs(rake) <= MAX_TILT) {
      const loss = Math.min(
        Math.abs(b.speed) * 0.4,
        (9.81 * rise) / Math.max(2, Math.abs(b.speed)),
      );
      b.speed -= Math.sign(b.speed) * loss;
    }
    suspend(b, ground, h);
  }
  return bumped;
}

/*
 * Get out onto clear dry ground beside the car, within a small step of the
 * seat; or, from a car in the sea, out into the water to swim for it.
 */
export function carExit(b: VehicleState, terrain: Ground, spec: CarSpec, side: number) {
  const wet = b.y < SEA_LEVEL - 0.2;
  const w = spec.halfWidth + 0.75;
  const l = spec.halfLength;
  const spots: [number, number][] = [
    [w * side, 0],
    [-w * side, 0],
    [w * side, l * 0.6],
    [-w * side, l * 0.6],
    [0, l + 0.9],
    [0, -l - 0.9],
  ];
  for (const [lx, lz] of spots) {
    const x = b.x + lx * Math.cos(b.rot) + lz * Math.sin(b.rot);
    const z = b.z - lx * Math.sin(b.rot) + lz * Math.cos(b.rot);
    const ground = terrain.groundAt(x, z, b.y + 1).ground;
    if (Math.abs(x) > BOUNDARY || Math.abs(z) > BOUNDARY) continue;
    if (wet) {
      /* Into the water beside it, a little above the roof's reach of the bottom. */
      if (ground > b.y + 1.5) continue;
      return { x, y: Math.max(ground, Math.min(b.y + 0.5, SEA_LEVEL - 1)), z, yaw: b.rot };
    }
    if (ground < SEA_LEVEL - 0.6) continue;
    if (Math.abs(ground - b.y) > 1.5) continue;
    if (
      terrain
        .solidsNear(x, z)
        .some((s) => s.top > ground + 0.1 && s.bottom < ground + 1.8 && overlaps(s, x, z, 0.45))
    )
      continue;
    return { x, y: ground, z, yaw: b.rot };
  }
  return null;
}
