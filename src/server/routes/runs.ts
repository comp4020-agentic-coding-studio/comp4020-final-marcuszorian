import { Router } from "express";
import { db } from "../db.ts";
import { requireAuth } from "../lib/auth.ts";
import { scoreChanged } from "../lib/events.ts";
import { isValidPastSeed, todayUtc } from "../lib/seed.ts";

export const runsRouter: Router = Router();

runsRouter.post("/run-end", requireAuth, (req, res) => {
  const { distance, lane, seed } = req.body ?? {};

  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) {
    res.status(400).json({ error: "distance must be a non-negative number" });
    return;
  }
  const laneValue = typeof lane === "number" && Number.isFinite(lane) ? lane : null;

  // seed is optional — omitted means "today." When given, it must be a real
  // past-or-today UTC date: you can replay or race history, not a day that
  // hasn't happened yet.
  let trackSeed: string;
  if (seed === undefined) {
    trackSeed = todayUtc();
  } else if (isValidPastSeed(seed)) {
    trackSeed = seed;
  } else {
    res.status(400).json({ error: "seed must be a YYYY-MM-DD date no later than today" });
    return;
  }

  const user = req.user!;
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

    scoreChanged({
      userId: user.id,
      username: user.username,
      trackSeed,
      distance,
      lane: laneValue,
    });
  }

  res.status(200).json({ trackSeed, distance: improved ? distance : existing!.distance, improved });
});
