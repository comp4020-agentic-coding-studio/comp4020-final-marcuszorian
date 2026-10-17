// The day's ghosts, optionally narrowed to one crew.
//
// This query used to exist twice — once in routes/ghosts.ts and once in
// lib/live.ts — which was tolerable while it took one argument. Now that it
// takes a SCOPE, two copies is two places for the scope to be forgotten, and
// forgetting it in the socket half means a crew member's road quietly shows
// strangers again the moment the page reconnects. One definition. See
// doc/adr/0011-crews.md.
import type { Database } from "better-sqlite3";

export interface GhostRow {
  username: string;
  distance: number;
  lane: number | null;
}

/** What a panel shows before it has to stop. Money is NOT bounded by this — see lib/coins.ts. */
export const GHOST_LIMIT = 50;

/**
 * `crewId` null means the whole day — a signed-out visitor, or a player who
 * isn't in a crew. A crew member sees only their crew, unconditionally: ADR
 * 0011 made that the decision rather than a toggle.
 */
export function ghostsFor(db: Database, seed: string, crewId: number | null): GhostRow[] {
  const scope = crewId === null ? "" : "AND u.crew_id = ?";
  const params: unknown[] = crewId === null ? [seed] : [seed, crewId];
  return db
    .prepare(
      `SELECT u.username AS username, b.distance AS distance, b.lane AS lane
       FROM best_runs b JOIN users u ON u.id = b.user_id
       WHERE b.track_seed = ? ${scope}
       ORDER BY b.distance DESC
       LIMIT ${GHOST_LIMIT}`,
    )
    .all(...params) as GhostRow[];
}
