import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOGUE } from "../src/game/shared/catalogue.ts";
import { checkItem } from "../src/game/shared/placing.ts";
import { SHIELD_TIME, STARTER_SHIELD } from "../src/game/shared/plots.ts";
import { FLAG } from "../src/game/shared/protocol.ts";
import {
  CAPTURE_STATE,
  CAPTURE_TIME,
  captureRate,
  compass,
  plunderOf,
  RAID_GRACE,
  raiderTeam,
  stepCapture,
} from "../src/game/shared/raids.ts";
import { parseWorldSave, WORLD_SAVE_VERSION } from "../src/game/shared/save.ts";
import { canDamageItem } from "../src/game/shared/siege.ts";
import { Room } from "../src/game/server/room.ts";

/* ---------- the rules on their own ---------- */

test("capture rules: twenty seconds alone, a small bonus for company, held when contested, slow to fall back", () => {
  assert.equal(CAPTURE_TIME, 20);
  assert.equal(captureRate(1), 1);
  assert(captureRate(2) > 1 && captureRate(2) < 2, "a second raider helps, a little");
  assert.equal(captureRate(10), 1.5, "and no more than half as fast again");
  assert.deepEqual(stepCapture(5, 1, 1, 1), { progress: 5, state: CAPTURE_STATE.contested });
  assert.deepEqual(stepCapture(5, 1, 0, 1), { progress: 6, state: CAPTURE_STATE.taking });
  const back = stepCapture(5, 0, 0, 1);
  assert(back.progress < 5 && back.progress > 4, "falls back slowly");
  assert.equal(stepCapture(0.1, 0, 0, 10).progress, 0);
  assert.equal(plunderOf(10001), 3000);
  assert.equal(plunderOf(0), 0);
  assert.equal(compass(10, 0), "east");
  assert.equal(compass(0, -10), "north");
  assert.equal(compass(-7, 7), "south-west");
  assert.equal(raiderTeam("green", "red", "bob"), "green");
  assert.notEqual(raiderTeam(null, "red", "bob"), "red", "never the owner's own colours");
  assert(!canDamageItem({ token: "bobtoken123", creative: false }, { owner: "a", shield: 50 }, 10));
  assert(canDamageItem({ token: "bobtoken123", creative: false }, { owner: "a", shield: 50 }, 60));
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
    feeds: () => messages.filter((m) => m.t === "feed").map((m) => m.text),
    coins: () => member().inv.coins,
    give: (n) => {
      member().inv.coins = n;
    },
    /* Stand at (x, z), on the ground (or at `y`), facing (tx, tz). */
    stand: (x, z, tx = x, tz = z - 1, y = room.world.heightAt(x, z)) => {
      const b = member().body;
      b.x = x;
      b.z = z;
      b.y = y;
      b.yaw = Math.atan2(-(tx - x), -(tz - z));
    },
  };
}

/* Alice has an isle, past its starter shield; Bob is about. The clock is ours to turn. */
function raid() {
  const clock = { now: 1000 };
  const room = new Room({ online: true, grand: true, now: () => clock.now });
  const a = joiner(room, "alice", "alicetoken1");
  const b = joiner(room, "bob", "bobtoken123");
  a.give(50000);
  b.give(50000);
  room.handle(a.id, { t: "buyplot", size: "isle", shape: "round", x: 0, z: 700 });
  const pa = room.plots.get(a.last("island").info.id);
  const t = room.world.islands.get(pa.id).terrain;
  const h = t.hearth;
  const tick = (seconds = 0.05) => {
    for (let s = 0; s < seconds - 1e-9; s += 0.05) {
      clock.now += 0.05;
      room.tick();
    }
  };
  /* Off the starter shield, as if two hours had gone by. */
  const unshield = () => {
    delete pa.shield;
    tick();
  };
  /* At the Hearth: on the plinth, beside the fire. */
  const atHearth = (who, dx = 1.5) => who.stand(h.x + dx, h.z, h.x, h.z, h.y);
  const away = (who) => who.stand(0, 300);
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
  const raiderFlag = (who) => {
    const p = a.last("snap").p.find((s) => s[0] === who.id);
    return (p[6] & FLAG.raider) !== 0;
  };
  return { clock, room, a, b, pa, t, h, tick, unshield, atHearth, away, put, raiderFlag };
}

test("new land starts with a two-hour shield: nobody raids it or harms what's on it", () => {
  const { clock, room, a, b, pa, put, tick, raiderFlag } = raid();
  assert.equal(pa.shield, 1000 + STARTER_SHIELD);
  const cottage = put("cottage", 0);
  b.stand(pa.x + 30, pa.z);
  tick(1);
  assert.equal(b.member().raid, null, "a shielded isle has visitors, not raiders");
  assert(!raiderFlag(b));
  room.handle(b.id, { t: "arm", kind: "hammer" });
  b.stand(cottage.x + CATALOGUE.cottage.hx + 1, cottage.z, cottage.x, cottage.z);
  clock.now += 2;
  room.handle(b.id, { t: "attack", charge: 0.6 });
  tick(0.5);
  assert.equal(cottage.hp, CATALOGUE.cottage.health);
  assert(b.feeds().some((f) => /shielded/.test(f)));
  /* Everyone is told how long it has left. */
  const st = b.last("plots").plots.find((p) => p.id === pa.id);
  assert(st.shield > STARTER_SHIELD - 5 && st.captor === null);
  /* Two hours on, it's down, and Bob is raiding it. */
  clock.now = 1000 + STARTER_SHIELD + 1;
  tick(0.1);
  assert.equal(pa.shield, undefined);
  assert(a.feeds().some((f) => /shield is down/.test(f)));
  assert.equal(b.member().raid?.plot, pa.id);
});

test("setting foot on someone's land makes you a raider, marked for all; the owner hears which side", () => {
  const { room, a, b, pa, h, tick, unshield, away, raiderFlag } = raid();
  unshield();
  /* Alice on her own land is no raider. */
  a.stand(h.x + 6, h.z);
  b.stand(h.x + 70, h.z);
  tick(0.2);
  assert.equal(a.member().raid, null);
  assert.equal(b.member().raid?.plot, pa.id);
  assert(raiderFlag(b) && !raiderFlag(a));
  assert.equal(b.last("snap").me.raid, pa.id);
  const alarm = a.last("alarm");
  assert.deepEqual([alarm.plot, alarm.side, alarm.at, alarm.raiders], [pa.id, "east", "shore", 1]);
  assert.equal(a.last("plots").plots.find((p) => p.id === pa.id).raiders, 1);
  assert(b.feeds().some((f) => /raiding alice's Isle/.test(f)));
  /* Off the land: still a raider for the grace period, then not. */
  away(b);
  tick(RAID_GRACE - 1);
  assert.equal(b.member().raid?.plot, pa.id);
  tick(2);
  assert.equal(b.member().raid, null);
  assert(!raiderFlag(b));
  assert.equal(a.last("plots").plots.find((p) => p.id === pa.id).raiders, 0);
  assert(a.feeds().some((f) => /raiders have left/.test(f)));
  /* Sailing in counts too: anywhere on the plot's tile. */
  b.stand(pa.x, pa.z - 110, pa.x, pa.z, -0.6);
  tick(0.2);
  assert.equal(b.member().raid?.plot, pa.id);
  void room;
});

test("holding the Hearth twenty seconds captures it: 30% of the owner's purse, a shield, the captor's colours", () => {
  const { clock, room, a, b, pa, tick, unshield, atHearth, away, raiderFlag } = raid();
  unshield();
  a.give(10001);
  b.give(500);
  away(a);
  atHearth(b);
  tick(1);
  assert.equal(a.last("alarm").at, "hearth", "the owner hears it's being taken");
  tick(CAPTURE_TIME - 2);
  assert.equal(pa.shield, undefined, "not yet");
  const cap = b.last("snap").cap.find((c) => c[0] === pa.id);
  assert(cap[1] > CAPTURE_TIME - 2.5 && cap[2] === CAPTURE_STATE.taking && cap[3] === b.id);
  tick(1.2);
  assert.equal(a.coins(), 10001 - 3000);
  assert.equal(b.coins(), 500 + 3000);
  assert(Math.abs(pa.shield - (clock.now + SHIELD_TIME)) < 0.5);
  assert.equal(pa.captor.name, "bob");
  assert.match(b.last("news").title, /You captured alice's Isle/);
  assert.match(a.last("news").title, /Hearth has fallen/);
  assert(a.feeds().includes("bob captured alice's Isle"), "everyone hears of it");
  /* Shielded now: Bob is a visitor, and can't start again. */
  tick(0.2);
  assert.equal(b.member().raid, null);
  assert(!raiderFlag(b));
  tick(5);
  assert.equal(room.sieges.get(pa.id).progress, 0);
  const st = a.last("plots").plots.find((p) => p.id === pa.id);
  assert(st.shield > SHIELD_TIME - 10 && st.captor.name === "bob");
});

test("the owner at the Hearth holds it; left alone it falls back; knocked down, a raider stops taking it", () => {
  const { room, a, b, pa, tick, unshield, atHearth, away } = raid();
  unshield();
  const siege = () => room.sieges.get(pa.id);
  away(a);
  atHearth(b);
  tick(8);
  const at = siege().progress;
  assert(at > 7.5 && at < 8.5);
  /* Alice comes home and stands on it: contested, held where it is. */
  atHearth(a, -1.5);
  tick(5);
  assert.equal(siege().progress, at);
  assert.equal(siege().state, CAPTURE_STATE.contested);
  assert.equal(b.last("snap").cap[0][2], CAPTURE_STATE.contested);
  /* Bob steps off the plinth: it falls back, slowly. */
  away(a);
  b.stand(pa.x + 30, pa.z);
  tick(4);
  assert(siege().progress < at && siege().progress > at - 2);
  /* Back on it, then knocked out there: no more progress while he's down. */
  atHearth(b);
  tick(2);
  const before = siege().progress;
  room.hurt(b.member(), 1000, "hit", a.member());
  tick(2);
  assert(siege().progress < before);
  assert.equal(pa.shield, undefined);
});

test("PvP on a plot: the owner can strike down a raider, and a downed raider wakes at home, not on the isle", () => {
  const { clock, room, a, b, pa, t, tick, unshield, atHearth } = raid();
  unshield();
  atHearth(b);
  tick(0.5);
  /* Alice, right behind him with a hammer. */
  room.handle(a.id, { t: "arm", kind: "hammer" });
  const bb = b.member().body;
  a.stand(bb.x + 1.5, bb.z, bb.x, bb.z, bb.y);
  const health = b.member().health;
  clock.now += 2;
  room.handle(a.id, { t: "attack", charge: 0.6 });
  tick(0.3);
  assert(b.member().health < health, "raider hurt on the owner's land");
  room.hurt(b.member(), 1000, "hit", a.member());
  assert.notEqual(b.member().respawnAt, null);
  tick(6);
  const home = room.harbor.home;
  const back = b.last("respawn");
  assert.deepEqual([back.x, back.z], [home.x, home.z], "Bob has no land: the Harbor");
  assert(!t.contains(back.x, back.z));
  assert.equal(b.member().raid, null, "his raid is over");
  /* With land of his own he wakes at its Hearth instead. */
  room.handle(b.id, { t: "buyplot", size: "cove", shape: "round", x: 0, z: 1100 });
  const pb = room.plots.get(b.last("island").info.id);
  atHearth(b);
  tick(0.5);
  room.hurt(b.member(), 1000, "hit", a.member());
  tick(6);
  const own = room.world.islands.get(pb.id).terrain.home;
  assert.deepEqual([b.last("respawn").x, b.last("respawn").z], [own.x, own.z]);
  void pa;
});

test("attacking someone else's land drops your own shield, and you're told first", () => {
  const { clock, room, a, b, pa, tick, unshield, atHearth, put } = raid();
  const cottage = put("cottage", 0);
  unshield();
  room.handle(b.id, { t: "buyplot", size: "cove", shape: "round", x: 0, z: 1100 });
  const pb = room.plots.get(b.last("island").info.id);
  assert(pb.shield > clock.now);
  b.stand(cottage.x + CATALOGUE.cottage.hx + 1, cottage.z, cottage.x, cottage.z);
  tick(0.2);
  assert(
    b.feeds().some((f) => /your own shield drops/.test(f)),
    "warned on landing",
  );
  assert(pb.shield > clock.now, "landing alone doesn't break it");
  room.handle(b.id, { t: "arm", kind: "hammer" });
  clock.now += 2;
  room.handle(b.id, { t: "attack", charge: 0.6 });
  tick(0.5);
  assert(cottage.hp < CATALOGUE.cottage.health);
  assert.equal(pb.shield, undefined, "his shield is down");
  assert(b.feeds().some((f) => /your own isle's shield is down/.test(f)));
  /* Starting a capture does it too. */
  pb.shield = clock.now + 999;
  atHearth(b);
  tick(0.5);
  assert.equal(pb.shield, undefined);
  void a;
});

test("an offline owner is plundered from their saved purse, and the shield survives a save and a restart", () => {
  const { clock, room, a, b, pa, tick, unshield, atHearth, put } = raid();
  const cottage = put("cottage", 0);
  unshield();
  a.give(20000);
  room.leave(a.id);
  assert.equal(room.profiles.get("alicetoken1").saved.inv.coins, 20000);
  b.give(0);
  atHearth(b);
  tick(CAPTURE_TIME + 0.5);
  assert.equal(b.coins(), 6000);
  assert.equal(room.profiles.get("alicetoken1").saved.inv.coins, 14000);
  assert.equal(pa.captor.name, "bob");

  const raw = JSON.parse(JSON.stringify(room.exportWorld()));
  const save = parseWorldSave(raw);
  assert.equal(save.v, WORLD_SAVE_VERSION);
  const plot = save.plots.find((p) => p.id === pa.id);
  assert.equal(plot.shield, pa.shield);
  assert.deepEqual(plot.captor, pa.captor);
  assert.equal(save.players.find((p) => p.token === "alicetoken1").saved.inv.coins, 14000);

  /* After a restart: still shielded, nothing on it can be harmed, and she comes back to a lighter purse. */
  const later = { now: clock.now + 60 };
  const again = new Room({ online: true, grand: true, now: () => later.now, world: save });
  const back = joiner(again, "alice", "alicetoken1");
  const bob = joiner(again, "bob", "bobtoken123");
  assert.equal(back.coins(), 14000);
  const st = back.last("world").plots.find((p) => p.id === pa.id);
  assert(st.shield > SHIELD_TIME - 120 && st.captor.name === "bob");
  const item = again.plots.get(pa.id).items.find((o) => o.id === cottage.id);
  again.handle(bob.id, { t: "arm", kind: "hammer" });
  bob.stand(item.x + CATALOGUE.cottage.hx + 1, item.z, item.x, item.z);
  later.now += 2;
  again.handle(bob.id, { t: "attack", charge: 0.6 });
  for (let i = 0; i < 10; i++) {
    later.now += 0.05;
    again.tick();
  }
  assert.equal(item.hp, CATALOGUE.cottage.health);
  assert.equal(bob.member().raid, null);

  /* A plot saved with no shield loads unshielded. */
  const bare = parseWorldSave({
    ...raw,
    plots: raw.plots.map(({ shield, captor, ...p }) => p),
  });
  assert.equal(bare.plots[0].shield, undefined);
  assert.equal(bare.plots[0].captor, undefined);
  /* A bad captor is dropped, the shield kept. */
  const odd = parseWorldSave({
    ...raw,
    plots: raw.plots.map((p) => ({ ...p, captor: { name: "x", team: "purple" } })),
  });
  assert.equal(odd.plots[0].captor, undefined);
  assert.equal(odd.plots[0].shield, pa.shield);
});

test("the warhammer's slam breaks into the two nearest things round you, no more", () => {
  const { clock, room, b, pa, t, tick, unshield } = raid();
  unshield();
  /* Three bushes round one spot: two near, one a little further. */
  const at = { x: Math.round(t.ox + 30), z: Math.round(t.oz) };
  const spots = [
    [at.x + 2, at.z],
    [at.x - 2, at.z],
    [at.x, at.z + 2.6],
  ];
  const a = room.members.get([...room.members.keys()][0]);
  for (const [x, z] of spots) {
    a.body.x = x + 5;
    a.body.z = z;
    room.handle(a.id, { t: "place", kind: "bush", x, z, rot: 0 });
  }
  const bushes = pa.items.filter((o) => o.kind === "bush");
  assert.equal(bushes.length, 3, "three bushes set down");
  room.handle(b.id, { t: "arm", kind: "hammer" });
  b.stand(at.x, at.z);
  clock.now += 2;
  room.handle(b.id, { t: "attack", charge: 0.6 });
  tick(0.5);
  const hit = bushes.filter((o) => o.hp < CATALOGUE.bush.health);
  assert.equal(hit.length, 2);
  assert(!hit.includes(bushes[2]), "the furthest is spared");
});
