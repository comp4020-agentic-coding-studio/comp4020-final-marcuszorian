// The WebSocket half of the real-time ghost feed (C9). SSE was the obvious
// alternative and is genuinely simpler — this feed is one-way, server to
// client, which is exactly what SSE is for. WebSocket wins on one detail: a
// client has to say WHICH day it is watching, and that choice changes while
// the page is open (the day selector). Over SSE that is a new EventSource per
// change of day, or the seed in the query string and a reconnect; over a
// socket it is one `subscribe` message up an connection that stays put. See
// doc/adr/0005-realtime-ghosts.md.
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "../db.ts";
import { onScoreChanged } from "./events.ts";
import { isValidPastSeed } from "./seed.ts";

/** How often to ping. A silently dead socket otherwise sits in the Set forever. */
const HEARTBEAT_MS = 30_000;

interface GhostRow {
  username: string;
  distance: number;
  lane: number | null;
}

function ghostsFor(seed: string): GhostRow[] {
  return db
    .prepare(
      `SELECT u.username AS username, b.distance AS distance, b.lane AS lane
       FROM best_runs b JOIN users u ON u.id = b.user_id
       WHERE b.track_seed = ?
       ORDER BY b.distance DESC
       LIMIT 50`,
    )
    .all(seed) as GhostRow[];
}

interface LiveSocket extends WebSocket {
  /** The day this connection is watching, or undefined until it subscribes. */
  seed?: string;
  alive?: boolean;
}

export function attachLive(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/live" });

  wss.on("connection", (socket: LiveSocket) => {
    socket.alive = true;
    socket.on("pong", () => {
      socket.alive = true;
    });

    socket.on("message", (raw) => {
      let message: { type?: string; seed?: unknown };
      try {
        message = JSON.parse(String(raw)) as typeof message;
      } catch {
        return; // a client sending junk is ignored, not disconnected
      }
      if (message.type !== "subscribe") return;
      if (!isValidPastSeed(message.seed)) {
        socket.send(JSON.stringify({ type: "error", error: "bad seed" }));
        return;
      }
      socket.seed = message.seed;
      // The full current list on every subscribe. This is also what makes
      // reconnection correct: a client that dropped and came back gets the
      // state it missed without a separate catch-up path, so there is no
      // "what did I miss" bookkeeping on either side.
      socket.send(JSON.stringify({ type: "ghosts", seed: message.seed, ghosts: ghostsFor(message.seed) }));
    });
  });

  // One subscription for the whole server, not one per socket.
  onScoreChanged((change) => {
    const payload = JSON.stringify({
      type: "ghost",
      seed: change.trackSeed,
      ghost: { username: change.username, distance: change.distance, lane: change.lane },
    });
    for (const client of wss.clients as Set<LiveSocket>) {
      // Only sockets watching the day the run was posted against — a run on
      // last Tuesday's track is not news to someone driving today.
      if (client.readyState === WebSocket.OPEN && client.seed === change.trackSeed) {
        client.send(payload);
      }
    }
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients as Set<LiveSocket>) {
      if (client.alive === false) {
        client.terminate();
        continue;
      }
      client.alive = false;
      client.ping();
    }
  }, HEARTBEAT_MS);
  // Without this the interval keeps the process alive after the server closes,
  // which hangs the test run rather than anything in production.
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}
