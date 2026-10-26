import { Router } from "express";
import { db } from "../db.ts";
import { issueToken, requireAuth, setAuthCookie } from "../lib/auth.ts";

export const accountRouter: Router = Router();

// Who am I? The auth cookie is httpOnly on purpose, so the browser's own
// JavaScript cannot read it and cannot answer this question by itself — it has
// to ask. (It previously tried to answer locally by looking for the cookie in
// `document.cookie`, which an httpOnly cookie is never in, so the client
// believed nobody was ever signed in and never saved a run.)
accountRouter.get("/me", requireAuth, (req, res) => {
  const user = req.user!;
  // Coins and the equipped skin ride along here rather than getting their own
  // endpoint: the client already makes this call on boot to find out who it
  // is, and the answer to "who am I" now reasonably includes what I'm wearing
  // and what I can afford. `equippedSkin: null` is the free magenta default.
  const row = db
    .prepare("SELECT coins, equipped_skin AS equippedSkin FROM users WHERE id = ?")
    .get(user.id) as { coins: number; equippedSkin: string | null };
  res.status(200).json({ username: user.username, ...row });
});

// The leaderboard panel (client/index.html's #leaderboard) is sized to fit a
// name of exactly this length without ellipsis-truncating — the client's
// <input maxlength> is cosmetic only, so this is the check that actually
// holds the guarantee.
const MAX_USERNAME_LENGTH = 15;

accountRouter.post("/account", (req, res) => {
  const { username } = req.body ?? {};
  if (typeof username !== "string" || username.trim().length === 0) {
    res.status(400).json({ error: "Username is required" });
    return;
  }
  if (username.trim().length > MAX_USERNAME_LENGTH) {
    res.status(400).json({ error: `Username must be ${MAX_USERNAME_LENGTH} characters or fewer` });
    return;
  }

  const token = issueToken();
  try {
    db.prepare("INSERT INTO users (username, token) VALUES (?, ?)").run(
      username.trim(),
      token,
    );
  } catch {
    // UNIQUE constraint on username — someone already claimed it.
    console.log(`[account] refused ${username.trim()}: username taken`);
    res.status(409).json({ error: "That username is taken" });
    return;
  }

  console.log(`[account] ${username.trim()} created an account`);
  setAuthCookie(res, token);
  // Same shape as GET /api/me, so the client has one Account type rather than
  // two nearly-identical ones. A fresh account is always broke and wearing
  // the default.
  res.status(200).json({ username: username.trim(), coins: 0, equippedSkin: null });
});
