import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOGUE } from "../src/game/shared/catalogue.ts";
import { CREW_ID_BASE, CREW_PRICE, KNOCKOUT_MIN, pickSkin } from "../src/game/shared/crew.ts";
import { checkItem } from "../src/game/shared/placing.ts";
import { PLOT_SIZES } from "../src/game/shared/plots.ts";
import { FLAG, parseClientMsg } from "../src/game/shared/protocol.ts";
import { CAPTURE_STATE, CAPTURE_TIME } from "../src/game/shared/raids.ts";
import { parseWorldSave, WORLD_SAVE_VERSION } from "../src/game/shared/save.ts";
import { WEAPONS } from "../src/game/shared/weapons.ts";
import { Room } from "../src/game/server/room.ts";

function joiner(room, name, token, skin) {
  const messages = [];
  const id = room.join({ send: (m) => messages.push(m) }, { name, token, own: true, skin });
  const member = () => room.members.get(id);
  return {
    id,
    messages,
    member,
    last: (t) => messages.findLast((m) => m.t === t),
    feeds: () => messages.filter((m) => m.t === "feed").map((m) => m.text),
    coins: () => member().inv.coins,
    give: (n) => {
      member().inv.coins = n;
    },
    stand: (x, z, tx = x, tz = z - 1, y = room.world.heightAt(x, z)) => {
      const b = member().body;
      b.x = x;
      b.z = z;
      b.y = y;
      b.yaw = Math.atan2(-(tx - x), -(tz - z));
    },
  };
}

/* Alice has an isle with a crew to hire; Bob is about. The clock is ours to turn. */
function world(size = "isle") {
  const clock = { now: 1000 };
  const room = new Room({ online: true, grand: true, now: () => clock.now });
  const a = joiner(room, "alice", "alicetoken1", "wanderer");
  const b = joiner(room, "bob", "bobtoken123", "harbor-knight");
  a.give(50000);
  b.give(50000);
  room.handle(a.id, { t: "buyplot", size, shape: "round", x: 0, z: 700 });
  const pa = room.plots.get(a.last("island").info.id);
  const t = room.world.islands.get(pa.id).terrain;
  const h = t.hearth;
  const tick = (seconds = 0.05, each) => {
    for (let s = 0; s < seconds - 1e-9; s += 0.05) {
      clock.now += 0.05;
      room.tick();
      each?.();
    }
  };
  const hire = (n, weapon) => {
    for (let i = 0; i < n; i++) room.handle(a.id, { t: "hire" });
    const men = room.crew.of(pa.id);
    if (weapon) for (const c of men) room.handle(a.id, { t: "crewarm", id: c.id, kind: weapon });
    return men;
  };
  const atHearth = (who, dx = 1.5) => who.stand(h.x + dx, h.z, h.x, h.z, h.y);
  /* Alice at home, on her own land. */
  const home = () => a.stand(t.home.x, t.home.z);
  const near = (c, x, z) => Math.hypot(c.body.x - x, c.body.z - z);
  return { clock, room, a, b, pa, t, h, tick, hire, atHearth, near, home };
}

/* Something set down on a plot, `d` metres out from its middle. */
function put(room, who, plot, kind, angle, d = 30) {
  const t = room.world.islands.get(plot.id).terrain;
  for (let r = d; r < d + 40; r += 1) {
    const x = Math.round(t.ox + Math.cos(angle) * r);
    const z = Math.round(t.oz + Math.sin(angle) * r);
    if (!checkItem(t, plot.items, kind, x, z, 0).ok) continue;
    who.stand(x + 7, z);
    room.handle(who.id, { t: "place", kind, x, z, rot: 0 });
    const item = plot.items.at(-1);
    assert.equal(item.kind, kind);
    return item;
  }
  throw new Error(`no room for a ${kind}`);
}

test("crew rules: a price, a cap by the size of your land, and a look unlike yours", () => {
  assert.equal(CREW_PRICE, 300);
  assert.deepEqual(
    Object.values(PLOT_SIZES).map((d) => d.crew),
    [3, 6, 10, 16],
  );
  for (let i = 0; i < 20; i++) assert.notEqual(pickSkin("wanderer", [], Math.random), "wanderer");
  assert.deepEqual(parseClientMsg('{"t":"hire"}'), { t: "hire" });
  assert.deepEqual(parseClientMsg('{"t":"order","order":"follow"}'), {
    t: "order",
    order: "follow",
  });
  assert.equal(parseClientMsg('{"t":"order","order":"dance"}'), null);
  assert.deepEqual(parseClientMsg(`{"t":"crewarm","id":${CREW_ID_BASE},"kind":"spear"}`), {
    t: "crewarm",
    id: CREW_ID_BASE,
    kind: "spear",
  });
});

test("hiring: land first, coins each, no more than the land houses, dismissed for nothing, kept in the save", () => {
  const { clock, room, a, b, pa, tick, home } = world("cove");
  room.handle(b.id, { t: "hire" });
  assert(
    b.feeds().some((f) => /Buy a plot/.test(f)),
    "no land, no crew",
  );
  assert.equal(b.coins(), 50000);
  for (let i = 0; i < 4; i++) room.handle(a.id, { t: "hire" });
  assert.equal(pa.crew.length, 3, "a cove houses three");
  assert.equal(a.coins(), 50000 - 600 - 3 * CREW_PRICE);
  assert(a.feeds().some((f) => /houses 3 men/.test(f)));
  const names = new Set(pa.crew.map((h) => h.name));
  assert.equal(names.size, 3, "each his own name");
  for (const h of pa.crew) assert.notEqual(h.skin, "wanderer", "none dressed as his master");
  /* The owner hears how his crew stands. */
  const view = a.last("crew");
  assert.equal(view.men.length, 3);
  assert.equal(view.order, "home");
  /* Arming one: a spear, at its price. */
  const [first, second, third] = pa.crew;
  const before = a.coins();
  room.handle(a.id, { t: "crewarm", id: first.id, kind: "spear" });
  assert.equal(first.weapon, "spear");
  assert.equal(a.coins(), before - WEAPONS.spear.price);
  /* Dismissed: gone, and nothing back. */
  const coins = a.coins();
  room.handle(a.id, { t: "dismiss", id: second.id });
  assert.deepEqual(
    pa.crew.map((h) => h.id),
    [first.id, third.id],
  );
  assert.equal(a.coins(), coins);
  assert.equal(room.crew.get(second.id), null);
  /* Seen by everyone near, and nobody far: name, look and weapon on the wire. */
  home();
  tick(0.5);
  const snap = a.last("snap").c.find((s) => s[0] === first.id);
  assert(snap, "Alice sees him");
  assert.equal(snap[1], pa.id);
  assert(!b.last("snap").c.length, "Bob, on the Harbor, is too far off");

  const raw = JSON.parse(JSON.stringify(room.exportWorld()));
  const save = parseWorldSave(raw);
  assert.equal(save.v, WORLD_SAVE_VERSION);
  assert.deepEqual(save.plots[0].crew, pa.crew);
  assert(save.ids.crew > third.id);
  const again = new Room({ online: true, grand: true, now: () => clock.now, world: save });
  assert.equal(again.crew.of(pa.id).length, 2, "back on their land after a restart");
  assert.equal(again.crew.get(first.id).hand.weapon, "spear");
  /* A version 7 save loads with nobody hired; a malformed man is dropped. */
  const v7 = parseWorldSave({
    ...raw,
    v: 7,
    plots: raw.plots.map(({ crew, ...p }) => p),
  });
  assert.equal(v7.plots[0].crew, undefined);
  const odd = parseWorldSave({
    ...raw,
    plots: raw.plots.map((p) => ({ ...p, crew: [...p.crew, { id: 5, name: "Zed", skin: "x" }] })),
  });
  assert.equal(odd.plots[0].crew.length, 2);
});

test("at home, even with their master away, the crew go for a raider on their land and hurt him", () => {
  const { room, a, b, pa, h, tick, hire } = world();
  const men = hire(3, "cutlass");
  delete pa.shield;
  room.leave(a.id);
  /* Bob lands a little way from the Hearth. */
  b.stand(h.x + 14, h.z + 3);
  tick(0.2);
  assert.equal(b.member().raid?.plot, pa.id);
  let low = 100;
  tick(8, () => {
    low = Math.min(low, b.member().health);
  });
  assert(low < 60, `Bob was cut (${low})`);
  assert(
    b.messages.some((m) => m.t === "hit" && m.target === b.id && men.some((c) => c.id === m.by)),
    "by Alice's men",
  );
  assert(b.messages.some((m) => m.t === "swing" && men.some((c) => c.id === m.by)));
});

test("a crewman at the Hearth holds it against a raider, as his master would", () => {
  const { room, a, b, pa, tick, hire, atHearth } = world();
  const [man] = hire(1);
  delete pa.shield;
  room.leave(a.id);
  atHearth(b);
  /* Bob stands his ground, unhurt, while the man comes for the Hearth. */
  let contested = false;
  tick(12, () => {
    const bm = b.member();
    bm.health = 100;
    atHearth(b);
    const s = room.sieges.get(pa.id);
    if (s?.state === CAPTURE_STATE.contested) contested = true;
  });
  assert(contested, "held");
  assert(room.sieges.get(pa.id).progress < CAPTURE_TIME * 0.75);
  assert.equal(pa.shield, undefined, "not captured");
  assert(man.respawnAt === null);
});

test("knocked out, a crewman lies there, then wakes at the Hearth whole, weapon and all", () => {
  const { clock, room, a, pa, t, tick, hire, home } = world();
  const [man] = hire(1, "axe");
  home();
  man.body.x = t.home.x + 30;
  man.body.z = t.home.z;
  room.crew.hurt(man, 1000, clock.now);
  tick(0.1);
  assert.notEqual(man.respawnAt, null);
  const snap = a.last("snap").c.find((s) => s[0] === man.id);
  assert.equal(snap[6] & FLAG.alive, 0, "seen down");
  assert(a.last("crew").men[0].down);
  tick(KNOCKOUT_MIN - 1);
  assert.notEqual(man.respawnAt, null, "not yet");
  tick(2);
  assert.equal(man.respawnAt, null);
  assert.equal(man.health, 100);
  assert.equal(man.hand.weapon, "axe");
  assert(Math.hypot(man.body.x - t.home.x, man.body.z - t.home.z) < 8, "beside the Hearth");
  void pa;
});

test("called, the crew keep up with their master, land with him, and batter what he batters", () => {
  const { clock, room, a, b, pa, t, tick, hire, near } = world();
  const men = hire(3, "hammer");
  room.handle(a.id, { t: "order", order: "follow" });
  assert.equal(a.last("crew").order, "follow");
  /* Alice walks thirty metres across her own land; they stay at her back. */
  const home = t.home;
  let x = home.x;
  a.stand(x, home.z);
  tick(1);
  for (let i = 0; i < 30; i++) {
    x += 0.3;
    a.stand(x, home.z, x + 1, home.z);
    tick(0.05);
  }
  tick(2);
  for (const c of men) assert(near(c, x, home.z) < 8, `${c.hand.name} kept up`);
  /* Bob's land, unshielded, with a cottage on it. */
  room.handle(b.id, { t: "buyplot", size: "isle", shape: "round", x: 0, z: 1100 });
  const pb = room.plots.get(b.last("island").info.id);
  const cottage = put(room, b, pb, "cottage", 0);
  delete pb.shield;
  b.stand(0, 300);
  /* Alice lands beside it: her men are with her. */
  room.handle(a.id, { t: "arm", kind: "hammer" });
  const ax = cottage.x + CATALOGUE.cottage.hx + 1.2;
  a.stand(ax, cottage.z, cottage.x, cottage.z);
  tick(1);
  for (const c of men) assert(near(c, ax, cottage.z) < 12, `${c.hand.name} landed with her`);
  assert(
    men.some((c) => c.raid === pb.id),
    "raiding with her",
  );
  /* One blow from her, and they set to it. */
  clock.now += 2;
  room.handle(a.id, { t: "attack", charge: 0.6 });
  tick(0.3);
  const after = cottage.hp;
  assert(after < CATALOGUE.cottage.health);
  tick(6);
  assert(cottage.hp < after - 40, `the crew battered it too (${after} → ${cottage.hp})`);
  assert(b.messages.some((m) => m.t === "ihit" && men.some((c) => c.id === m.by)));
  void pa;
});

test("the crew never raid a shielded isle, and never fight on the Harbor", () => {
  const { clock, room, a, b, pa, tick, hire } = world();
  const men = hire(3, "hammer");
  room.handle(a.id, { t: "order", order: "follow" });
  room.handle(b.id, { t: "buyplot", size: "isle", shape: "round", x: 0, z: 1100 });
  const pb = room.plots.get(b.last("island").info.id);
  const cottage = put(room, b, pb, "cottage", 0);
  assert(pb.shield > clock.now, "Bob's land is new: shielded");
  room.handle(a.id, { t: "arm", kind: "hammer" });
  const ax = cottage.x + CATALOGUE.cottage.hx + 1.2;
  a.stand(ax, cottage.z, cottage.x, cottage.z);
  /* Bob looks on from a few steps off, clear of her swing. */
  b.stand(ax + 7, cottage.z);
  tick(1);
  clock.now += 2;
  room.handle(a.id, { t: "attack", charge: 0.6 });
  tick(6);
  assert.equal(cottage.hp, CATALOGUE.cottage.health, "nothing on it harmed");
  assert(
    men.every((c) => c.raid === null),
    "visitors, not raiders",
  );
  assert.equal(b.member().health, 100, "and they leave its owner be");
  /* On the Harbor, Bob swings at Alice: her men stand by, as the Harbor wants. */
  const home = room.harbor.home;
  a.stand(home.x, home.z);
  b.stand(home.x + 1.5, home.z, home.x, home.z);
  tick(1);
  room.handle(b.id, { t: "arm", kind: "cutlass" });
  clock.now += 1;
  room.handle(b.id, { t: "attack", charge: 0 });
  tick(5, () => b.stand(home.x + 1.5, home.z, home.x, home.z));
  assert.equal(b.member().health, 100);
  assert(!b.messages.some((m) => m.t === "hit" && men.some((c) => c.id === m.by)));
  void pa;
});

test("raiding with their master, the crew take the Hearth faster; aboard, they sit with him and land beside him", () => {
  const { room, a, b, pa, tick, hire, near } = world();
  const men = hire(2, "cutlass");
  room.handle(a.id, { t: "order", order: "follow" });
  room.handle(b.id, { t: "buyplot", size: "isle", shape: "round", x: 0, z: 1100 });
  const pb = room.plots.get(b.last("island").info.id);
  delete pb.shield;
  b.stand(0, 300);
  const hb = room.world.islands.get(pb.id).terrain.hearth;
  a.stand(hb.x + 1.5, hb.z, hb.x, hb.z, hb.y);
  tick(6, () => a.stand(hb.x + 1.5, hb.z, hb.x, hb.z, hb.y));
  const s = room.sieges.get(pb.id);
  assert.equal(s.state, CAPTURE_STATE.taking);
  assert.equal(s.leader, a.id, "the plunder would be hers");
  assert(s.progress > 6.5, `faster than alone (${s.progress.toFixed(2)} in 6 s)`);

  /* A galleon off her own shore: in she gets, and her men take the free seats. */
  const t = room.world.islands.get(pa.id).terrain;
  let z = t.oz;
  while (room.world.heightAt(t.ox, z) > -4) z -= 1;
  const ride = room.addRide("galleon", t.ox, 0, z - 6, 0);
  a.stand(t.ox, z - 6 + 4, t.ox, z - 6, -1);
  tick(2);
  room.handle(a.id, { t: "interact", kind: "vehicle", id: ride.id });
  tick(0.5);
  assert.equal(a.member().ride?.seat, 0);
  for (const c of men) assert.equal(c.ride?.id, ride.id, `${c.hand.name} aboard`);
  assert.deepEqual(
    ride.seats.filter((o) => o !== null),
    [a.id, ...men.map((c) => c.id)],
    "the helm is hers",
  );
  /* She steps off: they're over the side with her. */
  room.handle(a.id, { t: "interact", kind: "vehicle", id: ride.id });
  tick(0.5);
  assert.equal(a.member().ride, null);
  const me = a.member().body;
  for (const c of men) {
    assert.equal(c.ride, null);
    assert(near(c, me.x, me.z) < 12, `${c.hand.name} beside her`);
  }
});

test("told to hold, the crew stay on the spot when their master walks on", () => {
  const { room, a, t, tick, hire, near } = world();
  const men = hire(2);
  const { x, z } = t.home;
  a.stand(x, z);
  room.handle(a.id, { t: "order", order: "follow" });
  tick(3);
  room.handle(a.id, { t: "order", order: "hold" });
  assert.equal(a.last("crew").order, "hold");
  a.stand(x + 25, z);
  tick(4);
  for (const c of men) assert(near(c, x, z) < 5, `${c.hand.name} held`);
});
