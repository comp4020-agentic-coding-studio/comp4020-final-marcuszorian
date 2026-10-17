// Accounts are deliberately lightweight for this milestone: a username and an
// opaque random token in an httpOnly cookie, no password. Losing the cookie
// loses the identity — an accepted, documented gap for now (see plan.md).
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "../db.ts";

const COOKIE_NAME = "token";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export interface AuthedUser {
  id: number;
  username: string;
  /** The crew whose ghosts this user sees on the road, or null. ADR 0011. */
  crewId: number | null;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthedUser;
  }
}

export function issueToken(): string {
  return randomUUID();
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: ONE_YEAR_SECONDS * 1000,
    path: "/",
  });
}

/**
 * Pulls the auth token out of a raw Cookie header.
 *
 * Takes the header string rather than a Request because the WebSocket
 * handshake is not one: `wss.on('connection', (socket, request))` hands over
 * a plain `IncomingMessage` carrying the same cookie. Generalizing this was
 * the alternative to growing a second definition of "who does this cookie
 * belong to" inside live.ts — see doc/adr/0011-crews.md.
 *
 * Express's own cookie-parser still isn't in use (one fewer dependency for
 * one cookie); a minimal manual parse is enough.
 */
export function tokenFromCookieHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** The account a raw Cookie header identifies, or null. Shared by HTTP and /live. */
export function userForCookie(header: string | undefined): AuthedUser | null {
  const token = tokenFromCookieHeader(header);
  if (!token) return null;
  const row = db
    .prepare("SELECT id, username, crew_id AS crewId FROM users WHERE token = ?")
    .get(token) as AuthedUser | undefined;
  return row ?? null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = userForCookie(req.headers.cookie);
  if (!user) {
    res.status(401).json({ error: "sign in first (POST /api/account)" });
    return;
  }

  req.user = user;
  next();
}

/**
 * Attaches `req.user` when there is one and carries on either way. `/ghosts`
 * needs this rather than `requireAuth`: a stranger reads ghosts without an
 * account (and always could), but a signed-in crew member has to be
 * recognized so the road can narrow to their crew.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const user = userForCookie(req.headers.cookie);
  if (user) req.user = user;
  next();
}
