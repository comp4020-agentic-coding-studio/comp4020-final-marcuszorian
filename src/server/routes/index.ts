import { Router } from "express";
import { db } from "../db.ts";
import { settleDue } from "../lib/coins.ts";
import { accountRouter } from "./account.ts";
import { crewsRouter } from "./crews.ts";
import { daysRouter } from "./days.ts";
import { ghostsRouter } from "./ghosts.ts";
import { runsRouter } from "./runs.ts";
import { skinsRouter } from "./skins.ts";
import { tricksRouter } from "./tricks.ts";

export const apiRouter: Router = Router();

// There is no scheduler and there isn't going to be one: fly.toml runs a
// single machine that stops when idle, so nothing wakes up at midnight UTC to
// close the day's books. Ordinary traffic does it instead — settleDue() reads
// one `app_state` row and returns immediately on all but the first request
// after a rollover, and that one request catches up on however many days the
// machine was asleep for. See doc/adr/0010-coin-economy.md.
apiRouter.use((_req, _res, next) => {
  try {
    settleDue(db);
  } catch (err) {
    // A failed settlement must never take the API down with it: the day it
    // did not settle is still unsettled, `settled_through` did not advance,
    // and the next request tries again.
    console.error("[coins] settlement failed", err);
  }
  next();
});

apiRouter.use(accountRouter);
apiRouter.use(runsRouter);
apiRouter.use(ghostsRouter);
apiRouter.use(daysRouter);
apiRouter.use(skinsRouter);
apiRouter.use(crewsRouter);
apiRouter.use(tricksRouter);
