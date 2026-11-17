import * as THREE from "three";
import {
  EYE_HEIGHT,
  FLY_BOOST,
  HEALTH_MAX,
  SEA_LEVEL,
  STAMINA_MAX,
  TICK_HZ,
} from "../shared/constants";
import {
  distanceTo,
  type DriveIntent,
  eyeOf,
  riderPose,
  stepVehicle,
  unpackVehicle,
  type VehicleSnap,
  type VehicleState,
  vehicleSolids,
} from "../shared/drive";
import { swamped } from "../shared/car";
import type { CrewView, Order } from "../shared/crew";
import { FEATURES } from "../shared/features";
import { clamp, lerp, wrapAngle } from "../shared/math";
import {
  BOARD_REACH,
  type BoardState,
  type Contract,
  contractTitle,
  type Payout,
  progress,
} from "../shared/missions";
import { type Body, createBody, FLOAT_DEPTH, stepBody, stepFly } from "../shared/physics";
import {
  ANIMAL_STATE,
  FLAG,
  type HurtCause,
  type InteractKind,
  type PlayerSnap,
  type PlotState,
  RIDE_FIELDS,
  type RosterEntry,
  type ServerMsg,
  type Spawn,
  type WorldInfo,
} from "../shared/protocol";
import { canWear, type SkinId, skinDef } from "../shared/skins";
import {
  afloat,
  BROADSIDE_RELOAD,
  BOARD_REACH as RIDE_REACH,
  controlsOf,
  gunsOf,
  RIDER_HIP,
  VEHICLES,
  type VehicleKind,
  vehicleFromIndex,
} from "../shared/vehicles";
import { windAt } from "../shared/wind";
import { Archipelago } from "../shared/archipelago";
import type { IslandInfo, PlotShapeId } from "../shared/islands";
import {
  CATALOGUE,
  type CatalogueId,
  ITEM_STATE,
  type ItemSnap,
  type PlacedItem,
  resale,
  unpackItem,
} from "../shared/catalogue";
import { repairCost } from "../shared/siege";
import {
  checkItem,
  FINE_ROT_STEP,
  itemKey,
  itemSolids,
  overItem,
  PLACE_REACH,
  ROT_STEP,
  type Snapped,
  snapItem,
  type Verdict,
} from "../shared/placing";
import {
  checkPlotSpot,
  PLOT_SIZES,
  type PlotSizeId,
  plotTeam,
  type SpotCheck,
} from "../shared/plots";
import { CAPTURE_STATE, CAPTURE_TIME, type CaptureState } from "../shared/raids";
import { type Role, SPECIES } from "../shared/species";
import {
  emptyInventory,
  HOTBAR,
  heldTool,
  type Inventory,
  ITEMS,
  type ItemId,
  TOOLS,
  type ToolKind,
} from "../shared/items";
import {
  COMBO_WINDOW,
  DAZE_SPEED,
  guardOf,
  isThrown,
  type WeaponKind,
  weaponDef,
  weaponFromIndex,
} from "../shared/weapons";
import { TideAudio } from "./audio";
import { Input } from "./input";
import { drawRoutes, islandImage, type MapView } from "./map";
import { CREATIVE, type CameraView, keepView, readView } from "./modes";
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
import { preloadCharacters } from "./scene/characters";
import { CrewsView } from "./scene/crew";
import { HerdView } from "./scene/herd";
import { type Blaze, Fx } from "./scene/fx";
import { ItemsView } from "./scene/items";
import { ShotsView } from "./scene/shots";
import { createLand, OpenSea } from "./scene/land";
import { PALETTE, shared } from "./scene/materials";
import { PostPass } from "./scene/post";
import { RaidView } from "./scene/raids";
import { WorldProps } from "./scene/props";
import { Clouds } from "./scene/clouds";
import { NO_CAST, SunShadows } from "./scene/shadows";
import { Sky } from "./scene/sky";
import { enclosed, stateFrom, VehicleView } from "./scene/vehicles";
import { ViewModel } from "./scene/weapons";

/* The title screen, or the game: online, on the grand map. */
export type Mode = "attract" | "online";

export type FeedItem = { id: number; text: string; at: number };

export type PanelKind = "inventory" | "board";

export type ContractView = {
  id: number;
  title: string;
  note: string;
  /* Where they're most often found. */
  island: string | null;
  role: Role;
  reward: number;
  have: number;
  need: number;
};

/* The Guild Board, as the panel and the HUD show it. Times are seconds from now. */
export type GuildView = {
  near: boolean;
  mission: ContractView | null;
  contracts: ContractView[];
  alpha: {
    name: string;
    kind: string;
    island: string;
    reward: number;
    left: number;
    slainBy: string | null;
  } | null;
  cull: {
    island: string;
    kind: string;
    need: number;
    done: number;
    pot: number;
    left: number;
    state: "active" | "cleared" | "failed";
    hunters: { name: string; kills: number }[];
  } | null;
  nextAlpha: number | null;
  nextCull: number | null;
  payouts: Payout[];
  owed: number;
};

export type ToolView = {
  id: number;
  kind: ToolKind;
  name: string;
  /* How many are left of a stack (kegs, smoke bombs). */
  count: number | null;
};

export type InventoryView = {
  coins: number;
  slot: number;
  hotbar: (ToolView | null)[];
  pack: ToolView[];
  items: { id: ItemId; name: string; count: number }[];
};

/* Something you could press E on: in the room's world, a panel to open here, or something of yours to move. */
type Focus = { kind: InteractKind | "board" | "item"; id: number; label: string };

/* Setting something down: what it is, where the ghost is, and whether it can go there. */
export type PlacingView = {
  name: string;
  price: number;
  moving: boolean;
  ok: boolean;
  reason: string | null;
  snapped: boolean;
};

/* Your land, as the marketplace's build shelves need to know it. */
export type BuildView = {
  /* Out in the world, able to build at all. */
  ashore: boolean;
  /* Your land: its name, what's on it of how much it holds, and how many men it houses. */
  plot: { name: string; items: number; cap: number; crew: number } | null;
  /* Standing on it. */
  onPlot: boolean;
  coins: number;
};

export type HudState = {
  mode: Mode;
  connecting: boolean;
  /* Standing on the Harbor: common ground, where nobody can be hurt. */
  sheltered: boolean;
  /* The island you're on (or nearest, out on the water), online. */
  place: string | null;
  notice: string | null;
  humans: number;
  name: string;
  player: boolean;
  /* Creative mode: flying about, and nothing hurts you. */
  creative: boolean;
  /* Up in the air in creative. */
  flying: boolean;
  /* Where the camera is: at your eyes, or behind you. */
  view: CameraView;
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
  /* A big line of news for a moment: a payout, an alpha sighted, an island overrun. */
  banner: { title: string; sub: string | null; at: number } | null;
  /* The Guild Board and coins are switched on. */
  economy: boolean;
  guild: GuildView;
  /* 0..1 while winding up a warhammer or greatsword, or drawing a bow. */
  charge: number | null;
  /* Holding a bow or something to throw: the crosshair is a sight. */
  ranged: boolean;
  /* The vehicle you're in, once it's been battered: what's left of its hull, 0..1. */
  hull: number | null;
  /* At a ship's helm: seconds till each broadside is loaded again (0: ready). */
  guns: { port: number; starboard: number } | null;
  blocking: boolean;
  /* Fades from 1 after you land a hit, with what it did. */
  hitMarker: number;
  hitText: string | null;
  prompt: string | null;
  target: { name: string; health: number | null } | null;
  /* Setting something down on your land. */
  placing: PlacingView | null;
  /* Looking at something of yours: it can be moved or sold. */
  ownItem: boolean;
  /* What mending the thing of yours you're looking at would cost, if it needs it. */
  repair: number | null;
  /* The isle you're raiding, if you are. */
  raid: string | null;
  /* Raiders on your own land right now. */
  besieged: number;
  /* A Hearth being taken near you (yours, or the one you're taking): 0..1, and how it's going. */
  capture: {
    title: string;
    progress: number;
    state: "taking" | "contested" | "falling";
    /* Your own Hearth. */
    mine: boolean;
  } | null;
  /* Raiders landing on your land: a loud alert for a few seconds. */
  alarm: { title: string; sub: string; at: number } | null;
  /* Your crew, if you've hired any: what they've been told, how many, and how many are down. */
  crew: { order: Order; men: number; down: number } | null;
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
type DevAvatarSpec = {
  skin: SkinId;
  x: number;
  y: number;
  z: number;
  yaw?: number;
  pitch?: number;
  flags?: number;
  vx?: number;
  vz?: number;
  weapon?: WeaponKind | null;
  stagger?: number;
  name?: string;
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

const BASE_FOV = 76;

/* The same ground: everything an island is raised from. */
function sameLand(a: IslandInfo, b: IslandInfo) {
  return (
    a.shape === b.shape && a.seed === b.seed && a.x === b.x && a.z === b.z && a.size === b.size
  );
}

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
  private camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.08, 4500);
  private post = new PostPass();
  private sky = new Sky();
  private clouds = new Clouds();
  private shadows = new SunShadows();
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
  private herd = new HerdView();
  /* Everyone's crews near you, and your own as the room last told it. */
  private crews = new CrewsView(this.scene, (plot) => this.crewLabel(plot));
  private myCrew: { order: Order; men: CrewView[] } = { order: "home", men: [] };
  private vehicles = new VehicleView();
  /* What's been bought for the plots, by plot, and drawn. */
  private plotItems = new Map<number, Map<number, PlacedItem>>();
  /* Which plot each thing stands on, and the ones on fire (or smouldering after), for the effects. */
  private itemPlot = new Map<number, number>();
  private blazes = new Map<number, Blaze & { burning: boolean }>();
  private built = new ItemsView();
  private fx = new Fx();
  /* Arrows, cannonballs and kegs in flight (and stuck, and lying on their fuses). */
  private shotsView = new ShotsView(this.fx, this.audio, {
    near: (x, y, z) => {
      const d = this.camera.position.distanceTo(this.tmpV.set(x, y, z));
      return clamp(1 - d / 160, 0, 1) ** 1.5;
    },
    groundAt: (x, z) => this.world?.ground.heightAt(x, z) ?? 0,
  });
  /* Who let each shot in the air fly, for the hit marker. */
  private shotBy = new Map<number, number>();
  /* Hulls the room has said were battered: what's left of each. */
  private hulls = new Map<number, { hp: number; max: number }>();
  /* When each broadside (port, starboard) of the ship you're steering is loaded again. */
  private broadsideAt: [number, number] = [0, 0];
  /* Raids: every plot's shield and raiders (with when, on our clock, each shield drops), the Hearths being taken, and our own raid. */
  private raids = new RaidView();
  private plotStates = new Map<number, PlotState & { until: number }>();
  private captures = new Map<number, { progress: number; state: CaptureState; by: number }>();
  private raiding: number | null = null;
  private alarm: HudState["alarm"] = null;
  /* Your bucket has water in it. */
  private water = false;
  /*
   * Setting something down: what, how it's turned, which of yours is being
   * moved (null: a new one, paid for when it goes down), and where the ghost is.
   */
  private placing: {
    kind: CatalogueId;
    turn: number;
    move: number | null;
    at: (Snapped & { y: number }) | null;
    verdict: Verdict | null;
    reason: string | null;
  } | null = null;
  /* X pressed once on something of yours: a second press within a moment sells it. */
  private sellArmed: { id: number; until: number } | null = null;
  /*
   * The vehicle you're in and your seat. At the helm (seat 0) you steer it:
   * `state` is where your own driving has it, reported to the room.
   */
  private ride: {
    id: number;
    seat: number;
    kind: VehicleKind;
    state: VehicleState | null;
    /* Its heading last frame, so the view turns with it. */
    yaw: number;
    /* A car that's run into the sea: for the splash. */
    wet?: boolean;
  } | null = null;
  private strokeAt = 0;
  private bumpAt = 0;
  private animalStates = new Map<number, number>();
  private banner: HudState["banner"] = null;
  private board: BoardState = {
    contracts: [],
    alpha: null,
    cull: null,
    nextAlpha: null,
    nextCull: null,
  };
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
  /*
   * The camera: `footView` is what you chose on foot (V switches it), `view`
   * what it is right now. Climbing aboard anything puts it behind you; V
   * still switches it while you ride, and stepping off goes back to yours.
   */
  private footView: CameraView = readView();
  private view: CameraView = this.footView;
  /* You, drawn for the view from behind. */
  private self: Avatar | null = null;
  /* How far back the camera is behind you right now (pulled in when the ground is in the way). */
  private chaseDist = 0;

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
  private tmpE = new THREE.Vector3();

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
    this.scene.add(this.clouds.group);
    /* The sky, the sea and the clouds are drawn but cast no shadow (see SunShadows). */
    this.sky.group.traverse((o) => o.layers.set(NO_CAST));
    this.camera.layers.enable(NO_CAST);
    /*
     * The pack models (animals, trees, rocks) are lit like the rest of the
     * world: one sun from where the sky draws it, a violet sky above and the
     * land's colour bounced from below, and the same haze in the distance.
     */
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.copy(shared.uSun.value).multiplyScalar(100);
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0xd9d3ff, PALETTE.land, 1.25));
    this.scene.fog = new THREE.FogExp2(PALETTE.horizon, shared.uFog.value);
    this.scene.add(this.herd.group);
    this.scene.add(this.vehicles.group);
    this.scene.add(this.built.group);
    this.scene.add(this.fx.group);
    this.scene.add(this.shotsView.group);
    this.scene.add(this.raids.group);

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

  /* Dev/test only: hold the camera at a fixed spot (x, y, z, yaw, pitch in radians), or null to let go. */
  devCamera: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;

  /*
   * Dev/test only: a stand-in player to look at, holding still flags and
   * gliding at (vx, vz) m/s, back to its start every three seconds. `strike`
   * swings, `hurt` flinches; null clears them all.
   */
  private devAvatars: { avatar: Avatar; spec: DevAvatarSpec; t: number }[] = [];
  devAvatar(spec: DevAvatarSpec | null) {
    if (!spec) {
      for (const d of this.devAvatars) {
        this.scene.remove(d.avatar.group);
        d.avatar.dispose();
      }
      this.devAvatars = [];
      return null;
    }
    const avatar = new Avatar(-1 - this.devAvatars.length, spec.name ?? "Stand-in", spec.skin);
    avatar.setGear(spec.weapon ?? null, spec.stagger ?? 0);
    this.scene.add(avatar.group);
    const d = { avatar, spec, t: 0 };
    this.devAvatars.push(d);
    return {
      strike: (heavy = false) => avatar.strike(heavy),
      hurt: () => avatar.hurt(),
      set: (more: Partial<DevAvatarSpec>) => {
        Object.assign(spec, more);
        if (more.skin) avatar.setSkin(more.skin);
        avatar.setGear(spec.weapon ?? null, spec.stagger ?? 0);
      },
    };
  }

  private updateDevAvatars(dt: number) {
    for (const d of this.devAvatars) {
      const s = d.spec;
      d.t = (d.t + dt) % 3;
      d.avatar.setPose(
        s.x + (s.vx ?? 0) * d.t,
        s.y,
        s.z + (s.vz ?? 0) * d.t,
        s.yaw ?? 0,
        s.pitch ?? 0,
        s.flags ?? FLAG.alive | FLAG.grounded,
        dt,
        this.camera.position,
      );
    }
  }

  /* Dev/test only: treat input as live without pointer lock. */
  get forceActive() {
    return this.forced;
  }

  set forceActive(on: boolean) {
    this.forced = on;
    this.conn?.setPaused(this.shouldPause());
  }

  /* The weapon in hand (null for fists). */
  private get weapon() {
    const tool = heldTool(this.inv);
    return tool ? TOOLS[tool.kind].weapon : null;
  }

  get canvas() {
    return this.renderer.domElement;
  }

  /* ---------- lifecycle ---------- */

  /* The username to go ashore under, from the title screen. */
  start(mode: Mode, name: string | null = null) {
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
      this.herd.preload();
      preloadCharacters([skinDef(this.skin).character]);
      const base = serverBase();
      if (!base) {
        this.input.unlock();
        this.say("The sea can't be reached right now.", 5);
        this.start("attract");
        return;
      }
      this.connecting = true;
      this.conn = new WsConnection(base, handlers, name);
    } else this.conn = new LocalConnection(handlers, { seed });
    this.emitHud();
  }

  private reset() {
    for (const r of this.remotes.values()) {
      this.scene.remove(r.avatar.group);
      r.avatar.dispose();
    }
    this.remotes.clear();
    this.crews.clear();
    this.myCrew = { order: "home", men: [] };
    this.roster = [];
    this.body = null;
    this.down = null;
    this.health = HEALTH_MAX;
    this.inv = emptyInventory();
    this.panel = null;
    this.focus = null;
    this.herd.clear();
    this.vehicles.clear();
    this.shotsView.clear();
    this.shotBy.clear();
    this.hulls.clear();
    this.broadsideAt = [0, 0];
    this.clearItems();
    this.endPlacing();
    this.ride = null;
    this.audio.motor(null);
    this.creative = false;
    this.flying = false;
    this.safeFall = false;
    this.view = this.footView;
    if (this.self) this.self.group.visible = false;
    this.animalStates.clear();
    this.banner = null;
    this.plotStates.clear();
    this.captures.clear();
    this.raiding = null;
    this.alarm = null;
    this.board = { contracts: [], alpha: null, cull: null, nextAlpha: null, nextCull: null };
    this.chargeStart = null;
    this.blocking = false;
    this.feed = [];
    this.haveClock = false;
    this.myId = -1;
    this.dazeUntil = 0;
    this.input.clear();
  }

  /* The weapon you carry: what's in your pack once you're out there, or what this browser chose. */
  get armedWith(): WeaponKind | null {
    if (this.body) {
      const tool = this.inv.tools.find((t) => !isThrown(t.kind));
      return tool ? TOOLS[tool.kind].weapon : null;
    }
    return readWeapon() ?? null;
  }

  /*
   * Take up a weapon from the marketplace (null: put it away). This browser
   * remembers it, and you arrive carrying it next time.
   */
  arm(kind: WeaponKind | null) {
    /* A keg or a smoke bomb is bought, not carried as your weapon. */
    if (!isThrown(kind)) keepWeapon(kind);
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

  /* ---------- land ---------- */

  /* Coins in your purse: the marketplace's land is paid for from it. */
  get coins(): number {
    return this.inv.coins;
  }

  /* Land is sold out on the grand map, once you're there. */
  get canBuyLand(): boolean {
    return this.canSpawn;
  }

  /* Your own plot, if you have one. */
  get myPlot(): IslandInfo | null {
    for (const o of this.world?.islands.values() ?? []) if (o.info.plot?.mine) return o.info;
    return null;
  }

  /* Whether a plot of this size could go at (x, z): the same check the room makes. */
  checkPlot(size: PlotSizeId, x: number, z: number, ignore: number | null = null): SpotCheck {
    const ground = this.world?.ground;
    if (!ground) return { ok: false, reason: "The map isn't charted yet" };
    return checkPlotSpot(ground.islands.values(), size, x, z, ignore);
  }

  buyPlot(size: PlotSizeId, shape: PlotShapeId, x: number, z: number) {
    if (this.canBuyLand) this.conn?.send({ t: "buyplot", size, shape, x, z });
  }

  growPlot(size: PlotSizeId) {
    if (this.canBuyLand) this.conn?.send({ t: "growplot", size });
  }

  /* Dev only: a purse full of coins (the dev server's room is the only one that pays out). */
  /* ---------- crew ---------- */

  /* Your crew, as the room last told it. */
  get crew() {
    return this.myCrew;
  }

  hireCrew() {
    if (this.canSpawn) this.conn?.send({ t: "hire" });
  }

  dismissCrew(id: number) {
    if (this.canSpawn) this.conn?.send({ t: "dismiss", id });
  }

  /* Buy one of your men a weapon (null: take his away). */
  armCrew(id: number, kind: WeaponKind | null) {
    if (this.canSpawn) this.conn?.send({ t: "crewarm", id, kind });
  }

  orderCrew(order: Order) {
    if (!this.canSpawn) return;
    if (!this.myCrew.men.length) {
      this.pushFeed(
        this.myPlot ? "Hire a crew in the marketplace first" : "Buy land, then hire a crew",
      );
      return;
    }
    this.conn?.send({ t: "order", order });
  }

  /* Whose men a plot's are, and in what colours. */
  private crewLabel(plot: number) {
    const info = this.world?.islands.get(plot)?.info.plot;
    return info ? { owner: info.owner, team: plotTeam(plot), mine: !!info.mine } : null;
  }

  devCoins() {
    if (CREATIVE) this.conn?.send({ t: "devcoins" });
  }

  /* ---------- building ---------- */

  /* What stands on a plot, drawn and solid underfoot (rubble isn't). */
  private setItem(plot: number, item: PlacedItem, burning = false) {
    let list = this.plotItems.get(plot);
    if (!list) this.plotItems.set(plot, (list = new Map()));
    list.set(item.id, item);
    this.itemPlot.set(item.id, plot);
    this.built.set(item, plotTeam(plot), burning);
    this.world?.ground.addSolids(itemKey(item.id), itemSolids(item), true);
    this.setBlaze(item, burning);
  }

  /* A thing as the room sent it: where it stands, its health, and whether it's alight. */
  private setSnap(plot: number, snap: ItemSnap) {
    const item = unpackItem(snap);
    if (item) this.setItem(plot, item, ((snap[7] ?? 0) & ITEM_STATE.burning) !== 0);
    return item;
  }

  private removeItem(plot: number, id: number) {
    this.plotItems.get(plot)?.delete(id);
    this.itemPlot.delete(id);
    this.blazes.delete(id);
    this.built.remove(id);
    this.world?.ground.removeSolids(itemKey(id));
    if (this.placing?.move === id) this.endPlacing();
  }

  private clearItems() {
    for (const list of this.plotItems.values())
      for (const id of list.keys()) this.world?.ground.removeSolids(itemKey(id));
    this.plotItems.clear();
    this.itemPlot.clear();
    this.blazes.clear();
    this.built.clear();
  }

  /* The effects' view of a thing: its footprint, height and heading. */
  private blazeOf(item: PlacedItem): Blaze {
    const def = CATALOGUE[item.kind];
    return {
      x: item.x,
      y: item.y,
      z: item.z,
      hx: def.hx,
      hz: def.hz,
      top: def.top,
      rot: item.rot,
      smoulder: 0,
      acc: [Math.random(), Math.random(), Math.random(), Math.random()],
    };
  }

  /* Alight or not: a fire that goes out leaves it smouldering a while. */
  private setBlaze(item: PlacedItem, burning: boolean) {
    const was = this.blazes.get(item.id);
    if (burning) {
      if (!was) this.blazes.set(item.id, { ...this.blazeOf(item), burning: true });
      else Object.assign(was, { burning: true, smoulder: 0, x: item.x, z: item.z, y: item.y });
    } else if (was?.burning) {
      was.burning = false;
      was.smoulder = 1;
    }
  }

  /*
   * Health and fire, changed on the plots: redrawn when that changes how
   * something looks, solid again or not when it falls or stands up, with a
   * crash, a hiss or a whoomph for whoever's near enough to hear.
   */
  private onItems(c: number[]) {
    for (let i = 0; i + 2 < c.length; i += 3) {
      const [id, hp, state] = [c[i], c[i + 1], c[i + 2]];
      const plot = this.itemPlot.get(id);
      const item = plot === undefined ? null : this.plotItems.get(plot)?.get(id);
      if (plot === undefined || !item) continue;
      const was = item.hp;
      const burning = (state & ITEM_STATE.burning) !== 0;
      const alight = this.blazes.get(id)?.burning ?? false;
      item.hp = hp;
      if (state & ITEM_STATE.burnt) item.burnt = true;
      else delete item.burnt;
      const near = this.body ? 1 - this.distanceTo(item.x, item.z) / 70 : 0;
      if (was > 0 && hp <= 0) {
        this.fx.collapse(this.blazeOf(item), !!item.burnt);
        if (near > 0) this.audio.collapse(near);
        if (item.burnt)
          this.blazes.set(id, { ...this.blazeOf(item), burning: false, smoulder: 1.6 });
      }
      if (burning && !alight && near > 0) this.audio.ignite(near);
      if (state & ITEM_STATE.doused) {
        this.fx.steam(this.blazeOf(item));
        if (near > 0) this.audio.hiss(near);
      }
      if (was > 0 !== hp > 0) this.setItem(plot, item, burning);
      else {
        this.built.set(item, plotTeam(plot), burning);
        this.setBlaze(item, burning);
      }
    }
  }

  /* A blow landing on something built: splinters or sparks, and the knock of it. */
  private onItemHit(msg: Extract<ServerMsg, { t: "ihit" }>) {
    const plot = this.itemPlot.get(msg.id);
    const item = plot === undefined ? null : this.plotItems.get(plot)?.get(msg.id);
    if (!item) return;
    const stone = CATALOGUE[item.kind].material === "stone";
    this.fx.strike(msg.x, msg.y, msg.z, stone, msg.damage > 0 ? 1 : 0.4);
    if (msg.by === this.myId) {
      this.hitMarker = 1;
      this.hitText = msg.damage > 0 ? `-${msg.damage}` : stone ? "Stone" : null;
      this.viewmodel.impact(0.9);
      this.audio.knock(stone);
      return;
    }
    const near = 1 - this.distanceTo(msg.x, msg.z) / 40;
    if (near > 0) this.audio.knock(stone, near);
  }

  /* Every fire's flames and smoke this frame, thinned with distance, and the crackle of the nearest. */
  private updateFires(dt: number) {
    const cam = this.camera.position;
    const wind = windAt(this.worldTime());
    this.fx.setWind(wind.x, wind.z);
    let loud = 0;
    for (const [id, b] of this.blazes) {
      if (!b.burning) {
        b.smoulder -= dt / 45;
        if (b.smoulder <= 0) {
          this.blazes.delete(id);
          continue;
        }
      }
      const d = Math.hypot(b.x - cam.x, b.y - cam.y, b.z - cam.z);
      const lod = d < 70 ? 1 : d < 160 ? 0.45 : d < 280 ? 0.18 : 0;
      this.fx.burn(b, dt, lod);
      if (b.burning) loud += Math.min(1.5, (b.hx + b.hz) * 0.3) / (1 + (d / 9) ** 2);
    }
    this.fx.update(dt);
    this.audio.crackle(loud);
  }

  /* Your land's terrain and what stands on it. */
  private myLand() {
    const info = this.myPlot;
    const terrain = info ? this.world?.ground.islands.get(info.id)?.terrain : null;
    if (!info || !terrain || !info.plot) return null;
    return { info, terrain, items: this.plotItems.get(info.id) ?? new Map<number, PlacedItem>() };
  }

  /* Your land, for the marketplace's build shelves. */
  buildView(): BuildView {
    const land = this.myLand();
    const b = this.body;
    return {
      ashore: this.canSpawn,
      plot: land?.info.plot
        ? {
            name: land.info.name,
            items: land.items.size,
            cap: PLOT_SIZES[land.info.plot.size].items,
            crew: PLOT_SIZES[land.info.plot.size].crew,
          }
        : null,
      onPlot: !!land && !!b && land.terrain.contains(b.x, b.z),
      coins: this.inv.coins,
    };
  }

  /* Why this can't be bought and set down right now, if it can't. */
  buildBlock(kind: CatalogueId, moving = false): string | null {
    const v = this.buildView();
    if (!v.ashore) return "Go ashore first";
    if (!v.plot) return "Buy land first";
    if (!v.onPlot) return "Stand on your land";
    if (this.ride) return "Get off first";
    if (moving) return null;
    if (v.plot.items >= v.plot.cap) return `Your land holds ${v.plot.cap} things`;
    const short = CATALOGUE[kind].price - v.coins;
    if (short > 0) return `◎ ${short.toLocaleString("en-US")} more needed`;
    return null;
  }

  /* Out of the marketplace with something to set down: the ghost follows the crosshair. */
  startPlacing(kind: CatalogueId, move: number | null = null) {
    const why = this.buildBlock(kind, move !== null);
    if (why) {
      this.say(why, 2.5);
      return false;
    }
    const was = move === null ? null : this.built.get(move);
    /* Its front toward you, square to the way you look; something moved keeps its turn. */
    const turn = was ? was.rot : Math.round(this.input.yaw / ROT_STEP) * ROT_STEP;
    this.placing = { kind, turn, move, at: null, verdict: null, reason: null };
    this.built.hide(move);
    this.sellArmed = null;
    return true;
  }

  endPlacing() {
    this.placing = null;
    this.built.hide(null);
    this.built.ghost.show(null, "blue");
  }

  /* Click places, R or the wheel turns it (Shift finer), right-click puts it away. */
  private placeInput(b: Body) {
    const pl = this.placing!;
    const land = this.myLand();
    if (!land || this.ride) {
      this.endPlacing();
      return;
    }
    const step = this.input.sprint ? FINE_ROT_STEP : ROT_STEP;
    if (this.input.take("rotate")) pl.turn += step;
    const wheel = this.input.takeWheel();
    if (wheel) pl.turn += wheel * step;
    this.input.takeDigit();
    this.aimPlacing(b, land);
    if (this.input.take("attack")) {
      if (pl.at && pl.verdict?.ok && !pl.reason) {
        this.conn?.send({
          t: "place",
          kind: pl.kind,
          x: pl.at.x,
          z: pl.at.z,
          rot: pl.at.rot,
          ...(pl.move !== null ? { move: pl.move } : {}),
        });
        /* A move is done; a purchase carries on, so a wall can be drawn piece after piece. */
        if (pl.move !== null) this.endPlacing();
      } else
        this.say(
          pl.reason ?? (pl.verdict && !pl.verdict.ok ? pl.verdict.reason : "Can't go there"),
          2,
        );
    }
    this.input.take("attackUp");
    if (this.input.take("alt")) this.endPlacing();
    this.input.take("altUp");
  }

  /*
   * Walk a ray out from your eyes along the crosshair until it meets the
   * ground (or the water, for a jetty), snap the ghost there, and judge it.
   */
  private aimPlacing(b: Body, land: NonNullable<ReturnType<Game["myLand"]>>) {
    const pl = this.placing!;
    const def = CATALOGUE[pl.kind];
    const dir = this.tmpF.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const p = this.tmpV.set(b.x, this.smoothEye, b.z);
    const reach = PLACE_REACH + 4;
    let hit: { x: number; z: number } | null = null;
    for (let d = 0; d < reach; d += 0.25) {
      p.addScaledVector(dir, d === 0 ? 0 : 0.25);
      let ground = land.terrain.heightAt(p.x, p.z);
      if (def.placing === "shore") ground = Math.max(ground, SEA_LEVEL);
      if (p.y <= ground) {
        hit = { x: p.x, z: p.z };
        break;
      }
    }
    /* Looking up: just clear of you, straight ahead (see below). */
    hit ??= { x: b.x, z: b.z };
    /* Something big is pushed out ahead of you, rather than swallowing you. */
    const flat = Math.hypot(dir.x, dir.z);
    const clear = Math.hypot(def.hx, def.hz) + 1;
    const off = Math.hypot(hit.x - b.x, hit.z - b.z);
    if (flat > 0.01 && off < clear) {
      hit.x += (dir.x / flat) * (clear - off);
      hit.z += (dir.z / flat) * (clear - off);
    }
    const items = land.items.values();
    const snap = snapItem(items, pl.kind, hit.x, hit.z, pl.turn, this.input.sprint, pl.move);
    const verdict = checkItem(
      land.terrain,
      land.items.values(),
      pl.kind,
      snap.x,
      snap.z,
      snap.rot,
      pl.move,
    );
    pl.verdict = verdict;
    pl.at = { ...snap, y: verdict.y };
    pl.reason = !land.terrain.contains(b.x, b.z)
      ? "Stand on your land"
      : Math.hypot(snap.x - b.x, snap.z - b.z) > PLACE_REACH
        ? "Too far away"
        : pl.move === null
          ? this.buildBlock(pl.kind)
          : null;
    this.built.ghost.show(pl.kind, plotTeam(land.info.id), pl.at, verdict.ok && !pl.reason);
  }

  /* The thing of yours under the crosshair, close enough to move, sell or mend. */
  private ownItemAt(b: Body): PlacedItem | null {
    return this.itemAt(b, 12, true);
  }

  /* The built thing under the crosshair within `reach` metres: on your land only, or anyone's. */
  private itemAt(b: Body, reach: number, mine: boolean): PlacedItem | null {
    const world = this.world;
    if (!world) return null;
    const lists: Map<number, PlacedItem>[] = [];
    for (const [plot, list] of this.plotItems) {
      const info = world.islands.get(plot)?.info;
      if (!info || !list.size || (mine && !info.plot?.mine)) continue;
      const half = info.size / 2 + reach;
      if (Math.abs(info.x - b.x) > half || Math.abs(info.z - b.z) > half) continue;
      lists.push(list);
    }
    if (!lists.length) return null;
    const dir = this.tmpF.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const p = this.tmpV.set(b.x, this.smoothEye, b.z);
    for (let d = 0; d < reach; d += 0.3) {
      p.addScaledVector(dir, d === 0 ? 0 : 0.3);
      for (const list of lists)
        for (const o of list.values()) {
          /* Rubble is low: a pile or a stump. */
          const top = o.y + (o.hp > 0 ? CATALOGUE[o.kind].top : 1.4);
          if (p.y < o.y - 0.5 || p.y > top + 0.3 || !overItem(o, p.x, p.z, 0.2)) continue;
          return o;
        }
      if (p.y < world.ground.heightAt(p.x, p.z) - 0.3) break;
    }
    return null;
  }

  private placingView(): PlacingView | null {
    const pl = this.placing;
    if (!pl) return null;
    const def = CATALOGUE[pl.kind];
    const bad = pl.reason ?? (pl.verdict && !pl.verdict.ok ? pl.verdict.reason : null);
    return {
      name: def.name,
      price: def.price,
      moving: pl.move !== null,
      ok: !bad && !!pl.verdict,
      reason: bad,
      snapped: !!pl.at?.snapped,
    };
  }

  /* Everything the grand map shows, as it is right now. */
  mapView(): MapView {
    const world = this.world;
    const islands = world
      ? [...world.islands.values()].map((o) => {
          const st = this.plotStates.get(o.info.id);
          const shield = this.shieldLeft(o.info.id);
          return {
            info: o.info,
            image: o.image,
            raid: o.info.plot
              ? {
                  team: shield > 0 && st?.captor ? st.captor.team : plotTeam(o.info.id),
                  shield,
                  captor: shield > 0 ? (st?.captor?.name ?? null) : null,
                  attacked: (st?.raiders ?? 0) > 0 || this.captures.has(o.info.id),
                }
              : undefined,
          };
        })
      : [];
    const players: MapView["players"] = [];
    for (const [id, r] of this.remotes) {
      const last = r.buf[r.buf.length - 1];
      if (!last || !r.avatar.group.visible) continue;
      const p = r.avatar.group.position;
      players.push({
        id,
        name: r.name,
        x: p.x,
        z: p.z,
        yaw: last.yaw,
        me: false,
        raider: (last.flags & FLAG.raider) !== 0,
      });
    }
    if (this.body)
      players.push({
        id: this.myId,
        name: this.myName,
        x: this.body.x,
        z: this.body.z,
        yaw: this.input.yaw,
        me: true,
        raider: this.raiding !== null,
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
      /* Esc: put the ghost away. */
      if (!this.touch && !this.forceActive) this.endPlacing();
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
    this.self?.dispose();
    this.self = null;
    this.audio.close();
    this.viewmodel.dispose();
    this.herd.dispose();
    this.vehicles.dispose();
    this.built.dispose();
    this.fx.dispose();
    this.raids.dispose();
    this.dropWorld();
    this.sky.dispose();
    this.clouds.dispose();
    this.shadows.dispose();
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
    this.raids.clear();
    this.scene.remove(this.world.group);
    for (const o of this.world.islands.values()) {
      o.props.dispose();
      o.group.remove(o.props.group);
    }
    disposeTree(this.world.group);
    this.world = null;
  }

  /* An empty grand map: just the open sea, waiting for its islands. */
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
      image: drawRoutes(islandImage(terrain.heights, terrain.grid), terrain),
    });
    world.seed ??= info.seed;
    world.sea.setTiles(world.ground.list());
    const hearth = terrain.places.find((p) => p.kind === "hearth");
    if (info.plot && terrain.hearth && hearth) {
      this.raids.place(info.id, { ...terrain.hearth, rot: hearth.rot });
      this.showRaid(info.id);
    }
  }

  private removeIsland(id: number) {
    const world = this.world;
    const view = world?.islands.get(id);
    if (!world || !view) return;
    view.props.dispose();
    view.group.remove(view.props.group);
    world.group.remove(view.group);
    disposeTree(view.group);
    world.islands.delete(id);
    this.raids.remove(id);
    world.ground.remove(id);
    world.sea.setTiles(world.ground.list());
  }

  /*
   * An island raised while we're here: a plot just bought, or one grown in
   * place (the same id, bigger), which takes the old one's place. One we
   * already have only takes its new name and owner.
   */
  private onIsland(info: IslandInfo) {
    const world = this.world;
    if (!world) return;
    const known = world.islands.get(info.id);
    if (known && sameLand(known.info, info)) {
      known.info = info;
      const island = world.ground.islands.get(info.id);
      if (island) island.info = { ...info };
      return;
    }
    if (known) this.removeIsland(info.id);
    this.addIsland(info);
  }

  /* Is the world we have drawn the same set of islands as this one, or a start on it? */
  private sameWorld(islands: readonly IslandInfo[]) {
    const world = this.world;
    if (!world) return false;
    for (const [id, o] of world.islands) {
      const next = islands.find((i) => i.id === id);
      if (!next || !sameLand(next, o.info)) return false;
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
        this.onIsland(msg.info);
        break;
      case "item": {
        const fresh = !this.plotItems.get(msg.plot)?.has(msg.item[0]);
        const item = this.setSnap(msg.plot, msg.item);
        if (item && fresh && this.body && this.distanceTo(item.x, item.z) < 40) this.audio.thud();
        break;
      }
      case "items":
        this.onItems(msg.c);
        break;
      case "ihit":
        this.onItemHit(msg);
        break;
      case "unitem":
        this.removeItem(msg.plot, msg.id);
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
        this.self?.hurt();
        this.flash = Math.max(this.flash, 0.6);
        this.kick = Math.max(this.kick, 0.6);
        this.audio.shoved();
        navigator.vibrate?.(80);
        break;
      case "died":
        this.leaveRide();
        this.endPlacing();
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
        this.leaveRide();
        this.endPlacing();
        this.chargeStart = null;
        this.place(msg);
        this.dazeUntil = 0;
        this.audio.splash(0.4);
        break;
      case "daze":
        this.dazeUntil = performance.now() / 1000 + msg.seconds;
        this.pushFeed("You're dazed");
        break;
      case "swing":
        if (msg.by !== this.myId) {
          const r = this.remotes.get(msg.by) ?? this.crews.get(msg.by);
          r?.avatar.strike(msg.heavy);
          const s = r?.buf[r.buf.length - 1];
          const shoots = msg.kind && (weaponDef(msg.kind).ranged || weaponDef(msg.kind).throws);
          if (s && !shoots && this.distanceTo(s.x, s.z) < 20) this.audio.swing(msg.kind, msg.heavy);
        }
        break;
      case "hit":
        this.onHit(msg);
        break;
      case "inv":
        this.inv = msg.inv;
        break;
      case "crew":
        this.myCrew = { order: msg.order, men: msg.men };
        break;
      case "board":
        this.board = msg.board;
        break;
      case "aboard":
        this.onAboard(msg);
        break;
      case "vfix": {
        /* The room has our vehicle somewhere else: drive on from there. */
        const v = unpackVehicle(msg.snap);
        if (this.ride?.state && this.ride.id === v.id) Object.assign(this.ride.state, v.state);
        break;
      }
      case "paid": {
        const total = msg.payouts.reduce((n, p) => n + p.reward, 0);
        this.audio.reward();
        this.banner = {
          title: `+${total} coins`,
          sub:
            msg.payouts.length === 1
              ? msg.payouts[0].title
              : `${msg.payouts.length} rewards collected`,
          at: performance.now() / 1000,
        };
        this.pushFeed(`Paid ${total} coins`);
        break;
      }
      case "news":
        this.audio.chime();
        this.banner = { title: msg.title, sub: msg.sub, at: performance.now() / 1000 };
        break;
      case "ahit":
        this.onAnimalHit(msg);
        break;
      case "plots":
        this.onPlots(msg.plots);
        break;
      case "alarm":
        this.onAlarm(msg);
        break;
      case "feed":
        this.pushFeed(msg.text);
        break;
      case "shot":
        this.shotsView.spawn(msg);
        this.shotBy.set(msg.id, msg.by);
        if (this.shotBy.size > 400) this.shotBy.delete(this.shotBy.keys().next().value as number);
        break;
      case "land":
        this.onLand(msg);
        break;
      case "boom": {
        this.shotsView.boom(msg);
        this.shotBy.delete(msg.id);
        const [x, y, z] = msg.p;
        const d = this.camera.position.distanceTo(this.tmpV.set(x, y, z));
        if (d < 40) {
          this.kick = Math.max(this.kick, (1 - d / 40) * 1.2);
          this.flash = Math.max(this.flash, (1 - d / 40) * 0.8);
        }
        break;
      }
      case "vhp":
        this.hulls.set(msg.id, { hp: msg.hp, max: msg.max });
        if (this.ride?.id === msg.id) {
          this.kick = Math.max(this.kick, 0.5);
          this.audio.knock(false, 0.8);
        }
        break;
      case "sunk":
        this.hulls.delete(msg.id);
        if (this.ride?.id === msg.id) this.audio.collapse(1);
        break;
    }
  }

  /*
   * A shot came down: the view shows it where it lands, and if it was ours
   * and hit someone (or something), the hit marker says what it did.
   */
  private onLand(msg: Extract<ServerMsg, { t: "land" }>) {
    this.shotsView.land(msg);
    const by = this.shotBy.get(msg.id);
    this.shotBy.delete(msg.id);
    if (msg.who === undefined) return;
    if (msg.on === "body") {
      const target = this.remotes.get(msg.who) ?? this.crews.get(msg.who);
      target?.avatar.hurt();
    }
    if (by !== this.myId) return;
    this.hitMarker = 1;
    this.viewmodel.impact(0.5);
    this.hitText = msg.dmg
      ? `-${msg.dmg}`
      : msg.on === "item" || msg.on === "ship"
        ? "No harm"
        : "Hit";
  }

  /*
   * Into a seat (the helm steers: you drive from where the room last had it),
   * or out of one, onto wherever the room says you step off.
   */
  private onAboard(msg: Extract<ServerMsg, { t: "aboard" }>) {
    const b = this.body;
    if (!b) return;
    if (msg.id !== null) {
      const kind = this.vehicles.kindOf(msg.id);
      if (!kind) return;
      this.flying = false;
      const pose = this.vehicles.latest(msg.id) ?? this.vehicles.look(msg.id);
      const same = this.ride?.id === msg.id;
      if (this.ride && !same) this.vehicles.steer(this.ride.id, null);
      const state = msg.seat === 0 && pose ? stateFrom(pose) : null;
      this.ride = { id: msg.id, seat: msg.seat, kind, state, yaw: pose?.rot ?? b.yaw };
      this.vehicles.steer(msg.id, state);
      /* Facing the way it faces, and seen from behind. */
      if (!same && pose) {
        this.input.yaw = pose.rot;
        this.input.pitch = -0.05;
      }
      if (!same) {
        this.view = "third";
        this.chaseDist = 0;
      }
      this.acc = 0;
      if (afloat(kind)) this.audio.splash(0.3);
      return;
    }
    this.leaveRide();
    if (msg.at) {
      b.x = msg.at.x;
      b.y = msg.at.y;
      b.z = msg.at.z;
      b.vx = b.vy = b.vz = 0;
      this.smoothEye = b.y + EYE_HEIGHT;
      if (msg.at.y < SEA_LEVEL) this.audio.splash(0.9);
    }
  }

  private leaveRide() {
    if (this.ride) {
      this.vehicles.steer(this.ride.id, null);
      /* Back to the view you walk about with. */
      this.view = this.footView;
      this.chaseDist = 0;
    }
    this.ride = null;
    this.acc = 0;
  }

  /*
   * In a seat. At the helm you drive it with the same steps the room uses,
   * and report where it got to; anywhere else you ride along. Either way you
   * sit where your seat is, and your view turns as the vehicle does.
   */
  private driveRide(dt: number, b: Body, active: boolean, tapped: boolean) {
    const ride = this.ride as NonNullable<typeof this.ride>;
    const world = this.world as World;
    const state = ride.state;
    if (state) {
      const intent: DriveIntent = active
        ? {
            forward: this.input.forward,
            right: this.input.right,
            brake: this.input.jumpHeld,
            jump: tapped,
            boost: this.input.sprint,
          }
        : { forward: 0, right: 0, brake: true, jump: false, boost: false };
      const ground = world.ground;
      const time = this.worldTime();
      /* Only our own hull is out of the way. */
      ground.removeSolids(ride.id);
      this.acc += dt;
      let hit = false;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        if (stepVehicle(ride.kind, state, intent, STEP, ground, time)) hit = true;
      }
      ground.addSolids(ride.id, vehicleSolids(ride.kind, state));
      this.vehicles.steer(ride.id, state);
      const now = performance.now() / 1000;
      /* Driven into the sea. */
      const sunk = VEHICLES[ride.kind].class === "car" && state.y < SEA_LEVEL;
      if (sunk && !ride.wet) this.audio.splash(1);
      ride.wet = sunk;
      if (hit && Math.abs(state.speed) > 1.5 && now - this.bumpAt > 0.6) {
        this.bumpAt = now;
        this.audio.land(4 + Math.min(10, Math.abs(state.speed) * 0.5));
      }
      /* The splash of each stroke. */
      const cls = VEHICLES[ride.kind].class;
      if (
        cls === "row" &&
        Math.abs(state.speed) > 0.8 &&
        intent.forward &&
        now - this.strokeAt > 1.3
      ) {
        this.strokeAt = now;
        this.audio.splash(0.22);
      }
    } else this.acc = 0;
    const pose = state ?? this.vehicles.look(ride.id);
    if (pose) {
      this.input.yaw += wrapAngle(pose.rot - ride.yaw);
      ride.yaw = pose.rot;
      const at = riderPose(ride.kind, pose, ride.seat);
      Object.assign(b, {
        x: at.x,
        y: at.y,
        z: at.z,
        vx: -Math.sin(pose.rot) * pose.speed,
        vy: 0,
        vz: -Math.cos(pose.rot) * pose.speed,
        grounded: true,
      });
    }
    b.sprinting = false;
    b.stamina = Math.min(STAMINA_MAX, b.stamina + 10 * dt);
  }

  /*
   * Seated, the camera is at your eyes over the seat, tilted with the
   * vehicle (its pitch, roll and the swell under it) under wherever you look.
   */
  private rideCamera(dt: number) {
    const ride = this.ride as NonNullable<typeof this.ride>;
    const look = this.vehicles.look(ride.id) ?? ride.state;
    if (!look) return;
    const eye = eyeOf(ride.kind, look, ride.seat);
    this.smoothEye = eye.y;
    this.kick += (0 - this.kick) * Math.min(1, dt * 7);
    this.dip = 0;
    const def = VEHICLES[ride.kind];
    const top = def.hull?.speed ?? def.car?.speed ?? def.mount?.gallop ?? 10;
    const rush = Math.min(1, Math.abs(look.speed) / top) * (def.class === "car" ? 0.45 : 0.25);
    const targetFov = BASE_FOV + rush * 22;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 6);
    this.setFov(this.fov);
    if (this.view === "third") {
      /*
       * Behind and above it, over its middle, far enough back to see all of
       * it, looking a little down. The horizon stays level as it rolls.
       */
      const seat = riderPose(ride.kind, look, ride.seat);
      const lift = Math.max(seat.y + RIDER_HIP + 1.25, look.y + def.height * 0.75);
      this.tmpV.set(look.x, lift, look.z);
      this.chase(dt, this.tmpV, clamp(def.length * 0.55 + 3.5, 5, 20), this.input.pitch - 0.2);
      return;
    }
    this.camera.position.set(eye.x, eye.y, eye.z);
    TILT.setFromEuler(TILT_E.set(look.pitch, look.rot, look.roll, "YXZ")).multiply(
      HEADING.setFromAxisAngle(UP, look.rot).invert(),
    );
    this.camera.quaternion
      .copy(TILT)
      .multiply(
        HEADING.setFromEuler(
          TILT_E.set(this.input.pitch - this.kick * 0.06, this.input.yaw, 0, "YXZ"),
        ),
      );
  }

  /* An engine you can hear: yours, when you're in something with one. */
  private engineSound() {
    const ride = this.ride;
    const def = ride ? VEHICLES[ride.kind] : null;
    if (!ride || !def || this.down || (def.class !== "motor" && def.class !== "car")) {
      this.audio.motor(null);
      return;
    }
    /* Water in the engine. */
    const look = ride.state ?? this.vehicles.look(ride.id);
    if (def.class === "car" && look && swamped(look)) {
      this.audio.motor(null);
      return;
    }
    const pose = ride.state ?? this.vehicles.look(ride.id);
    const top = def.hull?.speed ?? def.car?.speed ?? 20;
    this.audio.motor(Math.abs(pose?.speed ?? 0) / top);
  }

  /* What E does in a seat. */
  private rideFocus(ride: NonNullable<typeof this.ride>): Focus {
    const seats = this.vehicles.seatsOf(ride.id);
    if (ride.seat !== 0 && !seats[0])
      return { kind: "vehicle", id: ride.id, label: "E · Take the helm" };
    const def = VEHICLES[ride.kind];
    return {
      kind: "vehicle",
      id: ride.id,
      label: def.class === "mount" ? "E · Dismount" : "E · Get off",
    };
  }

  /* The line under the crosshair while you ride: pace, the wind, and how to drive. */
  private rideHint(ride: NonNullable<typeof this.ride>) {
    const def = VEHICLES[ride.kind];
    const pose = ride.state ?? this.vehicles.look(ride.id);
    if (def.class === "car" && pose && swamped(pose)) return "Swamped · E get out and swim";
    if (!ride.state) return `Riding along in the ${def.name.toLowerCase()} · E get off`;
    const speed = Math.abs(pose?.speed ?? 0);
    const pace = afloat(ride.kind)
      ? `${(speed * 1.944).toFixed(0)} knots`
      : `${Math.round(speed * 3.6)} km/h`;
    if (def.class === "sail" && pose) {
      const wind = windAt(this.worldTime());
      const off = Math.abs(wrapAngle(pose.rot - wind.angle));
      const point =
        off < 0.5
          ? "running before the wind"
          : off < 1.3
            ? "wind on the quarter"
            : off < 2
              ? "wind on the beam"
              : off < 2.5
                ? "close-hauled"
                : "head to wind";
      return `${pace} · sail ${Math.round(pose.aux * 100)}% · ${point} · ${controlsOf(ride.kind)} · E get off`;
    }
    return `${pace} · ${controlsOf(ride.kind)} · E get off`;
  }

  /* A snapshot's vehicles: drawn, and solid to walk and drive into. */
  private setVehicles(snaps: readonly VehicleSnap[], time: number) {
    const ground = this.world?.ground;
    const ids = new Set(snaps.map((s) => s[0]));
    for (const v of this.vehicles.list()) if (!ids.has(v.id)) ground?.removeSolids(v.id);
    this.vehicles.setAll(snaps, time);
    for (const snap of snaps) {
      const v = unpackVehicle(snap);
      const kind = vehicleFromIndex(v.index);
      /* Ours is where our own driving has it. */
      if (!kind || (this.ride?.state && this.ride.id === v.id)) continue;
      ground?.addSolids(v.id, vehicleSolids(kind, v.state));
    }
    if (this.ride && !this.vehicles.kindOf(this.ride.id)) this.leaveRide();
  }

  private onAnimalHit(msg: Extract<ServerMsg, { t: "ahit" }>) {
    const a = this.herd.list().get(msg.id);
    if (msg.by === this.myId) {
      this.hitMarker = 1;
      this.viewmodel.impact(0.8);
      this.hitText = msg.dead ? "Down" : `-${msg.damage}`;
      this.audio.hit(this.weapon, false);
      if (msg.dead) {
        this.audio.chime();
        this.pushFeed(
          `You brought down a ${SPECIES[msg.kind].name.toLowerCase()} · carcass in your pack`,
        );
      }
    } else if (a) {
      const near = 1 - this.distanceTo(a.x, a.z) / 30;
      if (near > 0) this.audio.hit(null, false, near);
    }
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
    for (const island of info.islands) this.onIsland(island);
    this.offset = info.time - performance.now() / 1000;
    this.haveClock = true;
    this.board = info.board;
    this.clearItems();
    for (const [plot, list] of info.items) for (const snap of list) this.setSnap(plot, snap);
    this.captures.clear();
    this.onPlots(info.plots);
    this.setVehicles(info.vehicles, info.time);
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
      r.avatar.setRaider((flags & FLAG.raider) !== 0);
      r.buf.push({ t: msg.time, x, y, z, yaw, pitch, flags });
      if (r.buf.length > 12) r.buf.shift();
    }

    this.herd.set(msg.a);
    this.crews.set(msg.c ?? [], msg.time);
    this.built.aim(msg.d ?? []);
    this.setVehicles(msg.v, msg.time);
    /* Anything squaring up to you nearby snorts or growls before it comes. */
    for (const [id, kind, x, , z, , state] of msg.a) {
      const was = this.animalStates.get(id);
      const fights = this.herd.roleOf(kind) !== "prey";
      if (fights && state === ANIMAL_STATE.alert && was !== state && this.distanceTo(x, z) < 26)
        this.audio.snort(1 - this.distanceTo(x, z) / 26);
      this.animalStates.set(id, state);
    }
    if (this.animalStates.size > 400) this.animalStates.clear();

    if (msg.me) {
      this.health = msg.me.health;
      this.water = msg.me.water;
      this.raiding = msg.me.raid;
    }
    this.captures.clear();
    for (const [plot, progress, state, by] of msg.cap)
      this.captures.set(plot, { progress, state, by });
    for (const id of this.plotStates.keys()) this.showCapture(id);
  }

  /* ---------- raids ---------- */

  /* Every plot's shield and raiders, as the room has them now. */
  private onPlots(list: readonly PlotState[]) {
    const now = performance.now() / 1000;
    this.plotStates.clear();
    for (const p of list) this.plotStates.set(p.id, { ...p, until: now + p.shield });
    for (const p of list) {
      this.showRaid(p.id);
      this.showCapture(p.id);
    }
  }

  /* The seconds left on a plot's shield (0: none). */
  shieldLeft(id: number) {
    const st = this.plotStates.get(id);
    return st ? Math.max(0, st.until - performance.now() / 1000) : 0;
  }

  /* A plot's Hearth as it should look: whose colours fly there, and whether its shield is up. */
  private showRaid(id: number) {
    const st = this.plotStates.get(id);
    const up = this.shieldLeft(id) > 0;
    this.raids.setState(id, up && st?.captor ? st.captor.team : plotTeam(id), up);
  }

  /* Its ring: filling while it's taken, faint while raiders are only ashore, gone otherwise. */
  private showCapture(id: number) {
    const c = this.captures.get(id);
    const raiders = this.plotStates.get(id)?.raiders ?? 0;
    if (c) this.raids.setCapture(id, c.progress / CAPTURE_TIME, c.state);
    else this.raids.setCapture(id, 0, raiders > 0 ? CAPTURE_STATE.falling : null);
  }

  /* Raiders on your land: a bell, wherever you are, and which way they came from. */
  private onAlarm(msg: Extract<ServerMsg, { t: "alarm" }>) {
    const at = performance.now() / 1000;
    const more = msg.raiders > 1 ? `${msg.raiders} raiders on your isle` : "A raider on your isle";
    this.alarm =
      msg.at === "hearth"
        ? { title: "Raiders are taking your Hearth!", sub: `${more} · get home and hold it`, at }
        : {
            title: `Raiders landing on your ${msg.side} shore`,
            sub: `${more} · get home and drive them off`,
            at,
          };
    this.audio.bell(msg.at === "hearth" ? 4 : 3);
    this.pushFeed(this.alarm.title);
  }

  /* The capture nearest you worth showing: one you're taking, your own Hearth, or one close by. */
  private captureView(): HudState["capture"] {
    const b = this.body;
    const world = this.world;
    if (!b || !world) return null;
    let best: HudState["capture"] = null;
    let bestD = 80;
    for (const [id, c] of this.captures) {
      const info = world.islands.get(id)?.info;
      const hearth = world.ground.islands.get(id)?.terrain.hearth;
      if (!info || !hearth) continue;
      const mine = !!info.plot?.mine;
      const taking = this.raiding === id;
      const d = Math.hypot(hearth.x - b.x, hearth.z - b.z);
      if (!mine && !taking && d > bestD) continue;
      bestD = mine || taking ? -1 : d;
      const state =
        c.state === CAPTURE_STATE.taking
          ? "taking"
          : c.state === CAPTURE_STATE.contested
            ? "contested"
            : "falling";
      const title = mine
        ? state === "taking"
          ? "Your Hearth is being taken!"
          : state === "contested"
            ? "You're holding your Hearth"
            : "Your Hearth is coming back to you"
        : taking
          ? state === "taking"
            ? `Taking ${info.name}`
            : state === "contested"
              ? "Contested · the owner is holding the Hearth"
              : "Back to the Hearth before it slips away"
          : `${info.name} · its Hearth is being taken`;
      best = { title, progress: Math.min(1, c.progress / CAPTURE_TIME), state, mine };
    }
    return best;
  }

  private onHit(msg: Extract<ServerMsg, { t: "hit" }>) {
    if (msg.target === this.myId) {
      if (msg.blocked || msg.parry) {
        this.audio.clang(msg.parry);
        this.viewmodel.impact(msg.parry ? 0.7 : 1);
      } else this.audio.hit(msg.kind, msg.heavy);
      return;
    }
    if (msg.by === this.myId) {
      this.hitMarker = 1;
      this.viewmodel.impact(msg.blocked ? 1 : 0.8);
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
    const target = this.remotes.get(msg.target) ?? this.crews.get(msg.target);
    if (!msg.blocked && !msg.parry) target?.avatar.hurt();
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
    const shoots = !!def.ranged || !!def.throws;
    this.conn?.send(
      shoots ? { t: "attack", charge, aim: this.aimDir(b) } : { t: "attack", charge },
    );
    this.viewmodel.swing(heavy);
    this.self?.strike(heavy);
    /* A bow's twang comes with its arrow, from the room. */
    if (!shoots) this.audio.swing(kind, heavy);
    this.kick = def.ranged ? -0.15 : kind ? -0.3 : -0.6;
  }

  /*
   * Which way a shot from your eyes goes to hit whatever's under the
   * crosshair: the same as the view in first person, but from behind it's
   * the line from your head to where the view's ray meets the ground (or a
   * long way off).
   */
  private aimDir(b: Body): [number, number, number] {
    const fwd = this.tmpF.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const cam = this.camera.position;
    const ground = this.world?.ground;
    let d = 200;
    if (ground)
      for (let t = 2; t < 200; t += 1.5) {
        const x = cam.x + fwd.x * t;
        const y = cam.y + fwd.y * t;
        const z = cam.z + fwd.z * t;
        if (y < Math.max(ground.heightAt(x, z), SEA_LEVEL)) {
          d = t;
          break;
        }
      }
    const eye = this.tmpE.set(b.x, b.y + EYE_HEIGHT - 0.08, b.z);
    const to = this.tmpV.copy(cam).addScaledVector(fwd, d).sub(eye).normalize();
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return [r(to.x), r(to.y), r(to.z)];
  }

  /*
   * At a ship's helm, a click fires the broadside on whichever side you're
   * looking, raised as far as you're looking up.
   */
  private fireBroadside() {
    const ride = this.ride;
    const look = ride ? (ride.state ?? this.vehicles.look(ride.id)) : null;
    if (!ride || !look) return;
    const now = performance.now() / 1000;
    const side = Math.sin(look.rot - this.input.yaw) > 0 ? 1 : -1;
    const k = side < 0 ? 0 : 1;
    if (now < this.broadsideAt[k]) return;
    this.broadsideAt[k] = now + BROADSIDE_RELOAD;
    const lift = clamp(this.input.pitch + 0.12, -0.05, 0.35);
    this.conn?.send({ t: "broadside", side, lift });
    this.kick = 0.8;
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
    if (this.devCamera) {
      const v = this.devCamera;
      this.camera.position.set(v.x, v.y, v.z);
      this.camera.rotation.set(v.pitch, v.yaw, 0, "YXZ");
    }
    this.vehicles.update(
      dt,
      this.worldTime() - this.renderDelay(),
      this.worldTime(),
      this.camera.position,
      this.world?.ground,
    );
    this.vehicles.inside(
      this.ride && !this.devCamera && this.view === "first" ? this.ride.id : null,
    );
    if (this.ride && this.body && !this.down) this.rideCamera(dt);
    this.updateSelf(dt);
    this.engineSound();

    if (this.world) {
      this.world.sea.follow(this.camera.position.x, this.camera.position.z);
      for (const o of this.world.islands.values()) {
        o.props.update(t, this.camera.position);
        /* Far islands draw a coarser ground. */
        const ground = o.group.getObjectByName("terrain") as THREE.Mesh | undefined;
        const lod = ground?.userData.lod as
          | { near: THREE.BufferGeometry; far: THREE.BufferGeometry }
          | undefined;
        if (ground && lod) {
          const d = Math.max(
            Math.abs(this.camera.position.x - o.info.x),
            Math.abs(this.camera.position.z - o.info.z),
          );
          ground.geometry = d > o.info.size * 0.75 ? lod.far : lod.near;
        }
      }
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.5);
    const held = this.body && !this.down ? heldTool(this.inv) : null;
    const holding = this.ride ? null : held ? TOOLS[held.kind].weapon : null;
    /* From behind, what you hold is in your avatar's hands instead. */
    this.viewmodel.set(this.view === "third" ? null : holding);
    const def = weaponDef(holding);
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
      yaw: this.camera.rotation.y,
      pitch: this.camera.rotation.x,
    });
    this.hitMarker = Math.max(0, this.hitMarker - dt * 2.2);
    this.updateRemotes(dt);
    this.crews.update(
      dt,
      this.worldTime() - this.renderDelay(),
      this.camera.position,
      this.vehicles,
    );
    if (this.devAvatars.length) this.updateDevAvatars(dt);
    this.herd.update(dt, this.camera.position);
    this.built.update(dt);
    this.shotsView.update(dt);
    this.raids.update(t);
    this.updateFires(dt);
    this.sky.follow(this.camera);
    this.clouds.update(this.worldTime(), this.camera.position);
    this.camera.updateMatrixWorld();
    this.shadows.render(this.renderer, this.scene, this.camera.position);

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
      this.blocking =
        guardOf(this.weapon) !== null &&
        active &&
        this.input.altHeld &&
        !this.ride &&
        !this.placing;
      const charging = this.chargeStart !== null;
      if (active && this.input.take("creative") && !this.ride && CREATIVE) this.toggleCreative(b);
      if (active && this.input.take("view")) this.toggleView();
      if (active && this.input.take("fly") && this.creative && !this.ride)
        this.setFlying(b, !this.flying);
      const tapped = active && this.input.take("jump");
      /* In creative, a double tap of Space takes off or comes down, as in the usual sandbox games. */
      if (tapped && this.creative && !this.ride) {
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

      if (this.ride) this.driveRide(dt, b, active && !this.panel, tapped);
      else this.acc += dt;
      const stepWorld = { terrain: world.ground };
      while (!this.ride && this.acc >= STEP) {
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
      if (this.ride) this.bobAmp = 0;

      /* Attack: instant swings on press; the warhammer and greatsword charge until release. */
      const now = performance.now() / 1000;
      /* A passenger can shoot a bow or throw a keg; at a ship's helm, a click is a broadside. */
      const shoots = !!def.ranged || !!def.throws;
      const helm = this.ride?.seat === 0 && gunsOf(this.ride.kind) > 0;
      const free = !this.ride || (this.ride.seat > 0 && shoots);
      if (this.placing) this.placeInput(b);
      else if (this.input.take("attack") && !this.blocking && (free || helm)) {
        if (helm) this.fireBroadside();
        else if (def.charge) {
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
      this.input.take("rotate");
      if (!this.placing) this.hotbarInput();
      this.focus = this.placing ? null : this.findFocus(b);
      if (this.input.take("interact") && this.focus) {
        const f = this.focus;
        if (f.kind === "board") this.openPanel(f.kind);
        else if (f.kind === "item") {
          const item = this.built.get(f.id);
          if (item && item.hp > 0) this.startPlacing(item.kind, item.id);
        } else this.conn?.send({ t: "interact", kind: f.kind, id: f.id });
      }
      if (this.input.take("repair") && this.focus?.kind === "item") {
        const item = this.built.get(this.focus.id);
        if (item && repairCost(item.kind, item.hp) > 0)
          this.conn?.send({ t: "repair", id: item.id });
      }
      if (this.input.take("sell") && this.focus?.kind === "item") {
        const id = this.focus.id;
        if (this.sellArmed?.id === id && now < this.sellArmed.until) {
          this.conn?.send({ t: "sell", id });
          this.sellArmed = null;
        } else this.sellArmed = { id, until: now + 2.5 };
      }
      if (this.input.take("inventory")) this.openPanel("inventory");
      /* G calls your crew to you (or sends them home); H has them hold where you stand. */
      if (this.input.take("crew"))
        this.orderCrew(this.myCrew.order === "follow" ? "home" : "follow");
      if (this.input.take("hold")) this.orderCrew("hold");
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
          ride: this.ride?.state ? reportOf(this.ride.state) : undefined,
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
      if (!this.ride) this.setFlying(b, true);
      this.pushFeed("Creative mode");
    } else {
      this.flying = false;
      this.safeFall = !b.grounded && b.y > SEA_LEVEL;
      this.pushFeed("Survival mode");
    }
  }

  /* V: first person or third. On foot it's remembered; aboard something it lasts the ride. */
  toggleView() {
    this.view = this.view === "first" ? "third" : "first";
    this.chaseDist = 0;
    if (!this.ride) {
      this.footView = this.view;
      keepView(this.view);
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
      "jump",
      "creative",
      "fly",
      "view",
      "rotate",
      "sell",
      "crew",
      "hold",
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
    if (this.ride) return this.rideFocus(this.ride);
    const bd = world.ground.primary?.board;
    if (FEATURES.board && bd)
      consider(bd.x, bd.y, bd.z, 3.6, () => ({ kind: "board", id: 0, label: "E · Guild Board" }));
    /* A vehicle: measured from its side, so a galleon is as easy to board as a rowboat. */
    for (const v of this.vehicles.list()) {
      const reach = distanceTo(v.kind, v.look, b.x, b.z);
      if (reach > RIDE_REACH) continue;
      if (!afloat(v.kind) && Math.abs(v.look.y - b.y) > 2.5) continue;
      if (!v.seats.some((m) => !m)) continue;
      const score = reach * 0.8;
      if (score < bestScore) {
        bestScore = score;
        best = { kind: "vehicle", id: v.id, label: boardLabel(v.kind) };
      }
    }
    /* Something of yours, right under the crosshair, if nothing else is closer to hand. */
    if (!best) {
      const item = this.ownItemAt(b);
      const name = item ? CATALOGUE[item.kind].name.toLowerCase() : "";
      if (item)
        return {
          kind: "item",
          id: item.id,
          label:
            item.hp > 0
              ? `E · Move the ${name}`
              : `R · Rebuild the ${name} for ◎ ${repairCost(item.kind, 0)}`,
        };
    }
    return best;
  }

  /* ---------- panels ---------- */

  openPanel(kind: PanelKind) {
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
    this.self?.setSkin(skin);
    if (this.conn?.kind === "online") this.conn.send({ t: "skin", skin });
  }

  acceptContract(id: number) {
    this.conn?.send({ t: "accept", id });
  }

  turnIn() {
    this.conn?.send({ t: "turnin" });
  }

  abandonContract() {
    this.conn?.send({ t: "abandon" });
  }

  /* Take what the board owes you: alpha bounties and cull shares. */
  collect() {
    this.conn?.send({ t: "collect" });
  }

  private islandName(id: number | null) {
    if (id === null) return null;
    return this.world?.islands.get(id)?.info.name ?? null;
  }

  private contractView(c: Contract): ContractView {
    const def = SPECIES[c.species];
    return {
      id: c.id,
      title: contractTitle(c),
      note: def.note,
      island: this.islandName(c.island),
      role: def.role,
      reward: c.reward,
      have: progress(this.inv, c),
      need: c.count,
    };
  }

  private guildView(now: number): GuildView {
    const board = this.board;
    const clock = this.haveClock ? now + this.offset : 0;
    const left = (t: number) => Math.max(0, t - clock);
    const a = board.alpha;
    const c = board.cull;
    return {
      near: this.nearBoard(),
      mission: this.inv.mission ? this.contractView(this.inv.mission) : null,
      contracts: board.contracts.map((o) => this.contractView(o)),
      alpha: a
        ? {
            name: a.name,
            kind: SPECIES[a.species].name,
            island: this.islandName(a.island) ?? "the wilds",
            reward: a.reward,
            left: left(a.endsAt),
            slainBy: a.slainBy,
          }
        : null,
      cull: c
        ? {
            island: this.islandName(c.island) ?? "the wilds",
            kind: SPECIES[c.species].plural,
            need: c.need,
            done: c.done,
            pot: c.pot,
            left: left(c.endsAt),
            state: c.state,
            hunters: c.hunters,
          }
        : null,
      nextAlpha: board.nextAlpha === null ? null : left(board.nextAlpha),
      nextCull: board.nextCull === null ? null : left(board.nextCull),
      payouts: this.inv.payouts,
      owed: this.inv.payouts.reduce((n, p) => n + p.reward, 0),
    };
  }

  private nearBoard() {
    const b = this.body;
    const bd = this.world?.ground.primary?.board;
    return (
      !!b && !!bd && Math.hypot(bd.x - b.x, bd.z - b.z) < BOARD_REACH && Math.abs(bd.y - b.y) < 2.5
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
    return {
      id: tool.id,
      kind: tool.kind,
      name: TOOLS[tool.kind].name,
      count: isThrown(tool.kind) ? tool.uses : null,
    };
  }

  private inventoryView(): InventoryView {
    const inv = this.inv;
    const items: InventoryView["items"] = [];
    for (const [id, n] of Object.entries(inv.items) as [ItemId, number][]) {
      if (!n) continue;
      const def = ITEMS[id];
      items.push({ id, name: def.name, count: n });
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
    /* Riding, the seat has the camera (rideCamera, once the vehicle has moved). */
    if (this.ride) return;
    const eye = b.y + EYE_HEIGHT;
    if (eye > this.smoothEye && eye - this.smoothEye < 5 && !this.flying) {
      this.smoothEye += (eye - this.smoothEye) * Math.min(1, dt * 16);
    } else this.smoothEye = eye;

    this.dip = Math.max(0, this.dip - dt * 3);
    this.kick += (0 - this.kick) * Math.min(1, dt * 7);
    const bobY = Math.abs(Math.sin(this.bob * 0.5)) * 0.07 * this.bobAmp;
    const bobX = Math.sin(this.bob * 0.5) * 0.04 * this.bobAmp;

    /* The view widens as you pick up speed in the air. */
    const rush = this.flying ? Math.min(1, Math.hypot(b.vx, b.vz) / FLY_BOOST) : 0;
    const targetFov = BASE_FOV + (b.sprinting ? 7 : 0) + rush * 22 + Math.abs(this.kick) * 4;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 6);
    this.setFov(this.fov);

    if (this.view === "third") {
      /* Behind you, a little over your head: you stand just under the crosshair. */
      this.tmpV.set(b.x, this.smoothEye + 0.35 - this.dip * 0.2, b.z);
      this.chase(dt, this.tmpV, 3.6, this.input.pitch - this.kick * 0.06);
      return;
    }
    this.camera.position.set(b.x, this.smoothEye + bobY - this.dip * 0.35, b.z);
    this.camera.rotation.set(
      this.input.pitch - this.kick * 0.06 - this.dip * 0.05,
      this.input.yaw,
      bobX * 0.3,
      "YXZ",
    );
    this.camera.translateX(bobX);
  }

  /*
   * The camera `dist` back from `pivot` along where you look (pitched by
   * `pitch`), looking at it. Where the ground or the sea is in the way it
   * comes in closer at once, and eases back out once it's clear.
   */
  private chase(dt: number, pivot: THREE.Vector3, dist: number, pitch: number) {
    const yaw = this.input.yaw;
    const cp = Math.cos(pitch);
    const fx = -Math.sin(yaw) * cp;
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * cp;
    const ground = this.world?.ground;
    const dry = pivot.y > SEA_LEVEL + 0.3;
    let clear = dist;
    if (ground) {
      for (let d = 0.4; d <= dist; d += 0.4) {
        const x = pivot.x - fx * d;
        const y = pivot.y - fy * d;
        const z = pivot.z - fz * d;
        const floor = Math.max(ground.heightAt(x, z), dry ? SEA_LEVEL : -Infinity) + 0.3;
        if (y < floor) {
          clear = Math.max(0.5, d - 0.4);
          break;
        }
      }
    }
    if (!this.chaseDist || clear < this.chaseDist) this.chaseDist = clear;
    else this.chaseDist += (clear - this.chaseDist) * Math.min(1, dt * 4);
    const d = this.chaseDist;
    this.camera.position.set(pivot.x - fx * d, pivot.y - fy * d, pivot.z - fz * d);
    this.camera.rotation.set(pitch, yaw, 0, "YXZ");
  }

  /* You, as others see you: only drawn when the camera is behind you. */
  private updateSelf(dt: number) {
    const b = this.body;
    const show =
      !!b &&
      !this.down &&
      this.view === "third" &&
      !this.devCamera &&
      !(this.ride && enclosed(this.ride.kind));
    if (!show) {
      if (this.self) this.self.group.visible = false;
      return;
    }
    if (!this.self) {
      this.self = new Avatar(this.myId, this.myName, this.skin);
      this.self.labelled = false;
      this.scene.add(this.self.group);
    }
    const me = this.self;
    me.group.visible = true;
    me.setGear(this.weapon, 0);
    const flags =
      FLAG.alive |
      (b.sprinting ? FLAG.sprint : 0) |
      (b.grounded ? FLAG.grounded : 0) |
      (b.y < SEA_LEVEL ? FLAG.wet : 0) |
      (this.flying ? FLAG.fly : 0) |
      (this.blocking ? FLAG.block : 0) |
      (this.chargeStart !== null ? FLAG.charge : 0);
    const ride = this.ride;
    const look = ride ? (this.vehicles.look(ride.id) ?? ride.state) : null;
    if (ride && look) {
      /* In the seat on the vehicle as it's drawn, as everyone else rides. */
      const seat = riderPose(ride.kind, look, ride.seat);
      me.setPose(
        seat.x,
        seat.y,
        seat.z,
        seat.yaw,
        this.input.pitch,
        flags | FLAG.riding,
        dt,
        this.camera.position,
      );
      return;
    }
    me.setPose(b.x, b.y, b.z, b.yaw, this.input.pitch, flags, dt, this.camera.position);
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
    /* Round the first island (the Harbor, in the game), or out over the open sea. */
    const islands = [...world.islands.values()];
    const focus = islands[0];
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

  /* Remote players and vehicles are drawn this far behind the room, to have two snapshots to ease between. */
  private renderDelay() {
    return this.mode === "online" ? 0.12 : 0.07;
  }

  private updateRemotes(dt: number) {
    const t = this.worldTime() - this.renderDelay();
    for (const [id, r] of this.remotes) {
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
      /*
       * Aboard something: in their seat on the vehicle as we draw it, so they
       * ride with it rather than a snapshot behind or ahead.
       */
      const seat = this.vehicles.riderPose(id);
      /* Shut inside a closed car: only the car is seen. */
      if (seat && this.vehicles.riderHidden(id)) {
        r.avatar.group.visible = false;
        continue;
      }
      if (seat) {
        r.avatar.setPose(
          seat.x,
          seat.y,
          seat.z,
          seat.yaw,
          lerp(a.pitch, b.pitch, k),
          b.flags | FLAG.riding,
          dt,
          this.camera.position,
        );
        continue;
      }
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

  /* The island you're on, or the nearest one out on the water. */
  private whereAmI() {
    const b = this.body;
    const world = this.world;
    if (!b || !world || this.mode !== "online") return null;
    let best: string | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const o of world.islands.values()) {
      const d = Math.hypot(o.info.x - b.x, o.info.z - b.z) - o.info.size / 2;
      if (d < bestD) {
        bestD = d;
        best = o.info.name;
      }
    }
    if (best === null) return null;
    return bestD <= 0 ? best : `At sea, near ${best}`;
  }

  /* ---------- HUD ---------- */

  /* What's left of the hull you're riding in, if it's been hit. */
  private hullView() {
    const h = this.ride ? this.hulls.get(this.ride.id) : null;
    return h ? h.hp / h.max : null;
  }

  private emitHud() {
    const now = performance.now() / 1000;
    if (this.notice && now > this.noticeUntil) this.notice = null;
    this.feed = this.feed.filter((f) => now - f.at < 7);
    const playing = !!this.body && !this.down;
    const def = weaponDef(this.weapon);

    /* Whoever's under the crosshair, close enough to hit. */
    let target: HudState["target"] = null;
    if (playing && this.body) {
      const fwd = this.tmpF.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      /* Measured from your eyes, which the camera may be behind. */
      const eye = this.tmpE.set(this.body.x, this.smoothEye, this.body.z);
      let best = 0.985;
      for (const r of [...this.remotes.values(), ...this.crews.list()]) {
        if (!r.avatar.group.visible) continue;
        const to = this.tmpV.copy(r.avatar.group.position);
        to.y += 1.2;
        to.sub(eye);
        const d = to.length();
        if (d > 8) continue;
        const dot = to.normalize().dot(fwd);
        if (dot > best) {
          best = dot;
          target = { name: "name" in r ? r.name : r.label, health: null };
        }
      }
      for (const a of this.herd.list().values()) {
        if (a.state === ANIMAL_STATE.dead) continue;
        const to = this.tmpV.set(a.x, a.y + this.herd.aimHeight(a), a.z);
        to.sub(eye);
        const d = to.length();
        if (d > 14) continue;
        const dot = to.normalize().dot(fwd);
        if (dot > best - 0.02) {
          best = dot;
          target = { name: this.herd.nameOf(a), health: a.health };
        }
      }
      /* Otherwise something built, close enough to swing at: how much of it is left. */
      if (!target && !this.ride) {
        const item = this.itemAt(this.body, 8, false);
        if (item) {
          const def = CATALOGUE[item.kind];
          const owner = this.world?.islands.get(this.itemPlot.get(item.id) ?? -1)?.info.plot;
          const whose = owner ? (owner.mine ? "Your" : `${owner.owner}'s`) : "";
          const fire = this.blazes.get(item.id)?.burning ? " · on fire" : "";
          target =
            item.hp > 0
              ? {
                  name: `${whose} ${def.name.toLowerCase()}${fire}`,
                  health: Math.max(1, Math.round((item.hp / def.health) * 100)),
                }
              : { name: `${whose} ${def.name.toLowerCase()} · rubble`, health: null };
        }
      }
    }
    const prompt = playing && this.focus ? this.focus.label : null;
    const held = heldTool(this.inv);
    const ownItem = playing && this.focus?.kind === "item" ? this.built.get(this.focus.id) : null;
    const armed = !!ownItem && this.sellArmed?.id === ownItem.id && now < this.sellArmed.until;
    const mend = ownItem ? repairCost(ownItem.kind, ownItem.hp) : 0;
    const bucket = held && TOOLS[held.kind].weapon === "bucket";

    this.onHud({
      mode: this.mode,
      connecting: this.connecting,
      sheltered: playing && this.onHarbor(),
      place: playing ? this.whereAmI() : null,
      notice: this.notice,
      humans: this.roster.length,
      name: this.myName,
      player: playing,
      creative: this.creative,
      flying: this.flying,
      view: this.view,
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
      hint: this.placing
        ? this.touch
          ? "Aim to move it · Turn · Place · Cancel"
          : "Click to place · R or wheel turns it · hold Shift for fine steps · right-click to cancel"
        : ownItem
          ? ownItem.hp <= 0
            ? armed
              ? "X again to clear the rubble"
              : "X clear the rubble away"
            : `${mend ? `R mend for ◎ ${mend} · ` : ""}${
                armed
                  ? `X again to sell for ◎ ${resale(ownItem.kind)}`
                  : `X sell for ◎ ${resale(ownItem.kind)}`
              }`
          : this.flying
            ? "Space up · Shift down · double-tap W to rush · double-tap Space to drop"
            : this.ride
              ? this.rideHint(this.ride)
              : held
                ? bucket && !this.water
                  ? "Your bucket is empty · fill it in the sea or at a well"
                  : def.hint
                : null,
      banner: this.banner && now - this.banner.at < 4 ? this.banner : null,
      economy: FEATURES.board,
      guild: this.guildView(now),
      charge:
        this.chargeStart !== null && def.charge
          ? Math.min(1, (now - this.chargeStart) / def.charge.max)
          : null,
      ranged: playing && !!(def.ranged || def.throws) && (!this.ride || this.ride.seat > 0),
      hull: this.hullView(),
      guns:
        playing && this.ride?.seat === 0 && gunsOf(this.ride.kind)
          ? {
              port: Math.max(0, this.broadsideAt[0] - now),
              starboard: Math.max(0, this.broadsideAt[1] - now),
            }
          : null,
      blocking: this.blocking,
      hitMarker: this.hitMarker,
      hitText: this.hitText,
      prompt,
      target,
      placing: playing ? this.placingView() : null,
      ownItem: !!ownItem,
      repair: mend > 0 ? mend : null,
      raid:
        playing && this.raiding !== null
          ? (this.world?.islands.get(this.raiding)?.info.name ?? null)
          : null,
      besieged: this.myPlot ? (this.plotStates.get(this.myPlot.id)?.raiders ?? 0) : 0,
      capture: playing ? this.captureView() : null,
      alarm: this.alarm && now - this.alarm.at < 7 ? this.alarm : null,
      crew: this.myCrew.men.length
        ? {
            order: this.myCrew.order,
            men: this.myCrew.men.length,
            down: this.myCrew.men.filter((c) => c.down).length,
          }
        : null,
    });
  }
}

/* The camera's tilt with a vehicle under it, kept between frames. */
const TILT = new THREE.Quaternion();
const TILT_E = new THREE.Euler();
const HEADING = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/* What the helmsman tells the room, in RIDE_FIELDS order. */
function reportOf(v: VehicleState) {
  return RIDE_FIELDS.map((k) => Math.round(v[k] * 1000) / 1000);
}

/* "E · Climb aboard the galleon", "E · Mount the donkey". */
function boardLabel(kind: VehicleKind) {
  const def = VEHICLES[kind];
  const name = def.name.toLowerCase();
  if (def.class === "mount") return `E · Mount the ${name}`;
  if (def.section === "Ships") return `E · Climb aboard the ${name}`;
  return `E · Get in the ${name}`;
}
