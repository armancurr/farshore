import { ANIMAL_KINDS, type AnimalKind } from "../shared/items";
import { angleTo, clamp, type Rng, wrapAngle } from "../shared/math";
import { ANIMAL_STATE, type AnimalSnap, round2 } from "../shared/protocol";
import { overSolid, type Terrain } from "../shared/terrain";

/*
 * The island's animals, simulated by the room. Each is a small state machine
 * stepped at the tick rate: no pathfinding, just steering with a few probes
 * so they keep out of the sea, off cliffs and out of walls.
 *
 * Deer graze and wander; anything running at them, or hitting them, sends
 * them bolting until they tire. Boar graze too, but if you come close they
 * square up, charge, and gore you, backing off to charge again.
 */

type AnimalDef = {
  health: number;
  walk: number;
  run: number;
  /* How close you can get, walking and running, before it notices. */
  notice: number;
  noticeRunning: number;
  radius: number;
};

export const ANIMALS: Record<AnimalKind, AnimalDef> = {
  deer: { health: 28, walk: 1.6, run: 8.2, notice: 9, noticeRunning: 20, radius: 0.55 },
  boar: { health: 55, walk: 1.3, run: 9.5, notice: 8, noticeRunning: 12, radius: 0.6 },
};

const COUNT: Record<AnimalKind, number> = { deer: 10, boar: 6 };
const RESPAWN = 90;
const CORPSE = 2.5;
const BOAR_DAMAGE = 14;
const GORE_REACH = 1.5;

type State = keyof typeof ANIMAL_STATE;

export type Animal = {
  id: number;
  kind: AnimalKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  state: State;
  /* When the current state runs out. */
  until: number;
  /* Where it's walking to, when wandering. */
  tx: number;
  tz: number;
  /* Who it's running from, or charging at. */
  target: number | null;
  /* Deer: how long it's been running, for tiring. */
  ran: number;
  /* Dead or waiting to come back: when it reappears. */
  respawnAt: number | null;
};

/* What the herd needs to know about the people on the island. */
export type Prey = {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  running: boolean;
  /* Shield up, facing the way it would need to. */
  blocking: boolean;
  /* Out of reach: in a boat, or down. */
  away: boolean;
};

export interface HerdHost {
  readonly terrain: Terrain;
  readonly rng: Rng;
  /* A boar has hit someone: hurt them and knock them back along (dx, dz). */
  gore(id: number, damage: number, dx: number, dz: number): void;
  /* A boar ran into a raised shield. */
  blocked(id: number): void;
}

export class Herd {
  readonly animals: Animal[] = [];
  private nextId = 1;
  /* Places nobody should find an animal on arrival (the spawn, the lighthouse). */
  private quiet: { x: number; z: number; r: number }[];

  constructor(
    private host: HerdHost,
    quiet: { x: number; z: number; r: number }[],
  ) {
    this.quiet = quiet;
    for (const kind of ANIMAL_KINDS) {
      for (let i = 0; i < COUNT[kind]; i++) {
        const a = this.create(kind);
        if (this.place(a, [])) this.animals.push(a);
      }
    }
  }

  private create(kind: AnimalKind): Animal {
    return {
      id: this.nextId++,
      kind,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      health: ANIMALS[kind].health,
      state: "graze",
      until: 0,
      tx: 0,
      tz: 0,
      target: null,
      ran: 0,
      respawnAt: null,
    };
  }

  /* Somewhere grassy-ish: dry, not steep, clear of things, away from people. */
  private place(a: Animal, prey: readonly Prey[]) {
    const { terrain, rng } = this.host;
    for (let tries = 0; tries < 80; tries++) {
      const x = (rng() * 2 - 1) * 280;
      const z = (rng() * 2 - 1) * 280;
      const h = terrain.heightAt(x, z);
      if (h < 2.5 || h > 32 || terrain.normalAt(x, z)[1] < 0.82) continue;
      if (this.quiet.some((q) => Math.hypot(q.x - x, q.z - z) < q.r)) continue;
      if (prey.some((p) => Math.hypot(p.x - x, p.z - z) < 60)) continue;
      if (this.blocked(x, h, z, ANIMALS[a.kind].radius)) continue;
      Object.assign(a, {
        x,
        y: h,
        z,
        yaw: rng() * Math.PI * 2,
        health: ANIMALS[a.kind].health,
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

  private blocked(x: number, y: number, z: number, r: number) {
    for (const s of this.host.terrain.solidsNear(x, z)) {
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
    const terrain = this.host.terrain;
    const len = Math.hypot(dx, dz) || 1;
    const base = Math.atan2(dz / len, dx / len);
    const step = speed * dt;
    const r = ANIMALS[a.kind].radius;
    for (const turn of [0, 0.6, -0.6, 1.3, -1.3, 2.2, -2.2]) {
      const ang = base + turn;
      const nx = a.x + Math.cos(ang) * step;
      const nz = a.z + Math.sin(ang) * step;
      const h = terrain.heightAt(nx, nz);
      /* No swimming, no scrambling up or down anything steep. */
      if (h < 0.8 || Math.abs(h - a.y) > step * 1.1 + 0.05) continue;
      if (Math.abs(nx) > 340 || Math.abs(nz) > 340) continue;
      if (this.blocked(nx, h, nz, r)) continue;
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
    const { rng, terrain } = this.host;
    if (rng() < 0.45) {
      a.state = "graze";
      a.until = now + 3 + rng() * 6;
      return;
    }
    const ang = rng() * Math.PI * 2;
    const d = 6 + rng() * 14;
    a.tx = a.x + Math.cos(ang) * d;
    a.tz = a.z + Math.sin(ang) * d;
    if (terrain.heightAt(a.tx, a.tz) < 1.5) {
      a.tx = a.x - Math.cos(ang) * d;
      a.tz = a.z - Math.sin(ang) * d;
    }
    a.state = "walk";
    a.until = now + 12;
  }

  tick(now: number, dt: number, prey: readonly Prey[]) {
    for (const a of this.animals) {
      if (a.respawnAt !== null) {
        if (now >= a.respawnAt && !this.place(a, prey)) a.respawnAt = now + 10;
        continue;
      }
      if (a.state === "dead") {
        if (now >= a.until) a.respawnAt = now + RESPAWN;
        continue;
      }
      if (a.kind === "deer") this.deer(a, now, dt, prey);
      else this.boar(a, now, dt, prey);
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
    const def = ANIMALS[a.kind];
    return !!p && d < (p.running ? def.noticeRunning : def.notice);
  }

  private deer(a: Animal, now: number, dt: number, prey: readonly Prey[]) {
    const def = ANIMALS.deer;
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
        if (a.state === "walk") {
          const ok = this.walk(a, a.tx - a.x, a.tz - a.z, def.walk, dt);
          if (!ok || Math.hypot(a.tx - a.x, a.tz - a.z) < 1 || now > a.until) this.wander(a, now);
        } else if (now > a.until) this.wander(a, now);
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
        this.walk(a, a.x - from.x, a.z - from.z, tired ? 3 : def.run, dt);
        return;
      }
      default:
        this.wander(a, now);
    }
  }

  private boar(a: Animal, now: number, dt: number, prey: readonly Prey[]) {
    const def = ANIMALS.boar;
    const { p, d } = this.nearest(a, prey);
    const target = a.target === null ? null : (prey.find((o) => o.id === a.target) ?? null);
    /* Badly hurt, it runs for it. */
    if (a.health < def.health * 0.25 && a.state !== "run") {
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
        if (a.state === "walk") {
          const ok = this.walk(a, a.tx - a.x, a.tz - a.z, def.walk, dt);
          if (!ok || Math.hypot(a.tx - a.x, a.tz - a.z) < 1 || now > a.until) this.wander(a, now);
        } else if (now > a.until) this.wander(a, now);
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
      case "charge": {
        if (!target || target.away) {
          this.wander(a, now);
          return;
        }
        const dx = target.x - a.x;
        const dz = target.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist < GORE_REACH && Math.abs(target.y - a.y) < 1.8) {
          const fx = -Math.sin(target.yaw);
          const fz = -Math.cos(target.yaw);
          /* A raised shield turns it, if you're facing it. */
          if (target.blocking && (fx * -dx + fz * -dz) / (dist || 1) > 0.3) {
            this.host.blocked(target.id);
            a.state = "graze";
            a.until = now + 1.2;
          } else {
            this.host.gore(target.id, BOAR_DAMAGE, dx / (dist || 1), dz / (dist || 1));
            a.state = "run";
            a.ran = 0;
            a.until = now + 1.6;
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
        const hurt = a.health < def.health * 0.25;
        if (!from || Math.hypot(from.x - a.x, from.z - a.z) > (hurt ? 45 : 16)) {
          this.wander(a, now);
          return;
        }
        if (!hurt && now > a.until) {
          this.squareUp(a, from, now);
          return;
        }
        this.walk(a, a.x - from.x, a.z - from.z, hurt ? 6.5 : 3.5, dt);
        return;
      }
      default:
        this.wander(a, now);
    }
  }

  private squareUp(a: Animal, p: Prey, now: number) {
    a.state = "alert";
    a.target = p.id;
    a.until = now + 0.85;
  }

  /*
   * A blow landed. Returns true if it killed the animal. Deer bolt, boar
   * turn on whoever hit them.
   */
  strike(a: Animal, by: Prey, damage: number, now: number) {
    if (a.state === "dead" || a.respawnAt !== null) return false;
    a.health -= damage;
    const dx = a.x - by.x;
    const dz = a.z - by.z;
    const d = Math.hypot(dx, dz) || 1;
    this.walk(a, dx / d, dz / d, 12, 0.05);
    if (a.health <= 0) {
      a.health = 0;
      a.state = "dead";
      a.until = now + CORPSE;
      return true;
    }
    a.target = by.id;
    if (a.kind === "deer") {
      a.state = "run";
      a.ran = 0;
    } else if (a.health >= ANIMALS.boar.health * 0.25) {
      a.state = "alert";
      a.until = now + 0.35;
    }
    return false;
  }

  snapshot(): AnimalSnap[] {
    const out: AnimalSnap[] = [];
    for (const a of this.animals) {
      if (a.respawnAt !== null) continue;
      out.push([
        a.id,
        a.kind === "deer" ? 0 : 1,
        round2(a.x),
        round2(a.y),
        round2(a.z),
        round2(a.yaw),
        ANIMAL_STATE[a.state],
        Math.round((a.health / ANIMALS[a.kind].health) * 100),
      ]);
    }
    return out;
  }
}
