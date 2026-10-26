// The other coin sink: trick-ramp input sequences. See
// doc/adr/0010-coin-economy.md and plan.md's "Shop & server" section.
//
// Mirrors lib/skins.ts's catalogue/unlock shape. doc/adr/0018 added an equip
// concept here, mirroring skins' equip; doc/adr/0020 reverted it — owning a
// trick is the only state a player has with it, same as 0013 originally
// decided, and a ramp hit draws at random from the owned set again.
//
// Functions take a Database rather than importing the singleton, so a test
// can drive them against a throwaway file.
import type { Database } from "better-sqlite3";
import { balanceOf } from "./balance.ts";

export interface TrickRow {
  id: string;
  name: string;
  sequence: string;
  bonus_metres: number;
  cost: number;
}

export interface TrickView extends TrickRow {
  owned: boolean;
}

export type UnlockResult =
  | { ok: true; coins: number; trick: TrickRow }
  | { ok: false; reason: "unknown" | "insufficient"; coins: number };

export function catalogue(db: Database, userId: number | null): TrickView[] {
  const tricks = db
    .prepare("SELECT id, name, sequence, bonus_metres, cost FROM tricks ORDER BY cost")
    .all() as TrickRow[];
  if (userId === null) {
    return tricks.map((t) => ({ ...t, owned: false }));
  }

  const owned = new Set(
    (db.prepare("SELECT trick_id FROM user_tricks WHERE user_id = ?").all(userId) as {
      trick_id: string;
    }[]).map((r) => r.trick_id),
  );

  return tricks.map((t) => ({
    ...t,
    owned: owned.has(t.id),
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
  const balance = (): number => balanceOf(db, userId);

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
