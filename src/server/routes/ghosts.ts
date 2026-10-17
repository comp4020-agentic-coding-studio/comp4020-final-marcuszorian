// No auth required: a stranger reads ghosts (and finds their own trace)
// without having claimed a username yet. But a signed-in player who IS in a
// crew has to be recognized, because their road narrows to that crew — hence
// optionalAuth rather than nothing at all. See doc/adr/0011-crews.md.
import { Router } from "express";
import { db } from "../db.ts";
import { optionalAuth } from "../lib/auth.ts";
import { ghostsFor } from "../lib/ghost-rows.ts";
import { isValidPastSeed } from "../lib/seed.ts";

export const ghostsRouter: Router = Router();

ghostsRouter.get("/ghosts", optionalAuth, (req, res) => {
  const seed = req.query.seed;
  if (!isValidPastSeed(seed)) {
    res.status(400).json({ error: "seed must be a YYYY-MM-DD date no later than today" });
    return;
  }

  // `?scope=global` is the one escape hatch from the crew narrowing, and it
  // exists for exactly one caller: the leaderboard panel's global tab. ADR
  // 0011 kept the panel switchable while the road is not, which means a crew
  // member needs some way to ask for the whole day — without this they have
  // none. The ROAD never passes it.
  const crewId = req.query.scope === "global" ? null : (req.user?.crewId ?? null);

  res.status(200).json(ghostsFor(db, seed, crewId));
});
