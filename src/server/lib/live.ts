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
import { userForCookie } from "./auth.ts";
import { onScoreChanged } from "./events.ts";
import { ghostsFor } from "./ghost-rows.ts";
import { isValidPastSeed } from "./seed.ts";

/** How often to ping. A silently dead socket otherwise sits in the Set forever. */
const HEARTBEAT_MS = 30_000;

interface LiveSocket extends WebSocket {
  /** The day this connection is watching, or undefined until it subscribes. */
  seed?: string;
  /** The raw Cookie header from the handshake — re-read on every subscribe. */
  cookie?: string;
  /** Whose ghosts this connection sees: a crew id, or null for the whole day. */
  crewId?: number | null;
  alive?: boolean;
}

export function attachLive(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/live" });

  wss.on("connection", (socket: LiveSocket, request) => {
    socket.alive = true;
    // The handshake carries the same `token` cookie an HTTP request would, so
    // the socket can know who is asking without a second auth mechanism —
    // auth.ts's cookie parsing was generalized to a raw header string for
    // exactly this (ADR 0011). Stored rather than resolved once: a player who
    // joins a crew mid-session must see their road narrow without a reload,
    // which is the one thing ADR 0005 promised never to require.
    socket.cookie = request.headers.cookie;
    socket.crewId = null;

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
      // Re-resolved per subscribe, not once at connection. A join triggers a
      // re-subscribe on the client exactly like a day change does, so this is
      // where a mid-session join takes effect. One indexed row read, against
      // a socket that is about to be handed a whole ghost list anyway.
      socket.crewId = userForCookie(socket.cookie)?.crewId ?? null;
      // The full current list on every subscribe. This is also what makes
      // reconnection correct: a client that dropped and came back gets the
      // state it missed without a separate catch-up path, so there is no
      // "what did I miss" bookkeeping on either side.
      socket.send(
        JSON.stringify({
          type: "ghosts",
          seed: message.seed,
          ghosts: ghostsFor(db, message.seed, socket.crewId),
        }),
      );
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
      if (client.readyState !== WebSocket.OPEN) continue;
      // Only sockets watching the day the run was posted against — a run on
      // last Tuesday's track is not news to someone driving today.
      if (client.seed !== change.trackSeed) continue;
      // And only if this client's own scope would have shown them that run on
      // a plain fetch. The test is "does the viewer's scope include the
      // author", NOT "do these two crews match": a crew-less viewer sees
      // everyone, including crew members, exactly as GET /api/ghosts hands
      // them to that same viewer. The symmetric version would make the socket
      // and the backfill disagree, so reconnecting would silently change what
      // you can see. See doc/adr/0011-crews.md.
      if (client.crewId !== null && client.crewId !== change.crewId) continue;
      client.send(payload);
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
