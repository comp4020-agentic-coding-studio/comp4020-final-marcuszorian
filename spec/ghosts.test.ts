import { expect, inject, it } from "vitest";

// Proxy for the spec's "a stranger can visit, do the core thing, and find
// their trace still there when they come back": post a run, confirm it
// reappears on a later read, against the RUNNING app over HTTP (same pattern
// as spec/invariants.test.ts) — full WebGL E2E isn't practical here, so the
// API-level round trip is the deliberate stand-in.
const baseUrl = inject("baseUrl");

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

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

it("a posted run shows up as a ghost for today", async () => {
  const username = `player-${crypto.randomUUID().slice(0, 8)}`;
  const token = await createAccount(username);

  const runRes = await fetch(new URL("/api/run-end", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `token=${token}` },
    body: JSON.stringify({ distance: 42.5, lane: 0.3 }),
  });
  expect(runRes.status, await runRes.text()).toBe(200);

  const ghostsRes = await fetch(new URL(`/api/ghosts?seed=${todayUtc()}`, baseUrl));
  expect(ghostsRes.status).toBe(200);
  const ghosts = (await ghostsRes.json()) as { username: string; distance: number }[];
  expect(ghosts).toContainEqual(
    expect.objectContaining({ username, distance: 42.5 }),
  );
});

it("a day nobody has played returns no ghosts", async () => {
  const res = await fetch(new URL("/api/ghosts?seed=2020-01-01", baseUrl));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

it("rejects a second account with the same username", async () => {
  const username = `dup-${crypto.randomUUID().slice(0, 8)}`;
  await createAccount(username);

  const res = await fetch(new URL("/api/account", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  expect(res.status).toBe(409);
});

// The regression that made every other check in this file pass while the
// actual game saved nothing: the auth cookie is httpOnly, so the client could
// not see it, decided nobody was signed in, and skipped POST /api/run-end
// entirely. Nothing here caught it because every test above sends the cookie
// by hand. /api/me is the question the browser now has to ask instead, so
// these pin its two answers.
it("tells a signed-in browser who it is", async () => {
  const username = `me-${crypto.randomUUID().slice(0, 8)}`;
  const token = await createAccount(username);

  const res = await fetch(new URL("/api/me", baseUrl), { headers: { cookie: `token=${token}` } });
  expect(res.status).toBe(200);
  // toMatchObject, not toEqual: /api/me grew `coins` and `equippedSkin`
  // alongside the username (ADR 0010), and the question this test asks is
  // "does a signed-in browser get told who it is" — pinning the exact shape
  // here would make every later field a failure of the identity check.
  // spec/skins.test.ts pins the economy fields themselves.
  expect(await res.json()).toMatchObject({ username });
});

it("tells a browser with no cookie that it is nobody", async () => {
  const res = await fetch(new URL("/api/me", baseUrl));
  expect(res.status).toBe(401);
});
