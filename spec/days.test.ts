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

it("a run posted against an explicit past day stays on that day only", async () => {
  const username = `history-${crypto.randomUUID().slice(0, 8)}`;
  const token = await createAccount(username);
  const yesterday = shiftDay(-1);

  const runRes = await fetch(new URL("/api/run-end", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `token=${token}` },
    body: JSON.stringify({ distance: 77, lane: 0, seed: yesterday }),
  });
  expect(runRes.status, await runRes.text()).toBe(200);

  const yesterdayGhosts = (await (
    await fetch(new URL(`/api/ghosts?seed=${yesterday}`, baseUrl))
  ).json()) as { username: string }[];
  expect(yesterdayGhosts.some((g) => g.username === username)).toBe(true);

  const todayGhosts = (await (
    await fetch(new URL(`/api/ghosts?seed=${shiftDay(0)}`, baseUrl))
  ).json()) as { username: string }[];
  expect(todayGhosts.some((g) => g.username === username)).toBe(false);
});

it("rejects a run posted against a day that hasn't happened yet", async () => {
  const token = await createAccount(`future-${crypto.randomUUID().slice(0, 8)}`);
  const tomorrow = shiftDay(1);

  const res = await fetch(new URL("/api/run-end", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `token=${token}` },
    body: JSON.stringify({ distance: 10, seed: tomorrow }),
  });
  expect(res.status).toBe(400);
});

it("/api/days reflects a day just played", async () => {
  const token = await createAccount(`days-${crypto.randomUUID().slice(0, 8)}`);
  const twoDaysAgo = shiftDay(-2);

  await fetch(new URL("/api/run-end", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `token=${token}` },
    body: JSON.stringify({ distance: 5, seed: twoDaysAgo }),
  });

  const days = (await (await fetch(new URL("/api/days", baseUrl))).json()) as string[];
  expect(days).toContain(twoDaysAgo);
  expect(days).toEqual([...days].sort().reverse()); // newest first
});
