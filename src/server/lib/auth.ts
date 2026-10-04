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

function readToken(req: Request): string | undefined {
  // Express's own cookie-parser isn't in use (one fewer dependency for one
  // cookie) — a minimal manual parse is enough here.
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readToken(req);
  const row = token
    ? (db
        .prepare("SELECT id, username FROM users WHERE token = ?")
        .get(token) as AuthedUser | undefined)
    : undefined;

  if (!row) {
    res.status(401).json({ error: "sign in first (POST /api/account)" });
    return;
  }

  req.user = row;
  next();
}
