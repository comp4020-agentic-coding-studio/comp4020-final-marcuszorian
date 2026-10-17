// Crews: one per user, joined by an invite link that expires on count or on
// time, whichever comes first. See doc/adr/0011-crews.md, which argues the
// social-layer reversal this is.
//
// Functions take a Database rather than importing the singleton, so a test can
// drive them against a throwaway file.
import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";

export interface CrewRow {
  id: number;
  name: string;
  invite_token: string;
  created_by: number;
  expires_at: string | null;
  max_joins: number | null;
  join_count: number;
}

export interface CrewView {
  id: number;
  name: string;
  inviteToken: string;
  /** Joins EVER — not the member count below. The schema comment says why. */
  joinCount: number;
  maxJoins: number | null;
  expiresAt: string | null;
  /** Live headcount: how many users have this crew set right now. */
  memberCount: number;
  open: boolean;
}

export type JoinRefusal = "unknown" | "expired" | "full";

export type JoinResult = { ok: true; crew: CrewView } | { ok: false; reason: JoinRefusal };

/** A crew stops accepting joins once either limit is reached. Both are optional. */
export function isOpen(crew: CrewRow, now: Date = new Date()): boolean {
  if (crew.max_joins !== null && crew.join_count >= crew.max_joins) return false;
  if (crew.expires_at !== null && Date.parse(crew.expires_at) <= now.getTime()) return false;
  return true;
}

function memberCount(db: Database, crewId: number): number {
  // Deliberately not crews.join_count: that counts joins ever, so a crew
  // three of whose five joiners have since left elsewhere reports 5 there and
  // 2 here. Both numbers are real and they answer different questions.
  return (
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE crew_id = ?").get(crewId) as { n: number }
  ).n;
}

export function viewOf(db: Database, crew: CrewRow): CrewView {
  return {
    id: crew.id,
    name: crew.name,
    inviteToken: crew.invite_token,
    joinCount: crew.join_count,
    maxJoins: crew.max_joins,
    expiresAt: crew.expires_at,
    memberCount: memberCount(db, crew.id),
    open: isOpen(crew),
  };
}

const COLUMNS = "id, name, invite_token, created_by, expires_at, max_joins, join_count";

export function crewByToken(db: Database, token: string): CrewRow | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM crews WHERE invite_token = ?`).get(token) as
    | CrewRow
    | undefined;
}

export function crewById(db: Database, id: number): CrewRow | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM crews WHERE id = ?`).get(id) as CrewRow | undefined;
}

export interface CreateOptions {
  maxJoins?: number | null;
  expiresInSeconds?: number | null;
}

/**
 * Creates a crew and puts its creator in it. `invite_token` is randomUUID() —
 * the exact precedent auth.ts's issueToken() already set, and no new
 * dependency for a random string.
 */
export function createCrew(
  db: Database,
  userId: number,
  name: string,
  options: CreateOptions = {},
): CrewView {
  const token = randomUUID();
  const expiresAt =
    options.expiresInSeconds != null && options.expiresInSeconds > 0
      ? new Date(Date.now() + options.expiresInSeconds * 1000).toISOString()
      : null;
  const maxJoins = options.maxJoins != null && options.maxJoins > 0 ? options.maxJoins : null;

  const crew = db.transaction((): CrewRow => {
    // join_count starts at 1: the creator's own membership is a join, so a
    // link capped at 3 admits the creator plus two, not the creator plus
    // three. Capping "other people" instead would make max_joins mean
    // something different from what the column says.
    const info = db
      .prepare(
        `INSERT INTO crews (name, invite_token, created_by, expires_at, max_joins, join_count)
         VALUES (?, ?, ?, ?, ?, 1)`,
      )
      .run(name, token, userId, expiresAt, maxJoins);
    db.prepare("UPDATE users SET crew_id = ? WHERE id = ?").run(info.lastInsertRowid, userId);
    return crewById(db, Number(info.lastInsertRowid))!;
  })();

  return viewOf(db, crew);
}

/**
 * Joins by invite token, replacing whatever crew the user was in.
 *
 * `join_count` increments unconditionally on an accepted join — including a
 * re-join of a crew you are already in. The count is the link's usage
 * history, not a headcount, and a link that has been clicked twice has been
 * used twice.
 */
export function joinCrew(db: Database, userId: number, token: string): JoinResult {
  const crew = crewByToken(db, token);
  if (!crew) return { ok: false, reason: "unknown" };
  // Checked before the write, inside the same transaction below, so two
  // people racing the last slot of a capped link cannot both get in.
  if (crew.max_joins !== null && crew.join_count >= crew.max_joins) {
    return { ok: false, reason: "full" };
  }
  if (crew.expires_at !== null && Date.parse(crew.expires_at) <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const joined = db.transaction((): CrewRow | null => {
    // Re-reads under the transaction and re-checks the cap: the check above
    // is the cheap early-out, this is the one that is actually authoritative.
    const changed = db
      .prepare("UPDATE crews SET join_count = join_count + 1 WHERE id = ? AND (max_joins IS NULL OR join_count < max_joins)")
      .run(crew.id).changes;
    if (changed === 0) return null;
    db.prepare("UPDATE users SET crew_id = ? WHERE id = ?").run(crew.id, userId);
    return crewById(db, crew.id)!;
  })();

  if (!joined) return { ok: false, reason: "full" };
  return { ok: true, crew: viewOf(db, joined) };
}

/** The crew a user is in, or null. Also the answer to "whose ghosts do I see". */
export function crewOf(db: Database, userId: number): CrewRow | null {
  const row = db.prepare("SELECT crew_id FROM users WHERE id = ?").get(userId) as
    | { crew_id: number | null }
    | undefined;
  if (!row?.crew_id) return null;
  return crewById(db, row.crew_id) ?? null;
}
