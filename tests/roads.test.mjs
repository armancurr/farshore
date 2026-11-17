import assert from "node:assert/strict";
import { test } from "node:test";
import { Archipelago } from "../src/game/shared/archipelago.ts";
import { SEA_LEVEL } from "../src/game/shared/constants.ts";
import { createVehicle, placeAt, unpackVehicle } from "../src/game/shared/drive.ts";
import { stepCar } from "../src/game/shared/car.ts";
import { HARBOR_ID, WORLD } from "../src/game/shared/islands.ts";
import { ROAD_HALF } from "../src/game/shared/paths.ts";
import { DECK } from "../src/game/shared/places.ts";
import { Room } from "../src/game/server/room.ts";
import { VEHICLES, vehicleFromIndex } from "../src/game/shared/vehicles.ts";

const world = new Archipelago(WORLD);
const islands = [...world.islands.values()];
const piersOf = (t) => t.places.filter((p) => p.kind === "pier");

/* Is there a road joining a and b? The roads as a graph: points within a stride of each other touch. */
function connected(t) {
  const pts = t.paths.flat();
  const seen = new Uint8Array(pts.length);
  const stack = [0];
  seen[0] = 1;
  while (stack.length) {
    const p = pts[stack.pop()];
    for (let k = 0; k < pts.length; k++)
      if (!seen[k] && Math.hypot(pts[k].x - p.x, pts[k].z - p.z) < 3) {
        seen[k] = 1;
        stack.push(k);
      }
  }
  return { pts, seen };
}
const nearestRoad = (pts, x, z) => Math.min(...pts.map((p) => Math.hypot(p.x - x, p.z - z)));

test("the Harbor has a pier facing each hunting island; each hunting island one facing the Harbor", () => {
  const harbor = world.islands.get(HARBOR_ID).terrain;
  const wild = WORLD.filter((o) => !o.harbor);
  assert.equal(piersOf(harbor).length, wild.length);
  for (const o of wild) {
    const a = Math.atan2(o.z, o.x);
    const facing = piersOf(harbor).some((p) => {
      const b = Math.atan2(p.z - harbor.oz, p.x - harbor.ox);
      return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.5;
    });
    assert(facing, `a Harbor pier faces ${o.name}`);
    const t = world.islands.get(o.id).terrain;
    const [pier, ...more] = piersOf(t);
    assert(pier && more.length === 0, `${o.name} has one pier`);
    const toHarbor = Math.atan2(-t.oz, -t.ox);
    const b = Math.atan2(pier.z - t.oz, pier.x - t.ox);
    assert(Math.abs(Math.atan2(Math.sin(toHarbor - b), Math.cos(toHarbor - b))) < 0.6, o.name);
  }
});

test("every pier runs out over water from a quay on the shore, with berths down both sides", () => {
  for (const { info, terrain: t } of islands)
    for (const pier of piersOf(t)) {
      const d = pier.deck;
      assert(d.hx * 2 >= ROAD_HALF * 2 - 0.5, `${info.name}: the deck is a road's width`);
      /* The far end is out in deep water; the quay at the root is dry and level with the deck. */
      const far = { x: d.x + Math.sin(d.rot) * d.hz, z: d.z + Math.cos(d.rot) * d.hz };
      assert(t.heightAt(far.x, far.z) < -2.5, `${info.name}: deep water at the end`);
      assert(Math.abs(t.heightAt(pier.quay.x, pier.quay.z) - DECK) < 0.15, `${info.name}: quay`);
      assert.equal(pier.berths.length, 2);
      for (const b of pier.berths) assert(b.length > 20, `${info.name}: berths along the deck`);
    }
});

test("one road network per island, from the pier, reaching the summit and every place", () => {
  for (const { info, terrain: t } of islands) {
    const { pts, seen } = connected(t);
    assert(
      seen.every((s) => s === 1),
      `${info.name}: every road joins the rest`,
    );
    for (const pl of t.places) {
      if (pl.kind === "wreck") continue;
      const at = pl.kind === "view" ? pl : pl.door;
      assert(nearestRoad(pts, at.x, at.z) < 12, `${info.name}: a road reaches the ${pl.kind}`);
    }
    if (!info.harbor) {
      const top = t.places.find((p) => p.kind === "summit");
      assert(top, `${info.name} has its summit`);
      assert(nearestRoad(pts, top.x, top.z) < top.r + ROAD_HALF + 4, `${info.name}: up to the top`);
    }
  }
});

test("the roads cover the land: little open ground is far from one", () => {
  for (const { info, terrain: t } of islands) {
    const pts = t.paths.flat();
    let land = 0;
    let far = 0;
    for (let z = -t.half; z < t.half; z += 24)
      for (let x = -t.half; x < t.half; x += 24) {
        const wx = t.ox + x;
        const wz = t.oz + z;
        if (t.heightAt(wx, wz) < 3 || t.normalAt(wx, wz)[1] < 0.86) continue;
        land++;
        if (nearestRoad(pts, wx, wz) > 160) far++;
      }
    assert(far / land < 0.04, `${info.name}: ${far} of ${land} spots are far from a road`);
  }
});

test("roads are cut to an easy grade and level across their width", () => {
  for (const { info, terrain: t } of islands) {
    let run = 0;
    let steep = 0;
    for (const line of t.paths)
      for (let k = 0; k + 1 < line.length; k++) {
        const a = line[k];
        const b = line[k + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        run += len;
        const grade = Math.abs(t.heightAt(b.x, b.z) - t.heightAt(a.x, a.z)) / len;
        if (grade > 0.22) steep += len;
        assert(grade < 0.65, `${info.name}: no wall in a road (${grade.toFixed(2)})`);
      }
    assert(steep / run < 0.02, `${info.name}: ${steep.toFixed(0)} of ${run.toFixed(0)} m steep`);
  }
});

test("a car drives off the quay, along the deck and out to the end of a pier", () => {
  const t = world.islands.get(HARBOR_ID).terrain;
  const pier = piersOf(t)[0];
  const d = pier.deck;
  const sx = Math.sin(d.rot);
  const sz = Math.cos(d.rot);
  /* On the quay, facing out to sea (a car's forward is -z in its own frame). */
  const v = createVehicle(pier.quay.x, DECK, pier.quay.z, Math.atan2(-sx, -sz));
  const spec = VEHICLES.sedan.car;
  for (let i = 0; i < 60 * 6; i++)
    stepCar(
      v,
      { forward: 1, right: 0, brake: false, jump: false, boost: false },
      1 / 60,
      world,
      spec,
    );
  const out = (v.x - pier.quay.x) * sx + (v.z - pier.quay.z) * sz;
  assert(out > 30, `drove ${out.toFixed(1)} m out along the pier`);
  assert(Math.abs(v.y - DECK) < 0.2, `rides on the deck (y ${v.y.toFixed(2)})`);
  assert(t.heightAt(v.x, v.z) < SEA_LEVEL, "over the water");
});

test("a boat launched on a pier is tied up in a berth alongside, bow to the sea", () => {
  const room = new Room({ online: true, grand: true, now: () => 100 });
  const t = world.islands.get(HARBOR_ID).terrain;
  const pier = piersOf(t)[1];
  const d = pier.deck;
  /* Two people on the quay each launch a brigantine there. */
  const ships = [];
  for (let k = 0; k < 2; k++) {
    const messages = [];
    const id = room.join({ send: (m) => messages.push(m) });
    room.tick();
    room.handle(id, {
      t: "move",
      x: pier.quay.x,
      y: DECK,
      z: pier.quay.z,
      yaw: 0,
      pitch: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      flags: 0,
    });
    room.handle(id, { t: "spawn", kind: "brigantine" });
    room.tick();
    const feed = messages.filter((m) => m.t === "feed").map((m) => m.text);
    assert(feed.at(-1).includes("tied up at the pier"), feed.join(" | "));
    const mine = messages
      .findLast((m) => m.t === "snap")
      .v.map(unpackVehicle)
      .filter((v) => vehicleFromIndex(v.index) === "brigantine")
      .find((v) => !ships.some((s) => s.id === v.id));
    assert(mine, "a brigantine in the snapshot");
    ships.push(mine);
  }
  for (const { state: ship } of ships) {
    /* Beside the deck, not on it, heading out along the pier. */
    const lx = (ship.x - d.x) * Math.cos(d.rot) - (ship.z - d.z) * Math.sin(d.rot);
    const beam = VEHICLES.brigantine.beam;
    assert(Math.abs(lx) > d.hx && Math.abs(lx) < d.hx + beam, `alongside (${lx.toFixed(2)})`);
    const fx = -Math.sin(ship.rot);
    const fz = -Math.cos(ship.rot);
    assert(fx * Math.sin(d.rot) + fz * Math.cos(d.rot) > 0.99, "bow out to sea");
  }
  /* The second found a berth of its own, clear of the first. */
  const [a, b] = ships.map((s) => s.state);
  const along = (a.x - b.x) * Math.sin(d.rot) + (a.z - b.z) * Math.cos(d.rot);
  const across = (a.x - b.x) * Math.cos(d.rot) - (a.z - b.z) * Math.sin(d.rot);
  assert(
    Math.abs(along) >= VEHICLES.brigantine.length - 0.5 || Math.abs(across) > d.hx * 2,
    `clear of each other (along ${along.toFixed(1)}, across ${across.toFixed(1)})`,
  );
});
