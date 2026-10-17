// Coin payouts for a closed day's leaderboard rank. See
// doc/adr/0010-coin-economy.md.
//
// Two things here are load-bearing and easy to undo by accident:
//
// 1. The ranking is `standings()` from the CLIENT's leaderboard.ts, not a
//    server-side ORDER BY. ADR 0009 made that function "the single definition
//    of that order"; a second ranking here would let the panel show you 7th
//    while the payout called you 8th on a tie. It is a pure function over
//    {username, distance} and the only DOM-touching export in that file is a
//    class whose constructor never runs unless instantiated, so the module
//    evaluates fine under plain Node. (The Dockerfile's runtime stage copies
//    client/ for exactly this reason.)
//
// 2. Settlement never touches today. ADR 0006 froze a past day's best_runs
//    the instant it stopped being today, and that is the only reason paying
//    out without a lock is safe — there is no race to beat, because nothing
//    can write to a day this walks over.
import type { Database } from "better-sqlite3";
import { standings } from "../../../client/src/leaderboard.ts";
import { todayUtc } from "./seed.ts";

/** Ranks 1..PAID_RANKS earn coins; nothing below. Matches leaderboard.ts's TOP_N. */
export const PAID_RANKS = 10;

/**
 * 100 coins for first, down to 10 for tenth, 0 for everyone else. A one-line
 * retune with no schema change if it turns out wrong — which is most of why
 * the curve is here and not baked into the migration.
 */
export function coinsForRank(rank: number): number {
  if (rank < 1 || rank > PAID_RANKS) return 0;
  return 110 - rank * 10;
}

const SETTLED_THROUGH = "settled_through";

function settledThrough(db: Database): string | undefined {
  const row = db
    .prepare("SELECT value FROM app_state WHERE key = ?")
    .get(SETTLED_THROUGH) as { value: string } | undefined;
  return row?.value;
}

function setSettledThrough(db: Database, date: string): void {
  db.prepare(
    `INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(SETTLED_THROUGH, date);
}

export interface Payout {
  userId: number;
  username: string;
  rank: number;
  coins: number;
}

/**
 * Pays one day's top ranks, and returns what it actually paid — empty if the
 * day was already settled.
 *
 * Idempotent through `coin_payouts`' primary key rather than through a flag:
 * the credit is applied only when the INSERT actually inserts a row, so a
 * second run over the same day credits nothing even if `settled_through`
 * never advanced (a crash mid-walk, say).
 */
export function settleDay(db: Database, trackSeed: string): Payout[] {
  // The full day, with no LIMIT. /api/ghosts caps at 50 because a panel has
  // to stop somewhere; money does not, and a rank that exists is a rank that
  // gets paid.
  //
  // Deliberately the PLAIN best_runs for the day — never crew-scoped. ADR
  // 0011 settled this: coins are global, because a crew of two is otherwise a
  // 200-coin-a-day machine (both members take ranks 1 and 2 of a two-person
  // leaderboard). Do not "fix" this to respect crews.
  const rows = db
    .prepare(
      `SELECT u.id AS userId, u.username AS username, b.distance AS distance
       FROM best_runs b JOIN users u ON u.id = b.user_id
       WHERE b.track_seed = ?`,
    )
    .all(trackSeed) as { userId: number; username: string; distance: number }[];
  if (rows.length === 0) return [];

  const byName = new Map(rows.map((r) => [r.username, r]));
  const ranked = standings(rows.map((r) => ({ username: r.username, distance: r.distance, lane: null })));

  const paid: Payout[] = [];
  const insert = db.prepare(
    `INSERT OR IGNORE INTO coin_payouts (track_seed, user_id, rank, coins)
     VALUES (?, ?, ?, ?)`,
  );
  const credit = db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?");

  db.transaction(() => {
    for (const { ghost, rank } of ranked) {
      const coins = coinsForRank(rank);
      if (coins === 0) break; // standings() is ordered, so nothing below pays either
      const row = byName.get(ghost.username)!;
      // `changes === 0` means this (day, user) was already paid. Credit only
      // follows a real insert — that is the whole idempotence story.
      if (insert.run(trackSeed, row.userId, rank, coins).changes === 0) continue;
      credit.run(coins, row.userId);
      paid.push({ userId: row.userId, username: ghost.username, rank, coins });
    }
  })();

  return paid;
}

/** The UTC day before `date` — the last day that has definitely closed. */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Settles every day that has closed since the last time this ran. Called at
 * the top of the API router, so ordinary traffic does the work a scheduler
 * would — there isn't one, and `fly.toml`'s machine stops when idle, so there
 * can't be (ADR 0010).
 *
 * The common case is the `settled_through` read and nothing else. The walk
 * only happens on the first request after a UTC rollover; if the machine was
 * off for three days, that one request catches up on all three.
 *
 * `now` is injectable so a test can settle a day that is genuinely in the
 * past without waiting for midnight.
 */
export function settleDue(db: Database, now: string = todayUtc()): Payout[] {
  const yesterday = dayBefore(now);

  const marker = settledThrough(db);
  if (marker !== undefined && marker >= yesterday) return [];

  // Only days with runs in them, and only days strictly before `now`: an open
  // day's result is not final, so paying it would pay a rank a later run can
  // still take away. `marker ?? ''` works as the lower bound because every
  // real seed is a YYYY-MM-DD string and sorts above the empty string.
  const days = db
    .prepare(
      `SELECT DISTINCT track_seed FROM best_runs
       WHERE track_seed < ? AND track_seed > ?
       ORDER BY track_seed`,
    )
    .all(now, marker ?? "") as { track_seed: string }[];

  const paid: Payout[] = [];
  for (const { track_seed } of days) {
    for (const payout of settleDay(db, track_seed)) {
      // Crit 10 asks for who-did-what read back over `flyctl logs`, and a
      // payout is the one thing here no player action directly triggers.
      console.log(
        `[coins] settled ${track_seed}: ${payout.username} rank ${payout.rank} +${payout.coins}`,
      );
      paid.push(payout);
    }
  }

  // Advances to yesterday whether or not anything was paid — an empty day is
  // settled too, and not recording that would re-walk it on every request.
  setSettledThrough(db, yesterday);
  return paid;
}
