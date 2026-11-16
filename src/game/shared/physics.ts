import {
  ACCEL_AIR,
  ACCEL_GROUND,
  BOUNDARY,
  FLY_BOOST,
  FLY_CEILING,
  FLY_CLIMB,
  FLY_SPEED,
  GRAVITY,
  JUMP_COST,
  JUMP_SPEED,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SLIDE_ACCEL,
  SPRINT_DRAIN,
  SPRINT_SPEED,
  STAMINA_MAX,
  STAMINA_REGEN,
  STEEP_NY,
  SEA_LEVEL,
  STEP_HEIGHT,
  WALK_SPEED,
  WATER_SPEED,
} from "./constants";
import { clamp, lerp } from "./math";
import { type Ground, inHole, type Solid } from "./terrain";
import type { Ladder } from "./structures";

export type Body = {
  x: number;
  y: number; // feet
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  grounded: boolean;
  stamina: number;
  sprinting: boolean;
  /* Seconds before a ladder can catch you again (after pushing off one). */
  ladderCooldown: number;
  climbing: boolean;
};

export type Intent = {
  forward: number; // -1..1
  right: number; // -1..1
  jump: boolean;
  sprint: boolean;
  /* Carrying something heavy, or busy swinging it. */
  speedScale?: number;
  noSprint?: boolean;
};

export type StepWorld = {
  terrain: Ground;
};

export type StepEvents = {
  jumped: boolean;
  landed: number; // impact speed, 0 if none
  enteredWater: boolean;
  moved: number; // horizontal distance this step
};

/* How deep your feet hang while floating: eyes stay above water, the cold still gets you. */
export const FLOAT_DEPTH = 1.3;

export function createBody(x: number, y: number, z: number, yaw: number): Body {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw,
    grounded: true,
    stamina: STAMINA_MAX,
    sprinting: false,
    ladderCooldown: 0,
    climbing: false,
  };
}

export const CLIMB_SPEED = 3.4;
const LADDER_REACH = 0.8;

function ladderAt(ladders: readonly Ladder[], body: Body) {
  for (const l of ladders) {
    if (body.y < l.bottom - 0.3 || body.y > l.top + 0.2) continue;
    if ((body.x - l.x) ** 2 + (body.z - l.z) ** 2 < LADDER_REACH * LADDER_REACH) return l;
  }
  return null;
}

/*
 * On a ladder: W climbs, S descends, nothing hangs on. At the top W walks you
 * off onto the floor; Space pushes off the way you're looking.
 */
function climb(
  body: Body,
  lad: Ladder,
  intent: Intent,
  dt: number,
  world: StepWorld,
  events: StepEvents,
  wx: number,
  wz: number,
) {
  body.climbing = true;
  if (intent.jump) {
    body.vx = -Math.sin(body.yaw) * 4.5;
    body.vz = -Math.cos(body.yaw) * 4.5;
    body.vy = 4.2;
    body.ladderCooldown = 0.45;
    body.climbing = false;
    events.jumped = true;
  } else if (body.y >= lad.top - 0.02 && intent.forward > 0) {
    body.vx = wx * WALK_SPEED * 0.6;
    body.vz = wz * WALK_SPEED * 0.6;
    body.vy = 0;
    body.y = lad.top;
  } else {
    body.vy = intent.forward > 0 ? CLIMB_SPEED : intent.forward < 0 ? -CLIMB_SPEED : 0;
    body.vx = (lad.x - body.x) * 8;
    body.vz = (lad.z - body.z) * 8;
  }
  body.grounded = false;
  body.stamina = Math.min(STAMINA_MAX, body.stamina + STAMINA_REGEN * 0.5 * dt);
  const px = body.x;
  const pz = body.z;
  body.x = clamp(body.x + body.vx * dt, -BOUNDARY, BOUNDARY);
  body.z = clamp(body.z + body.vz * dt, -BOUNDARY, BOUNDARY);
  resolveSolids(body, world.terrain.solidsNear(body.x, body.z));
  body.y = Math.min(body.y + body.vy * dt, lad.top);
  const { ground } = world.terrain.groundAt(body.x, body.z, body.y);
  if (body.y <= ground) {
    body.y = ground;
    body.vy = Math.max(0, body.vy);
    body.grounded = true;
  }
  events.moved = Math.hypot(body.x - px, body.z - pz);
  events.enteredWater = false;
  return events;
}

/* Push the body out of an oriented box; returns the outward normal or null. */
function pushOutOfBox(body: Body, s: Solid, box: NonNullable<Solid["box"]>) {
  const dx = body.x - s.x;
  const dz = body.z - s.z;
  const lx = dx * box.c - dz * box.s;
  const lz = dx * box.s + dz * box.c;
  const cx = clamp(lx, -box.hx, box.hx);
  const cz = clamp(lz, -box.hz, box.hz);
  let ox = lx - cx;
  let oz = lz - cz;
  const d2 = ox * ox + oz * oz;
  if (d2 >= PLAYER_RADIUS * PLAYER_RADIUS) return null;
  let nlx: number;
  let nlz: number;
  let px: number;
  let pz: number;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    ox /= d;
    oz /= d;
    nlx = ox;
    nlz = oz;
    px = cx + ox * PLAYER_RADIUS;
    pz = cz + oz * PLAYER_RADIUS;
  } else if (box.hx - Math.abs(lx) < box.hz - Math.abs(lz)) {
    /* Centre inside the box: leave by the nearest face. */
    nlx = Math.sign(lx) || 1;
    nlz = 0;
    px = nlx * (box.hx + PLAYER_RADIUS);
    pz = lz;
  } else {
    nlx = 0;
    nlz = Math.sign(lz) || 1;
    px = lx;
    pz = nlz * (box.hz + PLAYER_RADIUS);
  }
  body.x = s.x + px * box.c + pz * box.s;
  body.z = s.z - px * box.s + pz * box.c;
  return { nx: nlx * box.c + nlz * box.s, nz: -nlx * box.s + nlz * box.c };
}

/* Push the body out of any solid it can't step onto. */
function resolveSolids(body: Body, solids: readonly Solid[]) {
  for (const s of solids) {
    if (body.y >= s.top - STEP_HEIGHT && s.standable) continue;
    if (body.y + PLAYER_HEIGHT < s.bottom || body.y > s.top) continue;
    if (inHole(s, body.x, body.z)) continue;
    const dx = body.x - s.x;
    const dz = body.z - s.z;
    const min = s.r + PLAYER_RADIUS;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    let nx: number;
    let nz: number;
    if (s.box) {
      const n = pushOutOfBox(body, s, s.box);
      if (!n) continue;
      nx = n.nx;
      nz = n.nz;
    } else {
      const d = Math.sqrt(d2) || 0.0001;
      nx = d2 > 0 ? dx / d : 1;
      nz = d2 > 0 ? dz / d : 0;
      body.x = s.x + nx * min;
      body.z = s.z + nz * min;
    }
    const into = body.vx * nx + body.vz * nz;
    if (into < 0) {
      body.vx -= into * nx;
      body.vz -= into * nz;
    }
  }
}

/*
 * One fixed step of the character controller: accelerate toward the wish
 * direction, slide on steep ground, wade slowly, fall, and land on terrain or
 * on anything standable.
 */
export function stepBody(body: Body, intent: Intent, dt: number, world: StepWorld): StepEvents {
  const events: StepEvents = { jumped: false, landed: 0, enteredWater: false, moved: 0 };
  const wasWet = body.y < SEA_LEVEL;
  const depth = SEA_LEVEL - body.y;
  const wade = clamp(depth / 1.1, 0, 1);

  /* Wish direction in world space. Yaw 0 looks down -Z. */
  const sin = Math.sin(body.yaw);
  const cos = Math.cos(body.yaw);
  let wx = -sin * intent.forward + cos * intent.right;
  let wz = -cos * intent.forward - sin * intent.right;
  const wlen = Math.hypot(wx, wz);
  if (wlen > 1) {
    wx /= wlen;
    wz /= wlen;
  }
  const moving = wlen > 0.1;

  /* Ladders: grab one by walking into its foot, or by falling past it. */
  body.ladderCooldown = Math.max(0, body.ladderCooldown - dt);
  body.climbing = false;
  const lad = body.ladderCooldown > 0 ? null : ladderAt(world.terrain.ladders, body);
  if (lad) {
    const atFoot = body.grounded && body.y <= lad.bottom + 0.3;
    const facing =
      -Math.sin(body.yaw) * (lad.x - body.x) + -Math.cos(body.yaw) * (lad.z - body.z) > -0.1;
    const hanging = !body.grounded && body.y > lad.bottom + 0.2;
    if (hanging || (atFoot && intent.forward > 0 && facing))
      return climb(body, lad, intent, dt, world, events, wx, wz);
  }

  body.sprinting = intent.sprint && !intent.noSprint && moving && body.stamina > 1 && body.grounded;
  const speed =
    (body.sprinting ? SPRINT_SPEED : WALK_SPEED) *
    lerp(1, WATER_SPEED, wade) *
    (intent.speedScale ?? 1);
  body.stamina = clamp(
    body.stamina + (body.sprinting ? -SPRINT_DRAIN : STAMINA_REGEN) * dt,
    0,
    STAMINA_MAX,
  );

  /* Horizontal acceleration toward the target velocity. */
  const accel = (body.grounded ? ACCEL_GROUND : ACCEL_AIR) * dt;
  const tx = wx * speed;
  const tz = wz * speed;
  let dvx = tx - body.vx;
  let dvz = tz - body.vz;
  const dv = Math.hypot(dvx, dvz);
  if (!body.grounded && dv > 0) {
    /* In the air you can steer, but you can't cancel a shove. */
    const along = (body.vx * tx + body.vz * tz) / (speed || 1);
    if (along > speed) {
      dvx = 0;
      dvz = 0;
    }
  }
  if (dv > accel) {
    dvx *= accel / dv;
    dvz *= accel / dv;
  }
  body.vx += dvx;
  body.vz += dvz;

  /* Steep ground pushes you back down. */
  if (body.grounded) {
    const n = world.terrain.normalAt(body.x, body.z);
    const onTerrain = Math.abs(world.terrain.heightAt(body.x, body.z) - body.y) < 0.05;
    if (onTerrain && n[1] < STEEP_NY) {
      const k = (STEEP_NY - n[1]) / STEEP_NY;
      body.vx += n[0] * SLIDE_ACCEL * (0.4 + k * 3) * dt;
      body.vz += n[2] * SLIDE_ACCEL * (0.4 + k * 3) * dt;
    }
  }

  /* Out of your depth you float, head just above the surface. */
  const swimming = depth > FLOAT_DEPTH - 0.15;
  const canJump = body.grounded || (swimming && depth < FLOAT_DEPTH + 0.3);
  if (intent.jump && canJump && body.stamina >= JUMP_COST * 0.5) {
    body.vy = swimming && !body.grounded ? JUMP_SPEED * 0.75 : JUMP_SPEED * lerp(1, 0.55, wade);
    body.grounded = false;
    body.stamina = Math.max(0, body.stamina - JUMP_COST);
    events.jumped = true;
  }

  if (swimming) {
    body.vy += ((depth - FLOAT_DEPTH) * 14 - body.vy * 4) * dt;
  } else {
    body.vy -= GRAVITY * (depth > 0.6 ? 0.45 : 1) * dt;
    if (depth > 0.6) body.vy = Math.max(body.vy, -4);
  }

  const px = body.x;
  const pz = body.z;
  const prevY = body.y;
  body.x += body.vx * dt;
  body.z += body.vz * dt;
  body.x = clamp(body.x, -BOUNDARY, BOUNDARY);
  body.z = clamp(body.z, -BOUNDARY, BOUNDARY);
  resolveSolids(body, world.terrain.solidsNear(body.x, body.z));
  body.y += body.vy * dt;

  const { ground } = world.terrain.groundAt(body.x, body.z, Math.max(prevY, body.y));
  if (body.y <= ground) {
    if (!body.grounded && body.vy < -2) events.landed = -body.vy;
    body.y = ground;
    body.vy = Math.max(0, body.vy);
    body.grounded = true;
  } else if (body.grounded && !swimming && body.vy <= 0 && body.y - ground < STEP_HEIGHT * 1.6) {
    body.y = ground; // follow the ground down slopes and steps
    body.vy = 0;
  } else {
    body.grounded = false;
  }

  /* Ground friction when there's no intent, so knockback settles. */
  if (body.grounded && !moving) {
    const f = Math.max(0, 1 - 9 * dt);
    body.vx *= f;
    body.vz *= f;
  }

  events.moved = Math.hypot(body.x - px, body.z - pz);
  events.enteredWater = !wasWet && body.y < SEA_LEVEL;
  return events;
}

export type FlyIntent = {
  forward: number;
  right: number;
  up: boolean;
  down: boolean;
  boost: boolean;
};

/*
 * Creative flight: no gravity, quick to start and quick to stop, Space up and
 * Shift down. You still bump into things and can't go through the ground, and
 * you skim the sea rather than sink. Returns true when you've come down onto
 * land with Shift held: time to stop flying.
 */
export function stepFly(body: Body, intent: FlyIntent, dt: number, world: StepWorld) {
  const sin = Math.sin(body.yaw);
  const cos = Math.cos(body.yaw);
  let wx = -sin * intent.forward + cos * intent.right;
  let wz = -cos * intent.forward - sin * intent.right;
  const wlen = Math.hypot(wx, wz);
  if (wlen > 1) {
    wx /= wlen;
    wz /= wlen;
  }
  const speed = intent.boost && intent.forward > 0 ? FLY_BOOST : FLY_SPEED;
  const climb = (intent.up ? 1 : 0) - (intent.down ? 1 : 0);
  /* Ease toward the wanted velocity: snappy, with a short glide when you let go. */
  const k = Math.min(1, dt * (wlen > 0.1 ? 5 : 8));
  body.vx += (wx * speed - body.vx) * k;
  body.vz += (wz * speed - body.vz) * k;
  body.vy += (climb * FLY_CLIMB * (intent.boost ? 1.6 : 1) - body.vy) * Math.min(1, dt * 8);
  body.sprinting = false;
  body.climbing = false;
  body.stamina = STAMINA_MAX;

  const px = body.x;
  const pz = body.z;
  body.x = clamp(body.x + body.vx * dt, -BOUNDARY, BOUNDARY);
  body.z = clamp(body.z + body.vz * dt, -BOUNDARY, BOUNDARY);
  resolveSolids(body, world.terrain.solidsNear(body.x, body.z));
  body.y = Math.min(body.y + body.vy * dt, FLY_CEILING);

  const { ground } = world.terrain.groundAt(body.x, body.z, body.y + STEP_HEIGHT);
  const floor = Math.max(ground, SEA_LEVEL + 0.2);
  let landed = false;
  if (body.y <= floor) {
    body.y = floor;
    body.vy = Math.max(0, body.vy);
    /* Shift onto dry land (or a deck) puts you back on your feet. */
    landed = intent.down && ground >= SEA_LEVEL + 0.2;
  }
  body.grounded = landed;
  if (landed) {
    const h = Math.hypot(body.vx, body.vz);
    if (h > WALK_SPEED) {
      body.vx *= WALK_SPEED / h;
      body.vz *= WALK_SPEED / h;
    }
  }
  return { landed, moved: Math.hypot(body.x - px, body.z - pz) };
}
