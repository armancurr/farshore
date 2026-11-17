import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { CATALOGUE, CATALOGUE_IDS, piecePalette } from "../src/game/shared/catalogue.ts";
import { MODEL_BOUNDS } from "../src/game/shared/models.gen.ts";
import { checkItem } from "../src/game/shared/placing.ts";
import { parseClientMsg } from "../src/game/shared/protocol.ts";
import { parseWorldSave, WORLD_SAVE_VERSION } from "../src/game/shared/save.ts";
import {
  canDamageItem,
  FIRE,
  HEAL_TIME,
  HEAL_WAIT,
  healthAt,
  lookOf,
  MELEE_RESIST,
  REBUILD_TIME,
  repairCost,
  siegeDamage,
  spreadChance,
} from "../src/game/shared/siege.ts";
import { overSolid } from "../src/game/shared/terrain.ts";
import { FISTS, WEAPON_KINDS, WEAPONS } from "../src/game/shared/weapons.ts";
import { Fires } from "../src/game/server/fire.ts";
import { Room } from "../src/game/server/room.ts";

const root = new URL("../public", import.meta.url);

/* ---------- the rules on their own ---------- */

test("siege: hammers and axes break things, daggers and fists barely mark them, stone resists", () => {
  for (const k of WEAPON_KINDS) assert(WEAPONS[k].siege >= 0, k);
  const blow = (def) => siegeDamage(def, def.charged ?? def.damage, "wood");
  for (const k of ["hammer", "mallet", "axe", "greatsword"]) assert(blow(WEAPONS[k]) >= 20, k);
  assert(blow(WEAPONS.beardaxe) >= 10);
  for (const k of ["daggers", "knuckles"]) assert(blow(WEAPONS[k]) < 0.5, k);
  assert(blow(FISTS) < 1);
  assert(blow(WEAPONS.torch) < 5, "a torch is a poor club");
  assert(WEAPONS.torch.ignites && WEAPONS.bucket.douses);
  /* Stone takes a quarter of what wood does. */
  const hammer = WEAPONS.hammer;
  assert.equal(siegeDamage(hammer, 30, "stone"), siegeDamage(hammer, 30, "wood") * 0.25);
  assert(MELEE_RESIST.stone < MELEE_RESIST.wood);
});

test("only someone else's things can be damaged, and never from creative", () => {
  const plot = { owner: "alicetoken1" };
  assert(canDamageItem({ token: "bobtoken123", creative: false }, plot));
  assert(!canDamageItem({ token: "alicetoken1", creative: false }, plot), "not your own");
  assert(!canDamageItem({ token: "bobtoken123", creative: true }, plot), "not in creative");
  assert(!canDamageItem({ token: null, creative: false }, plot), "not a stranger");
});

test("every item has something to leave behind, drawn from real models", () => {
  for (const id of CATALOGUE_IDS) {
    const d = CATALOGUE[id];
    assert(d.rubble.length > 0, id);
    for (const p of d.rubble) {
      assert(p.model in MODEL_BOUNDS, `${id}: ${p.model}`);
      assert(existsSync(new URL(`models/${p.model}.glb`, `${root}/`)), `${id}: ${p.model}.glb`);
      assert(existsSync(new URL(piecePalette(p, "red").slice(1), `${root}/`)), `${id}: palette`);
    }
  }
  assert.equal(CATALOGUE.trebuchet.rubble[0].model, "castle/siege-trebuchet-demolished");
  assert.equal(
    CATALOGUE.oak.rubble[0].model,
    "forest/tree-bare-2-a",
    "a burnt tree is a bare trunk",
  );
  assert.equal(CATALOGUE.cottage.rubble[0].model, "buildings/destroyed");
  assert(CATALOGUE.castleWall.rubble.every((p) => p.model === "camp/resource-stone-large"));
  assert.equal(lookOf("cottage", 500), "intact");
  assert.equal(lookOf("cottage", 240), "damaged");
  assert.equal(lookOf("cottage", 0), "rubble");
  /* A water barrel for the Defenses shelf, and the well, put out fires. */
  assert.equal(CATALOGUE.waterBarrel.shelf, "defenses");
  assert(CATALOGUE.waterBarrel.douse && CATALOGUE.well.douse);
  assert(CATALOGUE.well.douse.radius > CATALOGUE.waterBarrel.douse.radius);
});

test("mending: nothing for a while after a hit, then steadily, whole in three hours; rubble in six", () => {
  const max = CATALOGUE.cottage.health;
  const p = { id: 1, kind: "cottage", x: 0, y: 0, z: 0, rot: 0, hp: 100, hitAt: 1000 };
  assert.equal(healthAt(p, 1000 + HEAL_WAIT - 1), 100);
  assert.equal(healthAt(p, 1000 + HEAL_WAIT + HEAL_TIME / 2), 100 + max / 2);
  assert.equal(healthAt(p, 1000 + HEAL_WAIT + HEAL_TIME), max);
  assert(Math.abs(HEAL_TIME - 3 * 3600) < 1 && Math.abs(REBUILD_TIME - 6 * 3600) < 1);
  const rubble = { ...p, hp: 0 };
  assert.equal(healthAt(rubble, 1000 + REBUILD_TIME - 1), 0);
  assert.equal(healthAt(rubble, 1000 + REBUILD_TIME), max);
  /* Mending at once costs up to 40% of its price, by what's missing. */
  assert.equal(repairCost("cottage", max), 0);
  assert.equal(repairCost("cottage", max / 2), Math.ceil(450 * 0.4 * 0.5));
  assert.equal(repairCost("cottage", 0), 180);
  assert.equal(repairCost("cottage", max - 0.1), 1);
});

/* ---------- fire, on its own ---------- */

const WEST_TO_EAST = { angle: -Math.PI / 2, strength: 1, speed: 11, x: 11, z: 0 };
const STILL = { angle: 0, strength: 0.15, speed: 4.2, x: 0, z: -4.2 };

test("fire reaches further and catches sooner downwind, and never takes stone", () => {
  const from = { x: 0, z: 0, kind: "stall" };
  const east = { x: 6, z: 0, kind: "stall" };
  const west = { x: -6, z: 0, kind: "stall" };
  const down = spreadChance(from, east, WEST_TO_EAST, 1);
  const up = spreadChance(from, west, WEST_TO_EAST, 1);
  assert(down > up * 5, `downwind ${down.toFixed(3)} against upwind ${up.toFixed(3)}`);
  /* In still air it's even, and falls off with the gap. */
  const a = spreadChance(from, east, { ...STILL, strength: 0 }, 1);
  const b = spreadChance(from, west, { ...STILL, strength: 0 }, 1);
  assert(Math.abs(a - b) < 1e-9);
  assert(spreadChance(from, { x: 3, z: 0, kind: "stall" }, STILL, 1) > a);
  assert.equal(spreadChance(from, { x: 40, z: 0, kind: "stall" }, WEST_TO_EAST, 1), 0);
  assert.equal(spreadChance(from, { x: 3, z: 0, kind: "boulder" }, WEST_TO_EAST, 1), 0);
});

/* A fire on its own, with a seeded dice and a plot of stalls round a burning one. */
function blaze(seed, items) {
  let s = seed;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const caught = [];
  const fires = new Fires({
    rng,
    scorch: (_plot, item, amount) => {
      item.hp = Math.max(0, item.hp - amount);
    },
    changed: (item) => caught.push(item.id),
  });
  const plot = { id: 100, items };
  return { fires, plot, caught };
}

const stall = (id, x, z, kind = "stall") => ({
  id,
  kind,
  x,
  y: 0,
  z,
  rot: 0,
  hp: CATALOGUE[kind].health,
});

test("fire spreads to wood, not stone, biased downwind, burns things down and dies out", () => {
  let downFirst = 0;
  let upFirst = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const items = [stall(1, 0, 0), stall(2, 6, 0), stall(3, -6, 0), stall(4, 0, 4, "boulder")];
    const { fires, plot } = blaze(seed, items);
    const plots = new Map([[100, plot]]);
    assert(fires.ignite(plot, items[0], 0));
    assert(!fires.ignite(plot, items[3], 0), "stone won't light");
    for (let t = 0.5; t <= 30; t += 0.5) {
      fires.step(plots, t, WEST_TO_EAST, 0.5);
      const d = fires.isBurning(2) || items[1].hp < CATALOGUE.stall.health;
      const u = fires.isBurning(3) || items[2].hp < CATALOGUE.stall.health;
      if (d && !u) downFirst++;
      if (u && !d) upFirst++;
      if (d || u) break;
    }
    assert(!fires.isBurning(4) && items[3].hp === CATALOGUE.boulder.health);
  }
  assert(downFirst > upFirst * 4, `downwind first ${downFirst}, upwind first ${upFirst}`);

  /* Left alone, a fire burns things down, and in the end every fire goes out. */
  const items = [stall(1, 0, 0, "bush"), stall(2, 4, 0)];
  const { fires, plot } = blaze(7, items);
  const plots = new Map([[100, plot]]);
  fires.ignite(plot, items[0], 0);
  for (let t = 0.5; t <= 400; t += 0.5) fires.step(plots, t, WEST_TO_EAST, 0.5);
  assert.equal(fires.burning.size, 0);
  assert.equal(items[0].hp, 0, "a bush burns to the ground well inside its fire's life");
});

test("fires are bounded: a plot holds only so many at once", () => {
  const items = Array.from({ length: 60 }, (_, i) =>
    stall(i + 1, (i % 10) * 4, Math.floor(i / 10) * 4),
  );
  const { fires, plot } = blaze(3, items);
  for (const o of items) fires.ignite(plot, o, 0);
  assert.equal(fires.burning.size, FIRE.maxPlot);
});

/* ---------- through the room ---------- */

function joiner(room, name, token) {
  const messages = [];
  const id = room.join({ send: (m) => messages.push(m) }, { name, token, own: true });
  const member = () => room.members.get(id);
  return {
    id,
    messages,
    member,
    last: (t) => messages.findLast((m) => m.t === t),
    all: (t) => messages.filter((m) => m.t === t),
    feed: () => messages.findLast((m) => m.t === "feed")?.text,
    coins: () => member().inv.coins,
    give: (n) => {
      member().inv.coins = n;
    },
    /* Stand at (x, z), facing (tx, tz). */
    stand: (x, z, tx = x, tz = z - 1) => {
      const b = member().body;
      b.x = x;
      b.z = z;
      b.y = room.world.heightAt(x, z);
      b.yaw = Math.atan2(-(tx - x), -(tz - z));
    },
  };
}

/* Alice has an isle with things on it; Bob and Alice are both about. The clock is ours to turn. */
function raid() {
  const clock = { now: 1000 };
  const room = new Room({ online: true, grand: true, now: () => clock.now });
  const a = joiner(room, "alice", "alicetoken1");
  const b = joiner(room, "bob", "bobtoken123");
  a.give(50000);
  b.give(50000);
  room.handle(a.id, { t: "buyplot", size: "isle", shape: "round", x: 0, z: 700 });
  const pa = room.plots.get(a.last("island").info.id);
  /* Past its starter shield. */
  delete pa.shield;
  const t = room.world.islands.get(pa.id).terrain;
  /* Each thing on a spot of its own round the Hearth, as Alice would set it down. */
  const put = (kind, angle, d = 22) => {
    for (let r = d; r < d + 40; r += 1) {
      const x = Math.round(t.ox + Math.cos(angle) * r);
      const z = Math.round(t.oz + Math.sin(angle) * r);
      if (!checkItem(t, pa.items, kind, x, z, 0).ok) continue;
      a.stand(x + 6, z);
      room.handle(a.id, { t: "place", kind, x, z, rot: 0 });
      const item = pa.items.at(-1);
      assert.equal(item.kind, kind);
      return item;
    }
    throw new Error(`no room for a ${kind}`);
  };
  const tick = (seconds = 0.05) => {
    for (let s = 0; s < seconds; s += 0.05) {
      clock.now += 0.05;
      room.tick();
    }
  };
  /* Stand just off its east side, facing it, and swing. */
  const swing = (who, item, charge = 0) => {
    const d = CATALOGUE[item.kind];
    who.stand(item.x + d.hx + 1, item.z, item.x, item.z);
    clock.now += 2;
    room.handle(who.id, { t: "attack", charge });
    tick(0.5);
  };
  return { clock, room, a, b, pa, t, put, tick, swing };
}

test("a blow on someone else's things takes health by weapon and material; your own are safe", () => {
  const { room, a, b, put, swing } = raid();
  const cottage = put("cottage", 0);
  const wall = put("castleWall", Math.PI);
  room.handle(b.id, { t: "arm", kind: "hammer" });
  swing(b, cottage, 0.6);
  assert.equal(cottage.hp, 500 - 45, "a warhammer: 30 × 1.5 on wood");
  const sent = b.last("ihit");
  assert.equal(sent.id, cottage.id);
  assert.equal(sent.damage, 45);
  const change = b.last("items").c;
  assert.deepEqual(change.slice(0, 2), [cottage.id, 455]);
  swing(b, wall, 0.6);
  assert.equal(wall.hp, 1500 - 45 * 0.25, "stone takes a quarter");
  /* Daggers hardly scratch it. */
  room.handle(b.id, { t: "arm", kind: "daggers" });
  swing(b, cottage);
  assert(cottage.hp > 455 - 0.5);
  /* Alice can swing at her own all she likes. */
  room.handle(a.id, { t: "arm", kind: "hammer" });
  const before = cottage.hp;
  swing(a, cottage, 0.6);
  assert.equal(cottage.hp, before);
  assert.equal(a.last("ihit").damage, 0, "the blow lands, but does nothing");
});

test("the Hearth can't be battered: nothing on the plot is touched", () => {
  const { room, b, pa, t, swing, put } = raid();
  const cottage = put("cottage", 0);
  room.handle(b.id, { t: "arm", kind: "hammer" });
  const hearth = { id: -1, kind: "well", x: t.hearth.x, y: t.hearth.y, z: t.hearth.z, rot: 0 };
  const sent = b.all("ihit").length;
  swing(b, hearth, 0.6);
  assert.equal(b.all("ihit").length, sent, "nothing there to hit");
  assert.equal(cottage.hp, 500);
  assert(pa.items.every((o) => o.hp === CATALOGUE[o.kind].health));
  assert(
    room.world.solidsNear(t.hearth.x, t.hearth.z).some((s) => s.r >= 2),
    "still standing",
  );
});

test("knocked down, it's rubble: no longer solid, so a wall opens a gap; it can't be moved, only cleared", () => {
  const { room, a, b, pa, put, swing } = raid();
  const wall = put("palisade", 0);
  const solid = () =>
    room.world.solidsNear(wall.x, wall.z).some((s) => overSolid(s, wall.x, wall.z));
  assert(solid());
  room.handle(b.id, { t: "arm", kind: "hammer" });
  for (let i = 0; i < 6 && wall.hp > 0; i++) swing(b, wall, 0.6);
  assert.equal(wall.hp, 0);
  assert(!solid(), "a way through");
  assert(pa.items.includes(wall), "the rubble stays on the plot");
  assert.match(a.feed(), /knocked down/);
  const sent = b.last("items").c;
  assert.deepEqual(sent.slice(0, 3), [wall.id, 0, 0]);
  /* No more blows land on it. */
  const hits = b.all("ihit").length;
  swing(b, wall, 0.6);
  assert.equal(b.all("ihit").length, hits);
  /* Alice can't move it, and clearing it pays nothing. */
  a.stand(wall.x + 4, wall.z);
  room.handle(a.id, {
    t: "place",
    kind: "palisade",
    x: wall.x,
    z: wall.z + 8,
    rot: 0,
    move: wall.id,
  });
  assert.match(a.feed(), /Rubble can't be moved/);
  const coins = a.coins();
  room.handle(a.id, { t: "sell", id: wall.id });
  assert.equal(a.coins(), coins);
  assert(!pa.items.includes(wall));
});

test("a torch sets wood alight, not stone; the fire burns it, and a water barrel nearby puts it out", () => {
  const { room, b, pa, put, swing, tick } = raid();
  const cottage = put("cottage", 0);
  const wall = put("castleWall", Math.PI);
  room.handle(b.id, { t: "arm", kind: "torch" });
  swing(b, wall);
  assert(!room.fires.isBurning(wall.id));
  assert.match(b.feed(), /Stone won't burn/);
  swing(b, cottage);
  assert(room.fires.isBurning(cottage.id));
  assert(b.last("items").c.some((v, i, c) => i % 3 === 0 && v === cottage.id && c[i + 2] & 1));
  const hp = cottage.hp;
  tick(5);
  assert(cottage.hp < hp - 30, "it burns");

  /* A barrel by the stall: the next fire there is out in a few seconds, and the barrel's down a charge. */
  const barrel = put("waterBarrel", 0, 32);
  assert(Math.hypot(barrel.x - cottage.x, barrel.z - cottage.z) < 15);
  tick(FIRE.douseDelay + 1);
  assert(!room.fires.isBurning(cottage.id), "doused");
  const doused = b
    .all("items")
    .flatMap((m) => m.c.filter((v, i, c) => i % 3 === 0 && v === cottage.id && c[i + 2] & 4));
  assert.equal(doused.length, 1, "everyone hears it hiss");
  assert.equal(room.fires.charges(barrel, room.now()), 2);
  /* Soaked, it won't catch again straight away. */
  swing(b, cottage);
  assert(!room.fires.isBurning(cottage.id));
  void pa;
});

test("a bucket comes empty, fills in the sea, and douses whatever's burning in front of you", () => {
  const { room, a, b, pa, put, swing, tick } = raid();
  const cottage = put("cottage", 0);
  room.handle(b.id, { t: "arm", kind: "torch" });
  swing(b, cottage);
  assert(room.fires.isBurning(cottage.id));
  room.handle(a.id, { t: "arm", kind: "bucket" });
  swing(a, cottage);
  assert.match(a.feed(), /bucket is empty/);
  assert(room.fires.isBurning(cottage.id));
  /* Down to the sea and back. */
  const t = room.world.islands.get(pa.id).terrain;
  const m = a.member();
  m.body.x = t.ox + 120;
  m.body.z = t.oz;
  m.body.y = -0.6;
  tick(0.1);
  assert(m.water);
  assert.match(a.feed(), /bucket is full/);
  assert.equal(a.last("snap").me.water, true);
  swing(a, cottage);
  assert(!room.fires.isBurning(cottage.id), "doused");
  assert.equal(m.water, false);
});

test("health mends across a save and a restart, rubble stands up again, solid", () => {
  const { clock, room, a, b, pa, put, swing } = raid();
  const cottage = put("cottage", 0);
  const wall = put("palisade", Math.PI);
  room.handle(b.id, { t: "arm", kind: "hammer" });
  for (let i = 0; i < 6; i++) swing(b, cottage, 0.6);
  for (let i = 0; i < 6 && wall.hp > 0; i++) swing(b, wall, 0.6);
  assert.equal(cottage.hp, 500 - 6 * 45);
  assert.equal(wall.hp, 0);
  const hitAt = cottage.hitAt;
  room.leave(a.id);
  room.leave(b.id);
  const save = parseWorldSave(JSON.parse(JSON.stringify(room.exportWorld())));
  assert.equal(save.v, WORLD_SAVE_VERSION);
  const plot = save.plots.find((p) => p.id === pa.id);
  const saved = plot.items.find((o) => o.id === cottage.id);
  assert.deepEqual([saved.hp, saved.hitAt], [230, hitAt]);
  assert.equal(plot.items.find((o) => o.id === wall.id).hp, 0);

  /* An hour and a half later (and the wait): half of it back. */
  const later = { now: hitAt + HEAL_WAIT + HEAL_TIME / 2 };
  const again = new Room({ online: true, grand: true, now: () => later.now, world: save });
  const back = joiner(again, "alice", "alicetoken1");
  const sent = back.last("world").items.find(([id]) => id === pa.id)[1];
  assert.equal(sent.find((s) => s[0] === cottage.id)[6], 480);
  const solid = () =>
    again.world.solidsNear(wall.x, wall.z).some((s) => overSolid(s, wall.x, wall.z));
  assert(!solid(), "rubble is still rubble");
  /* Six hours on, everything's whole, and the wall is solid again. */
  later.now = clock.now + REBUILD_TIME + 60;
  for (let i = 0; i < 220; i++) {
    later.now += 0.05;
    again.tick();
  }
  const p = again.plots.get(pa.id);
  assert(p.items.every((o) => o.hp === CATALOGUE[o.kind].health && o.hitAt === undefined));
  assert(solid());
  assert(back.last("items").c.includes(wall.id));
});

test("the owner can pay to mend at once, rubble included; nobody else can, nor while it burns", () => {
  const { room, a, b, put, swing } = raid();
  const cottage = put("cottage", 0);
  const wall = put("palisade", Math.PI);
  room.handle(b.id, { t: "arm", kind: "hammer" });
  for (let i = 0; i < 6; i++) swing(b, cottage, 0.6);
  for (let i = 0; i < 6 && wall.hp > 0; i++) swing(b, wall, 0.6);
  /* Bob can't mend it for her. */
  room.handle(b.id, { t: "repair", id: cottage.id });
  assert.match(b.feed(), /not yours/);
  a.stand(cottage.x + 6, cottage.z);
  a.give(10);
  room.handle(a.id, { t: "repair", id: cottage.id });
  assert.match(a.feed(), /costs 98 coins/);
  a.give(1000);
  room.handle(a.id, { t: "repair", id: cottage.id });
  assert.equal(a.coins(), 1000 - repairCost("cottage", 230));
  assert.equal(cottage.hp, 500);
  assert.equal(cottage.hitAt, undefined);
  room.handle(a.id, { t: "repair", id: cottage.id });
  assert.match(a.feed(), /as good as new/);
  /* The rubble stands up whole, and solid. */
  a.stand(wall.x + 6, wall.z);
  room.handle(a.id, { t: "repair", id: wall.id });
  assert.equal(a.coins(), 1000 - 98 - Math.ceil(CATALOGUE.palisade.price * 0.4));
  assert.equal(wall.hp, CATALOGUE.palisade.health);
  assert(room.world.solidsNear(wall.x, wall.z).some((s) => overSolid(s, wall.x, wall.z)));
  /* Not while it's burning. */
  room.handle(b.id, { t: "arm", kind: "torch" });
  swing(b, cottage);
  a.stand(cottage.x + 6, cottage.z);
  room.handle(a.id, { t: "repair", id: cottage.id });
  assert.match(a.feed(), /fire out first/);
});

test("things saved hurt without a time mend from long ago; health and charring survive a save", () => {
  const players = [{ token: "aaaaaaaa", name: "a", saved: null }];
  const plot = { id: 100, size: "cove", shape: "round", seed: 7, x: 0, z: 700, owner: "aaaaaaaa" };
  const item = { id: 5, kind: "cottage", x: 10, y: 2, z: 710, rot: 0, hp: 500 };
  const v5 = parseWorldSave({
    v: WORLD_SAVE_VERSION,
    ids: { tool: 1, plot: 101, item: 6 },
    players,
    plots: [{ ...plot, items: [item, { ...item, id: 6, hp: 120 }] }],
  });
  assert.deepEqual(v5.plots[0].items[0], item);
  assert.equal(v5.plots[0].items[1].hitAt, 0, "mending since long ago");
  assert.equal(healthAt(v5.plots[0].items[1], 1e9), 500);
  const v6 = parseWorldSave({
    v: WORLD_SAVE_VERSION,
    ids: { tool: 1, plot: 101, item: 7 },
    players,
    plots: [{ ...plot, items: [{ ...item, hp: 0, hitAt: 12345, burnt: true }] }],
  });
  assert.deepEqual(v6.plots[0].items[0], { ...item, hp: 0, hitAt: 12345, burnt: true });
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: "repair", id: 4 })), { t: "repair", id: 4 });
  assert.equal(parseClientMsg(JSON.stringify({ t: "repair", id: "x" })), null);
});
