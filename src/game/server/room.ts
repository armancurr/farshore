import {
  BOUNDARY,
  BREATH_MAX,
  BREATH_REGEN,
  BREATH_UNDER,
  BREATH_WADE,
  DROWN_DAMAGE,
  FALL_DAMAGE,
  FALL_SAFE_SPEED,
  HEALTH_MAX,
  HEALTH_REGEN,
  ISLAND_RADIUS,
  MAX_PLAYERS,
  PLAYER_HEIGHT,
  REGEN_DELAY,
  RESPAWN_DELAY,
  SEA_FLOOR,
  SEA_LEVEL,
  TICK_HZ,
} from "../shared/constants";
import { clamp, mulberry32, type Rng } from "../shared/math";
import { randomName } from "../shared/names";
import { type Body, createBody } from "../shared/physics";
import {
  type ClientMsg,
  FLAG,
  type GroundWeapon,
  type HurtCause,
  type PlayerSnap,
  round2,
  type ServerMsg,
  type Spawn,
  type WorldInfo,
} from "../shared/protocol";
import {
  emptyInventory,
  HOTBAR,
  heldTool,
  type Inventory,
  MAX_TOOLS,
  type Tool,
  type ToolKind,
  TOOLS,
} from "../shared/items";
import { Terrain } from "../shared/terrain";
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

export interface Peer {
  send(msg: ServerMsg): void;
}

type Member = {
  id: number;
  name: string;
  peer: Peer;
  spectator: boolean; // joined only to watch
  body: Body;
  pitch: number;
  flags: number;
  breath: number;
  health: number;
  lastHurtAt: number;
  /* Falling speed from the last airborne report, for landing damage. */
  airVy: number;
  /* While down: when you get back up. */
  respawnAt: number | null;
  attackReadyAt: number;
  shoveFlagUntil: number;
  inv: Inventory;
  /* Something in the inventory changed; send it at the end of the step. */
  invDirty: boolean;
  stagger: number;
  lastHitAt: number;
  combo: number;
  lastSwingAt: number;
  blocking: boolean;
  blockSince: number;
  charging: boolean;
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
  now?: () => number;
  maxHumans?: number;
  seed?: number;
};

/* Loose weapons lying about the island; a fresh one washes up when the count drops. */
const GROUND_WEAPONS = 8;
const WEAPON_RESPAWN = 45;

/*
 * The island. Transport-agnostic: the Cloudflare Durable Object, the Vite dev
 * server and the in-browser solo mode all drive this same class. The room
 * runs the world and everything in it; each human reports their own movement
 * and asks for everything else.
 */
export class Room {
  private members = new Map<number, Member>();
  private nextId = 1;
  private readonly terrain: Terrain;
  private readonly seed: number;
  /* World clock in seconds; it only advances while the room ticks. */
  private time = 0;
  private lastTick: number | null = null;
  private weapons: GroundWeapon[] = [];
  private weaponId = 1;
  private toolId = 1;
  private nextWeaponAt = 0;
  private pending: PendingHit[] = [];
  private rng: Rng;
  private readonly now: () => number;

  constructor(private readonly opts: RoomOptions) {
    this.now = opts.now ?? (() => Date.now() / 1000);
    this.rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
    this.seed = opts.seed ?? (this.rng() * 2 ** 32) >>> 0;
    this.terrain = new Terrain(this.seed);
    for (let i = 0; i < GROUND_WEAPONS; i++) this.spawnWeapon(WEAPON_KINDS[i % 8], false);
  }

  humans() {
    let n = 0;
    for (const m of this.members.values()) if (!m.spectator) n++;
    return n;
  }

  join(peer: Peer, hello: { spectate?: boolean } = {}) {
    const spectator = !!hello.spectate;
    if (!spectator && this.humans() >= (this.opts.maxHumans ?? MAX_PLAYERS)) {
      peer.send({ t: "full" });
      return -1;
    }
    const id = this.nextId++;
    const h = this.terrain.home;
    const member: Member = {
      id,
      name: randomName(Math.random),
      peer,
      spectator,
      body: createBody(h.x, h.y, h.z, h.yaw),
      pitch: 0,
      flags: 0,
      breath: BREATH_MAX,
      health: HEALTH_MAX,
      lastHurtAt: -1e9,
      airVy: 0,
      respawnAt: null,
      attackReadyAt: 0,
      shoveFlagUntil: 0,
      inv: emptyInventory(),
      invDirty: true,
      stagger: 0,
      lastHitAt: 0,
      combo: 0,
      lastSwingAt: 0,
      blocking: false,
      blockSince: 0,
      charging: false,
    };
    if (!spectator) this.giveTool(member, "rod", 2);
    this.members.set(id, member);
    peer.send({ t: "welcome", id, name: member.name, online: this.opts.online });
    peer.send({ t: "world", ...this.worldInfo(member) });
    if (!spectator) {
      this.broadcastRoster();
      if (this.opts.online) this.feed(`${member.name} washed ashore`);
    }
    this.flush(member);
    return id;
  }

  leave(id: number) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    if (!m.spectator) {
      this.broadcastRoster();
      if (this.opts.online) this.feed(`${m.name} left`);
    }
  }

  handle(id: number, msg: ClientMsg) {
    const m = this.members.get(id);
    if (!m || m.spectator || m.respawnAt !== null) return;
    this.apply(m, msg);
    this.flush(m);
  }

  private apply(m: Member, msg: ClientMsg) {
    switch (msg.t) {
      case "move": {
        this.landing(m, msg.vy, msg.flags);
        m.body.yaw = msg.yaw;
        m.pitch = msg.pitch;
        m.body.x = clamp(msg.x, -BOUNDARY, BOUNDARY);
        m.body.y = clamp(msg.y, SEA_FLOOR - 20, this.terrain.peak + 30);
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
        const weapon = this.weaponOf(m);
        const block = msg.block && weapon === "shield";
        if (block && !m.blocking) m.blockSince = this.now();
        m.blocking = block;
        m.charging = msg.charge && !!weapon && !!weaponDef(weapon).charge;
        return;
      }
      case "slot":
        if (m.inv.slot !== msg.i) {
          m.inv.slot = msg.i;
          m.blocking = false;
          m.charging = false;
          m.invDirty = true;
        }
        return;
      case "equip":
        this.equip(m, msg.tool, msg.slot);
        return;
      case "drop":
        this.drop(m, msg.tool);
        return;
      case "interact":
        if (msg.kind === "weapon") this.pickUp(m, msg.id);
        return;
      default:
        return;
    }
  }

  /* ---------- inventory ---------- */

  private weaponOf(m: Member) {
    const tool = heldTool(m.inv);
    return tool ? TOOLS[tool.kind].weapon : null;
  }

  /*
   * Add a tool to your pack: into the preferred hotbar slot if it's free,
   * otherwise the first free one, otherwise the pack. Null when you're full.
   */
  private giveTool(m: Member, kind: ToolKind, prefer: number, uses?: number): Tool | null {
    if (m.inv.tools.length >= MAX_TOOLS) return null;
    const def = TOOLS[kind];
    const max = def.weapon && !def.fine ? weaponDef(def.weapon).uses : -1;
    const tool: Tool = { id: this.toolId++, kind, uses: uses ?? max };
    m.inv.tools.push(tool);
    const bar = m.inv.hotbar;
    let slot = bar[prefer] == null ? prefer : -1;
    for (let i = 1; i < HOTBAR && slot < 0; i++) if (bar[i] == null) slot = i;
    if (slot > 0) bar[slot] = tool.id;
    m.invDirty = true;
    return tool;
  }

  private removeTool(m: Member, id: number) {
    m.inv.tools = m.inv.tools.filter((t) => t.id !== id);
    m.inv.hotbar = m.inv.hotbar.map((t) => (t === id ? null : t));
    m.blocking = false;
    m.charging = false;
    m.invDirty = true;
  }

  private equip(m: Member, toolId: number, slot: number) {
    const inv = m.inv;
    if (!inv.tools.some((t) => t.id === toolId) || slot === 0) return;
    const from = inv.hotbar.indexOf(toolId);
    if (slot < 0) {
      if (from > 0) inv.hotbar[from] = null;
    } else {
      /* Swap with whatever's there (into our old slot, or back to the pack). */
      const there = inv.hotbar[slot];
      if (from > 0) inv.hotbar[from] = there;
      inv.hotbar[slot] = toolId;
    }
    m.blocking = false;
    m.charging = false;
    m.invDirty = true;
  }

  /* Put a found weapon back on the ground. Bought gear and rods stay with you. */
  private drop(m: Member, toolId: number) {
    const tool = m.inv.tools.find((t) => t.id === toolId);
    const weapon = tool && TOOLS[tool.kind].droppable ? TOOLS[tool.kind].weapon : null;
    if (!tool || !weapon) return;
    this.removeTool(m, tool.id);
    const dropped: GroundWeapon = {
      id: this.weaponId++,
      kind: weapon,
      x: round2(m.body.x - Math.sin(m.body.yaw) * 0.8),
      y: round2(m.body.y),
      z: round2(m.body.z - Math.cos(m.body.yaw) * 0.8),
      uses: tool.uses,
    };
    this.weapons.push(dropped);
    this.broadcast({ t: "wspawn", weapon: dropped });
  }

  private flush(m: Member) {
    if (!m.invDirty) return;
    m.invDirty = false;
    m.peer.send({ t: "inv", inv: structuredClone(m.inv) });
  }

  /* Drive the room; hosts call this TICK_HZ times a second. */
  tick() {
    const now = this.now();
    const dt = this.lastTick === null ? 1 / TICK_HZ : clamp(now - this.lastTick, 0, 0.25);
    this.lastTick = now;
    this.time += dt;
    this.simulate(now, dt);
    for (const m of this.members.values()) this.flush(m);
    this.broadcastSnap(now);
  }

  private simulate(now: number, dt: number) {
    this.resolveHits(now);

    for (const m of this.members.values()) {
      if (m.spectator) continue;
      const depth = SEA_LEVEL - m.body.y;
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
      if (m.respawnAt !== null) {
        if (now >= m.respawnAt) this.respawn(m);
        continue;
      }

      if (m.breath <= 0) this.hurt(m, DROWN_DAMAGE * dt, "drowned");
      else if (now - m.lastHurtAt > REGEN_DELAY && m.health < HEALTH_MAX)
        m.health = Math.min(HEALTH_MAX, m.health + HEALTH_REGEN * dt);

      /* Stagger wears off a few seconds after the last hit. */
      if (now - m.lastHitAt > STAGGER_GRACE)
        m.stagger = Math.max(0, m.stagger - STAGGER_RECOVER * dt);

      if (m.body.y < SEA_FLOOR - 8) this.hurt(m, HEALTH_MAX, "drowned");
    }

    if (this.weapons.length < GROUND_WEAPONS && this.time >= this.nextWeaponAt) {
      this.nextWeaponAt = this.time + WEAPON_RESPAWN;
      this.spawnWeapon(null, true);
    }
  }

  private spawnPoint(_m: Member): Spawn {
    const h = this.terrain.home;
    return { x: h.x, y: h.y, z: h.z, yaw: h.yaw };
  }

  /* Damage from any source. At zero you black out, and wake up somewhere safe. */
  private hurt(m: Member, amount: number, cause: HurtCause) {
    if (m.respawnAt !== null || amount <= 0) return;
    m.health = Math.max(0, m.health - amount);
    m.lastHurtAt = this.now();
    /* Drowning ticks every frame; only report the bigger knocks. */
    if (cause !== "drowned") m.peer.send({ t: "hurt", amount: Math.round(amount), cause });
    if (m.health > 0) return;
    m.respawnAt = this.now() + RESPAWN_DELAY;
    m.blocking = false;
    m.charging = false;
    m.peer.send({ t: "died", cause });
  }

  /* Hitting the ground hard hurts; landing in water doesn't. */
  private landing(m: Member, vy: number, flags: number) {
    const grounded = (flags & FLAG.grounded) !== 0;
    if (!grounded) {
      m.airVy = vy;
      return;
    }
    const impact = -m.airVy;
    m.airVy = 0;
    if (impact > FALL_SAFE_SPEED && !(flags & FLAG.wet))
      this.hurt(m, (impact - FALL_SAFE_SPEED) * FALL_DAMAGE, "fall");
  }

  private respawn(m: Member) {
    const s = this.spawnPoint(m);
    m.body = createBody(s.x, s.y, s.z, s.yaw);
    m.respawnAt = null;
    m.health = HEALTH_MAX;
    m.airVy = 0;
    m.breath = BREATH_MAX;
    m.stagger = 0;
    m.blocking = false;
    m.charging = false;
    m.peer.send({ t: "respawn", ...s });
  }

  /* ---------- weapons ---------- */

  /* Somewhere dry and open for a weapon: on the ground, or up on a structure. */
  private weaponSpot() {
    const terrain = this.terrain;
    const far = (x: number, z: number) =>
      this.weapons.every((w) => Math.hypot(w.x - x, w.z - z) > 22);
    const perches = terrain.perches;
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
      if (h < 3 || !far(x, z)) continue;
      const { ground } = terrain.groundAt(x, z, h + 0.1);
      if (ground > h + 0.05) continue;
      const blocked = terrain
        .solidsNear(x, z)
        .some(
          (s) => s.bottom < h + 1.8 && s.top > h + 0.2 && Math.hypot(s.x - x, s.z - z) < s.r + 0.8,
        );
      if (blocked) continue;
      return { x, y: h, z };
    }
    const best = perches[0];
    return best ? { x: best.x, y: best.y, z: best.z } : null;
  }

  private spawnWeapon(kind: WeaponKind | null, announce: boolean) {
    const k = kind ?? WEAPON_KINDS[Math.floor(this.rng() * WEAPON_KINDS.length)];
    const spot = this.weaponSpot();
    if (!spot) return;
    const weapon: GroundWeapon = {
      id: this.weaponId++,
      kind: k,
      x: round2(spot.x),
      y: round2(spot.y),
      z: round2(spot.z),
      uses: weaponDef(k).uses,
    };
    this.weapons.push(weapon);
    if (announce) this.broadcast({ t: "wspawn", weapon });
  }

  /* Pick a weapon up off the ground, into your hotbar if there's room. */
  private pickUp(m: Member, id: number) {
    const w = this.weapons.find((o) => o.id === id);
    if (!w) return;
    if (Math.hypot(w.x - m.body.x, w.z - m.body.z) > 3 || Math.abs(w.y - m.body.y) > 2.5) return;
    const tool = this.giveTool(m, w.kind, 1, w.uses);
    if (!tool) {
      m.peer.send({ t: "feed", text: "Your pack is full" });
      return;
    }
    this.weapons = this.weapons.filter((o) => o !== w);
    /* Picking something up puts it in your hand. */
    const slot = m.inv.hotbar.indexOf(tool.id);
    if (slot > 0) m.inv.slot = slot;
    m.blocking = false;
    m.charging = false;
    this.broadcast({ t: "wtake", id: w.id, by: m.id, kind: w.kind });
  }

  /* One use off the held weapon; when it's spent it breaks. Bought gear never does. */
  private wear(m: Member) {
    const tool = heldTool(m.inv);
    const weapon = tool && TOOLS[tool.kind].weapon;
    if (!tool || !weapon || tool.uses < 0) return;
    tool.uses--;
    m.invDirty = true;
    if (tool.uses > 0) return;
    this.removeTool(m, tool.id);
    this.broadcast({ t: "wbreak", by: m.id, kind: weapon });
  }

  private attack(m: Member, charge: number, climb: boolean) {
    const now = this.now();
    if (now < m.attackReadyAt || m.blocking) return;
    const tool = heldTool(m.inv);
    if (tool && TOOLS[tool.kind].rod) return;
    const kind = this.weaponOf(m);
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

  private push(o: Member, ix: number, iz: number, speed: number, lift: number) {
    o.peer.send({ t: "impulse", vx: ix * speed, vy: lift, vz: iz * speed });
  }

  private resolveHits(now: number) {
    if (!this.pending.length) return;
    const due = this.pending.filter((p) => p.at <= now);
    if (!due.length) return;
    this.pending = this.pending.filter((p) => p.at > now);
    for (const p of due) {
      const m = this.members.get(p.by);
      if (!m) continue;
      const def = weaponDef(p.kind);
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      for (const o of this.members.values()) {
        if (o === m || o.spectator || o.respawnAt !== null) continue;
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
        if (o.blocking && this.weaponOf(o) === "shield" && -facingAway > 0.2) {
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

  /* ---------- messages ---------- */

  private roster() {
    return [...this.members.values()]
      .filter((o) => !o.spectator)
      .map((o) => ({ id: o.id, name: o.name }));
  }

  private worldInfo(m: Member): WorldInfo {
    return {
      seed: this.seed,
      time: this.time,
      roster: this.roster(),
      weapons: this.weapons,
      you: m.spectator ? null : { x: m.body.x, y: m.body.y, z: m.body.z, yaw: m.body.yaw },
    };
  }

  private broadcastRoster() {
    this.broadcast({ t: "roster", roster: this.roster() });
  }

  private broadcast(msg: ServerMsg) {
    for (const m of this.members.values()) m.peer.send(msg);
  }

  private feed(text: string) {
    this.broadcast({ t: "feed", text });
  }

  private broadcastSnap(now: number) {
    const p: PlayerSnap[] = [];
    for (const m of this.members.values()) {
      if (m.spectator) continue;
      p.push([
        m.id,
        round2(m.body.x),
        round2(m.body.y),
        round2(m.body.z),
        round2(m.body.yaw),
        round2(m.pitch),
        m.flags |
          (m.respawnAt === null ? FLAG.alive : 0) |
          (now < m.shoveFlagUntil ? FLAG.shove : 0) |
          (m.blocking ? FLAG.block : 0) |
          (m.charging ? FLAG.charge : 0),
        Math.round(m.breath),
        weaponIndex(this.weaponOf(m)),
        Math.round(m.stagger),
      ]);
    }
    const time = round2(this.time);
    for (const m of this.members.values()) {
      m.peer.send({
        t: "snap",
        time,
        p,
        me: m.spectator
          ? null
          : {
              health: Math.ceil(m.health),
              breath: Math.round(m.breath),
              stagger: Math.round(m.stagger),
              dead: m.respawnAt !== null,
            },
      });
    }
  }

  /* Hosts use this to tell whether the room is worth ticking at all. */
  active() {
    return this.members.size > 0;
  }

  status() {
    return { humans: this.humans() };
  }
}
