// The coin sink. See doc/adr/0010-coin-economy.md.
//
// Every write here is a server-side permission check that a client cannot
// talk its way around: you cannot unlock what you cannot afford, you cannot
// be charged twice for the same skin, and you cannot equip something you do
// not own. The client's own UI hides those buttons, but the UI is not what
// enforces it.
import { Router } from "express";
import { db } from "../db.ts";
import { optionalAuth, requireAuth } from "../lib/auth.ts";
import { balanceOf } from "../lib/balance.ts";
import { param } from "../lib/params.ts";
import { catalogue, equipSkin, unlockSkin } from "../lib/skins.ts";

export const skinsRouter: Router = Router();

// Readable signed out: the catalogue is worth seeing before you have an
// account, it just comes back with nothing owned. optionalAuth, not
// requireAuth — without it `req.user` is never populated and a signed-in
// player's own catalogue would come back showing nothing owned either.
skinsRouter.get("/skins", optionalAuth, (req, res) => {
  const user = req.user ?? null;
  res.status(200).json({
    coins: user ? balanceOf(db, user.id) : 0,
    skins: catalogue(db, user?.id ?? null),
  });
});

skinsRouter.post("/skins/:id/unlock", requireAuth, (req, res) => {
  const user = req.user!;
  const skinId = param(req.params.id);
  const result = unlockSkin(db, user.id, skinId);

  if (!result.ok) {
    // Crit 10 asks for who-did-what, server-side, read back over `flyctl
    // logs` — a refusal is as much a part of that record as a success.
    console.log(`[skins] ${user.username} refused ${skinId}: ${result.reason}`);
    // 402 Payment Required is the rare status that means exactly what it says
    // here: the request is well-formed and you are who you say you are, you
    // just cannot afford it.
    const status = result.reason === "unknown" ? 404 : 402;
    res.status(status).json({
      error: result.reason === "unknown" ? "No such skin" : "Not enough coins",
      coins: result.coins,
    });
    return;
  }

  console.log(`[skins] ${user.username} unlocked ${result.skin.id} (${result.coins} coins left)`);
  res.status(200).json({ coins: result.coins, skins: catalogue(db, user.id) });
});

skinsRouter.post("/skins/:id/equip", requireAuth, (req, res) => {
  const user = req.user!;
  const requested = param(req.params.id);
  // 'default' is the free magenta trim — not a row in `skins`, because
  // nothing you already have belongs in a shop (ADR 0010).
  const skinId = requested === "default" ? null : requested;
  const result = equipSkin(db, user.id, skinId);

  if (!result.ok) {
    console.log(`[skins] ${user.username} refused equip ${requested}: ${result.reason}`);
    // 403, not 404, for a skin that exists and isn't theirs: the difference
    // between "no such thing" and "understood, and declined" is the same
    // distinction runs.ts already draws for a past day.
    const status = result.reason === "unknown" ? 404 : 403;
    res.status(status).json({
      error: result.reason === "unknown" ? "No such skin" : "You have not unlocked that skin",
    });
    return;
  }

  console.log(`[skins] ${user.username} equipped ${result.equipped ?? "default"}`);
  res.status(200).json({ equipped: result.equipped, skins: catalogue(db, user.id) });
});
