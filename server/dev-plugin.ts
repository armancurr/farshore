import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Plugin } from "vite";
import { type WebSocket, WebSocketServer } from "ws";
import { Room } from "../src/game/server/room";
import { TICK_HZ } from "../src/game/shared/constants";
import { parseClientMsg, type ServerMsg } from "../src/game/shared/protocol";

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
      const room = new Room({ online: true });
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
        for (const ws of sockets) ws.close();
        wss.close();
      });
    },
  };
}
