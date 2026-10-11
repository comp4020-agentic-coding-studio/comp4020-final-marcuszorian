import { expect, inject, it } from "vitest";

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

/** An open, subscribed session that records everything pushed to it. */
async function openSession(seed: string): Promise<{
  received: Message[];
  waitFor(match: (m: Message) => boolean, ms: number): Promise<Message>;
  close(): void;
}> {
  const socket = new WebSocket(wsUrl);
  const received: Message[] = [];
  const waiters: { match: (m: Message) => boolean; resolve: (m: Message) => void }[] = [];

  socket.addEventListener("message", (event) => {
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
