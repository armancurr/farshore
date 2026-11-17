import { angleTo, clamp, type Rng, wrapAngle } from "../shared/math";
import { ANIMAL_FLAG, ANIMAL_STATE, type AnimalSnap, round2 } from "../shared/protocol";
import { ALPHA, type Role, SPECIES, type SpeciesId, speciesIndex } from "../shared/species";
import { overSolid, type Terrain } from "../shared/terrain";

/*
 * The hunting islands' animals, simulated by the room. Each is a small state
 * machine stepped at the tick rate: no pathfinding, just steering with a few
 * probes so they keep out of the sea, off cliffs and out of walls. Every
 * animal belongs to one island and never leaves it.
 *
 *   prey      graze and wander; anyone running at them, or hitting them,
 *             sends them bolting until they tire.
 *   defender  graze too, but come close and they square up, charge, and
 *             gore you, backing off to charge again.
 *   predator  notice you from afar, close in at a run and bite, again and
 *             again; the pack joins in. Badly hurt, they slink away.
 *
 * Animals keep in groups. The first of a group still standing leads: the
 * rest graze round it and drift after it when it moves. Alarm one and the
 * whole group knows: prey stampede together, a herd's guard (a bull with its
 * cows) comes for whoever caused it, and a pack hunts as one, each wolf
 * swinging out to its own side before it closes, so they come from all round.
 */

/* How far the rest of a group strays from its leader before they catch up. */
const SPREAD: Partial<Record<SpeciesId, number>> = { cow: 9, wolf: 7, bull: 9 };
const SPREAD_DEFAULT = 13;
/* A pack fans out this wide (radians either side) and this far off its quarry before closing in. */
const FLANK = 0.75;
const FLANK_RING = 7;

/* Seconds a normal animal stays gone after it's killed. */
const RESPAWN = 90;
/* Seconds a body lies there before it goes. */
const CORPSE = 2.5;

type State = keyof typeof ANIMAL_STATE;

export type Animal = {
  id: number;
  species: SpeciesId;
  island: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  max: number;
  state: State;
  /* When the current state runs out. */
  until: number;
  /* Where it's walking to, when wandering. */
  tx: number;
  tz: number;
  /* Who it's running from, or charging at. */
  target: number | null;
  /* How long it's been running, for tiring. */
  ran: number;
  /* Dead or waiting to come back: when it reappears. */
  respawnAt: number | null;
  /* A predator's next bite. */
  biteAt: number;
  /* A named beast with a price on its head. */
  alpha: boolean;
  /* The cull it's part of: it never comes back once killed. */
  cull: number | null;
  /* Its herd or pack (the id of the one it was raised with); alone, its own id. */
  group: number;
};

/* What the herd needs to know about the people out there. */
export type Prey = {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  running: boolean;
  /* Shield up, facing the way it would need to. */
  blocking: boolean;
  /* Out of reach: in a boat, down, or in creative. */
  away: boolean;
};

export interface HerdHost {
  readonly rng: Rng;
  /* An animal has bitten, kicked or gored someone: hurt them and knock them back along (dx, dz). */
  maul(id: number, damage: number, dx: number, dz: number): void;
  /* An animal ran into a raised shield. */
  blocked(id: number): void;
}

export type Range = {
  island: number;
  terrain: Terrain;
  quiet: { x: number; z: number; r: number }[];
};

export class Herd {
  readonly animals: Animal[] = [];
  private nextId = 1;
  private ranges = new Map<number, Range>();
  /* Each group's members still about, leader first; rebuilt every tick. */
  private groups = new Map<number, Animal[]>();

  constructor(private host: HerdHost) {}

  /* An island animals can live on, and the spots on it to keep clear. */
  addRange(r: Range) {
    this.ranges.set(r.island, r);
  }

  /* Put a new animal somewhere on an island. Null if there was no room. */
  spawn(
    species: SpeciesId,
    island: number,
    prey: readonly Prey[] = [],
    opts: {
      alpha?: boolean;
      cull?: number;
      near?: { x: number; z: number };
      /* Join this animal's herd or pack. */
      with?: Animal;
    } = {},
  ): Animal | null {
    const def = SPECIES[species];
    const max = def.health * (opts.alpha ? ALPHA.health : 1);
    const id = this.nextId++;
    const a: Animal = {
      id,
      species,
      island,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      health: max,
      max,
      state: "graze",
      until: 0,
      tx: 0,
      tz: 0,
      target: null,
      ran: 0,
      respawnAt: null,
      biteAt: 0,
      alpha: !!opts.alpha,
      cull: opts.cull ?? null,
      group: opts.with?.group ?? id,
    };
    if (!this.place(a, prey, opts.near ?? opts.with)) return null;
    this.animals.push(a);
    return a;
  }

  /* Take animals out for good (an alpha that wandered off, a cull that ended). */
  remove(pick: (a: Animal) => boolean) {
    for (let i = this.animals.length - 1; i >= 0; i--)
      if (pick(this.animals[i])) this.animals.splice(i, 1);
  }

  /* Its own group, or else one of its own kind on its island, alive, to come back beside. */
  private kin(a: Animal) {
    const mine = this.groups.get(a.group)?.filter((o) => o !== a);
    if (mine?.length) return mine[Math.floor(this.host.rng() * mine.length)];
    const others = this.animals.filter(
      (o) =>
        o !== a &&
        o.species === a.species &&
        o.island === a.island &&
        o.respawnAt === null &&
        o.state !== "dead",
    );
    return others.length ? others[Math.floor(this.host.rng() * others.length)] : undefined;
  }

  private role(a: Animal): Role {
    const r = SPECIES[a.species].role;
    /* An alpha always stands its ground. */
    return a.alpha && r === "prey" ? "defender" : r;
  }

  private radius(a: Animal) {
    return SPECIES[a.species].radius * (a.alpha ? ALPHA.scale : 1);
  }

  /* Somewhere grassy-ish on its island: dry, not steep, clear of things, away from people. */
  /*
   * Somewhere on its island, or (given `near`) close by the rest of its herd;
   * if there's no room there, anywhere on the island will do.
   */
  private place(a: Animal, prey: readonly Prey[], near?: { x: number; z: number }) {
    const range = this.ranges.get(a.island);
    if (!range) return false;
    const { terrain, quiet } = range;
    const rng = this.host.rng;
    for (let tries = 0; tries < 160; tries++) {
      const ang = rng() * Math.PI * 2;
      const close = near && tries < 60;
      const d = close ? 4 + rng() * 22 : Math.sqrt(rng()) * terrain.radius * 1.1;
      const x = (close ? near.x : terrain.ox) + Math.cos(ang) * d;
      const z = (close ? near.z : terrain.oz) + Math.sin(ang) * d;
      const h = terrain.heightAt(x, z);
      if (h < 2 || terrain.normalAt(x, z)[1] < 0.8) continue;
      if (quiet.some((q) => Math.hypot(q.x - x, q.z - z) < q.r)) continue;
      if (prey.some((p) => Math.hypot(p.x - x, p.z - z) < 60)) continue;
      if (this.blocked(terrain, x, h, z, this.radius(a))) continue;
      Object.assign(a, {
        x,
        y: h,
        z,
        yaw: rng() * Math.PI * 2,
        health: a.max,
        state: "graze",
        until: 0,
        target: null,
        ran: 0,
        respawnAt: null,
      });
      return true;
    }
    return false;
  }

  private blocked(terrain: Terrain, x: number, y: number, z: number, r: number) {
    for (const s of terrain.solidsNear(x, z)) {
      if (s.bottom > y + 1.2 || s.top < y + 0.35) continue;
      if (overSolid(s, x, z) || Math.hypot(s.x - x, s.z - z) < (s.box ? 0 : s.r) + r) return true;
    }
    return false;
  }

  /*
   * Step toward (dx, dz) at `speed`, turning aside if the way is shut. Returns
   * false when every way ahead was blocked.
   */
  private walk(a: Animal, dx: number, dz: number, speed: number, dt: number) {
    const terrain = this.ranges.get(a.island)?.terrain;
    if (!terrain) return false;
    const len = Math.hypot(dx, dz) || 1;
    const base = Math.atan2(dz / len, dx / len);
    const step = speed * dt;
    const r = this.radius(a);
    for (const turn of [0, 0.6, -0.6, 1.3, -1.3, 2.2, -2.2]) {
      const ang = base + turn;
      const nx = a.x + Math.cos(ang) * step;
      const nz = a.z + Math.sin(ang) * step;
      if (!terrain.contains(nx, nz, -20)) continue;
      const h = terrain.heightAt(nx, nz);
      /* No swimming, no scrambling up or down anything steep. */
      if (h < 0.8 || Math.abs(h - a.y) > step * 1.1 + 0.05) continue;
      if (this.blocked(terrain, nx, h, nz, r)) continue;
      a.x = nx;
      a.z = nz;
      a.y = h;
      const want = angleTo(Math.cos(ang), Math.sin(ang));
      a.yaw = wrapAngle(a.yaw + clamp(wrapAngle(want - a.yaw), -8 * dt, 8 * dt));
      return true;
    }
    return false;
  }

  private face(a: Animal, x: number, z: number, dt: number) {
    const want = angleTo(x - a.x, z - a.z);
    a.yaw = wrapAngle(a.yaw + clamp(wrapAngle(want - a.yaw), -6 * dt, 6 * dt));
  }

  private members(a: Animal): readonly Animal[] {
    return this.groups.get(a.group) ?? [];
  }

  /* Who it follows: its group's leader, unless that's itself. */
  private leaderOf(a: Animal) {
    const lead = this.members(a)[0];
    return lead && lead !== a ? lead : null;
  }

  private spread(a: Animal) {
    return SPREAD[a.species] ?? SPREAD_DEFAULT;
  }

  private wander(a: Animal, now: number) {
    const rng = this.host.rng;
    const terrain = this.ranges.get(a.island)?.terrain;
    a.target = null;
    /* Following: graze near the leader, and go after it when it moves off. */
    const lead = this.leaderOf(a);
    if (lead) {
      const spread = this.spread(a);
      const moving = lead.state === "walk";
      const cx = moving ? lead.tx : lead.x;
      const cz = moving ? lead.tz : lead.z;
      if (!moving && Math.hypot(lead.x - a.x, lead.z - a.z) < spread && rng() < 0.6) {
        a.state = "graze";
        a.until = now + 2 + rng() * 5;
        return;
      }
      const ang = rng() * Math.PI * 2;
      const d = 2 + rng() * spread * 0.6;
      a.tx = cx + Math.cos(ang) * d;
      a.tz = cz + Math.sin(ang) * d;
      a.state = "walk";
      a.until = now + 14;
      return;
    }
    if (rng() < 0.45) {
      a.state = "graze";
      a.until = now + 3 + rng() * 6;
      return;
    }
    const ang = rng() * Math.PI * 2;
    const d = 6 + rng() * 14;
    a.tx = a.x + Math.cos(ang) * d;
    a.tz = a.z + Math.sin(ang) * d;
    if (terrain && terrain.heightAt(a.tx, a.tz) < 1.5) {
      a.tx = a.x - Math.cos(ang) * d;
      a.tz = a.z - Math.sin(ang) * d;
    }
    a.state = "walk";
    a.until = now + 12;
  }

  /* Each group's members still about, in the order they were raised, so the leader stays put until it falls. */
  private regroup() {
    this.groups.clear();
    for (const a of this.animals) {
      if (a.respawnAt !== null || a.state === "dead") continue;
      const g = this.groups.get(a.group);
      if (g) g.push(a);
      else this.groups.set(a.group, [a]);
    }
  }

  /*
   * Something has the group on edge, `threat` being who. Prey turn to bolt
   * (a beat apart, so they go almost as one), guards square up to it, and a
   * pack closes in.
   */
  private alarm(a: Animal, threat: Prey, now: number) {
    for (const o of this.members(a)) {
      if (o === a) continue;
      const role = this.role(o);
      if (role === "prey") {
        if (o.state === "run" || o.state === "alert") continue;
        o.state = "alert";
        o.target = threat.id;
        o.until = now + 0.15 + this.host.rng() * 0.35;
      } else if (role === "defender") {
        if (o.state === "charge" || o.state === "attack") continue;
        if (!o.alpha && o.health < o.max * 0.25) continue;
        this.squareUp(o, threat, now);
      } else if (o.target === null) {
        o.target = threat.id;
        o.state = "charge";
        o.until = now + 20;
      }
    }
  }

  tick(now: number, dt: number, prey: readonly Prey[]) {
    this.regroup();
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      if (a.respawnAt !== null) {
        /* Back with the rest of its herd, if any of them are about. */
        if (now >= a.respawnAt && !this.place(a, prey, this.kin(a))) a.respawnAt = now + 10;
        continue;
      }
      if (a.state === "dead") {
        if (now < a.until) continue;
        /* Alphas and a cull's animals are gone for good; the rest come back in a while. */
        if (a.alpha || a.cull !== null) this.animals.splice(i, 1);
        else a.respawnAt = now + RESPAWN;
        continue;
      }
      const role = this.role(a);
      if (role === "prey") this.prey(a, now, dt, prey);
      else if (role === "defender") this.defender(a, now, dt, prey);
      else this.predator(a, now, dt, prey);
    }
  }

  private nearest(a: Animal, prey: readonly Prey[]) {
    let best: Prey | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const p of prey) {
      if (p.away) continue;
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      if (d < bestD && Math.abs(p.y - a.y) < 12) {
        best = p;
        bestD = d;
      }
    }
    return { p: best, d: bestD };
  }

  private noticed(a: Animal, p: Prey | null, d: number) {
    const def = SPECIES[a.species];
    const k = a.alpha ? 1.5 : 1;
    return !!p && d < (p.running ? def.noticeRunning : def.notice) * k;
  }

  /* Graze, or walk to where it was going. */
  private idle(a: Animal, now: number, dt: number) {
    if (a.state === "walk") {
      /* Fallen behind its group: a brisker pace to catch up. */
      const lead = this.leaderOf(a);
      const behind = !!lead && Math.hypot(lead.x - a.x, lead.z - a.z) > this.spread(a) * 1.4;
      const speed = SPECIES[a.species].walk * (behind ? 1.8 : 1);
      const ok = this.walk(a, a.tx - a.x, a.tz - a.z, speed, dt);
      if (!ok || Math.hypot(a.tx - a.x, a.tz - a.z) < 1 || now > a.until) this.wander(a, now);
    } else if (now > a.until) this.wander(a, now);
  }

  private prey(a: Animal, now: number, dt: number, prey: readonly Prey[]) {
    const def = SPECIES[a.species];
    const { p, d } = this.nearest(a, prey);
    switch (a.state) {
      case "graze":
      case "walk":
        if (this.noticed(a, p, d)) {
          a.state = "alert";
          a.target = p!.id;
          a.until = now + 0.45;
          this.alarm(a, p!, now);
          return;
        }
        this.idle(a, now, dt);
        return;
      case "alert":
        if (p) this.face(a, p.x, p.z, dt);
        if (now > a.until) {
          a.state = "run";
          a.ran = 0;
        }
        return;
      case "run": {
        const from = prey.find((o) => o.id === a.target) ?? p;
        const far = !from || Math.hypot(from.x - a.x, from.z - a.z) > 42;
        if (far) {
          this.wander(a, now);
          return;
        }
        /* A sprint, then a few winded seconds at a trot: the moment to catch one. */
        a.ran += dt;
        const tired = a.ran % 9 > 5.5;
        this.walk(a, a.x - from.x, a.z - from.z, tired ? def.run * 0.36 : def.run, dt);
        return;
      }
      default:
        this.wander(a, now);
    }
  }

  /* Facing someone it's about to go for, or has just gone for. */
  private squareUp(a: Animal, p: Prey, now: number) {
    a.state = "alert";
    a.target = p.id;
    a.until = now + 0.85;
  }

  /*
   * It reached its target: a raised shield turns it, otherwise it lands its
   * blow. Returns true if it landed.
   */
  private lunge(a: Animal, target: Prey, dx: number, dz: number, dist: number) {
    const fx = -Math.sin(target.yaw);
    const fz = -Math.cos(target.yaw);
    if (target.blocking && (fx * -dx + fz * -dz) / (dist || 1) > 0.3) {
      this.host.blocked(target.id);
      return false;
    }
    const damage = SPECIES[a.species].damage * (a.alpha ? ALPHA.damage : 1);
    this.host.maul(target.id, damage, dx / (dist || 1), dz / (dist || 1));
    return true;
  }

  private defender(a: Animal, now: number, dt: number, prey: readonly Prey[]) {
    const def = SPECIES[a.species];
    const { p, d } = this.nearest(a, prey);
    const target = a.target === null ? null : (prey.find((o) => o.id === a.target) ?? null);
    const hurt = !a.alpha && a.health < a.max * 0.25;
    /* Badly hurt, it runs for it. */
    if (hurt && a.state !== "run") {
      a.state = "run";
      a.target = p?.id ?? null;
      a.ran = 0;
    }
    switch (a.state) {
      case "graze":
      case "walk":
        if (this.noticed(a, p, d)) {
          this.squareUp(a, p!, now);
          this.alarm(a, p!, now);
          return;
        }
        this.idle(a, now, dt);
        return;
      case "alert":
        if (!target || target.away) {
          this.wander(a, now);
          return;
        }
        this.face(a, target.x, target.z, dt);
        if (now > a.until) {
          a.state = "charge";
          a.until = now + 2.6;
        }
        return;
      case "attack":
        if (now > a.until) {
          a.state = "run";
          a.ran = 0;
          a.until = now + 1.6;
        }
        return;
      case "charge": {
        if (!target || target.away) {
          this.wander(a, now);
          return;
        }
        const dx = target.x - a.x;
        const dz = target.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist < def.reach + this.radius(a) - 0.5 && Math.abs(target.y - a.y) < 1.8) {
          if (this.lunge(a, target, dx, dz, dist)) {
            a.state = "attack";
            a.until = now + 0.35;
          } else {
            a.state = "graze";
            a.until = now + 1.2;
          }
          return;
        }
        const ok = this.walk(a, dx, dz, def.run, dt);
        if (!ok || now > a.until || dist > 30) {
          a.state = "graze";
          a.until = now + 1.5;
        }
        return;
      }
      case "run": {
        /* Backing off after a hit (or fleeing when hurt), then coming round again. */
        const from = target ?? p;
        if (!from || Math.hypot(from.x - a.x, from.z - a.z) > (hurt ? 45 : 16)) {
          this.wander(a, now);
          return;
        }
        if (!hurt && now > a.until) {
          this.squareUp(a, from, now);
          return;
        }
        this.walk(a, a.x - from.x, a.z - from.z, hurt ? def.run * 0.7 : def.run * 0.38, dt);
        return;
      }
      default:
        this.wander(a, now);
    }
  }

  /* Its pack joins the hunt, wherever they are, and so do others of its kind close by. */
  private rally(a: Animal, target: number, now: number) {
    for (const o of this.animals) {
      if (o === a || o.species !== a.species || o.island !== a.island) continue;
      const pack = o.group === a.group;
      if (o.respawnAt !== null || o.state === "dead" || o.target !== null) continue;
      if (!pack && Math.hypot(o.x - a.x, o.z - a.z) > 28) continue;
      o.target = target;
      o.state = "charge";
      o.until = now + 20;
    }
  }

  private predator(a: Animal, now: number, dt: number, prey: readonly Prey[]) {
    const def = SPECIES[a.species];
    const { p, d } = this.nearest(a, prey);
    const target = a.target === null ? null : (prey.find((o) => o.id === a.target) ?? null);
    const hurt = !a.alpha && a.health < a.max * 0.25;
    if (hurt && a.state !== "run") {
      a.state = "run";
      a.target = p?.id ?? null;
      a.until = now + 12;
    }
    switch (a.state) {
      case "graze":
      case "walk":
        if (this.noticed(a, p, d)) {
          a.state = "alert";
          a.target = p!.id;
          a.until = now + 0.6;
          this.rally(a, p!.id, now);
          return;
        }
        this.idle(a, now, dt);
        return;
      case "alert":
        if (!target || target.away) {
          this.wander(a, now);
          return;
        }
        this.face(a, target.x, target.z, dt);
        if (now > a.until) {
          a.state = "charge";
          a.until = now + 20;
        }
        return;
      case "attack":
        if (target) this.face(a, target.x, target.z, dt);
        if (now > a.until) a.state = "charge";
        return;
      case "charge": {
        if (!target || target.away || now > a.until) {
          this.wander(a, now);
          return;
        }
        const dx = target.x - a.x;
        const dz = target.z - a.z;
        const dist = Math.hypot(dx, dz);
        /* It gives up on anyone who gets well away. */
        if (dist > def.noticeRunning * 2.5) {
          this.wander(a, now);
          return;
        }
        if (dist < def.reach + this.radius(a) - 0.4 && Math.abs(target.y - a.y) < 1.8) {
          this.face(a, target.x, target.z, dt);
          if (now >= a.biteAt) {
            a.biteAt = now + def.cooldown;
            a.state = "attack";
            a.until = now + 0.45;
            if (!this.lunge(a, target, dx, dz, dist)) {
              /* Turned by a shield: it circles off a moment before it comes again. */
              a.biteAt = now + def.cooldown * 1.6;
            }
          }
          return;
        }
        /* Out of reach yet: swing round to its own side of the quarry first. */
        const [fx, fz] = this.flank(a, target, dist);
        this.walk(a, fx - a.x, fz - a.z, dist > 8 ? def.run : def.run * 0.7, dt);
        return;
      }
      case "run": {
        const from = target ?? p;
        if (!from || now > a.until || Math.hypot(from.x - a.x, from.z - a.z) > 50) {
          this.wander(a, now);
          return;
        }
        this.walk(a, a.x - from.x, a.z - from.z, def.run * 0.8, dt);
        return;
      }
      default:
        this.wander(a, now);
    }
  }

  /*
   * Where a pack animal heads while closing on `target`: a point on a ring
   * round it, turned to this one's side of the pack, so the pack spreads out
   * and comes from several sides. Close in, or alone, it goes straight in.
   */
  private flank(a: Animal, target: Prey, dist: number): [number, number] {
    const hunting = this.members(a).filter((o) => o.target === target.id);
    if (hunting.length < 2 || dist < FLANK_RING * 0.75) return [target.x, target.z];
    const slot = hunting.indexOf(a);
    const offset = (slot - (hunting.length - 1) / 2) * FLANK;
    const from = Math.atan2(a.z - target.z, a.x - target.x) + offset * 0.5;
    const r = Math.min(FLANK_RING, dist * 0.7);
    return [target.x + Math.cos(from) * r, target.z + Math.sin(from) * r];
  }

  /*
   * A blow landed. Returns true if it killed the animal. Prey bolt; the rest
   * turn on whoever hit them.
   */
  strike(a: Animal, by: Prey, damage: number, now: number) {
    if (a.state === "dead" || a.respawnAt !== null) return false;
    a.health -= damage;
    const dx = a.x - by.x;
    const dz = a.z - by.z;
    const d = Math.hypot(dx, dz) || 1;
    this.walk(a, dx / d, dz / d, a.alpha ? 6 : 12, 0.05);
    if (a.health <= 0) {
      a.health = 0;
      a.state = "dead";
      a.until = now + CORPSE;
      return true;
    }
    a.target = by.id;
    this.alarm(a, by, now);
    const role = this.role(a);
    if (role === "prey") {
      a.state = "run";
      a.ran = 0;
    } else if (role === "predator") {
      if (a.state !== "run") {
        a.state = "charge";
        a.until = now + 20;
        this.rally(a, by.id, now);
      }
    } else if (a.alpha || a.health >= a.max * 0.25) {
      a.state = "alert";
      a.until = now + 0.35;
    }
    return false;
  }

  /* Everything within `r` of (x, z), for one player's view. */
  snapshot(x: number, z: number, r: number, out: AnimalSnap[] = []): AnimalSnap[] {
    out.length = 0;
    for (const a of this.animals) {
      if (a.respawnAt !== null) continue;
      if (Math.abs(a.x - x) > r || Math.abs(a.z - z) > r) continue;
      out.push([
        a.id,
        speciesIndex(a.species),
        round2(a.x),
        round2(a.y),
        round2(a.z),
        round2(a.yaw),
        ANIMAL_STATE[a.state],
        Math.round((a.health / a.max) * 100),
        (a.alpha ? ANIMAL_FLAG.alpha : 0) | (a.cull !== null ? ANIMAL_FLAG.cull : 0),
      ]);
    }
    return out;
  }
}
