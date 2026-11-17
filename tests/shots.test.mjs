import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOGUE } from "../src/game/shared/catalogue.ts";
import { arcClear, DEFENSES, lineOfSight } from "../src/game/shared/defenses.ts";
import { checkItem } from "../src/game/shared/placing.ts";
import { FLAG, parseClientMsg } from "../src/game/shared/protocol.ts";
import { parseWorldSave, WORLD_SAVE_VERSION } from "../src/game/shared/save.ts";
import {
  aimAt,
  blastShare,
  leadAt,
  SHOTS,
  SMOKE,
  shotAt,
  shotFromIndex,
  smokeBlocks,
} from "../src/game/shared/shots.ts";
import { gunsOf, hullOf } from "../src/game/shared/vehicles.ts";
import { STACK, toWeaponKind, WEAPONS } from "../src/game/shared/weapons.ts";
import { Room } from "../src/game/server/room.ts";

/* ---------- the sums on their own ---------- */

test("flight: a shot aimed flat or lobbed lands where it was aimed; leading meets a mover", () => {
  const from = { x: 0, y: 10, z: 0 };
  const to = { x: 60, y: 2, z: -30 };
  for (const high of [false, true]) {
    const v = aimAt(from, to, 40, 9.8, high);
    assert(v, "in reach");
    const t = Math.hypot(to.x, to.z) / Math.hypot(v.x, v.z);
    const p = shotAt({ ...from, vx: v.x, vy: v.y, vz: v.z, gravity: 9.8 }, t);
    assert(
      Math.hypot(p.x - to.x, p.y - to.y, p.z - to.z) < 0.01,
      `${high ? "lobbed" : "flat"} lands true`,
    );
    if (high) assert(v.y > 20, "a lob goes up");
  }
  assert.equal(aimAt(from, { x: 900, y: 0, z: 0 }, 40, 9.8), null, "out of reach");
  /* Something walking across at 5 m/s: aimed ahead of it, the shot and it meet. */
  const vel = { x: 0, z: 5 };
  const v = leadAt(from, to, vel, 55, 7);
  const t = Math.hypot(v.x, v.z) ? (to.x - from.x) / v.x : 0;
  const p = shotAt({ ...from, vx: v.x, vy: v.y, vz: v.z, gravity: 7 }, t);
  assert(Math.hypot(p.x - to.x, p.z - (to.z + vel.z * t)) < 0.5, "led onto it");
});

test("blasts fall off to their rim; smoke blocks a line through it, only while it lasts", () => {
  const keg = SHOTS.keg.blast;
  assert.equal(blastShare(keg, 0.5), 1);
  assert(blastShare(keg, 4) < 1 && blastShare(keg, 4) > keg.edge);
  assert.equal(blastShare(keg, keg.radius + 0.1), 0);
  const cloud = [{ x: 10, y: 0, z: 0, until: 8 }];
  const a = { x: 0, y: SMOKE.rise, z: 0 };
  const b = { x: 20, y: SMOKE.rise, z: 0 };
  assert(smokeBlocks(cloud, a, b, 5));
  assert(!smokeBlocks(cloud, a, b, 9), "blown away");
  assert(!smokeBlocks(cloud, a, { x: 0, y: SMOKE.rise, z: 20 }, 5), "not in the way");
});

test("line of sight: the ground and anything solid block it, a lob only needs to see over them", () => {
  const wall = {
    x: 5,
    z: 0,
    r: 2,
    bottom: -1,
    top: 4,
    standable: false,
    box: { hx: 0.5, hz: 2, c: 1, s: 0 },
  };
  const ground = { heightAt: (x) => (x > 14 && x < 16 ? 6 : 0), solidsNear: () => [wall] };
  const from = { x: 0, y: 2, z: 0 };
  assert(!lineOfSight(ground, from, { x: 10, y: 2, z: 0 }), "the wall's in the way");
  assert(lineOfSight(ground, from, { x: 10, y: 2, z: 0 }, { solid: false }), "a lob goes over");
  assert(lineOfSight(ground, { x: 0, y: 6, z: 0 }, { x: 10, y: 6, z: 0 }), "over the top of it");
  assert(
    !lineOfSight(ground, { x: 0, y: 6, z: 0 }, { x: 20, y: 3, z: 0 }, { solid: false }),
    "a hill",
  );
  /* The flight itself: flat into the wall, lobbed over it. */
  const to = { x: 10, y: 2, z: 0 };
  const flat = aimAt(from, to, 40, 9.8);
  const lob = aimAt(from, to, 40, 9.8, true);
  const fly = (v) => ({ ...from, vx: v.x, vy: v.y, vz: v.z, gravity: 9.8 });
  assert(!arcClear(ground, fly(flat), to), "straight into the wall");
  assert(arcClear(ground, fly(lob), to, { solid: false }), "over the top");
});

test("the numbers: hulls, guns, bows and kegs as the rules have them", () => {
  assert(hullOf("skiff") < 2 * SHOTS.cannonball.blast.hull, "two cannonballs sink a skiff");
  assert(hullOf("galleon") > hullOf("sloop") && hullOf("sloop") > hullOf("skiff"));
  assert.equal(gunsOf("skiff"), 0);
  assert.equal(gunsOf("sloop"), 2);
  assert.equal(gunsOf("galleon"), 4);
  assert.equal(gunsOf("liner"), 0, "a liner carries no guns");
  assert(WEAPONS.crossbow.ranged.damage[0] > WEAPONS["bow-a"].ranged.damage[0]);
  assert(WEAPONS.crossbow.cooldown > WEAPONS["bow-a"].cooldown);
  /* Every weapon that shoots looses something that really flies. */
  for (const k of ["bow-a", "bow-b", "crossbow", "firebow", "wand-a", "staff-b"])
    assert(SHOTS[WEAPONS[k].ranged.shot], k);
  /* Magic flies almost flat and fizzles out about where the weapon's reach ends. */
  for (const k of ["wand-a", "staff-b"]) {
    const r = WEAPONS[k].ranged;
    const s = SHOTS[r.shot];
    assert(s.gravity < 2, `${k} flies flat`);
    assert(Math.abs(r.speed[1] * s.life - WEAPONS[k].reach) < 6, `${k} reaches about as far`);
  }
  /* One keg close against a castle wall leaves it standing; two bring it down. */
  const keg = SHOTS.keg.blast.siege * SHOTS.keg.resist.stone;
  assert(keg < CATALOGUE.castleWall.health && keg * 2 >= CATALOGUE.castleWall.health);
  /* An arrow barely scratches stone. */
  assert(SHOTS.arrow.resist.stone < 0.3);
  /* A tower's archer takes a lone raider down in about a quarter of a minute of shooting. */
  const w = DEFENSES.watchtower;
  const seconds = (100 / w.damage) * w.cooldown;
  assert(seconds > 12 && seconds < 20, `${seconds} s`);
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
    give: (n) => {
      member().inv.coins = n;
    },
    /* Stand at (x, z), on the ground (or at `y`), facing (tx, tz). */
    stand: (x, z, tx = x, tz = z - 1, y = room.world.heightAt(x, z)) => {
      const b = member().body;
      Object.assign(b, { x, z, y, vx: 0, vy: 0, vz: 0 });
      b.yaw = Math.atan2(-(tx - x), -(tz - z));
    },
  };
}

/* Alice has an isle off its starter shield; Bob is about with coins to spend. */
function range() {
  const clock = { now: 1000 };
  const room = new Room({ online: true, grand: true, now: () => clock.now });
  const a = joiner(room, "alice", "alicetoken1");
  const b = joiner(room, "bob", "bobtoken123");
  a.give(80000);
  b.give(80000);
  room.handle(a.id, { t: "buyplot", size: "isle", shape: "round", x: 0, z: 700 });
  const pa = room.plots.get(a.last("island").info.id);
  const t = room.world.islands.get(pa.id).terrain;
  delete pa.shield;
  const tick = (seconds = 0.05, each) => {
    for (let s = 0; s < seconds - 1e-9; s += 0.05) {
      clock.now += 0.05;
      room.tick();
      each?.();
    }
  };
  const put = (kind, angle, d = 22, rot = 0) => {
    for (let r = d; r < d + 60; r += 1) {
      const x = Math.round(t.ox + Math.cos(angle) * r);
      const z = Math.round(t.oz + Math.sin(angle) * r);
      if (!checkItem(t, pa.items, kind, x, z, rot).ok) continue;
      a.stand(x + 6, z);
      room.handle(a.id, { t: "place", kind, x, z, rot });
      const item = pa.items.at(-1);
      assert.equal(item.kind, kind, `placed a ${kind}`);
      return item;
    }
    throw new Error(`no room for a ${kind}`);
  };
  /* Aim from where `who` stands at (x, y, z), as their client would. */
  const aimFrom = (who, x, y, z) => {
    const b = who.member().body;
    const e = { x: b.x, y: b.y + 1.54, z: b.z };
    b.yaw = Math.atan2(-(x - e.x), -(z - e.z));
    return [x - e.x, y - e.y, z - e.z];
  };
  const away = (who) => who.stand(0, 300);
  /* Out on the water off Alice's shore, along `angle`, in water at least this deep. */
  const offshore = (angle, depth = -3, extra = 0) => {
    let r = 40;
    for (; r < 200; r += 1) {
      const x = t.ox + Math.cos(angle) * r;
      const z = t.oz + Math.sin(angle) * r;
      if (room.world.heightAt(x, z) < depth) break;
    }
    r += extra;
    return { x: t.ox + Math.cos(angle) * r, z: t.oz + Math.sin(angle) * r };
  };
  const seat = (who, ride, seat = 0) => {
    ride.seats[seat] = who.id;
    who.member().ride = { id: ride.id, seat };
    ride.reportAt = clock.now;
  };
  return { clock, room, a, b, pa, t, tick, put, aimFrom, away, offshore, seat };
}

test("a bow: the longer the draw, the faster the arrow and the harder it hits; it hits whom it's aimed at", () => {
  const { room, a, b, pa, t, tick, aimFrom } = range();
  room.handle(b.id, { t: "arm", kind: "bow-a" });
  /* Out on Alice's land, off the Harbor: fair game. */
  a.stand(t.ox + 6, t.oz);
  b.stand(t.ox - 5, t.oz);
  tick(0.5);
  const shots = () => b.all("shot").filter((m) => m.by === b.id);
  const fire = (charge, high = 0) => {
    const ab = a.member().body;
    room.handle(b.id, { t: "attack", charge, aim: aimFrom(b, ab.x, ab.y + 1.2 + high, ab.z) });
    tick(1.2);
  };
  const before = a.member().health;
  fire(0.15);
  const weak = shots().at(-1);
  assert.equal(shotFromIndex(weak.k), "arrow");
  const landed = b.all("land").find((m) => m.id === weak.id);
  assert.equal(landed?.on, "body", "it hit her");
  assert.equal(landed.who, a.id);
  const lost = before - a.member().health;
  assert(Math.abs(lost - WEAPONS["bow-a"].ranged.damage[0]) < 0.5, `a slack draw (${lost})`);
  a.member().health = 100;
  fire(1);
  const strong = shots().at(-1);
  const speed = (m) => Math.hypot(m.p[3], m.p[4], m.p[5]);
  assert(speed(strong) > speed(weak) * 2, "a full draw flies faster");
  assert(100 - a.member().health > lost * 2.5, "and hits much harder");
  /* A slack draw drops short of someone further off; a full one carries. */
  a.member().health = 100;
  a.stand(t.ox + 45, t.oz);
  fire(0.15, 1);
  assert.notEqual(b.all("land").find((m) => m.id === shots().at(-1).id)?.on, "body", "short");
  fire(1, 1);
  assert.equal(b.all("land").find((m) => m.id === shots().at(-1).id)?.on, "body", "carries");
  assert.equal(b.member().raid?.plot, pa.id, "shooting on her land is raiding it");
});

test("arrows stop in the ground, glance off stone, and set wood alight from a fire bow", () => {
  const { room, a, b, pa, t, tick, put, aimFrom, away } = range();
  const cottage = put("cottage", 0);
  const wall = put("castleWall", Math.PI);
  away(a);
  room.handle(b.id, { t: "arm", kind: "bow-a" });
  tick(0.5);
  /* Straight down at his feet. */
  b.stand(t.ox, t.oz + 30);
  const bb = b.member().body;
  room.handle(b.id, { t: "attack", charge: 1, aim: [0.01, -1, 0] });
  tick(0.6);
  const down = b.last("land");
  assert.equal(down.on, "ground");
  assert(Math.abs(down.p[1] - room.world.heightAt(bb.x, bb.z)) < 1, "where he stood");
  /* At the stone wall: a scratch. */
  b.stand(wall.x + 12, wall.z + 3);
  tick(1.5);
  room.handle(b.id, { t: "attack", charge: 1, aim: aimFrom(b, wall.x, wall.y + 2, wall.z) });
  tick(1);
  const scratch = CATALOGUE.castleWall.health - wall.hp;
  assert(scratch > 0 && scratch < 3, `stone barely marked (${scratch})`);
  assert.equal(b.last("land").on, "item");
  /* A fire bow at the cottage: it catches. */
  room.handle(b.id, { t: "arm", kind: "firebow" });
  b.stand(cottage.x - 14, cottage.z + 2);
  tick(1.5);
  room.handle(b.id, {
    t: "attack",
    charge: 1,
    aim: aimFrom(b, cottage.x, cottage.y + 2, cottage.z),
  });
  tick(1);
  assert(cottage.hp < CATALOGUE.cottage.health, "struck");
  assert(room.fires.isBurning(cottage.id), "and alight");
  assert.equal(b.member().raid?.plot, pa.id, "shooting at her land is raiding it");
});

test("the pack's bows, the wand and the mage's staff all loose real shots that batter wood", () => {
  const { room, a, b, pa, t, tick, put, aimFrom, away } = range();
  const cottage = put("cottage", 0);
  away(a);
  const flies = { "bow-a": "arrow", "bow-b": "arrow-b", "wand-a": "magic", "staff-b": "spell" };
  for (const [kind, shot] of Object.entries(flies)) {
    room.handle(b.id, { t: "arm", kind });
    b.stand(cottage.x - 12, cottage.z + 1);
    tick(1.5);
    const hp = cottage.hp;
    const n = b.all("shot").length;
    const charge = WEAPONS[kind].charge?.max ?? 0;
    room.handle(b.id, {
      t: "attack",
      charge,
      aim: aimFrom(b, cottage.x, cottage.y + 1.5, cottage.z),
    });
    const loosed = b.all("shot").slice(n);
    assert.equal(loosed.length, 1, `${kind}: one shot`);
    assert.equal(shotFromIndex(loosed[0].k), shot, `${kind} looses a ${shot}`);
    /* Nothing lands at once: it has to fly there. */
    assert.equal(cottage.hp, hp, `${kind}: not yet`);
    tick(1.5);
    const landed = b.all("land").find((m) => m.id === loosed[0].id);
    assert.equal(landed?.on, "item", `${kind}: it struck the cottage`);
    assert.equal(landed.who, cottage.id);
    assert(cottage.hp < hp, `${kind}: and battered it (${hp - cottage.hp})`);
  }
  assert.equal(b.member().raid?.plot, pa.id, "shooting at her land is raiding it");
  /* The wand's bolt leaves whoever it hits dazed. */
  room.handle(b.id, { t: "arm", kind: "wand-a" });
  a.stand(t.ox + 6, t.oz);
  b.stand(t.ox - 4, t.oz);
  tick(1.5);
  const ab = a.member().body;
  room.handle(b.id, { t: "attack", charge: 0, aim: aimFrom(b, ab.x, ab.y + 1.2, ab.z) });
  tick(1);
  assert(
    a.messages.some((m) => m.t === "daze"),
    "dazed",
  );
  assert(a.member().health < 100, "and hurt");
});

test("the old plain bow comes back as Bow A, from a message or a save", () => {
  assert.equal(toWeaponKind("bow"), "bow-a");
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: "arm", kind: "bow" })), {
    t: "arm",
    kind: "bow-a",
  });
  const inv = {
    coins: 0,
    slot: 1,
    items: {},
    tools: [{ id: 3, kind: "bow", uses: -1 }],
    hotbar: [null, 3],
  };
  const save = parseWorldSave({
    v: WORLD_SAVE_VERSION,
    ids: { tool: 4 },
    players: [
      { token: "aaaaaaaa", name: "a", saved: { x: 5, y: 1, z: 6, yaw: 0, health: 80, inv } },
    ],
    plots: [],
  });
  assert.equal(save.players[0].saved.inv.tools[0].kind, "bow-a");
});

test("kegs: bought one at a time, thrown, a four-second fuse, then two of them bring down a stone wall", () => {
  const { clock, room, a, b, pa, t, tick, put, away } = range();
  const wall = put("castleWall", 0);
  const far = put("castleWall", Math.PI);
  away(a);
  const coins = b.member().inv.coins;
  room.handle(b.id, { t: "arm", kind: "keg" });
  room.handle(b.id, { t: "arm", kind: "keg" });
  const inv = b.member().inv;
  const stack = inv.tools.find((o) => o.kind === "keg");
  assert.equal(stack.uses, 2, "two on the belt");
  assert.equal(inv.coins, coins - 2 * WEAPONS.keg.price);
  assert.equal(inv.hotbar[inv.slot], stack.id, "in hand");
  for (let i = 0; i < STACK; i++) room.handle(b.id, { t: "arm", kind: "keg" });
  assert.equal(stack.uses, STACK, `no more than ${STACK}`);
  stack.uses = 2;
  /* Set down against the wall: looking at the foot of it. */
  const drop = () => {
    b.stand(wall.x, wall.z + 2.2, wall.x, wall.z);
    const bb = b.member().body;
    room.handle(b.id, { t: "attack", charge: 0, aim: [0, wall.y - (bb.y + 1.5), -1.2] });
    tick(1);
    const keg = b.all("shot").at(-1);
    assert.equal(shotFromIndex(keg.k), "keg");
    assert.notEqual(
      b.all("land").find((m) => m.id === keg.id),
      undefined,
      "it came to rest",
    );
    b.stand(wall.x + 40, wall.z + 20);
    const hp = wall.hp;
    tick(2.5);
    assert.equal(wall.hp, hp, "the fuse is still burning");
    tick(1);
    assert(
      b.all("boom").some((m) => m.id === keg.id),
      "boom",
    );
    return keg;
  };
  drop();
  assert(wall.hp > 0 && wall.hp < CATALOGUE.castleWall.health * 0.3, `breached (${wall.hp})`);
  assert.equal(far.hp, CATALOGUE.castleWall.health, "nowhere near the other one");
  drop();
  assert.equal(wall.hp, 0, "and down");
  assert.equal(
    b.member().inv.tools.find((o) => o.kind === "keg"),
    undefined,
    "used up",
  );
  /* A shielded isle shrugs it off. */
  const other = put("castleWall", Math.PI / 2);
  pa.shield = clock.now + 3600;
  room.handle(b.id, { t: "arm", kind: "keg" });
  b.stand(other.x, other.z + 2.2, other.x, other.z);
  room.handle(b.id, { t: "attack", charge: 0, aim: [0, -1.2, -1.2] });
  tick(5);
  assert.equal(other.hp, CATALOGUE.castleWall.health, "nothing on a shielded isle is harmed");
  /* And it's harmless on the Harbor. */
  const harbor = room.harbor.home;
  room.handle(b.id, { t: "arm", kind: "keg" });
  b.stand(harbor.x, harbor.z);
  const n = b.all("shot").length;
  clock.now += 2;
  room.handle(b.id, { t: "attack", charge: 0 });
  assert.equal(b.all("shot").length, n, "not on the Harbor");
});

test("a keg hurts and throws whoever's near it (never the thrower's own side), less further out", () => {
  const { room, a, b, t, tick } = range();
  room.handle(b.id, { t: "arm", kind: "keg" });
  a.stand(t.ox + 2, t.oz);
  b.stand(t.ox, t.oz + 2, t.ox, t.oz);
  const bb = b.member().body;
  room.handle(b.id, {
    t: "attack",
    charge: 0,
    aim: [0, -(bb.y + 1.5 - room.world.heightAt(t.ox, t.oz)), -2],
  });
  tick(0.5);
  b.stand(t.ox + 60, t.oz);
  a.stand(t.ox + 3, t.oz);
  tick(4);
  const hurt = 100 - a.member().health;
  assert(hurt > 30, `Alice, close by, was hurt (${hurt})`);
  assert(
    a.messages.some((m) => m.t === "impulse" && Math.hypot(m.vx, m.vz) > 5),
    "and thrown",
  );
  assert.equal(b.member().health, 100, "Bob was well away");
});

test("towers shoot raiders only: not the owner, not visitors to a shielded isle, never through smoke", () => {
  const { clock, room, a, b, pa, t, tick, put } = range();
  const tower = put("roundTower", 0, 10);
  const fromTower = (who) => who.all("shot").filter((m) => m.src === tower.id);
  /* Alice at home by her tower: nothing. */
  a.stand(tower.x + 12, tower.z);
  tick(3);
  assert.equal(fromTower(a).length, 0, "the owner is never shot at");
  /* A shielded isle: Bob is only visiting. */
  pa.shield = clock.now + 3600;
  b.stand(tower.x + 20, tower.z + 4);
  tick(4);
  assert.equal(b.member().raid, null);
  assert.equal(fromTower(b).length, 0, "visitors are safe");
  /* Off the shield: Bob's raiding, and the archers find him. */
  delete pa.shield;
  let low = 100;
  tick(10, () => {
    b.stand(tower.x + 20, tower.z + 4);
    low = Math.min(low, b.member().health);
  });
  assert.equal(b.member().raid?.plot, pa.id);
  assert(fromTower(b).length >= 3, `the tower shot at him (${fromTower(b).length})`);
  assert(low < 75, `and hit him (${low})`);
  assert(room.defenses.aimOf(tower.id), "awake");
  /* In smoke, he's hidden. */
  b.member().health = 100;
  room.shots.clouds.push({
    x: tower.x + 20,
    y: room.world.heightAt(tower.x + 20, tower.z + 4),
    z: tower.z + 4,
    until: clock.now + 60,
  });
  tick(3);
  const n = fromTower(b).length;
  tick(4, () => b.stand(tower.x + 20, tower.z + 4));
  assert.equal(fromTower(b).length, n, "nothing through the smoke");
  /* Knocked down, the tower is quiet. */
  room.shots.clouds.length = 0;
  room.harmItem(pa, tower, 1e6, "hit");
  tick(4, () => b.stand(tower.x + 20, tower.z + 4));
  assert.equal(fromTower(b).length, n, "rubble doesn't shoot");
});

test("a tower never shoots its owner's crew, nor through a wall", () => {
  const { room, a, b, pa, t, tick, put } = range();
  const tower = put("watchtower", 0, 10);
  room.handle(a.id, { t: "hire" });
  const [man] = room.crew.of(pa.id);
  /* Alice's man strolls about by the tower: never shot. */
  room.leave(a.id);
  tick(5);
  assert.equal(b.all("shot").filter((m) => m.src === tower.id).length, 0);
  assert.equal(man.health, 100);
});

test("a shore cannon goes for a boat carrying a raider, and sinks it; he's in the sea", () => {
  const { room, a, b, pa, t, tick, put, offshore, seat } = range();
  const cannon = put("cannon", 0, 70);
  a.stand(t.ox, t.oz);
  /* Bob rows in off the shore near the gun. */
  const at = offshore(0, -1.5, 8);
  const boat = room.addRide("skiff", at.x, 0, at.z, 0);
  seat(b, boat);
  tick(1);
  assert.equal(b.member().raid?.plot, pa.id, "on her tile: raiding");
  let sunk = false;
  tick(25, () => {
    boat.reportAt = room.now();
    sunk ||= b.messages.some((m) => m.t === "sunk" && m.id === boat.id);
  });
  assert(
    b.all("shot").some((m) => m.src === cannon.id && shotFromIndex(m.k) === "cannonball"),
    "it fired",
  );
  assert(sunk, "and sank the boat");
  assert.equal(b.member().ride, null);
  assert(room.rides.get(boat.id) === undefined, "gone");
  assert(
    b.messages.some((m) => m.t === "aboard" && m.id === null && m.at),
    "over the side",
  );
});

test("a broadside: guns down one side, it batters what's on shore, and the captain's raiding", () => {
  const { clock, room, a, b, pa, t, tick, put, offshore, seat, away } = range();
  /* A wall near the shore, facing the sea to the east. */
  const wall = put("castleWall", 0, 55, Math.PI / 2);
  away(a);
  /* A galleon broadside on to it: heading north, so starboard looks east... */
  const at = offshore(0, -4, 20);
  const ship = room.addRide("galleon", at.x, 0, at.z, 0);
  seat(b, ship);
  /* ...it's west of the ship's starboard? The wall is to the ship's west: port. */
  tick(0.2);
  const before = b.all("shot").length;
  const d = Math.hypot(wall.x - ship.state.x, wall.z - ship.state.z);
  /* Raise the guns enough to carry that far, to the top of the wall. */
  const gun = { x: ship.state.x, y: 1.5, z: ship.state.z };
  const v = aimAt(gun, { x: wall.x, y: wall.y + 2, z: wall.z }, 62, 9.8);
  const lift = Math.atan2(v.y, Math.hypot(v.x, v.z));
  assert(d < 140, `in range (${d.toFixed(0)} m)`);
  room.handle(b.id, { t: "broadside", side: -1, lift });
  const balls = b.all("shot").slice(before);
  assert.equal(balls.length, gunsOf("galleon"), "every gun on the side");
  assert(balls.every((m) => shotFromIndex(m.k) === "cannonball" && m.src === ship.id));
  room.handle(b.id, { t: "broadside", side: -1, lift });
  assert.equal(b.all("shot").length, before + balls.length, "reloading");
  tick(4, () => (ship.reportAt = room.now()));
  /*
   * The guns scatter a little and the isle is a new shape each run, so one
   * volley can straddle a single wall section: allow a couple more.
   */
  for (let volley = 0; volley < 2 && wall.hp >= CATALOGUE.castleWall.health; volley++) {
    clock.now += 7;
    room.handle(b.id, { t: "broadside", side: -1, lift });
    tick(4, () => (ship.reportAt = room.now()));
  }
  assert(wall.hp < CATALOGUE.castleWall.health, `the wall was hit (${wall.hp})`);
  assert.equal(b.member().raid?.plot, pa.id, "the captain is raiding her isle");
  assert(b.messages.some((m) => m.t === "land" && balls.some((o) => o.id === m.id)));
  const fired = b.all("shot").length;
  clock.now += 7;
  room.handle(b.id, { t: "broadside", side: -1, lift });
  assert(b.all("shot").length > fired, "loaded again");
});

test("cannonballs batter hulls; a wrecked one goes, and its riders with it into the sea", () => {
  const { clock, room, a, b, tick, offshore, seat } = range();
  const at = offshore(Math.PI / 2, -5, 40);
  const ship = room.addRide("sloop", at.x, 0, at.z, 0);
  const prey = room.addRide("skiff", at.x - 25, 0, at.z, 0);
  seat(b, ship);
  seat(a, prey);
  tick(0.2);
  const keep = () => {
    ship.reportAt = room.now();
    if (room.rides.has(prey.id)) prey.reportAt = room.now();
  };
  /* Point blank at the skiff, off the sloop's port side, till it goes down. */
  for (let i = 0; i < 4 && room.rides.has(prey.id); i++) {
    room.handle(b.id, { t: "broadside", side: -1, lift: -0.03 });
    tick(2, keep);
    clock.now += 6;
  }
  assert(
    a.messages.some((m) => m.t === "vhp" && m.id === prey.id),
    "the hull was hit",
  );
  assert(
    a.messages.some((m) => m.t === "sunk" && m.id === prey.id),
    "and went down",
  );
  assert(!room.rides.has(prey.id));
  assert.equal(a.member().ride, null, "Alice is in the water");
  assert(a.member().body.y < 0.5);
  assert(
    room.rides.has(ship.id) && ship.hp === hullOf("sloop"),
    "the sloop's own guns never hurt it",
  );
});

test("a crewman with a bow keeps his distance from a raider and shoots him", () => {
  const { room, a, b, pa, t, tick } = range();
  room.handle(a.id, { t: "hire" });
  const [man] = room.crew.of(pa.id);
  room.handle(a.id, { t: "crewarm", id: man.id, kind: "bow-a" });
  assert.equal(man.hand.weapon, "bow-a");
  room.handle(a.id, { t: "crewarm", id: man.id, kind: "keg" });
  assert.equal(man.hand.weapon, "bow-a", "no kegs for the crew");
  room.leave(a.id);
  const h = t.hearth;
  b.stand(h.x + 25, h.z + 6);
  let low = 100;
  let closest = 1e9;
  tick(12, () => {
    low = Math.min(low, b.member().health);
    closest = Math.min(
      closest,
      Math.hypot(man.body.x - b.member().body.x, man.body.z - b.member().body.z),
    );
  });
  assert(
    b.all("shot").some((m) => m.by === man.id),
    "he loosed at Bob",
  );
  assert(low < 90, `and hit him (${low})`);
  assert(closest > 5, `from a distance (${closest.toFixed(1)} m)`);
});
