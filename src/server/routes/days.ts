// Backs a day-selector: which past days are actually worth racing, rather
// than a free-text date picker mostly pointing at empty days. See
// doc/adr/0002-daily-seeded-archive.md.
import { Router } from "express";
import { db } from "../db.ts";
import { todayUtc } from "../lib/seed.ts";

export const daysRouter: Router = Router();

daysRouter.get("/days", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT DISTINCT track_seed FROM best_runs ORDER BY track_seed DESC LIMIT 60`,
    )
    .all() as { track_seed: string }[];

  const seeds = new Set(rows.map((r) => r.track_seed));
  seeds.add(todayUtc()); // always offer today, even with no runs yet

  res.status(200).json([...seeds].sort().reverse());
});
