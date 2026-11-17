import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { dirname, resolve } from "node:path";
import type { Duplex } from "node:stream";
import type { Plugin } from "vite";
import { type WebSocket, WebSocketServer } from "ws";
import { Room } from "../src/game/server/room";
import { TICK_HZ } from "../src/game/shared/constants";
import { parseClientMsg, type ServerMsg } from "../src/game/shared/protocol";
import { parseWorldSave, type WorldSave } from "../src/game/shared/save";

/*
 * The grand map survives dev-server restarts here. Delete the file for a fresh
 * map; set FARSHORE_WORLD to keep a second dev server's map apart.
 */
const WORLD_FILE = resolve(
  import.meta.dirname,
  "..",
  process.env.FARSHORE_WORLD ?? ".farshore/world.json",
);

function loadWorld(): WorldSave | null {
  try {
    return parseWorldSave(JSON.parse(readFileSync(WORLD_FILE, "utf8")));
  } catch {
    return null;
  }
}

/*
 * Local multiplayer: the Vite dev server hosts the same Room the Cloudflare
 * Durable Object does, on the same paths, so two tabs can play together.
 */
export function tideDevServer(): Plugin {
  return {
    name: "rising-tide-dev-server",
    apply: "serve",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });
      let saveTimer: ReturnType<typeof setTimeout> | null = null;
      const store = () => {
        saveTimer = null;
        try {
          mkdirSync(dirname(WORLD_FILE), { recursive: true });
          writeFileSync(WORLD_FILE, JSON.stringify(room.exportWorld(), null, 1));
        } catch (error) {
          console.warn("farshore: couldn't store the grand map", error);
        }
      };
      const room = new Room({
        online: true,
        grand: true,
        /* Only here, on the dev server: creative mode and a deep purse for trying things out. */
        creative: true,
        devCoins: 1_000_000,
        world: loadWorld(),
        onChange: () => {
          saveTimer ??= setTimeout(store, 500);
        },
      });
      const sockets = new Set<WebSocket>();
      const timer = setInterval(() => {
        if (room.active()) room.tick();
      }, 1000 / TICK_HZ);

      server.httpServer?.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (!req.url?.startsWith("/party/")) return;
        wss.handleUpgrade(req, socket, head, (ws) => {
          sockets.add(ws);
          let id = -1;
          const peer = {
            send: (msg: ServerMsg) => {
              if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
            },
            close: () => {
              id = -1;
              ws.close(4000, "replaced");
            },
          };
          ws.on("message", (data) => {
            const msg = parseClientMsg(data.toString());
            if (!msg) return;
            if (msg.t === "hello") {
              if (id < 0) id = room.join(peer, msg);
              if (id < 0) ws.close();
              return;
            }
            if (id >= 0) room.handle(id, msg);
          });
          ws.on("close", () => {
            sockets.delete(ws);
            if (id >= 0) room.leave(id);
          });
        });
      });

      server.middlewares.use("/party-status", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(room.status()));
      });

      server.httpServer?.on("close", () => {
        clearInterval(timer);
        if (saveTimer) clearTimeout(saveTimer);
        store();
        for (const ws of sockets) ws.close();
        wss.close();
      });
    },
  };
}
