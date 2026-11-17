import * as THREE from "three";
import {
  EYE_HEIGHT,
  FLY_BOOST,
  HEALTH_MAX,
  SEA_LEVEL,
  STAMINA_MAX,
  TICK_HZ,
} from "../shared/constants";
import { BOARD_REACH as BOAT_REACH, type BoatState, seatOf, stepBoat } from "../shared/boat";
import { BOARD_REACH, type Bounty, bountyNote, bountyTitle, progress } from "../shared/bounties";
import { FEATURES } from "../shared/features";
import {
  BITE_TEXT,
  depthAt,
  MIN_CAST_DEPTH,
  type Strike,
  WATERS_LABEL,
  watersFor,
} from "../shared/fishing";
import { clamp, lerp, wrapAngle } from "../shared/math";
import { type Body, createBody, FLOAT_DEPTH, stepBody, stepFly } from "../shared/physics";
import {
  ANIMAL_STATE,
  FLAG,
  type HurtCause,
  type InteractKind,
  type LineState,
  type PlayerSnap,
  type RosterEntry,
  type ServerMsg,
  type Spawn,
  type TravelTarget,
  type WorldInfo,
} from "../shared/protocol";
import {
  BUILD_REACH,
  checkPlacement,
  overPrefab,
  PREFABS,
  type Prefab,
  prefabBlocks,
  type Verdict,
} from "../shared/prefabs";
import { SHOP, SHOP_REACH } from "../shared/shop";
import { canWear, type SkinId } from "../shared/skins";
import type { VehicleKind } from "../shared/vehicles";
import { Archipelago } from "../shared/archipelago";
import { type IslandInfo, type ShapeId } from "../shared/islands";
import { blockSolid } from "../shared/terrain";
import {
  emptyInventory,
  HOTBAR,
  heldTool,
  type Inventory,
  ITEMS,
  KIT_IDS,
  type KitId,
  type ItemId,
  type Rarity,
  TOOLS,
  type ToolKind,
} from "../shared/items";
import {
  COMBO_WINDOW,
  DAZE_SPEED,
  type WeaponKind,
  weaponDef,
  weaponFromIndex,
} from "../shared/weapons";
import { TideAudio } from "./audio";
import { Input } from "./input";
import { islandImage, type MapView } from "./map";
import {
  type Connection,
  keepSkin,
  keepWeapon,
  LocalConnection,
  readSkin,
  readWeapon,
  serverBase,
  WsConnection,
} from "./net";
import { Avatar } from "./scene/avatars";
import { FishingLines } from "./scene/fishing";
import { BoatView } from "./scene/boats";
import { HerdView } from "./scene/herd";
import { PrefabView } from "./scene/prefabs";
import { createLand, OpenSea } from "./scene/land";
import { shared } from "./scene/materials";
import { PostPass } from "./scene/post";
import { WorldProps } from "./scene/props";
import { Sky } from "./scene/sky";
import { type RodPose, ViewModel } from "./scene/weapons";

/* The title screen, or the game: online, on the grand map. */
export type Mode = "attract" | "online";

export type FeedItem = { id: number; text: string; at: number };

export type PanelKind = "inventory" | "board" | "shop" | "chest";

export type ShopView = {
  id: string;
  section: string;
  name: string;
  note: string;
  price: number;
  owned: number;
};

export type BuildView = {
  kits: { id: KitId; name: string; count: number }[];
  index: number;
  ok: boolean;
  reason: string | null;
  /* Aiming at something already built: right-click takes it back. */
  target: string | null;
};

export type BountyView = {
  id: number;
  title: string;
  note: string;
  reward: number;
  have: number;
  need: number;
};

export type ToolView = {
  id: number;
  kind: ToolKind;
  name: string;
};

export type InventoryView = {
  coins: number;
  slot: number;
  hotbar: (ToolView | null)[];
  pack: ToolView[];
  items: { id: ItemId; name: string; count: number; kind: string; rarity?: Rarity }[];
};

/* Something you could press E on: in the room's world, or a panel to open here. */
type Focus = { kind: InteractKind | "board" | "shop" | "chest"; id: number; label: string };

export type HudState = {
  mode: Mode;
  connecting: boolean;
  /* Choosing where your own island goes on the grand map (asked for from the island menu). */
  settling: { error: string | null; pending: boolean; islands: number } | null;
  /* Standing on the Harbor: common ground, where nobody can be hurt. */
  sheltered: boolean;
  /* Online and on your feet: where fast travel can take you, and whether you can claim land. */
  travel: { home: boolean; onHarbor: boolean; claimable: boolean } | null;
  notice: string | null;
  humans: number;
  name: string;
  player: boolean;
  /* Creative mode: flying about, and nothing hurts you. */
  creative: boolean;
  /* Up in the air in creative. */
  flying: boolean;
  health: number;
  /* Fades from 1 when you get hurt. */
  hurt: number;
  /* Set while you're down, with what did it. */
  down: HurtCause | null;
  stamina: number;
  shove: number;
  underwater: boolean;
  feed: FeedItem[];
  locked: boolean;
  inv: InventoryView;
  panel: PanelKind | null;
  /* What the held tool does. */
  hint: string | null;
  /* Your line in the water; with a strike once something bites (`at` in performance seconds). */
  fishing: { state: LineState; text: string; strike: Strike | null; at: number } | null;
  /* A big line of news for a moment: a catch, a fish getting away, a payout. */
  banner: { title: string; sub: string | null; at: number } | null;
  /* Bounties and coins are switched on. */
  economy: boolean;
  /* The bounty you've taken, and the board's offers. */
  bounty: BountyView | null;
  board: BountyView[];
  nearBoard: boolean;
  shop: ShopView[];
  nearShop: boolean;
  /* The open chest's contents. */
  chest: { id: ItemId; name: string; count: number }[] | null;
  build: BuildView | null;
  /* 0..1 while winding up a warhammer or greatsword. */
  charge: number | null;
  blocking: boolean;
  /* Fades from 1 after you land a hit, with what it did. */
  hitMarker: number;
  hitText: string | null;
  prompt: string | null;
  target: { name: string; health: number | null } | null;
};

type Sample = {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
};
type Remote = { avatar: Avatar; buf: Sample[]; name: string; skin: SkinId };

/* One island as drawn: its meshes, its props, and its picture for the map. */
type IslandView = {
  info: IslandInfo;
  group: THREE.Group;
  props: WorldProps;
  image: HTMLCanvasElement;
};

type World = {
  /* The first island's seed: the title screen keeps showing the same island. */
  seed: number | null;
  ground: Archipelago;
  islands: Map<number, IslandView>;
  group: THREE.Group;
  sea: OpenSea;
};

const STEP = 1 / 60;

/* What bought tools are good for, for the shop. */
const TOOL_NOTES: Partial<Record<ToolKind, string>> = {
  rod2: "Casts further, bites sooner, a wider strike, and better luck with rare fish.",
};
const BASE_FOV = 76;

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) for (const x of mat) x.dispose();
    else mat?.dispose();
  });
}

export class Game {
  readonly input: Input;
  readonly touch: boolean;
  private forced = false;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.08, 3000);
  private post = new PostPass();
  private sky = new Sky();
  private audio = new TideAudio();
  private viewmodel = new ViewModel();
  private world: World | null = null;
  private conn: Connection | null = null;
  private mode: Mode = "attract";
  private connecting = false;
  private notice: string | null = null;
  private noticeUntil = 0;

  private myId = -1;
  private myName = "";
  /* Your island on the grand map, once you have one. */
  private mine: number | null = null;
  /* Choosing where to claim an island of your own. */
  private claiming = false;
  private settleError: string | null = null;
  private settlePending = false;
  /* A mace's blow slows you until then (performance seconds). */
  private dazeUntil = 0;
  private roster: RosterEntry[] = [];
  private body: Body | null = null;
  private health = HEALTH_MAX;
  private hurtFlash = 0;
  private down: HurtCause | null = null;
  private downAt = 0;
  private inv: Inventory = emptyInventory();
  private panel: PanelKind | null = null;
  private focus: Focus | null = null;
  private lines = new FishingLines();
  private herd = new HerdView();
  private built = new PrefabView();
  private boats = new BoatView();
  /* The rowboat you're in, rowed here and reported to the room. */
  private boat: (BoatState & { id: number }) | null = null;
  private strokeAt = 0;
  private chestId: number | null = null;
  /* Build mode: which kit, how it's turned, and what's under the crosshair. */
  private build: {
    index: number;
    turn: number;
    aim: { x: number; y: number; z: number } | null;
    verdict: Verdict | null;
    target: Prefab | null;
  } | null = null;
  private boarStates = new Map<number, number>();
  private myLine: { state: LineState; depth: number } | null = null;
  private bite: { strike: Strike; at: number } | null = null;
  private banner: HudState["banner"] = null;
  private board: Bounty[] = [];
  private chargeStart: number | null = null;
  private blocking = false;
  private sentStance = { block: false, charge: false };
  private combo = 0;
  private lastSwingAt = 0;
  private hitMarker = 0;
  private hitText: string | null = null;
  private remotes = new Map<number, Remote>();
  private feed: FeedItem[] = [];
  private feedId = 0;

  /* Clock: world time ≈ performance.now()/1000 + offset. */
  private offset = 0;
  private haveClock = false;

  private acc = 0;
  private sendAcc = 0;
  private stepDist = 0;
  private attackReadyAt = 0;
  private kick = 0;
  private dip = 0;
  private flash = 0;
  private bob = 0;
  private bobAmp = 0;
  private smoothEye = 0;
  private under = 0;
  private fov = BASE_FOV;
  private wasUnder = false;
  /* Creative mode, and whether you're up in the air with it. */
  private creative = false;
  private flying = false;
  private lastJumpTap = 0;
  /* Just left creative in mid-air: the fall down from there doesn't hurt. */
  private safeFall = false;

  private raf = 0;
  private last = performance.now();
  private hudAcc = 0;
  private visible = true;
  private pixelRatio = 1;
  private slowFrames = 0;
  private resize: ResizeObserver;
  private intersect: IntersectionObserver;
  private disposed = false;
  private lockHandler = () => this.onLockChange();
  private visHandler = () => this.onVisibility();
  private tmpV = new THREE.Vector3();
  private tmpF = new THREE.Vector3();

  constructor(
    private container: HTMLElement,
    private onHud: (state: HudState) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.autoClear = true;
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    container.appendChild(canvas);

    this.touch = matchMedia("(pointer: coarse)").matches;
    this.input = new Input(canvas);
    this.scene.add(this.sky.group);
    this.scene.add(this.lines.group);
    this.scene.add(this.herd.group);
    this.scene.add(this.built.group);
    this.scene.add(this.boats.group);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
    this.intersect = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.conn?.setPaused(this.shouldPause());
    });
    this.intersect.observe(container);
    document.addEventListener("pointerlockchange", this.lockHandler);
    document.addEventListener("visibilitychange", this.visHandler);
    this.fit();
    this.start("attract");
    this.raf = requestAnimationFrame(this.frame);
  }

  /* Dev/test only: treat input as live without pointer lock. */
  get forceActive() {
    return this.forced;
  }

  set forceActive(on: boolean) {
    this.forced = on;
    this.conn?.setPaused(this.shouldPause());
  }

  /* The weapon in hand (null for fists or a rod). */
  private get weapon() {
    const tool = heldTool(this.inv);
    return tool ? TOOLS[tool.kind].weapon : null;
  }

  get canvas() {
    return this.renderer.domElement;
  }

  /* ---------- lifecycle ---------- */

  start(mode: Mode) {
    const seed = this.mode === "attract" ? (this.world?.seed ?? undefined) : undefined;
    this.conn?.close();
    this.conn = null;
    this.reset();
    this.mode = mode;
    if (mode !== "attract") this.audio.start();

    const handlers = {
      message: (msg: ServerMsg) => this.onMessage(msg),
      closed: (reason: string) => {
        if (this.mode !== "online" || this.disposed) return;
        this.input.unlock();
        this.say(`${reason}.`, 5);
        this.start("attract");
      },
    };

    if (mode === "online") {
      const base = serverBase();
      if (!base) {
        this.input.unlock();
        this.say("The sea can't be reached right now.", 5);
        this.start("attract");
        return;
      }
      this.connecting = true;
      this.conn = new WsConnection(base, handlers);
    } else this.conn = new LocalConnection(handlers, { seed });
    this.emitHud();
  }

  private reset() {
    for (const r of this.remotes.values()) {
      this.scene.remove(r.avatar.group);
      r.avatar.dispose();
    }
    this.remotes.clear();
    this.roster = [];
    this.body = null;
    this.down = null;
    this.health = HEALTH_MAX;
    this.inv = emptyInventory();
    this.panel = null;
    this.focus = null;
    this.lines.clear();
    this.herd.clear();
    this.built.reset([]);
    this.boats.clear();
    this.creative = false;
    this.flying = false;
    this.safeFall = false;
    this.boat = null;
    this.build = null;
    this.chestId = null;
    this.boarStates.clear();
    this.myLine = null;
    this.bite = null;
    this.banner = null;
    this.board = [];
    this.chargeStart = null;
    this.blocking = false;
    this.feed = [];
    this.haveClock = false;
    this.myId = -1;
    this.mine = null;
    this.claiming = false;
    this.settleError = null;
    this.settlePending = false;
    this.dazeUntil = 0;
    this.input.clear();
  }

  /* Online, connected, without land of your own, and choosing where to claim some. */
  get settling() {
    return (
      this.mode === "online" &&
      this.claiming &&
      this.myId >= 0 &&
      !!this.world &&
      this.mine === null
    );
  }

  /* Open the grand map to claim an island of your own (free, for now). */
  openClaim() {
    if (this.mode !== "online" || this.mine !== null) return;
    this.claiming = true;
    this.settleError = null;
    this.input.unlock();
    this.emitHud();
  }

  /* Back to the Harbor without claiming anything. */
  closeClaim() {
    if (!this.claiming) return;
    this.claiming = false;
    this.settlePending = false;
    this.emitHud();
  }

  /* Fast travel to the Harbor, or home to your own island, and back into the game. */
  travel(to: TravelTarget) {
    this.conn?.send({ t: "travel", to });
    this.lock();
  }

  /* The weapon you carry: what's in your pack once you're out there, or what this browser chose. */
  get armedWith(): WeaponKind | null {
    if (this.body) {
      const tool = this.inv.tools.find((t) => TOOLS[t.kind].weapon);
      return tool ? TOOLS[tool.kind].weapon : null;
    }
    return readWeapon() ?? null;
  }

  /*
   * Take up a weapon from the marketplace (null: put it away). This browser
   * remembers it, and you arrive carrying it next time.
   */
  arm(kind: WeaponKind | null) {
    keepWeapon(kind);
    if (this.conn?.kind === "online") this.conn.send({ t: "arm", kind });
  }

  /* Whether a vehicle can be spawned now: only once you're out in the world. */
  get canSpawn(): boolean {
    return !!this.body && this.conn?.kind === "online";
  }

  /* Put a vehicle from the marketplace in the water nearby, in place of the last one. */
  spawnVehicle(kind: VehicleKind) {
    if (this.canSpawn) this.conn?.send({ t: "spawn", kind });
  }

  /* Ask for your island at (x, z) on the grand map. */
  settle(shape: ShapeId, seed: number, x: number, z: number) {
    if (!this.settling || this.settlePending) return;
    this.settlePending = true;
    this.settleError = null;
    this.conn?.send({ t: "settle", shape, seed, x, z });
    this.emitHud();
  }

  /* Everything the grand map shows, as it is right now. */
  mapView(): MapView {
    const world = this.world;
    const islands = world
      ? [...world.islands.values()].map((o) => ({
          info: o.info,
          image: o.image,
          mine: o.info.id === this.mine,
        }))
      : [];
    const players: MapView["players"] = [];
    for (const [id, r] of this.remotes) {
      const last = r.buf[r.buf.length - 1];
      if (!last || !r.avatar.group.visible) continue;
      const p = r.avatar.group.position;
      players.push({ id, name: r.name, x: p.x, z: p.z, yaw: last.yaw, me: false });
    }
    if (this.body)
      players.push({
        id: this.myId,
        name: this.myName,
        x: this.body.x,
        z: this.body.z,
        yaw: this.input.yaw,
        me: true,
      });
    return { islands, players };
  }

  lock() {
    if (this.touch) return;
    this.audio.start();
    this.input.lock();
  }

  setMuted(muted: boolean) {
    this.audio.setMuted(muted);
  }

  private shouldPause() {
    /* Only the title screen's room can pause; the sea goes on without you. */
    return !this.visible || document.hidden;
  }

  private onLockChange() {
    this.conn?.setPaused(this.shouldPause());
    if (!this.input.locked) {
      this.input.clear();
      /* Esc: out of build mode. */
      this.endBuild();
    }
    this.emitHud();
  }

  private onVisibility() {
    this.conn?.setPaused(this.shouldPause());
    if (document.hidden) this.audio.suspend();
    else if (this.mode !== "attract") this.audio.resume();
  }

  private fit() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.slowFrames > 90 ? 1 : 1.75);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.post.setSize(Math.floor(w * this.pixelRatio), Math.floor(h * this.pixelRatio));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.conn?.close();
    this.reset();
    this.resize.disconnect();
    this.intersect.disconnect();
    document.removeEventListener("pointerlockchange", this.lockHandler);
    document.removeEventListener("visibilitychange", this.visHandler);
    this.input.dispose();
    this.audio.close();
    this.viewmodel.dispose();
    this.lines.dispose();
    this.herd.dispose();
    this.built.dispose();
    this.boats.dispose();
    this.dropWorld();
    this.sky.dispose();
    this.post.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private say(text: string, seconds: number) {
    this.notice = text;
    this.noticeUntil = performance.now() / 1000 + seconds;
  }

  private pushFeed(text: string) {
    this.feed.push({ id: this.feedId++, text, at: performance.now() / 1000 });
    if (this.feed.length > 5) this.feed.shift();
  }

  /* ---------- world ---------- */

  private dropWorld() {
    if (!this.world) return;
    this.scene.remove(this.world.group);
    for (const o of this.world.islands.values()) {
      o.props.dispose();
      o.group.remove(o.props.group);
    }
    disposeTree(this.world.group);
    this.world = null;
  }

  /* An empty grand map: just the open sea, waiting for islands. */
  private buildWorld() {
    this.dropWorld();
    const group = new THREE.Group();
    const sea = new OpenSea();
    group.add(sea.mesh);
    this.scene.add(group);
    this.world = {
      seed: null,
      ground: new Archipelago(),
      islands: new Map(),
      group,
      sea,
    };
  }

  /* Raise an island in the world: its ground, its sea, its props and its map picture. */
  private addIsland(info: IslandInfo) {
    const world = this.world;
    if (!world || world.islands.has(info.id)) return;
    const { terrain } = world.ground.add(info);
    const group = new THREE.Group();
    group.add(...createLand(terrain));
    const props = new WorldProps(terrain);
    group.add(props.group);
    world.group.add(group);
    world.islands.set(info.id, {
      info,
      group,
      props,
      image: islandImage(terrain.heights, Math.round(Math.sqrt(terrain.heights.length))),
    });
    world.seed ??= info.seed;
    world.sea.setTiles(world.ground.list());
  }

  /* Is the world we have drawn the same set of islands as this one, or a start on it? */
  private sameWorld(islands: readonly IslandInfo[]) {
    const world = this.world;
    if (!world) return false;
    for (const [id, o] of world.islands) {
      const next = islands.find((i) => i.id === id);
      if (!next || next.shape !== o.info.shape || next.seed !== o.info.seed) return false;
      if (next.x !== o.info.x || next.z !== o.info.z) return false;
    }
    return true;
  }

  /* ---------- networking ---------- */

  private worldTime() {
    return performance.now() / 1000 + this.offset;
  }

  private onMessage(msg: ServerMsg) {
    switch (msg.t) {
      case "welcome":
        this.myId = msg.id;
        this.myName = msg.name;
        this.connecting = false;
        if (this.mode === "online") {
          this.pushFeed(`You are ${msg.name}`);
          if (readWeapon() === undefined)
            this.pushFeed("Choose a weapon in the marketplace. The Harbor is safe ground");
        }
        break;
      case "full":
        this.input.unlock();
        this.say("The sea is full right now. Try again soon.", 5);
        this.start("attract");
        break;
      case "world":
        this.onWorld(msg);
        break;
      case "island":
        /* The room announces it in the feed; here it just rises out of the sea. */
        if (this.world && !this.world.islands.has(msg.island.id)) this.addIsland(msg.island);
        break;
      case "unsettled":
        this.settlePending = false;
        this.settleError = msg.reason;
        this.input.unlock();
        this.emitHud();
        break;
      case "roster":
        this.setRoster(msg.roster);
        break;
      case "snap":
        this.onSnap(msg);
        break;
      case "impulse": {
        const b = this.body;
        if (!b) break;
        b.vx += msg.vx;
        b.vz += msg.vz;
        b.vy = Math.max(b.vy, msg.vy);
        b.grounded = false;
        b.ladderCooldown = 0.6;
        this.flash = 1;
        this.kick = 1;
        this.audio.shoved();
        navigator.vibrate?.(60);
        break;
      }
      case "hurt":
        this.hurtFlash = 1;
        this.flash = Math.max(this.flash, 0.6);
        this.kick = Math.max(this.kick, 0.6);
        this.audio.shoved();
        navigator.vibrate?.(80);
        break;
      case "died":
        this.endBuild();
        this.boat = null;
        this.down = msg.cause;
        this.dazeUntil = 0;
        if (msg.by) this.pushFeed(`${msg.by} knocked you out`);
        this.downAt = performance.now() / 1000;
        this.input.clear();
        this.chargeStart = null;
        this.audio.blackout();
        break;
      case "respawn":
        this.place(msg);
        if (this.down) this.pushFeed("You come to, everything you own still with you");
        this.down = null;
        this.dazeUntil = 0;
        break;
      case "warp":
        this.endBuild();
        this.boat = null;
        this.chargeStart = null;
        this.place(msg);
        this.claiming = false;
        this.dazeUntil = 0;
        this.audio.splash(0.4);
        this.pushFeed(this.onHarbor() ? "You arrive at the Harbor" : "You arrive home");
        break;
      case "daze":
        this.dazeUntil = performance.now() / 1000 + msg.seconds;
        this.pushFeed("You're dazed");
        break;
      case "swing":
        if (msg.by !== this.myId) {
          const r = this.remotes.get(msg.by);
          r?.avatar.strike();
          const s = r?.buf[r.buf.length - 1];
          if (s && this.distanceTo(s.x, s.z) < 20) this.audio.swing(msg.kind, msg.heavy);
        }
        break;
      case "hit":
        this.onHit(msg);
        break;
      case "inv":
        this.inv = msg.inv;
        break;
      case "line":
        this.onLine(msg);
        break;
      case "bite":
        this.bite = { strike: msg, at: performance.now() / 1000 };
        this.audio.bite();
        navigator.vibrate?.(40);
        break;
      case "board":
        this.board = msg.offers;
        break;
      case "prefab": {
        const fresh = !this.built.get(msg.prefab.id);
        this.addPrefab(msg.prefab);
        if (fresh && this.body && this.distanceTo(msg.prefab.x, msg.prefab.z) < 30)
          this.audio.thud();
        break;
      }
      case "aboard":
        this.onAboard(msg.boat);
        break;
      case "unprefab":
        this.built.remove(msg.id);
        this.boats.remove(msg.id);
        this.world?.ground.removeSolids(msg.id);
        if (this.chestId === msg.id && this.panel === "chest") this.closePanel();
        break;
      case "paid":
        this.audio.reward();
        this.banner = {
          title: `+${msg.bounty.reward} coins`,
          sub: `Bounty paid · ${bountyTitle(msg.bounty)}`,
          at: performance.now() / 1000,
        };
        this.pushFeed(`Bounty paid: ${msg.bounty.reward} coins`);
        break;
      case "ahit":
        this.onAnimalHit(msg);
        break;
      case "catch":
        if (msg.by !== this.myId) break;
        this.bite = null;
        this.banner = {
          title: msg.fish ? ITEMS[msg.fish].name : "It got away.",
          sub: msg.fish ? (ITEMS[msg.fish].rarity ?? null) : null,
          at: performance.now() / 1000,
        };
        if (msg.fish) {
          this.audio.chime();
          this.pushFeed(`You caught a ${ITEMS[msg.fish].name.toLowerCase()}`);
        } else {
          this.audio.slip();
          this.pushFeed("It got away");
        }
        break;
      case "feed":
        this.pushFeed(msg.text);
        break;
    }
  }

  /* Into a boat (facing the bow), or out of it onto whatever's nearest. */
  private onAboard(id: number | null) {
    const b = this.body;
    const world = this.world;
    if (!b || !world) return;
    if (id !== null) {
      const p = this.built.get(id);
      if (!p) return;
      this.endBuild();
      this.flying = false;
      this.boat = { id, x: p.x, z: p.z, rot: p.rot, speed: 0, turn: 0 };
      this.input.yaw = p.rot;
      this.audio.splash(0.4);
      return;
    }
    const boat = this.boat;
    this.boat = null;
    if (!boat) return;
    /* Step out onto land or a dock beside the boat if there is any, otherwise into the sea. */
    const c = Math.cos(boat.rot);
    const s = Math.sin(boat.rot);
    let best: { x: number; y: number; z: number } | null = null;
    for (const [lx, lz] of [
      [1.4, 0],
      [-1.4, 0],
      [0, 2.6],
      [0, -2.7],
      [1.6, 1.4],
      [-1.6, 1.4],
      [1.6, -1.4],
      [-1.6, -1.4],
    ]) {
      const x = boat.x + lx * c + lz * s;
      const z = boat.z - lx * s + lz * c;
      const g = world.ground.groundAt(x, z, SEA_LEVEL + 1.6).ground;
      if (g > SEA_LEVEL + 0.15 && (!best || g < best.y)) best = { x, y: g, z };
    }
    const out = best ?? { x: boat.x + 1.3 * c, y: SEA_LEVEL - 1, z: boat.z - 1.3 * s };
    b.x = out.x;
    b.y = out.y;
    b.z = out.z;
    b.vx = b.vy = b.vz = 0;
    this.smoothEye = b.y + EYE_HEIGHT;
    this.audio.splash(best ? 0.3 : 0.9);
  }

  /* Row: the oars drive the boat, and you sit in it. */
  private row(dt: number, b: Body, active: boolean) {
    const boat = this.boat!;
    const world = this.world!;
    const intent = active
      ? { forward: this.input.forward, right: this.input.right }
      : { forward: 0, right: 0 };
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      if (stepBoat(boat, intent, STEP, world.ground)) this.audio.land(4);
    }
    const seat = seatOf(boat);
    b.vx = (seat.x - b.x) / Math.max(dt, 1e-3);
    b.vz = (seat.z - b.z) / Math.max(dt, 1e-3);
    b.x = seat.x;
    b.y = seat.y;
    b.z = seat.z;
    b.vy = 0;
    b.grounded = true;
    b.sprinting = false;
    b.stamina = Math.min(STAMINA_MAX, b.stamina + 10 * dt);
    this.bobAmp = 0;
    const now = performance.now() / 1000;
    if (Math.abs(boat.speed) > 0.8 && intent.forward && now - this.strokeAt > 1.3) {
      this.strokeAt = now;
      this.audio.splash(0.22);
    }
    this.boats.set(boat.id, boat.x, boat.z, boat.rot, boat.speed, true);
  }

  /* Draw it, and make it solid for our own footsteps too. */
  private addPrefab(p: Prefab) {
    if (p.kind === "rowboat") {
      this.built.set(p);
      if (this.boat?.id !== p.id) this.boats.set(p.id, p.x, p.z, p.rot, 0, true);
      return;
    }
    this.built.set(p);
    const solids = prefabBlocks(p)
      .filter((b) => b.solid)
      .map(blockSolid);
    if (solids.length) this.world?.ground.addSolids(p.id, solids);
  }

  private onAnimalHit(msg: Extract<ServerMsg, { t: "ahit" }>) {
    const a = this.herd.list().get(msg.id);
    if (msg.by === this.myId) {
      this.hitMarker = 1;
      this.hitText = msg.dead ? "Down" : `-${msg.damage}`;
      this.audio.hit(this.weapon, false);
      if (msg.dead) {
        this.audio.chime();
        this.pushFeed(`You brought down a ${msg.kind} · carcass in your pack`);
      }
    } else if (a) {
      const near = 1 - this.distanceTo(a.x, a.z) / 30;
      if (near > 0) this.audio.hit(null, false, near);
    }
  }

  private onLine(msg: Extract<ServerMsg, { t: "line" }>) {
    const from = this.tmpV;
    if (msg.by === this.myId) {
      if (msg.state === "none") {
        this.myLine = null;
        this.bite = null;
      } else {
        const depth = this.world ? depthAt(this.world.ground.heightAt(msg.x, msg.z)) : 0;
        if (msg.state === "cast") this.audio.splash(0.25);
        this.myLine = { state: msg.state, depth };
      }
      this.rodTipWorld(from);
    } else {
      const r = this.remotes.get(msg.by);
      if (r) from.copy(r.avatar.group.position).setY(r.avatar.group.position.y + 2);
    }
    this.lines.set(msg.by, msg.x, msg.z, msg.state, from);
  }

  /* The held rod's tip, placed in the world where it shows on screen. */
  private rodTipWorld(out: THREE.Vector3) {
    if (!this.viewmodel.rodTip(out)) {
      out.copy(this.camera.position);
      return false;
    }
    out.z = 0.5;
    out.unproject(this.camera).sub(this.camera.position).normalize();
    out.multiplyScalar(1.4).add(this.camera.position);
    return true;
  }

  private tipOf = (by: number, out: THREE.Vector3) => {
    if (by === this.myId) return !this.down && this.rodTipWorld(out);
    const r = this.remotes.get(by);
    if (!r?.avatar.group.visible) return false;
    out.copy(r.avatar.group.position);
    out.y += 2.1;
    return true;
  };

  /* Cast where you're looking: onto the water, as far as the rod reaches. */
  private castOrStrike() {
    const tool = heldTool(this.inv);
    const rod = tool && TOOLS[tool.kind].rod;
    const b = this.body;
    const world = this.world;
    if (!rod || !b || !world) return;
    const now = performance.now() / 1000;
    if (this.myLine) {
      this.conn?.send({ t: "reel", at: this.bite ? now - this.bite.at : -1 });
      this.viewmodel.swing(false);
      return;
    }
    if (now < this.attackReadyAt) return;
    this.attackReadyAt = now + 0.6;
    const dir = this.tmpF.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const flat = Math.hypot(dir.x, dir.z) || 1;
    let reach = rod.cast;
    if (dir.y < -0.02) reach = Math.min(rod.cast, ((this.camera.position.y - 0) / -dir.y) * flat);
    reach = Math.max(3, reach);
    const x = b.x + (dir.x / flat) * reach;
    const z = b.z + (dir.z / flat) * reach;
    this.viewmodel.swing(false);
    this.audio.swing(null, false);
    if (depthAt(world.ground.heightAt(x, z)) < MIN_CAST_DEPTH) {
      this.say("Cast out over the water", 2);
      return;
    }
    this.conn?.send({ t: "cast", x, z });
  }

  private place(s: Spawn) {
    this.body = createBody(s.x, s.y, s.z, s.yaw);
    this.input.yaw = s.yaw;
    this.input.pitch = -0.05;
    this.health = HEALTH_MAX;
    this.smoothEye = s.y + EYE_HEIGHT;
    this.flying = false;
  }

  private onWorld(info: WorldInfo) {
    if (!this.sameWorld(info.islands)) this.buildWorld();
    const world = this.world!;
    for (const island of info.islands) this.addIsland(island);
    this.mine = info.mine;
    this.settlePending = false;
    if (info.you) this.settleError = null;
    /* Choosing where to settle needs the mouse. */
    if (this.settling) this.input.unlock();
    this.offset = info.time - performance.now() / 1000;
    this.haveClock = true;
    this.board = info.board;
    for (const p of this.built.list()) world.ground.removeSolids(p.id);
    this.built.reset([]);
    for (const p of info.prefabs) this.addPrefab(p);
    if (info.you) this.place(info.you);
    else this.body = null;
    this.setRoster(info.roster);
    this.emitHud();
  }

  /* Avatars for everyone on the island but me. */
  private setRoster(roster: RosterEntry[]) {
    this.roster = roster;
    const ids = new Set(roster.map((r) => r.id));
    for (const [id, r] of this.remotes) {
      if (ids.has(id) && id !== this.myId) continue;
      this.scene.remove(r.avatar.group);
      r.avatar.dispose();
      this.remotes.delete(id);
    }
    for (const entry of roster) {
      if (entry.id === this.myId) continue;
      const known = this.remotes.get(entry.id);
      if (known) {
        /* Someone changed skins in the marketplace. */
        if (known.skin !== entry.skin) {
          known.skin = entry.skin;
          known.avatar.setSkin(entry.skin);
        }
        continue;
      }
      const avatar = new Avatar(entry.id, entry.name, entry.skin);
      avatar.group.visible = false;
      this.scene.add(avatar.group);
      this.remotes.set(entry.id, { avatar, buf: [], name: entry.name, skin: entry.skin });
    }
  }

  private onSnap(msg: Extract<ServerMsg, { t: "snap" }>) {
    const now = performance.now() / 1000;
    const sample = msg.time - now;
    if (!this.haveClock || Math.abs(sample - this.offset) > 0.75) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.08;
    this.haveClock = true;

    for (const p of msg.p as PlayerSnap[]) {
      const [id, x, y, z, yaw, pitch, flags, weapon, stagger] = p;
      const r = this.remotes.get(id);
      if (!r) continue;
      r.avatar.setGear(weaponFromIndex(weapon ?? 0), stagger ?? 0);
      r.buf.push({ t: msg.time, x, y, z, yaw, pitch, flags });
      if (r.buf.length > 12) r.buf.shift();
    }

    this.herd.set(msg.a);
    for (const [id, x, z, rot, speed] of msg.b) {
      const p = this.built.get(id);
      if (p) {
        p.x = x;
        p.z = z;
        p.rot = rot;
      }
      if (this.boat?.id !== id) this.boats.set(id, x, z, rot, speed);
    }
    /* A boar squaring up nearby snorts before it charges. */
    for (const [id, kind, x, , z, , state] of msg.a) {
      if (kind !== 1) continue;
      const was = this.boarStates.get(id);
      if (state === ANIMAL_STATE.alert && was !== state && this.distanceTo(x, z) < 26)
        this.audio.snort(1 - this.distanceTo(x, z) / 26);
      this.boarStates.set(id, state);
    }

    if (msg.me) {
      this.health = msg.me.health;
    }
  }

  private onHit(msg: Extract<ServerMsg, { t: "hit" }>) {
    if (msg.target === this.myId) {
      if (msg.blocked || msg.parry) this.audio.clang(msg.parry);
      else this.audio.hit(msg.kind, msg.heavy);
      return;
    }
    if (msg.by === this.myId) {
      this.hitMarker = 1;
      /* Health taken when it counts; on the Harbor (or in creative) only the stagger. */
      this.hitText = msg.parry
        ? "Parried"
        : msg.damage > 0
          ? `-${msg.damage}${msg.blocked ? " · through the shield" : ""}`
          : msg.blocked
            ? "Blocked"
            : `+${msg.added}%`;
      if (msg.blocked || msg.parry) this.audio.clang(msg.parry);
      else this.audio.hit(msg.kind, msg.heavy);
      return;
    }
    const target = this.remotes.get(msg.target);
    const s = target?.buf[target.buf.length - 1];
    if (!s) return;
    const near = 1 - this.distanceTo(s.x, s.z) / 30;
    if (near <= 0) return;
    if (msg.blocked || msg.parry) this.audio.clang(msg.parry);
    else this.audio.hit(msg.kind, msg.heavy, near);
  }

  private tryAttack(b: Body, charge: number) {
    const now = performance.now() / 1000;
    if (now < this.attackReadyAt) return;
    const kind = this.weapon;
    const def = weaponDef(kind);
    this.attackReadyAt = now + def.cooldown;
    let heavy = false;
    if (def.combo) {
      this.combo = now - this.lastSwingAt < COMBO_WINDOW ? this.combo + 1 : 1;
      if (this.combo >= 3) {
        heavy = true;
        this.combo = 0;
      }
    }
    this.lastSwingAt = now;
    this.conn?.send({ t: "attack", charge });
    this.viewmodel.swing(heavy);
    this.audio.swing(kind, heavy);
    this.kick = kind ? -0.3 : -0.6;
  }

  private distanceTo(x: number, z: number) {
    return Math.hypot(this.camera.position.x - x, this.camera.position.z - z);
  }

  /* ---------- frame ---------- */

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.visible || document.hidden) return;

    if (dt > 1 / 40) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames === 91) this.fit();

    const t = now / 1000;
    shared.uTime.value = t;

    this.update(dt);

    if (this.world) {
      for (const o of this.world.islands.values()) o.props.update(t);
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.5);
    const held = this.body && !this.down ? heldTool(this.inv) : null;
    const holding = held && TOOLS[held.kind].rod ? "rod" : held ? TOOLS[held.kind].weapon : null;
    this.viewmodel.set(holding);
    const def = weaponDef(holding === "rod" ? null : holding);
    this.viewmodel.update(dt, {
      aspect: this.camera.aspect,
      bob: this.bob,
      bobAmp: this.bobAmp,
      charge:
        this.chargeStart !== null && def.charge
          ? Math.min(1, (performance.now() / 1000 - this.chargeStart) / def.charge.max)
          : null,
      blocking: this.blocking,
      kick: this.kick,
      rod: this.rodPose(),
    });
    this.hitMarker = Math.max(0, this.hitMarker - dt * 2.2);
    this.updateRemotes(dt);
    this.lines.update(t, this.tipOf);
    this.herd.update(dt);
    this.built.update(t);
    this.boats.update(t, dt);
    this.sky.follow(this.camera);

    const under = this.camera.position.y < SEA_LEVEL + 0.05 ? 1 : 0;
    this.under += (under - this.under) * Math.min(1, dt * 10);
    const u = this.post.uniforms;
    u.uTime.value = t;
    u.uUnder.value = this.under;
    u.uFlash.value = this.flash;
    this.flash = Math.max(0, this.flash - dt * 3.5);
    /* Blacking out: the world fades, then comes back when you wake. */
    const out = this.down ? clamp((t - this.downAt) / 1.2, 0, 1) : 0;
    u.uFade.value = this.world ? 1 - out * 0.85 : 0;
    this.post.render(
      this.renderer,
      this.scene,
      this.camera,
      this.viewmodel.visible ? this.viewmodel : undefined,
    );

    this.hudAcc += dt;
    if (this.hudAcc > 0.08) {
      this.hudAcc = 0;
      this.emitHud();
    }
  };

  private update(dt: number) {
    const world = this.world;
    const active = this.touch || this.input.locked || this.forceActive;

    if (world && this.body && this.down) {
      this.dropInputs();
      this.fallen(dt, this.body);
    } else if (world && this.body) {
      const b = this.body;
      b.yaw = this.input.yaw;
      const def = weaponDef(this.weapon);
      this.blocking = this.weapon === "shield" && active && this.input.altHeld && !this.build;
      const charging = this.chargeStart !== null;
      if (active && this.input.take("creative")) this.toggleCreative(b);
      if (active && this.input.take("fly") && this.creative && !this.boat)
        this.setFlying(b, !this.flying);
      const tapped = active && this.input.take("jump");
      /* In creative, a double tap of Space takes off or comes down, as in the usual sandbox games. */
      if (tapped && this.creative && !this.boat) {
        const now = performance.now() / 1000;
        if (now - this.lastJumpTap < 0.3) {
          this.setFlying(b, !this.flying);
          this.lastJumpTap = 0;
        } else this.lastJumpTap = now;
      }
      const fly = {
        forward: active ? this.input.forward : 0,
        right: active ? this.input.right : 0,
        up: active && this.input.jumpHeld,
        down: active && this.input.descend,
        boost: active && this.input.boost,
      };
      const intent = active
        ? {
            forward: this.input.forward,
            right: this.input.right,
            jump: tapped || this.input.jumpHeld,
            sprint: this.input.sprint,
            speedScale:
              (def.speed ?? 1) *
              (this.blocking ? 0.6 : 1) *
              (performance.now() / 1000 < this.dazeUntil ? DAZE_SPEED : 1),
            noSprint: charging || this.blocking,
          }
        : { forward: 0, right: 0, jump: false, sprint: false };

      if (this.boat) this.row(dt, b, active);
      else this.acc += dt;
      const stepWorld = { terrain: world.ground };
      while (!this.boat && this.acc >= STEP) {
        this.acc -= STEP;
        if (this.flying) {
          if (stepFly(b, fly, STEP, stepWorld).landed) {
            this.flying = false;
            this.audio.land(4);
          }
          continue;
        }
        if (this.creative) b.stamina = STAMINA_MAX;
        const ev = stepBody(b, intent, STEP, stepWorld);
        if (ev.jumped) this.audio.jump();
        if (ev.landed > 3) {
          this.audio.land(ev.landed);
          this.dip = Math.min(1, ev.landed / 14);
        }
        if (ev.enteredWater) this.audio.splash(0.7);
        if (b.grounded) {
          this.stepDist += ev.moved;
          const stride = b.sprinting ? 2.6 : 2.1;
          if (this.stepDist > stride) {
            this.stepDist = 0;
            this.audio.step(b.y < SEA_LEVEL);
          }
        }
        this.bob += ev.moved * (b.grounded ? 1.9 : 0);
      }
      const speed = Math.hypot(b.vx, b.vz);
      this.bobAmp = lerp(this.bobAmp, b.grounded ? Math.min(1, speed / 9) : 0, Math.min(1, dt * 8));

      /* Attack: instant swings on press; the warhammer and greatsword charge until release. */
      const now = performance.now() / 1000;
      const fishing = !!(heldTool(this.inv) && TOOLS[heldTool(this.inv)!.kind].rod);
      if (this.build) this.buildInput(b);
      else if (fishing && this.input.take("attack")) this.castOrStrike();
      else if (this.input.take("attack") && !this.blocking) {
        if (def.charge) {
          if (now >= this.attackReadyAt) this.chargeStart = now;
        } else this.tryAttack(b, 0);
      }
      if (this.input.take("attackUp") && this.chargeStart !== null) {
        this.tryAttack(b, now - this.chargeStart);
        this.chargeStart = null;
      }
      if (!def.charge) this.chargeStart = null;
      this.input.take("alt");
      this.input.take("altUp");
      if (!this.build) this.hotbarInput();
      this.focus = this.build ? null : this.findFocus(b);
      if (this.input.take("interact") && this.focus) {
        const f = this.focus;
        if (f.kind === "board" || f.kind === "shop") this.openPanel(f.kind);
        else if (f.kind === "chest") {
          this.chestId = f.id;
          this.openPanel("chest");
        } else this.conn?.send({ t: "interact", kind: f.kind, id: f.id });
      }
      if (this.input.take("inventory")) this.openPanel("inventory");
      if (this.input.take("build")) this.toggleBuild();
      this.input.take("rotate");
      const stance = { block: this.blocking, charge: this.chargeStart !== null };
      if (stance.block !== this.sentStance.block || stance.charge !== this.sentStance.charge) {
        this.sentStance = stance;
        this.conn?.send({ t: "stance", ...stance });
      }

      this.sendAcc += dt;
      if (this.sendAcc >= 1 / TICK_HZ) {
        this.sendAcc = 0;
        if (this.safeFall && (b.grounded || b.y < SEA_LEVEL)) this.safeFall = false;
        this.conn?.send({
          t: "move",
          x: b.x,
          y: b.y,
          z: b.z,
          yaw: b.yaw,
          pitch: this.input.pitch,
          vx: b.vx,
          vy: b.vy,
          vz: b.vz,
          flags:
            (b.sprinting ? FLAG.sprint : 0) |
            (b.grounded ? FLAG.grounded : 0) |
            (b.y < SEA_LEVEL ? FLAG.wet : 0) |
            (this.flying ? FLAG.fly : 0) |
            (this.creative || this.safeFall ? FLAG.creative : 0),
          boat: this.boat ? { rot: this.boat.rot, speed: this.boat.speed } : undefined,
        });
      }

      const depth = SEA_LEVEL - b.y;
      if (depth > FLOAT_DEPTH - 0.2 && !this.wasUnder) this.audio.splash(1);
      this.wasUnder = depth > FLOAT_DEPTH - 0.2;
      const strain = this.health / 30;
      if (strain < 1) this.audio.heartbeat(lerp(0.45, 1.1, strain));
      this.firstPerson(dt, b);
    } else {
      this.dropInputs();
      this.orbitCamera(dt);
    }

    const above = this.camera.position.y - SEA_LEVEL;
    this.audio.ambience(above, this.under > 0.5, this.camera.position.y);
  }

  /* Shift+C: in or out of creative. Going in takes you up into the air. */
  private toggleCreative(b: Body) {
    this.creative = !this.creative;
    if (this.creative) {
      this.safeFall = false;
      if (!this.boat) this.setFlying(b, true);
      this.pushFeed("Creative mode");
    } else {
      this.flying = false;
      this.safeFall = !b.grounded && b.y > SEA_LEVEL;
      this.pushFeed("Survival mode");
    }
  }

  private setFlying(b: Body, on: boolean) {
    this.flying = on;
    if (on) {
      /* A little hop up off the ground to start with. */
      b.vy = Math.max(b.vy, 6);
      b.grounded = false;
      b.climbing = false;
      b.ladderCooldown = 0.5;
    }
  }

  private dropInputs() {
    for (const a of [
      "attack",
      "attackUp",
      "alt",
      "altUp",
      "interact",
      "inventory",
      "build",
      "rotate",
      "jump",
      "creative",
      "fly",
    ] as const)
      this.input.take(a);
    this.input.takeDigit();
    this.input.takeWheel();
    this.chargeStart = null;
  }

  /* Number keys pick a slot, the wheel steps through them. Shown at once, confirmed by the room. */
  private hotbarInput() {
    let slot = this.input.takeDigit();
    const wheel = this.input.takeWheel();
    if (slot === null && wheel) slot = (((this.inv.slot + wheel) % HOTBAR) + HOTBAR) % HOTBAR;
    if (slot === null || slot >= HOTBAR || slot === this.inv.slot) return;
    this.selectSlot(slot);
  }

  /* The nearest thing in front of you worth pressing E on. */
  private findFocus(b: Body): Focus | null {
    const world = this.world;
    if (!world) return null;
    const fx = -Math.sin(b.yaw);
    const fz = -Math.cos(b.yaw);
    let best: Focus | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const consider = (x: number, y: number, z: number, reach: number, f: () => Focus) => {
      const dx = x - b.x;
      const dz = z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > reach || Math.abs(y - b.y) > 2.5) return;
      const facing = d < 0.8 ? 1 : (dx * fx + dz * fz) / d;
      if (facing < 0.25) return;
      const score = d * (2 - facing);
      if (score < bestScore) {
        bestScore = score;
        best = f();
      }
    };
    if (this.boat) return { kind: "prefab", id: this.boat.id, label: "E · Get out" };
    const bd = world.ground.primary?.board;
    if (FEATURES.bounties && bd)
      consider(bd.x, bd.y, bd.z, 3.4, () => ({ kind: "board", id: 0, label: "E · Bounty board" }));
    const sh = world.ground.primary?.shop;
    if (FEATURES.shop && sh)
      consider(sh.x, sh.y, sh.z, 3.4, () => ({
        kind: "shop",
        id: 0,
        label: "E · The keeper's stall",
      }));
    for (const p of this.built.list()) {
      if (p.kind === "rowboat")
        consider(p.x, b.y, p.z, BOAT_REACH, () => ({
          kind: "prefab",
          id: p.id,
          label: "E · Get in the rowboat",
        }));
      else if (p.kind === "chest")
        consider(p.x, p.y, p.z, 2.4, () => ({
          kind: "chest",
          id: p.id,
          label: "E · Open the chest",
        }));
      else if (p.kind === "bed")
        consider(p.x, p.y, p.z, 2.6, () => ({
          kind: "prefab",
          id: p.id,
          label: "E · Rest (you'll wake here)",
        }));
    }
    return best;
  }

  private rodHint() {
    if (this.myLine) return "Click to reel in";
    return "Click to cast · deeper water, rarer fish";
  }

  /* ---------- building ---------- */

  private ownedKits() {
    return KIT_IDS.filter((k) => (this.inv.items[k] ?? 0) > 0);
  }

  private toggleBuild() {
    if (this.build) {
      this.endBuild();
      return;
    }
    if (this.boat) {
      this.say("Not from a boat", 2);
      return;
    }
    if (!this.ownedKits().length) {
      this.say(
        FEATURES.shop
          ? "Nothing to build yet. The keeper's stall at the lighthouse sells kits."
          : "Nothing to build yet.",
        3,
      );
      return;
    }
    if (this.myLine) this.conn?.send({ t: "reel", at: -1 });
    this.build = { index: 0, turn: 0, aim: null, verdict: null, target: null };
  }

  private endBuild() {
    this.build = null;
    this.built.ghost.show(null);
  }

  /* Number keys or the wheel pick a kit, R turns it, click places, right-click takes back. */
  private buildInput(b: Body) {
    const build = this.build!;
    const kits = this.ownedKits();
    if (!kits.length) {
      this.endBuild();
      return;
    }
    const digit = this.input.takeDigit();
    const wheel = this.input.takeWheel();
    if (digit !== null && digit < kits.length) build.index = digit;
    else if (wheel)
      build.index = (((build.index + wheel) % kits.length) + kits.length) % kits.length;
    build.index = Math.min(build.index, kits.length - 1);
    if (this.input.take("rotate")) build.turn += Math.PI / 4;
    const kind = kits[build.index];
    const rot = b.yaw + build.turn;
    this.aimBuild(b, kind, rot);

    if (this.input.take("attack")) {
      if (build.target) this.say("Right-click to take that back first", 2);
      else if (build.aim && build.verdict?.ok)
        this.conn?.send({ t: "place", kind, x: build.aim.x, z: build.aim.z, rot });
      else if (build.verdict?.reason) this.say(build.verdict.reason, 2);
    }
    this.input.take("attackUp");
    if (this.input.take("alt") && build.target)
      this.conn?.send({ t: "pickup", id: build.target.id });
  }

  /*
   * Walk a ray out from the eye until it meets the ground (or a floor, or the
   * sea for things that go on water), and judge the spot.
   */
  private aimBuild(b: Body, kind: KitId, rot: number) {
    const build = this.build!;
    const world = this.world!;
    const def = PREFABS[kind];
    const dir = this.tmpF.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const p = this.tmpV.copy(this.camera.position);
    let hit: { x: number; y: number; z: number } | null = null;
    for (let d = 0; d < BUILD_REACH + 2; d += 0.25) {
      p.addScaledVector(dir, d === 0 ? 0 : 0.25);
      let ground = def.onFloors
        ? world.ground.groundAt(p.x, p.z, p.y).ground
        : world.ground.heightAt(p.x, p.z);
      if (def.placing !== "land") ground = Math.max(ground, SEA_LEVEL);
      if (p.y <= ground) {
        hit = { x: p.x, y: ground, z: p.z };
        break;
      }
    }
    if (!hit) {
      const reach = BUILD_REACH - 0.5;
      const flat = Math.hypot(dir.x, dir.z) || 1;
      const x = b.x + (dir.x / flat) * reach;
      const z = b.z + (dir.z / flat) * reach;
      hit = { x, y: world.ground.heightAt(x, z), z };
    }
    /* Something already built under the crosshair? Then that's what you're pointing at. */
    let target: Prefab | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const q of this.built.list()) {
      if (!overPrefab(q, hit.x, hit.z, 0.25) || Math.abs(hit.y - q.y) > 4) continue;
      const d = Math.hypot(q.x - hit.x, q.z - hit.z);
      if (d < best) {
        best = d;
        target = q;
      }
    }
    /* A bed in a hut is pointed at the bed, not the hut. */
    if (
      target &&
      def.onFloors &&
      (target.kind === "hut" || target.kind === "cabin" || target.kind === "dock")
    )
      target = this.smallestAt(hit.x, hit.z) ?? null;
    build.target = target;
    build.aim = hit;
    if (target) {
      build.verdict = null;
      this.built.ghost.show(target.kind, target.x, target.y, target.z, target.rot, "pick");
      return;
    }
    build.verdict = checkPlacement(world.ground, kind, hit.x, hit.z, rot, b);
    this.built.ghost.show(kind, hit.x, build.verdict.y, hit.z, rot, build.verdict.ok ? "ok" : "no");
  }

  /* The small things (chest, bed, campfire) at a spot, if any. */
  private smallestAt(x: number, z: number) {
    for (const q of this.built.list()) {
      if (PREFABS[q.kind].onFloors && overPrefab(q, x, z, 0.25)) return q;
    }
    return null;
  }

  private buildView(): BuildView | null {
    const build = this.build;
    if (!build) return null;
    const kits = this.ownedKits();
    return {
      kits: kits.map((k) => ({ id: k, name: ITEMS[k].name, count: this.inv.items[k] ?? 0 })),
      index: Math.min(build.index, kits.length - 1),
      ok: !!build.verdict?.ok,
      reason: build.verdict?.reason ?? null,
      target: build.target ? ITEMS[build.target.kind].name : null,
    };
  }

  /* ---------- panels ---------- */

  openPanel(kind: PanelKind) {
    this.endBuild();
    this.panel = kind;
    this.input.clear();
    this.input.unlock();
    this.emitHud();
  }

  closePanel() {
    if (!this.panel) return;
    this.panel = null;
    this.emitHud();
    this.lock();
  }

  buy(item: string) {
    this.conn?.send({ t: "buy", item });
  }

  /* What you wear, as others see you. */
  get skin(): SkinId {
    return readSkin();
  }

  /*
   * Wear a skin from the marketplace. This browser remembers it for next
   * time; when online, everyone else sees the change straight away.
   */
  wear(skin: SkinId) {
    if (!canWear(skin)) return;
    keepSkin(skin);
    if (this.conn?.kind === "online") this.conn.send({ t: "skin", skin });
  }

  /* Into the open chest (n > 0) or out of it (n < 0). */
  stash(item: ItemId, n: number) {
    if (this.chestId !== null) this.conn?.send({ t: "stash", chest: this.chestId, item, n });
  }

  private shopView(): ShopView[] {
    return SHOP.map((e) => {
      const kit = "kit" in e.give ? e.give.kit : null;
      const tool = "tool" in e.give ? e.give.tool : null;
      return {
        id: e.id,
        section: e.section,
        name: kit ? ITEMS[kit].name : TOOLS[tool!].name,
        note: kit ? ITEMS[kit].note : (TOOL_NOTES[tool!] ?? ""),
        price: e.price,
        owned: kit
          ? (this.inv.items[kit] ?? 0) + [...this.built.list()].filter((p) => p.kind === kit).length
          : this.inv.tools.filter((t) => t.kind === tool).length,
      };
    });
  }

  private nearShop() {
    const b = this.body;
    const s = this.world?.ground.primary?.shop;
    return !!b && !!s && Math.hypot(s.x - b.x, s.z - b.z) < SHOP_REACH && Math.abs(s.y - b.y) < 3;
  }

  private chestView() {
    if (this.panel !== "chest" || this.chestId === null) return null;
    const store = this.built.get(this.chestId)?.store ?? {};
    return (Object.entries(store) as [ItemId, number][])
      .filter(([, n]) => n > 0)
      .map(([id, count]) => ({ id, name: ITEMS[id].name, count }));
  }

  acceptBounty(id: number) {
    this.conn?.send({ t: "accept", id });
  }

  turnIn() {
    this.conn?.send({ t: "turnin" });
  }

  abandonBounty() {
    this.conn?.send({ t: "abandon" });
  }

  private bountyView(b: Bounty): BountyView {
    return {
      id: b.id,
      title: bountyTitle(b),
      note: bountyNote(b),
      reward: b.reward,
      have: progress(this.inv, b),
      need: b.count,
    };
  }

  private nearBoard() {
    const b = this.body;
    const bd = this.world?.ground.primary?.board;
    return (
      !!b && !!bd && Math.hypot(bd.x - b.x, bd.z - b.z) < BOARD_REACH && Math.abs(bd.y - b.y) < 3
    );
  }

  equip(tool: number, slot: number) {
    this.conn?.send({ t: "equip", tool, slot });
  }

  selectSlot(slot: number) {
    if (slot < 0 || slot >= HOTBAR) return;
    this.inv.slot = slot;
    this.chargeStart = null;
    this.conn?.send({ t: "slot", i: slot });
    this.emitHud();
  }

  private toolView(id: number | null): ToolView | null {
    const tool = id == null ? null : this.inv.tools.find((t) => t.id === id);
    if (!tool) return null;
    return { id: tool.id, kind: tool.kind, name: TOOLS[tool.kind].name };
  }

  private inventoryView(): InventoryView {
    const inv = this.inv;
    const items: InventoryView["items"] = [];
    for (const [id, n] of Object.entries(inv.items) as [ItemId, number][]) {
      if (!n) continue;
      const def = ITEMS[id];
      items.push({ id, name: def.name, count: n, kind: def.kind, rarity: def.rarity });
    }
    return {
      coins: inv.coins,
      slot: inv.slot,
      hotbar: inv.hotbar.map((id) => this.toolView(id)),
      pack: inv.tools
        .filter((t) => !inv.hotbar.includes(t.id))
        .map((t) => this.toolView(t.id))
        .filter((t): t is ToolView => !!t),
      items,
    };
  }

  private firstPerson(dt: number, b: Body) {
    /* Sitting in a boat, lower, and rocking with it. */
    const t = performance.now() / 1000;
    const eye = this.boat
      ? b.y + EYE_HEIGHT - 0.55 + Math.sin(t * 1.3 + this.boat.id) * 0.04
      : b.y + EYE_HEIGHT;
    if (eye > this.smoothEye && eye - this.smoothEye < 5 && !this.flying) {
      this.smoothEye += (eye - this.smoothEye) * Math.min(1, dt * 16);
    } else this.smoothEye = eye;

    this.dip = Math.max(0, this.dip - dt * 3);
    this.kick += (0 - this.kick) * Math.min(1, dt * 7);
    const bobY = Math.abs(Math.sin(this.bob * 0.5)) * 0.07 * this.bobAmp;
    const bobX = Math.sin(this.bob * 0.5) * 0.04 * this.bobAmp;

    this.camera.position.set(b.x, this.smoothEye + bobY - this.dip * 0.35, b.z);
    this.camera.rotation.set(
      this.input.pitch - this.kick * 0.06 - this.dip * 0.05,
      this.input.yaw,
      bobX * 0.3,
      "YXZ",
    );
    this.camera.translateX(bobX);

    /* The view widens as you pick up speed in the air. */
    const rush = this.flying ? Math.min(1, Math.hypot(b.vx, b.vz) / FLY_BOOST) : 0;
    const targetFov = BASE_FOV + (b.sprinting ? 7 : 0) + rush * 22 + Math.abs(this.kick) * 4;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 6);
    this.setFov(this.fov);
  }

  private rodPose(): RodPose {
    if (this.bite) return "bite";
    return this.myLine ? "out" : "idle";
  }

  /* Down: the view slumps to the ground and tips over. */
  private fallen(dt: number, b: Body) {
    const k = clamp((performance.now() / 1000 - this.downAt) / 1.1, 0, 1);
    const ease = 1 - (1 - k) ** 3;
    const floor = Math.max(b.y + 0.35, SEA_LEVEL + 0.25);
    this.camera.position.set(b.x, lerp(this.smoothEye, floor, ease), b.z);
    this.camera.rotation.set(
      lerp(this.input.pitch, -0.35, ease),
      this.input.yaw,
      ease * 1.1,
      "YXZ",
    );
    this.fov += (BASE_FOV - this.fov) * Math.min(1, dt * 4);
    this.setFov(this.fov);
  }

  private orbitCamera(dt: number) {
    const world = this.world;
    if (!world) return;
    const t = performance.now() / 1000;
    /* Round the newest island (yours, once you've settled), or out over the open sea. */
    const islands = [...world.islands.values()];
    const focus = world.islands.get(this.mine ?? -1) ?? islands[islands.length - 1];
    const lh = focus
      ? world.ground.islands.get(focus.info.id)!.terrain.lighthouse
      : { x: 0, y: 0, z: 0 };
    const a = t * 0.03;
    const radius = 210;
    const cx = focus ? focus.info.x : 0;
    const cz = focus ? focus.info.z : 0;
    this.tmpV.set(cx + (lh.x - cx) * 0.5, lh.y * 0.4, cz + (lh.z - cz) * 0.5);
    this.camera.position.set(
      this.tmpV.x + Math.cos(a) * radius,
      lh.y * 0.55 + 52 + Math.sin(t * 0.07) * 8,
      this.tmpV.z + Math.sin(a) * radius,
    );
    this.camera.lookAt(this.tmpV);
    this.fov += (58 - this.fov) * Math.min(1, dt * 3);
    this.setFov(this.fov);
  }

  private setFov(fov: number) {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  private updateRemotes(dt: number) {
    const delay = this.mode === "online" ? 0.12 : 0.07;
    const t = this.worldTime() - delay;
    for (const r of this.remotes.values()) {
      const buf = r.buf;
      if (!buf.length) {
        r.avatar.group.visible = false;
        continue;
      }
      let a = buf[0];
      let b = buf[0];
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= t) {
          a = buf[i];
          b = buf[Math.min(i + 1, buf.length - 1)];
          break;
        }
      }
      const span = b.t - a.t;
      const k = span > 0 ? clamp((t - a.t) / span, 0, 1) : 1;
      let dyaw = b.yaw - a.yaw;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      r.avatar.group.visible = true;
      r.avatar.setPose(
        lerp(a.x, b.x, k),
        lerp(a.y, b.y, k),
        lerp(a.z, b.z, k),
        a.yaw + dyaw * k,
        lerp(a.pitch, b.pitch, k),
        b.flags,
        dt,
        this.camera.position,
      );
    }
  }

  /* On the Harbor's tile: common ground, where nobody comes to harm. */
  private onHarbor() {
    const b = this.body;
    const world = this.world;
    if (!b || !world || this.mode !== "online") return false;
    for (const o of world.islands.values()) {
      if (!o.info.harbor) continue;
      if (world.ground.islands.get(o.info.id)?.terrain.contains(b.x, b.z)) return true;
    }
    return false;
  }

  /* ---------- HUD ---------- */

  private emitHud() {
    const now = performance.now() / 1000;
    if (this.notice && now > this.noticeUntil) this.notice = null;
    this.feed = this.feed.filter((f) => now - f.at < 7);
    const playing = !!this.body && !this.down;
    const def = weaponDef(this.weapon);

    /* Whoever's under the crosshair, close enough to hit. */
    let target: HudState["target"] = null;
    if (playing) {
      const fwd = this.tmpF.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      let best = 0.985;
      for (const r of this.remotes.values()) {
        if (!r.avatar.group.visible) continue;
        const to = this.tmpV.copy(r.avatar.group.position);
        to.y += 1.2;
        to.sub(this.camera.position);
        const d = to.length();
        if (d > 8) continue;
        const dot = to.normalize().dot(fwd);
        if (dot > best) {
          best = dot;
          target = { name: r.name, health: null };
        }
      }
      for (const a of this.herd.list().values()) {
        if (a.state === ANIMAL_STATE.dead) continue;
        const to = this.tmpV.set(a.x, a.y + (a.kind === "deer" ? 1.1 : 0.6), a.z);
        to.sub(this.camera.position);
        const d = to.length();
        if (d > 12) continue;
        const dot = to.normalize().dot(fwd);
        if (dot > best - 0.02) {
          best = dot;
          target = { name: a.kind === "deer" ? "Deer" : "Boar", health: a.health };
        }
      }
    }
    const prompt = playing && this.focus ? this.focus.label : null;
    const held = heldTool(this.inv);

    this.onHud({
      mode: this.mode,
      connecting: this.connecting,
      settling: this.settling
        ? {
            error: this.settleError,
            pending: this.settlePending,
            islands: this.world?.islands.size ?? 0,
          }
        : null,
      sheltered: playing && this.onHarbor(),
      travel:
        this.mode === "online" && playing
          ? { home: this.mine !== null, onHarbor: this.onHarbor(), claimable: this.mine === null }
          : null,
      notice: this.notice,
      humans: this.roster.length,
      name: this.myName,
      player: playing,
      creative: this.creative,
      flying: this.flying,
      health: this.health,
      hurt: this.hurtFlash,
      down: this.down,
      stamina: this.body ? this.body.stamina / STAMINA_MAX : 1,
      shove: clamp((this.attackReadyAt - now) / def.cooldown, 0, 1),
      underwater: this.under > 0.5,
      feed: [...this.feed],
      locked: this.touch || this.input.locked || this.forceActive,
      inv: this.inventoryView(),
      panel: this.panel,
      hint: this.flying
        ? "Space up · Shift down · double-tap W to rush · double-tap Space to drop"
        : this.boat
          ? `W/S row · A/D turn · E get out${held && TOOLS[held.kind].rod ? ` · ${this.rodHint()}` : ""}`
          : held && TOOLS[held.kind].rod
            ? this.rodHint()
            : held
              ? def.hint
              : null,
      fishing: this.myLine
        ? {
            state: this.myLine.state,
            text: this.bite
              ? `${BITE_TEXT[this.bite.strike.rarity]} · click when the needle's in the mark`
              : `${WATERS_LABEL[watersFor(this.myLine.depth)]} · ${this.myLine.depth.toFixed(1)} m · waiting for a bite`,
            strike: this.bite?.strike ?? null,
            at: this.bite?.at ?? 0,
          }
        : null,
      banner: this.banner && now - this.banner.at < 2.8 ? this.banner : null,
      economy: FEATURES.bounties,
      bounty: this.inv.bounty ? this.bountyView(this.inv.bounty) : null,
      board: this.board.map((b) => this.bountyView(b)),
      nearBoard: this.nearBoard(),
      shop: this.panel === "shop" ? this.shopView() : [],
      nearShop: this.nearShop(),
      chest: this.chestView(),
      build: this.buildView(),
      charge:
        this.chargeStart !== null && def.charge
          ? Math.min(1, (now - this.chargeStart) / def.charge.max)
          : null,
      blocking: this.blocking,
      hitMarker: this.hitMarker,
      hitText: this.hitText,
      prompt,
      target,
    });
  }
}
