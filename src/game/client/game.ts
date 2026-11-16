import * as THREE from "three";
import { EYE_HEIGHT, HEALTH_MAX, SEA_LEVEL, STAMINA_MAX, TICK_HZ } from "../shared/constants";
import { clockLabel, daylight } from "../shared/daylight";
import {
  BITE_TEXT,
  depthAt,
  MIN_CAST_DEPTH,
  type Strike,
  WATERS_LABEL,
  watersFor,
} from "../shared/fishing";
import { clamp, lerp } from "../shared/math";
import { type Body, createBody, FLOAT_DEPTH, stepBody } from "../shared/physics";
import {
  FLAG,
  type HurtCause,
  type InteractKind,
  type LineState,
  type PlayerSnap,
  type RosterEntry,
  type ServerMsg,
  type Spawn,
  type WorldInfo,
} from "../shared/protocol";
import { overSolid, Terrain } from "../shared/terrain";
import {
  emptyInventory,
  HOTBAR,
  heldTool,
  type Inventory,
  ITEMS,
  type ItemId,
  type Rarity,
  TOOLS,
  type ToolKind,
} from "../shared/items";
import { COMBO_WINDOW, WEAPONS, weaponDef, weaponFromIndex } from "../shared/weapons";
import { TideAudio } from "./audio";
import { Input } from "./input";
import { type Connection, LocalConnection, serverBase, WsConnection } from "./net";
import { Avatar } from "./scene/avatars";
import { FishingLines } from "./scene/fishing";
import { createTerrainMesh, createWater } from "./scene/land";
import { shared } from "./scene/materials";
import { PostPass } from "./scene/post";
import { WorldProps } from "./scene/props";
import { Sky } from "./scene/sky";
import { type RodPose, ViewModel, WeaponDrops } from "./scene/weapons";

export type Mode = "attract" | "solo" | "online";

export type FeedItem = { id: number; text: string; at: number };

export type PanelKind = "inventory";

export type ToolView = {
  id: number;
  kind: ToolKind;
  name: string;
  /* Wear left as 0..1, or null when it never wears out. */
  wear: number | null;
  droppable: boolean;
};

export type InventoryView = {
  coins: number;
  slot: number;
  hotbar: (ToolView | null)[];
  pack: ToolView[];
  items: { id: ItemId; name: string; count: number; kind: string; rarity?: Rarity }[];
};

/* Something you could press E on. */
type Focus = { kind: InteractKind; id: number; label: string };

export type HudState = {
  mode: Mode;
  connecting: boolean;
  notice: string | null;
  clock: { day: number; time: string; part: string };
  humans: number;
  name: string;
  player: boolean;
  health: number;
  /* Fades from 1 when you get hurt. */
  hurt: number;
  /* Set while you're down, with what did it. */
  down: HurtCause | null;
  breath: number;
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
  /* Fades from 1 after a catch (or a fish getting away). */
  caught: { name: string | null; rarity: Rarity | null; at: number } | null;
  /* 0..1 while winding up a hammer or flail. */
  charge: number | null;
  blocking: boolean;
  /* Fades from 1 after you land a hit, with what it did. */
  hitMarker: number;
  hitText: string | null;
  prompt: string | null;
  /* Weapons on the ground, as screen positions (0..1) or edge arrows. */
  markers: { id: number; x: number; y: number; d: number; off: boolean; angle: number }[];
  target: { name: string } | null;
  music: boolean;
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
type Remote = { avatar: Avatar; buf: Sample[]; name: string };

type World = {
  seed: number;
  terrain: Terrain;
  group: THREE.Group;
  props: WorldProps;
  drops: WeaponDrops;
};

const STEP = 1 / 60;
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
  private roster: RosterEntry[] = [];
  private body: Body | null = null;
  private breath = 100;
  private health = HEALTH_MAX;
  private hurtFlash = 0;
  private down: HurtCause | null = null;
  private downAt = 0;
  private inv: Inventory = emptyInventory();
  private panel: PanelKind | null = null;
  private focus: Focus | null = null;
  private lines = new FishingLines();
  private myLine: { state: LineState; depth: number } | null = null;
  private bite: { strike: Strike; at: number } | null = null;
  private caught: HudState["caught"] = null;
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

  /* Dev/test only: treat input as live (and solo as running) without pointer lock. */
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
    const seed = this.world?.seed;
    this.conn?.close();
    this.conn = null;
    this.reset();
    this.mode = mode;
    if (mode !== "attract") this.audio.start();

    const handlers = {
      message: (msg: ServerMsg) => this.onMessage(msg),
      closed: (reason: string) => {
        if (this.mode !== "online" || this.disposed) return;
        this.say(`${reason}. Playing solo instead.`, 5);
        this.start("solo");
      },
    };

    if (mode === "online") {
      const base = serverBase();
      if (!base) {
        this.say("Online play isn't available right now. Playing solo.", 5);
        this.start("solo");
        return;
      }
      this.connecting = true;
      this.conn = new WsConnection(base, handlers);
    } else {
      /* Solo picks up the island you were just looking at. */
      this.conn = new LocalConnection(mode, handlers, seed);
    }
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
    this.myLine = null;
    this.bite = null;
    this.caught = null;
    this.chargeStart = null;
    this.blocking = false;
    this.feed = [];
    this.haveClock = false;
    this.myId = -1;
    this.input.clear();
  }

  lock() {
    if (this.touch) return;
    this.audio.start();
    this.input.lock();
  }

  setMuted(muted: boolean) {
    this.audio.setMuted(muted);
  }

  toggleMusic() {
    this.audio.setMusic(!this.audio.musicOn);
    this.emitHud();
  }

  private shouldPause() {
    if (!this.visible || document.hidden) return true;
    /* Solo waits for you when you let go of the mouse. */
    return this.mode === "solo" && !this.touch && !this.input.locked && !this.forceActive;
  }

  private onLockChange() {
    this.conn?.setPaused(this.shouldPause());
    if (!this.input.locked) this.input.clear();
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
    this.sky.setPixelRatio(this.pixelRatio);
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
    this.world.props.dispose();
    this.world.group.remove(this.world.props.group);
    this.world.drops.dispose();
    this.world.group.remove(this.world.drops.group);
    disposeTree(this.world.group);
    this.world = null;
  }

  private buildWorld(seed: number) {
    this.dropWorld();
    const terrain = new Terrain(seed);
    const group = new THREE.Group();
    group.add(createTerrainMesh(terrain));
    group.add(createWater(terrain));
    const props = new WorldProps(terrain);
    group.add(props.group);
    const drops = new WeaponDrops();
    group.add(drops.group);
    this.scene.add(group);
    this.world = { seed, terrain, group, props, drops };
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
        if (this.mode === "online") this.pushFeed(`You are ${msg.name}`);
        break;
      case "full":
        this.say("The online island is full. Playing solo.", 5);
        this.start("solo");
        break;
      case "world":
        this.onWorld(msg);
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
        this.down = msg.cause;
        this.downAt = performance.now() / 1000;
        this.input.clear();
        this.chargeStart = null;
        this.audio.drowned();
        break;
      case "respawn":
        this.place(msg);
        if (this.down) this.pushFeed("You come to, everything you own still with you");
        this.down = null;
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
      case "wspawn":
        this.world?.drops.add(msg.weapon);
        break;
      case "wtake":
        this.world?.drops.remove(msg.id);
        if (msg.by === this.myId) {
          this.chargeStart = null;
          this.audio.pickup();
          this.pushFeed(`You picked up the ${WEAPONS[msg.kind].name.toLowerCase()}`);
        }
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
      case "catch":
        if (msg.by !== this.myId) break;
        this.bite = null;
        this.caught = {
          name: msg.fish ? ITEMS[msg.fish].name : null,
          rarity: msg.fish ? (ITEMS[msg.fish].rarity ?? null) : null,
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
      case "wbreak":
        if (msg.by === this.myId) {
          this.chargeStart = null;
          this.audio.broke();
          this.pushFeed(`Your ${WEAPONS[msg.kind].name.toLowerCase()} broke`);
        }
        break;
      case "feed":
        this.pushFeed(msg.text);
        break;
    }
  }

  private onLine(msg: Extract<ServerMsg, { t: "line" }>) {
    const from = this.tmpV;
    if (msg.by === this.myId) {
      if (msg.state === "none") {
        this.myLine = null;
        this.bite = null;
      } else {
        const depth = this.world ? depthAt(this.world.terrain.heightAt(msg.x, msg.z)) : 0;
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
    if (depthAt(world.terrain.heightAt(x, z)) < MIN_CAST_DEPTH) {
      this.say("Cast out over the water", 2);
      return;
    }
    this.conn?.send({ t: "cast", x, z });
  }

  private place(s: Spawn) {
    this.body = createBody(s.x, s.y, s.z, s.yaw);
    this.input.yaw = s.yaw;
    this.input.pitch = -0.05;
    this.breath = 100;
    this.health = HEALTH_MAX;
    this.smoothEye = s.y + EYE_HEIGHT;
  }

  private onWorld(info: WorldInfo) {
    if (this.world?.seed !== info.seed) this.buildWorld(info.seed);
    this.offset = info.time - performance.now() / 1000;
    this.haveClock = true;
    const world = this.world!;
    world.drops.clear();
    for (const w of info.weapons) world.drops.add(w);
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
      if (entry.id === this.myId || this.remotes.has(entry.id)) continue;
      const avatar = new Avatar(entry.id, entry.name);
      avatar.group.visible = false;
      this.scene.add(avatar.group);
      this.remotes.set(entry.id, { avatar, buf: [], name: entry.name });
    }
  }

  private onSnap(msg: Extract<ServerMsg, { t: "snap" }>) {
    const now = performance.now() / 1000;
    const sample = msg.time - now;
    if (!this.haveClock || Math.abs(sample - this.offset) > 0.75) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.08;
    this.haveClock = true;

    for (const p of msg.p as PlayerSnap[]) {
      const [id, x, y, z, yaw, pitch, flags, , weapon, stagger] = p;
      const r = this.remotes.get(id);
      if (!r) continue;
      r.avatar.setGear(weaponFromIndex(weapon ?? 0), stagger ?? 0);
      r.buf.push({ t: msg.time, x, y, z, yaw, pitch, flags });
      if (r.buf.length > 12) r.buf.shift();
    }

    if (msg.me) {
      this.breath = msg.me.breath;
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
      this.hitText = msg.parry ? "Parried" : msg.blocked ? "Blocked" : `+${msg.added}%`;
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

  private foeInReach(b: Body, reach: number) {
    const fx = -Math.sin(b.yaw);
    const fz = -Math.cos(b.yaw);
    for (const r of this.remotes.values()) {
      if (!r.avatar.group.visible) continue;
      const p = r.avatar.group.position;
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d < reach + 0.3 && Math.abs(p.y - b.y) < 2 && (dx * fx + dz * fz) / (d || 1) > 0.4)
        return true;
    }
    return false;
  }

  /* Is there a wall or cliff right in front, worth a pickaxe? */
  private wallAhead(b: Body) {
    const world = this.world;
    if (!world) return false;
    const fx = -Math.sin(b.yaw);
    const fz = -Math.cos(b.yaw);
    for (const d of [0.65, 1]) {
      const px = b.x + fx * d;
      const pz = b.z + fz * d;
      if (world.terrain.heightAt(px, pz) > b.y + 0.8) return true;
      for (const s of world.terrain.solidsNear(px, pz)) {
        if (s.bottom < b.y + 1.4 && s.top > b.y + 0.9 && overSolid(s, px, pz)) return true;
      }
    }
    return false;
  }

  private tryAttack(b: Body, charge: number) {
    const now = performance.now() / 1000;
    if (now < this.attackReadyAt) return;
    const kind = this.weapon;
    const def = weaponDef(kind);
    this.attackReadyAt = now + def.cooldown;
    let heavy = false;
    if (kind === "sword") {
      this.combo = now - this.lastSwingAt < COMBO_WINDOW ? this.combo + 1 : 1;
      if (this.combo >= 3) {
        heavy = true;
        this.combo = 0;
      }
    }
    this.lastSwingAt = now;
    /* A pickaxe swung at a wall hauls you up it, unless there's someone to hit. */
    const climb = kind === "pickaxe" && !this.foeInReach(b, def.reach) && this.wallAhead(b);
    if (climb) {
      b.vy = Math.max(b.vy, 10.5);
      b.vx += -Math.sin(b.yaw) * 2.5;
      b.vz += -Math.cos(b.yaw) * 2.5;
      b.grounded = false;
      b.stamina = Math.max(0, b.stamina - 8);
    }
    this.conn?.send({ t: "attack", charge, climb });
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
    if (this.haveClock) this.sky.update(this.worldTime());

    this.update(dt);

    if (this.world) {
      this.world.props.update(t);
      this.world.drops.update(t);
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
    this.sky.follow(this.camera);

    const under = this.camera.position.y < SEA_LEVEL + 0.05 ? 1 : 0;
    this.under += (under - this.under) * Math.min(1, dt * 10);
    const u = this.post.uniforms;
    u.uTime.value = t;
    u.uUnder.value = this.under;
    u.uBreath.value = this.body ? clamp(this.breath / 70, 0, 1) : 1;
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
      this.blocking = this.weapon === "shield" && active && this.input.altHeld;
      const charging = this.chargeStart !== null;
      const intent = active
        ? {
            forward: this.input.forward,
            right: this.input.right,
            jump: this.input.take("jump") || this.input.jumpHeld,
            sprint: this.input.sprint,
            speedScale: (def.speed ?? 1) * (this.blocking ? 0.6 : 1),
            noSprint: charging || this.blocking,
          }
        : { forward: 0, right: 0, jump: false, sprint: false };

      this.acc += dt;
      const stepWorld = { terrain: world.terrain };
      while (this.acc >= STEP) {
        this.acc -= STEP;
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

      /* Attack: instant swings on press; hammers and flails charge until release. */
      const now = performance.now() / 1000;
      const fishing = !!(heldTool(this.inv) && TOOLS[heldTool(this.inv)!.kind].rod);
      if (fishing && this.input.take("attack")) this.castOrStrike();
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
      this.hotbarInput();
      this.focus = this.findFocus(b);
      if (this.input.take("interact") && this.focus) {
        this.conn?.send({ t: "interact", kind: this.focus.kind, id: this.focus.id });
      }
      if (this.input.take("inventory")) this.openPanel("inventory");
      const stance = { block: this.blocking, charge: this.chargeStart !== null };
      if (stance.block !== this.sentStance.block || stance.charge !== this.sentStance.charge) {
        this.sentStance = stance;
        this.conn?.send({ t: "stance", ...stance });
      }

      this.sendAcc += dt;
      if (this.sendAcc >= 1 / TICK_HZ) {
        this.sendAcc = 0;
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
            (b.y < SEA_LEVEL ? FLAG.wet : 0),
        });
      }

      const depth = SEA_LEVEL - b.y;
      if (depth > FLOAT_DEPTH - 0.2 && !this.wasUnder) this.audio.splash(1);
      this.wasUnder = depth > FLOAT_DEPTH - 0.2;
      const strain = Math.min(this.breath / 40, this.health / 30);
      if (strain < 1) this.audio.heartbeat(lerp(0.45, 1.1, strain));
      this.firstPerson(dt, b);
    } else {
      this.dropInputs();
      this.orbitCamera(dt);
    }

    if (this.input.take("music")) this.toggleMusic();

    const above = this.camera.position.y - SEA_LEVEL;
    this.audio.ambience(above, this.under > 0.5, this.camera.position.y);
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
    for (const w of world.drops.list()) {
      consider(w.x, w.y, w.z, 2.6, () => ({
        kind: "weapon",
        id: w.id,
        label: `E · Pick up the ${WEAPONS[w.kind].name.toLowerCase()}`,
      }));
    }
    return best;
  }

  private rodHint() {
    if (this.myLine) return "Click to reel in";
    return "Click to cast · deeper water, rarer fish";
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

  equip(tool: number, slot: number) {
    this.conn?.send({ t: "equip", tool, slot });
  }

  drop(tool: number) {
    this.conn?.send({ t: "drop", tool });
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
    const def = TOOLS[tool.kind];
    const max = def.weapon ? weaponDef(def.weapon).uses : 0;
    return {
      id: tool.id,
      kind: tool.kind,
      name: def.name,
      wear: tool.uses < 0 || !max ? null : tool.uses / max,
      droppable: def.droppable,
    };
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
    const eye = b.y + EYE_HEIGHT;
    if (eye > this.smoothEye && eye - this.smoothEye < 5) {
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

    const targetFov = BASE_FOV + (b.sprinting ? 7 : 0) + Math.abs(this.kick) * 4;
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
    const lh = world.terrain.lighthouse;
    const a = t * 0.03;
    const radius = 210;
    this.tmpV.set(lh.x * 0.5, lh.y * 0.4, lh.z * 0.5);
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

  /* ---------- HUD ---------- */

  private emitHud() {
    const now = performance.now() / 1000;
    if (this.notice && now > this.noticeUntil) this.notice = null;
    this.feed = this.feed.filter((f) => now - f.at < 7);
    const playing = !!this.body && !this.down;
    const def = weaponDef(this.weapon);
    this.audio.intensity(this.musicIntensity());

    /* Weapons on the ground: on screen, or an arrow at the edge pointing at them. */
    const markers: HudState["markers"] = [];
    if (playing && this.world) {
      const v = this.tmpV;
      for (const w of this.world.drops.list()) {
        const d = this.distanceTo(w.x, w.z);
        if (d > 45) continue;
        v.set(w.x, w.y + 1.2, w.z).project(this.camera);
        const behind = v.z > 1;
        const off = behind || Math.abs(v.x) > 0.94 || Math.abs(v.y) > 0.9;
        let ax = behind ? -v.x : v.x;
        let ay = behind ? -v.y : v.y;
        if (behind && Math.abs(ax) < 0.01 && Math.abs(ay) < 0.01) ay = -1;
        const angle = Math.atan2(-ay, ax);
        if (off) {
          const k = 1 / Math.max(Math.abs(ax) / 0.94, Math.abs(ay) / 0.9, 1e-6);
          ax *= k;
          ay *= k;
        }
        markers.push({ id: w.id, x: (ax + 1) / 2, y: (1 - ay) / 2, d, off, angle });
      }
    }
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
          target = { name: r.name };
        }
      }
    }
    const prompt = playing && this.focus ? this.focus.label : null;
    const held = heldTool(this.inv);

    this.onHud({
      mode: this.mode,
      connecting: this.connecting,
      notice: this.notice,
      clock: clockLabel(this.haveClock ? this.worldTime() : 0),
      humans: this.roster.length,
      name: this.myName,
      player: playing,
      health: this.health,
      hurt: this.hurtFlash,
      down: this.down,
      breath: this.breath,
      stamina: this.body ? this.body.stamina / STAMINA_MAX : 1,
      shove: clamp((this.attackReadyAt - now) / def.cooldown, 0, 1),
      underwater: this.under > 0.5,
      feed: [...this.feed],
      locked: this.touch || this.input.locked || this.forceActive,
      inv: this.inventoryView(),
      panel: this.panel,
      hint: held && TOOLS[held.kind].rod ? this.rodHint() : held ? def.hint : null,
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
      caught: this.caught && now - this.caught.at < 2.6 ? this.caught : null,
      charge:
        this.chargeStart !== null && def.charge
          ? Math.min(1, (now - this.chargeStart) / def.charge.max)
          : null,
      blocking: this.blocking,
      hitMarker: this.hitMarker,
      hitText: this.hitText,
      prompt,
      markers,
      target,
      music: this.audio.musicOn,
    });
  }

  /* How tense the score should be: night, low breath, low health. */
  private musicIntensity() {
    if (this.mode === "attract") return 0.05;
    if (!this.body || this.down) return 0.15;
    const night = this.haveClock ? 1 - daylight(this.worldTime()) : 0;
    const breath = clamp(1 - this.breath / 100, 0, 1);
    const hurt = clamp(1 - this.health / HEALTH_MAX, 0, 1);
    return clamp(0.12 + night * 0.12 + breath * 0.4 + hurt * 0.45, 0, 1);
  }
}
