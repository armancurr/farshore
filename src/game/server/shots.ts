import type { Archipelago } from "../shared/archipelago";
import { CATALOGUE, type PlacedItem } from "../shared/catalogue";
import { SEA_FLOOR, SEA_LEVEL } from "../shared/constants";
import { CREW_ID_BASE } from "../shared/crew";
import { distanceTo, type VehicleState, vehicleSolids } from "../shared/drive";
import { itemSolids, overItem } from "../shared/placing";
import { PLOT_SIZES } from "../shared/plots";
import { type LandOn, round2, type ServerMsg } from "../shared/protocol";
import type { SavedPlot } from "../shared/save";
import {
  type Cloud,
  type Flight,
  MAX_SHOTS,
  SHOTS,
  SMOKE,
  type ShotKind,
  blastShare,
  shotAt,
  shotIndex,
} from "../shared/shots";
import { strikeOn } from "../shared/siege";
import { overSolid } from "../shared/terrain";
import type { VehicleKind } from "../shared/vehicles";
import type { Animal } from "./animals";

/*
 * Everything in flight, as the room runs it: arrows, bolts, cannonballs,
 * stones, kegs and smoke bombs. Each tick a shot moves on along its arc in
 * short steps, and the first thing a step finds it in is what it hits:
 * someone, an animal, a hull, something built, a rock, the ground or the
 * sea. A plain shot hurts what it hits; a heavy one bursts there and hurts
 * everything round it; a keg lies where it lands until its fuse runs out,
 * and a smoke bomb lets out a cloud. What anything may hurt is the room's
 * to say (see ShotHost): this only finds what was hit, and how hard.
 */

/* Who let fly, as the rules need them, kept with the shot so it counts after they've gone. */
export type Shooter = {
  /* A player's or a crewman's id; -1 for a defense. */
  by: number;
  /* Their side (a player's token, a crewman's master's, a defense's owner's). */
  side: string;
  /* Whose land they'd be harming things on, for canDamageItem. */
  token: string | null;
  creative: boolean;
  /* A defense: the plot it stands on and which it is. */
  plot: number | null;
  item: number | null;
  /* The vehicle they're aboard (a ship's broadside), which its own shots don't hit. */
  ride: number | null;
};

/*
 * What a shot does on a direct hit, and how hard its blast is (see SHOTS);
 * `daze` is seconds a person it hits is slowed (the wand's bolt).
 */
export type Payload = { damage: number; siege: number; hull: number; scale: number; daze: number };

export type Shot = {
  id: number;
  kind: ShotKind;
  flight: Flight;
  /* Seconds since it set off. */
  age: number;
  from: Shooter;
  load: Payload;
  /* A keg or a smoke bomb lying where it came down. */
  rest: { x: number; y: number; z: number } | null;
};

/* Someone a shot can hit: on their feet, or sat in a vehicle. */
export type Target = {
  id: number;
  side: string;
  x: number;
  y: number;
  z: number;
  /* The plot they're raiding, if any (a defense's shots pass everyone else by). */
  raid: number | null;
  seated: boolean;
};

export type Hull = { id: number; kind: VehicleKind; state: VehicleState };

/* An outward shove, m/s, along (x, z) and up. */
export type Push = { x: number; z: number; speed: number; lift: number };

export interface ShotHost {
  readonly world: Archipelago;
  readonly plots: ReadonlyMap<number, SavedPlot>;
  bodies(): readonly Target[];
  animals(): readonly Animal[];
  hulls(): Iterable<Hull>;
  /* The damage itself, as the rules allow it: each says how much it really did. */
  hurtBody(s: Shot, id: number, amount: number, push: Push): number;
  hurtItem(
    s: Shot,
    plot: SavedPlot,
    item: PlacedItem,
    amount: number,
    at: { x: number; y: number; z: number },
  ): number;
  hurtHull(s: Shot, id: number, amount: number): number;
  hurtAnimal(s: Shot, a: Animal, amount: number): number;
  ignite(s: Shot, plot: SavedPlot, item: PlacedItem): void;
  /* It came down here (whatever it hit, or nothing). */
  landed(s: Shot, at: { x: number; y: number; z: number }): void;
  broadcast(msg: ServerMsg): void;
}

/* The longest step a shot takes between looks at what's round it (metres). */
const STEP = 0.45;

/* What a shot found itself in. */
type Found =
  | { on: "body"; target: Target }
  | { on: "animal"; animal: Animal }
  | { on: "ship"; hull: Hull }
  | { on: "item"; plot: SavedPlot; item: PlacedItem }
  | { on: "ground" | "water" | "solid" | "air" };

type Point = { x: number; y: number; z: number };

const r2 = (p: Point) => [round2(p.x), round2(p.y), round2(p.z)];

export class Shots {
  readonly live = new Map<number, Shot>();
  /* Smoke hanging about, till when. */
  readonly clouds: Cloud[] = [];
  private nextId = 1;

  constructor(private readonly host: ShotHost) {}

  get count() {
    return this.live.size;
  }

  /*
   * Let one fly from `at` at velocity `v`; null when the sky is full. Every
   * client is told where from and how fast, and flies it the same way.
   */
  fire(kind: ShotKind, at: Point, v: Point, from: Shooter, load?: Partial<Payload>): Shot | null {
    if (this.live.size >= MAX_SHOTS) return null;
    const spec = SHOTS[kind];
    const s: Shot = {
      id: this.nextId++,
      kind,
      flight: { x: at.x, y: at.y, z: at.z, vx: v.x, vy: v.y, vz: v.z, gravity: spec.gravity },
      age: 0,
      from,
      load: {
        damage: load?.damage ?? spec.damage,
        siege: load?.siege ?? spec.siege,
        hull: load?.hull ?? spec.hull,
        scale: load?.scale ?? 1,
        daze: load?.daze ?? 0,
      },
      rest: null,
    };
    this.live.set(s.id, s);
    const f = s.flight;
    this.host.broadcast({
      t: "shot",
      id: s.id,
      k: shotIndex(kind),
      p: [f.x, f.y, f.z, f.vx, f.vy, f.vz].map(round2),
      by: from.by,
      src: from.item ?? from.ride ?? 0,
    });
    return s;
  }

  step(now: number, dt: number) {
    for (let i = this.clouds.length - 1; i >= 0; i--)
      if (this.clouds[i].until <= now) this.clouds.splice(i, 1);
    if (!this.live.size) return;
    const bodies = this.host.bodies();
    for (const s of [...this.live.values()]) {
      if (s.rest) {
        if (s.age + dt >= (SHOTS[s.kind].fuse ?? 0)) this.burst(s, s.rest, true);
        else s.age += dt;
        continue;
      }
      this.fly(s, dt, bodies, now);
    }
  }

  /* One tick of flight, in short steps, stopping at the first thing in the way. */
  private fly(s: Shot, dt: number, bodies: readonly Target[], now: number) {
    const spec = SHOTS[s.kind];
    const f = s.flight;
    const a = shotAt(f, s.age);
    const b = shotAt(f, s.age + dt);
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / STEP));
    /* Only who's anywhere near this stretch of it. */
    const pad = 2.5;
    const by = (o: { x: number; z: number }) =>
      o.x > Math.min(a.x, b.x) - pad &&
      o.x < Math.max(a.x, b.x) + pad &&
      o.z > Math.min(a.z, b.z) - pad &&
      o.z < Math.max(a.z, b.z) + pad;
    const near = bodies.filter((o) => by(o) && this.mayHit(s, o));
    /* Only a player's shots hunt: crews and defenses leave the animals be. */
    const beasts = this.hunts(s) ? this.host.animals().filter(by) : [];
    let last: Point = a;
    for (let k = 1; k <= n; k++) {
      const t = s.age + (dt * k) / n;
      const p = shotAt(f, t);
      const found = this.find(s, p, near, beasts, spec.radius);
      if (found) {
        this.land(s, found, p, last, t, now);
        return;
      }
      last = p;
    }
    s.age += dt;
    if (s.age > spec.life || b.y < SEA_FLOOR - 5) {
      this.host.broadcast({ t: "land", id: s.id, p: r2(b), at: round2(s.age), on: "air" });
      this.live.delete(s.id);
    }
  }

  /* A defense's shots are only for its land's raiders; nobody's hit his own side. */
  private mayHit(s: Shot, o: Target) {
    if (o.id === s.from.by || o.side === s.from.side) return false;
    if (s.from.plot !== null) return o.raid === s.from.plot;
    return true;
  }

  /* Whatever a shot at `p` is inside, nearest kinds first. */
  private hunts(s: Shot) {
    return s.from.by >= 0 && s.from.by < CREW_ID_BASE && s.from.plot === null;
  }

  private find(
    s: Shot,
    p: Point,
    near: readonly Target[],
    beasts: readonly Animal[],
    r: number,
  ): Found | null {
    for (const o of near) {
      const top = o.seated ? 1.4 : 1.85;
      if (p.y < o.y - 0.1 || p.y > o.y + top) continue;
      if ((p.x - o.x) ** 2 + (p.z - o.z) ** 2 < (0.42 + r) ** 2) return { on: "body", target: o };
    }
    for (const a of beasts) {
      if (a.respawnAt !== null || a.state === "dead") continue;
      const size = a.alpha ? 1.7 : 1;
      const rr = 0.75 * size + r;
      if (Math.abs(a.x - p.x) > rr || Math.abs(a.z - p.z) > rr) continue;
      if ((a.x - p.x) ** 2 + (a.y + 0.6 * size - p.y) ** 2 + (a.z - p.z) ** 2 < rr * rr)
        return { on: "animal", animal: a };
    }
    let own: Hull | null = null;
    for (const h of this.host.hulls()) {
      if (h.id === s.from.ride) {
        own = h;
        continue;
      }
      if (Math.abs(h.state.x - p.x) > 20 || Math.abs(h.state.z - p.z) > 20) continue;
      const [hull] = vehicleSolids(h.kind, h.state);
      if (p.y < hull.bottom || p.y > hull.top) continue;
      if (distanceTo(h.kind, h.state, p.x, p.z) <= r) return { on: "ship", hull: h };
    }
    const plot = this.plotAt(p.x, p.z);
    if (plot)
      for (const o of plot.items) {
        if (o.hp <= 0 || o.id === s.from.item) continue;
        const d = CATALOGUE[o.kind];
        if (Math.abs(o.x - p.x) > d.hx + d.hz + 1 || Math.abs(o.z - p.z) > d.hx + d.hz + 1)
          continue;
        if (p.y < o.y - 1 || p.y > o.y + d.top + 0.5) continue;
        for (const k of itemSolids(o))
          if (p.y > k.bottom && p.y < k.top && overSolid(k, p.x, p.z))
            return { on: "item", plot, item: o };
      }
    if (p.y < SEA_LEVEL && this.host.world.heightAt(p.x, p.z) < SEA_LEVEL) return { on: "water" };
    if (p.y <= this.host.world.heightAt(p.x, p.z)) return { on: "ground" };
    for (const k of this.host.world.solidsNear(p.x, p.z)) {
      if (p.y <= k.bottom || p.y >= k.top || !overSolid(k, p.x, p.z)) continue;
      /* Its own defense, or its own ship, isn't in its way. */
      const mine =
        (s.from.item !== null &&
          plot?.items.some((o) => o.id === s.from.item && overItem(o, p.x, p.z, 0.3))) ||
        (own && distanceTo(own.kind, own.state, p.x, p.z) < 0.3);
      if (!mine) return { on: "solid" };
    }
    return null;
  }

  private plotAt(x: number, z: number) {
    for (const p of this.host.plots.values()) {
      const half = PLOT_SIZES[p.size].size / 2;
      if (Math.abs(x - p.x) <= half && Math.abs(z - p.z) <= half) return p;
    }
    return null;
  }

  /* It came down on something: a hit, a burst, or (a keg, a smoke bomb) somewhere to lie. */
  private land(s: Shot, found: Found, p: Point, last: Point, t: number, now: number) {
    const spec = SHOTS[s.kind];
    this.host.landed(s, p);
    const msg: Extract<ServerMsg, { t: "land" }> = {
      t: "land",
      id: s.id,
      p: r2(p),
      at: round2(t),
      on: found.on as LandOn,
    };
    if (spec.rests) {
      /* Where it lands: under the last open air it was in, unless that's the sea. */
      const g = this.host.world.groundAt(last.x, last.z, last.y + 0.2).ground;
      const wet = found.on === "water" || g < SEA_LEVEL - 0.3;
      const at = { x: last.x, y: wet ? SEA_LEVEL : g, z: last.z };
      msg.p = r2(at);
      msg.on = wet ? "water" : found.on === "body" ? "ground" : found.on;
      this.host.broadcast(msg);
      if (wet) {
        /* A keg in the sea is a dud, and smoke doesn't rise out of it. */
        this.live.delete(s.id);
        return;
      }
      if (spec.smoke) {
        this.clouds.push({ ...at, until: now + SMOKE.time });
        this.live.delete(s.id);
        return;
      }
      s.age = t;
      s.rest = at;
      return;
    }
    if (spec.blast) {
      this.host.broadcast(msg);
      this.burst(s, found.on === "ground" || found.on === "water" ? last : p, false, found);
      return;
    }
    const hit = this.hit(s, found, p);
    if (hit.who !== undefined) msg.who = hit.who;
    if (hit.dmg) msg.dmg = Math.round(hit.dmg);
    this.host.broadcast(msg);
    this.live.delete(s.id);
  }

  /* A plain shot's hit: on whatever it found, as hard as its payload. */
  private hit(s: Shot, found: Found, p: Point): { who?: number; dmg?: number } {
    const spec = SHOTS[s.kind];
    const f = s.flight;
    const speed = Math.hypot(f.vx, f.vz) || 1;
    switch (found.on) {
      case "body": {
        const push = { x: f.vx / speed, z: f.vz / speed, speed: spec.knock, lift: spec.lift };
        const dmg = this.host.hurtBody(s, found.target.id, s.load.damage, push);
        return { who: found.target.id, dmg };
      }
      case "animal":
        return { who: found.animal.id, dmg: this.host.hurtAnimal(s, found.animal, s.load.damage) };
      case "ship":
        return { who: found.hull.id, dmg: this.host.hurtHull(s, found.hull.id, s.load.hull) };
      case "item": {
        const def = CATALOGUE[found.item.kind];
        const dmg = this.host.hurtItem(
          s,
          found.plot,
          found.item,
          s.load.siege * spec.resist[def.material],
          p,
        );
        if (spec.ignites && def.material === "wood") this.host.ignite(s, found.plot, found.item);
        return { who: found.item.id, dmg };
      }
      default:
        return {};
    }
  }

  /*
   * A blast at `at`: everyone and everything within its reach takes a share,
   * the whole of it close in. A keg's is news of its own (it went off where it lay).
   */
  private burst(s: Shot, at: Point, fused: boolean, found?: Found) {
    this.live.delete(s.id);
    const b = SHOTS[s.kind].blast;
    if (fused) this.host.broadcast({ t: "boom", id: s.id, p: r2(at) });
    if (!b) return;
    const k = s.load.scale;
    for (const o of this.host.bodies()) {
      if (!this.mayHit(s, o)) continue;
      const dx = o.x - at.x;
      const dz = o.z - at.z;
      const d = Math.hypot(dx, o.y + 1 - at.y, dz);
      const share = blastShare(b, d);
      if (share <= 0) continue;
      const flat = Math.hypot(dx, dz) || 1;
      this.host.hurtBody(s, o.id, b.damage * share * k, {
        x: dx / flat,
        z: dz / flat,
        speed: b.knock * share,
        lift: b.lift * share,
      });
    }
    if (this.hunts(s))
      for (const a of this.host.animals()) {
        if (a.respawnAt !== null || a.state === "dead") continue;
        const share = blastShare(b, Math.hypot(a.x - at.x, a.y + 0.6 - at.y, a.z - at.z));
        if (share > 0) this.host.hurtAnimal(s, a, b.damage * share * k);
      }
    for (const h of this.host.hulls()) {
      if (h.id === s.from.ride) continue;
      const d = distanceTo(h.kind, h.state, at.x, at.z);
      const share = Math.abs(h.state.y - at.y) < 6 ? blastShare(b, d) : 0;
      if (share > 0) this.host.hurtHull(s, h.id, b.hull * share * k);
    }
    const plot = this.plotAt(at.x, at.z);
    if (!plot) return;
    const spec = SHOTS[s.kind];
    for (const o of plot.items) {
      if (o.hp <= 0 || o.id === s.from.item) continue;
      /* Hit square on, it's at the middle of the blast whatever its size. */
      const direct = found?.on === "item" && found.item === o;
      const near = direct
        ? { d: 0, x: at.x, y: at.y, z: at.z }
        : strikeOn(o, at.x, at.y - 1, at.z, 0, 0, b.radius, -1);
      if (!near) continue;
      const share = blastShare(b, near.d);
      if (share <= 0) continue;
      const def = CATALOGUE[o.kind];
      this.host.hurtItem(s, plot, o, b.siege * share * k * spec.resist[def.material], near);
    }
  }
}
