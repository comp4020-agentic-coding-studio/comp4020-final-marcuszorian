# 0020. Drop the equip-a-favorite-trick feature

Status: accepted

Supersedes 0018 in full. 0018's equip concept for tricks — the `equipped`
column, `equipTrick()`, the equip route, the client call, and the cosmetics
trick-equip UI — is removed entirely. The rest of 0013/0014, which 0018 also
touched only partially (it superseded only 0013's "no equip" clause, leaving
seed purity, the ramp/barrier pairing, the slow-mo QTE, the bought-catalogue
model, and the bonus folding into `car.distance` untouched), stands
unchanged, exactly as 0018 left it.

## Context

A project-wide audit of this repo's response to the brief — checking what's
shipped against what `README.md`'s "What I think 'good' means for this,
right now" section argues this game is actually for — went back through the
mechanic layer (coins, tricks, ramps, invincibility) looking for drift away
from the core thesis. That thesis is argued across several records, not one:
0002 fixes `(seed, distance)` purity as the thing the ghost/archive model
depends on; 0005 makes ghosts live, not a replay; 0006 makes a past day
read-only so its ghosts keep recording who actually drove it; 0009 adds a
ranked leaderboard while arguing honestly that doing so is a reversal of "not
a leaderboard"; 0011 adds crews as the first time the project does what it
argues for, an invite link instead of a leaderboard of strangers. `README.md`
itself draws the line this audit used: "if a feature changes what happens
when you crash, it's thesis; if it only changes your score, it isn't" — and
names trick ramps among the features on the score side of that line,
connected to the thesis only defensively (never breaking the seed/ghost
contract), never because they make the game *good* by the project's own
definition.

Of everything on the score side of that line, 0018 is the one feature with
no connection to the thesis at all, not even an argued one. Every other
mechanic feature's own ADR gives some account of itself against the brief:
0010's coin economy is bounded by the colour grammar in 0003 so a car's trim
never reads as obstacle or ghost; 0012's moving hazards and oil are
accountable to the seed-purity guarantee 0002 established; 0016/0017's
invincibility window is scoped against the same QTE/ramp contract 0013/0014
set up. 0018 gives none of that. Its own Context section states the
motivation plainly: "playtesting wants the opposite of what [0013's]
randomness gives," and its Decision and Consequences sections never once
mention presence, ghosts, a crash, or anything else `README.md` calls out as
what this project is actually arguing for. It is pure player convenience,
argued entirely on its own terms.

Worse, 0018 does not just fail to connect to the thesis — it directly
reverses a decision 0013 made on purpose in the thesis's service. 0013's
Decision section is explicit: "Tricks are bought, not equipped... owning a
trick is the only state a player has with it" and trick selection is drawn by
`Math.random()` specifically because "no contract in this codebase needs
[determinism]... it never touches road geometry, collision, or the two
numbers the ghost actually records." That randomness was a considered
choice, not an oversight 0018 was fixing. 0018 removed it anyway, for a
reason — predictability a player wants — that 0013 had already weighed and
rejected as not worth tracking new per-user state for.

## Decision

**Revert to 0013's original behavior: a ramp hit draws uniformly at random
from the player's owned tricks, exactly as it worked before 0018.** The
equip concept for tricks is removed entirely, not disabled or defaulted off:

- `migrations/0007_trick_equip.sql`'s `equipped` column on `user_tricks` is
  no longer read or written by any code path (see Consequences for why the
  column itself stays in the schema).
- `src/server/lib/tricks.ts` loses `equipTrick()` and the `equipped` field
  `catalogue()` used to compute and return per row.
- `src/server/routes/tricks.ts` loses `POST /api/tricks/:id/equip`.
- `client/src/net.ts` loses the `equipTrick()` API call and the `equipped`
  field on the `Trick` type.
- `client/src/cosmetics.ts` loses its entire tricks section — `#trickList`,
  `#trickStatus`, `#trickBusy`, `renderTricks()`, `#trickRow()`,
  `#equipTrick()`, `#sayTrick()`, and `defaultTrickRow()` — along with the
  now-dead `.cosmetics-tricks`/`.cosmetics-trick-status` markup in
  `client/index.html`. Cosmetics goes back to being a skins-only screen.
- `client/src/main.ts` loses `equippedTrick`, `refreshEquippedTrick()`, and
  the `void refreshEquippedTrick();` call site. The ramp-hit handler goes
  back to `ownedTricks[Math.floor(Math.random() * ownedTricks.length)]` —
  the exact line 0018's own Context section quotes as what it replaced —
  restored by reintroducing `ownedTricks` as the pool and
  `refreshOwnedTricks()` as the refill, the same shape that existed before
  0018 shipped.

Skins keep their own, separate equip concept entirely untouched. 0010's
`users.equipped_skin`, `lib/skins.ts`'s `equipSkin()`, and
`POST /api/skins/:id/equip` are a different decision, made for a different
reason (one car, one trim, visibly worn), and nothing here argues against
that one. Only the trick-equip concept 0018 added is removed.

## Alternatives considered

**Leave it, but write a better justification into README.md.** Rejected.
0018's equip concept is pure game-feel — a player choosing which trick plays
has no connection to a ghost, a crash point, or anything else that changes
what another player sees on the road. No honest justification closes that
gap; the strongest one available ("players feel more agency over their
score") is a restatement of the convenience argument 0018 already made, not
a new connection to the thesis. Writing a paragraph that only sounds like
one would be a strained retrofit, and the whole point of this audit was
telling those apart from the real thing. Cutting a feature with no honest
argument for it is more honest than inventing one.

**Keep the equip concept but default it off**, or otherwise half-remove it
(e.g. keep the schema and routes live but stop wiring the client to them).
Rejected. The problem 0013 identified was never "equipping happens to be
switched on" — it's that any equip concept at all puts the player in control
of an outcome 0013 deliberately made non-deterministic, on the reasoning that
nothing downstream needs that determinism and the randomness itself was a
choice. A dormant equip route sitting unused still carries that same
player-controls-the-draw framing in the code, available to flip back on
without a new decision being made first. A half-measure doesn't resolve the
inconsistency 0018 introduced; only removing the concept does.

## Consequences

- Every player's ramp hits go back to drawing uniformly at random from their
  owned tricks, with no way to favor one, matching 0013's original behavior
  exactly.
- `migrations/0007_trick_equip.sql`'s `equipped` column on `user_tricks`
  becomes dead: nothing reads or writes it anymore. It is not dropped. This
  project's migrations are additive and forward-only — `0001` through
  `0008` only ever create tables/columns or update row data, and no
  migration in this repo has ever dropped or altered an existing column —
  so reversing a migration by editing or deleting an already-applied one
  would break any environment that already ran it (this very deployment's
  SQLite file included). The column is left in place, unused, rather than
  invent a reversal pattern this project has never needed before.
- `spec/tricks.test.ts` loses its six equip-specific test cases (equip
  succeeds and persists, equipping a second trick unequips the first,
  equipping an unowned/unknown trick is refused, equip requires auth) and
  the `grantCoins()` helper that only existed to afford them. Its header
  comment, which claimed "tricks gained an equip concept in 0018, so this
  file now mirrors skins.test.ts's equip coverage too," no longer holds and
  is corrected. The non-equip coverage (catalogue reads, unlock
  refusal/success, 404 on an unknown trick, 401 signed-out) is unchanged.
- `client/src/cosmetics.ts` loses its trick section entirely; trims remain
  fully equippable there, since that is 0010's separate, unaffected concept.
- `plan.md`'s "Feature 1 — Equip a favorite trick" is noted as reverted in
  place, not rewritten, so the plan still records what was actually built
  and then undone rather than pretending it was never planned.
- No `best_runs`/ghost/seed-contract change: trick selection was never part
  of that contract under 0013, and reverting *how* it's chosen (random vs.
  equipped) doesn't touch it either, the same as 0018 itself argued when it
  made the opposite change.
