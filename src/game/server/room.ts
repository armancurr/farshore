import {
  BASE_CELL,
  BASE_TILE,
  BOUNDARY,
  EYE_HEIGHT,
  FALL_DAMAGE,
  FALL_SAFE_SPEED,
  FLY_CEILING,
  HEALTH_MAX,
  HEALTH_REGEN,
  MAX_PLAYERS,
  REGEN_DELAY,
  RESPAWN_DELAY,
  SEA_FLOOR,
  SEA_LEVEL,
  TICK_HZ,
} from "../shared/constants";
import { CREW_ID_BASE, type Order } from "../shared/crew";
import { FEATURES } from "../shared/features";
import { clamp, lerp, mulberry32, type Rng } from "../shared/math";
import {
  ALPHA_GAP,
  ALPHA_TIME,
  type AlphaHunt,
  BOARD_REACH,
  BOARD_REFRESH,
  BOARD_SIZE,
  type BoardState,
  CULL_FAIL_SHARE,
  CULL_GAP,
  CULL_TIME,
  type Contract,
  consume,
  contractTitle,
  type Cull,
  MAX_PAYOUTS,
  makeContract,
  type Payout,
  progress,
} from "../shared/missions";
import {
  atRest,
  createVehicle,
  distanceTo,
  exitSpot,
  eyeOf,
  IDLE,
  packVehicle,
  placeAt,
  riderPose,
  settle,
  stepVehicle,
  toWorldFrame,
  type VehicleSnap,
  type VehicleState,
  vehicleSolids,
} from "../shared/drive";
import { type Body, createBody, FLOAT_DEPTH } from "../shared/physics";
import {
  type CaptureSnap,
  type ClientMsg,
  FLAG,
  type HurtCause,
  type PlayerSnap,
  type PlotState,
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
  type ItemId,
  MAX_TOOLS,
  type Tool,
  type ToolKind,
  TOOLS,
  WEAPON_SLOT,
} from "../shared/items";
import { Archipelago } from "../shared/archipelago";
import {
  CATALOGUE,
  type CatalogueId,
  ITEM_STATE,
  packItem,
  type PlacedItem,
  resale,
} from "../shared/catalogue";
import {
  canDamageItem,
  healthAt,
  repairCost,
  SLAM_ITEMS,
  siegeDamage,
  strikeOn,
} from "../shared/siege";
import { windAt } from "../shared/wind";
import { checkItem, itemKey, itemSolids, PLACE_REACH } from "../shared/placing";
import { HARBOR_ID, type IslandInfo, type PlotShapeId, WORLD } from "../shared/islands";
import {
  checkPlotSpot,
  PLOT_ID_BASE,
  PLOT_SIZE_IDS,
  PLOT_SIZES,
  type PlotSizeId,
  plotIsland,
  plotName,
  plotTeam,
  SHIELD_TIME,
  STARTER_SHIELD,
  shielded,
} from "../shared/plots";
import {
  ALARM_GAP,
  CAPTURE_RADIUS,
  CAPTURE_RISE,
  CAPTURE_STATE,
  CAPTURE_TIME,
  type CaptureState,
  compass,
  plunderOf,
  RAID_GRACE,
  raiderTeam,
  stepCapture,
} from "../shared/raids";
import {
  type SavedPlayer,
  type SavedPlot,
  type SavedProfile,
  type SavedVehicle,
  WORLD_SAVE_VERSION,
  type WorldSave,
} from "../shared/save";
import { canWear, DEFAULT_SKIN, type SkinId } from "../shared/skins";
import {
  ALPHAS,
  BIOME_HERDS,
  CULLS,
  GROUP,
  GUARDED_BY,
  HARBOR_HERD,
  SPECIES,
  type SpeciesId,
} from "../shared/species";
import {
  afloat,
  BROADSIDE_RELOAD,
  BROADSIDE_SPEED,
  ownsVehicle,
  BOARD_REACH as RIDE_REACH,
  gunsOf,
  hullOf,
  VEHICLES,
  type VehicleKind,
  vehicleIndex,
} from "../shared/vehicles";
import { leadAt, SHOTS } from "../shared/shots";
import { overSolid, type Solid, type Terrain } from "../shared/terrain";
import {
  BLEED_TIME,
  COMBO_WINDOW,
  chargePower,
  guardOf,
  isThrown,
  knockScale,
  STACK,
  STAGGER_GRACE,
  STAGGER_MAX,
  STAGGER_RECOVER,
  type WeaponDef,
  type WeaponKind,
  WEAPONS,
  weaponDef,
  weaponIndex,
} from "../shared/weapons";

import { type Animal, Herd, type Prey } from "./animals";
import { Crew, type CrewHost, type Crewman, type Mark } from "./crew";
import { type DefenseHost, Defenses, type Foe, type Ship } from "./defenses";
import { type FirePlot, Fires } from "./fire";
import { type Shooter, type ShotHost, Shots, type Target } from "./shots";

export interface Peer {
  send(msg: ServerMsg): void;
  /* Hang up: someone else has taken over this player (the same tab, reloaded). */
  close?(): void;
}

/* Someone who's been here, connected or not. */
type Profile = SavedProfile;

type Member = {
  id: number;
  name: string;
  /* What everyone else sees you as. */
  skin: SkinId;
  peer: Peer;
  spectator: boolean; // joined only to watch
  /* Online: who this is across visits. */
  profile: Profile | null;
  /* In the world with a body (not just watching). */
  placed: boolean;
  body: Body;
  pitch: number;
  flags: number;
  health: number;
  lastHurtAt: number;
  /* Falling speed from the last airborne report, for landing damage. */
  airVy: number;
  /* Sat in a car under the sea since then (null: breathing); the next mouthful of water. */
  underSince: number | null;
  drownAt: number;
  /* While down: when you get back up. */
  respawnAt: number | null;
  attackReadyAt: number;
  shoveFlagUntil: number;
  inv: Inventory;
  /* The vehicle you're in, and which seat (0 steers). */
  ride: { id: number; seat: number } | null;
  /* The vehicle you last spawned from the marketplace. */
  vehicle: number | null;
  /* Something in the inventory changed; send it at the end of the step. */
  invDirty: boolean;
  stagger: number;
  lastHitAt: number;
  combo: number;
  lastSwingAt: number;
  blocking: boolean;
  blockSince: number;
  charging: boolean;
  /* A sickle's cut: damage still to come, a second at a time, and whose it is. */
  bleed: { left: number; per: number; nextAt: number; by: number } | null;
  /* A bucket with water in it (only while you carry one). */
  water: boolean;
  /* Raiding someone's plot, and when you were last on it (off it, it lasts RAID_GRACE). */
  raid: { plot: number; lastOn: number } | null;
};

/* Anyone who swings and can be struck: a player, or someone's crewman. */
type Fighter = Member | Crewman;
const isCrew = (f: Fighter): f is Crewman => "kind" in f;

/* What a crew's told, as its master hears it. */
const ORDER_TEXT: Record<Order, string> = {
  follow: "Your crew is with you",
  hold: "Your crew holds here",
  home: "Your crew is going home",
};

/* A plot's Hearth under attack: how far its capture has got, who's taking it, and the alarm. */
type Siege = {
  progress: number;
  state: CaptureState;
  /* Who gets the plunder: the raider who's held it longest. */
  leader: number | null;
  alarmAt: number;
};

/* Something to ride, out in the world. */
type Ride = {
  id: number;
  kind: VehicleKind;
  state: VehicleState;
  /* Who's in each seat, by member id. */
  seats: (number | null)[];
  /* When the helmsman last reported where it is, and how many reports in a row didn't add up. */
  reportAt: number;
  strikes: number;
  /* What's left of its hull (see hullOf), and when each broadside (port, starboard) is loaded again. */
  hp: number;
  reload: [number, number];
};

/* A swing in flight: it lands after the weapon's wind-up. */
type PendingHit = {
  at: number;
  by: number;
  kind: WeaponKind | null;
  /* A combo's third swing. */
  heavy: boolean;
  /* 0..1: how far a charged weapon was wound up. */
  power: number;
  yaw: number;
};

export type RoomOptions = {
  online: boolean;
  now?: () => number;
  maxHumans?: number;
  seed?: number;
  /*
   * The game: the grand map, the Harbor and the hunting islands round it.
   * Otherwise (the title screen) there's one island in the middle to look at.
   */
  grand?: boolean;
  /* The grand map as it was left (online). */
  world?: WorldSave | null;
  /* The grand map changed in a way worth keeping: the host should store exportWorld(). */
  onChange?: () => void;
  /*
   * Creative mode (flying, nothing hurts you) is honoured: only the local dev
   * server turns it on. Otherwise a client's creative and fly flags are dropped.
   */
  creative?: boolean;
  /*
   * Everyone who joins is topped up to at least this many coins: only the
   * local dev server sets it, for trying out the marketplace.
   */
  devCoins?: number;
};

/* How far from you a vehicle from the marketplace may be put down, in metres (more for big ships). */
const LAUNCH_RANGE = 32;
/* Within this far of a pier, a boat from the marketplace is put in a free berth alongside it. */
const BERTH_RANGE = 70;
/* Under water in a car: seconds of breath, then this much health a second. */
const DROWN_BREATH = 3;
const DROWN_DAMAGE = 12;
/* A helmsman who stops reporting for this long has let go of the wheel. */
const REPORT_TIMEOUT = 0.6;
/* Vehicles out at once: one each, and a few more with passengers still aboard. */
const MAX_RIDES = 24;
/* How far round each player the animals are sent: a little past what fog lets you see. */
const ANIMAL_VIEW = 320;
/* Seconds between passes that mend the plots' battered things, and between saves of their health. */
const HEAL_EVERY = 10;
const SAVE_HEALTH_EVERY = 15;
/* A bucket fills this close to a well (past its edge, in metres). */
const WELL_REACH = 2.5;

/*
 * The world. Transport-agnostic: the Cloudflare Durable Object and the Vite dev
 * server run the game with it, and the title screen runs a quiet one in the tab. The room
 * runs the world and everything in it; each human reports their own movement
 * and asks for everything else.
 */
export class Room {
  private members = new Map<number, Member>();
  private nextId = 1;
  private readonly world: Archipelago;
  private readonly seed: number;
  private profiles = new Map<string, Profile>();
  /* World clock in seconds; it only advances while the room ticks. */
  private time = 0;
  private lastTick: number | null = null;
  /* The Harbor's ground, online: where everyone arrives and nobody gets hurt. */
  private harbor: Terrain | null = null;
  private toolId = 1;
  private pending: PendingHit[] = [];
  /* Animals, when they're switched on. */
  private herd: Herd | null = null;
  /* The Guild Board: contracts (and when each was posted, world time), the alpha hunt and the cull. */
  private board: BoardState = {
    contracts: [],
    alpha: null,
    cull: null,
    nextAlpha: null,
    nextCull: null,
  };
  private posted = new Map<number, number>();
  /* Who has killed how many of the cull's animals, by profile token (or member id offline). */
  private cullKills = new Map<string, { name: string; kills: number }>();
  /* The board changed in a way everyone should see. */
  private boardDirty = false;
  /* Vehicles from the marketplace. Their ids also key their solids in the world. */
  private rides = new Map<number, Ride>();
  private rideId = 1;
  private missionId = 1;
  /* Bought land, by island id; each owned by a profile's token. */
  private plots = new Map<number, SavedPlot>();
  private plotId = PLOT_ID_BASE;
  /* Things bought for the plots: their ids are unique across all of them. */
  private itemId = 1;
  /* Fires on the plots. */
  private fires = new Fires({
    rng: () => this.rng(),
    scorch: (plot, item, amount) => {
      const p = this.plots.get(plot.id);
      if (p) this.harmItem(p, item, amount, "fire");
    },
    changed: (item, doused) => this.itemChanged(item, doused),
  });
  /* Things whose health or state changed this tick, to send at the end of it; and the health last sent. */
  private changes = new Map<number, number[]>();
  private sentHp = new Map<number, number>();
  private healAcc = 0;
  /* Health has changed since the last save (it's saved now and then, not every blow). */
  private healthDirty = false;
  private healthSavedAt = 0;
  /* Raids on the plots, by plot id; and whether any plot's shield or raiders changed this tick. */
  private sieges = new Map<number, Siege>();
  private plotsDirty = false;
  private prey: Prey[] = [];
  /* Everyone's crews. */
  private crew = new Crew(this.crewHost());
  /* Everything in flight, and the plots' towers and engines. */
  private shots = new Shots(this.shotHost());
  private defenses = new Defenses(this.defenseHost());
  private targets: Target[] = [];
  private rng: Rng;
  private readonly now: () => number;

  constructor(private readonly opts: RoomOptions) {
    this.now = opts.now ?? (() => Date.now() / 1000);
    this.rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
    this.seed = opts.seed ?? (this.rng() * 2 ** 32) >>> 0;
    this.world = new Archipelago();
    if (opts.grand) {
      /* The Harbor goes in first: it's the primary island, where the lighthouse and the board are. */
      for (const info of WORLD) this.world.add(info);
      this.harbor = this.world.islands.get(HARBOR_ID)?.terrain ?? null;
      const w = opts.world;
      if (w) {
        for (const p of w.players) this.profiles.set(p.token, structuredClone(p));
        this.toolId = w.ids.tool;
        this.plotId = Math.max(PLOT_ID_BASE, w.ids.plot);
        this.itemId = Math.max(1, w.ids.item);
        this.crew.nextId = w.ids.crew;
        for (const p of w.plots) this.raisePlot({ ...p, items: p.items.map((o) => ({ ...o })) });
      }
    } else
      this.world.add({
        id: 0,
        shape: "headland",
        seed: this.seed,
        x: 0,
        z: 0,
        size: BASE_TILE,
        cell: BASE_CELL,
        lift: 1,
        name: "",
      });
    if (FEATURES.animals) this.raiseHerds();
    if (opts.grand && FEATURES.board) {
      this.fillBoard();
      this.board.nextAlpha = 90;
      this.board.nextCull = 240;
    }
  }

  /* Every hunting island gets its herd. */
  private raiseHerds() {
    const herd = new Herd({
      rng: this.rng,
      maul: (id, damage, dx, dz) => this.mauled(id, damage, dx, dz),
      blocked: (id) => {
        this.members.get(id)?.peer.send({ t: "feed", text: "Your shield turns it aside" });
      },
    });
    for (const { info, terrain } of this.world.islands.values()) {
      const counts = info.biome ? BIOME_HERDS[info.biome] : info.harbor ? HARBOR_HERD : null;
      if (!counts) continue;
      herd.addRange({
        island: info.id,
        terrain,
        quiet: [
          { x: terrain.home.x, z: terrain.home.z, r: 30 },
          { x: terrain.lighthouse.x, z: terrain.lighthouse.z, r: 20 },
        ],
      });
      /*
       * In herds and packs: the first of each group anywhere, the rest close
       * by it. A guarded herd takes its guard from the island's own count of
       * that kind; whatever's left of them roams in groups of its own.
       */
      const left = { ...counts };
      /* Guarded herds first, so their guards aren't all spoken for. */
      const kinds = (Object.keys(counts) as SpeciesId[]).sort(
        (x, y) => Number(!GUARDED_BY[x]) - Number(!GUARDED_BY[y]),
      );
      for (const species of kinds) {
        const [lo, hi] = GROUP[species];
        const guard = GUARDED_BY[species];
        while ((left[species] ?? 0) > 0) {
          let size = Math.min(left[species]!, lo + Math.floor(this.rng() * (hi - lo + 1)));
          /* Too few left over for a group of their own: they join this one. */
          if (left[species]! - size < lo) size = left[species]!;
          left[species]! -= size;
          const lead = herd.spawn(species, info.id);
          if (!lead) continue;
          for (let i = 1; i < size; i++) herd.spawn(species, info.id, [], { with: lead });
          if (guard && (left[guard] ?? 0) > 0) {
            left[guard]! -= 1;
            herd.spawn(guard, info.id, [], { with: lead });
          }
        }
      }
    }
    this.herd = herd;
  }

  /* ---------- land ---------- */

  /*
   * Put a plot on the map. Saved plots go back where they were, unless the
   * map has since changed under one (a tile in the way), when it's left out.
   */
  private raisePlot(p: SavedPlot) {
    const owner = this.profiles.get(p.owner);
    if (!owner || this.world.islands.has(p.id)) return false;
    const info = plotIsland(p, owner.name);
    for (const o of this.world.islands.values()) {
      const span = (o.info.size + info.size) / 2;
      if (Math.abs(o.info.x - info.x) < span && Math.abs(o.info.z - info.z) < span) return false;
    }
    this.world.add(info);
    this.plots.set(p.id, p);
    for (const o of p.items) this.world.addSolids(itemKey(o.id), itemSolids(o), true);
    this.crew.muster(p, this.now());
    return true;
  }

  private plotOf(profile: Profile | null) {
    if (!profile) return null;
    for (const p of this.plots.values()) if (p.owner === profile.token) return p;
    return null;
  }

  /* An island as `m` should see it: a plot named for its owner as they are now, and marked if it's theirs. */
  private islandFor(info: IslandInfo, m: Member | null): IslandInfo {
    const p = this.plots.get(info.id);
    if (!p) return info;
    const owner = this.profiles.get(p.owner)?.name ?? "Someone";
    return plotIsland(p, owner, !!m?.profile && m.profile.token === p.owner);
  }

  /* Everyone sees a plot that's been raised (or regrown). */
  private announcePlot(p: SavedPlot) {
    const info = this.world.islands.get(p.id)?.info;
    if (!info) return;
    for (const o of this.members.values())
      o.peer.send({ t: "island", info: this.islandFor(info, o) });
  }

  /* A boat or a car parked where the land would come up. */
  private landBlocked(x: number, z: number, size: number) {
    const half = size / 2 + 4;
    for (const r of this.rides.values())
      if (Math.abs(r.state.x - x) < half && Math.abs(r.state.z - z) < half) return true;
    return false;
  }

  /* Buy a plot from the marketplace and raise it on the open sea at (x, z). */
  private buyPlot(m: Member, size: PlotSizeId, shape: PlotShapeId, x: number, z: number) {
    const say = (text: string) => m.peer.send({ t: "feed", text });
    if (!this.opts.grand || !m.profile) return say("Land is only sold out on the grand map");
    const had = this.plotOf(m.profile);
    if (had) return say(`You already own ${plotName(m.profile.name, had.size)}`);
    const def = PLOT_SIZES[size];
    if (m.inv.coins < def.price) return say(`A ${def.name.toLowerCase()} costs ${def.price} coins`);
    const at = { x: Math.round(x), z: Math.round(z) };
    const spot = checkPlotSpot(this.world.islands.values(), size, at.x, at.z);
    if (!spot.ok) return say(spot.reason);
    if (this.landBlocked(at.x, at.z, def.size)) return say("A vehicle is in the way there");
    const plot: SavedPlot = {
      id: this.plotId++,
      size,
      shape,
      seed: (this.rng() * 2 ** 32) >>> 0,
      ...at,
      owner: m.profile.token,
      items: [],
      shield: this.now() + STARTER_SHIELD,
    };
    if (!this.raisePlot(plot)) return say("That spot can't be built on");
    m.inv.coins -= def.price;
    m.invDirty = true;
    this.announcePlot(plot);
    /* Everyone hears of its starter shield. */
    this.plotsDirty = true;
    const name = plotName(m.profile.name, size);
    m.peer.send({
      t: "news",
      title: `${name} is yours`,
      sub: "You'll wake at its Hearth · shielded from raids for the first 2 hours",
    });
    this.feed(`${m.name} bought land: ${name}`);
    this.opts.onChange?.();
  }

  /* Grow your plot to a bigger size where it stands, for the difference in price. */
  private growPlot(m: Member, size: PlotSizeId) {
    const say = (text: string) => m.peer.send({ t: "feed", text });
    const p = this.plotOf(m.profile);
    if (!p || !m.profile) return say("You don't own any land yet");
    if (PLOT_SIZE_IDS.indexOf(size) <= PLOT_SIZE_IDS.indexOf(p.size))
      return say("Your land is already that big");
    const def = PLOT_SIZES[size];
    const cost = def.price - PLOT_SIZES[p.size].price;
    if (m.inv.coins < cost)
      return say(`Growing it to a ${def.name.toLowerCase()} costs ${cost} coins`);
    const spot = checkPlotSpot(this.world.islands.values(), size, p.x, p.z, p.id);
    if (!spot.ok) return say(`No room to grow: ${spot.reason.toLowerCase()}`);
    /* Only boats beyond the old land's edge are in the way. */
    const old = PLOT_SIZES[p.size].size / 2;
    for (const r of this.rides.values()) {
      const dx = Math.abs(r.state.x - p.x);
      const dz = Math.abs(r.state.z - p.z);
      if (Math.max(dx, dz) < def.size / 2 + 4 && Math.max(dx, dz) > old - 30)
        return say("A vehicle is in the way of the new shore");
    }
    this.world.remove(p.id);
    this.plots.delete(p.id);
    const grown: SavedPlot = { ...p, size };
    if (!this.raisePlot(grown)) {
      this.raisePlot(p);
      return say("Your land can't grow there");
    }
    m.inv.coins -= cost;
    m.invDirty = true;
    this.announcePlot(grown);
    this.reseat(m, grown);
    this.crew.rehome(grown.id);
    const name = plotName(m.profile.name, size);
    m.peer.send({ t: "news", title: `${name}`, sub: "Your land has grown" });
    this.opts.onChange?.();
  }

  /* ---------- things on a plot ---------- */

  /*
   * Grown land rises from the same seed at a bigger size, so the ground under
   * what stood on it has moved: everything is set back on the ground, and
   * whatever now finds itself in the sea is sold back at what it cost.
   */
  private reseat(m: Member, p: SavedPlot) {
    const terrain = this.world.islands.get(p.id)?.terrain;
    if (!terrain) return;
    let refund = 0;
    for (const o of [...p.items]) {
      const v = checkItem(terrain, p.items, o.kind, o.x, o.z, o.rot, o.id);
      if (v.ok) {
        o.y = round2(v.y);
        this.world.addSolids(itemKey(o.id), itemSolids(o), true);
        this.broadcast({ t: "item", plot: p.id, item: this.snapOf(o) });
        continue;
      }
      refund += CATALOGUE[o.kind].price;
      this.unplace(p, o.id);
    }
    if (refund) {
      m.inv.coins += refund;
      m.invDirty = true;
      m.peer.send({
        t: "feed",
        text: `Some of what you'd built was in the way: ${refund} coins back`,
      });
    }
  }

  private unplace(p: SavedPlot, id: number) {
    p.items = p.items.filter((o) => o.id !== id);
    this.fires.drop(id);
    this.changes.delete(id);
    this.sentHp.delete(id);
    this.world.removeSolids(itemKey(id));
    this.broadcast({ t: "unitem", plot: p.id, id });
  }

  /* Anyone standing (or a vehicle parked) where these solids would go. */
  private occupied(solids: readonly Solid[]) {
    const probes = [
      [0, 0],
      [0.4, 0],
      [-0.4, 0],
      [0, 0.4],
      [0, -0.4],
    ] as const;
    for (const o of this.members.values()) {
      if (!this.present(o) || o.ride || o.respawnAt !== null) continue;
      const b = o.body;
      for (const s of solids) {
        if (s.top < b.y + 0.1 || s.bottom > b.y + 1.7) continue;
        if (probes.some(([dx, dz]) => overSolid(s, b.x + dx, b.z + dz))) return true;
      }
    }
    for (const r of this.rides.values())
      for (const s of solids)
        if (overSolid(s, r.state.x, r.state.z) && s.top > r.state.y) return true;
    return false;
  }

  /*
   * Buy something from the marketplace and set it down on your own land; or
   * move something of yours there (`move`), for nothing. Everything is
   * checked here: the land is yours and you're on it, within reach, the spot
   * is clear and level, there's room in the plot's budget, and you can pay.
   */
  private place(m: Member, kind: CatalogueId, x: number, z: number, rot: number, move?: number) {
    const say = (text: string) => m.peer.send({ t: "feed", text });
    const def = CATALOGUE[kind];
    const p = this.plotOf(m.profile);
    if (!p) return say("Buy a plot of land first");
    const terrain = this.world.islands.get(p.id)?.terrain;
    if (!terrain) return;
    if (m.ride) return say("Get off first");
    if (!terrain.contains(m.body.x, m.body.z)) return say("Go to your own land to build");
    if (!terrain.contains(x, z)) return say("That's not your land");
    if (Math.hypot(x - m.body.x, z - m.body.z) > PLACE_REACH) return say("That's too far away");
    const moving = move === undefined ? null : p.items.find((o) => o.id === move);
    if (move !== undefined && (!moving || moving.kind !== kind)) return say("That's not yours");
    if (moving && moving.hp <= 0) return say("Rubble can't be moved: mend it or clear it away");
    if (moving && this.fires.isBurning(moving.id)) return say("Not while it's on fire");
    if (!moving && p.items.length >= PLOT_SIZES[p.size].items)
      return say(
        `Your ${PLOT_SIZES[p.size].name.toLowerCase()} holds ${PLOT_SIZES[p.size].items} things`,
      );
    if (!moving && m.inv.coins < def.price)
      return say(`A ${def.name.toLowerCase()} costs ${def.price} coins`);
    rot = Math.round(rot * 1000) / 1000;
    const at = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
    const v = checkItem(terrain, p.items, kind, at.x, at.z, rot, moving?.id ?? null);
    if (!v.ok) return say(v.reason);
    const item: PlacedItem = {
      id: moving?.id ?? this.itemId,
      kind,
      ...at,
      y: round2(v.y),
      rot,
      hp: moving?.hp ?? def.health,
    };
    const solids = itemSolids(item);
    /* What's being moved is out of its own way. */
    if (moving) this.world.removeSolids(itemKey(moving.id));
    if (this.occupied(solids)) {
      if (moving) this.world.addSolids(itemKey(moving.id), itemSolids(moving), true);
      return say("Someone's in the way");
    }
    if (moving) Object.assign(moving, item);
    else {
      this.itemId++;
      p.items.push(item);
      m.inv.coins -= def.price;
      m.invDirty = true;
    }
    this.world.addSolids(itemKey(item.id), solids, true);
    this.broadcast({ t: "item", plot: p.id, item: this.snapOf(moving ?? item) });
    this.opts.onChange?.();
  }

  /* Sell one of your things back for half what it cost; rubble is only cleared away, for nothing. */
  private sell(m: Member, id: number) {
    const p = this.plotOf(m.profile);
    const item = p?.items.find((o) => o.id === id);
    if (!p || !item) return m.peer.send({ t: "feed", text: "That's not yours to sell" });
    if (Math.hypot(item.x - m.body.x, item.z - m.body.z) > PLACE_REACH + 10) return;
    if (this.fires.isBurning(id))
      return m.peer.send({ t: "feed", text: "Nobody will buy it while it's on fire" });
    if (item.hp <= 0) {
      this.unplace(p, id);
      m.peer.send({ t: "feed", text: "Cleared the rubble away" });
      this.opts.onChange?.();
      return;
    }
    const back = resale(item.kind);
    this.unplace(p, id);
    m.inv.coins += back;
    m.invDirty = true;
    m.peer.send({
      t: "feed",
      text: `Sold the ${CATALOGUE[item.kind].name.toLowerCase()} for ${back} coins`,
    });
    this.opts.onChange?.();
  }

  /* Pay to mend one of your things now: in proportion to what's missing, rubble included. */
  private repair(m: Member, id: number) {
    const say = (text: string) => m.peer.send({ t: "feed", text });
    const p = this.plotOf(m.profile);
    const item = p?.items.find((o) => o.id === id);
    if (!p || !item) return say("That's not yours to mend");
    if (Math.hypot(item.x - m.body.x, item.z - m.body.z) > PLACE_REACH + 10)
      return say("That's too far away");
    if (this.fires.isBurning(id)) return say("Put the fire out first");
    const def = CATALOGUE[item.kind];
    const name = def.name.toLowerCase();
    const cost = repairCost(item.kind, healthAt(item, this.now()));
    if (cost <= 0) return say(`Your ${name} is as good as new`);
    if (m.inv.coins < cost) return say(`Mending your ${name} costs ${cost} coins`);
    const solids = itemSolids({ ...item, hp: def.health });
    if (item.hp <= 0) {
      if (this.occupied(solids)) return say("Someone's in the way");
      this.world.addSolids(itemKey(item.id), solids, true);
    }
    m.inv.coins -= cost;
    m.invDirty = true;
    this.mended(item);
    say(`Mended the ${name} for ${cost} coins`);
    this.opts.onChange?.();
  }

  /* Whole again: no longer hurt, nothing charred about it. */
  private mended(item: PlacedItem) {
    item.hp = CATALOGUE[item.kind].health;
    delete item.hitAt;
    delete item.burnt;
    this.itemChanged(item);
  }

  /* ---------- battering and burning ---------- */

  /* What everyone's told of a thing: its health now, and whether it's burning. */
  private snapOf(o: PlacedItem) {
    return packItem(
      { ...o, hp: this.shownHp(o) },
      this.fires.isBurning(o.id) ? ITEM_STATE.burning : 0,
    );
  }

  /* Health as sent: whole numbers, and never 0 for something still standing. */
  private shownHp(o: PlacedItem) {
    return o.hp > 0 ? Math.max(1, Math.round(healthAt(o, this.now()))) : 0;
  }

  /* Tell everyone, at the end of the tick, what this thing's health and state are now. */
  private itemChanged(item: PlacedItem, doused = false) {
    const hp = this.shownHp(item);
    this.sentHp.set(item.id, hp);
    const prev = this.changes.get(item.id);
    const state =
      (this.fires.isBurning(item.id) ? ITEM_STATE.burning : 0) |
      (item.burnt ? ITEM_STATE.burnt : 0) |
      (doused || (prev && prev[2] & ITEM_STATE.doused) ? ITEM_STATE.doused : 0);
    this.changes.set(item.id, [item.id, hp, state]);
  }

  /*
   * A blow or the fire takes health from something built. At nothing it
   * falls to rubble: no longer solid, so a broken wall is a way through, and
   * charred if it was fire that did it.
   */
  private harmItem(plot: SavedPlot, item: PlacedItem, amount: number, cause: "hit" | "fire") {
    if (item.hp <= 0 || amount <= 0) return;
    const now = this.now();
    item.hp = Math.max(0, round2(healthAt(item, now) - amount));
    item.hitAt = now;
    if (item.hp > 0) {
      this.itemChanged(item);
      this.healthDirty = true;
      return;
    }
    item.hp = 0;
    if (cause === "fire") item.burnt = true;
    else delete item.burnt;
    this.fires.drop(item.id);
    this.world.removeSolids(itemKey(item.id));
    this.itemChanged(item);
    const name = CATALOGUE[item.kind].name.toLowerCase();
    for (const o of this.members.values())
      if (o.profile?.token === plot.owner)
        o.peer.send({
          t: "feed",
          text: cause === "fire" ? `Your ${name} burnt down` : `Your ${name} was knocked down`,
        });
    this.opts.onChange?.();
  }

  /*
   * Every so often: what's been battered mends a little (and everyone hears
   * of it when its health has moved), and rubble left long enough stands up
   * again, unless someone's standing in the way.
   */
  private heal(now: number) {
    for (const plot of this.plots.values())
      for (const o of plot.items) {
        if (o.hitAt === undefined || this.fires.isBurning(o.id)) continue;
        const def = CATALOGUE[o.kind];
        const hp = healthAt(o, now);
        if (o.hp <= 0) {
          if (hp <= 0) continue;
          const solids = itemSolids({ ...o, hp: def.health });
          if (this.occupied(solids)) continue;
          this.world.addSolids(itemKey(o.id), solids, true);
          this.mended(o);
          this.opts.onChange?.();
        } else if (hp >= def.health) {
          this.mended(o);
          this.healthDirty = true;
        } else if (Math.round(hp) !== this.sentHp.get(o.id)) this.itemChanged(o);
      }
    if (this.healthDirty && now - this.healthSavedAt >= SAVE_HEALTH_EVERY) {
      this.healthDirty = false;
      this.healthSavedAt = now;
      this.opts.onChange?.();
    }
  }

  private flushItems() {
    if (!this.changes.size) return;
    this.broadcast({ t: "items", c: [...this.changes.values()].flat() });
    this.changes.clear();
  }

  /*
   * A blow landing among the plots' things. Most weapons stop at the first
   * thing they meet; the warhammer's slam takes in everything round you. A
   * torch sets wood alight, and a bucket throws its water on whatever's
   * burning nearest instead of striking at all.
   */
  private hitItems(m: Fighter, p: PendingHit, def: WeaponDef, now: number) {
    if (!this.plots.size) return;
    const b = m.body;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const hits: {
      plot: SavedPlot;
      item: PlacedItem;
      at: NonNullable<ReturnType<typeof strikeOn>>;
    }[] = [];
    for (const plot of this.plots.values()) {
      const half = PLOT_SIZES[plot.size].size / 2 + def.reach;
      if (Math.abs(b.x - plot.x) > half || Math.abs(b.z - plot.z) > half) continue;
      for (const o of plot.items) {
        if (o.hp <= 0) continue;
        const d = CATALOGUE[o.kind];
        if (Math.hypot(o.x - b.x, o.z - b.z) > Math.hypot(d.hx, d.hz) + def.reach + 1) continue;
        const at = strikeOn(o, b.x, b.y, b.z, fx, fz, def.reach, def.arc);
        if (at) hits.push({ plot, item: o, at });
      }
    }
    if (!hits.length) return;
    hits.sort((x, y) => x.at.d - y.at.d);
    if (def.douses) {
      const fire = hits.find((h) => this.fires.isBurning(h.item.id));
      if (!fire) return;
      if (!m.water) {
        this.tell(m, "Your bucket is empty: fill it in the sea or at a well");
        return;
      }
      m.water = false;
      this.fires.out(fire.item.id, now, true);
      return;
    }
    const raider = {
      token: isCrew(m) ? m.owner : (m.profile?.token ?? null),
      creative: (m.flags & FLAG.creative) !== 0,
    };
    let warded = false;
    for (const h of hits.slice(0, def.arc > -1 ? 1 : SLAM_ITEMS)) {
      const kind = CATALOGUE[h.item.kind];
      const may = canDamageItem(raider, h.plot, now);
      if (!may && raider.token !== h.plot.owner && shielded(h.plot, now)) warded = true;
      const damage = may ? siegeDamage(def, this.damageOf(def, p, false, false), kind.material) : 0;
      this.broadcast({
        t: "ihit",
        id: h.item.id,
        by: m.id,
        x: round2(h.at.x),
        y: round2(h.at.y),
        z: round2(h.at.z),
        damage: Math.round(damage),
      });
      if (!may) continue;
      /* Attacking someone else's land drops your own shield; your crew join in. */
      this.breakShield(m, now);
      if (!isCrew(m) && raider.token) this.crew.siege(raider.token, h.plot.id, h.item.id, now);
      if (def.ignites) {
        if (kind.material === "wood") this.fires.ignite(h.plot, h.item, now);
        else this.tell(m, "Stone won't burn");
      }
      this.harmItem(h.plot, h.item, damage, "hit");
    }
    if (warded) this.tell(m, "This isle is shielded: nothing here can be harmed");
  }

  /* A bucket fills in the sea, or at a well that's still standing. */
  private fillBucket(m: Member) {
    if (m.water || m.ride || this.carried(m) !== "bucket") return;
    const b = m.body;
    let wet = b.y < SEA_LEVEL;
    for (const plot of this.plots.values()) {
      if (wet) break;
      const half = PLOT_SIZES[plot.size].size / 2;
      if (Math.abs(b.x - plot.x) > half || Math.abs(b.z - plot.z) > half) continue;
      wet = plot.items.some((o) => {
        const d = CATALOGUE[o.kind];
        return (
          o.kind === "well" &&
          o.hp > 0 &&
          Math.hypot(o.x - b.x, o.z - b.z) < Math.max(d.hx, d.hz) + WELL_REACH
        );
      });
    }
    if (!wet) return;
    m.water = true;
    m.peer.send({ t: "feed", text: "Your bucket is full" });
  }

  /* ---------- raids ---------- */

  /* The plot whose tile (x, z) is on, shore and shallows included. */
  private plotAt(x: number, z: number) {
    for (const p of this.plots.values()) {
      const half = PLOT_SIZES[p.size].size / 2;
      if (Math.abs(x - p.x) <= half && Math.abs(z - p.z) <= half) return p;
    }
    return null;
  }

  /* Whether `m` raids this plot by being on it: someone else's, unshielded, and not from creative. */
  private mayRaid(m: Member, p: SavedPlot, now: number) {
    return (
      !!m.profile && m.profile.token !== p.owner && !(m.flags & FLAG.creative) && !shielded(p, now)
    );
  }

  /* The owner of this plot, if they're out on the map right now. */
  private ownerOf(p: SavedPlot) {
    for (const o of this.members.values())
      if (o.profile?.token === p.owner && this.present(o)) return o;
    return null;
  }

  private raidersOn(id: number) {
    let n = 0;
    for (const o of this.members.values()) if (o.raid?.plot === id) n++;
    return n;
  }

  private siegeOf(id: number) {
    let s = this.sieges.get(id);
    if (!s) {
      s = { progress: 0, state: CAPTURE_STATE.falling, leader: null, alarmAt: -1e9 };
      this.sieges.set(id, s);
    }
    return s;
  }

  /* The middle of a plot's Hearth: the top of the plinth. */
  private hearthOf(p: SavedPlot) {
    return this.world.islands.get(p.id)?.terrain.hearth ?? null;
  }

  /* Every plot's shield and raiders, as everyone's told them. */
  private plotStates(now: number): PlotState[] {
    return [...this.plots.values()].map((p) => {
      const up = shielded(p, now);
      return {
        id: p.id,
        shield: up ? Math.ceil((p.shield ?? now) - now) : 0,
        captor: up && p.captor ? { ...p.captor } : null,
        raiders: this.raidersOn(p.id),
      };
    });
  }

  /*
   * Each tick: shields that have run out drop, whoever's on someone else's
   * land is raiding it (until they've been off it a while), and the Hearths
   * with raiders at them are taken, held, or fall back.
   */
  private tickRaids(now: number, dt: number) {
    if (!this.opts.grand || !this.plots.size) return;
    for (const p of this.plots.values())
      if (p.shield !== undefined && !shielded(p, now)) this.dropShield(p, false);
    for (const m of this.members.values()) {
      if (!this.present(m)) continue;
      const on = this.plotAt(m.body.x, m.body.z);
      if (on && this.mayRaid(m, on, now)) {
        if (m.raid?.plot !== on.id) this.startRaid(m, on, now);
        else m.raid.lastOn = now;
        continue;
      }
      if (!m.raid) continue;
      const was = this.plots.get(m.raid.plot);
      if (!was || !this.mayRaid(m, was, now) || now - m.raid.lastOn > RAID_GRACE) this.endRaid(m);
    }
    for (const p of this.plots.values()) this.tickCapture(p, now, dt);
    if (this.plotsDirty) {
      this.plotsDirty = false;
      this.broadcast({ t: "plots", plots: this.plotStates(now) });
    }
  }

  /* Ashore (or afloat) on someone else's land: you're raiding it, and its owner hears of it. */
  private startRaid(m: Member, p: SavedPlot, now: number) {
    if (m.raid) this.endRaid(m);
    m.raid = { plot: p.id, lastOn: now };
    this.plotsDirty = true;
    const isle = plotName(this.profiles.get(p.owner)?.name ?? "Someone", p.size);
    m.peer.send({
      t: "feed",
      text: `You're raiding ${isle}: hold its Hearth ${CAPTURE_TIME} seconds to take it`,
    });
    const own = this.plotOf(m.profile);
    if (own && shielded(own, now))
      m.peer.send({
        t: "feed",
        text: "Harm anything here or take its Hearth and your own shield drops",
      });
    const siege = this.siegeOf(p.id);
    const owner = this.ownerOf(p);
    if (!owner || now - siege.alarmAt < ALARM_GAP) return;
    siege.alarmAt = now;
    const h = this.hearthOf(p) ?? p;
    owner.peer.send({
      t: "alarm",
      plot: p.id,
      side: compass(m.body.x - h.x, m.body.z - h.z),
      raiders: this.raidersOn(p.id),
      at: "shore",
    });
  }

  /* No longer raiding: gone home, gone off it a while, or it's shielded now. */
  private endRaid(m: Member) {
    const r = m.raid;
    if (!r) return;
    m.raid = null;
    this.plotsDirty = true;
    const p = this.plots.get(r.plot);
    if (!p || this.raidersOn(p.id)) return;
    this.ownerOf(p)?.peer.send({ t: "feed", text: "The raiders have left your isle" });
  }

  /*
   * A Hearth with raiders at it: alone there they take it, the owner there
   * too holds it where it is, and with nobody holding it it falls back.
   * Knocked down, riding, or a step too far away doesn't count. Crews count
   * as their masters do: raiding men help take it (for their master, if he's
   * about), and the owner's own men hold it.
   */
  private tickCapture(p: SavedPlot, now: number, dt: number) {
    const s = this.sieges.get(p.id);
    if (!s || (!s.progress && !this.raidersOn(p.id))) return;
    if (shielded(p, now)) {
      s.progress = 0;
      s.leader = null;
      return;
    }
    const h = this.hearthOf(p);
    if (!h) return;
    const at = (b: Body) =>
      Math.hypot(b.x - h.x, b.z - h.z) <= CAPTURE_RADIUS && Math.abs(b.y - h.y) <= CAPTURE_RISE;
    const takers: Fighter[] = [];
    /* Masters of the men taking it, who'd take the plunder with nobody else to. */
    const backers: Member[] = [];
    let defenders = 0;
    for (const o of this.members.values()) {
      if (!this.present(o) || o.respawnAt !== null || o.ride || !at(o.body)) continue;
      if (o.raid?.plot === p.id) takers.push(o);
      else if (o.profile?.token === p.owner && !(o.flags & FLAG.creative)) defenders++;
    }
    const leaders = takers.filter((o): o is Member => !isCrew(o));
    for (const c of this.crew.near(h.x, h.z, CAPTURE_RADIUS)) {
      if (!at(c.body)) continue;
      if (c.raid === p.id) {
        takers.push(c);
        const master = this.masterOf(c.owner);
        if (master && !backers.includes(master)) backers.push(master);
      } else if (c.plot === p.id) defenders++;
    }
    const was = s.progress;
    const step = stepCapture(s.progress, takers.length, defenders, dt);
    s.progress = step.progress;
    s.state = step.state;
    const lead = leaders.length ? leaders : backers;
    if (lead.length && !lead.some((o) => o.id === s.leader)) s.leader = lead[0].id;
    if (!s.progress) s.leader = null;
    if (step.state !== CAPTURE_STATE.taking) return;
    for (const o of takers) this.breakShield(o, now);
    if (was === 0) {
      const owner = this.ownerOf(p);
      owner?.peer.send({
        t: "alarm",
        plot: p.id,
        side: compass(takers[0].body.x - h.x, takers[0].body.z - h.z),
        raiders: this.raidersOn(p.id),
        at: "hearth",
      });
    }
    const leader = s.leader === null ? null : this.members.get(s.leader);
    if (s.progress >= CAPTURE_TIME && leader) this.capture(p, leader, now);
  }

  /*
   * The Hearth is taken: the raider who held it takes a share of the
   * owner's purse (wherever they are: offline, it comes out of what they
   * saved), the captor's colours go up on it, and the isle is shielded.
   */
  private capture(p: SavedPlot, raider: Member, now: number) {
    const s = this.siegeOf(p.id);
    const isle = plotName(this.profiles.get(p.owner)?.name ?? "Someone", p.size);
    const owner = this.ownerOf(p);
    const purse = owner ? owner.inv : (this.profiles.get(p.owner)?.saved?.inv ?? null);
    const loot = purse ? plunderOf(purse.coins) : 0;
    if (purse) purse.coins -= loot;
    if (owner) owner.invDirty = true;
    raider.inv.coins += loot;
    raider.invDirty = true;
    const own = this.plotOf(raider.profile);
    p.shield = now + SHIELD_TIME;
    p.captor = {
      name: raider.name,
      team: raiderTeam(own ? plotTeam(own.id) : null, plotTeam(p.id), raider.name),
    };
    s.progress = 0;
    s.leader = null;
    /* Shielded now: nobody's raiding it any more. */
    for (const o of this.members.values()) if (o.raid?.plot === p.id) o.raid = null;
    this.plotsDirty = true;
    const coins = `${loot.toLocaleString("en-US")} coins`;
    raider.peer.send({ t: "news", title: `You captured ${isle}`, sub: `${coins} plundered` });
    raider.peer.send({ t: "feed", text: `Plundered ${coins} from ${isle}` });
    owner?.peer.send({
      t: "news",
      title: "Your Hearth has fallen",
      sub: `${raider.name} plundered ${coins} · your isle is shielded for ${SHIELD_TIME / 3600} hours`,
    });
    owner?.peer.send({ t: "feed", text: `${raider.name} captured your Hearth and took ${coins}` });
    this.feed(`${raider.name} captured ${isle}`);
    this.opts.onChange?.();
  }

  /* Attacking someone else's land: your own shield, if it's up, comes down (your crew's doing too). */
  private breakShield(m: Fighter, now: number) {
    const own = isCrew(m) ? this.plots.get(m.plot) : this.plotOf(m.profile);
    if (own && shielded(own, now)) this.dropShield(own, true);
  }

  /* A shield comes down: run out, or broken by its owner going raiding. */
  private dropShield(p: SavedPlot, broken: boolean) {
    delete p.shield;
    delete p.captor;
    this.plotsDirty = true;
    this.ownerOf(p)?.peer.send({
      t: "feed",
      text: broken
        ? "You attacked: your own isle's shield is down"
        : "Your isle's shield is down: it can be raided again",
    });
    this.opts.onChange?.();
  }

  /* ---------- crews ---------- */

  /* What the crews need of the room. */
  private crewHost(): CrewHost {
    const room = this;
    return {
      get world() {
        return room.world;
      },
      get plots() {
        return room.plots;
      },
      rng: () => this.rng(),
      master: (token) => this.masterOf(token),
      sheltered: (x, z) => !!this.harbor?.contains(x, z),
      burning: (id) => this.fires.isBurning(id),
      catches: (item) => this.fires.canCatch(item, this.now()),
      besieged: (plot) => {
        const s = this.sieges.get(plot);
        return !!s && s.progress > 0 && s.state !== CAPTURE_STATE.falling;
      },
      swing: (c, heavy, power) => {
        const def = weaponDef(c.hand.weapon);
        if (def.ranged) {
          this.crewLoose(c, def);
          return;
        }
        this.broadcast({ t: "swing", by: c.id, kind: c.hand.weapon, heavy });
        const at = this.now() + def.windup;
        this.pending.push({ at, by: c.id, kind: c.hand.weapon, heavy, power, yaw: c.body.yaw });
      },
      board: (c, id) => {
        const r = this.rides.get(id);
        /* Any seat but the helm. */
        const seat = r ? r.seats.findIndex((o, i) => i > 0 && o === null) : -1;
        if (!r || seat < 0) return false;
        r.seats[seat] = c.id;
        c.ride = { id, seat };
        this.seatCrew(c, r);
        return true;
      },
      unboard: (c) => this.unseatCrew(c),
    };
  }

  /* A crew's master, if he's out on the map. */
  private masterOf(token: string) {
    for (const o of this.members.values())
      if (o.profile?.token === token && this.present(o)) return o;
    return null;
  }

  /* A crewman sits where his seat is, like any rider. */
  private seatCrew(c: Crewman, r: Ride) {
    const at = riderPose(r.kind, r.state, c.ride?.seat ?? 1);
    Object.assign(c.body, { x: at.x, y: at.y, z: at.z, yaw: at.yaw, vx: 0, vy: 0, vz: 0 });
    c.body.grounded = true;
  }

  /* Out of his seat and over the side (into the sea, out on the open water). */
  private unseatCrew(c: Crewman) {
    const ride = c.ride;
    c.ride = null;
    const r = ride ? this.rides.get(ride.id) : null;
    if (!ride || !r) return;
    if (r.seats[ride.seat] === c.id) r.seats[ride.seat] = null;
    const at = exitSpot(r.kind, r.state, this.world, ride.seat);
    c.body = at
      ? createBody(at.x, at.y, at.z, at.yaw)
      : createBody(r.state.x, SEA_LEVEL - FLOAT_DEPTH, r.state.z, r.state.rot);
  }

  /* Hire a man, let one go, arm one, or give your crew an order. */
  private crewCommand(
    m: Member,
    msg: Extract<ClientMsg, { t: "hire" | "dismiss" | "crewarm" | "order" }>,
  ) {
    const say = (text: string) => m.peer.send({ t: "feed", text });
    const p = this.plotOf(m.profile);
    if (!p || !m.profile) return say("Buy a plot of land first: your crew lives on it");
    const now = this.now();
    let paid = false;
    if (msg.t === "hire") paid = this.crew.hire(p, m.inv, m.skin, say, now);
    else if (msg.t === "dismiss") paid = this.crew.dismiss(p, msg.id, say);
    else if (msg.t === "crewarm") paid = this.crew.arm(p, msg.id, msg.kind, m.inv, say);
    else {
      if (!p.crew?.length) return say("You've no crew yet: hire men in the marketplace");
      this.crew.order(m.profile.token, msg.order, now, m.body);
      say(ORDER_TEXT[msg.order]);
      return;
    }
    if (!paid) return;
    m.invDirty = true;
    this.opts.onChange?.();
  }

  /* Each master whose crew has changed hears how they stand. */
  private flushCrew() {
    if (!this.crew.dirty.size) return;
    for (const o of this.members.values()) {
      const p = o.profile && this.crew.dirty.has(o.profile.token) ? this.plotOf(o.profile) : null;
      if (p) o.peer.send({ t: "crew", ...this.crew.view(p) });
    }
    this.crew.dirty.clear();
  }

  /* The crews' step: who there is to fight, and who's near enough to keep them awake. */
  private tickCrew(now: number, dt: number) {
    if (!this.crew.men.size) return;
    const marks: Mark[] = [];
    const eyes: Body[] = [];
    for (const m of this.members.values()) {
      if (!this.present(m)) continue;
      eyes.push(m.body);
      if (m.respawnAt !== null || m.ride || m.flags & FLAG.creative) continue;
      const b = m.body;
      const raid = m.raid?.plot ?? null;
      marks.push({ id: m.id, side: this.sideOf(m), x: b.x, y: b.y, z: b.z, raid });
    }
    this.crew.tick(now, dt, marks, eyes);
    for (const c of this.crew.men.values()) if (c.bleed) this.tickBleed(c, now);
  }

  /* ---------- saving ---------- */

  /* Where someone is and what they carry, ready to store. */
  private playerState(m: Member): SavedPlayer {
    /* Saved while down: you come back on your feet, where you'd have woken. */
    const down = m.respawnAt !== null;
    const at = down ? this.home(m.profile) : { ...m.body, yaw: m.body.yaw };
    return {
      x: round2(at.x),
      y: round2(at.y),
      z: round2(at.z),
      yaw: round2(at.yaw),
      health: down ? HEALTH_MAX : Math.max(1, Math.ceil(m.health)),
      inv: structuredClone(m.inv),
      vehicle: down ? null : this.savedVehicle(m),
    };
  }

  /* Put the saved player back where they were, with everything they had. */
  private welcomeBack(m: Member, saved: SavedPlayer) {
    m.inv = saved.inv;
    /* One weapon at a time, in its own slot: older saves may carry several, anywhere. */
    const weapons = m.inv.tools.filter((t) => !isThrown(TOOLS[t.kind].weapon));
    const kept = weapons[0] ? (TOOLS[weapons[0].kind].weapon as WeaponKind) : null;
    for (const t of weapons) this.removeTool(m, t.id);
    if (kept) this.arm(m, kept, false);
    m.health = saved.health;
    m.invDirty = true;
    /* The map changed under them: back to the Harbor, with everything they had. */
    if (saved.relocate) {
      const h = this.home(m.profile);
      m.body = createBody(h.x, h.y, h.z, h.yaw);
      return;
    }
    /* Your vehicle comes back where you left it, if there's still room for it, with you in it. */
    if (saved.vehicle && this.restoreVehicle(m, saved.vehicle)) return;
    /* Never inside something that was built over the spot, or underground. */
    const { ground } = this.world.groundAt(saved.x, saved.z, saved.y + 0.3);
    const inside = this.world
      .solidsNear(saved.x, saved.z)
      .some(
        (o) => o.top > ground + 0.6 && o.bottom < ground + 1.7 && overSolid(o, saved.x, saved.z),
      );
    if (inside) {
      const s = this.home(m.profile);
      m.body = createBody(s.x, s.y, s.z, s.yaw);
    } else m.body = createBody(saved.x, Math.max(saved.y, ground), saved.z, saved.yaw);
  }

  humans() {
    let n = 0;
    for (const m of this.members.values()) if (!m.spectator) n++;
    return n;
  }

  /* In the world with a body: not just watching. */
  private present(m: Member) {
    return !m.spectator && m.placed;
  }

  /*
   * Who's arriving, by the token they bring. A token this tab owns takes over
   * a connection still holding it (the tab was reloaded); one borrowed from
   * another tab that's still connected gets a new identity instead, so two
   * tabs in one browser are two players.
   */
  private claim(token: string | undefined, own: boolean, name: string): Profile {
    const known = token ? this.profiles.get(token) : undefined;
    if (known) {
      const using = [...this.members.values()].find((o) => o.profile === known);
      if (!using) {
        known.name = name;
        return known;
      }
      if (own) {
        this.leave(using.id);
        using.peer.close?.();
        known.name = name;
        return known;
      }
    }
    const fresh: Profile = {
      token: token && !known ? token : crypto.randomUUID(),
      name,
      saved: null,
    };
    this.profiles.set(fresh.token, fresh);
    return fresh;
  }

  join(
    peer: Peer,
    hello: {
      name?: string;
      spectate?: boolean;
      token?: string;
      own?: boolean;
      skin?: SkinId;
      weapon?: WeaponKind | null;
    } = {},
  ) {
    const spectator = !!hello.spectate;
    /* You're called what you picked on the title screen. */
    const name = hello.name ?? "Guest";
    const profile =
      this.opts.grand && !spectator ? this.claim(hello.token, !!hello.own, name) : null;
    if (!spectator && this.humans() >= (this.opts.maxHumans ?? MAX_PLAYERS)) {
      peer.send({ t: "full" });
      return -1;
    }
    const id = this.nextId++;
    /* Everyone arrives with a body: at their own Hearth, or on the Harbor. */
    const placed = !spectator;
    const h = this.home(profile);
    /* The browser's choice wins: you may have changed skins on the title screen. */
    const skin = hello.skin && canWear(hello.skin) ? hello.skin : (profile?.skin ?? DEFAULT_SKIN);
    if (profile) profile.skin = skin;
    const member: Member = {
      id,
      name,
      skin,
      peer,
      spectator,
      profile,
      placed,
      body: createBody(h.x, h.y, h.z, h.yaw),
      pitch: 0,
      flags: 0,
      health: HEALTH_MAX,
      lastHurtAt: -1e9,
      airVy: 0,
      underSince: null,
      drownAt: 0,
      respawnAt: null,
      attackReadyAt: 0,
      shoveFlagUntil: 0,
      inv: emptyInventory(),
      ride: null,
      vehicle: null,
      invDirty: true,
      stagger: 0,
      lastHitAt: 0,
      combo: 0,
      lastSwingAt: 0,
      blocking: false,
      blockSince: 0,
      charging: false,
      bleed: null,
      water: false,
      raid: null,
    };
    if (placed && profile?.saved) {
      this.welcomeBack(member, profile.saved);
      profile.saved = null;
    }
    const purse = this.opts.devCoins ?? 0;
    if (member.inv.coins < purse) member.inv.coins = purse;
    /* The browser's choice of weapon wins, as with skins. */
    if (
      placed &&
      hello.weapon !== undefined &&
      !isThrown(hello.weapon) &&
      hello.weapon !== this.carried(member)
    )
      this.arm(member, hello.weapon, false);
    this.members.set(id, member);
    peer.send({
      t: "welcome",
      id,
      name: member.name,
      online: this.opts.online,
      token: profile?.token ?? null,
    });
    peer.send({ t: "world", ...this.worldInfo(member) });
    if (member.ride) peer.send({ t: "aboard", id: member.ride.id, seat: member.ride.seat });
    if (profile && this.plotOf(profile)) {
      this.crew.dirty.add(profile.token);
      this.flushCrew();
    }
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
    /* Online, the map keeps your place: you come back where you left off. */
    if (m.profile && m.placed) {
      m.profile.saved = this.playerState(m);
      this.opts.onChange?.();
    }
    /* Your crew go home first: off your vehicle, so it can go too. */
    if (m.profile) this.crew.masterLeft(m.profile.token);
    this.unseat(m);
    this.despawn(m);
    this.endRaid(m);
    this.members.delete(id);
    if (!m.spectator) {
      this.broadcastRoster();
      if (this.opts.online) this.feed(`${m.name} left`);
    }
  }

  handle(id: number, msg: ClientMsg) {
    const m = this.members.get(id);
    if (!m || m.spectator) return;
    /* What you wear and carry can change anywhere, even while down. */
    if (msg.t === "skin") {
      this.dress(m, msg.skin);
      return;
    }
    if (msg.t === "arm") {
      if (m.placed) this.arm(m, msg.kind, true);
      this.flush(m);
      return;
    }
    if (msg.t === "hire" || msg.t === "dismiss" || msg.t === "crewarm" || msg.t === "order") {
      if (m.placed) this.crewCommand(m, msg);
      this.flush(m);
      this.flushCrew();
      return;
    }
    if (!m.placed || m.respawnAt !== null) return;
    this.apply(m, msg);
    this.flush(m);
  }

  private dress(m: Member, skin: SkinId) {
    if (m.skin === skin || !canWear(skin)) return;
    m.skin = skin;
    if (m.profile) {
      m.profile.skin = skin;
      this.opts.onChange?.();
    }
    this.broadcastRoster();
  }

  /* ---------- the grand map ---------- */

  /*
   * Where someone wakes up: in front of their own Hearth if they have land,
   * otherwise the Harbor (the only island, on the title screen).
   */
  private home(profile: Profile | null = null): Spawn {
    const plot = this.plotOf(profile);
    const own = plot ? this.world.islands.get(plot.id)?.terrain : null;
    const h = (own ?? this.harbor ?? this.world.primary)?.home ?? { x: 0, y: 0, z: 0, yaw: 0 };
    return { x: h.x, y: h.y, z: h.z, yaw: h.yaw };
  }

  private keptState(m: Member): SavedPlayer {
    return this.playerState(m);
  }

  /* The grand map and everyone who's been on it, ready to store. */
  exportWorld(): WorldSave {
    const live = new Map<Profile, Member>();
    for (const m of this.members.values()) if (m.profile && m.placed) live.set(m.profile, m);
    return {
      v: WORLD_SAVE_VERSION,
      players: [...this.profiles.values()].map((p) => {
        const m = live.get(p);
        return {
          ...structuredClone(p),
          saved: m ? this.keptState(m) : p.saved,
        };
      }),
      plots: [...this.plots.values()].map((p) => ({
        ...p,
        items: p.items.map((o) => ({ ...o })),
        ...(p.crew ? { crew: p.crew.map((o) => ({ ...o })) } : {}),
      })),
      ids: { tool: this.toolId, plot: this.plotId, item: this.itemId, crew: this.crew.nextId },
    };
  }

  /* A client's flags, less creative and flying where creative isn't allowed. */
  private allowed(flags: number) {
    return this.opts.creative ? flags : flags & ~(FLAG.creative | FLAG.fly);
  }

  private apply(m: Member, msg: ClientMsg) {
    switch (msg.t) {
      case "move": {
        /* A rider's body goes where their seat does; the helmsman reports where they've steered. */
        if (m.ride) {
          if (m.ride.seat === 0 && msg.ride) this.report(m, msg.ride);
          m.pitch = msg.pitch;
          m.flags = (m.flags & ~FLAG.creative) | (this.allowed(msg.flags) & FLAG.creative);
          m.airVy = 0;
          return;
        }
        const flags = this.allowed(msg.flags);
        this.landing(m, msg.vy, flags);
        m.body.yaw = msg.yaw;
        m.pitch = msg.pitch;
        m.body.x = clamp(msg.x, -BOUNDARY, BOUNDARY);
        const creative = (flags & FLAG.creative) !== 0;
        m.body.y = clamp(msg.y, SEA_FLOOR - 20, creative ? FLY_CEILING + 5 : this.world.peak + 30);
        m.body.z = clamp(msg.z, -BOUNDARY, BOUNDARY);
        m.body.vx = msg.vx;
        m.body.vy = msg.vy;
        m.body.vz = msg.vz;
        m.flags = flags & (FLAG.sprint | FLAG.grounded | FLAG.wet | FLAG.fly | FLAG.creative);
        return;
      }
      case "attack":
        this.attack(m, msg.charge, msg.aim);
        return;
      case "broadside":
        this.broadside(m, msg.side, msg.lift);
        return;
      case "stance": {
        const weapon = this.weaponOf(m);
        const block = msg.block && guardOf(weapon) !== null;
        if (block && !m.blocking) m.blockSince = this.now();
        m.blocking = block;
        m.charging = msg.charge && !!weapon && !!weaponDef(weapon).charge;
        return;
      }
      case "spawn":
        this.spawnVehicle(m, msg.kind);
        return;
      case "buyplot":
        this.buyPlot(m, msg.size, msg.shape, msg.x, msg.z);
        return;
      case "growplot":
        this.growPlot(m, msg.size);
        return;
      case "place":
        this.place(m, msg.kind, msg.x, msg.z, msg.rot, msg.move);
        return;
      case "sell":
        this.sell(m, msg.id);
        return;
      case "repair":
        this.repair(m, msg.id);
        return;
      case "buyVehicle":
        this.buyVehicle(m, msg.kind);
        return;
      case "devcoins":
        /* Only where creative is allowed: the dev server. */
        if (this.opts.creative) {
          m.inv.coins += 10000;
          m.invDirty = true;
        }
        return;
      case "accept":
        this.accept(m, msg.id);
        return;
      case "turnin":
        this.turnIn(m);
        return;
      case "abandon":
        if (m.inv.mission) {
          m.inv.mission = null;
          m.invDirty = true;
        }
        return;
      case "collect":
        this.collect(m);
        return;
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
      case "interact":
        this.climbAboard(m, msg.id);
        return;
      default:
        return;
    }
  }

  /* ---------- inventory ---------- */

  /* The weapon in hand (null for fists or a rod). */
  private weaponOf(m: Member) {
    const tool = heldTool(m.inv);
    return tool ? TOOLS[tool.kind].weapon : null;
  }

  /* The one weapon you carry, in hand or not (kegs and smoke bombs ride beside it). */
  private carried(m: Member) {
    const tool = m.inv.tools.find((t) => !isThrown(TOOLS[t.kind].weapon));
    return tool ? TOOLS[tool.kind].weapon : null;
  }

  /*
   * Add a tool to your pack: into the preferred hotbar slot if it's free,
   * otherwise the first free one, otherwise the pack. Null when you're full.
   */
  private giveTool(m: Member, kind: ToolKind, prefer: number, uses?: number): Tool | null {
    if (m.inv.tools.length >= MAX_TOOLS) return null;
    const tool: Tool = { id: this.toolId++, kind, uses: uses ?? -1 };
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
    const held = heldTool(inv)?.id;
    const from = inv.hotbar.indexOf(toolId);
    if (slot < 0) {
      if (from > 0) inv.hotbar[from] = null;
    } else {
      /* Swap with whatever's there (into our old slot, or back to the pack). */
      const there = inv.hotbar[slot];
      if (from > 0) inv.hotbar[from] = there;
      inv.hotbar[slot] = toolId;
    }
    if (heldTool(inv)?.id !== held) m.attackReadyAt = Math.max(m.attackReadyAt, this.now() + 0.2);
    m.blocking = false;
    m.charging = false;
    m.invDirty = true;
  }

  /*
   * Take up a weapon from the marketplace: it replaces whatever you carried,
   * goes in the weapon slot, and into your hand. Null puts it away for fists.
   */
  private arm(m: Member, kind: WeaponKind | null, announce: boolean) {
    if (isThrown(kind)) {
      if (announce) this.buyThrown(m, kind as WeaponKind);
      return;
    }
    const had = this.carried(m);
    for (const t of m.inv.tools.filter((o) => !isThrown(o.kind))) this.removeTool(m, t.id);
    if (!kind) {
      if (m.inv.slot === WEAPON_SLOT) m.inv.slot = 0;
      m.invDirty = true;
      return;
    }
    /* Whatever else sat in the weapon slot moves along the belt (or into the pack). */
    const bar = m.inv.hotbar;
    const there = bar[WEAPON_SLOT];
    if (there != null) {
      bar[WEAPON_SLOT] = null;
      const free = bar.findIndex((id, i) => i > WEAPON_SLOT && id == null);
      if (free > 0) bar[free] = there;
    }
    const tool = this.giveTool(m, kind, WEAPON_SLOT);
    if (!tool) return;
    /* A bucket comes empty: fill it in the sea or at a well. */
    if (had !== kind) m.water = false;
    m.inv.slot = WEAPON_SLOT;
    m.attackReadyAt = Math.max(m.attackReadyAt, this.now() + 0.3);
    if (announce && had !== kind)
      m.peer.send({ t: "feed", text: `You take up the ${weaponDef(kind).name.toLowerCase()}` });
  }

  /*
   * A keg or a smoke bomb, bought one at a time: onto the stack on your belt
   * (STACK at most), and into your hand.
   */
  private buyThrown(m: Member, kind: WeaponKind) {
    const def = WEAPONS[kind];
    const say = (text: string) => m.peer.send({ t: "feed", text });
    const name = def.name.toLowerCase();
    let stack = m.inv.tools.find((t) => t.kind === kind) ?? null;
    if (stack && stack.uses >= STACK) return say(`You can carry ${STACK} at most`);
    if (m.inv.coins < def.price) return say(`A ${name} costs ${def.price} coins`);
    if (stack) stack.uses++;
    else stack = this.giveTool(m, kind, WEAPON_SLOT + 1, 1);
    if (!stack) return say("Your pack is full");
    m.inv.coins -= def.price;
    const slot = m.inv.hotbar.indexOf(stack.id);
    if (slot > 0) m.inv.slot = slot;
    m.invDirty = true;
    say(`Bought a ${name} for ${def.price} coins · ${stack.uses} on your belt`);
  }

  addItem(m: Member, id: ItemId, n = 1) {
    m.inv.items[id] = Math.max(0, (m.inv.items[id] ?? 0) + n);
    if (!m.inv.items[id]) delete m.inv.items[id];
    m.invDirty = true;
  }

  /* ---------- vehicles ---------- */

  /* A vehicle from the marketplace, paid for once with coins and kept. */
  private buyVehicle(m: Member, kind: VehicleKind) {
    const def = VEHICLES[kind];
    if (ownsVehicle(m.inv.vehicles, kind)) return;
    if (m.inv.coins < def.price) {
      m.peer.send({
        t: "feed",
        text: `${(def.price - m.inv.coins).toLocaleString("en")} more coins for the ${def.name.toLowerCase()}`,
      });
      return;
    }
    m.inv.coins -= def.price;
    m.inv.vehicles.push(kind);
    m.invDirty = true;
    m.peer.send({ t: "feed", text: `The ${def.name.toLowerCase()} is yours` });
  }

  /* A vehicle you own, near you. The one you spawned before goes. */
  private spawnVehicle(m: Member, kind: VehicleKind) {
    if (!ownsVehicle(m.inv.vehicles, kind)) {
      m.peer.send({ t: "feed", text: `Buy the ${VEHICLES[kind].name.toLowerCase()} first` });
      return;
    }
    if (m.ride) {
      m.peer.send({ t: "feed", text: "Get off before spawning another" });
      return;
    }
    if (this.rides.size >= MAX_RIDES) {
      m.peer.send({ t: "feed", text: "The sea can't hold any more" });
      return;
    }
    /* Your last one makes way for the new one, unless someone has gone off in it. */
    const old = m.vehicle === null ? null : this.rides.get(m.vehicle);
    const going = old && old.seats.every((s) => s === null || !this.members.has(s)) ? old : null;
    if (going) this.world.removeSolids(going.id);
    const at = this.launchSpot(m, kind);
    if (going) this.world.addSolids(going.id, vehicleSolids(going.kind, going.state));
    const def = VEHICLES[kind];
    if (!at) {
      m.peer.send({
        t: "feed",
        text: !afloat(kind)
          ? "Find clear, dry, fairly level ground for it"
          : def.section === "Ships"
            ? "Head down to deeper water to launch it"
            : "Head down to the water to launch it",
      });
      return;
    }
    this.despawn(m);
    const r = this.addRide(kind, at.x, at.y, at.z, at.rot);
    m.vehicle = r.id;
    m.peer.send({
      t: "feed",
      text: at.moored
        ? `Your ${def.name.toLowerCase()} is tied up at the pier · E to climb aboard`
        : afloat(kind)
          ? `Your ${def.name.toLowerCase()} is in the water · E to climb aboard`
          : def.class === "mount"
            ? `Your ${def.name.toLowerCase()} is saddled · E to mount`
            : `Your ${def.name.toLowerCase()} is ready · E to get in`,
    });
  }

  private addRide(kind: VehicleKind, x: number, y: number, z: number, rot: number): Ride {
    const state = createVehicle(x, y, z, rot);
    settle(kind, state, this.world);
    const r: Ride = {
      id: this.rideId++,
      kind,
      state,
      seats: VEHICLES[kind].seats.map(() => null),
      reportAt: 0,
      strikes: 0,
      hp: hullOf(kind),
      reload: [0, 0],
    };
    this.rides.set(r.id, r);
    this.world.addSolids(r.id, vehicleSolids(kind, state));
    return r;
  }

  private removeRide(id: number) {
    const r = this.rides.get(id);
    for (const s of r?.seats ?? []) {
      const c = s === null ? null : this.crew.get(s);
      if (c) this.unseatCrew(c);
    }
    if (!this.rides.delete(id)) return;
    this.world.removeSolids(id);
    for (const o of this.members.values()) if (o.vehicle === id) o.vehicle = null;
  }

  /*
   * Room for it near you: open water deep enough for the hull, or clear dry
   * ground. Bow pointing away from you, and straight ahead wins: the whole
   * range in front is searched before turning aside, and the sides before
   * behind, so a puddle at your heels never beats the sea you're looking at.
   */
  private launchSpot(
    m: Member,
    kind: VehicleKind,
  ): {
    x: number;
    y: number;
    z: number;
    rot: number;
    moored?: boolean;
  } | null {
    if (afloat(kind)) {
      const berth = this.berthSpot(m, kind);
      if (berth) return berth;
    }
    const def = VEHICLES[kind];
    const { x: px, z: pz, yaw } = m.body;
    const range = Math.max(LAUNCH_RANGE, def.length * 2.2);
    /* Bearings off straight ahead, in widening fans: ahead, then the sides, then behind. */
    const fans = [
      [0, 1, -1],
      [2, -2, 3, -3],
      [4, -4, 5, -5, 6, -6, 7, -7, 8],
    ];
    for (const fan of fans)
      for (let r = Math.max(3, def.beam / 2 + 1.5); r <= range; r += 1.5) {
        for (const k of fan) {
          const a = yaw + k * (Math.PI / 8);
          const x = px - Math.sin(a) * r;
          const z = pz - Math.cos(a) * r;
          if (Math.abs(x) > BOUNDARY - 4 || Math.abs(z) > BOUNDARY - 4) continue;
          /* Never on top of you. */
          if (distanceTo(kind, { x, z, rot: a }, px, pz) < 0.9) continue;
          const y = placeAt(kind, this.world, x, z, a);
          if (y === null) continue;
          /* Land vehicles where you can walk to them, not on a ledge far below. */
          if (!afloat(kind) && Math.abs(y - m.body.y) > 4) continue;
          return { x, y, z, rot: a };
        }
      }
    return null;
  }

  /*
   * Near a pier, a boat is tied up alongside it, bow to the sea: the free
   * berth nearest you with water deep enough for its hull, clear of the
   * boats already there. Null when you're nowhere near a pier, or it's full.
   */
  private berthSpot(m: Member, kind: VehicleKind) {
    const def = VEHICLES[kind];
    const { x: px, z: pz } = m.body;
    const off = def.beam / 2 + 0.6;
    let best: { x: number; y: number; z: number; rot: number; moored: true; d: number } | null =
      null;
    for (const b of this.world.berths) {
      const along = clamp((px - b.x) * b.dx + (pz - b.z) * b.dz, 0, b.length);
      if (Math.hypot(b.x + b.dx * along - px, b.z + b.dz * along - pz) > BERTH_RANGE) continue;
      const rot = Math.atan2(-b.dx, -b.dz);
      /* A big ship may stand a little past the end. */
      const last = b.length - def.length * 0.25;
      for (let s = def.length / 2; s <= last; s += 1.5) {
        const x = b.x + b.dx * s + b.nx * off;
        const z = b.z + b.dz * s + b.nz * off;
        const d = Math.hypot(x - px, z - pz);
        if (best && d >= best.d) continue;
        if (distanceTo(kind, { x, z, rot }, px, pz) < 0.9) continue;
        const y = placeAt(kind, this.world, x, z, rot);
        if (y === null) continue;
        best = { x, y, z, rot, moored: true, d };
      }
    }
    return best;
  }

  /* Take back the vehicle you spawned, unless someone is sitting in it. */
  private despawn(m: Member) {
    const id = m.vehicle;
    m.vehicle = null;
    const r = id === null ? null : this.rides.get(id);
    if (!r || r.seats.some((s) => s !== null && this.members.has(s))) return;
    this.removeRide(r.id);
  }

  /*
   * E by a vehicle: climb into its first free seat (the helm, if nobody has
   * it). In one: a passenger takes an empty helm; anyone else gets off.
   */
  private climbAboard(m: Member, id: number) {
    const r = this.rides.get(id);
    if (!r) return;
    if (m.ride) {
      if (m.ride.id !== id) return;
      if (m.ride.seat !== 0 && r.seats[0] === null) {
        r.seats[m.ride.seat] = null;
        r.seats[0] = m.id;
        m.ride = { id, seat: 0 };
        r.reportAt = this.now();
        r.strikes = 0;
        this.seatRider(m, r);
        m.peer.send({ t: "aboard", id, seat: 0 });
        return;
      }
      this.getOff(m, r);
      return;
    }
    const s = r.state;
    if (distanceTo(r.kind, s, m.body.x, m.body.z) > RIDE_REACH + 0.6) return;
    /* From the water or a dock you can climb any hull; on land it has to be within a step. */
    if (!afloat(r.kind) && Math.abs(m.body.y - s.y) > 2.5) return;
    const seat = r.seats.findIndex((o) => o === null);
    if (seat < 0) {
      m.peer.send({ t: "feed", text: "There's no room aboard" });
      return;
    }
    r.seats[seat] = m.id;
    m.ride = { id, seat };
    if (seat === 0) {
      r.reportAt = this.now();
      r.strikes = 0;
    }
    m.airVy = 0;
    this.seatRider(m, r);
    m.peer.send({ t: "aboard", id, seat });
  }

  private getOff(m: Member, r: Ride) {
    const seat = m.ride?.seat ?? 0;
    const def = VEHICLES[r.kind];
    if (!afloat(r.kind) && Math.abs(r.state.speed) > (def.mount ? 6 : 4)) {
      m.peer.send({ t: "feed", text: "Slow down before getting off" });
      return;
    }
    const at = exitSpot(r.kind, r.state, this.world, seat);
    if (!at) {
      m.peer.send({ t: "feed", text: "Move to a clear spot before getting off" });
      return;
    }
    this.unseat(m);
    m.body = createBody(at.x, at.y, at.z, at.yaw);
    m.airVy = 0;
    m.peer.send({ t: "aboard", id: null, seat: 0, at });
  }

  /* Out of whatever seat you're in. A vehicle nobody owns or sits in is gone. */
  private unseat(m: Member) {
    const ride = m.ride;
    m.ride = null;
    m.flags &= ~FLAG.riding;
    if (!ride) return;
    const r = this.rides.get(ride.id);
    if (!r) return;
    r.seats[ride.seat] = null;
    /* Nobody at the helm: the engine idles and the sails come in. */
    if (ride.seat === 0 && r.state.aux > 0 && VEHICLES[r.kind].class !== "mount") r.state.aux = 0;
    const owned = [...this.members.values()].some((o) => o.vehicle === r.id);
    /* Crew don't keep a vehicle: with nobody else aboard, they get off too. */
    if (!owned && r.seats.every((s) => s === null || !this.members.has(s))) this.removeRide(r.id);
  }

  /*
   * The helmsman says where they've steered it. The room takes it as long as
   * it's a plausible step on the right ground; reports that keep not adding
   * up get the helmsman put back where the room has it.
   */
  private report(m: Member, f: number[]) {
    const r = m.ride ? this.rides.get(m.ride.id) : null;
    if (!r) return;
    const now = this.now();
    const [x, y, z, rot, speed, steer, turn, pitch, roll, vy, aux] = f;
    const def = VEHICLES[r.kind];
    const top = def.hull?.speed ?? def.car?.speed ?? def.mount?.gallop ?? 20;
    const elapsed = Math.min(1, Math.max(0, now - r.reportAt));
    const step = Math.hypot(x - r.state.x, z - r.state.z);
    r.reportAt = now;
    const ok =
      step <= top * 1.5 * elapsed + 3 &&
      Math.abs(speed) <= top * 1.3 + 1 &&
      Math.abs(vy) < 30 &&
      this.plausible(r.kind, x, y, z);
    if (!ok) {
      if (++r.strikes >= 3) {
        r.strikes = 0;
        m.peer.send({
          t: "vfix",
          snap: packVehicle(r.id, vehicleIndex(r.kind), r.state, r.seats),
        });
      }
      return;
    }
    r.strikes = 0;
    Object.assign(r.state, { x, y, z, rot, speed, steer, turn, pitch, roll, vy, aux });
    r.state.supportY = y;
    r.state.slipX = r.state.slipZ = 0;
    this.world.addSolids(r.id, vehicleSolids(r.kind, r.state));
  }

  /* Afloat on the sea, or on (or just over) the ground. */
  private plausible(kind: VehicleKind, x: number, y: number, z: number) {
    if (Math.abs(x) > BOUNDARY || Math.abs(z) > BOUNDARY) return false;
    const h = this.world.heightAt(x, z);
    if (afloat(kind)) return h < SEA_LEVEL - 0.1 && Math.abs(y - SEA_LEVEL) < 0.6;
    /* Cars can end up on the bottom of the sea; mounts stay near the shore. */
    if (h < SEA_LEVEL - 1.5 && VEHICLES[kind].class !== "car") return false;
    const g = this.world.groundAt(x, z, y + 1).ground;
    /* A car can be well up in the air, coming down off a cliff. */
    return y > g - 1 && y < g + (VEHICLES[kind].class === "car" ? 120 : 4);
  }

  /* Vehicles nobody is steering coast to a stop; everyone aboard goes where their seat does. */
  private tickRides(now: number, dt: number) {
    for (const r of this.rides.values()) {
      const helm = r.seats[0] === null ? null : this.members.get(r.seats[0]);
      const driven = !!helm && helm.respawnAt === null && now - r.reportAt < REPORT_TIMEOUT;
      if (!driven && !atRest(r.state)) {
        /* Only this vehicle's own hull is out of its way. */
        this.world.removeSolids(r.id);
        stepVehicle(r.kind, r.state, IDLE, dt, this.world, this.time);
        this.world.addSolids(r.id, vehicleSolids(r.kind, r.state));
      }
      for (let i = 0; i < r.seats.length; i++) {
        const id = r.seats[i];
        if (id === null) continue;
        const o = this.members.get(id);
        const c = o ? null : this.crew.get(id);
        if (o) this.seatRider(o, r);
        else if (c?.ride?.id === r.id) this.seatCrew(c, r);
        else r.seats[i] = null;
      }
    }
  }

  /* A rider's body is wherever their seat is, sitting. */
  private seatRider(m: Member, r: Ride) {
    const seat = m.ride?.seat ?? 0;
    const at = riderPose(r.kind, r.state, seat);
    const s = r.state;
    Object.assign(m.body, {
      x: at.x,
      y: at.y,
      z: at.z,
      yaw: at.yaw,
      vx: -Math.sin(s.rot) * s.speed,
      vy: 0,
      vz: -Math.cos(s.rot) * s.speed,
      grounded: true,
    });
    m.flags = FLAG.grounded | FLAG.riding | (m.flags & FLAG.creative);
  }

  /* The vehicle to keep for someone: the one they're steering, or else the one they spawned. */
  private savedVehicle(m: Member): SavedVehicle | null {
    const helm = m.ride?.seat === 0 ? this.rides.get(m.ride.id) : null;
    const r = helm ?? (m.vehicle === null ? null : this.rides.get(m.vehicle));
    if (!r) return null;
    const s = r.state;
    return {
      kind: r.kind,
      x: round2(s.x),
      y: round2(s.y),
      z: round2(s.z),
      rot: round2(s.rot),
      aboard: r === helm,
    };
  }

  /*
   * Back from a break: your vehicle where you left it, if there's still room
   * for it, and you at its helm if that's where you were. True if you're seated.
   */
  private restoreVehicle(m: Member, saved: SavedVehicle) {
    /* From before vehicles cost coins: one that was never bought doesn't come back. */
    if (!ownsVehicle(m.inv.vehicles, saved.kind)) return false;
    const y = placeAt(saved.kind, this.world, saved.x, saved.z, saved.rot);
    if (y === null || this.rides.size >= MAX_RIDES) return false;
    const r = this.addRide(saved.kind, saved.x, y, saved.z, saved.rot);
    m.vehicle = r.id;
    if (!saved.aboard) return false;
    r.seats[0] = m.id;
    m.ride = { id: r.id, seat: 0 };
    r.reportAt = this.now();
    this.seatRider(m, r);
    return true;
  }

  private vehicleSnaps(): VehicleSnap[] {
    const v: VehicleSnap[] = [];
    for (const r of this.rides.values())
      v.push(packVehicle(r.id, vehicleIndex(r.kind), r.state, r.seats));
    return v;
  }

  /* ---------- the Guild Board ---------- */

  private nearBoard(m: Member) {
    const b = this.harbor?.board;
    if (!b || !FEATURES.board) return false;
    return (
      Math.hypot(b.x - m.body.x, b.z - m.body.z) < BOARD_REACH && Math.abs(b.y - m.body.y) < 2.5
    );
  }

  /* Which islands a kind lives on. */
  private homesOf(species: SpeciesId) {
    const out: number[] = [];
    for (const { info } of this.world.islands.values())
      if (info.biome && BIOME_HERDS[info.biome][species]) out.push(info.id);
    return out;
  }

  /* Top the board up to its full set of contracts. Returns true if anything changed. */
  private fillBoard() {
    if (!FEATURES.board || !this.opts.grand) return false;
    let changed = false;
    const board = this.board;
    while (board.contracts.length < BOARD_SIZE) {
      const held = [...this.members.values()].map((m) => m.inv.mission).filter((c) => !!c);
      const easy = !board.contracts.some((c) => SPECIES[c.species].role === "prey");
      const c = makeContract(
        this.rng,
        this.missionId++,
        [...board.contracts, ...held],
        (sp) => this.homesOf(sp),
        easy,
      );
      board.contracts.push(c);
      this.posted.set(c.id, this.time);
      changed = true;
    }
    if (changed) this.boardDirty = true;
    return changed;
  }

  private postBoard() {
    this.boardDirty = false;
    this.broadcast({ t: "board", board: this.board });
  }

  private news(title: string, sub: string) {
    this.broadcast({ t: "news", title, sub });
    this.feed(`${title} · ${sub}`);
  }

  private islandName(id: number) {
    return this.world.islands.get(id)?.info.name ?? "the wilds";
  }

  private gap(range: readonly [number, number]) {
    return range[0] + this.rng() * (range[1] - range[0]);
  }

  /* Contracts nobody takes come down after a while; alphas and culls come and go. */
  private tickBoard() {
    if (!FEATURES.board || !this.opts.grand) return;
    const board = this.board;
    const stale = board.contracts.find(
      (c) => this.time - (this.posted.get(c.id) ?? 0) > BOARD_REFRESH,
    );
    if (stale) {
      board.contracts = board.contracts.filter((c) => c !== stale);
      this.posted.delete(stale.id);
      this.fillBoard();
    }
    this.tickAlpha();
    this.tickCull();
    if (this.boardDirty) this.postBoard();
  }

  /* ----- the alpha hunt ----- */

  private alphaAnimal(): Animal | null {
    return this.herd?.animals.find((a) => a.alpha) ?? null;
  }

  private tickAlpha() {
    const board = this.board;
    const hunt = board.alpha;
    if (!hunt) {
      if (board.nextAlpha === null || this.time < board.nextAlpha || !this.herd) return;
      const options = ALPHAS.flatMap((def) => {
        const island = [...this.world.islands.values()].find((o) => o.info.biome === def.biome);
        return island ? [{ def, island: island.info.id }] : [];
      });
      if (!options.length) {
        board.nextAlpha = null;
        return;
      }
      const { def, island } = options[Math.floor(this.rng() * options.length)];
      const beast = this.herd.spawn(def.species, island, this.preyList(), { alpha: true });
      if (!beast) {
        board.nextAlpha = this.time + 30;
        return;
      }
      board.alpha = {
        id: this.missionId++,
        species: def.species,
        name: def.name,
        island,
        reward: def.reward,
        endsAt: this.time + ALPHA_TIME,
        slainBy: null,
      };
      board.nextAlpha = null;
      this.boardDirty = true;
      this.news(
        `${def.name} sighted`,
        `An alpha ${SPECIES[def.species].name.toLowerCase()} roams ${this.islandName(island)} · ${def.reward} coins`,
      );
      return;
    }
    if (this.time < hunt.endsAt) return;
    /* Time's up: it slips away (or, slain, its notice comes down). */
    if (!hunt.slainBy) {
      this.herd?.remove((a) => a.alpha);
      this.news(
        `${hunt.name} slipped away`,
        `Nobody brought it down on ${this.islandName(hunt.island)}`,
      );
    }
    board.alpha = null;
    board.nextAlpha = this.time + this.gap(ALPHA_GAP);
    this.boardDirty = true;
  }

  private alphaSlain(m: Member, hunt: AlphaHunt) {
    hunt.slainBy = m.name;
    /* The notice stays up a minute, so everyone can see who did it. */
    hunt.endsAt = this.time + 60;
    this.pay(m, { title: `Slew ${hunt.name}`, reward: hunt.reward });
    this.boardDirty = true;
    this.news(
      `${hunt.name} is slain`,
      `${m.name} brought it down · ${hunt.reward} coins at the Guild Board`,
    );
  }

  /* ----- the cull ----- */

  private tickCull() {
    const board = this.board;
    const cull = board.cull;
    if (!cull) {
      if (board.nextCull === null || this.time < board.nextCull || !this.herd) return;
      const options = CULLS.flatMap((def) => {
        const island = [...this.world.islands.values()].find((o) => o.info.biome === def.biome);
        return island ? [{ def, island: island.info.id }] : [];
      });
      if (!options.length) {
        board.nextCull = null;
        return;
      }
      const { def, island } = options[Math.floor(this.rng() * options.length)];
      const id = this.missionId++;
      const want = 8 + Math.floor(this.rng() * 5);
      const prey = this.preyList();
      let need = 0;
      for (let i = 0; i < want; i++)
        if (this.herd.spawn(def.species, island, prey, { cull: id })) need++;
      if (!need) {
        board.nextCull = this.time + 30;
        return;
      }
      const sp = SPECIES[def.species];
      board.cull = {
        id,
        species: def.species,
        island,
        need,
        done: 0,
        pot: Math.round((sp.value * need * 1.4) / 10) * 10,
        endsAt: this.time + CULL_TIME,
        state: "active",
        hunters: [],
      };
      this.cullKills.clear();
      board.nextCull = null;
      this.boardDirty = true;
      this.news(
        `${this.islandName(island)} is overrun`,
        `Cull ${need} ${sp.plural} · ${board.cull.pot} coins shared among the hunters`,
      );
      return;
    }
    if (this.time < cull.endsAt) return;
    if (cull.state === "active") {
      this.endCull(cull, false);
      return;
    }
    board.cull = null;
    board.nextCull = this.time + this.gap(CULL_GAP);
    this.boardDirty = true;
  }

  private cullKill(m: Member, cull: Cull) {
    const key = m.profile?.token ?? `member:${m.id}`;
    const entry = this.cullKills.get(key) ?? { name: m.name, kills: 0 };
    entry.kills++;
    this.cullKills.set(key, entry);
    cull.done++;
    cull.hunters = [...this.cullKills.values()]
      .map((o) => ({ ...o }))
      .sort((a, b) => b.kills - a.kills);
    this.boardDirty = true;
    if (cull.done >= cull.need) this.endCull(cull, true);
  }

  /* Pay everyone who took part, by their share of the kills. */
  private endCull(cull: Cull, cleared: boolean) {
    const where = this.islandName(cull.island);
    const share = cleared ? 1 : CULL_FAIL_SHARE;
    for (const [key, o] of this.cullKills) {
      const reward = Math.round(((cull.pot * o.kills) / cull.need) * share);
      if (reward <= 0) continue;
      const payout: Payout = {
        title: `${cleared ? "Cleared" : "Helped cull"} ${where} · ${o.kills} ${o.kills === 1 ? "kill" : "kills"}`,
        reward,
      };
      const online = [...this.members.values()].find(
        (mm) => (mm.profile?.token ?? `member:${mm.id}`) === key,
      );
      if (online) this.pay(online, payout);
      else {
        const saved = this.profiles.get(key)?.saved;
        if (saved && saved.inv.payouts.length < MAX_PAYOUTS) {
          saved.inv.payouts.push(payout);
          this.opts.onChange?.();
        }
      }
    }
    this.herd?.remove((a) => a.cull === cull.id);
    cull.state = cleared ? "cleared" : "failed";
    /* The result stays up a minute. */
    cull.endsAt = this.time + 60;
    this.boardDirty = true;
    if (cleared) this.news(`${where} is cleared`, "Shares are waiting at the Guild Board");
    else this.news(`The cull on ${where} ran out`, "Hunters are paid part of their share");
  }

  /* A reward to collect at the board. */
  private pay(m: Member, payout: Payout) {
    if (m.inv.payouts.length >= MAX_PAYOUTS) {
      /* A full purse of slips: the oldest is paid straight away instead. */
      const first = m.inv.payouts.shift();
      if (first) m.inv.coins += first.reward;
    }
    m.inv.payouts.push(payout);
    m.invDirty = true;
    m.peer.send({ t: "feed", text: `${payout.reward} coins waiting at the Guild Board` });
  }

  /* ----- at the board ----- */

  private accept(m: Member, id: number) {
    const offer = this.board.contracts.find((c) => c.id === id);
    if (!FEATURES.board || !offer || m.inv.mission || !this.nearBoard(m)) return;
    this.board.contracts = this.board.contracts.filter((c) => c !== offer);
    this.posted.delete(offer.id);
    m.inv.mission = offer;
    m.invDirty = true;
    this.fillBoard();
    this.postBoard();
  }

  private turnIn(m: Member) {
    const c: Contract | null = m.inv.mission;
    if (!FEATURES.board || !c || !this.nearBoard(m) || progress(m.inv, c) < c.count) return;
    consume(m.inv, c);
    m.inv.coins += c.reward;
    m.inv.mission = null;
    m.invDirty = true;
    m.peer.send({ t: "paid", payouts: [{ title: contractTitle(c), reward: c.reward }] });
  }

  private collect(m: Member) {
    if (!FEATURES.board || !m.inv.payouts.length || !this.nearBoard(m)) return;
    const payouts = m.inv.payouts;
    for (const p of payouts) m.inv.coins += p.reward;
    m.inv.payouts = [];
    m.invDirty = true;
    m.peer.send({ t: "paid", payouts });
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
    this.flushItems();
    this.flushCrew();
    for (const m of this.members.values()) this.flush(m);
    this.broadcastSnap(now);
  }

  private simulate(now: number, dt: number) {
    this.tickRides(now, dt);
    this.resolveHits(now);
    this.gatherTargets();
    this.shots.step(now, dt);
    this.herd?.tick(now, dt, this.preyList());
    if (this.plots.size) {
      this.fires.step(this.plots as ReadonlyMap<number, FirePlot>, now, windAt(this.time), dt);
      this.healAcc += dt;
      if (this.healAcc >= HEAL_EVERY) {
        this.healAcc = 0;
        this.heal(now);
      }
    }

    for (const m of this.members.values()) {
      if (!this.present(m)) continue;
      if (m.respawnAt !== null) {
        if (now >= m.respawnAt) this.respawn(m);
        continue;
      }

      if (m.health < HEALTH_MAX) {
        /* Health comes back slowly, a while after the last hurt. */
        if (now - m.lastHurtAt > REGEN_DELAY)
          m.health = Math.min(HEALTH_MAX, m.health + HEALTH_REGEN * dt);
      }

      this.tickBleed(m, now);
      this.tickDrown(m, now);
      this.fillBucket(m);

      /* Stagger wears off a few seconds after the last hit. */
      if (now - m.lastHitAt > STAGGER_GRACE)
        m.stagger = Math.max(0, m.stagger - STAGGER_RECOVER * dt);

      /* The sea is safe now; only a glitch through the floor sends you home, unhurt. */
      if (m.body.y < SEA_FLOOR - 8) this.respawn(m);
    }

    this.tickCrew(now, dt);
    this.tickRaids(now, dt);
    this.tickDefenses(now, dt);
    this.tickBoard();
  }

  /* Everyone the animals can see, in the shape they need. */
  private preyList() {
    this.prey.length = 0;
    for (const m of this.members.values()) {
      if (!this.present(m)) continue;
      this.prey.push(this.asPrey(m));
    }
    return this.prey;
  }

  private asPrey(m: Member): Prey {
    return {
      id: m.id,
      x: m.body.x,
      y: m.body.y,
      z: m.body.z,
      yaw: m.body.yaw,
      running: (m.flags & FLAG.sprint) !== 0,
      blocking: m.blocking && guardOf(this.weaponOf(m)) !== null,
      /* Animals leave alone anyone in a boat, down, or in creative. */
      away: m.respawnAt !== null || m.ride !== null || (m.flags & FLAG.creative) !== 0,
    };
  }

  /* Teeth, hooves or tusks: damage, and a shove off your feet. */
  private mauled(id: number, damage: number, dx: number, dz: number) {
    const m = this.members.get(id);
    if (!m) return;
    this.push(m, dx, dz, 6 + damage * 0.2, 3 + damage * 0.08);
    this.hurt(m, damage, "animal");
  }

  /*
   * Damage from any source (`by` is whoever dealt it, if anyone). At zero you
   * black out, and wake up somewhere safe.
   */
  private hurt(m: Member, amount: number, cause: HurtCause, by: Fighter | null = null) {
    if (m.respawnAt !== null || amount <= 0) return;
    /* Nothing hurts you in creative. */
    if (m.flags & FLAG.creative) return;
    m.health = Math.max(0, m.health - amount);
    m.lastHurtAt = this.now();
    m.peer.send({ t: "hurt", amount: Math.round(amount), cause });
    if (m.health > 0) return;
    m.respawnAt = this.now() + RESPAWN_DELAY;
    if (m.ride) {
      this.unseat(m);
      m.peer.send({ t: "aboard", id: null, seat: 0 });
    }
    m.blocking = false;
    m.charging = false;
    m.bleed = null;
    const name = by ? this.nameOf(by) : null;
    m.peer.send({ t: "died", cause, by: name });
    if (name) this.feed(`${m.name} was knocked out by ${name}`);
  }

  /*
   * Sat in a car gone under the sea: a few seconds' breath, then it hurts
   * each second until you get out, or black out.
   */
  private tickDrown(m: Member, now: number) {
    const r = m.ride ? this.rides.get(m.ride.id) : null;
    const under =
      !!r && VEHICLES[r.kind].class === "car" && eyeOf(r.kind, r.state, m.ride!.seat).y < SEA_LEVEL;
    if (!under) {
      m.underSince = null;
      return;
    }
    if (m.underSince === null) {
      m.underSince = now;
      m.drownAt = now + DROWN_BREATH;
      m.peer.send({ t: "feed", text: "Your car is going under: get out (E) and swim for it" });
      return;
    }
    if (now < m.drownAt) return;
    m.drownAt = now + 1;
    this.hurt(m, DROWN_DAMAGE, "drown");
  }

  /* Hitting the ground hard hurts; landing in water doesn't. */
  private landing(m: Member, vy: number, flags: number) {
    /* In creative (or coming down from it) no fall counts. */
    if (flags & FLAG.creative) {
      m.airVy = 0;
      return;
    }
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
    const s = this.home(m.profile);
    m.body = createBody(s.x, s.y, s.z, s.yaw);
    m.respawnAt = null;
    m.health = HEALTH_MAX;
    m.airVy = 0;
    m.stagger = 0;
    m.blocking = false;
    m.charging = false;
    m.bleed = null;
    /* Woken at home: whatever raid you were on is over. */
    this.endRaid(m);
    m.peer.send({ t: "respawn", ...s });
  }

  /* ---------- weapons ---------- */

  /* On the Harbor: common ground, where nobody comes to harm. */
  private sheltered(m: Fighter) {
    return !!this.harbor?.contains(m.body.x, m.body.z);
  }

  /*
   * Whether `by` can hurt `o` at all: not on the Harbor, nobody in creative,
   * and never your own side (a player and his crew).
   */
  private canHarm(by: Fighter, o: Fighter) {
    if (this.sideOf(by) === this.sideOf(o)) return false;
    return !this.sheltered(o) && !((by.flags | o.flags) & FLAG.creative);
  }

  /* A player or a crewman, by id. */
  private fighter(id: number): Fighter | null {
    return id >= CREW_ID_BASE ? this.crew.get(id) : (this.members.get(id) ?? null);
  }

  /* Whose side someone's on: a player's own, a crewman's master's. */
  private sideOf(f: Fighter) {
    return isCrew(f) ? f.owner : (f.profile?.token ?? `#${f.id}`);
  }

  private nameOf(f: Fighter) {
    if (!isCrew(f)) return f.name;
    const master = this.profiles.get(f.owner)?.name;
    return master ? `${f.hand.name} (${master}'s crew)` : f.hand.name;
  }

  /* What they hold: a player's weapon in hand, or what his master gave a crewman. */
  private wielded(f: Fighter) {
    return isCrew(f) ? f.hand.weapon : this.weaponOf(f);
  }

  private tell(f: Fighter, text: string) {
    if (!isCrew(f)) f.peer.send({ t: "feed", text });
  }

  /* A blow's damage on anyone: a player's health, or a crewman's (and his master hears if he's down). */
  private harm(o: Fighter, amount: number, by: Fighter | null) {
    if (!isCrew(o)) return this.hurt(o, amount, "hit", by);
    if (!this.crew.hurt(o, amount, this.now())) return;
    const master = this.masterOf(o.owner);
    master?.peer.send({
      t: "feed",
      text: `${o.hand.name} was knocked out${by ? ` by ${this.nameOf(by)}` : ""} · he'll come to at your Hearth`,
    });
  }

  /* A bleed runs out a second at a time; the Harbor staunches it. */
  private tickBleed(m: Fighter, now: number) {
    const b = m.bleed;
    if (!b || now < b.nextAt) return;
    if (this.sheltered(m)) {
      m.bleed = null;
      return;
    }
    const tick = Math.min(b.per, b.left);
    b.left -= tick;
    b.nextAt += 1;
    if (b.left <= 0.01) m.bleed = null;
    this.harm(m, tick, this.fighter(b.by));
  }

  /*
   * What one blow does in health before any block: the weapon's own damage,
   * wound up by a charge or a combo, and sharpened from behind or in the water.
   */
  private damageOf(def: WeaponDef, p: PendingHit, behind: boolean, wet: boolean) {
    let damage = def.damage;
    if (def.charged !== undefined) damage += (def.charged - def.damage) * p.power;
    if (p.heavy && def.combo) damage = def.combo;
    if (behind && def.backstab) damage *= def.backstab;
    if (wet && def.wet) damage *= def.wet;
    return damage;
  }

  private attack(m: Member, charge: number, aim?: [number, number, number]) {
    const now = this.now();
    const kind = this.weaponOf(m);
    const def = weaponDef(kind);
    /* Hands on the wheel, the reins or the oars; a passenger can still shoot, or throw. */
    const free = !m.ride || (m.ride.seat > 0 && (!!def.ranged || !!def.throws));
    if (now < m.attackReadyAt || m.blocking || !free) return;
    if (kind && (def.ranged || def.throws)) {
      m.attackReadyAt = now + def.cooldown;
      m.charging = false;
      this.loose(m, kind, def, charge, aim);
      return;
    }
    m.attackReadyAt = now + def.cooldown;
    m.shoveFlagUntil = now + 0.35;
    m.charging = false;

    let heavy = false;
    if (def.combo) {
      m.combo = now - m.lastSwingAt < COMBO_WINDOW ? m.combo + 1 : 1;
      if (m.combo >= 3) {
        heavy = true;
        m.combo = 0;
      }
    }
    m.lastSwingAt = now;
    this.broadcast({ t: "swing", by: m.id, kind, heavy });
    this.pending.push({
      at: now + def.windup,
      by: m.id,
      kind,
      heavy,
      power: chargePower(def, charge),
      yaw: m.body.yaw,
    });
  }

  private push(o: Fighter, ix: number, iz: number, speed: number, lift: number) {
    if (isCrew(o)) this.crew.push(o, ix * speed, lift, iz * speed);
    else o.peer.send({ t: "impulse", vx: ix * speed, vy: lift, vz: iz * speed });
  }

  private resolveHits(now: number) {
    if (!this.pending.length) return;
    const due = this.pending.filter((p) => p.at <= now);
    if (!due.length) return;
    this.pending = this.pending.filter((p) => p.at > now);
    for (const p of due) {
      const m = this.fighter(p.by);
      if (!m || m.respawnAt !== null || (isCrew(m) && m.ride)) continue;
      const def = weaponDef(p.kind);
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      /* Crews leave the wild animals be. */
      if (!isCrew(m)) this.hitAnimals(m, p, now);
      this.hitItems(m, p, def, now);
      const near: Fighter[] = this.crew.near(m.body.x, m.body.z, def.reach + 1);
      for (const o of this.members.values())
        if (this.present(o) && o.respawnAt === null) near.push(o);
      for (const o of near) {
        /* A crew's blows pass their own side by, and their master's pass them. */
        if (o === m || ((isCrew(m) || isCrew(o)) && this.sideOf(m) === this.sideOf(o))) continue;
        const dx = o.body.x - m.body.x;
        const dz = o.body.z - m.body.z;
        const d = Math.hypot(dx, dz);
        if (d > def.reach + 0.35 || Math.abs(o.body.y - m.body.y) > 2.2) continue;
        const nx = dx / (d || 1);
        const nz = dz / (d || 1);
        if (def.arc > -1 && d > 0.7 && nx * fx + nz * fz < def.arc) continue;
        this.strike(m, o, p, def, nx, nz, fx, fz, now);
      }
    }
  }

  /* One blow landing on one person: block, damage, stagger, then the shove (or the hook). */
  private strike(
    m: Fighter,
    o: Fighter,
    p: PendingHit,
    def: WeaponDef,
    nx: number,
    nz: number,
    fx: number,
    fz: number,
    now: number,
  ) {
    let added = def.stagger;
    let knock = def.knock;
    let lift = def.lift;
    if (p.heavy) {
      added = 16;
      knock = 13;
      lift = 7;
    }
    if (def.charged !== undefined) {
      const wound = 0.7 + 0.6 * p.power;
      added *= wound;
      knock *= wound;
      lift *= wound;
    }
    /* Which way the victim faces: away from us means a blow in the back. */
    const facingAway = -Math.sin(o.body.yaw) * nx + -Math.cos(o.body.yaw) * nz;
    const behind = facingAway > 0.45;
    if (def.backstab && behind) added *= 3;
    let damage = this.damageOf(def, p, behind, (o.flags & FLAG.wet) !== 0);

    let blocked = false;
    let parry = false;
    /* A raised shield catches blows from as far round as it covers. */
    const shield = this.wielded(o);
    const guard = o.blocking ? guardOf(shield) : null;
    if (guard && -facingAway > guard.cover) {
      blocked = true;
      parry = now - o.blockSince < guard.parry;
      if (def.sunders && !guard.firm) {
        added *= 0.5;
        knock *= 0.5;
        lift *= 0.5;
        damage *= 0.5;
      } else {
        added *= guard.leak;
        knock *= 0.2 + guard.leak;
        lift *= guard.leak;
        damage *= guard.leak;
      }
      /* Spikes on the face: striking it costs the striker. */
      if (guard.thorns && this.canHarm(o, m)) this.harm(m, guard.thorns, o);
      if (parry) {
        m.stagger = Math.min(STAGGER_MAX, m.stagger + 15);
        m.lastHitAt = now;
        this.push(m, -nx, -nz, 8 * knockScale(m.stagger), 3);
        this.broadcast({
          t: "hit",
          by: o.id,
          target: m.id,
          kind: shield,
          stagger: Math.round(m.stagger),
          added: 15,
          damage: 0,
          blocked: false,
          parry: true,
          heavy: false,
        });
      }
    }

    const harm = this.canHarm(m, o);
    if (!harm) damage = 0;
    else {
      /* Their sides fall out: each one's crew goes for the other. */
      this.crew.feud(this.sideOf(m), o.id, now);
      this.crew.feud(this.sideOf(o), m.id, now);
    }
    o.stagger = Math.min(STAGGER_MAX, o.stagger + added);
    if (added > 0 || damage > 0) o.lastHitAt = now;

    if (def.pull && !blocked) {
      /* Hooked: drawn in toward the swing, not thrown away from it. */
      this.push(o, -nx, -nz, def.pull * (1 + o.stagger / 300), lift);
    } else {
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
    }

    this.broadcast({
      t: "hit",
      by: m.id,
      target: o.id,
      kind: p.kind,
      stagger: Math.round(o.stagger),
      added: Math.round(added),
      damage: Math.round(damage),
      blocked,
      parry,
      heavy: p.heavy,
    });

    if (damage <= 0) return;
    if (def.daze) {
      if (isCrew(o)) this.crew.daze(o, def.daze, now);
      else o.peer.send({ t: "daze", seconds: def.daze });
    }
    if (def.bleed)
      o.bleed = { left: def.bleed, per: def.bleed / BLEED_TIME, nextAt: now + 1, by: m.id };
    this.harm(o, damage, m);
  }

  private hitAnimals(m: Member, p: PendingHit, now: number) {
    const def = weaponDef(p.kind);
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    if (!this.herd) return;
    for (const a of this.herd.animals) {
      if (a.respawnAt !== null || a.state === "dead") continue;
      const dx = a.x - m.body.x;
      const dz = a.z - m.body.z;
      const d = Math.hypot(dx, dz);
      const size = a.alpha ? 1.7 : 1;
      if (d > def.reach + 0.7 * size || Math.abs(a.y + 0.6 * size - m.body.y) > 2.4 * size)
        continue;
      if (def.arc > -1 && d > 0.9 && (dx * fx + dz * fz) / d < def.arc - 0.15) continue;
      this.hitAnimal(m, p, def, a, now);
    }
  }

  private hitAnimal(m: Member, p: PendingHit, def: WeaponDef, a: Animal, now: number) {
    if (!this.herd) return;
    const dx = a.x - m.body.x;
    const dz = a.z - m.body.z;
    const d = Math.hypot(dx, dz);
    /* An animal facing away takes it in the back. */
    const behind = (-Math.sin(a.yaw) * dx + -Math.cos(a.yaw) * dz) / (d || 1) > 0.4;
    const damage = this.damageOf(def, p, behind, false) + (def.bleed ?? 0);
    const dead = this.herd.strike(a, this.asPrey(m), damage, now);
    if (dead) this.killed(m, a);
    this.broadcast({
      t: "ahit",
      id: a.id,
      kind: a.species,
      by: m.id,
      damage: Math.round(damage),
      dead,
    });
  }

  /* A kill: the carcass goes in your pack, and the board hears of it. */
  private killed(m: Member, a: Animal) {
    this.addItem(m, a.species);
    const hunt = this.board.alpha;
    if (a.alpha && hunt && !hunt.slainBy) this.alphaSlain(m, hunt);
    const cull = this.board.cull;
    if (a.cull !== null && cull && cull.id === a.cull && cull.state === "active")
      this.cullKill(m, cull);
  }

  /* ---------- shots ---------- */

  /* Who's letting fly, as the shot keeps them. */
  private shooterOf(f: Fighter): Shooter {
    return {
      by: f.id,
      side: this.sideOf(f),
      token: isCrew(f) ? f.owner : (f.profile?.token ?? null),
      creative: (f.flags & FLAG.creative) !== 0,
      plot: null,
      item: null,
      ride: f.ride?.id ?? null,
    };
  }

  /*
   * Which way someone's aiming: what their client says (the line from their
   * eyes to whatever's under the crosshair), as long as it's roughly the way
   * they face; otherwise straight down their gaze.
   */
  private aimOf(m: Member, aim?: [number, number, number]) {
    const yaw = m.body.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (aim) {
      const len = Math.hypot(aim[0], aim[1], aim[2]);
      if (len > 0.01) {
        const d = { x: aim[0] / len, y: aim[1] / len, z: aim[2] / len };
        const flat = Math.hypot(d.x, d.z);
        if (flat < 0.05 || (d.x * fx + d.z * fz) / flat > 0.3) return d;
      }
    }
    const p = clamp(m.pitch, -1.5, 1.5);
    return { x: fx * Math.cos(p), y: Math.sin(p), z: fz * Math.cos(p) };
  }

  /*
   * A bow, a crossbow, or a throw. An arrow leaves from your eyes, as fast
   * and as hard as the draw allows; a keg or a smoke bomb is lobbed from
   * your hand (looking down, a keg is only set at your feet), and one is
   * gone from the stack.
   */
  private loose(
    m: Member,
    kind: WeaponKind,
    def: WeaponDef,
    charge: number,
    aim?: [number, number, number],
  ) {
    const dir = this.aimOf(m, aim);
    const b = m.body;
    const from = { x: b.x + dir.x * 0.4, y: b.y + EYE_HEIGHT - 0.08, z: b.z + dir.z * 0.4 };
    if (def.ranged) {
      const r = def.ranged;
      const power = def.charge ? chargePower(def, charge) : 1;
      const speed = lerp(r.speed[0], r.speed[1], power);
      const damage = lerp(r.damage[0], r.damage[1], power);
      const v = this.spread(dir, r.spread, speed);
      this.broadcast({ t: "swing", by: m.id, kind, heavy: false });
      this.shots.fire(r.shot, from, v, this.shooterOf(m), {
        damage,
        siege: damage * def.siege,
        hull: damage * 0.4,
        daze: def.daze ?? 0,
      });
      return;
    }
    const throws = def.throws;
    const tool = heldTool(m.inv);
    if (!throws || !tool) return;
    if (kind === "keg" && this.sheltered(m)) {
      this.tell(m, "Not on the Harbor: it's common ground");
      return;
    }
    /* Thrown a little above where you look; looking down, only set down. */
    const pitch = Math.asin(clamp(dir.y, -1, 1));
    const gentle = clamp((pitch + 1) / 1.1, 0.12, 1);
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const up = Math.min(1.2, pitch + 0.3);
    const speed = throws.speed * gentle;
    const v = {
      x: (dir.x / flat) * Math.cos(up) * speed,
      y: Math.sin(up) * speed,
      z: (dir.z / flat) * Math.cos(up) * speed,
    };
    const hand = { x: b.x + (dir.x / flat) * 0.5, y: b.y + 1.35, z: b.z + (dir.z / flat) * 0.5 };
    if (!this.shots.fire(throws.shot, hand, v, this.shooterOf(m))) return;
    this.broadcast({ t: "swing", by: m.id, kind, heavy: false });
    if (--tool.uses <= 0) this.removeTool(m, tool.id);
    m.invDirty = true;
  }

  /* A direction, knocked a little off true, at this speed. */
  private spread(dir: { x: number; y: number; z: number }, by: number, speed: number) {
    const yaw = Math.atan2(dir.x, dir.z) + (this.rng() - 0.5) * 2 * by;
    const up = Math.asin(clamp(dir.y, -1, 1)) + (this.rng() - 0.5) * 2 * by;
    return {
      x: Math.sin(yaw) * Math.cos(up) * speed,
      y: Math.sin(up) * speed,
      z: Math.cos(yaw) * Math.cos(up) * speed,
    };
  }

  /* A crewman's bow: at whatever he's aiming at, leading it a little, not quite true. */
  private crewLoose(c: Crewman, def: WeaponDef) {
    const r = def.ranged;
    const at = c.aim;
    if (!r || !at || !c.hand.weapon) return;
    const b = c.body;
    const from = { x: b.x, y: b.y + EYE_HEIGHT - 0.08, z: b.z };
    const speed = r.speed[1];
    const v = leadAt(from, at, { x: at.vx, z: at.vz }, speed, SHOTS[r.shot].gravity);
    if (!v) return;
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    const dir = { x: v.x / len, y: v.y / len, z: v.z / len };
    this.broadcast({ t: "swing", by: c.id, kind: c.hand.weapon, heavy: false });
    const damage = r.damage[1];
    this.shots.fire(r.shot, from, this.spread(dir, r.spread + 0.012, speed), this.shooterOf(c), {
      damage,
      siege: damage * def.siege,
      hull: damage * 0.4,
      daze: def.daze ?? 0,
    });
  }

  /*
   * At a ship's helm: every gun down one side goes off at once, out square
   * to the hull and raised a little, and that side reloads.
   */
  private broadside(m: Member, side: -1 | 1, lift: number) {
    const r = m.ride ? this.rides.get(m.ride.id) : null;
    if (!r || m.ride?.seat !== 0) return;
    const guns = gunsOf(r.kind);
    const now = this.now();
    const k = side < 0 ? 0 : 1;
    if (!guns || now < r.reload[k]) return;
    r.reload[k] = now + BROADSIDE_RELOAD;
    const def = VEHICLES[r.kind];
    const s = r.state;
    const from = { ...this.shooterOf(m), ride: r.id };
    const e = clamp(lift, -0.05, 0.35);
    const out = Math.atan2(side * Math.cos(s.rot), -side * Math.sin(s.rot));
    const vx = -Math.sin(s.rot) * s.speed;
    const vz = -Math.cos(s.rot) * s.speed;
    for (let i = 0; i < guns; i++) {
      const along = (i / Math.max(1, guns - 1) - 0.5) * def.length * 0.45;
      const at = toWorldFrame(s, side * (def.beam / 2 + 0.2), 1.5, along);
      const a = out + (this.rng() - 0.5) * 0.04;
      const up = e + (this.rng() - 0.5) * 0.03;
      const speed = BROADSIDE_SPEED;
      this.shots.fire(
        "cannonball",
        at,
        {
          x: Math.sin(a) * Math.cos(up) * speed + vx,
          y: Math.sin(up) * speed,
          z: Math.cos(a) * Math.cos(up) * speed + vz,
        },
        from,
      );
    }
  }

  /* What the shots need of the room: who's about to be hit, and the rules for hurting them. */
  private shotHost(): ShotHost {
    const room = this;
    return {
      get world() {
        return room.world;
      },
      get plots() {
        return room.plots;
      },
      bodies: () => this.targets,
      animals: () => this.herd?.animals ?? [],
      hulls: () => this.rides.values(),
      hurtBody: (s, id, amount, push) => {
        const o = this.fighter(id);
        if (!o || o.respawnAt !== null || !this.shotMayHarm(s.from, o)) return 0;
        const now = this.now();
        const by = s.from.by >= 0 ? this.fighter(s.from.by) : null;
        let damage = amount;
        /* A raised shield takes an arrow (or the worst of a blast) as it would a blow. */
        const guard = o.blocking ? guardOf(this.wielded(o)) : null;
        const facing = -Math.sin(o.body.yaw) * push.x + -Math.cos(o.body.yaw) * push.z;
        if (guard && -facing > guard.cover) damage *= guard.leak + (SHOTS[s.kind].blast ? 0.3 : 0);
        if (by) {
          this.crew.feud(this.sideOf(by), o.id, now);
          this.crew.feud(this.sideOf(o), by.id, now);
        }
        o.stagger = Math.min(STAGGER_MAX, o.stagger + amount * 0.4);
        o.lastHitAt = now;
        if (push.speed > 0)
          this.push(o, push.x, push.z, push.speed * knockScale(o.stagger), push.lift);
        if (s.load.daze > 0) {
          if (isCrew(o)) this.crew.daze(o, s.load.daze, now);
          else o.peer.send({ t: "daze", seconds: s.load.daze });
        }
        this.harm(o, damage, by);
        return damage;
      },
      hurtItem: (s, plot, item, amount, at) => this.shotOnItem(s.from, plot, item, amount, at),
      hurtHull: (s, id, amount) => this.batterHull(s.from, id, amount),
      hurtAnimal: (s, a, amount) => {
        const m = this.members.get(s.from.by);
        if (!m || !this.herd || amount <= 0) return 0;
        const dead = this.herd.strike(a, this.asPrey(m), amount, this.now());
        if (dead) this.killed(m, a);
        this.broadcast({
          t: "ahit",
          id: a.id,
          kind: a.species,
          by: m.id,
          damage: Math.round(amount),
          dead,
        });
        return amount;
      },
      ignite: (s, plot, item) => {
        const now = this.now();
        if (s.from.plot !== null || !canDamageItem(s.from, plot, now)) return;
        this.fires.ignite(plot, item, now);
      },
      landed: (s, at) => {
        /* Shooting at someone's land from offshore is raiding it, as much as walking on it is. */
        const m = this.members.get(s.from.by);
        const p = m ? this.plotAt(at.x, at.z) : null;
        if (m && p && this.mayRaid(m, p, this.now())) this.raidFrom(m, p);
      },
      broadcast: (msg) => this.broadcast(msg),
    };
  }

  /*
   * Whether a shot may hurt this person: never on the Harbor, nobody in
   * creative, never your own side; a defense's only its land's raiders.
   */
  private shotMayHarm(from: Shooter, o: Fighter) {
    if (this.sheltered(o) || o.flags & FLAG.creative) return false;
    if (from.plot !== null) return (isCrew(o) ? o.raid : (o.raid?.plot ?? null)) === from.plot;
    return !from.creative && from.side !== this.sideOf(o);
  }

  /* Raiding a plot from afar (a broadside, an arrow): it counts from now, as setting foot on it does. */
  private raidFrom(m: Member, p: SavedPlot) {
    const now = this.now();
    if (m.raid?.plot === p.id) m.raid.lastOn = now;
    else this.startRaid(m, p, now);
  }

  /* A shot (or a blast) on something built: by the same rules as a blow. Defenses never harm what's built. */
  private shotOnItem(
    from: Shooter,
    plot: SavedPlot,
    item: PlacedItem,
    amount: number,
    at: { x: number; y: number; z: number },
  ) {
    if (from.plot !== null) return 0;
    const now = this.now();
    const may = canDamageItem(from, plot, now);
    this.broadcast({
      t: "ihit",
      id: item.id,
      by: from.by,
      x: round2(at.x),
      y: round2(at.y),
      z: round2(at.z),
      damage: may ? Math.round(amount) : 0,
    });
    const by = from.by >= 0 ? this.fighter(from.by) : null;
    if (!may) {
      if (by && from.token !== plot.owner && shielded(plot, now))
        this.tell(by, "This isle is shielded: nothing here can be harmed");
      return 0;
    }
    if (by) {
      this.breakShield(by, now);
      if (!isCrew(by) && from.token) {
        this.crew.siege(from.token, plot.id, item.id, now);
        if (this.mayRaid(by, plot, now)) this.raidFrom(by, plot);
      }
    }
    this.harmItem(plot, item, amount, "hit");
    return amount;
  }

  /*
   * A hull battered: by anyone but its owner's side, never on the Harbor;
   * a defense only batters boats with its land's raiders aboard. At nothing
   * it's wrecked.
   */
  private batterHull(from: Shooter, id: number, amount: number) {
    const r = this.rides.get(id);
    if (!r || amount <= 0 || this.harbor?.contains(r.state.x, r.state.z)) return 0;
    if (from.plot !== null) {
      if (!this.raidsAboard(r).includes(from.plot)) return 0;
    } else {
      if (from.creative) return 0;
      const owner = [...this.members.values()].find((o) => o.vehicle === r.id);
      if (owner && this.sideOf(owner) === from.side) return 0;
      if (r.seats.some((s) => s !== null && s === from.by)) return 0;
    }
    r.hp = Math.max(0, r.hp - amount);
    this.broadcast({ t: "vhp", id, hp: Math.ceil(r.hp), max: hullOf(r.kind) });
    if (r.hp <= 0) this.wreck(r);
    return amount;
  }

  /* The plots anyone aboard (a player or a crewman) is raiding. */
  private raidsAboard(r: Ride) {
    const out: number[] = [];
    for (const id of r.seats) {
      if (id === null) continue;
      const o = this.fighter(id);
      const raid = !o ? null : isCrew(o) ? o.raid : (o.raid?.plot ?? null);
      if (raid !== null && !out.includes(raid)) out.push(raid);
    }
    return out;
  }

  /* Wrecked: everyone aboard goes over the side (a car's spill out), and it's gone. */
  private wreck(r: Ride) {
    this.broadcast({ t: "sunk", id: r.id });
    const name = VEHICLES[r.kind].name.toLowerCase();
    for (const id of r.seats) {
      const o = id === null ? null : this.members.get(id);
      if (!o?.ride) continue;
      const at = exitSpot(r.kind, r.state, this.world, o.ride.seat) ?? {
        x: r.state.x,
        y: r.state.y + 1,
        z: r.state.z,
        yaw: r.state.rot,
      };
      o.ride = null;
      o.flags &= ~FLAG.riding;
      o.body = createBody(at.x, at.y, at.z, at.yaw);
      o.airVy = 0;
      o.peer.send({ t: "aboard", id: null, seat: 0, at });
      o.peer.send({
        t: "feed",
        text: afloat(r.kind) ? `The ${name} went down` : `The ${name} is wrecked`,
      });
    }
    /* Bought once, kept: a wreck only sends it back to the yard, to be spawned again. */
    for (const o of this.members.values())
      if (o.vehicle === r.id)
        o.peer.send({
          t: "feed",
          text: `Still yours: spawn the ${name} again from your arsenal`,
        });
    this.removeRide(r.id);
  }

  /* Everyone a shot could hit this tick: players and crewmen on their feet, riders too. */
  private gatherTargets() {
    const out = this.targets;
    out.length = 0;
    for (const m of this.members.values()) {
      if (!this.present(m) || m.respawnAt !== null) continue;
      const b = m.body;
      out.push({
        id: m.id,
        side: this.sideOf(m),
        x: b.x,
        y: b.y,
        z: b.z,
        raid: m.raid?.plot ?? null,
        seated: !!m.ride,
      });
    }
    for (const c of this.crew.men.values()) {
      if (c.respawnAt !== null) continue;
      const b = c.body;
      out.push({ id: c.id, side: c.owner, x: b.x, y: b.y, z: b.z, raid: c.raid, seated: !!c.ride });
    }
  }

  /* ---------- defenses ---------- */

  private defenseHost(): DefenseHost {
    const room = this;
    return {
      get world() {
        return room.world;
      },
      get plots() {
        return room.plots;
      },
      clouds: () => this.shots.clouds,
      rng: () => this.rng(),
      fire: (plot, item, spec, at, v) => {
        this.shots.fire(
          spec.shot,
          at,
          v,
          {
            by: -1,
            side: plot.owner,
            token: plot.owner,
            creative: false,
            plot: plot.id,
            item: item.id,
            ride: null,
          },
          { damage: spec.damage ?? SHOTS[spec.shot].damage, scale: spec.scale ?? 1 },
        );
      },
    };
  }

  /* The towers and engines: wakened by raiders on their land, and the ships carrying them. */
  private tickDefenses(now: number, dt: number) {
    if (!this.plots.size) return;
    const foes: Foe[] = [];
    for (const m of this.members.values()) {
      if (!m.raid || !this.present(m) || m.respawnAt !== null || m.flags & FLAG.creative) continue;
      const b = m.body;
      const r = m.ride;
      foes.push({
        id: m.id,
        x: b.x,
        y: b.y,
        z: b.z,
        vx: b.vx,
        vz: b.vz,
        raid: m.raid.plot,
        ride: r?.id ?? null,
      });
    }
    for (const c of this.crew.men.values()) {
      if (c.raid === null || c.respawnAt !== null) continue;
      const b = c.body;
      foes.push({
        id: c.id,
        x: b.x,
        y: b.y,
        z: b.z,
        vx: b.vx,
        vz: b.vz,
        raid: c.raid,
        ride: c.ride?.id ?? null,
      });
    }
    const ships: Ship[] = [];
    for (const r of this.rides.values()) {
      const raids = this.raidsAboard(r);
      if (raids.length) ships.push({ id: r.id, kind: r.kind, state: r.state, raids });
    }
    this.defenses.tick(now, dt, foes, ships);
  }

  /* ---------- messages ---------- */

  private roster() {
    return [...this.members.values()]
      .filter((o) => !o.spectator)
      .map((o) => ({ id: o.id, name: o.name, skin: o.skin }));
  }

  private worldInfo(m: Member): WorldInfo {
    return {
      islands: this.world.list().map((o) => this.islandFor(o, m)),
      time: this.time,
      roster: this.roster(),
      board: this.board,
      vehicles: this.vehicleSnaps(),
      items: [...this.plots.values()].map((p) => [p.id, p.items.map((o) => this.snapOf(o))]),
      plots: this.plotStates(this.now()),
      you: this.present(m) ? { x: m.body.x, y: m.body.y, z: m.body.z, yaw: m.body.yaw } : null,
    };
  }

  /* Everyone gets the world afresh: after a jump in time, say. */
  private broadcastWorld() {
    for (const o of this.members.values()) o.peer.send({ t: "world", ...this.worldInfo(o) });
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
      if (!this.present(m)) continue;
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
          (m.charging ? FLAG.charge : 0) |
          (m.raid ? FLAG.raider : 0),
        weaponIndex(this.weaponOf(m)),
        Math.round(m.stagger),
      ]);
    }
    const time = round2(this.time);
    const v = this.vehicleSnaps();
    const turrets = this.defenses.snapshot();
    const cap: CaptureSnap[] = [];
    for (const [id, s] of this.sieges)
      if (s.progress > 0) cap.push([id, round2(s.progress), s.state, s.leader ?? -1]);
    for (const m of this.members.values()) {
      /* Only the animals near you: there are a lot of them out there. */
      const near = this.present(m);
      const view = near ? ANIMAL_VIEW : Number.POSITIVE_INFINITY;
      const a = this.herd ? this.herd.snapshot(m.body.x, m.body.z, view, []) : [];
      m.peer.send({
        t: "snap",
        time,
        p,
        a,
        v,
        cap,
        c: this.crew.snapshot(m.body.x, m.body.z, view, now),
        d: turrets,
        me: !this.present(m)
          ? null
          : {
              health: Math.ceil(m.health),
              stagger: Math.round(m.stagger),
              dead: m.respawnAt !== null,
              water: m.water && this.carried(m) === "bucket",
              raid: m.raid?.plot ?? null,
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
