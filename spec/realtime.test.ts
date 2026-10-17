import { expect, inject, it } from "vitest";
// The `ws` client rather than Node's global WebSocket: the crew cases below
// need the handshake to carry a cookie, and undici's WebSocket has no way to
// set one. Same package the server uses, already a dependency.
import WebSocket from "ws";

// C9's spec line, as close to literally as a test can hold it: "a change one
// person makes appears in every other open session within about a second,
// with no reload." The session here is a WebSocket that is already open and
// stays open across the change — if the client had to reconnect or re-fetch
// to see it, these would still pass only by accident, so the socket is opened
// and subscribed BEFORE the run is posted, and never touched again.
const baseUrl = inject("baseUrl");
const wsUrl = new URL("/live", baseUrl).toString().replace(/^http/, "ws");

const WITHIN_MS = 1000;
// A day this file alone writes to. NOT 2020-01-01: spec/ghosts.test.ts asserts
// that day is empty, and posting a run against it here passed once (file order
// put that test first) and then failed every later run against the same
// database. A shared mutable fixture needs its own corner.
const OTHER_DAY = "2019-07-04";
const todayUtc = (): string => new Date().toISOString().slice(0, 10);

function tokenFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/token=([^;]+)/);
  if (!match) throw new Error(`no token cookie in response: ${raw}`);
  return match[1]!;
}

async function createAccount(username: string): Promise<string> {
  const res = await fetch(new URL("/api/account", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  expect(res.status, await res.text()).toBe(200);
  return tokenFrom(res);
}

async function postRun(token: string, distance: number, seed?: string): Promise<void> {
  const res = await fetch(new URL("/api/run-end", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `token=${token}` },
    body: JSON.stringify({ distance, lane: 0, seed }),
  });
  expect(res.status, await res.text()).toBe(200);
}

interface Message {
  type?: string;
  seed?: string;
  ghosts?: { username: string; distance: number }[];
  ghost?: { username: string; distance: number };
}

/**
 * An open, subscribed session that records everything pushed to it.
 *
 * `token` makes the socket a signed-in one. The handshake carries the cookie
 * an HTTP request would, which is how the server knows whose crew this
 * connection belongs to (ADR 0011) — without it the connection is anonymous
 * and sees the whole day, same as it always did.
 */
async function openSession(seed: string, token?: string): Promise<{
  received: Message[];
  waitFor(match: (m: Message) => boolean, ms: number): Promise<Message>;
  close(): void;
}> {
  const socket = new WebSocket(wsUrl, token ? { headers: { cookie: `token=${token}` } } : {});
  const received: Message[] = [];
  const waiters: { match: (m: Message) => boolean; resolve: (m: Message) => void }[] = [];

  socket.addEventListener("message", (event: { data: unknown }) => {
    const message = JSON.parse(String(event.data)) as Message;
    received.push(message);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.match(message)) {
        waiters[i]!.resolve(message);
        waiters.splice(i, 1);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error(`could not open ${wsUrl}`)));
  });
  socket.send(JSON.stringify({ type: "subscribe", seed }));

  const waitFor = (match: (m: Message) => boolean, ms: number): Promise<Message> => {
    const already = received.find(match);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`nothing matched within ${ms}ms`)), ms);
      waiters.push({ match, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  };

  // The subscribe is only honoured once the server has answered it; waiting
  // here is what makes "the session was already open" true in the tests below.
  await waitFor((m) => m.type === "ghosts", 5000);
  return { received, waitFor, close: () => socket.close() };
}

it("a finished run reaches every already-open session in under a second", async () => {
  const seed = todayUtc();
  const [a, b] = await Promise.all([openSession(seed), openSession(seed)]);
  try {
    const username = `live-${crypto.randomUUID().slice(0, 8)}`;
    const token = await createAccount(username);

    const started = Date.now();
    await postRun(token, 123.5, seed);

    const isRun = (m: Message): boolean => m.type === "ghost" && m.ghost?.username === username;
    const [seenByA, seenByB] = await Promise.all([a.waitFor(isRun, WITHIN_MS), b.waitFor(isRun, WITHIN_MS)]);

    expect(Date.now() - started).toBeLessThan(WITHIN_MS);
    expect(seenByA.ghost).toMatchObject({ username, distance: 123.5 });
    expect(seenByB.ghost).toMatchObject({ username, distance: 123.5 });
  } finally {
    a.close();
    b.close();
  }
});

// Under ADR 0006 a past-day run is refused outright, so cross-day leakage is
// now impossible by construction rather than by the seed guard in live.ts.
// This asserts both halves: the write is declined, and nothing is pushed to a
// session watching today.
it("a run aimed at another day is refused and reaches nobody", async () => {
  const session = await openSession(todayUtc());
  try {
    const username = `otherday-${crypto.randomUUID().slice(0, 8)}`;
    const token = await createAccount(username);

    const res = await fetch(new URL("/api/run-end", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `token=${token}` },
      body: JSON.stringify({ distance: 77, lane: 0, seed: OTHER_DAY }),
    });
    expect(res.status, await res.text()).toBe(403);

    await expect(
      session.waitFor((m) => m.type === "ghost" && m.ghost?.username === username, 400),
    ).rejects.toThrow();
  } finally {
    session.close();
  }
});

it("a session that opens later is given what it missed", async () => {
  const seed = todayUtc();
  const username = `backfill-${crypto.randomUUID().slice(0, 8)}`;
  const token = await createAccount(username);
  await postRun(token, 456.5, seed);

  // A fresh subscribe stands in for a reconnect: same code path on both sides,
  // which is the point of answering every subscribe with the full list.
  const session = await openSession(seed);
  try {
    const first = session.received.find((m) => m.type === "ghosts")!;
    expect(first.ghosts).toContainEqual(expect.objectContaining({ username, distance: 456.5 }));
  } finally {
    session.close();
  }
});

it("only an improvement is broadcast", async () => {
  const seed = todayUtc();
  const username = `pb-${crypto.randomUUID().slice(0, 8)}`;
  const token = await createAccount(username);
  await postRun(token, 500, seed);

  const session = await openSession(seed);
  try {
    await postRun(token, 100, seed); // worse than the stored best
    await expect(
      session.waitFor((m) => m.type === "ghost" && m.ghost?.username === username, 400),
    ).rejects.toThrow();

    await postRun(token, 900, seed); // better
    const improved = await session.waitFor(
      (m) => m.type === "ghost" && m.ghost?.username === username,
      WITHIN_MS,
    );
    expect(improved.ghost).toMatchObject({ distance: 900 });
  } finally {
    session.close();
  }
});

// ---- crews (ADR 0011) ----
// The live feed has to agree with what GET /api/ghosts would hand the same
// viewer. spec/crews.test.ts pins the HTTP half; these pin that the socket
// says the same thing, because a disagreement between them means reconnecting
// silently changes what you can see.

async function makeCrew(token: string): Promise<string> {
  const res = await fetch(new URL("/api/crews", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `token=${token}` },
    body: JSON.stringify({ name: "live crew" }),
  });
  // One read of the body: res.text() consumes it even on a pass, and a
  // res.json() after that throws rather than asserting anything.
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return (JSON.parse(text) as { crew: { inviteToken: string } }).crew.inviteToken;
}

async function join(token: string, invite: string): Promise<void> {
  const res = await fetch(new URL(`/api/crews/${invite}/join`, baseUrl), {
    method: "POST",
    headers: { cookie: `token=${token}` },
  });
  expect(res.status, await res.text()).toBe(200);
}

it("two crew members see each other's finished runs live; an outsider's crew does not", async () => {
  const seed = todayUtc();
  const aName = `cw-a-${crypto.randomUUID().slice(0, 8)}`;
  const bName = `cw-b-${crypto.randomUUID().slice(0, 8)}`;
  const cName = `cw-c-${crypto.randomUUID().slice(0, 8)}`;
  const [aToken, bToken, cToken] = await Promise.all([
    createAccount(aName),
    createAccount(bName),
    createAccount(cName),
  ]);

  const invite = await makeCrew(aToken);
  await join(bToken, invite);
  // C is in a DIFFERENT crew, not crew-less: a crew-less viewer legitimately
  // sees everyone (that is what /api/ghosts does for them), so they would be
  // the wrong control here.
  await join(cToken, await makeCrew(cToken));

  // Sockets opened and subscribed BEFORE the run, and never touched again —
  // same discipline as the first test in this file.
  const [b, c] = await Promise.all([openSession(seed, bToken), openSession(seed, cToken)]);
  try {
    await postRun(aToken, 777.5, seed);

    const isA = (m: Message): boolean => m.type === "ghost" && m.ghost?.username === aName;
    const seenByB = await b.waitFor(isA, WITHIN_MS);
    expect(seenByB.ghost).toMatchObject({ username: aName, distance: 777.5 });

    // Already waited out B's arrival, so this window only has to be long
    // enough to catch a push that was going to happen.
    await expect(c.waitFor(isA, 400)).rejects.toThrow();
  } finally {
    b.close();
    c.close();
  }
});

it("a crew-less session still sees a crew member's run, exactly as /api/ghosts would", async () => {
  const seed = todayUtc();
  const authorName = `cw-author-${crypto.randomUUID().slice(0, 8)}`;
  const authorToken = await createAccount(authorName);
  await join(authorToken, await makeCrew(authorToken));

  // The anonymous socket is the case the symmetric "crews must match" rule
  // would have broken: GET /api/ghosts hands this viewer the author's run,
  // so the socket has to as well.
  const watcher = await openSession(seed);
  try {
    await postRun(authorToken, 888.5, seed);
    const seen = await watcher.waitFor(
      (m) => m.type === "ghost" && m.ghost?.username === authorName,
      WITHIN_MS,
    );
    expect(seen.ghost).toMatchObject({ distance: 888.5 });
  } finally {
    watcher.close();
  }
});

it("a subscribe's backfill is crew-scoped too", async () => {
  const seed = todayUtc();
  const memberName = `bf-in-${crypto.randomUUID().slice(0, 8)}`;
  const outsiderName = `bf-out-${crypto.randomUUID().slice(0, 8)}`;
  const [memberToken, outsiderToken] = await Promise.all([
    createAccount(memberName),
    createAccount(outsiderName),
  ]);

  await join(memberToken, await makeCrew(memberToken));
  await postRun(memberToken, 640.5, seed);
  await postRun(outsiderToken, 650.5, seed);

  const session = await openSession(seed, memberToken);
  try {
    const first = session.received.find((m) => m.type === "ghosts")!;
    const names = (first.ghosts ?? []).map((g) => g.username);
    expect(names).toContain(memberName);
    // The full list on subscribe is what a reconnect rebuilds from, so if it
    // leaked the whole day, dropping and reconnecting would quietly widen a
    // crew member's road back out.
    expect(names).not.toContain(outsiderName);
  } finally {
    session.close();
  }
});
