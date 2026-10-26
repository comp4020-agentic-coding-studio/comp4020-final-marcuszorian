import { expect, inject, it } from "vitest";

// The permission half of the coin economy, over HTTP against the running app:
// can one user touch state that isn't theirs? Every check here is a refusal
// the SERVER makes — the client's UI hides these buttons, but hiding is not
// enforcing, and curl doesn't read CSS. See doc/adr/0010-coin-economy.md.
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
    body: JSON.stringify({ username: `skin-${crypto.randomUUID().slice(0, 6)}` }),
  });
  expect(res.status, await res.text()).toBe(200);
  return tokenFrom(res);
}

const as = (token: string, path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(new URL(path, baseUrl), { ...init, headers: { cookie: `token=${token}`, ...init.headers } });

it("offers a catalogue, and a fresh account owns none of it", async () => {
  const token = await createAccount();
  const res = await as(token, "/api/skins");
  expect(res.status).toBe(200);

  const body = (await res.json()) as { coins: number; skins: { id: string; owned: boolean }[] };
  expect(body.coins).toBe(0);
  expect(body.skins.length).toBeGreaterThan(0);
  expect(body.skins.every((s) => !s.owned)).toBe(true);

  // ADR 0003's colour grammar, enforced by the catalogue's contents: `red`
  // means obstacle and `lavender` means ghost, so neither is ever for sale.
  // `magenta` is absent too — it is the free default, and nothing you
  // already have belongs in a shop.
  const ids = body.skins.map((s) => s.id);
  expect(ids).not.toContain("red");
  expect(ids).not.toContain("lavender");
  expect(ids).not.toContain("magenta");
});

it("refuses an unlock you cannot afford, and charges nothing", async () => {
  const token = await createAccount();
  const res = await as(token, "/api/skins/cyan/unlock", { method: "POST" });
  expect(res.status).toBe(402);

  // The important half: the skin was not granted on the way to the refusal.
  // The deduction and the grant are one transaction, so a failed charge
  // rolls the grant back rather than handing it over free.
  const after = (await (await as(token, "/api/skins")).json()) as {
    coins: number;
    skins: { id: string; owned: boolean }[];
  };
  expect(after.coins).toBe(0);
  expect(after.skins.find((s) => s.id === "cyan")?.owned).toBe(false);
});

it("refuses equipping a skin you do not own", async () => {
  const token = await createAccount();
  const res = await as(token, "/api/skins/gold/equip", { method: "POST" });
  // 403, not 404: the skin exists, and the answer is "understood, and
  // declined" — the same distinction runs.ts draws for a past day.
  expect(res.status).toBe(403);

  const me = (await (await as(token, "/api/me")).json()) as { equippedSkin: string | null };
  expect(me.equippedSkin).toBeNull();
});

it("404s an unlock or equip of a skin that does not exist", async () => {
  const token = await createAccount();
  expect((await as(token, "/api/skins/not-a-colour/unlock", { method: "POST" })).status).toBe(404);
  expect((await as(token, "/api/skins/not-a-colour/equip", { method: "POST" })).status).toBe(404);
});

it("refuses an unlock from a signed-out browser", async () => {
  const res = await fetch(new URL("/api/skins/cyan/unlock", baseUrl), { method: "POST" });
  expect(res.status).toBe(401);
});

it("always lets you wear the free default", async () => {
  const token = await createAccount();
  const res = await as(token, "/api/skins/default/equip", { method: "POST" });
  expect(res.status).toBe(200);
  expect((await res.json()) as { equipped: string | null }).toEqual(
    expect.objectContaining({ equipped: null }),
  );
});

it("reports coins and the equipped skin on /api/me", async () => {
  const token = await createAccount();
  const me = (await (await as(token, "/api/me")).json()) as Record<string, unknown>;
  expect(me).toMatchObject({ coins: 0, equippedSkin: null });
  expect(typeof me.username).toBe("string");
});
