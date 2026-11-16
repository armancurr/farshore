import { Room } from "../server/room";
import { TICK_HZ } from "../shared/constants";
import type { ClientMsg, ServerMsg } from "../shared/protocol";
import { parseSave, type SaveData } from "../shared/save";

export type ConnectionKind = "attract" | "solo" | "online";

export interface Connection {
  readonly kind: ConnectionKind;
  send(msg: ClientMsg): void;
  close(): void;
  /* Rooms in this tab can freeze (paused, or scrolled away); online ones keep going. */
  setPaused(paused: boolean): void;
}

/* ---------- the island, kept in this browser ---------- */

const SAVE_KEY = "rising-tide:island";
/* Save at least this often while playing, and this soon after anything worth keeping. */
const AUTOSAVE = 20;
const SOON = 1.5;

/* The saved island, or null if there isn't one (or it can't be read, or doesn't make sense). */
export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = parseSave(JSON.parse(raw));
    if (!save) console.warn("Rising Tide: ignoring a damaged or outdated save; starting fresh.");
    return save;
  } catch {
    return null;
  }
}

function writeSave(save: SaveData) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* Storage unavailable: nothing to clear. */
  }
}

type Handlers = {
  message: (msg: ServerMsg) => void;
  closed?: (reason: string) => void;
};

/*
 * A room that lives in this tab. Messages are cloned on the way through so the
 * client can never reach into the room's state, exactly as if it were remote.
 * Solo keeps the island in localStorage; the idle background only reads it.
 */
export class LocalConnection implements Connection {
  private room: Room;
  private id = -1;
  private timer: ReturnType<typeof setInterval>;
  private paused = false;
  private clock = 0;
  private last = performance.now();
  private closed = false;
  private sinceSave = 0;
  private sinceSoon = 0;
  private saveOnHide = () => {
    if (document.visibilityState === "hidden") this.save();
  };
  private saveNow = () => this.save();

  constructor(
    readonly kind: "attract" | "solo",
    private handlers: Handlers,
    /* With no save (or a fresh start), the island to make. */
    opts: { seed?: number; fresh?: boolean } = {},
  ) {
    /* The room runs on its own clock so that pausing solo really stops time. */
    this.room = new Room({
      online: false,
      now: () => this.clock,
      maxHumans: 1,
      seed: opts.seed,
      save: opts.fresh ? null : loadSave(),
    });
    const peer = {
      send: (msg: ServerMsg) => {
        if (!this.closed) this.handlers.message(structuredClone(msg));
      },
    };
    this.id = this.room.join(peer, { spectate: kind === "attract" });
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
    if (kind === "solo") {
      document.addEventListener("visibilitychange", this.saveOnHide);
      window.addEventListener("pagehide", this.saveNow);
      this.save();
    }
  }

  /* Write the island down (solo only). */
  save() {
    if (this.kind !== "solo" || this.closed) return;
    this.sinceSave = 0;
    this.room.saveSoon = false;
    writeSave(this.room.exportSave());
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (this.paused) return;
    this.clock += dt;
    this.room.tick();
    this.sinceSave += dt;
    this.sinceSoon = this.room.saveSoon ? this.sinceSoon + dt : 0;
    if (this.sinceSave > AUTOSAVE || this.sinceSoon > SOON) this.save();
  }

  send(msg: ClientMsg) {
    if (this.closed || msg.t === "hello") return;
    this.room.handle(this.id, structuredClone(msg));
  }

  setPaused(paused: boolean) {
    if (paused && !this.paused) this.save();
    this.paused = paused;
  }

  close() {
    this.save();
    document.removeEventListener("visibilitychange", this.saveOnHide);
    window.removeEventListener("pagehide", this.saveNow);
    this.closed = true;
    clearInterval(this.timer);
    this.room.leave(this.id);
  }
}

export function serverBase() {
  const configured = import.meta.env.VITE_TIDE_SERVER as string | undefined;
  if (configured) return configured.replace(/\/$/, "");
  /* In dev the Vite server hosts the room itself. */
  if (import.meta.env.DEV) return window.location.origin;
  return null;
}

function wsUrl(base: string, path: string) {
  const url = new URL(path, `${base}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export async function fetchStatus(): Promise<{ humans: number } | null> {
  const base = serverBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/party-status`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    return (await res.json()) as { humans: number };
  } catch {
    return null;
  }
}

export class WsConnection implements Connection {
  readonly kind = "online" as const;
  private ws: WebSocket;
  private open = false;
  private queue: ClientMsg[] = [];
  private done = false;

  constructor(
    base: string,
    private handlers: Handlers,
  ) {
    this.ws = new WebSocket(wsUrl(base, "party/public"));
    this.ws.onopen = () => {
      this.open = true;
      this.ws.send(JSON.stringify({ t: "hello" } satisfies ClientMsg));
      for (const msg of this.queue) this.ws.send(JSON.stringify(msg));
      this.queue = [];
    };
    this.ws.onmessage = (event) => {
      try {
        this.handlers.message(JSON.parse(event.data as string) as ServerMsg);
      } catch {
        /* ignore malformed frames */
      }
    };
    this.ws.onclose = () => this.finish(this.open ? "Connection lost" : "Server unreachable");
    this.ws.onerror = () => this.finish("Server unreachable");
  }

  private finish(reason: string) {
    if (this.done) return;
    this.done = true;
    this.handlers.closed?.(reason);
  }

  send(msg: ClientMsg) {
    if (this.done) return;
    if (!this.open) {
      if (msg.t !== "move") this.queue.push(msg);
      return;
    }
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  setPaused() {}

  close() {
    this.done = true;
    this.ws.close();
  }
}
