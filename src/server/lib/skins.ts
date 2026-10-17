// The coin sink: car trim colours. See doc/adr/0010-coin-economy.md.
//
// A skin's id is a palette token key from client/src/palette.ts — the id
// 'gold' IS palette.gold — so there is no hex value stored anywhere here to
// drift out of step with the palette. The catalogue itself lives in
// migrations/0002_coins.sql, because which colours are purchasable is a
// decision (ADR 0003's colour grammar rules out `red` and `lavender`), not
// configuration.
//
// Functions take a Database rather than importing the singleton, so a test
// can drive them against a throwaway file.
import type { Database } from "better-sqlite3";

export interface SkinRow {
  id: string;
  name: string;
  cost: number;
}

export interface SkinView extends SkinRow {
  owned: boolean;
  equipped: boolean;
}

export type UnlockResult =
  | { ok: true; coins: number; skin: SkinRow }
  | { ok: false; reason: "unknown" | "insufficient"; coins: number };

export type EquipResult =
  | { ok: true; equipped: string | null }
  | { ok: false; reason: "unknown" | "not-owned" };

export function catalogue(db: Database, userId: number | null): SkinView[] {
  const skins = db
    .prepare("SELECT id, name, cost FROM skins ORDER BY cost")
    .all() as SkinRow[];
  if (userId === null) {
    return skins.map((s) => ({ ...s, owned: false, equipped: false }));
  }

  const owned = new Set(
    (db.prepare("SELECT skin_id FROM user_skins WHERE user_id = ?").all(userId) as {
      skin_id: string;
    }[]).map((r) => r.skin_id),
  );
  const equipped = (
    db.prepare("SELECT equipped_skin FROM users WHERE id = ?").get(userId) as {
      equipped_skin: string | null;
    }
  ).equipped_skin;

  return skins.map((s) => ({ ...s, owned: owned.has(s.id), equipped: equipped === s.id }));
}

/**
 * Check-and-deduct in one transaction. Two things this has to get right, and
 * both are the kind of permission check Crit 10's spec names directly:
 *
 * - A balance can never go negative. The deduction is a conditional UPDATE
 *   (`WHERE coins >= ?`), so even two requests racing each other cannot both
 *   succeed on one affordable balance — the second one's UPDATE matches no
 *   row.
 * - A repeat unlock cannot charge twice. `user_skins`' primary key makes the
 *   second INSERT a no-op, and the deduction only follows a real insert.
 */
class InsufficientCoins extends Error {}

export function unlockSkin(db: Database, userId: number, skinId: string): UnlockResult {
  const balance = (): number =>
    (db.prepare("SELECT coins FROM users WHERE id = ?").get(userId) as { coins: number }).coins;

  const skin = db.prepare("SELECT id, name, cost FROM skins WHERE id = ?").get(skinId) as
    | SkinRow
    | undefined;
  if (!skin) return { ok: false, reason: "unknown", coins: balance() };

  const attempt = db.transaction((): UnlockResult => {
    const inserted = db
      .prepare("INSERT OR IGNORE INTO user_skins (user_id, skin_id) VALUES (?, ?)")
      .run(userId, skin.id).changes;
    if (inserted === 0) {
      // Already owned — not an error, and explicitly not a second charge.
      return { ok: true, coins: balance(), skin };
    }
    const charged = db
      .prepare("UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?")
      .run(skin.cost, userId, skin.cost).changes;
    if (charged === 0) {
      // Can't afford it. Throwing is what rolls the INSERT back — a plain
      // `return` would commit it and hand the skin over for free.
      throw new InsufficientCoins();
    }
    return { ok: true, coins: balance(), skin };
  });

  try {
    return attempt();
  } catch (err) {
    if (err instanceof InsufficientCoins) return { ok: false, reason: "insufficient", coins: balance() };
    throw err;
  }
}

/**
 * Equips an owned skin, or `null` for the free default magenta trim.
 *
 * The not-owned refusal is the point: "can one user touch state that isn't
 * theirs" is exactly what a client could otherwise do by POSTing an id it
 * never paid for. The server, not the client, decides what you are wearing.
 */
export function equipSkin(db: Database, userId: number, skinId: string | null): EquipResult {
  if (skinId === null) {
    db.prepare("UPDATE users SET equipped_skin = NULL WHERE id = ?").run(userId);
    return { ok: true, equipped: null };
  }

  const exists = db.prepare("SELECT 1 FROM skins WHERE id = ?").get(skinId);
  if (!exists) return { ok: false, reason: "unknown" };

  const owns = db
    .prepare("SELECT 1 FROM user_skins WHERE user_id = ? AND skin_id = ?")
    .get(userId, skinId);
  if (!owns) return { ok: false, reason: "not-owned" };

  db.prepare("UPDATE users SET equipped_skin = ? WHERE id = ?").run(skinId, userId);
  return { ok: true, equipped: skinId };
}
