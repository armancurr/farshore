import assert from "node:assert/strict";
import { test } from "node:test";
import { Archipelago } from "../src/game/shared/archipelago.ts";
import { SEA_FLOOR } from "../src/game/shared/constants.ts";
import { PLOT_SHAPE_IDS, WORLD } from "../src/game/shared/islands.ts";
import {
  checkPlotSpot,
  flatness,
  PLOT_ID_BASE,
  PLOT_SIZE_IDS,
  PLOT_SIZES,
  plotIsland,
} from "../src/game/shared/plots.ts";
import { parseClientMsg } from "../src/game/shared/protocol.ts";
import { parseWorldSave, WORLD_SAVE_VERSION } from "../src/game/shared/save.ts";
import { Terrain } from "../src/game/shared/terrain.ts";
import { Room } from "../src/game/server/room.ts";

const plot = (size, shape, seed, x = 0, z = 700, id = PLOT_ID_BASE) =>
  plotIsland({ id, size, shape, seed, x, z }, "owner");

/* ---------- the land itself ---------- */

test("every plot shape at every size is at least three quarters buildable, over several seeds", () => {
  for (const size of PLOT_SIZE_IDS)
    for (const shape of PLOT_SHAPE_IDS)
      for (const seed of [1, 77, 4242, 900001, 31337]) {
        const t = new Terrain(plot(size, shape, seed));
        const f = flatness(t);
        const label = `${size} ${shape} ${seed}`;
        assert(f.flat >= 0.75, `${label}: ${(f.flat * 100).toFixed(1)}% flat`);
        /* Real land, a few metres up, that doesn't reach the tile's edge. */
        assert(f.area > PLOT_SIZES[size].size ** 2 * 0.12, `${label}: land`);
        let top = -Infinity;
        for (const h of t.heights) top = Math.max(top, h);
        assert(top > 1.5 && top < 6, `${label}: top at ${top.toFixed(2)} m`);
        const g = t.grid;
        for (let i = 0; i < g; i++)
          for (const k of [i, i * g, i * g + g - 1, (g - 1) * g + i])
            assert(t.heights[k] < SEA_FLOOR + 1, `${label}: deep water at the tile's edge`);
        /* Bare: the Hearth in the middle, no trees, a few stones at most. */
        assert(t.hearth, `${label}: a Hearth`);
        assert(Math.hypot(t.hearth.x - t.ox, t.hearth.z - t.oz) < 1, `${label}: in the middle`);
        assert(!t.props.some((p) => p.kind === "tree"), `${label}: no trees`);
        assert(t.props.filter((p) => p.kind === "rock").length <= 4, `${label}: a few rocks`);
        assert(t.structures.length === 1 && t.structures[0].kind === "hearth");
        /* No roads and no pier: it's bare land, for its owner to build on. */
        assert.equal(t.paths.length, 0, `${label}: no roads`);
        assert.equal(t.berths.length, 0, `${label}: no berths`);
        assert.deepEqual(
          t.places.map((pl) => pl.kind),
          ["hearth"],
          `${label}: only the Hearth`,
        );
        /* You wake on dry, level ground in front of it. */
        assert(t.home.y > 1 && t.normalAt(t.home.x, t.home.z)[1] > 0.97, `${label}: home`);
      }
});

test("the Hearth is solid: you can stand on its plinth, and not walk through it", () => {
  const t = new Terrain(plot("isle", "round", 5));
  const h = t.hearth;
  const ground = t.heightAt(h.x, h.z);
  assert(t.groundAt(h.x, h.z, ground + 1.2).onSolid, "the plinth's top is standable");
  assert(t.solidsNear(h.x, h.z).some((s) => s.top >= h.y - 0.01 && s.r >= 2));
});

/* ---------- where a plot may go ---------- */

test("a plot needs open sea: never on or by the Harbor or a hunting island, or another plot", () => {
  const world = new Archipelago(WORLD);
  const check = (size, x, z, ignore) => checkPlotSpot(world.islands.values(), size, x, z, ignore);
  assert.equal(check("cove", 0, 0).ok, false, "on the Harbor");
  assert.match(check("cove", 0, 0).reason, /Harbor/);
  assert.equal(check("cove", 0, 540).ok, false, "overlapping the Harbor's tile");
  assert.equal(check("cove", 0, -1800).ok, false, "on Fernmeadow");
  assert.match(check("holm", 0, -1200).reason, /Fernmeadow/);
  assert.equal(check("reach", 2700, 0).ok, false, "off the edge of the map");
  assert.match(check("reach", 2700, 0).reason, /edge/);
  assert.deepEqual(check("cove", 0, 700), { ok: true });

  /* Another plot keeps PLOT_GAP of sea round its coast, tiles apart or not. */
  world.add(plot("cove", "round", 9, 0, 700));
  const near = check("cove", 0, 900);
  assert.equal(near.ok, false);
  assert.match(near.reason, /150 m of sea/);
  assert.equal(check("cove", 0, 760).ok, false, "overlapping its tile");
  assert.deepEqual(check("cove", 0, 1000), { ok: true });
  /* The roads' bookkeeping takes a plot in its stride: no berths of its own, the piers' kept. */
  const berths = world.berths.length;
  assert(berths > 0, "the authored islands have their piers");
  world.add(plot("holm", "long", 3, 0, 1100, PLOT_ID_BASE + 1));
  assert.equal(world.berths.length, berths);
  world.remove(PLOT_ID_BASE + 1);
  assert.equal(world.berths.length, berths);
  /* Growing in place ignores itself. */
  assert.deepEqual(check("isle", 0, 700, PLOT_ID_BASE), { ok: true });
});

test("clients can only ask for real sizes and shapes", () => {
  const msg = (o) => parseClientMsg(JSON.stringify(o));
  assert.deepEqual(msg({ t: "buyplot", size: "isle", shape: "oval", x: 10, z: -20 }), {
    t: "buyplot",
    size: "isle",
    shape: "oval",
    x: 10,
    z: -20,
  });
  assert.equal(msg({ t: "buyplot", size: "huge", shape: "oval", x: 0, z: 0 }), null);
  assert.equal(msg({ t: "buyplot", size: "isle", shape: "spire", x: 0, z: 0 }), null);
  assert.equal(msg({ t: "buyplot", size: "isle", shape: "round", x: 1e9, z: 0 }), null);
  assert.deepEqual(msg({ t: "growplot", size: "reach" }), { t: "growplot", size: "reach" });
  assert.equal(msg({ t: "growplot", size: 3 }), null);
});

/* ---------- buying through the room ---------- */

function joiner(room, name, token) {
  const messages = [];
  const id = room.join({ send: (m) => messages.push(m) }, { name, token, own: true });
  return {
    id,
    messages,
    last: (t) => messages.findLast((m) => m.t === t),
    feed: () => messages.findLast((m) => m.t === "feed")?.text,
    coins: () => room.members.get(id).inv.coins,
    give: (n) => {
      room.members.get(id).inv.coins = n;
    },
  };
}

const buy = (size, shape, x, z) => ({ t: "buyplot", size, shape, x, z });

test("buying land: coins are taken, everyone sees it, it's yours, and you only get one", () => {
  const now = 100;
  const room = new Room({ online: true, grand: true, now: () => now });
  const a = joiner(room, "alice", "alicetoken1");
  const b = joiner(room, "bob", "bobtoken123");
  a.give(1000);
  room.handle(a.id, buy("cove", "oval", 0, 700));
  room.tick();
  assert.equal(a.coins(), 400);
  assert.equal(a.last("inv").inv.coins, 400);
  const mine = a.last("island").info;
  assert.equal(mine.plot.mine, true);
  assert.equal(mine.plot.owner, "alice");
  assert.equal(mine.name, "alice's Cove");
  assert.equal(mine.shape, "oval");
  assert.deepEqual([mine.x, mine.z, mine.size], [0, 700, 160]);
  /* Bob sees whose it is, not that it's his; and never anyone's token. */
  const theirs = b.last("island").info;
  assert.equal(theirs.plot.mine, false);
  assert.equal(theirs.plot.owner, "alice");
  assert(!JSON.stringify(b.messages).includes("alicetoken1"));
  /* The land is real ground now. */
  assert(room.world.heightAt(0, 700) > 1);

  /* One plot each. */
  room.handle(a.id, buy("cove", "round", 0, 1100));
  assert.equal(a.coins(), 400);
  assert.match(a.feed(), /already own/);

  /* Not enough coins, then a spot that's too close to Alice's. */
  b.give(500);
  room.handle(b.id, buy("cove", "round", 0, 1100));
  assert.equal(b.coins(), 500);
  assert.match(b.feed(), /costs 600/);
  b.give(5000);
  room.handle(b.id, buy("cove", "round", 0, 880));
  assert.equal(b.coins(), 5000);
  assert.match(b.feed(), /150 m of sea/);
  room.handle(b.id, buy("isle", "long", 0, 1100));
  assert.equal(b.coins(), 2500);
  assert.equal(b.last("island").info.plot.mine, true);
  assert.equal(a.last("island").info.plot.owner, "bob");

  /* Knocked out, you wake at your own Hearth. */
  const terrain = room.world.islands.get(mine.id).terrain;
  room.respawn(room.members.get(a.id));
  const woke = a.last("respawn");
  assert(Math.hypot(woke.x - terrain.hearth.x, woke.z - terrain.hearth.z) < 10);
  assert(terrain.contains(woke.x, woke.z));
  room.leave(a.id);
  room.leave(b.id);
});

test("growing your land: same spot and shape, bigger, for the difference", () => {
  const room = new Room({ online: true, grand: true, now: () => 100 });
  const a = joiner(room, "alice", "alicetoken1");
  a.give(10000);
  room.handle(a.id, buy("cove", "long", 0, 700));
  const before = a.last("island").info;
  room.handle(a.id, { t: "growplot", size: "cove" });
  assert.match(a.feed(), /already that big/);
  room.handle(a.id, { t: "growplot", size: "isle" });
  assert.equal(a.coins(), 10000 - 600 - 1900);
  const after = a.last("island").info;
  assert.deepEqual(
    [after.id, after.x, after.z, after.seed, after.shape, after.size],
    [before.id, before.x, before.z, before.seed, before.shape, 240],
  );
  assert.equal(after.plot.size, "isle");
  assert.equal(room.world.islands.get(after.id).terrain.size, 240);
  assert.equal(room.world.list().filter((o) => o.plot).length, 1);
  /* Not enough for a reach. */
  room.handle(a.id, { t: "growplot", size: "reach" });
  assert.equal(a.coins(), 7500);
  assert.match(a.feed(), /costs 22500/);
  room.leave(a.id);
});

test("growing needs room: a neighbour's plot in the way stops it", () => {
  const room = new Room({ online: true, grand: true, now: () => 100 });
  const a = joiner(room, "alice", "alicetoken1");
  const b = joiner(room, "bob", "bobtoken123");
  a.give(30000);
  b.give(30000);
  room.handle(a.id, buy("cove", "round", 0, 700));
  room.handle(b.id, buy("cove", "round", 0, 1000));
  room.handle(a.id, { t: "growplot", size: "holm" });
  assert.match(a.feed(), /No room to grow/);
  assert.equal(a.coins(), 30000 - 600);
});

/* ---------- keeping it ---------- */

test("plots are kept in the save and come back where they were, with their owners", () => {
  const room = new Room({ online: true, grand: true, now: () => 100 });
  const a = joiner(room, "alice", "alicetoken1");
  a.give(3000);
  room.handle(a.id, buy("isle", "round", -2200, 2300));
  const bought = a.last("island").info;
  room.leave(a.id);
  const saved = JSON.parse(JSON.stringify(room.exportWorld()));
  assert.equal(saved.v, WORLD_SAVE_VERSION);
  assert.equal(saved.plots.length, 1);
  const world = parseWorldSave(saved);
  assert.deepEqual(world.plots, saved.plots);
  assert(world.ids.plot > bought.id);

  assert.equal(world.players[0].saved.inv.coins, 500);
  /* Back after a restart, from nowhere in particular: you wake at your Hearth. */
  world.players[0].saved = null;
  const again = new Room({ online: true, grand: true, now: () => 100, world });
  const back = joiner(again, "alice", "alicetoken1");
  const info = back.last("world").islands.find((o) => o.id === bought.id);
  assert(info, "the plot is on the map");
  assert.deepEqual(
    [info.seed, info.x, info.z, info.shape, info.size],
    [bought.seed, bought.x, bought.z, bought.shape, bought.size],
  );
  assert.equal(info.plot.mine, true);
  const you = back.last("world").you;
  const terrain = again.world.islands.get(bought.id).terrain;
  assert(terrain.contains(you.x, you.z), "woke on your own land");
  assert(Math.hypot(you.x - terrain.hearth.x, you.z - terrain.hearth.z) < 10);
  /* Someone else sees it as hers. */
  const other = joiner(again, "carol", "caroltoken1");
  const seen = other.last("world").islands.find((o) => o.id === bought.id);
  assert.equal(seen.plot.mine, false);
  assert.equal(seen.plot.owner, "alice");
  /* And still only one each. */
  back.give(30000);
  again.handle(back.id, buy("cove", "round", 0, 700));
  assert.match(back.feed(), /already own/);
});

test("saves from before land was sold load as they were, with no plots", () => {
  const inv = { coins: 50, slot: 0, items: {}, tools: [], hotbar: [] };
  const save = parseWorldSave({
    v: 4,
    ids: { tool: 4 },
    players: [
      { token: "aaaaaaaa", name: "a", saved: { x: 5, y: 1, z: 6, yaw: 0, health: 80, inv } },
    ],
  });
  assert.equal(save.v, WORLD_SAVE_VERSION);
  assert.deepEqual(save.plots, []);
  assert.equal(save.ids.plot, PLOT_ID_BASE);
  /* The islands didn't change: you come back where you were. */
  assert.equal(save.players[0].saved.relocate, false);
  assert.equal(save.players[0].saved.x, 5);
  const room = new Room({ online: true, grand: true, now: () => 100, world: save });
  assert.equal(room.world.list().filter((o) => o.plot).length, 0);
  /* From before the roads were cut, everyone wakes on the Harbor instead. */
  const older = parseWorldSave({
    v: 3,
    ids: { tool: 4 },
    players: [
      { token: "aaaaaaaa", name: "a", saved: { x: 5, y: 1, z: 6, yaw: 0, health: 80, inv } },
    ],
  });
  assert.equal(older.players[0].saved.relocate, true);
  assert.deepEqual(older.plots, []);
  /* Anything newer than this build knows is nothing saved, not a crash. */
  assert.equal(parseWorldSave({ v: WORLD_SAVE_VERSION + 3, ids: {}, players: [] }), null);
});

test("a damaged plot in a save is dropped, not fatal", () => {
  const players = [
    { token: "aaaaaaaa", name: "a", saved: null },
    { token: "bbbbbbbb", name: "b", saved: null },
  ];
  const good = { id: 100, size: "cove", shape: "round", seed: 7, x: 0, z: 700, owner: "aaaaaaaa" };
  const save = parseWorldSave({
    v: WORLD_SAVE_VERSION,
    ids: { tool: 1, plot: 101 },
    players,
    plots: [
      good,
      { ...good, id: 101, owner: "nobody12" },
      { ...good, id: 102, size: "huge", owner: "bbbbbbbb" },
      { ...good, id: 103, x: 9e9, owner: "bbbbbbbb" },
      { ...good, id: 104 },
    ],
  });
  assert.deepEqual(save.plots, [{ ...good, items: [] }]);
});
