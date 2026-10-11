# 0009. There is a leaderboard, and it prints ranks

Status: accepted

Supersedes [0007](0007-day-roster.md) and [0008](0008-roster-top-ten.md), and
reverses the "no leaderboard" consequence of
[0003](0003-visual-direction.md).

## Context

This project refused ranks for its whole life, and argued it well.
`README.md`'s first "good means" bullet said "no leaderboard screen, no tab to
check". ADR 0003 held that line against the aesthetic's own pull toward an
arcade high-score table. ADR 0005 reused it to refuse a presence counter. ADR
0007 shipped a panel that listed players *without* ranks specifically to keep
it, and 0008 kept that rule while truncating to ten.

The compromise did not survive contact with itself. ADR 0008 had already
written down the problem while arguing a different point: "everyone reads the
top of a distance-sorted list as 'furthest'". That is the admission. A panel
that sorts people by distance and shows the best one at the top **is** a
ranking; declining to print the number next to it did not remove the ranking,
it only made it harder to read. The unranked roster was not protecting the
value, it was obscuring that the value had already gone.

So there were two honest positions left, and "sorted list, no numbers" was
neither of them: remove the panel and keep the argument, or keep the panel and
drop the argument.

## Decision

**Keep the panel, print the ranks.** Positions 1–10 for the day, furthest
first, with your own ranked row below a gap when you are outside the ten.

**Ties break alphabetically by username**, and ranks stay sequential (1, 2, 3)
rather than shared. `standings()` in `client/src/leaderboard.ts` is the single
definition of that order; `GhostLayer` now hands over its set unsorted so
there is exactly one place that decides what beats what.

## What this costs, stated plainly

- **The README's central claim is no longer true as written**, and is
  rewritten rather than left standing. "The only way to see how you're doing
  against everyone else is to literally drive through where they were" was the
  sharpest sentence in that document and it described the app accurately until
  now. It doesn't any more.
- **Ties are decided by something other than driving.** With eight players on
  900m, the alphabetically-first is 1st and the last is 8th, and nothing they
  did on the road separated them. Dense ranking (1, 1, 1, …) would have been
  fairer and was not chosen, because the request was for an ordered list and
  shared ranks make "below the ten" ambiguous when a tie straddles the cut.
  This is the weakest part of this record and the first thing to revisit.
- **ADR 0005's reasoning for refusing presence is undermined.** It argued the
  ghost was "this app's whole vocabulary for other people, and a counter
  beside it would say the ghosts weren't enough". A ranked table says that
  rather more loudly than a counter would have. 0005's *decision* — only
  finished runs broadcast, never live positions — still stands on its own
  merits, but anyone citing that paragraph should know it was written under a
  premise this record removes.
- **Ghosts are no longer the only way to meet other players**, which was the
  mechanic the whole project was built around. They remain the only way to
  meet them *in space*, which is a smaller claim than the one that was there
  before.

## Alternatives considered and ruled out

**Remove the panel entirely**, restoring the position before ADR 0007. The
coherent alternative, and the one that keeps the original argument intact. Not
chosen: the problem 0007 identified is real — most runs end at the first
barrier, so most of a day's ghosts were never seen by anyone — and deleting
the panel brings that back.

**Keep the unranked roster of 0007/0008.** Rejected above: it is a ranking
that declines to say so, which is worse than either honest option.

**Dense ranking, so ties share a position.** Fairer on the merits, and
rejected only because of the interaction with the top-ten cut described above.
Worth revisiting if ties turn out to be common in real play.

## Consequences

- `client/src/roster.ts` is now `client/src/leaderboard.ts`, with the DOM ids
  and classes renamed to match. A file called `roster.ts` whose header comment
  said "deliberately NOT a leaderboard" would have been actively misleading to
  the next reader.
- `spec/standings.test.ts` pins the ordering: furthest first, alphabetical on
  a tie, stable regardless of arrival order, non-mutating, ranks 1-based and
  contiguous. It is the second spec to test a client module directly, after
  `spec/days-nav.test.ts`.
- The `/api/ghosts` limit of 50 now bounds the ranks the UI can show. A player
  ranked 51st on a busy day cannot be told so, and would see no personal row
  at all. That limit, not this panel, is where the fix belongs.
