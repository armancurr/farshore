import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import {
  CATALOGUE,
  CATALOGUE_IDS,
  packItem,
  piecePalette,
  resale,
  SHELF_IDS,
  TEAMS,
  unpackItem,
} from "../src/game/shared/catalogue.ts";
import { MODEL_BOUNDS } from "../src/game/shared/models.gen.ts";
import {
  checkItem,
  itemSolids,
  PLACE_REACH,
  snapItem,
  wallEnds,
} from "../src/game/shared/placing.ts";
import { PLOT_SIZES, plotTeam } from "../src/game/shared/plots.ts";
import { parseClientMsg } from "../src/game/shared/protocol.ts";
import { parseWorldSave, WORLD_SAVE_VERSION } from "../src/game/shared/save.ts";
import { overSolid } from "../src/game/shared/terrain.ts";
import { Room } from "../src/game/server/room.ts";

const root = new URL("../public", import.meta.url);

/* ---------- the catalogue itself ---------- */

test("every item draws real models, has a footprint, a price, health and a shelf", () => {
  assert(CATALOGUE_IDS.length >= 35 && CATALOGUE_IDS.length <= 55, `${CATALOGUE_IDS.length} items`);
  for (const id of CATALOGUE_IDS) {
    const d = CATALOGUE[id];
    assert(SHELF_IDS.includes(d.shelf), `${id}: shelf`);
    assert(d.price > 0 && Number.isInteger(d.price), `${id}: price`);
    assert(d.health > 0, `${id}: health`);
    assert(d.material === "wood" || d.material === "stone", `${id}: material`);
    assert(d.hx > 0.1 && d.hz > 0.1 && d.top > 0.3, `${id}: footprint`);
    assert(d.note.length > 5, `${id}: note`);
    for (const p of d.pieces) {
      assert(p.model in MODEL_BOUNDS, `${id}: ${p.model} has bounds`);
      assert(existsSync(new URL(`models/${p.model}.glb`, `${root}/`)), `${id}: ${p.model}.glb`);
      for (const team of TEAMS)
        assert(existsSync(new URL(piecePalette(p, team).slice(1), `${root}/`)), `${id}: palette`);
    }
  }
  for (const shelf of SHELF_IDS)
    assert(CATALOGUE_IDS.filter((id) => CATALOGUE[id].shelf === shelf).length >= 4, shelf);
  /* Walls block, gates let you through the middle. */
  const gate = CATALOGUE.castleGate;
  assert(gate.wall && gate.colliders.length >= 2);
  const solids = itemSolids({ id: 1, kind: "castleGate", x: 0, y: 0, z: 0, rot: 0, hp: 1 });
  assert(!solids.some((s) => overSolid(s, 0, 0) && s.bottom < 1.8), "the gateway is open");
  const wall = itemSolids({ id: 2, kind: "castleWall", x: 0, y: 0, z: 0, rot: 0, hp: 1 });
  assert(
    wall.some((s) => overSolid(s, 0, 0)),
    "a wall is solid",
  );
  assert.equal(resale("keep"), 900);
});

test("items go over the wire and back", () => {
  const p = { id: 7, kind: "cottage", x: 1.5, y: 2.25, z: -3, rot: 0.785, hp: 500 };
  assert.deepEqual(unpackItem(packItem(p)), p);
  const msg = (o) => parseClientMsg(JSON.stringify(o));
  assert.deepEqual(msg({ t: "place", kind: "cottage", x: 1, z: 2, rot: 0.5 }), {
    t: "place",
    kind: "cottage",
    x: 1,
    z: 2,
    rot: 0.5,
  });
  assert.equal(msg({ t: "place", kind: "spaceship", x: 1, z: 2, rot: 0 }), null);
  assert.equal(msg({ t: "place", kind: "cottage", x: 1, z: 2, rot: "a" }), null);
  assert.deepEqual(msg({ t: "sell", id: 3 }), { t: "sell", id: 3 });
  assert.equal(msg({ t: "sell", id: -1 }), null);
});

/* ---------- placing, on a stand-in plot ---------- */

/* A flat plot 100 m a side: dry inside 40 m of its middle (the last 5 m a low beach), sea beyond. */
const flat = {
  ox: 0,
  oz: 0,
  half: 50,
  hearth: { x: 0, y: 2, z: 0 },
  heightAt: (x, z) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    return d < 35 ? 2 : d < 40 ? 0.5 : -3;
  },
};

test("placement: on dry, level ground of your plot, clear of the Hearth and everything else", () => {
  const ok = checkItem(flat, [], "cottage", 15, 0, 0);
  assert(ok.ok, ok.reason);
  assert(Math.abs(ok.y - 1.95) < 1e-9);
  assert.match(checkItem(flat, [], "cottage", 46, 0, 0).reason, /water|Off/);
  assert.match(checkItem(flat, [], "cottage", 55, 0, 0).reason, /Off your land/);
  assert.match(checkItem(flat, [], "cottage", 3, 0, 0).reason, /Hearth/);
  const there = [{ id: 1, kind: "cottage", x: 15, y: 2, z: 0, rot: 0, hp: 1 }];
  assert.match(checkItem(flat, there, "house", 17, 1, 0.3).reason, /cottage/);
  /* Moving it a little is fine: it's out of its own way. */
  assert(checkItem(flat, there, "cottage", 16, 0, 0, 1).ok);
  const steep = { ...flat, heightAt: (x) => 2 + x * 0.3 };
  assert.match(checkItem(steep, [], "keep", 20, 0, 0).reason, /uneven/);
  /* A jetty: its back on the beach, out over the shallows. */
  const out = checkItem(flat, [], "jetty", 41.5, 0, Math.PI / 2);
  assert(out.ok, out.reason);
  assert.match(checkItem(flat, [], "jetty", 20, 0, 0).reason, /over the water/);
});

test("walls snap end to end and may meet at a corner; posts snap onto their ends", () => {
  const d = CATALOGUE.castleWall;
  const a = { id: 1, kind: "castleWall", x: 20, y: 2, z: 10, rot: 0, hp: 1 };
  const [, end] = wallEnds(d, a.x, a.z, a.rot);
  /* Near the end, turned a little: a straight continuation. */
  const s = snapItem([a], "castleWall", end.x + d.hx + 0.7, end.z + 0.4, 0.05, false);
  assert(s.snapped);
  assert(Math.abs(s.x - (end.x + d.hx)) < 1e-9 && Math.abs(s.z - end.z) < 1e-9 && s.rot === 0);
  assert(checkItem(flat, [a], "castleWall", s.x, s.z, s.rot).ok);
  /* Turned a quarter: a corner, its end on the same point. */
  const c = snapItem([a], "castleWall", end.x + 0.3, end.z - d.hx, Math.PI / 2, false);
  assert(c.snapped);
  const [e0, e1] = wallEnds(d, c.x, c.z, c.rot);
  assert(
    Math.min(Math.hypot(e0.x - end.x, e0.z - end.z), Math.hypot(e1.x - end.x, e1.z - end.z)) < 1e-6,
  );
  assert(checkItem(flat, [a], "castleWall", c.x, c.z, c.rot).ok, "corners may touch");
  /* Laid over the first: no. */
  assert.match(checkItem(flat, [a], "castleWall", a.x + 1, a.z, 0).reason, /castle wall/);
  /* A corner post sits on the end. */
  const p = snapItem([a], "corner", end.x + 0.8, end.z - 0.5, 0.2, false);
  assert(p.snapped && Math.hypot(p.x - end.x, p.z - end.z) < 1e-9);
  assert(checkItem(flat, [a], "corner", p.x, p.z, p.rot).ok);
  /* Anything else sits on the grid and turns in 15° steps. */
  const g = snapItem([a], "cottage", 10.26, -4.9, 0.3, false);
  assert.deepEqual([g.x, g.z, g.snapped], [10.5, -5, false]);
  assert(Math.abs(g.rot - Math.PI / 12) < 1e-9);
});

/* ---------- through the room ---------- */

function joiner(room, name, token) {
  const messages = [];
  const id = room.join({ send: (m) => messages.push(m) }, { name, token, own: true });
  const member = () => room.members.get(id);
  return {
    id,
    messages,
    last: (t) => messages.findLast((m) => m.t === t),
    feed: () => messages.findLast((m) => m.t === "feed")?.text,
    coins: () => member().inv.coins,
    give: (n) => {
      member().inv.coins = n;
    },
    goTo: (x, z) => {
      const b = member().body;
      b.x = x;
      b.z = z;
      b.y = room.world.heightAt(x, z);
    },
  };
}

/* A spot on a plot's land, clear of the Hearth, that the check allows for `kind`. */
function spotFor(room, plot, kind, from = 12) {
  const t = room.world.islands.get(plot.id).terrain;
  for (let d = from; d < 60; d += 1.5)
    for (let a = 0; a < Math.PI * 2; a += 0.4) {
      const x = Math.round(t.ox + Math.cos(a) * d);
      const z = Math.round(t.oz + Math.sin(a) * d);
      if (checkItem(t, plot.items ?? [], kind, x, z, 0).ok) return { x, z };
    }
  throw new Error("no spot");
}

function landed() {
  const room = new Room({ online: true, grand: true, now: () => 100 });
  const a = joiner(room, "alice", "alicetoken1");
  const b = joiner(room, "bob", "bobtoken123");
  a.give(50000);
  b.give(50000);
  room.handle(a.id, { t: "buyplot", size: "isle", shape: "round", x: 0, z: 700 });
  room.handle(b.id, { t: "buyplot", size: "cove", shape: "round", x: 0, z: 1100 });
  const mine = (j) => j.messages.findLast((m) => m.t === "island" && m.info.plot.mine).info.id;
  const pa = room.plots.get(mine(a));
  const pb = room.plots.get(mine(b));
  return { room, a, b, pa, pb };
}

const place = (kind, at, rot = 0, move) => ({ t: "place", kind, x: at.x, z: at.z, rot, move });

test("buying and placing: coins taken on placement, everyone hears of it, it collides", () => {
  const { room, a, b, pa } = landed();
  const coins = a.coins();
  const at = spotFor(room, pa, "cottage");
  /* Not standing on your land yet: you can't build from the sea. */
  a.goTo(0, 900);
  room.handle(a.id, place("cottage", at));
  assert.match(a.feed(), /your own land/);
  a.goTo(at.x + 9, at.z);
  room.handle(a.id, place("cottage", at));
  assert.equal(a.coins(), coins - 450);
  const sent = b.last("item");
  assert.equal(sent.plot, pa.id);
  assert.equal(sent.item[1], CATALOGUE_IDS.indexOf("cottage"));
  assert.equal(pa.items.length, 1);
  /* It's solid now: in the world for walkers, boats and beasts alike. */
  assert(room.world.solidsNear(at.x, at.z).some((s) => overSolid(s, at.x, at.z)));
  /* Not on top of it again. */
  room.handle(a.id, place("house", at));
  assert.match(a.feed(), /cottage/);
  assert.equal(a.coins(), coins - 450);
  /* Too far off, though you're on your land. */
  const far = spotFor(room, pa, "tent", 20);
  const t = room.world.islands.get(pa.id).terrain;
  a.goTo(far.x + (far.x > t.ox ? -1 : 1) * (PLACE_REACH + 5), far.z);
  room.handle(a.id, place("tent", far));
  assert.match(a.feed(), /too far/);
});

test("only on your own plot, with coins, and within its budget", () => {
  const { room, a, b, pa, pb } = landed();
  const theirs = spotFor(room, pb, "tent");
  a.goTo(theirs.x + 4, theirs.z);
  room.handle(a.id, place("tent", theirs));
  assert.match(a.feed(), /your own land|not your land/);
  assert.equal(pb.items.length, 0);
  /* No coins, no cottage. */
  const at = spotFor(room, pa, "cottage");
  a.goTo(at.x + 9, at.z);
  a.give(100);
  room.handle(a.id, place("cottage", at));
  assert.match(a.feed(), /costs 450/);
  assert.equal(pa.items.length, 0);
  /* A full plot takes no more. */
  a.give(50000);
  const cap = PLOT_SIZES.isle.items;
  for (let i = 0; i < cap; i++)
    pa.items.push({ id: 9000 + i, kind: "bush", x: 9999, y: 0, z: 9999, rot: 0, hp: 1 });
  room.handle(a.id, place("cottage", at));
  assert.match(a.feed(), /holds 90 things/);
  /* Someone without land can't build anywhere. */
  const c = joiner(room, "carol", "caroltoken1");
  c.give(5000);
  room.handle(c.id, place("tent", at));
  assert.match(c.feed(), /Buy a plot/);
  void b;
});

test("moving is free and keeps its health; selling gives half back; others can do neither", () => {
  const { room, a, b, pa } = landed();
  const at = spotFor(room, pa, "watchtower");
  a.goTo(at.x + 9, at.z);
  room.handle(a.id, place("watchtower", at));
  const item = pa.items[0];
  item.hp = 123;
  const coins = a.coins();
  const to = spotFor(room, pa, "watchtower", 25);
  a.goTo(to.x + 9, to.z);
  room.handle(a.id, place("watchtower", to, 0.5, item.id));
  assert.equal(a.coins(), coins, "free");
  assert.equal(pa.items.length, 1);
  assert.deepEqual([item.x, item.z, item.rot, item.hp], [to.x, to.z, 0.5, 123]);
  assert.equal(a.last("item").item[0], item.id);
  assert(room.world.solidsNear(to.x, to.z).some((s) => overSolid(s, to.x, to.z)));
  assert(
    !room.world.solidsNear(at.x, at.z).some((s) => overSolid(s, at.x, at.z)),
    "the old spot is clear",
  );
  /* Bob can't move or sell it. */
  b.goTo(to.x + 9, to.z);
  room.handle(b.id, place("watchtower", at, 0, item.id));
  room.handle(b.id, { t: "sell", id: item.id });
  assert.equal(pa.items.length, 1);
  assert.equal(item.x, to.x);
  /* Alice sells it back. */
  room.handle(a.id, { t: "sell", id: item.id });
  assert.equal(pa.items.length, 0);
  assert.equal(a.coins(), coins + 200);
  assert.equal(b.last("unitem").id, item.id);
  assert(!room.world.solidsNear(to.x, to.z).some((s) => overSolid(s, to.x, to.z)));
});

test("growing your land sets what's on it back on the ground, or pays back what no longer fits", () => {
  const { room, a, pa } = landed();
  const at = spotFor(room, pa, "cottage");
  a.goTo(at.x + 9, at.z);
  room.handle(a.id, place("cottage", at));
  /* Out by the old shore: the grown land is a different shape there. */
  const t = room.world.islands.get(pa.id).terrain;
  pa.items.push({ id: 7777, kind: "tent", x: t.ox + 300, y: 0, z: t.oz, rot: 0, hp: 1 });
  const coins = a.coins();
  room.handle(a.id, { t: "growplot", size: "holm" });
  const grown = room.plots.get(pa.id);
  assert.equal(grown.size, "holm");
  const cottage = grown.items.find((o) => o.kind === "cottage");
  assert(cottage, "the cottage still stands");
  const g = room.world.islands.get(pa.id).terrain;
  assert(Math.abs(cottage.y - g.heightAt(cottage.x, cottage.z)) < 1.5, "on the new ground");
  assert(
    room.world.solidsNear(cottage.x, cottage.z).some((s) => overSolid(s, cottage.x, cottage.z)),
  );
  assert(!grown.items.some((o) => o.id === 7777), "the tent in the sea is gone");
  assert.equal(a.coins(), coins - (8000 - 2500) + 150, "and paid back");
});

test("the dev cheat only works where creative is allowed", () => {
  const room = new Room({ online: true, grand: true, now: () => 100 });
  const a = joiner(room, "alice", "alicetoken1");
  room.handle(a.id, { t: "devcoins" });
  assert.equal(a.coins(), 0);
  const dev = new Room({ online: true, grand: true, now: () => 100, creative: true });
  const d = joiner(dev, "dev", "devtoken123");
  dev.handle(d.id, { t: "devcoins" });
  assert.equal(d.coins(), 10000);
});

/* ---------- keeping it ---------- */

test("what stands on a plot is saved and comes back, solid, after a restart", () => {
  const { room, a, pa } = landed();
  const at = spotFor(room, pa, "keep");
  a.goTo(at.x + 14, at.z);
  room.handle(a.id, place("keep", at, 0.25));
  const placed = { ...pa.items[0] };
  room.leave(a.id);
  const saved = JSON.parse(JSON.stringify(room.exportWorld()));
  assert.equal(saved.v, WORLD_SAVE_VERSION);
  const world = parseWorldSave(saved);
  const plot = world.plots.find((p) => p.id === pa.id);
  assert.deepEqual(plot.items, [placed]);
  assert(world.ids.item > placed.id);
  const again = new Room({ online: true, grand: true, now: () => 100, world });
  assert(again.world.solidsNear(at.x, at.z).some((s) => overSolid(s, at.x, at.z)));
  const back = joiner(again, "alice", "alicetoken1");
  const sent = back.last("world").items.find(([id]) => id === pa.id);
  assert.deepEqual(sent[1].map(unpackItem), [placed]);
  /* New things get new ids. */
  back.goTo(at.x + 14, at.z);
  const next = spotFor(again, again.plots.get(pa.id), "tent", 30);
  back.goTo(next.x + 4, next.z);
  again.handle(back.id, place("tent", next));
  assert(again.plots.get(pa.id).items.some((o) => o.kind === "tent" && o.id > placed.id));
});

test("bare plots in a save still load, and damaged items are dropped", () => {
  const players = [{ token: "aaaaaaaa", name: "a", saved: null }];
  const plot = { id: 100, size: "cove", shape: "round", seed: 7, x: 0, z: 700, owner: "aaaaaaaa" };
  const old = parseWorldSave({
    v: WORLD_SAVE_VERSION,
    ids: { tool: 1, plot: 101 },
    players,
    plots: [plot],
  });
  assert.deepEqual(old.plots, [{ ...plot, items: [] }]);
  assert.equal(old.ids.item, 1);
  const room = new Room({ online: true, grand: true, now: () => 100, world: old });
  assert.equal(room.plots.get(100).items.length, 0);

  const good = { id: 5, kind: "cottage", x: 10, y: 2, z: 710, rot: 0, hp: 500 };
  const save = parseWorldSave({
    v: WORLD_SAVE_VERSION,
    ids: { tool: 1, plot: 101, item: 2 },
    players,
    plots: [
      {
        ...plot,
        items: [
          good,
          { ...good, id: 6, kind: "spaceship" },
          { ...good, id: 7, x: 9000 },
          { ...good, id: 5 },
          { ...good, id: 8, hp: 99999 },
        ],
      },
    ],
  });
  const items = save.plots[0].items;
  assert.deepEqual(
    items.map((o) => o.id),
    [5, 8],
  );
  assert.equal(items[1].hp, 500, "health past its most comes back whole");
  assert.equal(save.ids.item, 9);
});

test("every plot flies a team colour", () => {
  assert.deepEqual([100, 101, 102, 103, 104].map(plotTeam), [
    "blue",
    "red",
    "yellow",
    "green",
    "blue",
  ]);
});
