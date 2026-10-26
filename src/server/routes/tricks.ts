// The other coin sink. See doc/adr/0010-coin-economy.md and plan.md's "Shop &
// server" section. Mirrors routes/skins.ts's catalogue/unlock shape; see
// doc/adr/0020 for why there is no equip route here, unlike skins.
import { Router } from "express";
import { db } from "../db.ts";
import { optionalAuth, requireAuth } from "../lib/auth.ts";
import { balanceOf } from "../lib/balance.ts";
import { param } from "../lib/params.ts";
import { catalogue, unlockTrick } from "../lib/tricks.ts";

export const tricksRouter: Router = Router();

// Readable signed out: the catalogue is worth seeing before you have an
// account, it just comes back with nothing owned. optionalAuth, not
// requireAuth — without it `req.user` is never populated and a signed-in
// player's own catalogue would come back showing nothing owned either.
tricksRouter.get("/tricks", optionalAuth, (req, res) => {
  const user = req.user ?? null;
  res.status(200).json({
    coins: user ? balanceOf(db, user.id) : 0,
    tricks: catalogue(db, user?.id ?? null),
  });
});

tricksRouter.post("/tricks/:id/unlock", requireAuth, (req, res) => {
  const user = req.user!;
  const trickId = param(req.params.id);
  const result = unlockTrick(db, user.id, trickId);

  if (!result.ok) {
    // Crit 10 asks for who-did-what, server-side, read back over `flyctl
    // logs` — a refusal is as much a part of that record as a success.
    console.log(`[tricks] ${user.username} refused ${trickId}: ${result.reason}`);
    // 402 Payment Required is the rare status that means exactly what it says
    // here: the request is well-formed and you are who you say you are, you
    // just cannot afford it.
    const status = result.reason === "unknown" ? 404 : 402;
    res.status(status).json({
      error: result.reason === "unknown" ? "No such trick" : "Not enough coins",
      coins: result.coins,
    });
    return;
  }

  console.log(`[tricks] ${user.username} unlocked ${result.trick.id} (${result.coins} coins left)`);
  res.status(200).json({ coins: result.coins, tricks: catalogue(db, user.id) });
});
