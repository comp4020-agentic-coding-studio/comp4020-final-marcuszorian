# 0018. A player can equip one favorite trick

Status: accepted

Supersedes 0013's "no equip" clause only. The rest of 0013/0014 (seed purity,
ramp/barrier pairing, the slow-mo whole-sequence QTE, the bought-catalogue
model, the bonus folding into `car.distance`, attract mode unchanged) stands.

## Context

0013 decided tricks are bought, not equipped: "owning a trick is the only
state a player has with it, so there is no `equipped` flag and no equivalent
of `equipSkin()`." Which trick plays on a ramp hit is drawn by
`Math.random()` over the player's owned tricks, every time
(`client/src/main.ts`, `ownedTricks[Math.floor(Math.random() *
ownedTricks.length)]`).

Playtesting wants the opposite of what that randomness gives: a player who
has bought several tricks and likes one of them has no way to make it the one
that plays. Skins already solve exactly this shape of problem — one
equipped item out of several owned, server-authoritative, with a free
default fallback — via `users.equipped_skin`, `lib/skins.ts`'s `equipSkin()`,
and `POST /api/skins/:id/equip`. This record asks for the same shape applied
to tricks.

## Decision

**A user has at most one equipped trick, tracked the same way skins track
it, and a ramp hit always plays the equipped trick instead of drawing at
random.**

- `migrations/0007_trick_equip.sql` adds `equipped INTEGER NOT NULL DEFAULT
  0` to `user_tricks` — one row per equipped trick enforced the same way an
  equip is applied transactionally (unset any previously-equipped row for
  that user, then set the new one), mirroring how skins represent equip
  state.
- `lib/tricks.ts` gains `equipTrick(db, userId, trickId)`, a direct mirror of
  `equipSkin()`: 404 on an unknown trick id, refuse (403) a trick the player
  does not own, otherwise unset/set inside one transaction. `catalogue()`
  returns `equipped` per row.
- `routes/tricks.ts` gains `POST /api/tricks/:id/equip` (`requireAuth`),
  mirroring `routes/skins.ts`'s equip route's status codes.
- The always-owned `DEFAULT_TRICK` ("Quick Flip") is the equip fallback: when
  a player has no equipped trick row (a new account, or an existing one
  before this ships), it is treated as the effective equipped trick — the
  same way an unequipped skin falls back to magenta trim.
- `client/src/main.ts`'s ramp-hit handler drops the `Math.random()` draw
  entirely and always plays the equipped trick (falling back to
  `DEFAULT_TRICK` if the server reports nothing equipped). The random-draw
  code path is removed, not left dormant alongside the new one.
- `client/src/cosmetics.ts` gains a tricks section, structurally mirroring
  its existing skins section: one row per owned trick (including the
  default), an equip/equipped button wired to the new endpoint.

## Alternatives considered and ruled out

**Multi-select pool** (equip several tricks, keep `Math.random()` among just
those). Rejected for now: it doesn't remove the randomness playtesting
objected to, it only shrinks its range, and it needs a join table rather than
a single nullable-style column. Deferred, not ruled out forever — flagged in
`plan.md` in case playtesting later wants some randomness retained among a
player's favorites.

**Ordered loadout** (equip several tricks in a fixed sequence, cycling
through them trick by trick). Rejected: nothing in the current QTE/ramp
pairing model tracks "which ramp number this is for this player," so cycling
would need new per-run state with no other use. A single favorite answers
the actual request — "make it always play the trick I like" — without that
state.

## Consequences

- 0013's "owning a trick is the only state" sentence no longer holds;
  `user_tricks` now carries equip state the same way `users.equipped_skin`
  does for skins. Everything else 0013 decided (seed-pure ramp placement,
  the bought-catalogue shape, the bonus folding into `car.distance`) is
  unaffected.
- 0014's QTE mechanics (the slow-mo window, per-step results, the
  ramp/barrier pairing and landing exemption) are unaffected: this record
  only changes *which* `TrickSequence` is handed to `startTrick`, never how
  the QTE itself plays out.
- `spec/tricks.test.ts` gains equip coverage mirroring `spec/skins.test.ts`'s
  equip tests: equip succeeds and persists, equipping an unowned/unknown
  trick is refused, equip requires auth.
- No `best_runs`/ghost/seed-contract change: trick selection was never part
  of that contract (0013), and replacing *how* it's chosen (equipped vs.
  random) doesn't touch it either.
