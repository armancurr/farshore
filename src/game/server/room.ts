import {
  BASE_CELL,
  BASE_TILE,
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
import { BOARD_REACH as BOAT_REACH, DRAFT, SEAT } from "../shared/boat";
import { FEATURES } from "../shared/features";
import { clamp, mulberry32, type Rng } from "../shared/math";
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
  BIKE_SEAT,
  bikeExit,
  bikeGround,
  bikeSolid,
  createBike,
  stepBike,
  type BikeIntent,
  type BikeState,
} from "../shared/bike";
import { type Body, createBody } from "../shared/physics";
import {
  type ClientMsg,
  FLAG,
  type BoatSnap,
  type BikeSnap,
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
  isKitId,
  type ItemId,
  MAX_TOOLS,
  type Tool,
  type ToolKind,
  TOOLS,
  WEAPON_SLOT,
} from "../shared/items";
import {
  BUILD_REACH,
  CAMPFIRE_WARMTH,
  checkPlacement,
  MAX_PREFABS,
  type Prefab,
  prefabBlocks,
} from "../shared/prefabs";
import { Archipelago } from "../shared/archipelago";
import { HARBOR_ID, WORLD } from "../shared/islands";
import {
  type SavedPlayer,
  type SavedProfile,
  WORLD_SAVE_VERSION,
  type WorldSave,
} from "../shared/save";
import { SHOP_REACH, shopEntry } from "../shared/shop";
import { canWear, DEFAULT_SKIN, type SkinId } from "../shared/skins";
import {
  ALPHAS,
  BIOME_HERDS,
  CULLS,
  GROUP,
  HARBOR_HERD,
  SPECIES,
  type SpeciesId,
} from "../shared/species";
import { VEHICLES, type VehicleKind } from "../shared/vehicles";
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

import { type Animal, Herd, type Prey } from "./animals";

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
  /* While down: when you get back up. */
  respawnAt: number | null;
  attackReadyAt: number;
  shoveFlagUntil: number;
  inv: Inventory;
  /* The rowboat you're in. */
  boat: number | null;
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
};

/* Points round a body's centre, to test whether it fits somewhere. */
const PROBES = [
  [0, 0],
  [0.4, 0],
  [-0.4, 0],
  [0, 0.4],
  [0, -0.4],
] as const;

/* How far from you a vehicle from the marketplace may be launched, in metres. */
const LAUNCH_RANGE = 32;
/* How far round each player the animals are sent: a little past what fog lets you see. */
const ANIMAL_VIEW = 320;

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
  private prefabs = new Map<number, Prefab>();
  private boatSpeed = new Map<number, number>();
  private bikes = new Map<number, BikeState>();
  private bikeInputs = new Map<number, { input: BikeIntent; at: number }>();
  /* Prefabs that came from the marketplace rather than out of someone's pack. */
  private spawned = new Set<number>();
  private prefabId = 1;
  private missionId = 1;
  private prey: Prey[] = [];
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
      /* In herds and packs: the first of each group anywhere, the rest close by it. */
      for (const [species, n] of Object.entries(counts) as [SpeciesId, number][]) {
        const [lo, hi] = GROUP[species];
        for (let left = n; left > 0; ) {
          const size = Math.min(left, lo + Math.floor(this.rng() * (hi - lo + 1)));
          const lead = herd.spawn(species, info.id);
          for (let i = 1; i < size && lead; i++) herd.spawn(species, info.id, [], { near: lead });
          left -= size;
        }
      }
    }
    this.herd = herd;
  }

  /* ---------- saving ---------- */

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
    /* One weapon at a time, in its own slot: older saves may carry several, anywhere. */
    const weapons = m.inv.tools.filter((t) => TOOLS[t.kind].weapon);
    const kept = weapons[0] ? (TOOLS[weapons[0].kind].weapon as WeaponKind) : null;
    for (const t of weapons) this.removeTool(m, t.id);
    if (kept) this.arm(m, kept, false);
    m.health = saved.health;
    m.invDirty = true;
    /* The map changed under them: back to the Harbor, with everything they had. */
    if (saved.relocate) {
      const h = this.spawnPoint(m);
      m.body = createBody(h.x, h.y, h.z, h.yaw);
      return;
    }
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
    /* Everyone arrives with a body, on the Harbor. */
    const placed = !spectator;
    const h = this.home();
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
      respawnAt: null,
      attackReadyAt: 0,
      shoveFlagUntil: 0,
      inv: emptyInventory(),
      boat: null,
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
    };
    if (placed && profile?.saved) {
      this.welcomeBack(member, profile.saved);
      profile.saved = null;
    }
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
    /* Online, the map keeps your place: you come back where you left off. */
    if (m.profile && m.placed) {
      m.profile.saved = this.playerState(m);
      /* A rowboat may have been taken apart by the time you're back. */
      m.profile.saved.boat = null;
      this.opts.onChange?.();
    }
    m.boat = null;
    this.despawn(m);
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

  /* Where someone wakes up with no bed: the Harbor (the only island, on the title screen). */
  private home(): Spawn {
    const h = (this.harbor ?? this.world.primary)?.home ?? { x: 0, y: 0, z: 0, yaw: 0 };
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
      players: [...this.profiles.values()].map((p) => {
        const m = live.get(p);
        return {
          ...structuredClone(p),
          saved: m ? this.keptState(m) : p.saved,
        };
      }),
      ids: { tool: this.toolId },
    };
  }

  private apply(m: Member, msg: ClientMsg) {
    switch (msg.t) {
      case "move": {
        // A rider sends controls, never an authoritative vehicle transform.
        if (m.boat !== null && this.bikes.has(m.boat)) {
          this.bikeInputs.set(m.boat, {
            input: msg.drive ?? { forward: 0, right: 0, brake: true },
            at: this.now(),
          });
          m.pitch = msg.pitch;
          return;
        }
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
      case "spawn":
        this.spawnVehicle(m, msg.kind);
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
    if (!m.inv.items[id]) delete m.inv.items[id];
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
    if (p.kind === "desertbike") {
      const bike = createBike(p.x, p.y, p.z, p.rot);
      const ground = bikeGround(this.world, p.x, p.z, p.rot);
      if (ground) Object.assign(bike, ground);
      this.bikes.set(p.id, bike);
      this.world.addSolids(p.id, [bikeSolid(bike)]);
    }
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
    this.bikes.delete(id);
    this.bikeInputs.delete(id);
    this.world.removeSolids(id);
    /* A vehicle from the marketplace just goes: there's always another to spawn. */
    if (this.spawned.delete(id)) {
      for (const o of this.members.values()) if (o.vehicle === id) o.vehicle = null;
    } else this.addItem(m, p.kind, 1);
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
    if (p.kind === "desertbike") {
      this.bikeInteract(m, p);
      return;
    }
    if (p.kind === "rowboat") {
      this.boatInteract(m, p);
      return;
    }
    if (Math.hypot(p.x - m.body.x, p.z - m.body.z) > 4) return;
    if (p.kind === "bed") this.sleep(m, p);
  }

  /* ---------- vehicles ---------- */

  /* A vehicle from the marketplace, afloat near you. The one you spawned before goes. */
  private spawnVehicle(m: Member, kind: VehicleKind) {
    if (m.boat !== null) {
      m.peer.send({ t: "feed", text: "Get off your vehicle before spawning another" });
      return;
    }
    const at = this.launchSpot(m, kind);
    if (!at) {
      m.peer.send({
        t: "feed",
        text:
          kind === "desertbike"
            ? "Find clear, dry, fairly level ground for the bike"
            : "Head down to the water to launch it",
      });
      return;
    }
    this.despawn(m);
    if (this.prefabs.size >= MAX_PREFABS) {
      m.peer.send({ t: "feed", text: "The island can't hold any more" });
      return;
    }
    const p: Prefab = {
      id: this.prefabId++,
      kind,
      x: round2(at.x),
      y: round2(at.y),
      z: round2(at.z),
      rot: round2(at.rot),
    };
    this.build(p);
    this.spawned.add(p.id);
    m.vehicle = p.id;
    this.broadcast({ t: "prefab", prefab: p });
    m.peer.send({
      t: "feed",
      text:
        kind === "desertbike"
          ? "Your desert bike is ready · approach and press E to ride"
          : `Your ${VEHICLES[kind].name.toLowerCase()} is in the water`,
    });
  }

  /*
   * Open water near you, deep enough to float in and clear of other boats,
   * bow pointing away from you. Straight ahead wins: the whole range in
   * front is searched before turning aside, and the sides before behind,
   * so a puddle at your heels never beats the sea you're looking at.
   */
  private launchSpot(m: Member, kind: VehicleKind) {
    const { x: px, z: pz, yaw } = m.body;
    /* Bearings off straight ahead, in widening fans: ahead, then the sides, then behind. */
    const fans = [
      [0, 1, -1],
      [2, -2, 3, -3],
      [4, -4, 5, -5, 6, -6, 7, -7, 8],
    ];
    for (const fan of fans)
      for (let r = 3; r <= LAUNCH_RANGE; r += 1.5) {
        for (const k of fan) {
          const a = yaw + k * (Math.PI / 8);
          const x = px - Math.sin(a) * r;
          const z = pz - Math.cos(a) * r;
          if (Math.abs(x) > BOUNDARY - 4 || Math.abs(z) > BOUNDARY - 4) continue;
          let crowded = false;
          for (const p of this.prefabs.values()) {
            /* Your own last one makes way, unless someone has rowed off in it. */
            const going = p.id === m.vehicle && !this.aboard(p.id);
            if (
              (p.kind === "rowboat" || p.kind === "desertbike") &&
              !going &&
              Math.hypot(p.x - x, p.z - z) < 4.5
            )
              crowded = true;
          }
          if (crowded) continue;
          /* A bike wants clear, dry ground rather than water. */
          if (kind === "desertbike") {
            const ground = bikeGround(this.world, x, z, a);
            if (ground) return { x, y: ground.y, z, rot: a };
            continue;
          }
          /*
           * Placement measures reach from the body, and keeps the hull off it.
           * The reach here is ours to judge, so a spot beyond it is measured
           * from a stand-in just within reach, on the line back to you. It
           * never stands on the spot itself: that always reads as "on top of
           * you", which is why boats used to refuse to launch near the water,
           * or turned up wherever happened to pass.
           */
          const near = BUILD_REACH - 1;
          const stand =
            r <= near
              ? m.body
              : { ...m.body, x: x + Math.sin(a) * near, z: z + Math.cos(a) * near };
          const v = checkPlacement(this.world, kind, x, z, a, stand);
          if (v.ok) return { x, y: v.y, z, rot: a };
        }
      }
    return null;
  }

  /* Take back the vehicle you spawned, unless someone is sitting in it. */
  private despawn(m: Member) {
    const id = m.vehicle;
    m.vehicle = null;
    if (id === null || !this.prefabs.has(id) || this.aboard(id)) return;
    this.prefabs.delete(id);
    this.spawned.delete(id);
    this.boatSpeed.delete(id);
    this.bikes.delete(id);
    this.bikeInputs.delete(id);
    this.world.removeSolids(id);
    this.broadcast({ t: "unprefab", id });
  }

  /* ---------- boats ---------- */

  private bikeInteract(m: Member, p: Prefab) {
    const bike = this.bikes.get(p.id);
    if (!bike) return;
    if (m.boat === p.id) {
      if (Math.hypot(bike.speed, bike.slipX ?? 0, bike.slipZ ?? 0) > 1.5) {
        m.peer.send({ t: "feed", text: "Brake before getting off the bike" });
        return;
      }
      const exit = bikeExit(bike, this.world);
      if (!exit) {
        m.peer.send({ t: "feed", text: "Move to a clear spot before getting off" });
        return;
      }
      bike.speed = 0;
      bike.slipX = bike.slipZ = 0;
      this.bikeInputs.delete(p.id);
      m.boat = null;
      m.body = createBody(exit.x, exit.y, exit.z, exit.yaw);
      m.peer.send({ t: "aboard", boat: null });
      m.peer.send({ t: "respawn", ...exit });
      return;
    }
    if (
      m.boat !== null ||
      this.aboard(p.id) ||
      Math.hypot(p.x - m.body.x, p.z - m.body.z) > 3.6 ||
      Math.abs(p.y - m.body.y) > 2
    )
      return;
    this.bikeInputs.delete(p.id);
    m.boat = p.id;
    m.airVy = 0;
    m.body = createBody(bike.x, bike.y + BIKE_SEAT, bike.z, bike.rot);
    m.peer.send({ t: "aboard", boat: p.id });
  }

  private tickBikes(now: number, dt: number) {
    for (const [id, bike] of this.bikes) {
      const rider = this.aboard(id);
      const controls = this.bikeInputs.get(id);
      if (
        !rider &&
        Math.hypot(bike.speed, bike.slipX ?? 0, bike.slipZ ?? 0, bike.verticalSpeed ?? 0) < 0.01
      )
        continue;
      const input =
        rider && rider.respawnAt === null && controls && now - controls.at < 0.3
          ? controls.input
          : { forward: 0, right: 0, brake: true };
      this.world.removeSolids(id); // Ignore only this bike's own hull.
      stepBike(bike, input, dt, this.world);
      this.world.addSolids(id, [bikeSolid(bike)]);
      const p = this.prefabs.get(id);
      if (p) {
        p.x = bike.x;
        p.y = bike.y;
        p.z = bike.z;
        p.rot = bike.rot;
      }
      if (rider) {
        Object.assign(rider.body, {
          x: bike.x,
          y: bike.y + BIKE_SEAT,
          z: bike.z,
          yaw: bike.rot,
          vx: -Math.sin(bike.rot) * bike.speed + (bike.slipX ?? 0),
          vy: 0,
          vz: -Math.cos(bike.rot) * bike.speed + (bike.slipZ ?? 0),
          grounded: true,
        });
        rider.flags = FLAG.grounded | FLAG.riding | (rider.flags & FLAG.creative);
      }
    }
  }

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
    if (step > 6 || this.world.heightAt(cx, cz) > SEA_LEVEL - DRAFT + 0.2) return;
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
    for (const m of this.members.values()) this.flush(m);
    this.broadcastSnap(now);
  }

  private simulate(now: number, dt: number) {
    this.tickBikes(now, dt);
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

      this.tickBleed(m, now);

      /* Stagger wears off a few seconds after the last hit. */
      if (now - m.lastHitAt > STAGGER_GRACE)
        m.stagger = Math.max(0, m.stagger - STAGGER_RECOVER * dt);

      /* The sea is safe now; only a glitch through the floor sends you home, unhurt. */
      if (m.body.y < SEA_FLOOR - 8) this.respawn(m);
    }

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
      blocking: m.blocking && this.weaponOf(m) === "shield",
      /* Animals leave alone anyone in a boat, down, or in creative. */
      away: m.respawnAt !== null || m.boat !== null || (m.flags & FLAG.creative) !== 0,
    };
  }

  /* Teeth, hooves or tusks: damage, and a shove off your feet. */
  private mauled(id: number, damage: number, dx: number, dz: number) {
    const m = this.members.get(id);
    if (!m) return;
    this.push(m, dx, dz, 6 + damage * 0.2, 3 + damage * 0.08);
    this.hurt(m, damage, "animal");
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
    return this.home();
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
    this.pending.push({
      at: now + def.windup,
      by: m.id,
      kind,
      heavy,
      power: chargePower(def, charge),
      yaw: m.body.yaw,
    });
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
      const size = a.alpha ? 1.7 : 1;
      if (d > def.reach + 0.7 * size || Math.abs(a.y + 0.6 * size - m.body.y) > 2.4 * size)
        continue;
      if (def.arc > -1 && d > 0.9 && (dx * fx + dz * fz) / d < def.arc - 0.15) continue;
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

  /* ---------- messages ---------- */

  private roster() {
    return [...this.members.values()]
      .filter((o) => !o.spectator)
      .map((o) => ({ id: o.id, name: o.name, skin: o.skin }));
  }

  private worldInfo(m: Member): WorldInfo {
    return {
      islands: this.world.list(),
      time: this.time,
      roster: this.roster(),
      board: this.board,
      prefabs: [...this.prefabs.values()],
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
    const b: BoatSnap[] = [];
    const bikes: BikeSnap[] = [...this.bikes].map(([id, bike]) => [
      id,
      round2(bike.x),
      round2(bike.y),
      round2(bike.z),
      round2(bike.rot),
      round2(bike.speed),
      round2(bike.steer),
      round2(bike.pitch),
      round2(bike.roll),
    ]);
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
      /* Only the animals near you: there are a lot of them out there. */
      const near = this.present(m);
      const a = this.herd
        ? this.herd.snapshot(m.body.x, m.body.z, near ? ANIMAL_VIEW : Number.POSITIVE_INFINITY, [])
        : [];
      m.peer.send({
        t: "snap",
        time,
        p,
        a,
        b,
        bikes,
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
