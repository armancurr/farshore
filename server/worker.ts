import { DurableObject } from "cloudflare:workers";
import { Room } from "../src/game/server/room";
import { TICK_HZ } from "../src/game/shared/constants";
import { parseClientMsg, type ServerMsg } from "../src/game/shared/protocol";
import { parseWorldSave } from "../src/game/shared/save";

type Env = {
  ROOMS: DurableObjectNamespace<TideRoom>;
  /* The built site (dist/). Requests that aren't for the room fall through to it. */
  ASSETS: Fetcher;
  /* Comma-separated origins allowed to connect, e.g. "https://armancurr.com". Empty allows all. */
  ALLOWED_ORIGINS?: string;
};

const cors = { "access-control-allow-origin": "*" };

/*
 * One island. The room ticks only while someone is connected, so an empty
 * island costs nothing.
 */
export class TideRoom extends DurableObject<Env> {
  private room!: Room;
  private sockets = new Set<WebSocket>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private saving: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    /* The grand map is kept in the object's storage, so it outlives the object. */
    ctx.blockConcurrencyWhile(async () => {
      const world = parseWorldSave(await ctx.storage.get("world"));
      this.room = new Room({
        online: true,
        settle: true,
        world,
        onChange: () => {
          this.saving ??= setTimeout(() => {
            this.saving = null;
            void this.ctx.storage.put("world", this.room.exportWorld());
          }, 500);
        },
      });
    });
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/status") {
      return Response.json(this.room.status(), { headers: cors });
    }
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Expected a websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.add(server);

    let id = -1;
    const peer = {
      send: (msg: ServerMsg) => {
        try {
          server.send(JSON.stringify(msg));
        } catch {
          /* socket already gone */
        }
      },
      close: () => {
        id = -1;
        try {
          server.close(4000, "replaced");
        } catch {
          /* already closed */
        }
      },
    };
    server.addEventListener("message", (event) => {
      const msg = parseClientMsg(event.data);
      if (!msg) return;
      if (msg.t === "hello") {
        if (id < 0) id = this.room.join(peer, msg);
        if (id < 0) server.close(1000, "full");
        this.ensureTicking();
        return;
      }
      if (id >= 0) this.room.handle(id, msg);
    });
    const drop = () => {
      this.sockets.delete(server);
      if (id >= 0) this.room.leave(id);
      id = -1;
      if (this.sockets.size === 0) this.stopTicking();
    };
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);

    return new Response(null, { status: 101, webSocket: client });
  }

  private ensureTicking() {
    if (this.timer) return;
    this.timer = setInterval(() => this.room.tick(), 1000 / TICK_HZ);
  }

  private stopTicking() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const stub = env.ROOMS.get(env.ROOMS.idFromName("public"));

    if (url.pathname === "/party-status") {
      return stub.fetch(new Request(new URL("/status", url), request));
    }
    if (url.pathname.startsWith("/party/")) {
      const allowed = (env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      const origin = request.headers.get("origin") ?? "";
      if (allowed.length && !allowed.includes(origin))
        return new Response("Forbidden", { status: 403 });
      return stub.fetch(request);
    }
    /* run_worker_first only sends room paths here, but serve the site for anything else. */
    return env.ASSETS.fetch(request);
  },
};
