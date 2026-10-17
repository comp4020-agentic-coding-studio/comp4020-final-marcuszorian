import { expect, inject, it } from "vitest";

// Crews over HTTP against the running app. The refusals are the point: an
// invite that is full or expired is declined by the SERVER, and knowing the
// token is not enough to get past either. See doc/adr/0011-crews.md.
const baseUrl = inject("baseUrl");

function tokenFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/token=([^;]+)/);
  if (!match) throw new Error(`no token cookie in response: ${raw}`);
  return match[1]!;
}

async function createAccount(prefix = "crew"): Promise<{ token: string; username: string }> {
  const username = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  const res = await fetch(new URL("/api/account", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  expect(res.status, await res.text()).toBe(200);
  return { token: tokenFrom(res), username };
}

const as = (token: string, path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(new URL(path, baseUrl), {
    ...init,
    headers: { cookie: `token=${token}`, "content-type": "application/json", ...init.headers },
  });

interface CrewBody {
  crew: {
    id: number;
    name: string;
    inviteToken: string;
    joinCount: number;
    maxJoins: number | null;
    memberCount: number;
    open: boolean;
  };
}

async function makeCrew(
  token: string,
  body: Record<string, unknown> = {},
): Promise<CrewBody["crew"]> {
  const res = await as(token, "/api/crews", {
    method: "POST",
    body: JSON.stringify({ name: "test crew", ...body }),
  });
  // Read the body ONCE. `expect(res.status, await res.text())` reads it even
  // when the assertion passes, and the json() after it then throws "Body has
  // already been read" — which fails the test for a reason that has nothing
  // to do with what it is checking.
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return (JSON.parse(text) as CrewBody).crew;
}

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

async function postRun(token: string, distance: number): Promise<void> {
  const res = await as(token, "/api/run-end", {
    method: "POST",
    body: JSON.stringify({ distance, lane: 0 }),
  });
  expect(res.status, await res.text()).toBe(200);
}

it("creates a crew, puts its creator in it, and hands back an invite link", async () => {
  const owner = await createAccount();
  const crew = await makeCrew(owner.token);

  expect(crew.memberCount).toBe(1);
  // The creator's own membership is a join, so a link capped at 3 admits the
  // creator plus two — not plus three.
  expect(crew.joinCount).toBe(1);

  const mine = (await (await as(owner.token, "/api/crews/me")).json()) as CrewBody;
  expect(mine.crew.id).toBe(crew.id);
});

it("lets a stranger see what an invite points at before they join it", async () => {
  const owner = await createAccount();
  const crew = await makeCrew(owner.token, { name: "peekable" });

  // No cookie: the invite has to say what it is before demanding an account.
  const res = await fetch(new URL(`/api/crews/${crew.inviteToken}`, baseUrl));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ name: "peekable", open: true });
});

it("joining a second crew replaces the first", async () => {
  const a = await createAccount();
  const b = await createAccount();
  const joiner = await createAccount();

  const first = await makeCrew(a.token, { name: "first" });
  const second = await makeCrew(b.token, { name: "second" });

  expect((await as(joiner.token, `/api/crews/${first.inviteToken}/join`, { method: "POST" })).status).toBe(200);
  expect((await as(joiner.token, `/api/crews/${second.inviteToken}/join`, { method: "POST" })).status).toBe(200);

  const mine = (await (await as(joiner.token, "/api/crews/me")).json()) as CrewBody;
  expect(mine.crew.id).toBe(second.id);
  expect(mine.crew.name).toBe("second");
});

it("counts joins ever, which keeps counting through a leave", async () => {
  const owner = await createAccount();
  const leaver = await createAccount();
  const elsewhere = await createAccount();

  const crew = await makeCrew(owner.token, { name: "revolving door" });
  await as(leaver.token, `/api/crews/${crew.inviteToken}/join`, { method: "POST" });

  // The leaver goes somewhere else, which is the only way to leave.
  const other = await makeCrew(elsewhere.token, { name: "elsewhere" });
  await as(leaver.token, `/api/crews/${other.inviteToken}/join`, { method: "POST" });

  const after = (await (await as(owner.token, "/api/crews/me")).json()) as CrewBody;
  // Two different numbers, deliberately: the link has been used twice (the
  // creator plus the leaver) and lives there forever, while live membership
  // is back down to one. The schema comment says they look interchangeable
  // and aren't — this is that.
  expect(after.crew.joinCount).toBe(2);
  expect(after.crew.memberCount).toBe(1);
});

it("refuses a join past max_joins", async () => {
  const owner = await createAccount();
  // 2 total: the creator, plus exactly one other.
  const crew = await makeCrew(owner.token, { name: "capped", maxJoins: 2 });

  const first = await createAccount();
  expect((await as(first.token, `/api/crews/${crew.inviteToken}/join`, { method: "POST" })).status).toBe(200);

  const second = await createAccount();
  const refused = await as(second.token, `/api/crews/${crew.inviteToken}/join`, { method: "POST" });
  // 410 Gone, not 404: the invite was real and is no longer usable, which is
  // a different thing from never having existed.
  expect(refused.status).toBe(410);

  // And the refusal left them crew-less rather than half-joined.
  const mine = (await (await as(second.token, "/api/crews/me")).json()) as { crew: null };
  expect(mine.crew).toBeNull();
});

it("refuses a join past expires_at", async () => {
  const owner = await createAccount();
  // Already expired by the time it exists: a negative TTL is rejected as a
  // bad request, so this asks for the shortest real one and waits it out.
  const crew = await makeCrew(owner.token, { name: "fleeting", expiresInSeconds: 1 });
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const latecomer = await createAccount();
  const refused = await as(latecomer.token, `/api/crews/${crew.inviteToken}/join`, { method: "POST" });
  expect(refused.status).toBe(410);

  // The read endpoint agrees — the invite page can say so before anyone tries.
  const peek = (await (await fetch(new URL(`/api/crews/${crew.inviteToken}`, baseUrl))).json()) as {
    open: boolean;
  };
  expect(peek.open).toBe(false);
});

it("404s an unknown invite, and 401s a signed-out join", async () => {
  const stranger = await createAccount();
  expect((await as(stranger.token, "/api/crews/not-a-token/join", { method: "POST" })).status).toBe(404);
  expect(
    (await fetch(new URL("/api/crews/not-a-token/join", baseUrl), { method: "POST" })).status,
  ).toBe(401);
});

// The behavioural heart of ADR 0011: the same best_runs rows, read two ways.
it("scopes /api/ghosts to the crew for a member and to everyone for a stranger", async () => {
  const seed = todayUtc();
  const inside = await createAccount("inside");
  const alsoInside = await createAccount("inside");
  const outside = await createAccount("outside");

  const crew = await makeCrew(inside.token, { name: "scoped" });
  expect(
    (await as(alsoInside.token, `/api/crews/${crew.inviteToken}/join`, { method: "POST" })).status,
  ).toBe(200);

  // Deliberately enormous distances. /api/ghosts is `ORDER BY distance DESC
  // LIMIT 50`, and spec/ runs against one long-lived database, so a modest
  // run can genuinely fall off the global list and fail this for a reason
  // that has nothing to do with crews. The crew-scoped read has no such
  // problem (three rows), but the global assertion below does.
  await postRun(inside.token, 900_010);
  await postRun(alsoInside.token, 900_020);
  await postRun(outside.token, 900_030);

  const names = async (token?: string, query = ""): Promise<string[]> => {
    const path = `/api/ghosts?seed=${seed}${query}`;
    const res = token ? await as(token, path) : await fetch(new URL(path, baseUrl));
    expect(res.status).toBe(200);
    return ((await res.json()) as { username: string }[]).map((g) => g.username);
  };

  const crewView = await names(inside.token);
  expect(crewView).toContain(alsoInside.username);
  expect(crewView).not.toContain(outside.username);

  // Same rows, no filter: a crew-less viewer still sees everyone, crew
  // members included. The narrowing is a property of the VIEWER, not of the
  // run — which is why the live broadcast asks "does this client's scope
  // include the author", not "do these two crews match".
  const strangerView = await names(outside.token);
  expect(strangerView).toEqual(expect.arrayContaining([inside.username, outside.username]));

  // ?scope=global is the leaderboard panel's escape hatch: it is what lets a
  // crew member still see the whole day on the panel while the road stays
  // narrowed. The road never passes it.
  const globalTab = await names(inside.token, "&scope=global");
  expect(globalTab).toContain(outside.username);
});
