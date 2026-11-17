import type { Archipelago } from "../shared/archipelago";
import { CATALOGUE, type PlacedItem } from "../shared/catalogue";
import {
  HEALTH_MAX,
  HEALTH_REGEN,
  REGEN_DELAY,
  SEA_LEVEL,
  SPRINT_SPEED,
  STAMINA_MAX,
  STEP_HEIGHT,
  WALK_SPEED,
} from "../shared/constants";
import {
  CREW_ID_BASE,
  CREW_PRICE,
  type CrewSnap,
  type CrewView,
  type Hand,
  KNOCKOUT_MIN,
  KNOCKOUT_TIME,
  nameIndex,
  type Order,
  pickName,
  pickSkin,
  skinIndex,
} from "../shared/crew";
import { angleTo, clamp, wrapAngle } from "../shared/math";
import { type Body, createBody, FLOAT_DEPTH, stepBody } from "../shared/physics";
import { coastOf, PLOT_SIZES, shielded } from "../shared/plots";
import { FLAG, round2 } from "../shared/protocol";
import { CAPTURE_RADIUS } from "../shared/raids";
import type { SavedPlot } from "../shared/save";
import { strikeOn } from "../shared/siege";
import type { SkinId } from "../shared/skins";
import { overSolid, type Terrain } from "../shared/terrain";
import {
  COMBO_WINDOW,
  DAZE_SPEED,
  guardOf,
  STAGGER_GRACE,
  STAGGER_RECOVER,
  type WeaponDef,
  type WeaponKind,
  WEAPONS,
  weaponDef,
  weaponIndex,
} from "../shared/weapons";

/*
 * The crews, as the room runs them. A crewman is a body like a player's,
 * stepped by the same controller, steered by a small state machine (no
 * pathfinding: a few probes round walls and away from the sea, a side-step
 * and a hop when he's stuck), and he swings through the same blows a
 * player's do. What he does depends on what his master told him:
 *
 *   home    keep to his post (a round of the Hearth, a tower or a gate, the
 *           village), and drive off anyone raiding the land; at a Hearth
 *           being taken he stands on it; with a bucket he fights fires.
 *   follow  keep at his master's back, aboard and ashore, and fight what he
 *           fights: whoever hits either of them, the owners of land they're
 *           raiding, the things his master is battering.
 *   hold    stand where he was told and fight anything that comes near.
 *
 * Only the men near someone are stepped (MAX_AWAKE at most, nearest first);
 * the rest stand at their posts until someone comes by.
 */

/* Men stepped at once, at most, and how near someone has to be to wake one. */
const MAX_AWAKE = 48;
const WAKE_RANGE = 220;
/* How far from home an at-home man goes after a raider (past his land's edge). */
const HOME_LEASH = 6;
/* Following: how far round his master he looks for a fight, and how far he strays for one. */
const FOLLOW_RANGE = 18;
const FOLLOW_LEASH = 26;
/* Holding: the same, round the spot he holds. */
const HOLD_RANGE = 14;
const HOLD_LEASH = 20;
/* A follower this far behind a master who's on his feet catches up at once. */
const FOLLOW_WARP = 60;
/* Seconds a grudge lasts: whoever hits one of you, or whom your master hits. */
const FEUD_TIME = 12;
/* Seconds the thing your master is battering stays the crew's target too. */
const SIEGE_TIME = 6;
/* A pace for strolling round a post. */
const STROLL = 2.4;
/*
 * A bowman looses from about this far off (nearer, with something that
 * doesn't carry so far: a wand), and backs away from anyone closer than this.
 */
const BOW_RANGE = 22;
const BOW_CLOSE = 8;
const rangeOf = (def: WeaponDef) => Math.min(BOW_RANGE, def.reach - 2);
/* Physics steps a tick (the room ticks at 20 Hz; the controller likes small steps). */
const SUBSTEP = 1 / 40;

/* Someone a crewman might fight: a player, or another crew's man. `side` is whose they are. */
export type Mark = {
  id: number;
  side: string;
  x: number;
  y: number;
  z: number;
  /* The plot they're raiding. */
  raid: number | null;
  /* How they're moving, for a bowman to lead them. */
  vx?: number;
  vz?: number;
};

/* What the crew need to know of their master, if he's out on the map. */
export type Master = {
  id: number;
  body: Body;
  ride: { id: number; seat: number } | null;
  respawnAt: number | null;
  flags: number;
};

export type Crewman = {
  kind: "crew";
  id: number;
  /* Who he is, as his land keeps him. */
  hand: Hand;
  plot: number;
  /* His master's token. */
  owner: string;
  body: Body;
  flags: number;
  health: number;
  lastHurtAt: number;
  /* Knocked out: when he wakes (at the latest), and when he went down. */
  respawnAt: number | null;
  downAt: number;
  stagger: number;
  lastHitAt: number;
  blocking: boolean;
  blockSince: number;
  /* Winding up a charged weapon, since then; and whether he's still at it this tick. */
  charging: boolean;
  chargeAt: number;
  striking: boolean;
  bleed: { left: number; per: number; nextAt: number; by: number } | null;
  /* A bucket with water in it. */
  water: boolean;
  combo: number;
  lastSwingAt: number;
  attackReadyAt: number;
  shoveFlagUntil: number;
  dazeUntil: number;
  /* Aboard his master's vehicle, in this seat. */
  ride: { id: number; seat: number } | null;
  /* The plot he's raiding (following his master onto someone else's land). */
  raid: number | null;
  /* Woken at home after a knock-out: he keeps to his post until his master comes home. */
  benched: boolean;
  /* Stepped this tick. */
  awake: boolean;
  /* ---- what he's doing ---- */
  target: number | null;
  /* With a bow: what he's loosing at, chest-high on a man or the near side of a wall. */
  aim: { x: number; y: number; z: number; vx: number; vz: number } | null;
  /* Where he's going, and how fast; null: standing. */
  goal: { x: number; z: number; speed: number; swim: boolean } | null;
  /* At his post: the waypoint he's on, and when he moves on from it (0: not there yet). */
  wp: number;
  waitUntil: number;
  /* Facing this way (null: the way he's walking); and where he last glanced, idling. */
  look: number | null;
  gaze: number | null;
  /* Stuck: checked every second; a side-step for a moment, and a hop. */
  checkAt: number;
  checkX: number;
  checkZ: number;
  detour: { ang: number; until: number } | null;
  hop: boolean;
  /* Sent home with nobody to see him go: when he's back. */
  warpAt: number | null;
  /* His place behind his master, among the others following. */
  slot: number;
};

export interface CrewHost {
  readonly world: Archipelago;
  readonly plots: ReadonlyMap<number, SavedPlot>;
  rng(): number;
  /* His master, if he's out on the map now. */
  master(token: string): Master | null;
  /* On the Harbor, where nobody comes to harm. */
  sheltered(x: number, z: number): boolean;
  burning(id: number): boolean;
  /* Would it catch if a torch touched it now? */
  catches(item: PlacedItem): boolean;
  /* A Hearth being taken right now. */
  besieged(plot: number): boolean;
  /* A blow: the room lands it after the weapon's wind-up, as a player's. */
  swing(c: Crewman, heavy: boolean, power: number): void;
  /* Into a free seat of this vehicle (never the helm); false if there's no room. */
  board(c: Crewman, ride: number): boolean;
  /* Out of his seat, set down beside the vehicle. */
  unboard(c: Crewman): void;
}

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

export class Crew {
  readonly men = new Map<number, Crewman>();
  nextId = CREW_ID_BASE;
  /* What each master has told his crew, and where to hold. */
  private orders = new Map<string, { order: Order; hold: { x: number; z: number } | null }>();
  /* Who each side is fighting, until when: whoever hit one of them, or was hit by their master. */
  private feuds = new Map<string, Map<number, number>>();
  /* What each master is battering, for his crew to join in. */
  private sieges = new Map<string, { plot: number; item: number; until: number }>();
  /* Masters whose view of their crew has changed: the room sends it at the end of the tick. */
  readonly dirty = new Set<string>();
  private marks: Mark[] = [];
  private pruneAt = 0;

  constructor(private readonly host: CrewHost) {}

  /* ---------- who's who ---------- */

  get(id: number) {
    return this.men.get(id) ?? null;
  }

  /* A plot's men, in the order they were hired. */
  of(plot: number) {
    const out: Crewman[] = [];
    for (const c of this.men.values()) if (c.plot === plot) out.push(c);
    return out;
  }

  orderOf(token: string): Order {
    return this.orders.get(token)?.order ?? "home";
  }

  /* Your crew, as the marketplace shows them. */
  view(plot: SavedPlot): { order: Order; men: CrewView[] } {
    return {
      order: this.orderOf(plot.owner),
      men: (plot.crew ?? []).map((h) => ({
        id: h.id,
        name: h.name,
        skin: h.skin,
        weapon: h.weapon,
        down: this.men.get(h.id)?.respawnAt != null,
      })),
    };
  }

  /* Everyone standing (not down, not aboard) within `r` of (x, z): who a blow can land on. */
  near(x: number, z: number, r: number) {
    const out: Crewman[] = [];
    for (const c of this.men.values()) {
      if (c.respawnAt !== null || c.ride) continue;
      if (Math.abs(c.body.x - x) <= r && Math.abs(c.body.z - z) <= r) out.push(c);
    }
    return out;
  }

  /* ---------- hiring ---------- */

  /* Bring a land's men out (a plot raised, or loaded), at their posts. */
  muster(plot: SavedPlot, now: number) {
    for (const h of plot.crew ?? []) if (!this.men.has(h.id)) this.add(plot, h, now);
  }

  private add(plot: SavedPlot, hand: Hand, now: number) {
    const at = this.homeSpot(plot, (plot.crew ?? []).indexOf(hand));
    const c: Crewman = {
      kind: "crew",
      id: hand.id,
      hand,
      plot: plot.id,
      owner: plot.owner,
      body: createBody(at.x, at.y, at.z, this.host.rng() * Math.PI * 2),
      flags: FLAG.alive | FLAG.grounded,
      health: HEALTH_MAX,
      lastHurtAt: -1e9,
      respawnAt: null,
      downAt: 0,
      stagger: 0,
      lastHitAt: 0,
      blocking: false,
      blockSince: 0,
      charging: false,
      chargeAt: 0,
      striking: false,
      bleed: null,
      water: hand.weapon === "bucket",
      combo: 0,
      lastSwingAt: 0,
      attackReadyAt: now,
      shoveFlagUntil: 0,
      dazeUntil: 0,
      ride: null,
      raid: null,
      benched: false,
      awake: false,
      target: null,
      aim: null,
      goal: null,
      wp: Math.floor(this.host.rng() * 6),
      waitUntil: 0,
      look: null,
      gaze: null,
      checkAt: now + 1,
      checkX: at.x,
      checkZ: at.z,
      detour: null,
      hop: false,
      warpAt: null,
      slot: 0,
    };
    this.men.set(c.id, c);
    return c;
  }

  /*
   * Hire a man for this land, paid from `purse`. Says why not, or who's
   * joined; true when he's been paid for.
   */
  hire(
    plot: SavedPlot,
    purse: { coins: number },
    masterSkin: SkinId,
    say: (text: string) => void,
    now: number,
  ) {
    const def = PLOT_SIZES[plot.size];
    const men = plot.crew ?? [];
    if (men.length >= def.crew) {
      say(`Your ${def.name.toLowerCase()} houses ${def.crew} men: grow your land for more`);
      return false;
    }
    if (purse.coins < CREW_PRICE) {
      say(`Hiring a man costs ${CREW_PRICE} coins`);
      return false;
    }
    const rng = () => this.host.rng();
    const hand: Hand = {
      id: this.nextId++,
      name: pickName(
        men.map((o) => o.name),
        rng,
      ),
      skin: pickSkin(
        masterSkin,
        men.map((o) => o.skin),
        rng,
      ),
      weapon: null,
    };
    plot.crew = [...men, hand];
    purse.coins -= CREW_PRICE;
    this.add(plot, hand, now);
    this.dirty.add(plot.owner);
    say(`${hand.name} joins your crew · he keeps to your land till you call him (G)`);
    return true;
  }

  /* Let a man go, for nothing back. */
  dismiss(plot: SavedPlot, id: number, say: (text: string) => void) {
    const hand = plot.crew?.find((h) => h.id === id);
    if (!hand) return false;
    const c = this.men.get(id);
    if (c?.ride) this.host.unboard(c);
    this.men.delete(id);
    plot.crew = plot.crew?.filter((h) => h.id !== id);
    if (!plot.crew?.length) delete plot.crew;
    this.dirty.add(plot.owner);
    say(`${hand.name} has left your crew`);
    return true;
  }

  /* Buy a man a weapon (at its price), or take his away. True when anything changed. */
  arm(
    plot: SavedPlot,
    id: number,
    kind: WeaponKind | null,
    purse: { coins: number },
    say: (text: string) => void,
  ) {
    const hand = plot.crew?.find((h) => h.id === id);
    if (!hand || hand.weapon === kind) return false;
    if (kind && WEAPONS[kind].throws) {
      say("Kegs and smoke bombs are for your own hands");
      return false;
    }
    const price = kind ? WEAPONS[kind].price : 0;
    if (purse.coins < price) {
      say(`A ${WEAPONS[kind!].name.toLowerCase()} costs ${price} coins`);
      return false;
    }
    purse.coins -= price;
    hand.weapon = kind;
    const c = this.men.get(id);
    if (c) {
      /* A bucket comes full: he's no time to go looking for water before the first fire. */
      c.water = kind === "bucket";
      c.blocking = false;
      c.charging = false;
    }
    this.dirty.add(plot.owner);
    say(
      kind
        ? `${hand.name} takes up the ${WEAPONS[kind].name.toLowerCase()}`
        : `${hand.name} puts his weapon away`,
    );
    return true;
  }

  /* ---------- orders ---------- */

  /*
   * Follow me, hold here, or go home. Sent home from somewhere else, a man
   * makes his own way back: he's gone a moment later.
   */
  order(token: string, order: Order, now: number, at: { x: number; z: number } | null = null) {
    /* The spot itself, not whoever's standing on it. */
    const hold = order === "hold" && at ? { x: at.x, z: at.z } : null;
    this.orders.set(token, { order, hold });
    this.dirty.add(token);
    for (const c of this.men.values()) {
      if (c.owner !== token) continue;
      c.target = null;
      c.goal = null;
      if (order !== "home") {
        /* Called again: whoever was knocked out comes along too. */
        c.benched = false;
        c.warpAt = null;
        continue;
      }
      if (!this.onLand(c, c.plot)) c.warpAt = now + 2;
    }
  }

  /* Their master has gone: they go home, wherever they are. */
  masterLeft(token: string) {
    this.orders.delete(token);
    this.feuds.delete(token);
    this.sieges.delete(token);
    for (const c of this.men.values()) {
      if (c.owner !== token) continue;
      if (c.ride) this.host.unboard(c);
      c.target = null;
      c.goal = null;
      c.raid = null;
      if (!this.onLand(c, c.plot)) this.sendHome(c);
    }
  }

  /* The land under them was regrown: back to their posts. */
  rehome(plot: number) {
    for (const c of this.men.values()) if (c.plot === plot) this.sendHome(c);
  }

  /* ---------- fighting ---------- */

  /* One side has a quarrel with someone: they hit one of us, or our master hit them. */
  feud(side: string, id: number, now: number) {
    let f = this.feuds.get(side);
    if (!f) this.feuds.set(side, (f = new Map()));
    f.set(id, now + FEUD_TIME);
  }

  /* A master hit something on someone else's land: his crew join in. */
  siege(side: string, plot: number, item: number, now: number) {
    this.sieges.set(side, { plot, item, until: now + SIEGE_TIME });
  }

  /* A blow (or a bleed) landed on him. True if it knocked him out. */
  hurt(c: Crewman, amount: number, now: number) {
    if (c.respawnAt !== null || amount <= 0) return false;
    c.health = Math.max(0, c.health - amount);
    c.lastHurtAt = now;
    if (c.health > 0) return false;
    c.respawnAt = now + KNOCKOUT_TIME;
    c.downAt = now;
    if (c.ride) this.host.unboard(c);
    c.blocking = false;
    c.charging = false;
    c.bleed = null;
    c.target = null;
    c.goal = null;
    c.raid = null;
    this.dirty.add(c.owner);
    return true;
  }

  /* Knocked back (or hooked in): the body takes it. */
  push(c: Crewman, vx: number, vy: number, vz: number) {
    if (c.ride) return;
    const b = c.body;
    b.vx += vx;
    b.vz += vz;
    b.vy = Math.max(b.vy, vy);
    b.grounded = false;
  }

  daze(c: Crewman, seconds: number, now: number) {
    c.dazeUntil = Math.max(c.dazeUntil, now + seconds);
  }

  /* ---------- the tick ---------- */

  /*
   * `players` are everyone on their feet who can be fought; `eyes` everyone
   * out on the map, who keep the men near them awake.
   */
  tick(
    now: number,
    dt: number,
    players: readonly Mark[],
    eyes: readonly { x: number; z: number }[],
  ) {
    if (!this.men.size) return;
    if (now > this.pruneAt) this.prune(now);
    this.wake(eyes);
    this.marks.length = 0;
    for (const p of players) this.marks.push(p);
    for (const c of this.men.values())
      if (c.awake && c.respawnAt === null && !c.ride)
        this.marks.push({
          id: c.id,
          side: c.owner,
          x: c.body.x,
          y: c.body.y,
          z: c.body.z,
          raid: c.raid,
          vx: c.body.vx,
          vz: c.body.vz,
        });
    /* Each master's followers, in a line behind him. */
    const slots = new Map<string, number>();
    for (const c of this.men.values()) {
      if (c.respawnAt !== null) {
        this.down(c, now, dt);
        continue;
      }
      if (c.health < HEALTH_MAX && now - c.lastHurtAt > REGEN_DELAY)
        c.health = Math.min(HEALTH_MAX, c.health + HEALTH_REGEN * dt);
      if (now - c.lastHitAt > STAGGER_GRACE)
        c.stagger = Math.max(0, c.stagger - STAGGER_RECOVER * dt);
      if (!c.awake) continue;
      const master = this.host.master(c.owner);
      let order = master ? this.orderOf(c.owner) : "home";
      if (c.benched && master && this.onLand(master.body, c.plot)) c.benched = false;
      if (c.benched) order = "home";
      if (order !== "home") {
        c.slot = slots.get(c.owner) ?? 0;
        slots.set(c.owner, c.slot + 1);
      }
      if (c.warpAt !== null && now >= c.warpAt) this.sendHome(c);
      this.raiding(c, order, now);
      c.goal = null;
      c.look = null;
      c.aim = null;
      if (c.ride) {
        this.aboard(c, master, order);
        continue;
      }
      c.striking = false;
      if (order === "follow" && master) this.follow(c, master, now);
      else if (order === "hold" && master) this.hold(c, now, dt);
      else this.home(c, now, dt);
      /* A wind-up he's no longer at is let go. */
      if (!c.striking) c.charging = false;
      this.guard(c, now);
      this.move(c, now, dt);
    }
  }

  /* Who's stepped this tick: following men, and the nearest to anyone, MAX_AWAKE at most. */
  private wake(eyes: readonly { x: number; z: number }[]) {
    const near: [Crewman, number][] = [];
    for (const c of this.men.values()) {
      c.awake = false;
      let d = Number.POSITIVE_INFINITY;
      if (this.orderOf(c.owner) !== "home" && !c.benched && this.host.master(c.owner)) d = 0;
      else
        for (const e of eyes)
          d = Math.min(d, Math.max(Math.abs(e.x - c.body.x), Math.abs(e.z - c.body.z)));
      if (d <= WAKE_RANGE) near.push([c, d]);
    }
    if (near.length > MAX_AWAKE) near.sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < Math.min(MAX_AWAKE, near.length); i++) near[i][0].awake = true;
  }

  private prune(now: number) {
    this.pruneAt = now + 5;
    for (const [side, f] of this.feuds) {
      for (const [id, until] of f) if (until < now) f.delete(id);
      if (!f.size) this.feuds.delete(side);
    }
    for (const [side, s] of this.sieges) if (s.until < now) this.sieges.delete(side);
  }

  /*
   * Knocked out: he lies where he fell until KNOCKOUT_TIME is up, or, once
   * KNOCKOUT_MIN has passed, as soon as nobody's fighting near him. Then he
   * wakes at the Hearth, whole, with whatever he carried.
   */
  private down(c: Crewman, now: number, dt: number) {
    this.settle(c, dt);
    const over =
      now >= (c.respawnAt ?? 0) ||
      (now - c.downAt > KNOCKOUT_MIN &&
        !this.marks.some(
          (k) => this.hostile(c, k, now) && dist(k.x, k.z, c.body.x, c.body.z) < 30,
        ));
    if (!over) return;
    c.respawnAt = null;
    c.health = HEALTH_MAX;
    c.stagger = 0;
    c.benched = this.orderOf(c.owner) !== "home";
    if (c.hand.weapon === "bucket") c.water = true;
    this.sendHome(c);
    this.dirty.add(c.owner);
  }

  /* Following his master onto someone else's unshielded land: he's raiding it. */
  private raiding(c: Crewman, order: Order, now: number) {
    c.raid = null;
    if (order === "home") return;
    const p = this.plotAt(c.body.x, c.body.z);
    if (p && p.owner !== c.owner && !shielded(p, now)) c.raid = p.id;
  }

  /* Aboard: he sits tight until his master gets off (or calls him home). */
  private aboard(c: Crewman, master: Master | null, order: Order) {
    if (master && order === "follow" && master.ride?.id === c.ride?.id) return;
    this.host.unboard(c);
    if (master && !master.ride && dist(master.body.x, master.body.z, c.body.x, c.body.z) < 40)
      this.beside(c, master);
  }

  /* ---------- at home ---------- */

  private home(c: Crewman, now: number, dt: number) {
    const plot = this.host.plots.get(c.plot);
    const t = plot ? this.terrainOf(plot) : null;
    if (!plot || !t) return;
    /* Not on his land (his master went home without him): he heads back, out of sight. */
    if (!this.onLand(c, c.plot, 2)) {
      c.warpAt ??= now + 2;
      return;
    }
    const weapon = c.hand.weapon;
    if (weapon === "bucket" && this.fireFight(c, plot, t, now)) return;
    const h = t.hearth;
    /* His Hearth is being taken: onto the plinth, and fight whoever's on it. */
    if (h && this.host.besieged(plot.id)) {
      const foe = this.pickFoe(c, h.x, h.z, CAPTURE_RADIUS + 4, plot, now);
      const a = foe ? Math.atan2(foe.z - h.z, foe.x - h.x) : (c.hand.id % 7) * 0.9;
      const r = Math.min(2.4, foe ? dist(foe.x, foe.z, h.x, h.z) : 2.4);
      const sx = h.x + Math.cos(a) * r;
      const sz = h.z + Math.sin(a) * r;
      const def = weaponDef(weapon);
      const close = def.ranged ? rangeOf(def) : def.reach + 0.4;
      if (foe && dist(foe.x, foe.z, c.body.x, c.body.z) < close) {
        this.fight(c, foe, now, false);
        return;
      }
      this.goTo(c, sx, sz, WALK_SPEED * 1.4, false, 0.6);
      if (foe) c.look = angleTo(foe.x - c.body.x, foe.z - c.body.z);
      return;
    }
    const foe = this.pickFoe(c, c.body.x, c.body.z, 45, plot, now);
    if (foe) {
      this.fight(c, foe, now, false);
      return;
    }
    c.target = null;
    this.post(c, plot, t, now, dt);
  }

  /*
   * His post, by his place in the crew: every third man walks a round of the
   * Hearth, the next stands at a tower or a gate (if there's one), the next
   * strolls the village from building to building.
   */
  private post(c: Crewman, plot: SavedPlot, t: Terrain, now: number, dt: number) {
    const index = Math.max(0, (plot.crew ?? []).indexOf(c.hand));
    const h = t.hearth ?? t.home;
    const watch = plot.items.filter(
      (o) => o.hp > 0 && (CATALOGUE[o.kind].shelf === "towers" || /Gate|Door/.test(o.kind)),
    );
    const homes = plot.items.filter(
      (o) =>
        o.hp > 0 && (CATALOGUE[o.kind].shelf === "homes" || CATALOGUE[o.kind].shelf === "village"),
    );
    const kind = index % 3 === 1 && watch.length ? "watch" : index % 3 === 2 ? "village" : "round";
    let spot: { x: number; z: number };
    if (kind === "watch") {
      const o = watch[Math.floor(index / 3) % watch.length];
      const d = CATALOGUE[o.kind];
      const a = Math.atan2(h.z - o.z, h.x - o.x);
      const r = Math.max(d.hx, d.hz) + 1.6;
      spot = this.dry(t, o.x + Math.cos(a) * r, o.z + Math.sin(a) * r, h);
      /* Facing out, the way trouble comes from, and now and then a glance either side. */
      if (dist(spot.x, spot.z, c.body.x, c.body.z) < 1.2) {
        if (now > c.waitUntil) {
          c.wp = (c.wp + 1) % 6;
          c.waitUntil = now + 3 + this.host.rng() * 5;
        }
        c.look = angleTo(-Math.cos(a), -Math.sin(a)) + ((c.wp % 3) - 1) * 0.5;
        return;
      }
    } else if (kind === "village" && homes.length) {
      const o = homes[(c.wp + index) % homes.length];
      const d = CATALOGUE[o.kind];
      const a = Math.atan2(h.z - o.z, h.x - o.x) + ((c.wp % 3) - 1) * 0.5;
      const r = Math.max(d.hx, d.hz) + 1.8;
      spot = this.dry(t, o.x + Math.cos(a) * r, o.z + Math.sin(a) * r, h);
    } else {
      /* A ring round the Hearth: six stops, a little wider for every other man. */
      const ring = 12 + (index % 4) * 4;
      const a = (c.wp / 6) * Math.PI * 2 + index * 0.7;
      spot = this.dry(t, h.x + Math.cos(a) * ring, h.z + Math.sin(a) * ring, h);
    }
    if (dist(spot.x, spot.z, c.body.x, c.body.z) < 1.2) {
      /* There: a look about, then on to the next. */
      if (!c.waitUntil) c.waitUntil = now + 2 + this.host.rng() * 4;
      if (now > c.waitUntil) {
        c.wp = (c.wp + 1 + Math.floor(this.host.rng() * 2)) % 6;
        c.waitUntil = 0;
      } else if (this.host.rng() < dt * 0.5) c.gaze = c.body.yaw + (this.host.rng() - 0.5) * 2.4;
      c.look = c.gaze;
      return;
    }
    c.waitUntil = 0;
    this.goTo(c, spot.x, spot.z, STROLL, false, 0.8);
  }

  /*
   * With a bucket, at home: the nearest fire, and water first if the bucket's
   * empty (a well on the land, or the shore). True while there's a fire to fight.
   */
  private fireFight(c: Crewman, plot: SavedPlot, t: Terrain, now: number) {
    const b = c.body;
    let fire: PlacedItem | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const o of plot.items) {
      if (o.hp <= 0 || !this.host.burning(o.id)) continue;
      const d = dist(o.x, o.z, b.x, b.z);
      if (d < best) {
        best = d;
        fire = o;
      }
    }
    if (!fire) return false;
    if (!c.water) {
      this.fetchWater(c, plot, t);
      return true;
    }
    this.batter(c, fire, now, false);
    return true;
  }

  private fetchWater(c: Crewman, plot: SavedPlot, t: Terrain) {
    const b = c.body;
    if (b.y < SEA_LEVEL - 0.05) {
      c.water = true;
      return;
    }
    let best = Number.POSITIVE_INFINITY;
    let to: { x: number; z: number } | null = null;
    for (const o of plot.items) {
      if (o.kind !== "well" || o.hp <= 0) continue;
      const d = CATALOGUE.well;
      const gap = dist(o.x, o.z, b.x, b.z) - Math.max(d.hx, d.hz);
      if (gap < 2.2) {
        c.water = true;
        return;
      }
      if (gap < best) {
        best = gap;
        to = { x: o.x, z: o.z };
      }
    }
    const coast = coastOf(t);
    for (let k = 0; k < coast.length; k += 2) {
      const d = dist(coast[k], coast[k + 1], b.x, b.z);
      if (d < 1.6) {
        c.water = true;
        return;
      }
      if (d < best) {
        best = d;
        to = { x: coast[k], z: coast[k + 1] };
      }
    }
    if (to) this.goTo(c, to.x, to.z, WALK_SPEED * 1.3, false, 0.3);
  }

  /* ---------- out with his master ---------- */

  private follow(c: Crewman, master: Master, now: number) {
    const m = master.body;
    const gap = dist(m.x, m.z, c.body.x, c.body.z);
    /* His master's aboard something: in with him, if there's a seat. Otherwise he waits. */
    if (master.ride) {
      if (gap < 35 && this.host.board(c, master.ride.id)) return;
      c.look = angleTo(m.x - c.body.x, m.z - c.body.z);
      return;
    }
    /* Left behind (a boat with no room, a ride, a long fall): he catches up as you land. */
    if (gap > FOLLOW_WARP && master.respawnAt === null) {
      this.beside(c, master);
      return;
    }
    const foe = this.pickFoe(c, m.x, m.z, FOLLOW_RANGE, null, now);
    if (foe && dist(foe.x, foe.z, m.x, m.z) < FOLLOW_LEASH) {
      this.fight(c, foe, now, true);
      return;
    }
    c.target = null;
    if (this.siegeWork(c, master, now)) return;
    /* His master's at a Hearth he's taking: onto it with him. */
    if (c.raid !== null) {
      const h = this.terrainOf(this.host.plots.get(c.raid))?.hearth;
      if (h && dist(m.x, m.z, h.x, h.z) < CAPTURE_RADIUS + 1) {
        const a = c.slot * 1.3 + 0.4;
        this.goTo(c, h.x + Math.cos(a) * 2.3, h.z + Math.sin(a) * 2.3, WALK_SPEED * 1.4, true, 0.5);
        return;
      }
    }
    this.keepUp(c, m.x, m.z, m.yaw, gap);
  }

  /* In his place behind his master: a few abreast, a pace or two back. */
  private keepUp(c: Crewman, mx: number, mz: number, yaw: number, gap: number) {
    const row = Math.floor(c.slot / 4);
    const side = ((c.slot % 4) - 1.5) * 1.4;
    const back = 2.6 + row * 1.7;
    const sx = mx + Math.sin(yaw) * back + Math.cos(yaw) * side;
    const sz = mz + Math.cos(yaw) * back - Math.sin(yaw) * side;
    const d = dist(sx, sz, c.body.x, c.body.z);
    if (d < 0.9) {
      c.look = yaw;
      return;
    }
    const speed = gap > 12 ? SPRINT_SPEED : d > 3 ? WALK_SPEED : clamp(d * 2.2, 1.5, WALK_SPEED);
    this.goTo(c, sx, sz, speed, true, 0.5);
  }

  private hold(c: Crewman, now: number, dt: number) {
    const spot = this.orders.get(c.owner)?.hold;
    if (!spot) return this.home(c, now, dt);
    const foe = this.pickFoe(c, spot.x, spot.z, HOLD_RANGE, null, now);
    if (foe && dist(foe.x, foe.z, spot.x, spot.z) < HOLD_LEASH) {
      this.fight(c, foe, now, true);
      return;
    }
    c.target = null;
    /* Spread round the spot, all facing out. */
    const a = c.slot * 2.39996;
    const r = c.slot ? 1.3 + Math.sqrt(c.slot) * 0.9 : 0;
    const sx = spot.x + Math.cos(a) * r;
    const sz = spot.z + Math.sin(a) * r;
    if (dist(sx, sz, c.body.x, c.body.z) < 0.8) {
      c.look = c.slot ? angleTo(sx - spot.x, sz - spot.z) : c.body.yaw;
      return;
    }
    this.goTo(c, sx, sz, WALK_SPEED, true, 0.5);
  }

  /*
   * Batter what his master's battering; or, raiding with a torch, set
   * whatever wood is near his master alight. True while there's work.
   */
  private siegeWork(c: Crewman, master: Master, now: number) {
    const s = this.sieges.get(c.owner);
    let item: PlacedItem | null = null;
    if (s && s.until > now) {
      const p = this.host.plots.get(s.plot);
      const o = p?.items.find((x) => x.id === s.item);
      if (p && o && o.hp > 0 && p.owner !== c.owner && !shielded(p, now)) item = o;
    }
    const lights = c.hand.weapon === "torch" || c.hand.weapon === "firebow";
    if (!item && lights && c.raid !== null) {
      const p = this.host.plots.get(c.raid);
      let best = 22;
      for (const o of p?.items ?? []) {
        if (o.hp <= 0 || !this.host.catches(o)) continue;
        const d = dist(o.x, o.z, master.body.x, master.body.z);
        if (d < best) {
          best = d;
          item = o;
        }
      }
    }
    if (!item) return false;
    if (dist(item.x, item.z, master.body.x, master.body.z) > FOLLOW_LEASH) return false;
    this.batter(c, item, now, true);
    return true;
  }

  /* ---------- fighting ---------- */

  /*
   * Is this someone to fight? Never his own side, never on the Harbor.
   * Anyone raiding his land; the owners of land he's raiding (and their
   * men); and anyone his side has a quarrel with.
   */
  private hostile(c: Crewman, k: Mark, now: number) {
    if (k.side === c.owner || k.id === c.id) return false;
    if (this.host.sheltered(k.x, k.z) || this.host.sheltered(c.body.x, c.body.z)) return false;
    if (k.raid !== null && k.raid === c.plot) return true;
    if (c.raid !== null && this.host.plots.get(c.raid)?.owner === k.side) return true;
    return (this.feuds.get(c.owner)?.get(k.id) ?? 0) > now;
  }

  /*
   * The foe nearest him within `r` of (cx, cz) (on `on`'s tile, if given),
   * sticking with the one he's on unless it's got away.
   */
  private pickFoe(
    c: Crewman,
    cx: number,
    cz: number,
    r: number,
    on: SavedPlot | null,
    now: number,
  ): Mark | null {
    const b = c.body;
    let best: Mark | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    const half = on ? PLOT_SIZES[on.size].size / 2 + HOME_LEASH : 0;
    for (const k of this.marks) {
      if (Math.abs(k.y - b.y) > 6) continue;
      if (on && (Math.abs(k.x - on.x) > half || Math.abs(k.z - on.z) > half)) continue;
      const reach = k.id === c.target ? r + 4 : r;
      if (dist(k.x, k.z, cx, cz) > reach || !this.hostile(c, k, now)) continue;
      /* The one he's already on counts as a little nearer. */
      const d = dist(k.x, k.z, b.x, b.z) - (k.id === c.target ? 3 : 0);
      if (d < bestD) {
        best = k;
        bestD = d;
      }
    }
    c.target = best?.id ?? null;
    return best;
  }

  /*
   * Close to his weapon's reach, square up and strike; too close, give a
   * little ground. With a bow he keeps his distance instead, and looses.
   */
  private fight(c: Crewman, foe: { x: number; y: number; z: number }, now: number, swim: boolean) {
    const b = c.body;
    const def = weaponDef(c.hand.weapon);
    const dx = foe.x - b.x;
    const dz = foe.z - b.z;
    const d = Math.hypot(dx, dz);
    if (def.ranged) {
      const mark = this.marks.find((k) => k.id === c.target);
      this.shoot(
        c,
        { x: foe.x, y: foe.y + 1.2, z: foe.z, vx: mark?.vx ?? 0, vz: mark?.vz ?? 0 },
        d,
        now,
        swim,
      );
      return;
    }
    const want = Math.max(1.1, def.reach * 0.65);
    c.look = angleTo(dx, dz);
    if (d > want + 0.3) this.goTo(c, foe.x, foe.z, d > 6 ? SPRINT_SPEED : WALK_SPEED, swim, want);
    else if (d < want * 0.5) this.goTo(c, b.x - dx, b.z - dz, 2, swim, 0);
    const facing = d < 0.6 || Math.abs(wrapAngle(c.look - b.yaw)) < 0.5;
    if (d <= def.reach + 0.2 && Math.abs(foe.y - b.y) < 2 && facing) this.attack(c, now);
  }

  /*
   * A bowman's fight: in to his range, back off if they close on him, and
   * loose when he's square to them. He holds his ground in between.
   */
  private shoot(
    c: Crewman,
    at: { x: number; y: number; z: number; vx: number; vz: number },
    d: number,
    now: number,
    swim: boolean,
  ) {
    const b = c.body;
    c.look = angleTo(at.x - b.x, at.z - b.z);
    c.aim = at;
    const range = rangeOf(weaponDef(c.hand.weapon));
    if (d > range)
      this.goTo(c, at.x, at.z, d > range + 10 ? SPRINT_SPEED : WALK_SPEED, swim, range - 2);
    else if (d < BOW_CLOSE)
      this.goTo(c, b.x - (at.x - b.x), b.z - (at.z - b.z), WALK_SPEED, swim, 0);
    const facing = Math.abs(wrapAngle(c.look - b.yaw)) < 0.25;
    if (d <= range + 4 && facing) this.attack(c, now);
  }

  /* Up to something built, and at it: the nearest part of it, not its middle. */
  private batter(c: Crewman, item: PlacedItem, now: number, swim: boolean) {
    const b = c.body;
    const def = weaponDef(c.hand.weapon);
    const at = strikeOn(item, b.x, b.y, b.z, 0, 0, 80, -1);
    if (!at) {
      this.goTo(c, item.x, item.z, WALK_SPEED, swim, 1);
      return;
    }
    if (def.ranged) {
      this.shoot(c, { x: at.x, y: at.y, z: at.z, vx: 0, vz: 0 }, at.d, now, swim);
      return;
    }
    const want = Math.max(0.9, def.reach * 0.6);
    c.look = angleTo(at.x - b.x, at.z - b.z);
    if (at.d > want) this.goTo(c, at.x, at.z, at.d > 6 ? SPRINT_SPEED : WALK_SPEED, swim, want);
    const facing = Math.abs(wrapAngle(c.look - b.yaw)) < 0.4;
    if (at.d <= def.reach * 0.9 && facing) this.attack(c, now);
  }

  /*
   * A swing, as a player's: a charged weapon is wound all the way up first.
   * A man is a beat slower between blows than a player at his quickest.
   */
  private attack(c: Crewman, now: number) {
    c.striking = true;
    if (now < c.attackReadyAt) return;
    const def = weaponDef(c.hand.weapon);
    if (def.charge) {
      if (!c.charging) {
        c.charging = true;
        c.chargeAt = now;
        return;
      }
      if (now - c.chargeAt < def.charge.max) return;
    }
    c.charging = false;
    c.blocking = false;
    let heavy = false;
    if (def.combo) {
      c.combo = now - c.lastSwingAt < COMBO_WINDOW ? c.combo + 1 : 1;
      if (c.combo >= 3) {
        heavy = true;
        c.combo = 0;
      }
    }
    c.lastSwingAt = now;
    c.attackReadyAt = now + def.cooldown + 0.15 + this.host.rng() * 0.3;
    c.shoveFlagUntil = now + 0.35;
    this.host.swing(c, heavy, def.charge ? 1 : 0);
  }

  /* A shield goes up between his own blows, while a foe's within a few steps. */
  private guard(c: Crewman, now: number) {
    const guard = guardOf(c.hand.weapon);
    const foe = c.target === null ? null : this.marks.find((k) => k.id === c.target);
    const up =
      !!guard && !!foe && dist(foe.x, foe.z, c.body.x, c.body.z) < 4 && now < c.attackReadyAt - 0.2;
    if (up && !c.blocking) c.blockSince = now;
    c.blocking = up;
  }

  /* ---------- moving ---------- */

  private goTo(c: Crewman, x: number, z: number, speed: number, swim: boolean, stop: number) {
    if (dist(x, z, c.body.x, c.body.z) <= stop) return;
    c.goal = { x, z, speed, swim };
  }

  /*
   * Steer for the goal round whatever's in the way, then step the body as a
   * player's is stepped. Standing, he turns to whatever he's looking at.
   */
  private move(c: Crewman, now: number, dt: number) {
    const b = c.body;
    const g = c.goal;
    let forward = 0;
    let right = 0;
    let speed = WALK_SPEED;
    if (c.look !== null) b.yaw = turn(b.yaw, c.look, 9 * dt);
    if (g) {
      let ang = Math.atan2(g.z - b.z, g.x - b.x);
      if (c.detour && now < c.detour.until) ang = c.detour.ang;
      else {
        c.detour = null;
        for (const t of [0, 0.5, -0.5, 1.1, -1.1, 1.7, -1.7]) {
          if (this.clear(c, ang + t, g.swim)) {
            ang += t;
            break;
          }
        }
      }
      const wx = Math.cos(ang);
      const wz = Math.sin(ang);
      if (c.look === null) b.yaw = turn(b.yaw, angleTo(wx, wz), 10 * dt);
      const s = Math.sin(b.yaw);
      const k = Math.cos(b.yaw);
      forward = -s * wx - k * wz;
      right = k * wx - s * wz;
      speed = g.speed;
      /* Stuck a second: a side-step, and a hop in case it's a step he can't take. */
      if (now >= c.checkAt) {
        if (dist(b.x, b.z, c.checkX, c.checkZ) < 0.35 * g.speed) {
          const side = this.host.rng() < 0.5 ? 1 : -1;
          c.detour = { ang: Math.atan2(g.z - b.z, g.x - b.x) + side * 1.4, until: now + 0.9 };
          c.hop = true;
        }
        c.checkAt = now + 1;
        c.checkX = b.x;
        c.checkZ = b.z;
      }
    } else {
      c.checkAt = now + 1;
      c.checkX = b.x;
      c.checkZ = b.z;
    }
    const dazed = now < c.dazeUntil ? DAZE_SPEED : 1;
    const sprint = speed > WALK_SPEED + 0.1;
    const scale = (sprint ? speed / SPRINT_SPEED : speed / WALK_SPEED) * dazed;
    const intent = {
      forward,
      right,
      jump: c.hop,
      sprint,
      speedScale: (c.blocking ? 0.6 : 1) * scale * (weaponDef(c.hand.weapon).speed ?? 1),
      noSprint: c.blocking || c.charging,
    };
    c.hop = false;
    this.step(c, intent, dt);
    c.flags =
      FLAG.alive |
      (b.grounded ? FLAG.grounded : 0) |
      (b.y < SEA_LEVEL ? FLAG.wet : 0) |
      (b.sprinting ? FLAG.sprint : 0);
  }

  /* Down, or standing still: just the body settling. */
  private settle(c: Crewman, dt: number) {
    this.step(c, { forward: 0, right: 0, jump: false, sprint: false }, dt);
    c.flags = (c.body.grounded ? FLAG.grounded : 0) | (c.body.y < SEA_LEVEL ? FLAG.wet : 0);
  }

  private step(c: Crewman, intent: Parameters<typeof stepBody>[1], dt: number) {
    const n = Math.max(1, Math.ceil(dt / SUBSTEP));
    const world = { terrain: this.host.world };
    for (let i = 0; i < n; i++) {
      c.body.stamina = STAMINA_MAX;
      stepBody(c.body, intent, dt / n, world);
      intent.jump = false;
    }
    /* Off the bottom of the world: home. */
    if (c.body.y < -40) this.sendHome(c);
  }

  /* Can he take a step that way? Not into a wall, up a cliff, or (unless he may swim) the sea. */
  private clear(c: Crewman, ang: number, swim: boolean) {
    const b = c.body;
    const x = b.x + Math.cos(ang) * 1.1;
    const z = b.z + Math.sin(ang) * 1.1;
    const w = this.host.world;
    const h = w.heightAt(x, z);
    if (!swim && h < SEA_LEVEL - 0.5 && b.y > SEA_LEVEL - 0.5) return false;
    if (b.grounded && h - b.y > 1.4) return false;
    for (const s of w.solidsNear(x, z)) {
      if (s.standable && s.top <= b.y + STEP_HEIGHT) continue;
      if (s.bottom > b.y + 1.7 || s.top < b.y + 0.3) continue;
      if (overSolid(s, x, z) || (!s.box && dist(s.x, s.z, x, z) < s.r + 0.45)) return false;
    }
    return true;
  }

  /* ---------- places ---------- */

  private terrainOf(p: SavedPlot | undefined) {
    return p ? (this.host.world.islands.get(p.id)?.terrain ?? null) : null;
  }

  private plotAt(x: number, z: number) {
    for (const p of this.host.plots.values()) {
      const half = PLOT_SIZES[p.size].size / 2;
      if (Math.abs(x - p.x) <= half && Math.abs(z - p.z) <= half) return p;
    }
    return null;
  }

  /* On this plot's tile (or `margin` past it). */
  private onLand(at: { x: number; z: number } | Crewman, plot: number, margin = 0) {
    const p = this.host.plots.get(plot);
    const pos = "body" in at ? at.body : at;
    if (!p) return false;
    const half = PLOT_SIZES[p.size].size / 2 + margin;
    return Math.abs(pos.x - p.x) <= half && Math.abs(pos.z - p.z) <= half;
  }

  /* Dry, level enough, and clear: (x, z), or the nearest such spot on the way to `toward`. */
  private dry(t: Terrain, x: number, z: number, toward: { x: number; z: number }) {
    for (let i = 0; i < 10; i++) {
      const k = i / 10;
      const px = x + (toward.x - x) * k;
      const pz = z + (toward.z - z) * k;
      if (t.heightAt(px, pz) < 0.4 || t.normalAt(px, pz)[1] < 0.8) continue;
      const y = t.heightAt(px, pz);
      const inside = t
        .solidsNear(px, pz)
        .some((s) => s.top > y + STEP_HEIGHT && s.bottom < y + 1.7 && overSolid(s, px, pz));
      if (!inside) return { x: px, z: pz };
    }
    return { x: toward.x, z: toward.z };
  }

  /* Where a man stands when he's sent home: round the front of the Hearth. */
  private homeSpot(plot: SavedPlot, index: number) {
    const t = this.terrainOf(plot);
    if (!t) return { x: plot.x, y: 2, z: plot.z };
    const a = t.home.yaw + Math.PI + (index - 2) * 0.55;
    const r = 3 + (index % 3) * 1.2;
    const s = this.dry(t, t.home.x - Math.sin(a) * r, t.home.z - Math.cos(a) * r, t.home);
    return { x: s.x, y: t.groundAt(s.x, s.z, t.home.y + 2).ground, z: s.z };
  }

  private sendHome(c: Crewman) {
    const plot = this.host.plots.get(c.plot);
    if (c.ride) this.host.unboard(c);
    c.warpAt = null;
    c.target = null;
    c.goal = null;
    c.raid = null;
    if (!plot) return;
    const at = this.homeSpot(plot, Math.max(0, (plot.crew ?? []).indexOf(c.hand)));
    c.body = createBody(
      at.x,
      at.y,
      at.z,
      this.host.world.islands.get(plot.id)?.terrain.home.yaw ?? 0,
    );
  }

  /* Set down at his master's side: round him, on whatever's underfoot there (or swimming). */
  private beside(c: Crewman, master: Master) {
    const m = master.body;
    const w = this.host.world;
    for (let k = 0; k < 8; k++) {
      const a = m.yaw + Math.PI + ((c.slot % 5) - 2) * 0.6 + k * 0.8;
      const r = 1.8 + (c.slot % 3) * 0.7;
      const x = m.x - Math.sin(a) * r;
      const z = m.z - Math.cos(a) * r;
      const { ground } = w.groundAt(x, z, m.y + 1.5);
      if (Math.abs(ground - m.y) > 2.5 && ground > SEA_LEVEL - FLOAT_DEPTH) continue;
      const inside = w
        .solidsNear(x, z)
        .some((s) => s.top > ground + STEP_HEIGHT && s.bottom < ground + 1.7 && overSolid(s, x, z));
      if (inside) continue;
      c.body = createBody(x, Math.max(ground, SEA_LEVEL - FLOAT_DEPTH), z, m.yaw);
      c.warpAt = null;
      return;
    }
    c.body = createBody(m.x, m.y, m.z, m.yaw);
  }

  /* ---------- on the wire ---------- */

  /* Everyone within `r` of (x, z), for one player's view. */
  snapshot(x: number, z: number, r: number, now: number, out: CrewSnap[] = []): CrewSnap[] {
    out.length = 0;
    for (const c of this.men.values()) {
      const b = c.body;
      if (Math.abs(b.x - x) > r || Math.abs(b.z - z) > r) continue;
      out.push([
        c.id,
        c.plot,
        round2(b.x),
        round2(b.y),
        round2(b.z),
        round2(b.yaw),
        c.flags |
          (c.respawnAt === null ? FLAG.alive : 0) |
          (now < c.shoveFlagUntil ? FLAG.shove : 0) |
          (c.blocking ? FLAG.block : 0) |
          (c.charging ? FLAG.charge : 0) |
          (c.raid !== null ? FLAG.raider : 0) |
          (c.ride ? FLAG.riding : 0),
        weaponIndex(c.hand.weapon),
        Math.round(c.stagger),
        skinIndex(c.hand.skin),
        nameIndex(c.hand.name),
      ]);
    }
    return out;
  }
}

/* Turn from `from` toward `to`, at most `max` radians. */
function turn(from: number, to: number, max: number) {
  return wrapAngle(from + clamp(wrapAngle(to - from), -max, max));
}
