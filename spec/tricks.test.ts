import { expect, inject, it } from "vitest";

// The permission half of the tricks catalogue, over HTTP against the running
// app — the same shape spec/skins.test.ts already proves for skins
// (doc/adr/0010, doc/adr/0013). Tricks briefly gained an equip concept in
// doc/adr/0018, mirroring skins.test.ts's equip coverage; doc/adr/0020
// removed it, and this file no longer tests any equip route.
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
    body: JSON.stringify({ username: `trick-${crypto.randomUUID().slice(0, 6)}` }),
  });
  expect(res.status, await res.text()).toBe(200);
  return tokenFrom(res);
}

const as = (token: string, path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(new URL(path, baseUrl), { ...init, headers: { cookie: `token=${token}`, ...init.headers } });

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
