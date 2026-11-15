import {
  BOUNDARY,
  BREATH_MAX,
  BREATH_REGEN,
  BREATH_UNDER,
  BREATH_WADE,
  CAIRN_REACH,
  COUNTDOWN_ONLINE,
  COUNTDOWN_SOLO,
  HURRY_RATE,
  ISLAND_RADIUS,
  MAX_PLAYERS,
  PILLAR_HEIGHT,
  PILLAR_RADIUS,
  PLAYER_HEIGHT,
  RESULTS_TIME,
  SEA_FLOOR,
  SHOVE_CREDIT,
  STONES_MAX,
  STONES_START,
  TICK_HZ,
} from "../shared/constants";
import { clamp, mulberry32, type Rng, wrapAngle } from "../shared/math";
import { randomName } from "../shared/names";
import { type Body, createBody, stepBody } from "../shared/physics";
import {
  type ClientMsg,
  FLAG,
  type GroundWeapon,
  type Held,
  type Phase,
  type Pillar,
  type Placement,
  type PlayerSnap,
  type RoundInfo,
  round2,
  type ServerMsg,
} from "../shared/protocol";
import { Terrain } from "../shared/terrain";
import { nextTide, tideAt } from "../shared/tide";
import {
  COMBO_WINDOW,
  knockScale,
  PARRY_WINDOW,
  STAGGER_GRACE,
  STAGGER_MAX,
  STAGGER_RECOVER,
  WEAPON_KINDS,
  type WeaponKind,
  weaponDef,
  weaponIndex,
} from "../shared/weapons";
import { type Brain, createBrain, think } from "./bots";

export interface Peer {
  send(msg: ServerMsg): void;
}

type Member = {
  id: number;
  name: string;
  bot: boolean;
  peer: Peer | null;
  spectator: boolean; // joined only to watch
  player: boolean; // taking part in the current round
  alive: boolean;
  body: Body;
  pitch: number;
  flags: number;
  breath: number;
  stones: number;
  attackReadyAt: number;
  shoveFlagUntil: number;
  shovedBy: { id: number; at: number } | null;
  weapon: Held | null;
  stagger: number;
  lastHitAt: number;
  combo: number;
  lastSwingAt: number;
  blocking: boolean;
  blockSince: number;
  charging: boolean;
  brain: Brain | null;
};

/* A swing in flight: it lands after the weapon's wind-up. */
type PendingHit = {
  at: number;
  by: number;
  kind: WeaponKind | null;
  heavy: boolean;
  /* 0..1: how far a flail was spun up. */
  power: number;
  yaw: number;
};

export type RoomOptions = {
  online: boolean;
  /* Bots only, forever: the idle background of the site. */
  attract?: boolean;
  now?: () => number;
  maxHumans?: number;
};

const MAX_PILLARS = 60;

/*
 * One match. Transport-agnostic: the Cloudflare Durable Object, the Vite dev
 * server and the in-browser solo mode all drive this same class. The room owns
 * the tide, breath, shoves, stones, bots and placements; each human reports
 * their own movement.
 */
export class Room {
  private members = new Map<number, Member>();
  private nextId = 1;
  private phase: Phase = "idle";
  private phaseEndsAt = 0;
  private startAt = 0;
  private endTime = 0;
  private terrain: Terrain | null = null;
  private seed = 0;
  private pillars: Pillar[] = [];
  private cairnsTaken = new Set<number>();
  private weapons: GroundWeapon[] = [];
  private weaponId = 1;
  private pending: PendingHit[] = [];
  private results: Placement[] = [];
  private hurryFrom: number | null = null;
  private pillarId = 1;
  private rng: Rng;
  private readonly now: () => number;

  constructor(private readonly opts: RoomOptions) {
    this.now = opts.now ?? (() => Date.now() / 1000);
    this.rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
    if (opts.attract) this.startCountdown();
  }

  humans() {
    let n = 0;
    for (const m of this.members.values()) if (!m.bot && !m.spectator) n++;
    return n;
  }

  join(peer: Peer, hello: { spectate?: boolean } = {}) {
    const spectator = !!hello.spectate;
    if (!spectator && this.humans() >= (this.opts.maxHumans ?? MAX_PLAYERS)) {
      peer.send({ t: "full" });
      return -1;
    }

    const id = this.nextId++;
    const member = this.createMember(id, randomName(Math.random), false, peer);
    member.spectator = spectator;
    this.members.set(id, member);
    peer.send({ t: "welcome", id, name: member.name, online: this.opts.online });

    if (this.phase === "idle") {
      if (!spectator) this.startCountdown();
    } else if (this.phase === "countdown" && !spectator) {
      this.enlist(member);
      this.broadcastRound();
    } else {
      this.sendRound(member);
    }
    if (!spectator && this.opts.online) this.feed(`${member.name} washed ashore`);
    return id;
  }

  leave(id: number) {
    const m = this.members.get(id);
    if (!m) return;
    if (m.player && m.alive && this.phase === "playing") this.eliminate(m, null);
    this.members.delete(id);
    if (!m.spectator && this.opts.online) this.feed(`${m.name} left`);
    if (this.humans() === 0 && !this.opts.attract) {
      this.phase = "idle";
      for (const other of [...this.members.values()]) if (other.bot) this.members.delete(other.id);
    } else if (this.phase === "countdown" && m.player) {
      this.fillBots();
      this.broadcastRound();
    }
  }

  handle(id: number, msg: ClientMsg) {
    const m = this.members.get(id);
    if (!m) return;
    switch (msg.t) {
      case "move": {
        m.body.yaw = msg.yaw;
        m.pitch = msg.pitch;
        if (!m.player || !m.alive || this.phase !== "playing") return;
        m.body.x = clamp(msg.x, -BOUNDARY, BOUNDARY);
        m.body.y = clamp(msg.y, SEA_FLOOR - 20, (this.terrain?.peak ?? 60) + 30);
        m.body.z = clamp(msg.z, -BOUNDARY, BOUNDARY);
        m.body.vx = msg.vx;
        m.body.vy = msg.vy;
        m.body.vz = msg.vz;
        m.flags = msg.flags & (FLAG.sprint | FLAG.grounded | FLAG.wet);
        return;
      }
      case "attack":
        this.attack(m, msg.charge, msg.climb);
        return;
      case "stance": {
        const block = msg.block && m.weapon?.kind === "shield";
        if (block && !m.blocking) m.blockSince = this.now();
        m.blocking = block;
        m.charging = msg.charge && !!m.weapon && !!weaponDef(m.weapon.kind).charge;
        return;
      }
      case "pick":
        this.pickNearest(m);
        return;
      case "stone":
        this.placeStone(m);
        return;
      default:
        return;
    }
  }

  /* Drive the room; hosts call this TICK_HZ times a second. */
  tick() {
    const now = this.now();
    if (this.phase === "idle") return;

    if (this.phase === "countdown" && now >= this.phaseEndsAt) {
      this.phase = "playing";
      this.startAt = now;
      this.phaseEndsAt = Number.POSITIVE_INFINITY;
      this.broadcastRound();
    } else if (this.phase === "results" && now >= this.phaseEndsAt) {
      if (this.humans() > 0 || this.opts.attract) this.startCountdown();
      else this.phase = "idle";
      return;
    }

    if (this.phase === "playing") this.simulate(now);
    this.broadcastSnap(now);
  }

  private roundTime(now: number) {
    if (this.phase === "countdown") return now - this.phaseEndsAt;
    if (this.phase === "results") return this.endTime;
    return now - this.startAt;
  }

  private tide(t: number) {
    return tideAt(t, this.hurryFrom ?? Number.POSITIVE_INFINITY, HURRY_RATE);
  }

  private createMember(id: number, name: string, bot: boolean, peer: Peer | null): Member {
    return {
      id,
      name,
      bot,
      peer,
      spectator: false,
      player: false,
      alive: false,
      body: createBody(0, 0, 0, 0),
      pitch: 0,
      flags: 0,
      breath: BREATH_MAX,
      stones: STONES_START,
      attackReadyAt: 0,
      shoveFlagUntil: 0,
      shovedBy: null,
      weapon: null,
      stagger: 0,
      lastHitAt: 0,
      combo: 0,
      lastSwingAt: 0,
      blocking: false,
      blockSince: 0,
      charging: false,
      brain: bot ? createBrain(this.rng) : null,
    };
  }

  private startCountdown() {
    const now = this.now();
    this.seed = (this.rng() * 2 ** 32) >>> 0;
    this.terrain = new Terrain(this.seed);
    this.pillars = [];
    this.weapons = [];
    this.pending = [];
    this.cairnsTaken.clear();
    this.results = [];
    this.hurryFrom = null;
    this.phase = "countdown";
    this.phaseEndsAt =
      now + (this.opts.attract ? 2 : this.opts.online ? COUNTDOWN_ONLINE : COUNTDOWN_SOLO);

    for (const m of [...this.members.values()]) {
      if (m.bot) this.members.delete(m.id);
      else {
        m.player = false;
        m.alive = false;
      }
    }
    for (const m of this.members.values()) {
      if (!m.spectator && this.playerCount() < MAX_PLAYERS) this.enlist(m);
    }
    this.fillBots();
    /* One weapon per player, scattered over the island. */
    for (let i = 0; i < this.playerCount(); i++) {
      const kind = WEAPON_KINDS[i % WEAPON_KINDS.length];
      this.spawnWeapon(kind, null, 3, false);
    }
    this.broadcastRound();
  }

  private playerCount() {
    let n = 0;
    for (const m of this.members.values()) if (m.player) n++;
    return n;
  }

  private freeSpawn() {
    const terrain = this.terrain!;
    const used = new Set<number>();
    for (const m of this.members.values()) {
      if (!m.player) continue;
      terrain.spawns.forEach((s, i) => {
        if (Math.hypot(s.x - m.body.x, s.z - m.body.z) < 1) used.add(i);
      });
    }
    const open = terrain.spawns.map((_, i) => i).filter((i) => !used.has(i));
    return terrain.spawns[open[Math.floor(this.rng() * open.length)] ?? 0];
  }

  /* Put a member into the round at a free spawn; a human bumps a bot if the room is full. */
  private enlist(m: Member) {
    if (this.playerCount() >= MAX_PLAYERS) {
      const bot = [...this.members.values()].find((b) => b.bot);
      if (!bot) return;
      this.members.delete(bot.id);
    }
    const spawn = this.freeSpawn();
    m.player = true;
    m.alive = true;
    m.body = createBody(spawn.x, spawn.y, spawn.z, spawn.yaw);
    m.pitch = 0;
    m.breath = BREATH_MAX;
    m.stones = STONES_START;
    m.attackReadyAt = 0;
    m.shovedBy = null;
    m.weapon = null;
    m.stagger = 0;
    m.combo = 0;
    m.blocking = false;
    m.charging = false;
  }

  private fillBots() {
    while (this.playerCount() < MAX_PLAYERS) {
      const bot = this.createMember(this.nextId++, randomName(this.rng), true, null);
      this.members.set(bot.id, bot);
      this.enlist(bot);
    }
  }

  private simulate(now: number) {
    const terrain = this.terrain!;
    const t = now - this.startAt;
    const tide = this.tide(t);
    const dt = 1 / TICK_HZ;
    const alive = [...this.members.values()].filter((m) => m.player && m.alive);

    /* Once every human is out, hurry the sea so the next round comes sooner. */
    if (this.hurryFrom === null && !this.opts.attract && !alive.some((m) => !m.bot)) {
      this.hurryFrom = t;
      this.broadcastRound();
    }

    const view = {
      terrain,
      pillars: this.pillars,
      tide,
      tideSoon: Math.max(tide, nextTide(t)),
      time: t,
      cairnsTaken: this.cairnsTaken,
      weapons: this.weapons,
      others: [] as { id: number; x: number; y: number; z: number; yaw: number }[],
    };

    this.resolveHits(now);

    for (const m of alive) {
      if (!m.bot || !m.brain) continue;
      view.others = alive
        .filter((o) => o !== m)
        .map((o) => ({ id: o.id, x: o.body.x, y: o.body.y, z: o.body.z, yaw: o.body.yaw }));
      const act = think(m, m.brain, view, now, this.rng);
      const turn = wrapAngle(act.yaw - m.body.yaw);
      m.body.yaw = wrapAngle(m.body.yaw + clamp(turn, -7 * dt, 7 * dt));
      m.pitch = 0;
      act.intent.speedScale = weaponDef(m.weapon?.kind ?? null).speed ?? 1;
      const world = { terrain, pillars: this.pillars, tide };
      stepBody(m.body, act.intent, dt / 2, world);
      stepBody(m.body, { ...act.intent, jump: false }, dt / 2, world);
      m.flags =
        (m.body.sprinting ? FLAG.sprint : 0) |
        (m.body.grounded ? FLAG.grounded : 0) |
        (m.body.y < tide ? FLAG.wet : 0);
      if (act.attack) this.attack(m, act.charge, false);
      if (act.stone) this.placeStone(m);
    }

    for (const m of alive) {
      const depth = tide - m.body.y;
      /* Under: drowning. Swimming: the cold. Paddling: a slow chill. Dry: recovering. */
      const rate =
        depth > PLAYER_HEIGHT - 0.25
          ? -BREATH_UNDER
          : depth > 0.9
            ? -BREATH_WADE
            : depth > 0
              ? -BREATH_WADE * 0.35
              : BREATH_REGEN;
      m.breath = clamp(m.breath + rate * dt, 0, BREATH_MAX);

      if (m.stones < STONES_MAX) {
        for (const c of terrain.cairns) {
          if (this.cairnsTaken.has(c.id)) continue;
          if (
            Math.hypot(c.x - m.body.x, c.z - m.body.z) < CAIRN_REACH &&
            Math.abs(c.y - m.body.y) < 2.5
          ) {
            this.cairnsTaken.add(c.id);
            m.stones++;
            this.broadcast({ t: "cairn", id: c.id, by: m.id });
            break;
          }
        }
      }

      /* Stagger wears off a few seconds after the last hit. */
      if (now - m.lastHitAt > STAGGER_GRACE)
        m.stagger = Math.max(0, m.stagger - STAGGER_RECOVER * dt);

      if (!m.weapon) {
        const w = this.weapons.find(
          (w) => Math.hypot(w.x - m.body.x, w.z - m.body.z) < 1.4 && Math.abs(w.y - m.body.y) < 1.9,
        );
        if (w) this.take(m, w);
      }

      if (m.breath <= 0 || m.body.y < SEA_FLOOR - 8) this.eliminate(m, now);
    }

    const remaining = [...this.members.values()].filter((m) => m.player && m.alive);
    if (remaining.length <= 1) this.finish(now, remaining[0] ?? null);
  }

  private eliminate(m: Member, now: number | null) {
    const before = [...this.members.values()].filter((o) => o.player && o.alive).length;
    m.alive = false;
    /* The sea takes the weapon too; it washes up somewhere dry. */
    if (m.weapon) {
      this.spawnWeapon(
        m.weapon.kind,
        m.weapon.uses,
        this.tide(now === null ? 0 : now - this.startAt) + 6,
      );
      m.weapon = null;
    }
    const credit =
      m.shovedBy && now !== null && now - m.shovedBy.at < SHOVE_CREDIT
        ? this.members.get(m.shovedBy.id)
        : undefined;
    this.results.push({ id: m.id, name: m.name, bot: m.bot, place: before, by: credit?.name });
    this.broadcast({ t: "out", id: m.id, by: credit?.id ?? null, place: before });
  }

  private finish(now: number, winner: Member | null) {
    if (winner) {
      winner.alive = false;
      this.results.push({ id: winner.id, name: winner.name, bot: winner.bot, place: 1 });
    }
    this.results.sort((a, b) => a.place - b.place);
    this.endTime = now - this.startAt;
    this.phase = "results";
    this.phaseEndsAt = now + RESULTS_TIME;
    this.broadcastRound();
  }

  /* ---------- weapons ---------- */

  /* Somewhere dry and open for a weapon: on the ground, or up on a structure. */
  private weaponSpot(minY: number) {
    const terrain = this.terrain!;
    const far = (x: number, z: number) =>
      this.weapons.every((w) => Math.hypot(w.x - x, w.z - z) > 22);
    const perches = terrain.highSpots.filter((s) => s.route && s.y > minY);
    for (let tries = 0; tries < 300; tries++) {
      if (perches.length && this.rng() < 0.3) {
        const p = perches[Math.floor(this.rng() * perches.length)];
        if (far(p.x, p.z)) return { x: p.x, y: p.y, z: p.z };
        continue;
      }
      const a = this.rng() * Math.PI * 2;
      const d = Math.sqrt(this.rng()) * ISLAND_RADIUS * 0.95;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const h = terrain.heightAt(x, z);
      if (h < minY || !far(x, z)) continue;
      const { ground } = terrain.groundAt(x, z, h + 0.1, this.pillars);
      if (ground > h + 0.05) continue;
      const blocked = terrain
        .solidsNear(x, z)
        .some(
          (s) => s.bottom < h + 1.8 && s.top > h + 0.2 && Math.hypot(s.x - x, s.z - z) < s.r + 0.8,
        );
      if (blocked) continue;
      return { x, y: h, z };
    }
    const best = terrain.highSpots[0];
    return best ? { x: best.x, y: best.y, z: best.z } : null;
  }

  private spawnWeapon(kind: WeaponKind | null, uses: number | null, minY: number, announce = true) {
    const k = kind ?? WEAPON_KINDS[Math.floor(this.rng() * WEAPON_KINDS.length)];
    const spot = this.weaponSpot(minY);
    if (!spot) return;
    const weapon: GroundWeapon = {
      id: this.weaponId++,
      kind: k,
      x: round2(spot.x),
      y: round2(spot.y),
      z: round2(spot.z),
      uses: uses ?? weaponDef(k).uses,
    };
    this.weapons.push(weapon);
    if (announce) this.broadcast({ t: "wspawn", weapon });
  }

  /* Pick a weapon up; whatever you held drops at your feet. */
  private take(m: Member, w: GroundWeapon) {
    this.weapons = this.weapons.filter((o) => o !== w);
    if (m.weapon) {
      const dropped: GroundWeapon = {
        id: this.weaponId++,
        kind: m.weapon.kind,
        x: round2(m.body.x),
        y: round2(m.body.y),
        z: round2(m.body.z),
        uses: m.weapon.uses,
      };
      this.weapons.push(dropped);
      this.broadcast({ t: "wspawn", weapon: dropped });
    }
    m.weapon = { kind: w.kind, uses: w.uses };
    m.blocking = false;
    m.charging = false;
    this.broadcast({ t: "wtake", id: w.id, by: m.id });
  }

  private pickNearest(m: Member) {
    if (!m.player || !m.alive || this.phase !== "playing") return;
    let best: GroundWeapon | null = null;
    let bestD = 2;
    for (const w of this.weapons) {
      const d = Math.hypot(w.x - m.body.x, w.z - m.body.z);
      if (d < bestD && Math.abs(w.y - m.body.y) < 2) {
        best = w;
        bestD = d;
      }
    }
    if (best) this.take(m, best);
  }

  /* One use off the weapon; when it's spent it breaks and a fresh one washes up. */
  private wear(m: Member) {
    if (!m.weapon) return;
    m.weapon.uses--;
    if (m.weapon.uses > 0) return;
    this.broadcast({ t: "wbreak", by: m.id, kind: m.weapon.kind });
    m.weapon = null;
    m.blocking = false;
    m.charging = false;
    this.spawnWeapon(null, null, this.tide(this.roundTime(this.now())) + 6);
  }

  private attack(m: Member, charge: number, climb: boolean) {
    const now = this.now();
    if (!m.player || !m.alive || this.phase !== "playing" || now < m.attackReadyAt) return;
    if (m.blocking) return;
    const kind = m.weapon?.kind ?? null;
    const def = weaponDef(kind);
    m.attackReadyAt = now + def.cooldown;
    m.shoveFlagUntil = now + 0.35;
    m.charging = false;

    let heavy = false;
    if (kind === "sword") {
      m.combo = now - m.lastSwingAt < COMBO_WINDOW ? m.combo + 1 : 1;
      if (m.combo >= 3) {
        heavy = true;
        m.combo = 0;
      }
    }
    m.lastSwingAt = now;
    let power = 1;
    if (def.charge && def.charge.max > def.charge.min) {
      const c = clamp(charge, def.charge.min, def.charge.max);
      power = (c - def.charge.min) / (def.charge.max - def.charge.min);
    }
    this.broadcast({ t: "swing", by: m.id, kind, heavy });
    /* A pickaxe swung at a wall is a climb, not an attack. */
    if (climb && kind === "pickaxe") return;
    this.pending.push({ at: now + def.windup, by: m.id, kind, heavy, power, yaw: m.body.yaw });
    this.wear(m);
  }

  /* Knock a member about: bots directly, humans by telling their client. */
  private push(o: Member, ix: number, iz: number, speed: number, lift: number) {
    if (o.bot) {
      o.body.vx += ix * speed;
      o.body.vz += iz * speed;
      o.body.vy = Math.max(o.body.vy, lift);
      o.body.grounded = false;
      o.body.ladderCooldown = 0.6;
    } else {
      o.peer?.send({ t: "impulse", vx: ix * speed, vy: lift, vz: iz * speed });
    }
  }

  private resolveHits(now: number) {
    const due = this.pending.filter((p) => p.at <= now);
    if (!due.length) return;
    this.pending = this.pending.filter((p) => p.at > now);
    for (const p of due) {
      const m = this.members.get(p.by);
      if (!m?.alive) continue;
      const def = weaponDef(p.kind);
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      for (const o of this.members.values()) {
        if (o === m || !o.player || !o.alive) continue;
        const dx = o.body.x - m.body.x;
        const dz = o.body.z - m.body.z;
        const d = Math.hypot(dx, dz);
        if (d > def.reach + 0.35 || Math.abs(o.body.y - m.body.y) > 2.2) continue;
        const nx = dx / (d || 1);
        const nz = dz / (d || 1);
        if (def.arc > -1 && d > 0.7 && nx * fx + nz * fz < def.arc) continue;

        let added = def.stagger;
        let knock = def.knock;
        let lift = def.lift;
        if (p.heavy) {
          added = 16;
          knock = 13;
          lift = 7;
        }
        if (p.kind === "flail") {
          added = 6 + 16 * p.power;
          knock = 7 + 8 * p.power;
          lift = 2.5 + 4 * p.power;
        }
        /* Which way the victim faces: away from us means a stab in the back. */
        const ofx = -Math.sin(o.body.yaw);
        const ofz = -Math.cos(o.body.yaw);
        const facingAway = ofx * nx + ofz * nz;
        if (p.kind === "daggers" && facingAway > 0.45) added *= 3;

        let blocked = false;
        let parry = false;
        if (o.blocking && o.weapon?.kind === "shield" && -facingAway > 0.2) {
          blocked = true;
          parry = now - o.blockSince < PARRY_WINDOW;
          if (p.kind === "axe") {
            added *= 0.5;
            knock *= 0.5;
            lift *= 0.5;
          } else {
            added = 0;
            knock *= 0.2;
            lift = 0;
          }
          this.wear(o);
          if (parry) {
            m.stagger = Math.min(STAGGER_MAX, m.stagger + 15);
            m.lastHitAt = now;
            m.shovedBy = { id: o.id, at: now };
            this.push(m, -nx, -nz, 8 * knockScale(m.stagger), 3);
            this.broadcast({
              t: "hit",
              by: o.id,
              target: m.id,
              kind: "shield",
              stagger: Math.round(m.stagger),
              added: 15,
              blocked: false,
              parry: true,
              heavy: false,
            });
          }
        }

        o.stagger = Math.min(STAGGER_MAX, o.stagger + added);
        if (added > 0) o.lastHitAt = now;
        let ix = nx;
        let iz = nz;
        if (def.arc > -1) {
          ix = nx * 0.5 + fx * 0.5;
          iz = nz * 0.5 + fz * 0.5;
          const il = Math.hypot(ix, iz) || 1;
          ix /= il;
          iz /= il;
        }
        this.push(o, ix, iz, knock * knockScale(o.stagger), lift * (1 + o.stagger / 200));
        o.shovedBy = { id: m.id, at: now };
        this.broadcast({
          t: "hit",
          by: m.id,
          target: o.id,
          kind: p.kind,
          stagger: Math.round(o.stagger),
          added: Math.round(added),
          blocked,
          parry,
          heavy: p.heavy,
        });
      }
    }
  }

  private placeStone(m: Member) {
    if (!m.player || !m.alive || this.phase !== "playing" || m.stones <= 0) return;
    if (this.pillars.length >= MAX_PILLARS) return;
    const terrain = this.terrain!;
    const { ground } = terrain.groundAt(m.body.x, m.body.z, m.body.y + 0.05, this.pillars);
    const bottom = Math.min(ground, m.body.y) - 0.3;
    const pillar: Pillar = {
      id: this.pillarId++,
      x: m.body.x,
      z: m.body.z,
      r: PILLAR_RADIUS,
      bottom,
      top: bottom + 0.3 + PILLAR_HEIGHT,
      standable: true,
      at: this.roundTime(this.now()),
    };
    m.stones--;
    this.pillars.push(pillar);
    this.broadcast({ t: "pillar", pillar });

    for (const o of this.members.values()) {
      if (!o.player || !o.alive) continue;
      if (Math.hypot(o.body.x - pillar.x, o.body.z - pillar.z) > pillar.r + 0.2) continue;
      if (o.body.y > pillar.top || o.body.y + PLAYER_HEIGHT < pillar.bottom) continue;
      if (o.bot) {
        o.body.y = pillar.top;
        o.body.vy = 0;
        o.body.grounded = true;
      } else {
        o.peer?.send({ t: "lift", y: pillar.top });
      }
    }
  }

  private roundInfo(m: Member): RoundInfo {
    const now = this.now();
    const ends = this.phaseEndsAt - now;
    return {
      phase: this.phase,
      seed: this.seed,
      time: this.roundTime(now),
      phaseEndsIn: Number.isFinite(ends) ? ends : -1,
      hurryFrom: this.hurryFrom,
      roster: [...this.members.values()]
        .filter((o) => o.player)
        .map((o) => ({ id: o.id, name: o.name, bot: o.bot })),
      cairnsTaken: [...this.cairnsTaken],
      pillars: this.pillars,
      weapons: this.weapons,
      results: this.results,
      you: {
        player: m.player,
        spawn:
          m.player && this.phase === "countdown"
            ? { x: m.body.x, y: m.body.y, z: m.body.z, yaw: m.body.yaw }
            : null,
      },
    };
  }

  private sendRound(m: Member) {
    m.peer?.send({ t: "round", ...this.roundInfo(m) });
  }

  private broadcastRound() {
    for (const m of this.members.values()) this.sendRound(m);
  }

  private broadcast(msg: ServerMsg) {
    for (const m of this.members.values()) m.peer?.send(msg);
  }

  private feed(text: string) {
    this.broadcast({ t: "feed", text });
  }

  private broadcastSnap(now: number) {
    const t = this.roundTime(now);
    const tide = this.phase === "playing" || this.phase === "results" ? this.tide(t) : this.tide(0);
    const p: PlayerSnap[] = [];
    for (const m of this.members.values()) {
      if (!m.player) continue;
      p.push([
        m.id,
        round2(m.body.x),
        round2(m.body.y),
        round2(m.body.z),
        round2(m.body.yaw),
        round2(m.pitch),
        m.flags |
          (m.alive ? FLAG.alive : 0) |
          FLAG.player |
          (now < m.shoveFlagUntil ? FLAG.shove : 0) |
          (m.blocking ? FLAG.block : 0) |
          (m.charging ? FLAG.charge : 0),
        Math.round(m.breath),
        weaponIndex(m.weapon?.kind ?? null),
        Math.round(m.stagger),
      ]);
    }
    for (const m of this.members.values()) {
      if (!m.peer) continue;
      m.peer.send({
        t: "snap",
        time: round2(t),
        tide: round2(tide),
        p,
        me: m.player
          ? {
              breath: Math.round(m.breath),
              stones: m.stones,
              alive: m.alive,
              weapon: m.weapon ? { ...m.weapon } : null,
              stagger: Math.round(m.stagger),
            }
          : null,
      });
    }
  }

  /* Used by hosts to tell whether the round is worth ticking at all. */
  active() {
    return this.phase !== "idle";
  }

  status() {
    return { humans: this.humans(), phase: this.phase };
  }

  /* Test hook: freeze-frame of who is alive. */
  debugAlive() {
    return [...this.members.values()]
      .filter((m) => m.player && m.alive)
      .map((m) => ({ name: m.name, bot: m.bot, y: m.body.y }));
  }
}
