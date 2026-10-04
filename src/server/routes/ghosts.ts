// No auth required: a stranger reads ghosts (and finds their own trace)
// without having claimed a username yet.
import { Router } from "express";
import { db } from "../db.ts";
import { isValidPastSeed } from "../lib/seed.ts";

export const ghostsRouter: Router = Router();

interface GhostRow {
  username: string;
  distance: number;
  lane: number | null;
}

ghostsRouter.get("/ghosts", (req, res) => {
  const seed = req.query.seed;
  if (!isValidPastSeed(seed)) {
    res.status(400).json({ error: "seed must be a YYYY-MM-DD date no later than today" });
    return;
  }

  const rows = db
    .prepare(
      `SELECT u.username AS username, b.distance AS distance, b.lane AS lane
       FROM best_runs b JOIN users u ON u.id = b.user_id
       WHERE b.track_seed = ?
       ORDER BY b.distance DESC
       LIMIT 50`,
    )
    .all(seed) as GhostRow[];

  res.status(200).json(rows);
});
