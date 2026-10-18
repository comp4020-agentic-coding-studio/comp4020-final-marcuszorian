// The other coin sink. See doc/adr/0010-coin-economy.md and plan.md's "Shop &
// server" section. Mirrors routes/skins.ts, minus equip — owning a trick is
// the only state, so there is no POST /tricks/:id/equip.
import { Router } from "express";
import { db } from "../db.ts";
import { optionalAuth, requireAuth } from "../lib/auth.ts";
import { catalogue, unlockTrick } from "../lib/tricks.ts";

export const tricksRouter: Router = Router();

// Readable signed out: the catalogue is worth seeing before you have an
// account, it just comes back with nothing owned. optionalAuth, not
// requireAuth — without it `req.user` is never populated and a signed-in
// player's own catalogue would come back showing nothing owned either.
tricksRouter.get("/tricks", optionalAuth, (req, res) => {
  const user = req.user ?? null;
  res.status(200).json({
    coins: user
      ? (db.prepare("SELECT coins FROM users WHERE id = ?").get(user.id) as { coins: number }).coins
      : 0,
    tricks: catalogue(db, user?.id ?? null),
  });
});

// Express 5 types a route param as `string | string[]` (wildcards can
// repeat), so every one of them gets flattened to the single value these
// routes mean.
const param = (value: string | string[]): string => (Array.isArray(value) ? value[0]! : value);

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
      error: result.reason === "unknown" ? "no such trick" : "not enough coins",
      coins: result.coins,
    });
    return;
  }

  console.log(`[tricks] ${user.username} unlocked ${result.trick.id} (${result.coins} coins left)`);
  res.status(200).json({ coins: result.coins, tricks: catalogue(db, user.id) });
});
