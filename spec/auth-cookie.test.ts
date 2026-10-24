import { expect, inject, it } from "vitest";
import WebSocket from "ws";

// A malformed percent-encoded cookie value used to throw URIError out of
// `tokenFromCookieHeader` (src/server/lib/auth.ts) with nothing catching it.
// Over HTTP, Express 5 turns an uncaught sync throw in middleware into a 500,
// so that half only ever failed one request. Over /live it ran inside a raw
// `ws` message handler with no surrounding try/catch, so the same throw was
// an uncaught exception that took down the whole process — every connected
// player, not just the one with the bad cookie. Both paths should now treat
// an undecodable cookie exactly like no cookie at all.
const baseUrl = inject("baseUrl");
const wsUrl = new URL("/live", baseUrl).toString().replace(/^http/, "ws");

const BAD_COOKIE = "token=%E0%A4%A"; // invalid percent-encoding, throws in decodeURIComponent

it("a malformed cookie on a requireAuth route is a 401, not a 500", async () => {
  const res = await fetch(new URL("/api/me", baseUrl), {
    headers: { cookie: BAD_COOKIE },
  });
  expect(res.status, await res.text()).toBe(401);
});

it("a malformed cookie on an optionalAuth route is treated as anonymous", async () => {
  const res = await fetch(new URL("/api/ghosts?seed=2019-07-04", baseUrl), {
    headers: { cookie: BAD_COOKIE },
  });
  expect(res.status, await res.text()).toBe(200);
});

it("a malformed cookie on the /live handshake does not crash the socket or the server", async () => {
  const socket = new WebSocket(wsUrl, { headers: { cookie: BAD_COOKIE } });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error(`could not open ${wsUrl}`)));
    });

    const messages: { type?: string }[] = [];
    socket.addEventListener("message", (event: { data: unknown }) => {
      messages.push(JSON.parse(String(event.data)) as { type?: string });
    });
    socket.send(JSON.stringify({ type: "subscribe", seed: "2019-07-04" }));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no ghosts reply within 2s")), 2000);
      const check = setInterval(() => {
        if (messages.some((m) => m.type === "ghosts")) {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, 20);
    });

    // The server is still alive and answering other requests, which is the
    // real assertion: before the fix, the bad cookie above crashed the whole
    // process, and this fetch would never get a response.
    const res = await fetch(new URL("/", baseUrl));
    expect(res.status).toBe(200);
  } finally {
    socket.close();
  }
});
