import { Router } from "express";
import { db } from "../db.ts";
import { issueToken, setAuthCookie } from "../lib/auth.ts";

export const accountRouter: Router = Router();

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
