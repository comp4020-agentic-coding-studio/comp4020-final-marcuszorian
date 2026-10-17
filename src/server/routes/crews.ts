// Crews and their invite links. See doc/adr/0011-crews.md.
//
// The refusals are the interesting part: a join past `max_joins` or past
// `expires_at` is declined by the server, and knowing the token is not enough
// to get around either. That is a real permission boundary, which is what
// makes this testable as one.
import { Router } from "express";
import { db } from "../db.ts";
import { optionalAuth, requireAuth } from "../lib/auth.ts";
import { createCrew, crewByToken, crewOf, isOpen, joinCrew, viewOf } from "../lib/crews.ts";

export const crewsRouter: Router = Router();

const MAX_NAME = 32;

// Express 5 types a route param as `string | string[]` (wildcards can
// repeat), so flatten to the single value these routes mean.
const param = (value: string | string[]): string => (Array.isArray(value) ? value[0]! : value);

crewsRouter.post("/crews", requireAuth, (req, res) => {
  const user = req.user!;
  const { name, maxJoins, expiresInSeconds } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  for (const [label, value] of [["maxJoins", maxJoins], ["expiresInSeconds", expiresInSeconds]] as const) {
    if (value != null && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
      res.status(400).json({ error: `${label} must be a positive number when given` });
      return;
    }
  }

  const crew = createCrew(db, user.id, name.trim().slice(0, MAX_NAME), {
    maxJoins: maxJoins ?? null,
    expiresInSeconds: expiresInSeconds ?? null,
  });
  console.log(
    `[crews] ${user.username} created "${crew.name}" (#${crew.id}, max ${crew.maxJoins ?? "∞"}, expires ${crew.expiresAt ?? "never"})`,
  );
  res.status(200).json({ crew, inviteUrl: inviteUrlFor(req.headers.host, crew.inviteToken) });
});

function inviteUrlFor(host: string | undefined, token: string): string {
  // Relative when there is no host to build an absolute URL from — the client
  // resolves it against its own origin either way, and this is only ever a
  // convenience for copy-paste.
  if (!host) return `/crew/${token}`;
  const scheme = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${scheme}://${host}/crew/${token}`;
}

// BEFORE /crews/:token, not after: express matches in registration order, and
// `me` is a perfectly good-looking invite token to a `:token` pattern. The
// other order compiles, typechecks, and answers every `GET /api/crews/me`
// with a 404 for an invite nobody ever created.
crewsRouter.get("/crews/me", optionalAuth, (req, res) => {
  const user = req.user;
  if (!user) {
    res.status(200).json({ crew: null });
    return;
  }
  const crew = crewOf(db, user.id);
  res.status(200).json({
    crew: crew
      ? { ...viewOf(db, crew), inviteUrl: inviteUrlFor(req.headers.host, crew.invite_token) }
      : null,
  });
});

// Deliberately readable signed out, so the invite link can show WHAT you are
// being invited to before demanding an account. It leaks only the crew's name
// and whether it is still open — never its membership.
crewsRouter.get("/crews/:token", (req, res) => {
  const crew = crewByToken(db, param(req.params.token));
  if (!crew) {
    res.status(404).json({ error: "no such invite" });
    return;
  }
  res.status(200).json({ name: crew.name, open: isOpen(crew) });
});

crewsRouter.post("/crews/:token/join", requireAuth, (req, res) => {
  const user = req.user!;
  const result = joinCrew(db, user.id, param(req.params.token));

  if (!result.ok) {
    console.log(`[crews] ${user.username} refused join ${param(req.params.token)}: ${result.reason}`);
    // 410 Gone for both expiry and a full link: the invite was real and is no
    // longer usable, which is a different thing from never having existed.
    const status = result.reason === "unknown" ? 404 : 410;
    const error =
      result.reason === "unknown"
        ? "no such invite"
        : result.reason === "full"
          ? "this invite has been used as many times as it allows"
          : "this invite has expired";
    res.status(status).json({ error });
    return;
  }

  console.log(
    `[crews] ${user.username} joined "${result.crew.name}" (#${result.crew.id}, ${result.crew.joinCount} joins ever, ${result.crew.memberCount} members now)`,
  );
  res.status(200).json({ crew: result.crew });
});
