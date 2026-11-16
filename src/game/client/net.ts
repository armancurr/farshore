import { Room } from "../server/room";
import { TICK_HZ } from "../shared/constants";
import type { ClientMsg, ServerMsg } from "../shared/protocol";

export type ConnectionKind = "attract" | "online";

export interface Connection {
  readonly kind: ConnectionKind;
  send(msg: ClientMsg): void;
  close(): void;
  /* The title screen's room can freeze while it's out of sight; the online one keeps going. */
  setPaused(paused: boolean): void;
}

type Handlers = {
  message: (msg: ServerMsg) => void;
  closed?: (reason: string) => void;
};

/*
 * The title screen: a quiet room in this tab with one island and nobody on
 * it, watched from a slow orbit. Messages are cloned on the way through, as
 * if it were remote.
 */
export class LocalConnection implements Connection {
  readonly kind = "attract" as const;
  private room: Room;
  private id = -1;
  private timer: ReturnType<typeof setInterval>;
  private paused = false;
  private clock = 0;
  private last = performance.now();
  private closed = false;

  constructor(
    private handlers: Handlers,
    opts: { seed?: number } = {},
  ) {
    /* The room runs on its own clock so that pausing really stops time. */
    this.room = new Room({ online: false, now: () => this.clock, maxHumans: 0, seed: opts.seed });
    const peer = {
      send: (msg: ServerMsg) => {
        if (!this.closed) this.handlers.message(structuredClone(msg));
      },
    };
    this.id = this.room.join(peer, { spectate: true });
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (this.paused) return;
    this.clock += dt;
    this.room.tick();
  }

  send() {}

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.room.leave(this.id);
  }
}

/* ---------- who you are online ---------- */

const TOKEN_KEY = "farshore:player";

/*
 * Your online identity is a token the server hands out. This tab keeps its own
 * (sessionStorage, so it survives a reload); a fresh tab borrows the browser's
 * (localStorage). If that one is already playing in another tab, the server
 * makes this tab a new player, so two tabs are two players.
 */
function readToken(): { token?: string; own: boolean } {
  try {
    const own = sessionStorage.getItem(TOKEN_KEY);
    if (own) return { token: own, own: true };
    const shared = localStorage.getItem(TOKEN_KEY);
    if (shared) return { token: shared, own: false };
  } catch {
    /* Storage unavailable: a new player every time. */
  }
  return { own: false };
}

function keepToken(token: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    if (!localStorage.getItem(TOKEN_KEY)) localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* Storage unavailable. */
  }
}

export function serverBase() {
  const configured = import.meta.env.VITE_TIDE_SERVER as string | undefined;
  if (configured) return configured.replace(/\/$/, "");
  /*
   * Otherwise the room lives next to the page: the Vite dev server hosts it in
   * dev, and in production the same Cloudflare Worker serves both the site
   * and the room.
   */
  return window.location.origin;
}

function wsUrl(base: string, path: string) {
  const url = new URL(path, `${base}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
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
      this.ws.send(JSON.stringify({ t: "hello", ...readToken() } satisfies ClientMsg));
      for (const msg of this.queue) this.ws.send(JSON.stringify(msg));
      this.queue = [];
    };
    this.ws.onmessage = (event) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(event.data as string) as ServerMsg;
      } catch {
        return; /* ignore malformed frames */
      }
      if (msg.t === "welcome" && msg.token) keepToken(msg.token);
      this.handlers.message(msg);
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
