import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import {
  BIKE_SPEED,
  bikeExit,
  bikeGround,
  bikeWheelContacts,
  createBike,
  stepBike,
} from "../src/game/shared/bike.ts";
import { ROW_SPEED, stepBoat } from "../src/game/shared/boat.ts";
import { BOUNDARY } from "../src/game/shared/constants.ts";
import { parseClientMsg } from "../src/game/shared/protocol.ts";
import { Room } from "../src/game/server/room.ts";
import { BikeView, buildDesertBike } from "../src/game/client/scene/bikes.ts";

const throttle = { forward: 1, right: 0, brake: false };
const brake = { forward: 0, right: 0, brake: true };
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
function run(b, input, seconds, terrain = ground(), hz = 60) {
  for (let i = 0; i < Math.round(seconds * hz); i++) stepBike(b, input, 1 / hz, terrain);
}
test("accelerates to a bounded 72 km/h and brakes without reversing", () => {
  const b = createBike(0, 2, 0, 0);
  run(b, throttle, 5);
  assert.equal(b.speed, BIKE_SPEED);
  assert(b.z < -60 && b.x === 0 && b.y === 2);
  const at = b.z;
  run(b, brake, 2);
  assert.equal(b.speed, 0);
  assert(at - b.z < 14);
});
test("reverse is slow and steering cannot pivot a stationary bike", () => {
  const b = createBike(0, 2, 0, 0);
  run(b, { ...brake, brake: false, right: 1 }, 1);
  assert.equal(b.rot, 0);
  run(b, { forward: -1, right: 0, brake: false }, 3);
  assert.equal(b.speed, -3);
  assert(b.z > 0);
});
test("fixed substeps produce equivalent motion at 20, 30, 60 and 120 Hz", () => {
  const states = [20, 30, 60, 120].map((hz) => {
    const b = createBike(0, 2, 0, 0);
    run(b, { ...throttle, right: 0.4 }, 4, ground(), hz);
    return b;
  });
  for (const b of states) {
    assert(Math.hypot(b.x - states[0].x, b.z - states[0].z) < 0.01);
    assert(Math.abs(b.rot - states[0].rot) < 0.001);
  }
});
test("glancing impacts slide along a thin rotated wall without crossing it", () => {
  const wall = {
    x: 0,
    z: -8,
    r: 100,
    bottom: 0,
    top: 5,
    standable: false,
    box: { hx: 100, hz: 0.025, c: Math.cos(Math.PI / 6), s: Math.sin(Math.PI / 6) },
  };
  const b = createBike(0, 2, 0, 0);
  b.speed = BIKE_SPEED;
  const terrain = ground(() => 2, [wall]);
  for (let i = 0; i < 40; i++) {
    stepBike(b, throttle, 1 / 20, terrain);
    const separation = b.x * wall.box.s + (b.z - wall.z) * wall.box.c;
    assert(
      separation >= 0.025 + 0.43 + 1.15 * wall.box.c - 0.01,
      "Capsule remains on the approach side of the wall",
    );
  }
  assert(b.x > 2, "Tangential impact momentum moves the bike along the wall");
  assert(b.speed > 0.1);
});
test("round obstacles and overhead clearance stop the bike", () => {
  for (const solid of [
    { x: 0, z: -7, r: 0.08, bottom: 0, top: 6, standable: false },
    { x: 0, z: -7, r: 4, bottom: 3.2, top: 4, standable: false },
  ]) {
    const b = createBike(0, 2, 0, 0);
    b.speed = BIKE_SPEED;
    run(
      b,
      throttle,
      1,
      ground(() => 2, [solid]),
    );
    assert(b.z > -5.5);
  }
});
test("water, cliffs, steep terrain and world edges are impassable", () => {
  for (const height of [(_x, z) => (z < -8 ? -5 : 2), (_x, z) => (z < -8 ? 15 : 2)]) {
    const b = createBike(0, 2, 0, 0);
    b.speed = BIKE_SPEED;
    run(b, throttle, 2, ground(height));
    assert(b.z > -7 && b.y === 2);
  }
  assert.equal(
    bikeGround(
      ground(() => -1),
      0,
      0,
      0,
    ),
    null,
  );
  assert.equal(
    bikeGround(
      ground((x, z) => 30 - z * 1.5),
      0,
      0,
      0,
    ),
    null,
  );
  const b = createBike(0, 2, -BOUNDARY + 3, 0);
  b.speed = BIKE_SPEED;
  run(b, throttle, 2);
  assert(b.z >= -BOUNDARY + 1.5);
});
test("both wheel contacts follow a traversable slope", () => {
  const terrain = ground((_x, z) => 20 - z * 0.2);
  const b = createBike(0, 20, 0, 0);
  run(b, throttle, 4, terrain);
  assert(Math.abs(b.y - terrain.heightAt(b.x, b.z)) < 0.15);
  assert(Math.abs(b.pitch - Math.atan(0.2)) < 0.01);
  assert(b.speed > 15 && b.speed < BIKE_SPEED);
});

test("tires climb a low stone curb, with lift and a speed cost rather than tunneling", () => {
  const curb = {
    x: 0,
    z: -7,
    r: 4,
    bottom: 2,
    top: 2.3,
    standable: true,
    box: { hx: 3, hz: 0.5, c: 1, s: 0 },
  };
  const terrain = ground(() => 2, [curb]);
  const b = createBike(0, 2, 0, 0),
    flat = createBike(0, 2, 0, 0);
  b.speed = flat.speed = 8;
  let highest = 2,
    pitched = 0;
  for (let i = 0; i < 120; i++) {
    stepBike(b, throttle, 1 / 60, terrain);
    stepBike(flat, throttle, 1 / 60, ground());
    highest = Math.max(highest, b.y);
    pitched = Math.max(pitched, Math.abs(b.pitch));
  }
  assert(b.z < -15 && b.speed > 5);
  assert(highest > 2.1 && pitched > 0.1, "Chassis actually lifts and pitches over the stone");
  assert(b.z > flat.z, "Climbing dissipates energy");
});

test("small rounded rocks are traversable at low and high approach speeds", () => {
  const rock = {
    x: 0,
    z: -7,
    r: 0.85,
    bottom: 1.8,
    top: 2.65,
    standable: true,
    surface: "rounded",
  };
  const terrain = ground(() => 2, [rock]);
  for (const speed of [2, 6, 20]) {
    const b = createBike(0, 2, 0, 0);
    b.speed = speed;
    let highest = 2,
      maxCompression = 0;
    const input = { ...throttle, forward: speed / BIKE_SPEED };
    for (let i = 0; i < Math.ceil((18 / speed) * 120); i++) {
      stepBike(b, input, 1 / 120, terrain);
      highest = Math.max(highest, b.y);
      maxCompression = Math.max(maxCompression, Math.abs(b.y - b.supportY));
      assert(Number.isFinite(b.verticalSpeed) && Math.abs(b.verticalSpeed) <= 5);
    }
    assert(b.z < -9, `Bike clears the rock at ${speed} m/s`);
    assert(highest > 2.2 && highest < 2.9);
    assert(maxCompression <= 0.18001, "Suspension stays inside its travel stops");
    assert(Math.abs(b.y - 2) < 0.06, "Suspension returns to level ground");
  }
});

test("large rocks and non-standable short barriers cannot be climbed as small stones", () => {
  for (const solid of [
    { x: 0, z: -7, r: 0.85, bottom: 1.8, top: 3.4, standable: true, surface: "rounded" },
    { x: 0, z: -7, r: 0.85, bottom: 2, top: 2.3, standable: false },
    {
      x: 0,
      z: -7,
      r: 4,
      bottom: 2,
      top: 2.7,
      standable: true,
      box: { hx: 3, hz: 0.5, c: 1, s: 0 },
    },
  ]) {
    const b = createBike(0, 2, 0, 0);
    b.speed = 12;
    run(
      b,
      throttle,
      2,
      ground(() => 2, [solid]),
    );
    assert(b.z > -5.5);
    assert(Math.abs(b.y - 2) < 0.01);
  }
});

test("circular tire sweep climbs a small terrain ledge but not a high wall", () => {
  const b = createBike(0, 2, 0, 0);
  b.speed = 6;
  run(
    b,
    throttle,
    3,
    ground((_x, z) => (z < -7 ? 2.3 : 2)),
  );
  assert(b.z < -15 && Math.abs(b.y - 2.3) < 0.03);
});

test("rock contact and suspension stay consistent across simulation frame rates", () => {
  const rock = {
    x: 0,
    z: -7,
    r: 0.85,
    bottom: 1.8,
    top: 2.65,
    standable: true,
    surface: "rounded",
  };
  const terrain = ground(() => 2, [rock]);
  const states = [20, 30, 60, 120].map((hz) => {
    const b = createBike(0, 2, 0, 0);
    b.speed = 6;
    run(b, throttle, 2, terrain, hz);
    return b;
  });
  for (const b of states) {
    assert(Math.abs(b.z - states[0].z) < 0.01);
    assert(Math.abs(b.y - states[0].y) < 0.01);
    assert(Math.abs(b.pitch - states[0].pitch) < 0.01);
  }
});

test("front and rear wheel visuals articulate independently over a stone", () => {
  const rock = {
    x: 0,
    z: -0.825,
    r: 0.7,
    bottom: 1.8,
    top: 2.5,
    standable: true,
    surface: "rounded",
  };
  const terrain = ground(() => 2, [rock]);
  const contacts = bikeWheelContacts(terrain, 0, 0, 0);
  assert(contacts.front > contacts.rear + 0.35);
  const view = new BikeView();
  view.set([1, 0, 2.2, 0, 0, 0, 0, 0.1, 0], true);
  for (let i = 0; i < 30; i++) view.update(1 / 60, terrain);
  const front = view.group.getObjectByName("front-wheel");
  const rear = view.group.getObjectByName("rear-wheel");
  assert(front.position.y > rear.position.y + 0.15);
  assert(front.position.y <= 0.76 && rear.position.y >= 0.12);
  view.dispose();
});

test("frontal impacts dissipate speed without launching the chassis", () => {
  const wall = {
    x: 0,
    z: -8,
    r: 100,
    bottom: 0,
    top: 5,
    standable: false,
    box: { hx: 100, hz: 0.025, c: 1, s: 0 },
  };
  const b = createBike(0, 2, 0, 0);
  b.speed = BIKE_SPEED;
  let hitSpeed = null;
  for (let i = 0; i < 120; i++) {
    const before = b.speed;
    stepBike(
      b,
      throttle,
      1 / 120,
      ground(() => 2, [wall]),
    );
    if (hitSpeed === null && before > 10 && b.speed < 1) hitSpeed = b.speed;
    assert(b.z > -6.41 && b.y === 2);
    assert(Math.abs(b.slipX) < 1e-8);
  }
  assert(hitSpeed !== null && Math.abs(hitSpeed) < 1);
});
test("invalid times do not move physics and invalid drive payloads cannot become inputs", () => {
  const b = createBike(0, 2, 0, 0),
    initial = { ...b };
  for (const dt of [0, -1, Number.NaN, Infinity]) stepBike(b, throttle, dt, ground());
  assert.deepEqual(b, initial);
  const move = { t: "move", x: 0, y: 2, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, flags: 0 };
  assert.deepEqual(parseClientMsg(JSON.stringify({ ...move, drive: throttle })).drive, throttle);
  assert.equal(
    parseClientMsg(JSON.stringify({ ...move, drive: { ...throttle, forward: 99 } })).drive,
    undefined,
  );
  assert.equal(
    parseClientMsg(JSON.stringify({ ...move, drive: { ...throttle, brake: "false" } })).drive,
    undefined,
  );
});
test("dismount finds a dry clear side and refuses blocked exits", () => {
  const b = createBike(0, 2, 0, 0);
  assert(bikeExit(b, ground()));
  assert.equal(
    bikeExit(
      b,
      ground(() => -1),
    ),
    null,
  );
  assert.equal(
    bikeExit(
      b,
      ground(() => 2, [{ x: 0, z: 0, r: 10, bottom: 0, top: 5, standable: false }]),
    ),
    null,
  );
});
test("bike geometry has two articulated wheels, steering and a ground-level footprint", () => {
  const model = buildDesertBike();
  assert(model.getObjectByName("front-wheel"));
  assert(model.getObjectByName("rear-wheel"));
  assert(model.getObjectByName("steering"));
  const box = new THREE.Box3().setFromObject(model);
  assert(box.min.y >= -0.02 && box.max.y > 1.2 && box.max.y < 1.5);
  assert(box.max.z - box.min.z > 2.4);
  model.traverse((o) => o.geometry?.dispose());
});
test("rowboat still moves on water and rejects dry land", () => {
  const boat = { x: 0, z: 0, rot: 0, speed: 0, turn: 0 };
  for (let i = 0; i < 180; i++)
    stepBoat(
      boat,
      throttle,
      1 / 60,
      ground(() => -10),
    );
  assert(boat.z < -5 && boat.speed <= ROW_SPEED);
  const dry = { x: 0, z: 0, rot: 0, speed: 2, turn: 0 };
  stepBoat(dry, throttle, 1 / 60, ground());
  assert.equal(dry.z, 0);
});
test("room spawns and mounts exclusively, ignores teleport frames, brakes on stale input and dismounts safely", () => {
  let now = 100;
  const room = new Room({ online: true, settle: true, now: () => now });
  const messages = [];
  const id = room.join({ send: (m) => messages.push(m) });
  room.handle(id, { t: "spawn", kind: "desertbike" });
  const prefab = messages.findLast((m) => m.t === "prefab")?.prefab;
  assert(prefab?.kind === "desertbike", "Find a clear spawn on actual Harbor terrain");
  const move = {
    t: "move",
    x: prefab.x + 1.5,
    y: prefab.y,
    z: prefab.z,
    yaw: prefab.rot,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    flags: 0,
  };
  room.handle(id, move);
  room.handle(id, { t: "interact", kind: "prefab", id: prefab.id });
  assert.equal(messages.findLast((m) => m.t === "aboard")?.boat, prefab.id);
  const otherMessages = [];
  const other = room.join({ send: (m) => otherMessages.push(m) });
  room.handle(other, move);
  room.handle(other, { t: "interact", kind: "prefab", id: prefab.id });
  assert(!otherMessages.some((m) => m.t === "aboard" && m.boat === prefab.id));
  room.handle(id, { ...move, x: 1500, y: 300, z: 1500, drive: throttle });
  for (let i = 0; i < 4; i++) {
    now += 0.05;
    room.tick();
  }
  let snap = messages.findLast((m) => m.t === "snap");
  assert(snap.bikes.some((b) => b[0] === prefab.id));
  const rider = snap.p.find((p) => p[0] === id);
  assert(Math.hypot(rider[1] - prefab.x, rider[3] - prefab.z) < 4);
  for (let i = 0; i < 50; i++) {
    now += 0.05;
    room.tick();
  }
  snap = messages.findLast((m) => m.t === "snap");
  assert.equal(snap.bikes.find((b) => b[0] === prefab.id)[5], 0);
  room.handle(id, { t: "interact", kind: "prefab", id: prefab.id });
  assert.equal(messages.findLast((m) => m.t === "aboard").boat, null);
  assert(messages.some((m) => m.t === "respawn"));
  room.leave(id);
  room.leave(other);
});
