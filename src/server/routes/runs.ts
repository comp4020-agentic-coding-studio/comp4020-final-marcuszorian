import { Router } from "express";
import { db } from "../db.ts";
import { requireAuth } from "../lib/auth.ts";
import { scoreChanged } from "../lib/events.ts";
import { isValidPastSeed, todayUtc } from "../lib/seed.ts";

export const runsRouter: Router = Router();

// A generous per-run ceiling on coins picked up along the way — not a real
// anti-cheat measure (nothing here is), just a sanity clamp so a malformed or
// hostile request can't mint an arbitrary balance in one call.
const MAX_COINS_PER_RUN = 500;

runsRouter.post("/run-end", requireAuth, (req, res) => {
  const { distance, lane, seed, coins } = req.body ?? {};

  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) {
    res.status(400).json({ error: "Distance must be a non-negative number" });
    return;
  }
  const laneValue = typeof lane === "number" && Number.isFinite(lane) ? lane : null;
  // Coin pickups along the track (doc/adr/0015) — unlike the leaderboard
  // distance, these are credited every run, not just a personal best: a
  // coin collected is collected whether or not this run beat your last one.
  const coinsCollected =
    typeof coins === "number" && Number.isFinite(coins) && coins >= 0
      ? Math.min(MAX_COINS_PER_RUN, Math.floor(coins))
      : 0;

  // seed is optional — omitted means "today." When given, it must be a real
  // past-or-today UTC date: you can replay or race history, not a day that
  // hasn't happened yet.
  let trackSeed: string;
  if (seed === undefined) {
    trackSeed = todayUtc();
  } else if (isValidPastSeed(seed)) {
    trackSeed = seed;
  } else {
    res.status(400).json({ error: "Seed must be a YYYY-MM-DD date no later than today" });
    return;
  }

  // ADR 0006: a past day is a read-only archive. Note the two different
  // refusals — a future date is a 400 because it is not a real day to play,
  // while a real past date is a 403: understood, and declined. The client
  // already declines to post here, so reaching this is either a stale tab
  // open across UTC midnight or someone with curl; both get the same answer.
  if (trackSeed !== todayUtc()) {
    res.status(403).json({
      error: "Past days are read-only — a run only records against today's track",
    });
    return;
  }

  const user = req.user!;

  // Both writes commit together: crediting coins for a run that never ends up
  // recorded (because the upsert below throws) would leave a balance with
  // nothing to show for it.
  const { existing, improved } = db.transaction((): {
    existing: { distance: number } | undefined;
    improved: boolean;
  } => {
    if (coinsCollected > 0) {
      db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").run(coinsCollected, user.id);
      console.log(`[coins] ${user.username} collected ${coinsCollected} on ${trackSeed}`);
    }

    const existing = db
      .prepare("SELECT distance FROM best_runs WHERE user_id = ? AND track_seed = ?")
      .get(user.id, trackSeed) as { distance: number } | undefined;

    const improved = !existing || distance > existing.distance;
    if (improved) {
      db.prepare(
        `INSERT INTO best_runs (user_id, track_seed, distance, lane, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT (user_id, track_seed)
         DO UPDATE SET distance = excluded.distance, lane = excluded.lane,
                       updated_at = excluded.updated_at`,
      ).run(user.id, trackSeed, distance, laneValue);

      console.log(
        `[runs] ${user.username} new highscore ${distance} on ${trackSeed}${existing ? ` (was ${existing.distance})` : " (first run of the day)"}`,
      );
    }

    return { existing, improved };
  })();

  if (improved) {
    scoreChanged({
      userId: user.id,
      username: user.username,
      trackSeed,
      distance,
      lane: laneValue,
      crewId: user.crewId,
    });
  }

  res.status(200).json({ trackSeed, distance: improved ? distance : existing!.distance, improved, coinsCollected });
});
