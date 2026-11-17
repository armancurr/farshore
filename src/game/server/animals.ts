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
 */

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
    opts: { alpha?: boolean; cull?: number } = {},
  ): Animal | null {
    const def = SPECIES[species];
    const max = def.health * (opts.alpha ? ALPHA.health : 1);
    const a: Animal = {
      id: this.nextId++,
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
    };
    if (!this.place(a, prey)) return null;
    this.animals.push(a);
    return a;
  }

  /* Take animals out for good (an alpha that wandered off, a cull that ended). */
  remove(pick: (a: Animal) => boolean) {
    for (let i = this.animals.length - 1; i >= 0; i--)
      if (pick(this.animals[i])) this.animals.splice(i, 1);
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
  private place(a: Animal, prey: readonly Prey[]) {
    const range = this.ranges.get(a.island);
    if (!range) return false;
    const { terrain, quiet } = range;
    const rng = this.host.rng;
    for (let tries = 0; tries < 120; tries++) {
      const ang = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * terrain.radius * 1.1;
      const x = terrain.ox + Math.cos(ang) * d;
      const z = terrain.oz + Math.sin(ang) * d;
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

  private wander(a: Animal, now: number) {
    const rng = this.host.rng;
    const terrain = this.ranges.get(a.island)?.terrain;
    a.target = null;
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

  tick(now: number, dt: number, prey: readonly Prey[]) {
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      if (a.respawnAt !== null) {
        if (now >= a.respawnAt && !this.place(a, prey)) a.respawnAt = now + 10;
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
      const ok = this.walk(a, a.tx - a.x, a.tz - a.z, SPECIES[a.species].walk, dt);
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

  /* Others of its kind close by join the hunt. */
  private rally(a: Animal, target: number, now: number) {
    for (const o of this.animals) {
      if (o === a || o.species !== a.species || o.island !== a.island) continue;
      if (o.respawnAt !== null || o.state === "dead" || o.target !== null) continue;
      if (Math.hypot(o.x - a.x, o.z - a.z) > 28) continue;
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
        this.walk(a, dx, dz, dist > 8 ? def.run : def.run * 0.7, dt);
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
