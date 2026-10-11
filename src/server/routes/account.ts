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
  res.status(200).json({ username: req.user!.username });
});

accountRouter.post("/account", (req, res) => {
  const { username } = req.body ?? {};
  if (typeof username !== "string" || username.trim().length === 0) {
    res.status(400).json({ error: "username is required" });
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
    res.status(409).json({ error: "that username is taken" });
    return;
  }

  setAuthCookie(res, token);
  res.status(200).json({ username: username.trim() });
});
