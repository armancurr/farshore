import assert from "node:assert/strict";
import { test } from "node:test";
import { stepHull } from "../src/game/shared/boat.ts";
import { carExit, carGround, stepCar, swamped, wheelContacts } from "../src/game/shared/car.ts";
import { BOUNDARY, SEA_LEVEL } from "../src/game/shared/constants.ts";
import {
  createVehicle,
  distanceTo,
  packVehicle,
  placeAt,
  riderPose,
  seatWorld,
  unpackVehicle,
} from "../src/game/shared/drive.ts";
import { stepMount } from "../src/game/shared/mount.ts";
import { FLAG, parseClientMsg, RIDE_FIELDS } from "../src/game/shared/protocol.ts";
import { parseWorldSave, WORLD_SAVE_VERSION } from "../src/game/shared/save.ts";
import {
  RIDER_HIP,
  VEHICLE_KINDS,
  VEHICLES,
  vehicleFromIndex,
  vehicleIndex,
} from "../src/game/shared/vehicles.ts";
import { sailPolar, windAt } from "../src/game/shared/wind.ts";
import { Room } from "../src/game/server/room.ts";

/* ---------- a flat world to drive on ---------- */

const intent = (o = {}) => ({
  forward: 0,
  right: 0,
  brake: false,
  jump: false,
  boost: false,
  ...o,
});
const throttle = intent({ forward: 1 });
const brake = intent({ brake: true });

function ground(height = () => 2, solids = []) {
  return {
    heightAt: height,
    normalAt: () => [0, 1, 0],
    solidsNear: () => solids,
    groundAt: (x, z) => ({ ground: height(x, z), onSolid: false }),
    ladders: [],
    addSolids() {},
    removeSolids() {},
  };
}

/* The sedan: a sensible car to test the wheels with. */
const SEDAN = VEHICLES.sedan.car;
const car = (y = 2) => createVehicle(0, y, 0, 0);
function drive(b, input, seconds, terrain = ground(), hz = 60, spec = SEDAN) {
  for (let i = 0; i < Math.round(seconds * hz); i++) stepCar(b, input, 1 / hz, terrain, spec);
}

/* ---------- the catalogue ---------- */

test("every vehicle has a class, a model, seats and a spec for its class", () => {
  assert(VEHICLE_KINDS.length >= 20);
  for (const kind of VEHICLE_KINDS) {
    const d = VEHICLES[kind];
    assert(d.seats.length >= 1, kind);
    assert(d.price > 0 && d.name && d.blurb, kind);
    const spec = { row: d.hull, sail: d.hull, motor: d.hull, car: d.car, mount: d.mount }[d.class];
    assert(spec, `${kind} has a ${d.class} spec`);
    assert(vehicleFromIndex(vehicleIndex(kind)) === kind);
    /* Seats sit on or over the vehicle, within its footprint. */
    for (const s of d.seats) {
      assert(Math.abs(s.z) < d.length / 2 + 0.5 && Math.abs(s.x) < d.beam / 2 + 0.5, kind);
      assert(s.y > -0.3 && s.y < d.height + 0.5, kind);
    }
  }
  /* Real-world sizes, roughly. */
  assert(Math.abs(VEHICLES.rowboat.length - 3.6) < 0.1);
  assert(Math.abs(VEHICLES.pirate_sloop.length - 11) < 0.1);
  assert(VEHICLES.pirate_galleon.length >= 25);
  assert(VEHICLES.sedan.length > 3.8 && VEHICLES.sedan.length < 4.6);
  /* Ships carry a crew. */
  for (const k of ["pirate_sloop", "pirate_brig", "pirate_galleon", "trading_sloop", "galleon"])
    assert(VEHICLES[k].seats.length >= 3, k);
  /* The hand-built ones are gone. */
  assert(!("desertbike" in VEHICLES));
});

test("a rider's avatar sits RIDER_HIP below the seat, which tilts with the vehicle", () => {
  const v = createVehicle(10, 0, 20, Math.PI / 2);
  const seat = seatWorld("galleon", v, 0);
  const rider = riderPose("galleon", v, 0);
  assert(Math.abs(seat.y - rider.y - RIDER_HIP) < 1e-9);
  /* The helm of a ship heading -x is astern of the middle: +x. */
  assert(seat.x > v.x + 5);
  /* Heeled to starboard, a seat to port rises. */
  const level = seatWorld("galleon", { ...v, rot: 0 }, 1);
  const heeled = seatWorld("galleon", { ...v, rot: 0, roll: -0.2 }, 1);
  assert(VEHICLES.galleon.seats[1].x < 0 && heeled.y > level.y);
  assert.equal(distanceTo("sedan", createVehicle(0, 0, 0, 0), 0, 0), 0);
  assert(distanceTo("sedan", createVehicle(0, 0, 0, 0), 5, 0) > 3);
});

/* ---------- cars ---------- */

test("a car accelerates to its top speed and brakes to a stop without reversing", () => {
  const b = car();
  drive(b, throttle, 8);
  assert(Math.abs(b.speed - SEDAN.speed) < 1e-6);
  assert(b.z < -100 && Math.abs(b.x) < 1e-9 && Math.abs(b.y - 2) < 1e-6);
  const at = b.z;
  drive(b, brake, 4);
  assert.equal(b.speed, 0);
  assert(at - b.z < 45);
});

test("reverse is slow, and steering can't pivot a car standing still", () => {
  const b = car();
  drive(b, intent({ right: 1 }), 1);
  assert.equal(b.rot, 0);
  drive(b, intent({ forward: -1 }), 4);
  assert(Math.abs(b.speed + SEDAN.reverse) < 1e-6);
  assert(b.z > 0);
});

test("steering at speed is limited by grip, not a flick of the keys", () => {
  const b = car();
  b.speed = SEDAN.speed;
  drive(b, intent({ forward: 1, right: 1 }), 1);
  /* About 14 m/s² sideways at most: a gentle arc at 108 km/h. */
  assert(Math.abs(b.turn * b.speed) < 16, `lateral ${b.turn * b.speed}`);
  const slow = car();
  slow.speed = 4;
  drive(slow, intent({ forward: 0.2, right: 1 }), 0.5);
  assert(Math.abs(slow.turn) > 0.6, "full lock at walking pace turns tightly");
});

test("fixed substeps give the same drive at 20, 30, 60 and 120 Hz", () => {
  const states = [20, 30, 60, 120].map((hz) => {
    const b = car();
    drive(b, intent({ forward: 1, right: 0.4 }), 4, ground(), hz);
    return b;
  });
  for (const b of states) {
    assert(Math.hypot(b.x - states[0].x, b.z - states[0].z) < 0.02);
    assert(Math.abs(b.rot - states[0].rot) < 0.002);
  }
});

test("a glancing impact slides along a wall without crossing it", () => {
  const wall = {
    x: 0,
    z: -10,
    r: 100,
    bottom: 0,
    top: 5,
    standable: false,
    box: { hx: 100, hz: 0.025, c: Math.cos(Math.PI / 6), s: Math.sin(Math.PI / 6) },
  };
  const b = car();
  b.speed = 20;
  const terrain = ground(() => 2, [wall]);
  for (let i = 0; i < 60; i++) {
    stepCar(b, throttle, 1 / 20, terrain, SEDAN);
    const separation = b.x * wall.box.s + (b.z - wall.z) * wall.box.c;
    assert(separation > 0.5, "The body stays on the approach side");
  }
  assert(b.x > 2, "Momentum carries it along the wall");
});

test("trees, overhangs, walls of rock and the world's edge stop a car", () => {
  for (const solid of [
    { x: 0, z: -10, r: 0.3, bottom: 0, top: 6, standable: false },
    { x: 0, z: -10, r: 4, bottom: 2.4, top: 4, standable: false },
  ]) {
    const b = car();
    b.speed = 20;
    drive(
      b,
      throttle,
      1.5,
      ground(() => 2, [solid]),
    );
    assert(b.z > -9, "blocked by a solid");
  }
  /* A wall of rock. */
  const rock = car();
  rock.speed = 20;
  drive(
    rock,
    throttle,
    2,
    ground((_x, z) => (z < -10 ? 15 : 2)),
  );
  assert(rock.z > -10 && Math.abs(rock.y - 2) < 0.2);
  /* Too steep to put a car down on: the terrain's own normal says so. */
  const cliff = { ...ground(), normalAt: () => [0.8, 0.5, 0] };
  assert.equal(carGround(cliff, SEDAN, 0, 0, 0), null);
  assert.equal(
    carGround(
      ground(() => -1),
      SEDAN,
      0,
      0,
      0,
    ),
    null,
  );
  const b = createVehicle(0, 2, -BOUNDARY + 4, 0);
  b.speed = 20;
  drive(b, throttle, 2);
  assert(b.z >= -BOUNDARY + 1.5);
});

test("the wheels follow a slope the car can climb, and it slows going up", () => {
  const terrain = ground((_x, z) => 20 - z * 0.2);
  const b = car(20);
  drive(b, throttle, 5, terrain);
  assert(Math.abs(b.pitch - Math.atan(0.2)) < 0.02);
  assert(Math.abs(b.y - terrain.heightAt(b.x, b.z)) < 0.25);
  assert(b.speed > 15 && b.speed < SEDAN.speed);
});

/* A slope rising `grade` metres per metre towards -z (ahead), with its normal to match. */
function slope(grade, base = 30) {
  const n = Math.hypot(grade, 1);
  return { ...ground((_x, z) => base - z * grade), normalAt: () => [0, 1 / n, grade / n] };
}

test("off a cliff a car falls, lands on its wheels and drives on, never past 37 degrees of tilt", () => {
  const terrain = ground((_x, z) => (z < -10 ? 2 : 14));
  const b = car(14);
  b.speed = 14;
  let lowest = 14;
  let flew = false;
  let tilt = 0;
  for (let i = 0; i < 240; i++) {
    stepCar(b, throttle, 1 / 60, terrain, SEDAN);
    if (b.z < -11 && b.y > 4) flew = true;
    lowest = Math.min(lowest, b.y);
    tilt = Math.max(tilt, Math.abs(b.pitch), Math.abs(b.roll));
  }
  assert(flew, "it carried on out past the edge before it came down");
  assert(b.z < -40, "and kept driving once down");
  assert(Math.abs(b.y - 2) < 0.25 && lowest > 1.8, "on the lower ground, not through it");
  assert(b.speed > 8);
  assert(tilt <= 0.65 + 1e-9);
});

test("a car drives down (and across) a slope too steep to climb, the right way up", () => {
  const down = slope(-1.5);
  const b = car(30);
  b.speed = 6;
  let tilt = 0;
  for (let i = 0; i < 180; i++) {
    stepCar(b, throttle, 1 / 60, down, SEDAN);
    tilt = Math.max(tilt, Math.abs(b.pitch), Math.abs(b.roll));
  }
  assert(b.z < -15, "down it goes");
  assert(b.y >= down.heightAt(b.x, b.z) - 0.15, "riding on the ground, not under it");
  assert(tilt <= 0.65 + 1e-9);
  /* Across it: sideways along the contour. */
  const across = car(30);
  across.rot = Math.PI / 2;
  across.speed = 6;
  drive(across, throttle, 2, down);
  assert(across.x < -8, "along the slope");
  assert(Math.abs(across.roll) <= 0.65 + 1e-9);
  /* Up it: a slow, hard climb, slower still the steeper it is. */
  const climb = (grade) => {
    const up = car(30);
    up.speed = 10;
    drive(up, throttle, 3, slope(grade));
    return up;
  };
  const flat = car(30);
  flat.speed = 10;
  drive(
    flat,
    throttle,
    3,
    ground(() => 30),
  );
  const fifty = climb(1.2);
  const sixty = climb(1.75);
  assert(fifty.z < -30 && fifty.z > flat.z, "up 50 degrees, slower than on the flat");
  assert(sixty.z < -5 && sixty.z > fifty.z, "up 60 degrees, slower again");
  /* Too steep to hold: it rolls back rather than sticking there. */
  assert(climb(2.5).z > 0, "rolls back off 68 degrees");
  /* A face of rock: no further. */
  assert(climb(4).z > -2, "a wall at 76 degrees");
  /* And nobody gets to put a car down on it. */
  assert.equal(carGround(down, SEDAN, 0, 0, 0), null);
});

test("a car driven into the sea is swamped: it stops, sinks to the bottom and won't drive out", () => {
  const sea = ground((_x, z) => (z < -10 ? -5 : 2));
  const b = car();
  b.speed = 14;
  drive(b, throttle, 6, sea);
  assert(b.z < -12, "in it went");
  assert(swamped(b), "swamped");
  assert(Math.abs(b.y + 5) < 0.2, "on the bottom");
  assert(Math.abs(b.speed) < 0.2, "the water stopped it");
  const z = b.z;
  drive(b, intent({ forward: -1 }), 2, sea);
  assert(Math.abs(b.z - z) < 0.2, "the engine's drowned");
  /* Getting out: into the water beside it, to swim. */
  const out = carExit(b, sea, SEDAN, 1);
  assert(out && out.y < SEA_LEVEL && out.y >= -5);
  /* Wading the shallows is fine. */
  const shallow = car();
  shallow.speed = 10;
  drive(
    shallow,
    throttle,
    3,
    ground((_x, z) => (z < -10 ? -0.3 : 0.3)),
  );
  assert(shallow.z < -25 && !swamped(shallow));
});

test("tyres climb a kerb with lift and a speed cost; a high step stops them", () => {
  const kerb = {
    x: 0,
    z: -10,
    r: 4,
    bottom: 2,
    top: 2.25,
    standable: true,
    box: { hx: 4, hz: 0.6, c: 1, s: 0 },
  };
  const b = car();
  const flat = car();
  b.speed = flat.speed = 8;
  let highest = 2;
  for (let i = 0; i < 150; i++) {
    stepCar(
      b,
      throttle,
      1 / 60,
      ground(() => 2, [kerb]),
      SEDAN,
    );
    stepCar(flat, throttle, 1 / 60, ground(), SEDAN);
    highest = Math.max(highest, b.y);
  }
  assert(b.z < -16, "over the kerb");
  assert(highest > 2.08, "the body lifts over it");
  assert(b.z > flat.z, "climbing costs speed");
  const wall = { ...kerb, top: 2.9 };
  const c = car();
  c.speed = 10;
  drive(
    c,
    throttle,
    2,
    ground(() => 2, [wall]),
  );
  assert(c.z > -9);
});

test("each wheel finds its own ground over a stone", () => {
  const rock = { x: -0.7, z: -1.05, r: 0.5, bottom: 1.8, top: 2.3, standable: true };
  const [fl, fr, bl, br] = wheelContacts(
    ground(() => 2, [rock]),
    SEDAN,
    0,
    0,
    0,
  );
  assert(fl > fr + 0.2, "front left is on the stone");
  assert(Math.abs(bl - 2) < 1e-6 && Math.abs(br - 2) < 1e-6);
});

test("invalid times don't move a car, and a malformed report isn't taken", () => {
  const b = car();
  const initial = { ...b };
  for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    stepCar(b, throttle, dt, ground(), SEDAN);
  assert.deepEqual(b, initial);
  const move = { t: "move", x: 0, y: 2, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, flags: 0 };
  const ride = RIDE_FIELDS.map(() => 1);
  assert.deepEqual(parseClientMsg(JSON.stringify({ ...move, ride })).ride, ride);
  assert.equal(parseClientMsg(JSON.stringify({ ...move, ride: ride.slice(1) })).ride, undefined);
  assert.equal(
    parseClientMsg(JSON.stringify({ ...move, ride: [...ride.slice(1), "x"] })).ride,
    undefined,
  );
  /* Nobody claims to be riding from a client frame. */
  assert.equal(parseClientMsg(JSON.stringify({ ...move, flags: 512 })), null);
});

test("getting out finds a dry, clear side", () => {
  const b = car();
  assert(carExit(b, ground(), SEDAN, 1));
  assert.equal(
    carExit(
      b,
      ground(() => -2),
      SEDAN,
      1,
    ),
    null,
  );
  assert.equal(
    carExit(
      b,
      ground(() => 2, [{ x: 0, z: 0, r: 10, bottom: 0, top: 5, standable: false }]),
      SEDAN,
      1,
    ),
    null,
  );
});

/* ---------- boats ---------- */

const sea = () => ground(() => -10);

test("a rowboat rows on water, pivots on its oars and runs aground in the shallows", () => {
  const spec = VEHICLES.rowboat.hull;
  const b = createVehicle(0, 0, 0, 0);
  for (let i = 0; i < 300; i++) stepHull(b, throttle, 1 / 60, sea(), spec, 0);
  assert(b.z < -10 && b.speed <= spec.speed + 1e-9);
  const still = createVehicle(0, 0, 0, 0);
  for (let i = 0; i < 60; i++) stepHull(still, intent({ right: 1 }), 1 / 60, sea(), spec, 0);
  assert(still.rot < -0.3, "oars turn it on the spot");
  const dry = createVehicle(0, 0, 0, 0);
  dry.speed = 3;
  stepHull(dry, throttle, 1 / 60, ground(), spec, 0);
  assert.equal(dry.z, 0);
});

test("a motorboat planes, banks into a turn and backs slowly astern", () => {
  const spec = VEHICLES.runabout.hull;
  const b = createVehicle(0, 0, 0, 0);
  for (let i = 0; i < 600; i++) stepHull(b, throttle, 1 / 60, sea(), spec, 0);
  assert(Math.abs(b.speed - spec.speed) < 0.5);
  assert(b.pitch > 0.02, "bow up on the plane");
  for (let i = 0; i < 90; i++)
    stepHull(b, intent({ forward: 1, right: 1 }), 1 / 60, sea(), spec, 0);
  assert(b.turn < -0.3 && b.roll < -0.05, "turning right, it banks into the turn: right side down");
  const r = createVehicle(0, 0, 0, 0);
  for (let i = 0; i < 600; i++) stepHull(r, intent({ forward: -1 }), 1 / 60, sea(), spec, 0);
  assert(r.speed < 0 && r.speed >= -spec.reverse - 1e-9);
});

test("the wind is one pure function of time, and sails make way by it", () => {
  assert.deepEqual(windAt(1234.5), windAt(1234.5));
  for (let t = 0; t < 3600; t += 37) {
    const w = windAt(t);
    assert(w.strength >= 0.15 && w.strength <= 1);
    assert(Math.abs(Math.hypot(w.x, w.z) - w.speed) < 1e-9);
  }
  /* Best on a reach, worse dead downwind, barely anything head to wind (but never nothing). */
  assert(sailPolar(1.2) > sailPolar(0));
  assert(sailPolar(0) > sailPolar(Math.PI * 0.9));
  assert(sailPolar(Math.PI) > 0);

  const spec = VEHICLES.daysailer.hull;
  const t = 500;
  const w = windAt(t);
  const sail = (rot, seconds = 30) => {
    const b = createVehicle(0, 0, 0, rot);
    for (let i = 0; i < seconds * 60; i++)
      stepHull(b, intent({ forward: i < 180 ? 1 : 0 }), 1 / 60, sea(), spec, t);
    return b;
  };
  const reach = sail(w.angle + 1.3);
  const irons = sail(w.angle + Math.PI);
  assert(reach.aux === 1, "sail stays set once hoisted");
  assert(reach.speed > irons.speed * 3, "a reach is far quicker than head to wind");
  assert(irons.speed > 0.2, "you can always claw out of irons");
  assert(Math.abs(reach.roll) > 0.02, "she heels");
  /* Take the sail in and she slows. */
  for (let i = 0; i < 600; i++) stepHull(reach, intent({ forward: -1 }), 1 / 60, sea(), spec, t);
  assert(reach.aux === 0 && reach.speed < 1);
});

test("a galleon needs deep water; a rowboat floats in the shallows", () => {
  const shallow = ground(() => -1);
  assert.equal(placeAt("rowboat", shallow, 0, 0, 0), SEA_LEVEL);
  assert.equal(placeAt("galleon", shallow, 0, 0, 0), null);
  assert.equal(
    placeAt(
      "galleon",
      ground(() => -6),
      0,
      0,
      0,
    ),
    SEA_LEVEL,
  );
  assert.equal(placeAt("sedan", sea(), 0, 0, 0), null);
});

/* ---------- mounts ---------- */

/* The mounts are put away for now (commented out in VEHICLES); their physics stays, untested till they're back. */
test.skip("a horse walks on, gallops, jumps, climbs a step and won't swim", () => {
  const spec = VEHICLES.horse.mount;
  const h = createVehicle(0, 2, 0, 0);
  const ride = (input, s, terrain = ground()) => {
    for (let i = 0; i < s * 60; i++) stepMount(h, input, 1 / 60, terrain, spec);
  };
  ride(throttle, 3);
  assert(Math.abs(h.speed - spec.trot) < 1e-6);
  ride(intent({ forward: 1, boost: true }), 4);
  assert(Math.abs(h.speed - spec.gallop) < 1e-6);
  let top = h.y;
  stepMount(h, intent({ forward: 1, boost: true, jump: true }), 1 / 60, ground(), spec);
  for (let i = 0; i < 60; i++) {
    stepMount(h, intent({ forward: 1, boost: true }), 1 / 60, ground(), spec);
    top = Math.max(top, h.y);
  }
  assert(top > 2.8, "off the ground");
  assert.equal(h.y, 2);
  assert.equal(h.aux, 0);
  /* A step up it takes in its stride; a wall it doesn't. */
  const step = createVehicle(0, 2, 0, 0);
  for (let i = 0; i < 180; i++)
    stepMount(
      step,
      throttle,
      1 / 60,
      ground((_x, z) => (z < -3 ? 2.5 : 2)),
      spec,
    );
  assert(step.z < -5 && step.y === 2.5);
  const wall = createVehicle(0, 2, 0, 0);
  for (let i = 0; i < 180; i++)
    stepMount(
      wall,
      throttle,
      1 / 60,
      ground((_x, z) => (z < -3 ? 5 : 2)),
      spec,
    );
  assert(wall.z > -3.2);
  const wet = createVehicle(0, 2, 0, 0);
  for (let i = 0; i < 300; i++)
    stepMount(
      wet,
      throttle,
      1 / 60,
      ground((_x, z) => (z < -5 ? -3 : 2)),
      spec,
    );
  assert(wet.z > -5.5, "it stops at deep water");
});

/* ---------- the wire and the save ---------- */

test("a vehicle packs into a snapshot and back, seats and all", () => {
  const v = createVehicle(1.234, 2.5, -3, 0.5);
  v.speed = 4.567;
  const snap = packVehicle(7, vehicleIndex("brigantine"), v, [3, null, 9, null, null]);
  const out = unpackVehicle(JSON.parse(JSON.stringify(snap)));
  assert.equal(out.id, 7);
  assert.equal(vehicleFromIndex(out.index), "brigantine");
  assert.deepEqual(out.seats, [3, 0, 9, 0, 0]);
  assert(Math.abs(out.state.speed - 4.57) < 1e-9 && out.state.x === 1.23);
});

test("saves from before the islands were reshaped wake on the Harbor, without their vehicle", () => {
  const inv = { coins: 0, slot: 0, items: {}, tools: [], hotbar: [] };
  const save = parseWorldSave({
    v: 2,
    ids: { tool: 1 },
    players: [
      {
        token: "aaaaaaaa",
        name: "a",
        saved: { x: 5, y: 1, z: 6, yaw: 0, health: 80, inv, boat: 12 },
      },
    ],
  });
  assert.equal(save.players[0].saved.vehicle, null);
  assert.equal(save.players[0].saved.relocate, true);
});

test("old saves: a rowboat comes back as a rowboat, a desert bike as nothing", () => {
  const inv = { coins: 0, slot: 0, items: {}, tools: [], hotbar: [] };
  const player = (extra) => ({ x: 5, y: 1, z: 6, yaw: 0.5, health: 80, inv, ...extra });
  const save = parseWorldSave({
    v: WORLD_SAVE_VERSION,
    ids: { tool: 1 },
    players: [
      { token: "aaaaaaaa", name: "a", saved: player({ boat: 12 }) },
      {
        token: "bbbbbbbb",
        name: "b",
        saved: player({ vehicle: { kind: "desertbike", x: 1, y: 1, z: 1, rot: 0, aboard: true } }),
      },
      {
        token: "cccccccc",
        name: "c",
        saved: player({ vehicle: { kind: "galleon", x: 1, y: 0, z: 1, rot: 0, aboard: true } }),
      },
    ],
  });
  assert.deepEqual(save.players[0].saved.vehicle, {
    kind: "rowboat",
    x: 5,
    y: 0,
    z: 6,
    rot: 0.5,
    aboard: true,
  });
  assert.equal(save.players[1].saved.vehicle, null);
  assert.equal(save.players[2].saved.vehicle.kind, "galleon");
});

test("old saves: building kits and a bed are let go, everything else is kept", () => {
  const inv = {
    coins: 40,
    slot: 0,
    items: { deer: 2, campfire: 1, hut: 3, dock: 1 },
    tools: [],
    hotbar: [],
    bed: 17,
  };
  const save = parseWorldSave({
    v: WORLD_SAVE_VERSION,
    ids: { tool: 1 },
    players: [
      {
        token: "aaaaaaaa",
        name: "a",
        saved: { x: 5, y: 1, z: 6, yaw: 0, health: 80, inv, vehicle: null },
      },
    ],
  });
  const kept = save.players[0].saved.inv;
  assert.deepEqual(kept.items, { deer: 2 });
  assert.equal(kept.coins, 40);
  assert.equal("bed" in kept, false);
});

test("building messages are no longer understood", () => {
  for (const m of [
    { t: "place", kind: "hut", x: 0, z: 0, rot: 0 },
    { t: "pickup", id: 1 },
    { t: "buy", item: "hut" },
    { t: "stash", chest: 1, item: "deer", n: 1 },
    { t: "interact", kind: "prefab", id: 1 },
  ])
    assert.equal(parseClientMsg(JSON.stringify(m)), null);
});

/* ---------- the room ---------- */

function member(room) {
  const messages = [];
  const id = room.join({ send: (m) => messages.push(m) });
  return { id, messages, last: (t) => messages.findLast((m) => m.t === t) };
}

const moveAt = (x, y, z, extra = {}) => ({
  t: "move",
  x,
  y,
  z,
  yaw: 0,
  pitch: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  flags: 0,
  ...extra,
});

test("the room spawns, seats a helmsman and a passenger, takes plausible reports and lets them off", () => {
  let now = 100;
  const room = new Room({ online: true, now: () => now });
  const a = member(room);
  const b = member(room);
  room.tick();
  /* Out to sea from the middle of the island, for a ship. */
  const spawn = a.last("world").you;
  let found = null;
  for (let r = 40; r < 600 && !found; r += 4) {
    room.handle(a.id, moveAt(spawn.x + r, 0.2, spawn.z, { yaw: -Math.PI / 2 }));
    room.handle(a.id, { t: "spawn", kind: "brigantine" });
    now += 0.05;
    room.tick();
    found = a.last("snap")?.v.find((v) => vehicleFromIndex(v[1]) === "brigantine") ?? null;
  }
  assert(found, "a brigantine launched somewhere off the island");
  const ship = unpackVehicle(found);
  /* Both swim up to it: the first takes the helm, the second a deck seat. */
  for (const m of [a, b]) {
    room.handle(m.id, moveAt(ship.state.x, -0.5, ship.state.z));
    room.handle(m.id, { t: "interact", kind: "vehicle", id: ship.id });
  }
  assert.deepEqual(
    [a.last("aboard").seat, b.last("aboard").seat],
    [0, 1],
    "helm, then the first free deck seat",
  );
  /* The helmsman reports a plausible step; the room takes it and seats everyone aboard. */
  now += 0.5;
  const state = { ...ship.state, x: ship.state.x + 3, vy: 0 };
  room.handle(a.id, moveAt(0, 0, 0, { ride: RIDE_FIELDS.map((k) => state[k]) }));
  now += 0.05;
  room.tick();
  let snap = a.last("snap");
  const v = unpackVehicle(snap.v.find((s) => s[0] === ship.id));
  assert(Math.abs(v.state.x - state.x) < 0.01);
  assert.deepEqual(v.seats.slice(0, 2), [a.id, b.id]);
  const passenger = snap.p.find((p) => p[0] === b.id);
  const seat = riderPose("brigantine", v.state, 1);
  assert(Math.hypot(passenger[1] - seat.x, passenger[3] - seat.z) < 0.05);
  assert(passenger[6] & 512, "riding");
  /* A teleport isn't taken. */
  const far = { ...state, x: state.x + 400 };
  room.handle(a.id, moveAt(0, 0, 0, { ride: RIDE_FIELDS.map((k) => far[k]) }));
  now += 0.05;
  room.tick();
  snap = a.last("snap");
  assert(Math.abs(unpackVehicle(snap.v.find((s) => s[0] === ship.id)).state.x - state.x) < 0.01);
  /* The helmsman goes over the side; the passenger can take the empty helm. */
  room.handle(a.id, { t: "interact", kind: "vehicle", id: ship.id });
  assert.equal(a.last("aboard").id, null);
  room.handle(b.id, { t: "interact", kind: "vehicle", id: ship.id });
  assert.equal(b.last("aboard").seat, 0);
  /* The owner leaves; their ship stays while someone's aboard, and goes once they're off. */
  room.leave(a.id);
  now += 0.05;
  room.tick();
  assert(b.last("snap").v.some((s) => s[0] === ship.id));
  room.handle(b.id, { t: "interact", kind: "vehicle", id: ship.id });
  now += 0.05;
  room.tick();
  assert(!b.last("snap").v.some((s) => s[0] === ship.id));
  room.leave(b.id);
});

test("a land vehicle is put down on dry ground near you, never in the sea", () => {
  const room = new Room({ online: true, now: () => 100 });
  const a = member(room);
  room.tick();
  room.handle(a.id, { t: "spawn", kind: "fourbyfour" });
  room.tick();
  const snap = a.last("snap").v.find((v) => vehicleFromIndex(v[1]) === "fourbyfour");
  assert(
    snap,
    a.messages
      .filter((m) => m.t === "feed")
      .map((m) => m.text)
      .join(" | "),
  );
  const v = unpackVehicle(snap).state;
  assert(v.y > SEA_LEVEL + 0.1);
  const you = a.last("world").you;
  assert(Math.hypot(v.x - you.x, v.z - you.z) < 40);
  room.leave(a.id);
});

test("leaving at the helm keeps your vehicle: you come back in it, where you left it", () => {
  let now = 100;
  const room = new Room({ online: true, grand: true, now: () => now });
  const hello = { name: "sailor", token: "sailortoken1", own: true };
  const join = () => {
    const messages = [];
    const id = room.join({ send: (m) => messages.push(m) }, hello);
    return { id, messages, last: (t) => messages.findLast((m) => m.t === t) };
  };
  const a = join();
  room.tick();
  const you = a.last("world").you;
  let boat = null;
  for (let r = 20; r < 700 && !boat; r += 5) {
    room.handle(a.id, moveAt(you.x + r, 0.2, you.z, { yaw: -Math.PI / 2 }));
    room.handle(a.id, { t: "spawn", kind: "rowboat" });
    now += 0.05;
    room.tick();
    const snap = a.last("snap")?.v.find((v) => vehicleFromIndex(v[1]) === "rowboat");
    boat = snap ? unpackVehicle(snap) : null;
  }
  assert(boat, "a rowboat launched off the Harbor");
  room.handle(a.id, moveAt(boat.state.x, -0.4, boat.state.z));
  room.handle(a.id, { t: "interact", kind: "vehicle", id: boat.id });
  assert.equal(a.last("aboard").seat, 0);
  room.leave(a.id);
  now += 0.05;
  room.tick();
  const back = join();
  room.tick();
  const aboard = back.last("aboard");
  assert(aboard && aboard.id !== null && aboard.seat === 0, "back at the oars");
  const v = unpackVehicle(back.last("snap").v.find((s) => s[0] === aboard.id));
  assert.equal(vehicleFromIndex(v.index), "rowboat");
  assert(Math.hypot(v.state.x - boat.state.x, v.state.z - boat.state.z) < 0.1);
  room.leave(back.id);
});

test("creative and flying only count where the room allows creative (the dev server)", () => {
  for (const creative of [false, true]) {
    const room = new Room({ online: true, now: () => 100, creative });
    const a = member(room);
    const b = member(room);
    room.tick();
    const you = a.last("world").you;
    room.handle(a.id, moveAt(you.x, you.y + 20, you.z, { flags: FLAG.creative | FLAG.fly }));
    room.tick();
    const seen = b.last("snap").p.find((p) => p[0] === a.id);
    assert(seen, "the other player is in the snapshot");
    assert.equal((seen[6] & FLAG.creative) !== 0, creative);
    assert.equal((seen[6] & FLAG.fly) !== 0, creative);
    room.leave(a.id);
    room.leave(b.id);
  }
});

test("sat in a car under the sea you drown, a few seconds after it goes under", () => {
  let now = 100;
  const room = new Room({ online: true, now: () => now });
  const a = member(room);
  room.tick();
  room.handle(a.id, { t: "spawn", kind: "fourbyfour" });
  room.tick();
  const snap = a.last("snap").v.find((v) => vehicleFromIndex(v[1]) === "fourbyfour");
  const { id, state } = unpackVehicle(snap);
  room.handle(a.id, moveAt(state.x, state.y, state.z));
  room.handle(a.id, { t: "interact", kind: "vehicle", id });
  assert.equal(a.last("aboard").id, id);
  /* As if it had rolled into the deep: the seat well under the surface. */
  room.rides.get(id).state.y = SEA_LEVEL - 4;
  const hurts = () => a.messages.filter((m) => m.t === "hurt" && m.cause === "drown").length;
  for (let i = 0; i < 40; i++) {
    now += 0.05;
    room.tick();
  }
  assert.equal(hurts(), 0, "a breath held");
  for (let i = 0; i < 40; i++) {
    now += 0.05;
    room.tick();
  }
  assert(hurts() >= 1, "then the water gets in");
  room.leave(a.id);
});
