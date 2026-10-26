import { expect, inject, it } from "vitest";

// #leaderboard (client/index.html) is sized to fit a 15-character username
// without ellipsis-truncating it. The client's <input maxlength="15"> is
// cosmetic only — nothing stops a direct POST to this endpoint from
// bypassing it — so the server has to hold the limit itself, or the
// leaderboard's fit guarantee is just prose.
const baseUrl = inject("baseUrl");

async function createAccount(username: string): Promise<Response> {
  return fetch(new URL("/api/account", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
}

it("accepts a username at exactly the 15-character limit", async () => {
  const username = `acct${crypto.randomUUID().slice(0, 11)}`.slice(0, 15);
  const res = await createAccount(username);
  expect(res.status, await res.text()).toBe(200);
});

it("refuses a username over the 15-character limit", async () => {
  const username = `too-long-${crypto.randomUUID()}`; // well over 15 chars
  const res = await createAccount(username);
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/15 characters or fewer/);
});
