import { expect, inject, it } from "vitest";

// The permission half of the tricks catalogue, over HTTP against the running
// app — the same shape spec/skins.test.ts already proves for skins
// (doc/adr/0010, doc/adr/0013, doc/adr/0018). Tricks gained an equip concept
// in 0018, so this file now mirrors skins.test.ts's equip coverage too.
const baseUrl = inject("baseUrl");

function tokenFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/token=([^;]+)/);
  if (!match) throw new Error(`no token cookie in response: ${raw}`);
  return match[1]!;
}

async function createAccount(): Promise<string> {
  const res = await fetch(new URL("/api/account", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: `trick-${crypto.randomUUID().slice(0, 8)}` }),
  });
  expect(res.status, await res.text()).toBe(200);
  return tokenFrom(res);
}

const as = (token: string, path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(new URL(path, baseUrl), { ...init, headers: { cookie: `token=${token}`, ...init.headers } });

/** Coin pickups credit via /api/run-end (doc/adr/0015) — the only way a test
 * account can afford a trick without reaching into the database directly. */
async function grantCoins(token: string, coins: number): Promise<void> {
  const res = await as(token, "/api/run-end", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ distance: 0, lane: 0, coins }),
  });
  expect(res.status, await res.text()).toBe(200);
}

it("offers a catalogue, and a fresh account owns none of it", async () => {
  const token = await createAccount();
  const res = await as(token, "/api/tricks");
  expect(res.status).toBe(200);

  const body = (await res.json()) as { coins: number; tricks: { id: string; owned: boolean }[] };
  expect(body.coins).toBe(0);
  expect(body.tricks.length).toBeGreaterThan(0);
  expect(body.tricks.every((t) => !t.owned)).toBe(true);
});

it("refuses an unlock you cannot afford, and charges nothing", async () => {
  const token = await createAccount();
  const res = await as(token, "/api/tricks/tailwhip/unlock", { method: "POST" });
  expect(res.status).toBe(402);

  // The important half: the trick was not granted on the way to the refusal.
  // The deduction and the grant are one transaction, so a failed charge
  // rolls the grant back rather than handing it over free.
  const after = (await (await as(token, "/api/tricks")).json()) as {
    coins: number;
    tricks: { id: string; owned: boolean }[];
  };
  expect(after.coins).toBe(0);
  expect(after.tricks.find((t) => t.id === "tailwhip")?.owned).toBe(false);
});

it("404s an unlock of a trick that does not exist", async () => {
  const token = await createAccount();
  expect((await as(token, "/api/tricks/not-a-trick/unlock", { method: "POST" })).status).toBe(404);
});

it("refuses an unlock from a signed-out browser", async () => {
  const res = await fetch(new URL("/api/tricks/tailwhip/unlock", baseUrl), { method: "POST" });
  expect(res.status).toBe(401);
});

// Equip coverage (doc/adr/0018), mirroring spec/skins.test.ts's own equip
// tests over /api/skins/:id/equip.
it("equips an owned trick, and it persists across catalogue reads", async () => {
  const token = await createAccount();
  await grantCoins(token, 100);
  expect((await as(token, "/api/tricks/tailwhip/unlock", { method: "POST" })).status).toBe(200);

  const res = await as(token, "/api/tricks/tailwhip/equip", { method: "POST" });
  expect(res.status).toBe(200);
  expect((await res.json()) as { equipped: string | null }).toEqual(
    expect.objectContaining({ equipped: "tailwhip" }),
  );

  const after = (await (await as(token, "/api/tricks")).json()) as {
    tricks: { id: string; equipped: boolean }[];
  };
  expect(after.tricks.find((t) => t.id === "tailwhip")?.equipped).toBe(true);
});

it("equipping a second owned trick unequips the first", async () => {
  const token = await createAccount();
  await grantCoins(token, 1000);
  expect((await as(token, "/api/tricks/tailwhip/unlock", { method: "POST" })).status).toBe(200);
  expect((await as(token, "/api/tricks/superman/unlock", { method: "POST" })).status).toBe(200);

  expect((await as(token, "/api/tricks/tailwhip/equip", { method: "POST" })).status).toBe(200);
  expect((await as(token, "/api/tricks/superman/equip", { method: "POST" })).status).toBe(200);

  const after = (await (await as(token, "/api/tricks")).json()) as {
    tricks: { id: string; equipped: boolean }[];
  };
  expect(after.tricks.find((t) => t.id === "tailwhip")?.equipped).toBe(false);
  expect(after.tricks.find((t) => t.id === "superman")?.equipped).toBe(true);
});

it("refuses equipping a trick you do not own", async () => {
  const token = await createAccount();
  // 403, not 404: the trick exists, and the answer is "understood, and
  // declined" — the same distinction routes/skins.ts's equip route draws.
  const res = await as(token, "/api/tricks/tailwhip/equip", { method: "POST" });
  expect(res.status).toBe(403);
});

it("404s an equip of a trick that does not exist", async () => {
  const token = await createAccount();
  expect((await as(token, "/api/tricks/not-a-trick/equip", { method: "POST" })).status).toBe(404);
});

it("always lets you equip the free default", async () => {
  const token = await createAccount();
  await grantCoins(token, 100);
  await as(token, "/api/tricks/tailwhip/unlock", { method: "POST" });
  await as(token, "/api/tricks/tailwhip/equip", { method: "POST" });

  const res = await as(token, "/api/tricks/default/equip", { method: "POST" });
  expect(res.status).toBe(200);
  expect((await res.json()) as { equipped: string | null }).toEqual(
    expect.objectContaining({ equipped: null }),
  );

  const after = (await (await as(token, "/api/tricks")).json()) as {
    tricks: { id: string; equipped: boolean }[];
  };
  expect(after.tricks.every((t) => !t.equipped)).toBe(true);
});

it("refuses an equip from a signed-out browser", async () => {
  const res = await fetch(new URL("/api/tricks/tailwhip/equip", baseUrl), { method: "POST" });
  expect(res.status).toBe(401);
});
