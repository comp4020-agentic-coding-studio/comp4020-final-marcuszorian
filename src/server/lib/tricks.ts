// The other coin sink: trick-ramp input sequences. See
// doc/adr/0010-coin-economy.md and plan.md's "Shop & server" section.
//
// Mirrors lib/skins.ts, including the equip concept added by doc/adr/0018 —
// equip state lives per-row on `user_tricks` rather than a column on
// `users`, since it only makes sense attached to a row the player owns.
//
// Functions take a Database rather than importing the singleton, so a test
// can drive them against a throwaway file.
import type { Database } from "better-sqlite3";

export interface TrickRow {
  id: string;
  name: string;
  sequence: string;
  bonus_metres: number;
  cost: number;
}

export interface TrickView extends TrickRow {
  owned: boolean;
  equipped: boolean;
}

export type UnlockResult =
  | { ok: true; coins: number; trick: TrickRow }
  | { ok: false; reason: "unknown" | "insufficient"; coins: number };

export type EquipResult =
  | { ok: true; equipped: string | null }
  | { ok: false; reason: "unknown" | "not-owned" };

export function catalogue(db: Database, userId: number | null): TrickView[] {
  const tricks = db
    .prepare("SELECT id, name, sequence, bonus_metres, cost FROM tricks ORDER BY cost")
    .all() as TrickRow[];
  if (userId === null) {
    return tricks.map((t) => ({ ...t, owned: false, equipped: false }));
  }

  const owned = new Set(
    (db.prepare("SELECT trick_id FROM user_tricks WHERE user_id = ?").all(userId) as {
      trick_id: string;
    }[]).map((r) => r.trick_id),
  );
  const equippedRow = db
    .prepare("SELECT trick_id FROM user_tricks WHERE user_id = ? AND equipped = 1")
    .get(userId) as { trick_id: string } | undefined;

  return tricks.map((t) => ({
    ...t,
    owned: owned.has(t.id),
    equipped: equippedRow?.trick_id === t.id,
  }));
}

/**
 * Check-and-deduct in one transaction. Copied from unlockSkin verbatim: a
 * balance can never go negative (the deduction is a conditional UPDATE), and
 * a repeat unlock cannot charge twice (user_tricks' primary key makes the
 * second INSERT a no-op, and the deduction only follows a real insert).
 */
class InsufficientCoins extends Error {}

export function unlockTrick(db: Database, userId: number, trickId: string): UnlockResult {
  const balance = (): number =>
    (db.prepare("SELECT coins FROM users WHERE id = ?").get(userId) as { coins: number }).coins;

  const trick = db
    .prepare("SELECT id, name, sequence, bonus_metres, cost FROM tricks WHERE id = ?")
    .get(trickId) as TrickRow | undefined;
  if (!trick) return { ok: false, reason: "unknown", coins: balance() };

  const attempt = db.transaction((): UnlockResult => {
    const inserted = db
      .prepare("INSERT OR IGNORE INTO user_tricks (user_id, trick_id) VALUES (?, ?)")
      .run(userId, trick.id).changes;
    if (inserted === 0) {
      // Already owned — not an error, and explicitly not a second charge.
      return { ok: true, coins: balance(), trick };
    }
    const charged = db
      .prepare("UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?")
      .run(trick.cost, userId, trick.cost).changes;
    if (charged === 0) {
      // Can't afford it. Throwing is what rolls the INSERT back — a plain
      // `return` would commit it and hand the trick over for free.
      throw new InsufficientCoins();
    }
    return { ok: true, coins: balance(), trick };
  });

  try {
    return attempt();
  } catch (err) {
    if (err instanceof InsufficientCoins) return { ok: false, reason: "insufficient", coins: balance() };
    throw err;
  }
}

/**
 * Equips an owned trick, or `null` for the free default (doc/adr/0018).
 *
 * Mirrors `equipSkin()`'s not-owned refusal: a client POSTing an id it never
 * unlocked is exactly the permission check the server, not the client, has
 * to make. Unlike skins, equip state lives per-row on `user_tricks` rather
 * than a column on `users` — unsetting any existing equipped row and setting
 * the new one both happen inside one transaction, the same
 * unset-then-set shape skins' migration note calls for.
 */
export function equipTrick(db: Database, userId: number, trickId: string | null): EquipResult {
  if (trickId === null) {
    db.prepare("UPDATE user_tricks SET equipped = 0 WHERE user_id = ?").run(userId);
    return { ok: true, equipped: null };
  }

  const exists = db.prepare("SELECT 1 FROM tricks WHERE id = ?").get(trickId);
  if (!exists) return { ok: false, reason: "unknown" };

  const owns = db
    .prepare("SELECT 1 FROM user_tricks WHERE user_id = ? AND trick_id = ?")
    .get(userId, trickId);
  if (!owns) return { ok: false, reason: "not-owned" };

  const equip = db.transaction(() => {
    db.prepare("UPDATE user_tricks SET equipped = 0 WHERE user_id = ?").run(userId);
    db.prepare("UPDATE user_tricks SET equipped = 1 WHERE user_id = ? AND trick_id = ?").run(
      userId,
      trickId,
    );
  });
  equip();

  return { ok: true, equipped: trickId };
}
