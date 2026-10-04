import { Router } from "express";
import { accountRouter } from "./account.ts";
import { daysRouter } from "./days.ts";
import { ghostsRouter } from "./ghosts.ts";
import { runsRouter } from "./runs.ts";

export const apiRouter: Router = Router();
apiRouter.use(accountRouter);
apiRouter.use(runsRouter);
apiRouter.use(ghostsRouter);
apiRouter.use(daysRouter);
