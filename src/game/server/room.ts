import {
  BOUNDARY,
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
import {
  BOARD_REACH,
  BOARD_REFRESH,
  BOARD_SIZE,
  type Bounty,
  consume,
  isEasy,
  makeBounty,
  progress,
} from "../shared/bounties";
import { BOARD_REACH as BOAT_REACH, DRAFT, SEAT } from "../shared/boat";
import { FEATURES } from "../shared/features";
import {
  BITE_WINDOW,
  depthAt,
  MIN_CAST_DEPTH,
  pickFish,
  type Strike,
  strikeFor,
  struck,
} from "../shared/fishing";
import { clamp, mulberry32, type Rng } from "../shared/math";
import { groundResources, type Resource } from "../shared/resources";
import { randomName } from "../shared/names";
import { type Body, createBody } from "../shared/physics";
import {
  type ClientMsg,
  FLAG,
  type BoatSnap,
  type HurtCause,
  type PlayerSnap,
  round2,
  type ServerMsg,
  type Spawn,
  type TravelTarget,
  type WorldInfo,
} from "../shared/protocol";
import {
  emptyInventory,
  type FishId,
  HOTBAR,
  heldTool,
  type Inventory,
  isKitId,
  type ItemId,
  MAX_TOOLS,
  type Tool,
  type ToolKind,
  TOOLS,
  WEAPON_SLOT,
} from "../shared/items";
import {
  CAMPFIRE_WARMTH,
  checkPlacement,
  MAX_PREFABS,
  type Prefab,
  prefabBlocks,
} from "../shared/prefabs";
import { Archipelago } from "../shared/archipelago";
import { HARBOR, type IslandInfo, placementProblem, type ShapeId } from "../shared/islands";
import {
  type SavedPlayer,
  type SavedProfile,
  WORLD_SAVE_VERSION,
  type WorldSave,
} from "../shared/save";
import { SHOP_REACH, shopEntry } from "../shared/shop";
import { canWear, DEFAULT_SKIN, type SkinId } from "../shared/skins";
import { blockSolid, overSolid, type Terrain } from "../shared/terrain";
import {
  BLEED_TIME,
  COMBO_WINDOW,
  chargePower,
  knockScale,
  PARRY_WINDOW,
  STAGGER_GRACE,
  STAGGER_MAX,
  STAGGER_RECOVER,
  type WeaponDef,
  type WeaponKind,
  weaponDef,
  weaponIndex,
} from "../shared/weapons";

import { Herd, type Prey } from "./animals";

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
  /* Online: who this is across visits, and their island. */
  profile: Profile | null;
  /* In the world with a body. Online, that's once you've settled an island. */
  placed: boolean;
  body: Body;
  pitch: number;
  flags: number;
  health: number;
  lastHurtAt: number;
  /* Falling speed from the last airborne report, for landing damage. */
  airVy: number;
  /* While down: when you get back up. */
  respawnAt: number | null;
  attackReadyAt: number;
  shoveFlagUntil: number;
  inv: Inventory;
  line: Line | null;
  /* The rowboat you're in. */
  boat: number | null;
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
};

/* A line in the water: waiting for a bite, then a fish on, waiting for the strike. */
type Line = {
  x: number;
  z: number;
  depth: number;
  biteAt: number;
  fish: FishId | null;
  strike: Strike | null;
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
   * The game: the grand map, where everyone settles an island of their own.
   * Otherwise (the title screen) there's one island in the middle to look at.
   */
  settle?: boolean;
  /* The grand map as it was left (online). */
  world?: WorldSave | null;
  /* The grand map changed in a way worth keeping: the host should store exportWorld(). */
  onChange?: () => void;
};

/* Points round a body's centre, to test whether it fits somewhere. */
const PROBES = [
  [0, 0],
  [0.4, 0],
  [-0.4, 0],
  [0, 0.4],
  [0, -0.4],
] as const;

/* Seconds after you last hit or were hit before you can fast travel. */
const TRAVEL_CALM = 5;

/*
 * The world. Transport-agnostic: the Cloudflare Durable Object and the Vite dev
 * server run the game with it, and the title screen runs a quiet one in the tab. The room
 * runs the world and everything in it; each human reports their own movement
 * and asks for everything else.
 */
export class Room {
  private members = new Map<number, Member>();
  private nextId = 1;
  private readonly terrain: Terrain;
  private resources = new Map<number, Resource>();
  private collected = new Set<number>();
  private felledTrees = new Set<number>();
  private treeHits = new Map<number, number>();
  private readonly world: Archipelago;
  private readonly seed: number;
  private profiles = new Map<string, Profile>();
  private islandId = 1;
  /* World clock in seconds; it only advances while the room ticks. */
  private time = 0;
  private lastTick: number | null = null;
  /* The Harbor's ground, online: where everyone arrives and nobody gets hurt. */
  private harbor: Terrain | null = null;
  private toolId = 1;
  private pending: PendingHit[] = [];
  /* Animals, when they're switched on. */
  private herd: Herd | null = null;
  /* The bounty board: offers, and when each was posted (world time). */
  private board: Bounty[] = [];
  private posted = new Map<number, number>();
  private prefabs = new Map<number, Prefab>();
  private boatSpeed = new Map<number, number>();
  private prefabId = 1;
  private bountyId = 1;
  private prey: Prey[] = [];
  private rng: Rng;
  private readonly now: () => number;

  constructor(private readonly opts: RoomOptions) {
    this.now = opts.now ?? (() => Date.now() / 1000);
    this.rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
    const save = opts.save ?? null;
    this.seed = save?.seed ?? opts.seed ?? (this.rng() * 2 ** 32) >>> 0;
    this.terrain = new Terrain(this.seed);
    for (const resource of groundResources(this.terrain)) this.resources.set(resource.id, resource);
    const t = this.terrain;
    if (FEATURES.animals)
    this.seed = opts.seed ?? (this.rng() * 2 ** 32) >>> 0;
    this.world = new Archipelago();
    if (opts.settle) {
      /* The Harbor goes in first: it's the primary island, where the shop and herd would be. */
      this.harbor = this.world.add(HARBOR).terrain;
      const w = opts.world;
      if (w) {
        for (const info of w.islands) this.world.add(info);
        for (const p of w.players) this.profiles.set(p.token, structuredClone(p));
        this.islandId = w.ids.island;
        this.toolId = w.ids.tool;
      }
    } else this.world.add({ id: 0, shape: "headland", seed: this.seed, x: 0, z: 0, name: "" });
    const t = this.world.primary;
    if (FEATURES.animals && t)
      this.herd = new Herd(
        {
          terrain: this.world,
          rng: this.rng,
          gore: (id, damage, dx, dz) => this.gored(id, damage, dx, dz),
          blocked: (id) => {
            this.members
              .get(id)
              ?.peer.send({ t: "feed", text: "Your shield turns the boar aside" });
          },
        },
        [
          { x: t.home.x, z: t.home.z, r: 45 },
          { x: t.lighthouse.x, z: t.lighthouse.z, r: 28 },
        ],
      );
    this.fillBoard();
  }

  /* ---------- saving ---------- */

  private restore(save: SaveData) {
    for (const id of save.collected ?? []) if (this.resources.has(id)) this.collected.add(id);
    for (const id of save.felledTrees ?? []) {
      if (this.terrain.props.some((p) => p.id === id && p.kind === "tree")) {
        this.felledTrees.add(id);
        this.terrain.removeTree(id);
      }
    }
    this.time = save.time;
    this.toolId = save.ids.tool;
    this.prefabId = save.ids.prefab;
    this.bountyId = save.ids.bounty;
    for (const p of save.prefabs) this.build(structuredClone(p));
    this.board = save.board.map((b) => structuredClone(b));
    for (const b of this.board) this.posted.set(b.id, this.time);
    this.returning = save.player ? structuredClone(save.player) : null;
  }

  /* The island as it stands, with the first player's things, ready to store. */
  exportSave(): SaveData {
    const m = [...this.members.values()].find((o) => !o.spectator);
    let player: SavedPlayer | null = this.returning;
    if (m) {
      /* Saved while down: you come back on your feet, where you'd have woken. */
      const down = m.respawnAt !== null;
      const at = down ? this.spawnPoint(m) : { ...m.body, yaw: m.body.yaw };
      player = {
        x: round2(at.x),
        y: round2(at.y),
        z: round2(at.z),
        yaw: round2(at.yaw),
        health: down ? HEALTH_MAX : Math.max(1, Math.ceil(m.health)),
        inv: structuredClone(m.inv),
        boat: down ? null : m.boat,
      };
    }
    return {
      v: SAVE_VERSION,
      seed: this.seed,
      time: round2(this.time),
      prefabs: [...this.prefabs.values()].map((p) => structuredClone(p)),
      collected: [...this.collected],
      felledTrees: [...this.felledTrees],
      board: this.board.map((b) => structuredClone(b)),
      player,
      ids: { tool: this.toolId, prefab: this.prefabId, bounty: this.bountyId },
  /* Where someone is and what they carry, ready to store. */
  private playerState(m: Member): SavedPlayer {
    /* Saved while down: you come back on your feet, where you'd have woken. */
    const down = m.respawnAt !== null;
    const at = down ? this.spawnPoint(m) : { ...m.body, yaw: m.body.yaw };
    return {
      x: round2(at.x),
      y: round2(at.y),
      z: round2(at.z),
      yaw: round2(at.yaw),
      health: down ? HEALTH_MAX : Math.max(1, Math.ceil(m.health)),
      inv: structuredClone(m.inv),
      boat: down ? null : m.boat,
    };
  }

  /* Put the saved player back where they were, with everything they had. */
  private welcomeBack(m: Member, saved: SavedPlayer) {
    m.inv = saved.inv;
    /* Weapons are off for now: anything you'd found or bought stays behind. */
    if (!FEATURES.weapons) {
      const keep = m.inv.tools.filter((t) => !TOOLS[t.kind].weapon || t.kind === "axe");
      m.inv.hotbar = m.inv.hotbar.map((id) => (keep.some((t) => t.id === id) ? id : null));
      m.inv.tools = keep;
    }
    /* One weapon at a time, in its own slot: older saves may carry several, anywhere. */
    const weapons = m.inv.tools.filter((t) => TOOLS[t.kind].weapon);
    const kept = weapons[0] ? (TOOLS[weapons[0].kind].weapon as WeaponKind) : null;
    for (const t of weapons) this.removeTool(m, t.id);
    if (kept) this.arm(m, kept, false);
    m.health = saved.health;
    m.invDirty = true;
    const boat = saved.boat === null ? null : this.prefabs.get(saved.boat);
    if (boat?.kind === "rowboat") {
      m.boat = boat.id;
      m.body = createBody(saved.x, SEA_LEVEL + 0.3, saved.z, saved.yaw);
      return;
    }
    /* Never inside something that was built over the spot, or underground. */
    const { ground } = this.world.groundAt(saved.x, saved.z, saved.y + 0.3);
    const inside = this.world
      .solidsNear(saved.x, saved.z)
      .some(
        (o) => o.top > ground + 0.6 && o.bottom < ground + 1.7 && overSolid(o, saved.x, saved.z),
      );
    if (inside) {
      const s = this.spawnPoint(m);
      m.body = createBody(s.x, s.y, s.z, s.yaw);
    } else m.body = createBody(saved.x, Math.max(saved.y, ground), saved.z, saved.yaw);
  }

  humans() {
    let n = 0;
    for (const m of this.members.values()) if (!m.spectator) n++;
    return n;
  }

  /* In the world with a body: not just watching, and (online) settled. */
  private present(m: Member) {
    return !m.spectator && m.placed;
  }

  /*
   * Who's arriving, by the token they bring. A token this tab owns takes over
   * a connection still holding it (the tab was reloaded); one borrowed from
   * another tab that's still connected gets a new identity instead, so two
   * tabs in one browser are two players.
   */
  private claim(token: string | undefined, own: boolean): Profile {
    const known = token ? this.profiles.get(token) : undefined;
    if (known) {
      const using = [...this.members.values()].find((o) => o.profile === known);
      if (!using) return known;
      if (own) {
        this.leave(using.id);
        using.peer.close?.();
        return known;
      }
    }
    const fresh: Profile = {
      token: token && !known ? token : crypto.randomUUID(),
      name: randomName(Math.random),
      island: null,
      saved: null,
    };
    this.profiles.set(fresh.token, fresh);
    return fresh;
  }

  join(
    peer: Peer,
    hello: {
      spectate?: boolean;
      token?: string;
      own?: boolean;
      skin?: SkinId;
      weapon?: WeaponKind | null;
    } = {},
  ) {
    const spectator = !!hello.spectate;
    const profile = this.opts.settle && !spectator ? this.claim(hello.token, !!hello.own) : null;
    if (!spectator && this.humans() >= (this.opts.maxHumans ?? MAX_PLAYERS)) {
      peer.send({ t: "full" });
      return -1;
    }
    const id = this.nextId++;
    /* Everyone arrives with a body: on their own island, or on the Harbor. */
    const placed = !spectator;
    const h = this.homeFor(profile);
    /* The browser's choice wins: you may have changed skins on the title screen. */
    const skin = hello.skin && canWear(hello.skin) ? hello.skin : (profile?.skin ?? DEFAULT_SKIN);
    if (profile) profile.skin = skin;
    const member: Member = {
      id,
      name: profile?.name ?? randomName(Math.random),
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
      respawnAt: null,
      attackReadyAt: 0,
      shoveFlagUntil: 0,
      inv: emptyInventory(),
      line: null,
      boat: null,
      invDirty: true,
      stagger: 0,
      lastHitAt: 0,
      combo: 0,
      lastSwingAt: 0,
      blocking: false,
      blockSince: 0,
      charging: false,
      bleed: null,
    };
    if (placed && profile?.saved) {
      this.welcomeBack(member, profile.saved);
      profile.saved = null;
    } else if (!spectator) this.giveTool(member, "rod", WEAPON_SLOT + 1);
    /* The browser's choice of weapon wins, as with skins. */
    if (placed && hello.weapon !== undefined && hello.weapon !== this.carried(member))
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
    if (member.boat !== null) peer.send({ t: "aboard", boat: member.boat });
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
    /* Online, your island keeps your place: you come back where you left off. */
    if (m.profile && m.placed) {
      m.profile.saved = this.playerState(m);
      /* A rowboat may have been taken apart by the time you're back. */
      m.profile.saved.boat = null;
      this.opts.onChange?.();
    }
    m.boat = null;
    this.members.delete(id);
    if (!m.spectator) {
      this.broadcastRoster();
      if (this.opts.online) this.feed(`${m.name} left`);
    }
  }

  handle(id: number, msg: ClientMsg) {
    const m = this.members.get(id);
    if (!m || m.spectator) return;
    if (msg.t === "settle") {
      this.settle(m, msg.shape, msg.seed, msg.x, msg.z);
      return;
    }
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

  /* Put a new island on the map for someone who hasn't got one, and take them to it. */
  private settle(m: Member, shape: ShapeId, seed: number, x: number, z: number) {
    const p = m.profile;
    if (!p || p.island !== null) {
      m.peer.send({ t: "unsettled", reason: "You already have an island" });
      return;
    }
    const at = { x: round2(x), z: round2(z) };
    const problem = placementProblem(this.world.list(), at.x, at.z);
    if (problem) {
      m.peer.send({ t: "unsettled", reason: problem });
      return;
    }
    const info: IslandInfo = { id: this.islandId++, shape, seed: seed >>> 0, ...at, name: m.name };
    this.world.add(info);
    p.island = info.id;
    this.broadcast({ t: "island", island: info });
    m.peer.send({ t: "world", ...this.worldInfo(m) });
    /* Down or not, you wake on your new land. */
    if (m.respawnAt !== null) this.respawn(m);
    else this.warp(m, this.homeFor(p));
    this.feed(`${m.name} settled a new island`);
    this.opts.onChange?.();
  }

  /* Move someone in one step: out of any boat, line reeled in, nothing still hurting. */
  private warp(m: Member, s: Spawn) {
    this.reelIn(m);
    if (m.boat !== null) {
      m.boat = null;
      m.peer.send({ t: "aboard", boat: null });
    }
    m.body = createBody(s.x, s.y, s.z, s.yaw);
    m.airVy = 0;
    m.stagger = 0;
    m.bleed = null;
    m.blocking = false;
    m.charging = false;
    m.peer.send({ t: "warp", ...s });
  }

  /* Fast travel between the Harbor and your own island, but not in the middle of a fight. */
  private travel(m: Member, to: TravelTarget) {
    if (!this.harbor) return;
    const now = this.now();
    if (now - Math.max(m.lastHurtAt, m.lastHitAt, m.lastSwingAt) < TRAVEL_CALM) {
      m.peer.send({ t: "feed", text: "Catch your breath first: you can't travel mid-fight" });
      return;
    }
    if (to === "home" && m.profile?.island == null) {
      m.peer.send({ t: "feed", text: "You haven't settled an island of your own yet" });
      return;
    }
    const h = this.harbor.home;
    this.warp(
      m,
      to === "harbor" ? { x: h.x, y: h.y, z: h.z, yaw: h.yaw } : this.homeFor(m.profile),
    );
  }

  /* Where someone wakes up with no bed: on their own island, or the Harbor (the only one, offline). */
  private homeFor(p: Profile | null): Spawn {
    const own = p?.island == null ? null : this.world.islands.get(p.island)?.terrain;
    const h = (own ?? this.world.primary)?.home ?? { x: 0, y: 0, z: 0, yaw: 0 };
    return { x: h.x, y: h.y, z: h.z, yaw: h.yaw };
  }

  private keptState(m: Member): SavedPlayer {
    const state = this.playerState(m);
    state.boat = null;
    return state;
  }

  /* The grand map and everyone who's been on it, ready to store. */
  exportWorld(): WorldSave {
    const live = new Map<Profile, Member>();
    for (const m of this.members.values()) if (m.profile && m.placed) live.set(m.profile, m);
    return {
      v: WORLD_SAVE_VERSION,
      /* The Harbor is always raised afresh, never stored. */
      islands: this.world.list().filter((o) => !o.harbor),
      players: [...this.profiles.values()].map((p) => {
        const m = live.get(p);
        return {
          ...structuredClone(p),
          saved: m ? this.keptState(m) : p.saved,
        };
      }),
      ids: { island: this.islandId, tool: this.toolId },
    };
  }

  private apply(m: Member, msg: ClientMsg) {
    switch (msg.t) {
      case "gather": {
        const resource = this.resources.get(msg.id);
        if (
          !resource ||
          this.collected.has(msg.id) ||
          Math.hypot(resource.x - m.body.x, resource.z - m.body.z) > 3 ||
          Math.abs(resource.y - m.body.y) > 2
        )
          return;
        this.collected.add(msg.id);
        if (resource.kind === "bush") {
          this.addItem(m, "stick", 2);
          this.addItem(m, "dry_fiber", 1);
        } else this.addItem(m, "stone", 1);
        this.broadcast({ t: "gathered", id: msg.id });
        m.peer.send({
          t: "feed",
          text: resource.kind === "bush" ? "+2 sticks, +1 dry fiber" : "+1 stone",
        });
        this.saveSoon = true;
        return;
      }
      case "craft_axe": {
        if (
          (m.inv.items.stick ?? 0) < 2 ||
          (m.inv.items.stone ?? 0) < 2 ||
          (m.inv.items.dry_fiber ?? 0) < 1
        )
          return;
        if (!this.giveTool(m, "axe", 1)) {
          m.peer.send({ t: "feed", text: "Your tool pack is full" });
          return;
        }
        this.addItem(m, "stick", -2);
        this.addItem(m, "stone", -2);
        this.addItem(m, "dry_fiber", -1);
        m.peer.send({ t: "feed", text: "Stone axe crafted" });
        this.saveSoon = true;
        return;
      }
      case "craft_boat": {
        if ((m.inv.items.wood ?? 0) < 8 || (m.inv.items.dry_fiber ?? 0) < 4) return;
        this.addItem(m, "wood", -8);
        this.addItem(m, "dry_fiber", -4);
        this.addItem(m, "rowboat");
        m.peer.send({ t: "feed", text: "Rowboat crafted · press B to place it on water" });
        this.saveSoon = true;
        return;
      }
      case "move": {
        this.landing(m, msg.vy, msg.flags);
        if (m.boat !== null) this.row(m, msg.x, msg.z, msg.boat);
        m.body.yaw = msg.yaw;
        m.pitch = msg.pitch;
        m.body.x = clamp(msg.x, -BOUNDARY, BOUNDARY);
        const creative = (msg.flags & FLAG.creative) !== 0;
        m.body.y = clamp(msg.y, SEA_FLOOR - 20, creative ? FLY_CEILING + 5 : this.world.peak + 30);
        m.body.z = clamp(msg.z, -BOUNDARY, BOUNDARY);
        m.body.vx = msg.vx;
        m.body.vy = msg.vy;
        m.body.vz = msg.vz;
        m.flags = msg.flags & (FLAG.sprint | FLAG.grounded | FLAG.wet | FLAG.fly | FLAG.creative);
        return;
      }
      case "attack":
        this.attack(m, msg.charge);
        return;
      case "travel":
        this.travel(m, msg.to);
        return;
      case "stance": {
        const weapon = this.weaponOf(m);
        const block = msg.block && weapon === "shield";
        if (block && !m.blocking) m.blockSince = this.now();
        m.blocking = block;
        m.charging = msg.charge && !!weapon && !!weaponDef(weapon).charge;
        return;
      }
      case "buy":
        this.buy(m, msg.item);
        return;
      case "place":
        this.place(m, msg.kind, msg.x, msg.z, msg.rot);
        return;
      case "pickup":
        this.pickupPrefab(m, msg.id);
        return;
      case "stash":
        this.stash(m, msg.chest, msg.item, msg.n);
        return;
      case "accept":
        this.accept(m, msg.id);
        return;
      case "turnin":
        this.turnIn(m);
        return;
      case "abandon":
        if (m.inv.bounty) {
          m.inv.bounty = null;
          m.invDirty = true;
        }
        return;
      case "cast":
        this.cast(m, msg.x, msg.z);
        return;
      case "reel":
        this.reel(m, msg.at);
        return;
      case "slot":
        if (m.inv.slot !== msg.i) {
          this.reelIn(m);
          m.inv.slot = msg.i;
          m.blocking = false;
          m.charging = false;
          m.invDirty = true;
        }
        return;
      case "equip":
        this.equip(m, msg.tool, msg.slot);
        return;
      case "equip_item":
        this.equipItem(m, msg.item, msg.slot);
        return;
      case "drop":
        this.drop(m, msg.tool);
        return;
      case "interact":
        this.usePrefab(m, msg.id);
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

  /* The one weapon you carry, in hand or not. */
  private carried(m: Member) {
    const tool = m.inv.tools.find((t) => TOOLS[t.kind].weapon);
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
    let slot = bar[prefer] == null && m.inv.itemHotbar[prefer] == null ? prefer : -1;
    for (let i = 1; i < HOTBAR && slot < 0; i++)
      if (bar[i] == null && m.inv.itemHotbar[i] == null) slot = i;
    if (slot > 0) bar[slot] = tool.id;
    m.invDirty = true;
    return tool;
  }

  private removeTool(m: Member, id: number) {
    if (heldTool(m.inv)?.id === id) this.reelIn(m);
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
      const itemThere = inv.itemHotbar[slot];
      if (from > 0) inv.hotbar[from] = there;
      if (from > 0) inv.itemHotbar[from] = itemThere;
      inv.hotbar[slot] = toolId;
      inv.itemHotbar[slot] = null;
    }
    if (heldTool(inv)?.id !== held) this.reelIn(m);
    m.blocking = false;
    m.charging = false;
    m.invDirty = true;
  }

  private equipItem(m: Member, item: ItemId, slot: number) {
    const inv = m.inv;
    if (!inv.items[item] || slot === 0) return;
    const from = inv.itemHotbar.indexOf(item);
    if (slot < 0) {
      if (from > 0) inv.itemHotbar[from] = null;
    } else {
      const tool = inv.hotbar[slot];
      const other = inv.itemHotbar[slot];
      if (from > 0) {
        inv.hotbar[from] = tool;
        inv.itemHotbar[from] = other;
      }
      inv.hotbar[slot] = null;
      inv.itemHotbar[slot] = item;
    }
    this.reelIn(m);
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
  /*
   * Take up a weapon from the marketplace: it replaces whatever you carried,
   * goes in the weapon slot, and into your hand. Null puts it away for fists.
   */
  private arm(m: Member, kind: WeaponKind | null, announce: boolean) {
    const had = this.carried(m);
    for (const t of m.inv.tools.filter((o) => TOOLS[o.kind].weapon)) this.removeTool(m, t.id);
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
    m.inv.slot = WEAPON_SLOT;
    m.attackReadyAt = Math.max(m.attackReadyAt, this.now() + 0.3);
    if (announce && had !== kind)
      m.peer.send({ t: "feed", text: `You take up the ${weaponDef(kind).name.toLowerCase()}` });
  }

  addItem(m: Member, id: ItemId, n = 1) {
    m.inv.items[id] = Math.max(0, (m.inv.items[id] ?? 0) + n);
    if (!m.inv.items[id]) {
      delete m.inv.items[id];
      m.inv.itemHotbar = m.inv.itemHotbar.map((item) => (item === id ? null : item));
    } else if (n > 0 && !m.inv.itemHotbar.includes(id)) {
      const slot = m.inv.hotbar.findIndex(
        (tool, index) => index > 0 && tool === null && m.inv.itemHotbar[index] === null,
      );
      if (slot > 0) m.inv.itemHotbar[slot] = id;
    }
    m.invDirty = true;
  }

  /* ---------- shop and building ---------- */

  private buy(m: Member, id: string) {
    const entry = shopEntry(id);
    const s = this.world.primary?.shop;
    const near =
      !!s &&
      Math.hypot(s.x - m.body.x, s.z - m.body.z) < SHOP_REACH &&
      Math.abs(s.y - m.body.y) < 3;
    if (!FEATURES.shop || !entry || !near || m.inv.coins < entry.price) return;
    if ("tool" in entry.give) {
      if (!this.giveTool(m, entry.give.tool, 1)) {
        m.peer.send({ t: "feed", text: "Your pack is full" });
        return;
      }
    } else this.addItem(m, entry.give.kit);
    m.inv.coins -= entry.price;
    m.invDirty = true;
  }

  private build(p: Prefab) {
    this.prefabs.set(p.id, p);
    const solids = prefabBlocks(p)
      .filter((b) => b.solid)
      .map(blockSolid);
    if (solids.length) this.world.addSolids(p.id, solids);
  }

  private place(m: Member, kind: Prefab["kind"], x: number, z: number, rot: number) {
    if (!isKitId(kind) || (m.inv.items[kind] ?? 0) < 1) return;
    if (this.prefabs.size >= MAX_PREFABS) {
      m.peer.send({ t: "feed", text: "The island can't hold any more" });
      return;
    }
    const v = checkPlacement(this.world, kind, x, z, rot, m.body);
    if (!v.ok) return;
    const p: Prefab = {
      id: this.prefabId++,
      kind,
      x: round2(x),
      y: round2(v.y),
      z: round2(z),
      rot: round2(rot),
    };
    if (kind === "chest") p.store = {};
    this.build(p);
    this.addItem(m, kind, -1);
    if (kind === "bed") m.inv.bed = p.id;
    this.broadcast({ t: "prefab", prefab: p });
  }

  /* Take something you built back into your pack, with whatever was in it. */
  private pickupPrefab(m: Member, id: number) {
    const p = this.prefabs.get(id);
    if (!p || Math.hypot(p.x - m.body.x, p.z - m.body.z) > 14 || this.aboard(id)) return;
    this.prefabs.delete(id);
    this.world.removeSolids(id);
    this.addItem(m, p.kind, 1);
    for (const [item, n] of Object.entries(p.store ?? {}) as [ItemId, number][])
      this.addItem(m, item, n);
    for (const o of this.members.values()) {
      if (o.inv.bed === id) {
        o.inv.bed = null;
        o.invDirty = true;
      }
    }
    this.broadcast({ t: "unprefab", id });
  }

  private usePrefab(m: Member, id: number) {
    const p = this.prefabs.get(id);
    if (!p) return;
    if (p.kind === "rowboat") {
      this.boatInteract(m, p);
      return;
    }
    if (Math.hypot(p.x - m.body.x, p.z - m.body.z) > 4) return;
    if (p.kind === "bed") this.sleep(m, p);
  }

  /* ---------- boats ---------- */

  private aboard(id: number) {
    for (const o of this.members.values()) if (o.boat === id) return o;
    return null;
  }

  private boatInteract(m: Member, p: Prefab) {
    if (m.boat === p.id) {
      m.boat = null;
      m.peer.send({ t: "aboard", boat: null });
      return;
    }
    if (m.boat !== null || this.aboard(p.id)) return;
    if (Math.hypot(p.x - m.body.x, p.z - m.body.z) > BOAT_REACH + 1) return;
    this.reelIn(m);
    m.boat = p.id;
    m.peer.send({ t: "aboard", boat: p.id });
  }

  /*
   * The rower says where they are; the boat goes with them, as long as that's
   * a plausible step over water.
   */
  private row(m: Member, x: number, z: number, b: { rot: number; speed: number } | undefined) {
    const p = m.boat === null ? null : this.prefabs.get(m.boat);
    if (!p || !b) return;
    /* They sit aft of the middle. */
    const cx = x - SEAT.lz * Math.sin(b.rot);
    const cz = z - SEAT.lz * Math.cos(b.rot);
    const step = Math.hypot(cx - p.x, cz - p.z);
    if (step > 4 || this.world.heightAt(cx, cz) > SEA_LEVEL - DRAFT + 0.2) return;
    p.x = round2(cx);
    p.z = round2(cz);
    p.rot = round2(b.rot);
    this.boatSpeed.set(p.id, b.speed);
  }

  /* A bed is where you wake from now on. */
  private sleep(m: Member, bed: Prefab) {
    m.inv.bed = bed.id;
    m.invDirty = true;
    m.peer.send({ t: "feed", text: "You'll wake here from now on" });
  }

  private stash(m: Member, chestId: number, item: ItemId, n: number) {
    const chest = this.prefabs.get(chestId);
    if (!chest?.store || Math.hypot(chest.x - m.body.x, chest.z - m.body.z) > 4) return;
    const store = chest.store;
    const amount = n > 0 ? Math.min(n, m.inv.items[item] ?? 0) : -Math.min(-n, store[item] ?? 0);
    if (!amount) return;
    this.addItem(m, item, -amount);
    store[item] = (store[item] ?? 0) + amount;
    if (!store[item]) delete store[item];
    this.broadcast({ t: "prefab", prefab: chest });
  }

  private nearCampfire(m: Member) {
    for (const p of this.prefabs.values()) {
      if (p.kind !== "campfire") continue;
      if (
        Math.hypot(p.x - m.body.x, p.z - m.body.z) < CAMPFIRE_WARMTH &&
        Math.abs(p.y - m.body.y) < 3
      )
        return true;
    }
    return false;
  }

  /* ---------- bounties ---------- */

  private nearBoard(m: Member) {
    const b = this.world.primary?.board;
    if (!b) return false;
    return Math.hypot(b.x - m.body.x, b.z - m.body.z) < BOARD_REACH && Math.abs(b.y - m.body.y) < 3;
  }

  /* Top the board up to its full set of offers. Returns true if anything changed. */
  private fillBoard() {
    if (!FEATURES.bounties) return false;
    let changed = false;
    while (this.board.length < BOARD_SIZE) {
      const held = [...this.members.values()].map((m) => m.inv.bounty).filter((b) => !!b);
      const easy = !this.board.some(isEasy);
      const b = makeBounty(this.rng, this.bountyId++, [...this.board, ...held], easy);
      this.board.push(b);
      this.posted.set(b.id, this.time);
      changed = true;
    }
    return changed;
  }

  private postBoard() {
    this.broadcast({ t: "board", offers: this.board });
  }

  /* Offers nobody takes come down after a while, and new ones go up. */
  private refreshBoard() {
    const stale = this.board.find((b) => this.time - (this.posted.get(b.id) ?? 0) > BOARD_REFRESH);
    if (!stale) return;
    this.board = this.board.filter((b) => b !== stale);
    this.posted.delete(stale.id);
    this.fillBoard();
    this.postBoard();
  }

  private accept(m: Member, id: number) {
    const offer = this.board.find((b) => b.id === id);
    if (!FEATURES.bounties || !offer || m.inv.bounty || !this.nearBoard(m)) return;
    this.board = this.board.filter((b) => b !== offer);
    this.posted.delete(offer.id);
    m.inv.bounty = offer;
    m.invDirty = true;
    this.fillBoard();
    this.postBoard();
  }

  private turnIn(m: Member) {
    const b = m.inv.bounty;
    if (!FEATURES.bounties || !b || !this.nearBoard(m) || progress(m.inv, b) < b.count) return;
    consume(m.inv, b);
    m.inv.coins += b.reward;
    m.inv.bounty = null;
    m.invDirty = true;
    m.peer.send({ t: "paid", bounty: b });
  }

  /* ---------- fishing ---------- */

  private rodOf(m: Member) {
    const tool = heldTool(m.inv);
    return tool ? (TOOLS[tool.kind].rod ?? null) : null;
  }

  private cast(m: Member, x: number, z: number) {
    const rod = this.rodOf(m);
    if (!rod || m.line) return;
    const reach = Math.hypot(x - m.body.x, z - m.body.z);
    const depth = depthAt(this.world.heightAt(x, z));
    /* Standing (or sitting) above the water, casting a fair distance into enough of it. */
    if (reach > rod.cast + 1.5 || reach < 1.5 || depth < MIN_CAST_DEPTH) return;
    if (SEA_LEVEL - m.body.y > 1.2) return;
    const [lo, hi] = rod.bite;
    m.line = {
      x,
      z,
      depth,
      biteAt: this.now() + lo + this.rng() * (hi - lo),
      fish: null,
      strike: null,
    };
    this.broadcast({ t: "line", by: m.id, x: round2(x), z: round2(z), state: "cast" });
  }

  /* Pull the line out without a fish. */
  private reelIn(m: Member) {
    if (!m.line) return;
    const { x, z } = m.line;
    m.line = null;
    this.broadcast({ t: "line", by: m.id, x: round2(x), z: round2(z), state: "none" });
  }

  /* Strike. A miss, or striking before anything bites, loses the fish. */
  private reel(m: Member, at: number) {
    const line = m.line;
    if (!line) return;
    if (!line.fish || !line.strike) {
      this.reelIn(m);
      return;
    }
    /*
     * Trust the angler's own timing, within reason: not earlier than we've
     * seen, and inside the window. (A throttled tab can leave our clock behind.)
     */
    const elapsed = this.now() - line.biteAt;
    const t = at >= elapsed - 0.5 && at <= BITE_WINDOW ? at : elapsed;
    const fish = struck(line.strike, t) ? line.fish : null;
    this.land(m, fish);
  }

  private land(m: Member, fish: FishId | null) {
    const line = m.line;
    if (!line) return;
    m.line = null;
    if (fish) {
      this.addItem(m, fish);
    }
    this.broadcast({ t: "line", by: m.id, x: round2(line.x), z: round2(line.z), state: "none" });
    this.broadcast({ t: "catch", by: m.id, fish });
  }

  private tickLine(m: Member, now: number) {
    const line = m.line;
    if (!line) return;
    const rod = this.rodOf(m);
    const far = Math.hypot(line.x - m.body.x, line.z - m.body.z) > (rod?.cast ?? 0) + 5;
    if (!rod || far) {
      this.reelIn(m);
      return;
    }
    if (!line.fish && now >= line.biteAt) {
      line.fish = pickFish(this.rng, line.depth, rod);
      line.strike = strikeFor(this.rng, line.fish, rod);
      line.biteAt = now;
      m.peer.send({ t: "bite", ...line.strike });
      this.broadcast({ t: "line", by: m.id, x: round2(line.x), z: round2(line.z), state: "bite" });
    } else if (line.fish && now - line.biteAt > BITE_WINDOW) {
      this.land(m, null);
    }
  }

  private flush(m: Member) {
    if (!m.invDirty) return;
    m.inv.itemHotbar = m.inv.itemHotbar.map((item) => (item && m.inv.items[item] ? item : null));
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
    this.herd?.tick(now, dt, this.preyList());

    for (const m of this.members.values()) {
      if (!this.present(m)) continue;
      if (m.respawnAt !== null) {
        if (now >= m.respawnAt) this.respawn(m);
        continue;
      }

      if (m.health < HEALTH_MAX) {
        /* A campfire warms you back quickly; otherwise it takes a while. */
        const warm = this.nearCampfire(m);
        const quiet = now - m.lastHurtAt;
        if (warm && quiet > 2) m.health = Math.min(HEALTH_MAX, m.health + HEALTH_REGEN * 4 * dt);
        else if (quiet > REGEN_DELAY) m.health = Math.min(HEALTH_MAX, m.health + HEALTH_REGEN * dt);
      }

      this.tickLine(m, now);
      this.tickBleed(m, now);

      /* Stagger wears off a few seconds after the last hit. */
      if (now - m.lastHitAt > STAGGER_GRACE)
        m.stagger = Math.max(0, m.stagger - STAGGER_RECOVER * dt);

      /* The sea is safe now; only a glitch through the floor sends you home, unhurt. */
      if (m.body.y < SEA_FLOOR - 8) this.respawn(m);
    }

    this.refreshBoard();
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
      blocking: m.blocking && this.weaponOf(m) === "shield",
      /* Boars leave alone anyone in a boat, down, or in creative. */
      away: m.respawnAt !== null || m.boat !== null || (m.flags & FLAG.creative) !== 0,
    };
  }

  /* A boar's tusks: damage, and a shove off your feet. */
  private gored(id: number, damage: number, dx: number, dz: number) {
    const m = this.members.get(id);
    if (!m) return;
    this.push(m, dx, dz, 9, 4.5);
    this.hurt(m, damage, "boar");
  }

  /* Beside your bed if you have one, otherwise where everyone first wakes up. */
  private spawnPoint(m: Member): Spawn {
    const bed = m.inv.bed === null ? null : this.prefabs.get(m.inv.bed);
    if (bed) {
      const c = Math.cos(bed.rot);
      const s = Math.sin(bed.rot);
      for (const side of [1, -1]) {
        const x = bed.x + side * 0.95 * c;
        const z = bed.z - side * 0.95 * s;
        const { ground } = this.world.groundAt(x, z, bed.y + 0.3);
        const blocked = this.world
          .solidsNear(x, z)
          .some(
            (o) =>
              o.top > ground + 0.6 &&
              o.bottom < ground + 1.7 &&
              PROBES.some(([px, pz]) => overSolid(o, x + px, z + pz)),
          );
        if (!blocked) return { x, y: ground, z, yaw: bed.rot };
      }
      return { x: bed.x, y: bed.y + 0.45, z: bed.z, yaw: bed.rot };
    }
    return this.homeFor(m.profile);
  }

  /*
   * Damage from any source (`by` is whoever dealt it, if anyone). At zero you
   * black out, and wake up somewhere safe.
   */
  private hurt(m: Member, amount: number, cause: HurtCause, by: Member | null = null) {
    if (m.respawnAt !== null || amount <= 0) return;
    /* Nothing hurts you in creative. */
    if (m.flags & FLAG.creative) return;
    m.health = Math.max(0, m.health - amount);
    m.lastHurtAt = this.now();
    m.peer.send({ t: "hurt", amount: Math.round(amount), cause });
    if (m.health > 0) return;
    m.respawnAt = this.now() + RESPAWN_DELAY;
    this.reelIn(m);
    if (m.boat !== null) {
      m.boat = null;
      m.peer.send({ t: "aboard", boat: null });
    }
    m.blocking = false;
    m.charging = false;
    m.bleed = null;
    m.peer.send({ t: "died", cause, by: by?.name ?? null });
    if (by) this.feed(`${m.name} was knocked out by ${by.name}`);
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
    const s = this.spawnPoint(m);
    m.body = createBody(s.x, s.y, s.z, s.yaw);
    m.respawnAt = null;
    m.health = HEALTH_MAX;
    m.airVy = 0;
    m.stagger = 0;
    m.blocking = false;
    m.charging = false;
    m.bleed = null;
    m.peer.send({ t: "respawn", ...s });
  }

  /* ---------- weapons ---------- */

  /* On the Harbor: common ground, where nobody comes to harm. */
  private sheltered(m: Member) {
    return !!this.harbor?.contains(m.body.x, m.body.z);
  }

  /* Whether `by` can hurt `o` at all: not on the Harbor, and nobody in creative. */
  private canHarm(by: Member, o: Member) {
    return !this.sheltered(o) && !((by.flags | o.flags) & FLAG.creative);
  }

  /* A sickle's bleed runs out a second at a time; the Harbor staunches it. */
  private tickBleed(m: Member, now: number) {
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
    this.hurt(m, tick, "hit", this.members.get(b.by) ?? null);
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

  private attack(m: Member, charge: number) {
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
    if (def.combo) {
      m.combo = now - m.lastSwingAt < COMBO_WINDOW ? m.combo + 1 : 1;
      if (m.combo >= 3) {
        heavy = true;
        m.combo = 0;
      }
    }
    m.lastSwingAt = now;
    this.broadcast({ t: "swing", by: m.id, kind, heavy });
    if (kind === "axe") this.chopTree(m);
    /* A pickaxe swung at a wall is a climb, not an attack. */
    if (climb && kind === "pickaxe") return;
    const fine = !!tool && !!TOOLS[tool.kind].fine;
    this.pending.push({
      at: now + def.windup,
      by: m.id,
      kind,
      heavy,
      power: chargePower(def, charge),
      yaw: m.body.yaw,
    });
  }

  private chopTree(m: Member) {
    const fx = -Math.sin(m.body.yaw);
    const fz = -Math.cos(m.body.yaw);
    const tree = this.terrain.props
      .filter((p) => p.kind === "tree" && !this.felledTrees.has(p.id))
      .map((p) => ({ p, dx: p.x - m.body.x, dz: p.z - m.body.z }))
      .filter(({ p, dx, dz }) => {
        const distance = Math.hypot(dx, dz);
        return (
          distance <= 2.8 &&
          Math.abs(p.y - m.body.y) < 2.5 &&
          (distance < 0.5 || (dx * fx + dz * fz) / distance > 0.65)
        );
      })
      .sort((a, b) => Math.hypot(a.dx, a.dz) - Math.hypot(b.dx, b.dz))[0]?.p;
    if (!tree) return;
    const hits = (this.treeHits.get(tree.id) ?? 0) + 1;
    if (hits < 3) {
      this.treeHits.set(tree.id, hits);
      m.peer.send({ t: "feed", text: `Tree chopped ${hits}/3` });
      return;
    }
    this.treeHits.delete(tree.id);
    this.felledTrees.add(tree.id);
    this.terrain.removeTree(tree.id);
    this.addItem(m, "wood", 4);
    this.broadcast({ t: "tree_felled", id: tree.id });
    m.peer.send({ t: "feed", text: "+4 wood" });
    this.saveSoon = true;
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
      if (!m || m.respawnAt !== null) continue;
      const def = weaponDef(p.kind);
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      this.hitAnimals(m, p, now);
      for (const o of this.members.values()) {
        if (o === m || !this.present(o) || o.respawnAt !== null) continue;
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
    m: Member,
    o: Member,
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
    if (o.blocking && this.weaponOf(o) === "shield" && -facingAway > 0.2) {
      blocked = true;
      parry = now - o.blockSince < PARRY_WINDOW;
      if (def.sunders) {
        added *= 0.5;
        knock *= 0.5;
        lift *= 0.5;
        damage *= 0.5;
      } else {
        added = 0;
        knock *= 0.2;
        lift = 0;
        damage = 0;
      }
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
          damage: 0,
          blocked: false,
          parry: true,
          heavy: false,
        });
      }
    }

    const harm = this.canHarm(m, o);
    if (!harm) damage = 0;
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
    if (def.daze) o.peer.send({ t: "daze", seconds: def.daze });
    if (def.bleed)
      o.bleed = { left: def.bleed, per: def.bleed / BLEED_TIME, nextAt: now + 1, by: m.id };
    this.hurt(o, damage, "hit", m);
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
      if (d > def.reach + 0.7 || Math.abs(a.y + 0.6 - m.body.y) > 2.4) continue;
      if (def.arc > -1 && d > 0.9 && (dx * fx + dz * fz) / d < def.arc - 0.15) continue;
      /* An animal facing away takes it in the back. */
      const behind = (-Math.sin(a.yaw) * dx + -Math.cos(a.yaw) * dz) / (d || 1) > 0.4;
      const damage = this.damageOf(def, p, behind, false) + (def.bleed ?? 0);
      const dead = this.herd.strike(a, this.asPrey(m), damage, now);
      if (dead) {
        this.addItem(m, a.kind);
      }
      this.broadcast({
        t: "ahit",
        id: a.id,
        kind: a.kind,
        by: m.id,
        damage: Math.round(damage),
        dead,
      });
    }
  }

  /* ---------- messages ---------- */

  private roster() {
    return [...this.members.values()]
      .filter((o) => !o.spectator)
      .map((o) => ({ id: o.id, name: o.name, skin: o.skin }));
  }

  private worldInfo(m: Member): WorldInfo {
    return {
      islands: this.world.list(),
      mine: m.spectator ? null : m.profile ? m.profile.island : (this.world.list()[0]?.id ?? null),
      time: this.time,
      roster: this.roster(),
      board: this.board,
      prefabs: [...this.prefabs.values()],
      collected: [...this.collected],
      felledTrees: [...this.felledTrees],
      you: m.spectator ? null : { x: m.body.x, y: m.body.y, z: m.body.z, yaw: m.body.yaw },
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
          (m.charging ? FLAG.charge : 0),
        weaponIndex(this.weaponOf(m)),
        Math.round(m.stagger),
      ]);
    }
    const time = round2(this.time);
    const a = this.herd?.snapshot() ?? [];
    const b: BoatSnap[] = [];
    for (const p of this.prefabs.values()) {
      if (p.kind === "rowboat")
        b.push([
          p.id,
          p.x,
          p.z,
          p.rot,
          round2(this.aboard(p.id) ? (this.boatSpeed.get(p.id) ?? 0) : 0),
        ]);
    }
    for (const m of this.members.values()) {
      m.peer.send({
        t: "snap",
        time,
        p,
        a,
        b,
        me: !this.present(m)
          ? null
          : {
              health: Math.ceil(m.health),
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
