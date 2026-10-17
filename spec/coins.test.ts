import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// better-sqlite3 directly, NOT src/server/db.ts: that module opens the real
// database at import time (`export const db = openDb()`), which under vitest
// means trying to mkdir /data before a single test has run. lib/coins.ts and
// lib/skins.ts take a Database precisely so they can be driven without it.
import Database from "better-sqlite3";
import { coinsForRank, dayBefore, settleDay, settleDue } from "../src/server/lib/coins.ts";
import { equipSkin, unlockSkin } from "../src/server/lib/skins.ts";

// Unlike the rest of spec/, these run against a THROWAWAY database rather
// than the live app over HTTP — and that is forced, not a shortcut. The whole
// subject here is what happens to a day that is already closed, and ADR 0006
// correctly refuses to let anything write a run to a past day over the API.
// There is no way to set up "yesterday had five players on it" through the
// HTTP surface, so the payout would be untestable at the only level that
// matters. lib/coins.ts takes a Database for exactly this reason.
//
// What this gives up is real: it does not prove the router calls settleDue().
// spec/skins.test.ts covers the HTTP half, and the walk itself is pinned here.

let dir: string;
let db: Database.Database;

/** A migrated, throwaway database. The REAL migrations — a hand-written test
 *  schema that drifts from migrations/ passes while production breaks. */
function freshDb(name: string): Database.Database {
  const path = join(dir, name);
  execFileSync("node", ["src/server/migrate.ts"], {
    env: { ...process.env, DB_PATH: path },
    stdio: "ignore",
  });
  const open = new Database(path);
  open.pragma("foreign_keys = ON");
  return open;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "coins-"));
  db = freshDb("app.db");
});

afterAll(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

let nextId = 0;
function player(name: string): number {
  const id = db
    .prepare("INSERT INTO users (username, token) VALUES (?, ?)")
    .run(`${name}-${++nextId}`, `tok-${nextId}`).lastInsertRowid;
  return Number(id);
}

function run(userId: number, seed: string, distance: number): void {
  db.prepare("INSERT INTO best_runs (user_id, track_seed, distance, lane) VALUES (?, ?, ?, 0)").run(
    userId,
    seed,
    distance,
  );
}

const coinsOf = (id: number): number =>
  (db.prepare("SELECT coins FROM users WHERE id = ?").get(id) as { coins: number }).coins;

describe("the curve", () => {
  it("pays 100 down to 10 for ranks 1..10, and nothing below", () => {
    expect(coinsForRank(1)).toBe(100);
    expect(coinsForRank(10)).toBe(10);
    expect(coinsForRank(11)).toBe(0);
    expect(coinsForRank(0)).toBe(0);
  });
});

describe("settling a closed day", () => {
  it("pays the top ten and nobody else", () => {
    const seed = "2024-03-01";
    // Twelve players on descending distances, so rank is unambiguous.
    const ids = Array.from({ length: 12 }, (_, i) => {
      const id = player(`p${i}`);
      run(id, seed, 1000 - i * 10);
      return id;
    });

    const paid = settleDay(db, seed);
    expect(paid).toHaveLength(10);
    expect(coinsOf(ids[0]!)).toBe(100); // 1st
    expect(coinsOf(ids[9]!)).toBe(10); // 10th
    expect(coinsOf(ids[10]!)).toBe(0); // 11th earns nothing
    expect(coinsOf(ids[11]!)).toBe(0);
  });

  it("settling twice does not double-pay", () => {
    const seed = "2024-03-02";
    const id = player("repeat");
    run(id, seed, 500);

    expect(settleDay(db, seed)).toHaveLength(1);
    expect(coinsOf(id)).toBe(100);

    // Idempotence is coin_payouts' primary key, not a flag — so this holds
    // even though nothing recorded that the day was "done".
    expect(settleDay(db, seed)).toEqual([]);
    expect(coinsOf(id)).toBe(100);
  });

  it("pays a tie the rank standings() assigns, never a split", () => {
    const seed = "2024-03-03";
    // Same distance; ADR 0009 breaks the tie alphabetically with SEQUENTIAL
    // ranks, so these are 1st and 2nd, not two half-shares of first.
    const zoe = db.prepare("INSERT INTO users (username, token) VALUES ('zoe', 'tok-zoe')").run();
    const ada = db.prepare("INSERT INTO users (username, token) VALUES ('ada', 'tok-ada')").run();
    const zoeId = Number(zoe.lastInsertRowid);
    const adaId = Number(ada.lastInsertRowid);
    run(zoeId, seed, 900);
    run(adaId, seed, 900);

    settleDay(db, seed);
    expect(coinsOf(adaId)).toBe(100); // 1st, alphabetically
    expect(coinsOf(zoeId)).toBe(90); // 2nd — a real rank, not 95 each
  });
});

// spec/skins.test.ts covers the refusals over HTTP, where they belong. These
// two need a player who can AFFORD something, and the only way to get coins
// is to be paid for a closed day — which HTTP cannot set up, for the reason
// at the top of this file.
describe("spending what a closed day paid", () => {
  it("charges once, and a repeat unlock is free rather than a second charge", () => {
    const seed = "2024-03-04";
    const id = player("rich");
    run(id, seed, 800);
    settleDay(db, seed); // 100 coins, 1st on a one-player day

    const first = unlockSkin(db, id, "cyan"); // costs 120 — more than 100
    expect(first).toMatchObject({ ok: false, reason: "insufficient" });
    expect(coinsOf(id)).toBe(100);

    // Pay for a few more days so there's something in the account.
    for (const day of ["2024-03-05", "2024-03-06"]) {
      run(id, day, 800);
      settleDay(db, day);
    }
    expect(coinsOf(id)).toBe(300);

    expect(unlockSkin(db, id, "cyan")).toMatchObject({ ok: true });
    expect(coinsOf(id)).toBe(180);

    // Already owned: not an error, and explicitly not a second charge.
    expect(unlockSkin(db, id, "cyan")).toMatchObject({ ok: true });
    expect(coinsOf(id)).toBe(180);
  });

  it("lets you wear what you bought, and only that", () => {
    const id = player("buyer");
    // Two closed days at 100 each: the cheapest skin is 120, so one first
    // place does not cover one colour.
    for (const seed of ["2024-03-07", "2024-03-08"]) {
      run(id, seed, 800);
      settleDay(db, seed);
    }
    expect(unlockSkin(db, id, "cyan")).toMatchObject({ ok: true });

    expect(equipSkin(db, id, "cyan")).toEqual({ ok: true, equipped: "cyan" });
    expect(equipSkin(db, id, "gold")).toEqual({ ok: false, reason: "not-owned" });
    // The refused equip changed nothing.
    expect(
      (db.prepare("SELECT equipped_skin AS s FROM users WHERE id = ?").get(id) as { s: string }).s,
    ).toBe("cyan");
  });
});

describe("the lazy walk", () => {
  it("pays a past day but never the open one", () => {
    const today = "2024-04-10";
    const yesterday = dayBefore(today);

    const past = player("past");
    const present = player("present");
    run(past, yesterday, 700);
    run(present, today, 700);

    settleDue(db, today);
    expect(coinsOf(past)).toBe(100);
    // Today is still open — a later run can still displace this rank, which
    // is the whole reason settlement is lazy rather than eager (ADR 0010).
    expect(coinsOf(present)).toBe(0);
  });

  it("catches up on several days in one pass", () => {
    // Fresh database: the walk's lower bound is `settled_through`, and the
    // test above already advanced it past these dates in the shared one.
    const fresh = freshDb("catchup.db");
    try {
      const id = Number(
        fresh.prepare("INSERT INTO users (username, token) VALUES ('away', 'tok-away')").run()
          .lastInsertRowid,
      );
      for (const seed of ["2024-05-01", "2024-05-02", "2024-05-03"]) {
        fresh
          .prepare("INSERT INTO best_runs (user_id, track_seed, distance, lane) VALUES (?, ?, 100, 0)")
          .run(id, seed);
      }

      // The machine was off for the whole stretch; one request catches up.
      const paid = settleDue(fresh, "2024-05-04");
      expect(paid).toHaveLength(3);
      expect(
        (fresh.prepare("SELECT coins FROM users WHERE id = ?").get(id) as { coins: number }).coins,
      ).toBe(300);

      // And a second request does nothing: `settled_through` is now past them.
      expect(settleDue(fresh, "2024-05-04")).toEqual([]);
    } finally {
      fresh.close();
    }
  });
});
