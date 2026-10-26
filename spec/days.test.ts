import { expect, inject, it } from "vitest";

// A day is a first-class, replayable unit (doc/adr/0002-daily-seeded-archive.md):
// posting against a past day doesn't bleed into today's ghosts, a future day
// is rejected outright, and /api/days surfaces which days are worth racing.
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

function shiftDay(delta: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// ADR 0006 reversed this: a past day used to be writable, and the test that
// used to live here asserted a run posted against yesterday landed on
// yesterday. A past day's record is now closed, so what matters is that the
// write is refused AND that the refusal leaves no trace behind.
it("refuses a run posted against a past day, and records nothing", async () => {
  const username = `history-${crypto.randomUUID().slice(0, 6)}`;
  const token = await createAccount(username);
  const yesterday = shiftDay(-1);

  const runRes = await fetch(new URL("/api/run-end", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `token=${token}` },
    body: JSON.stringify({ distance: 77, lane: 0, seed: yesterday }),
  });
  // 403, not 400: yesterday is a real day, and the request is understood and
  // declined. A future date stays a 400 (see the test below) — the two
  // refusals mean different things and the status codes keep them apart.
  expect(runRes.status, await runRes.text()).toBe(403);

  const yesterdayGhosts = (await (
    await fetch(new URL(`/api/ghosts?seed=${yesterday}`, baseUrl))
  ).json()) as { username: string }[];
  expect(yesterdayGhosts.some((g) => g.username === username)).toBe(false);
});

// The read half of ADR 0002 is untouched and this is what guards it: a past
// day is still fully visitable, which is the whole archive mechanic.
it("still serves a past day's ghosts to anyone who visits", async () => {
  const res = await fetch(new URL(`/api/ghosts?seed=${shiftDay(-1)}`, baseUrl));
  expect(res.status).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});

it("rejects a run posted against a day that hasn't happened yet", async () => {
  const token = await createAccount(`future-${crypto.randomUUID().slice(0, 6)}`);
  const tomorrow = shiftDay(1);

  const res = await fetch(new URL("/api/run-end", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `token=${token}` },
    body: JSON.stringify({ distance: 10, seed: tomorrow }),
  });
  expect(res.status).toBe(400);
});

// Was: posted against two-days-ago and expected /api/days to grow that entry.
// Under ADR 0006 writes are today-only, so the day list can only ever grow a
// "today" — which is the point: it is now a record of days played while they
// were current, not a list of days somebody backfilled.
it("/api/days reflects today once played, and stays newest-first", async () => {
  const token = await createAccount(`days-${crypto.randomUUID().slice(0, 6)}`);
  const today = shiftDay(0);

  const res = await fetch(new URL("/api/run-end", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `token=${token}` },
    body: JSON.stringify({ distance: 5 }), // no seed — defaults to today
  });
  expect(res.status, await res.text()).toBe(200);

  const days = (await (await fetch(new URL("/api/days", baseUrl))).json()) as string[];
  expect(days).toContain(today);
  expect(days).toEqual([...days].sort().reverse()); // newest first
});
