import { hullClear, stepHull } from "./boat";
import { carExit, carGround, settleCar, stepCar } from "./car";
import { SEA_LEVEL } from "./constants";
import { mountExit, mountGround, stepMount } from "./mount";
import type { Ground, Solid } from "./terrain";
import { afloat, RIDER_HIP, SEATED_EYE, type Seat, VEHICLES, type VehicleKind } from "./vehicles";

/*
 * One vehicle's state, whatever it is, and the step that moves it. The
 * driver's client steps its own vehicle and reports where it got to (the room
 * checks it's plausible); the room steps one nobody is driving until it
 * settles. Both use the same code, on the same ground.
 */

export type VehicleState = {
  x: number;
  y: number;
  z: number;
  /* Heading, as a body's yaw (0 faces -z). */
  rot: number;
  /* Forward speed, m/s (negative going astern). */
  speed: number;
  /* Yaw rate, radians a second. */
  turn: number;
  /* Front wheels' lock (cars, radians), or the helm (boats and mounts, -1..1). */
  steer: number;
  pitch: number;
  roll: number;
  /* Vertical speed: suspension, or a horse in mid-jump. */
  vy: number;
  /* Sail set (0..1), throttle (-1..1), or 1 while a mount is in the air. */
  aux: number;
  /* A car's suspension and tyre slip: the room's and the driver's own, never sent. */
  supportY: number;
  slipX: number;
  slipZ: number;
};

export type DriveIntent = {
  forward: number;
  right: number;
  /* Space: handbrake, or jump. */
  brake: boolean;
  jump: boolean;
  /* Shift: gallop. */
  boost: boolean;
};

export const IDLE: DriveIntent = { forward: 0, right: 0, brake: true, jump: false, boost: false };

export function createVehicle(x: number, y: number, z: number, rot: number): VehicleState {
  return {
    x,
    y,
    z,
    rot,
    speed: 0,
    turn: 0,
    steer: 0,
    pitch: 0,
    roll: 0,
    vy: 0,
    aux: 0,
    supportY: y,
    slipX: 0,
    slipZ: 0,
  };
}

/* Move it on by `dt`. Returns true if it hit something. */
export function stepVehicle(
  kind: VehicleKind,
  v: VehicleState,
  input: DriveIntent,
  dt: number,
  ground: Ground,
  time: number,
) {
  const def = VEHICLES[kind];
  if (def.hull) return stepHull(v, input, dt, ground, def.hull, time);
  if (def.car) return stepCar(v, input, dt, ground, def.car);
  if (def.mount) return stepMount(v, input, dt, ground, def.mount);
  return false;
}

/* Nothing left to settle: no way on, no bounce, not in the air. */
export function atRest(v: VehicleState) {
  return (
    Math.abs(v.speed) < 0.02 &&
    Math.abs(v.turn) < 0.01 &&
    Math.abs(v.vy) < 0.02 &&
    Math.hypot(v.slipX, v.slipZ) < 0.02 &&
    v.aux <= 0.02
  );
}

/*
 * Could it be put down here, facing `rot`? The height it would sit at, or
 * null. Boats want water deep enough for the hull; the rest want clear,
 * dry, fairly level ground.
 */
export function placeAt(kind: VehicleKind, ground: Ground, x: number, z: number, rot: number) {
  const def = VEHICLES[kind];
  if (def.hull) return hullClear(ground, def.hull, x, z, rot) ? SEA_LEVEL : null;
  if (def.car) return carGround(ground, def.car, x, z, rot)?.y ?? null;
  if (def.mount) return mountGround(ground, def.mount, x, z, rot)?.y ?? null;
  return null;
}

/* A new vehicle, put down where `placeAt` said it would go. */
export function settle(kind: VehicleKind, v: VehicleState, ground: Ground) {
  const def = VEHICLES[kind];
  if (def.car) settleCar(v, ground, def.car);
  else if (def.hull) v.y = SEA_LEVEL;
}

/*
 * What the vehicle is to anyone walking or swimming into it, or anything
 * else driving into it: a box round its body. Nobody stands on one.
 */
export function vehicleSolids(
  kind: VehicleKind,
  v: Pick<VehicleState, "x" | "y" | "z" | "rot">,
): Solid[] {
  const def = VEHICLES[kind];
  const hx = def.beam / 2;
  const hz = def.length / 2;
  const box = { hx, hz, c: Math.cos(v.rot), s: Math.sin(v.rot) };
  if (def.mount)
    return [
      {
        x: v.x,
        z: v.z,
        r: Math.hypot(hx, hz),
        bottom: v.y + 0.6,
        top: v.y + def.height * 0.75,
        standable: false,
        box,
      },
    ];
  const bottom = afloat(kind) ? SEA_LEVEL - (def.hull?.draft ?? 1) : v.y + 0.15;
  return [
    {
      x: v.x,
      z: v.z,
      r: Math.hypot(hx, hz),
      bottom,
      top: v.y + Math.min(def.height, afloat(kind) ? 3 : def.height),
      standable: false,
      box,
    },
  ];
}

/* A point in the vehicle's frame, out into the world, tilted with it. */
export function toWorldFrame(
  v: Pick<VehicleState, "x" | "y" | "z" | "rot" | "pitch" | "roll">,
  lx: number,
  ly: number,
  lz: number,
) {
  /* Roll about z, then pitch about x, then the heading about y (three.js's "YXZ"). */
  const cr = Math.cos(v.roll);
  const sr = Math.sin(v.roll);
  const x1 = lx * cr - ly * sr;
  const y1 = lx * sr + ly * cr;
  const cp = Math.cos(v.pitch);
  const sp = Math.sin(v.pitch);
  const y2 = y1 * cp - lz * sp;
  const z2 = y1 * sp + lz * cp;
  const c = Math.cos(v.rot);
  const s = Math.sin(v.rot);
  return { x: v.x + x1 * c + z2 * s, y: v.y + y2, z: v.z - x1 * s + z2 * c };
}

export type SeatPose = { x: number; y: number; z: number; yaw: number };

export function seatOf(kind: VehicleKind, seat: number): Seat {
  const seats = VEHICLES[kind].seats;
  return seats[Math.min(seat, seats.length - 1)];
}

/* Where the seat itself is in the world: the rider's hips. */
export function seatWorld(
  kind: VehicleKind,
  v: Pick<VehicleState, "x" | "y" | "z" | "rot" | "pitch" | "roll">,
  seat: number,
): SeatPose {
  const s = seatOf(kind, seat);
  return { ...toWorldFrame(v, s.x, s.y, s.z), yaw: v.rot };
}

/*
 * Where a rider's avatar goes: its feet as if it stood, so that the seated
 * pose (FLAG.riding sinks it by RIDER_HIP) puts its hips on the seat. The
 * room keeps a rider's body here too.
 */
export function riderPose(
  kind: VehicleKind,
  v: Pick<VehicleState, "x" | "y" | "z" | "rot" | "pitch" | "roll">,
  seat: number,
): SeatPose {
  const s = seatOf(kind, seat);
  return { ...toWorldFrame(v, s.x, s.y - RIDER_HIP, s.z), yaw: v.rot };
}

/* A seated rider's eyes. */
export function eyeOf(
  kind: VehicleKind,
  v: Pick<VehicleState, "x" | "y" | "z" | "rot" | "pitch" | "roll">,
  seat: number,
) {
  const s = seatOf(kind, seat);
  return toWorldFrame(v, s.x, s.y + SEATED_EYE, s.z);
}

/*
 * How far (x, z) is from the vehicle's side: 0 inside its footprint. You
 * climb aboard from within BOARD_REACH of it.
 */
export function distanceTo(
  kind: VehicleKind,
  v: Pick<VehicleState, "x" | "z" | "rot">,
  x: number,
  z: number,
) {
  const def = VEHICLES[kind];
  const c = Math.cos(v.rot);
  const s = Math.sin(v.rot);
  const dx = x - v.x;
  const dz = z - v.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.hypot(
    Math.max(0, Math.abs(lx) - def.beam / 2),
    Math.max(0, Math.abs(lz) - def.length / 2),
  );
}

/*
 * Where you end up getting off: dry ground beside a car or a mount; for a
 * boat, a dock or the shore within a stride if there is one, otherwise over
 * the side into the sea. Null when there's nowhere (a car hemmed in).
 */
export function exitSpot(kind: VehicleKind, v: VehicleState, ground: Ground, seat: number) {
  const def = VEHICLES[kind];
  const side = seatOf(kind, seat).x >= 0 ? 1 : -1;
  if (def.car) return carExit(v, ground, def.car, side);
  if (def.mount) return mountExit(v, ground, def.mount, side);
  const c = Math.cos(v.rot);
  const s = Math.sin(v.rot);
  const w = def.beam / 2 + 1;
  const l = def.length / 2 + 1;
  const spots: [number, number][] = [
    [w * side, 0],
    [-w * side, 0],
    [0, l],
    [0, -l],
    [w, l * 0.6],
    [-w, l * 0.6],
    [w, -l * 0.6],
    [-w, -l * 0.6],
  ];
  let best: { x: number; y: number; z: number } | null = null;
  for (const [lx, lz] of spots) {
    const x = v.x + lx * c + lz * s;
    const z = v.z - lx * s + lz * c;
    const g = ground.groundAt(x, z, SEA_LEVEL + 1.6).ground;
    if (g > SEA_LEVEL + 0.15 && g < SEA_LEVEL + 2 && (!best || g < best.y)) best = { x, y: g, z };
  }
  const out = best ?? {
    x: v.x + w * side * c,
    y: SEA_LEVEL - 1,
    z: v.z - w * side * s,
  };
  return { ...out, yaw: v.rot };
}

/* ---------- on the wire ---------- */

/*
 * A vehicle in a snapshot: [id, kind index, x, y, z, heading, pitch, roll,
 * speed, steer, turn, aux, ...who's in each seat (0 for nobody)].
 */
export type VehicleSnap = number[];

export const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function packVehicle(
  id: number,
  index: number,
  v: VehicleState,
  seats: readonly (number | null)[],
): VehicleSnap {
  return [
    id,
    index,
    r2(v.x),
    r2(v.y),
    r2(v.z),
    r3(v.rot),
    r3(v.pitch),
    r3(v.roll),
    r2(v.speed),
    r3(v.steer),
    r3(v.turn),
    r2(v.aux),
    ...seats.map((s) => s ?? 0),
  ];
}

export function unpackVehicle(snap: VehicleSnap) {
  const [id, index, x, y, z, rot, pitch, roll, speed, steer, turn, aux] = snap;
  return {
    id,
    index,
    state: { x, y, z, rot, pitch, roll, speed, steer, turn, aux },
    seats: snap.slice(12),
  };
}
