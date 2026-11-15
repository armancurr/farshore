import { Room } from "../server/room";
import { TICK_HZ } from "../shared/constants";
import type { ClientMsg, ServerMsg } from "../shared/protocol";

export type ConnectionKind = "attract" | "solo" | "online";

export interface Connection {
  readonly kind: ConnectionKind;
  send(msg: ClientMsg): void;
  close(): void;
  /* Rooms in this tab can freeze (paused, or scrolled away); online ones keep going. */
  setPaused(paused: boolean): void;
}

type Handlers = {
  message: (msg: ServerMsg) => void;
  closed?: (reason: string) => void;
};

/*
 * A room that lives in this tab. Messages are cloned on the way through so the
 * client can never reach into the room's state, exactly as if it were remote.
 */
export class LocalConnection implements Connection {
  private room: Room;
  private id = -1;
  private timer: ReturnType<typeof setInterval>;
  private paused = false;
  private clock = 0;
  private last = performance.now();
  private closed = false;

  constructor(
    readonly kind: "attract" | "solo",
    private handlers: Handlers,
  ) {
    /* The room runs on its own clock so that pausing solo really stops time. */
    this.room = new Room({
      online: false,
      attract: kind === "attract",
      now: () => this.clock,
      maxHumans: 1,
    });
    const peer = {
      send: (msg: ServerMsg) => {
        if (!this.closed) this.handlers.message(structuredClone(msg));
      },
    };
    this.id = this.room.join(peer, { spectate: kind === "attract" });
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

  send(msg: ClientMsg) {
    if (this.closed || msg.t === "hello") return;
    this.room.handle(this.id, structuredClone(msg));
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  close() {
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
