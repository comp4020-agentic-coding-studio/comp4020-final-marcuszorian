import type { Database } from "better-sqlite3";

/** A user's current coin balance. Shared by the shop routes and `GET /api/skins`/`/tricks`. */
export function balanceOf(db: Database, userId: number): number {
  return (db.prepare("SELECT coins FROM users WHERE id = ?").get(userId) as { coins: number })
    .coins;
}
