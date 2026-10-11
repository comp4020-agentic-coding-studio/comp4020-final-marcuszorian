# 0007. A roster of who is on this road — still not a leaderboard

Status: accepted

Narrows, but does not supersede, the "no leaderboard" consequence of
[0003](0003-visual-direction.md).

## Context

`README.md`'s first "good means" bullet is blunt: "Your trace is something you
drive past, not something you look up. No leaderboard screen, no tab to
check." ADR 0003 held that line against the aesthetic's own pull ("however
much an 80s arcade high-score table is *right there* in the reference
material"), and ADR 0005 reused the same argument to refuse a presence
counter.

That argument is about **ranking**, and it is a good one. But it was doing a
second job it was never asked to do: it also meant there was no way to know
who was on a day's road without driving the whole thing. On a day with thirty
ghosts spread over two kilometres, most of them are never seen by anyone,
because a run ends at the first barrier you clip. The archive had records
nobody could reach.

## Decision

**A panel listing who is on the day you are looking at — username and distance
— ordered by distance, with no rank numbers and no positions.** Down the left
on a wide screen; a collapsed disclosure near the top on a narrow one, where a
permanent side panel would cover the road.

Distances are rounded to the nearest whole metre. The underlying value is a
float and the HUD has always shown `Math.floor`; a roster showing `412.7 m`
next to a score reading `412 m` invites a question with no interesting answer.

**The no-rank rule is the whole distinction, and it is load-bearing.** There
is no "1st", no position column, no highlight on the top row. The list is
ordered because distance is the only sensible order for it, not to tell you
where you stand. What it answers is "who else is out here", which is the same
question the ghosts answer — this just answers it before you meet them rather
than after.

## Alternatives considered and ruled out

**A full ranked leaderboard**, as first requested. Rejected because it
reverses the project's most-stated value for a gain the roster already
delivers. Ranking adds the thing the README objects to — a number saying where
you stand, checkable without driving — and nothing else.

**Nothing at all**, holding ADR 0003 exactly as written. This was the standing
position and it has a real cost, named above: a day's archive was mostly
unreachable. The refusal in 0003 is about ranks, and reading it as "the player
may never see a list of anything" is stricter than the argument supports.

**Sorting by name instead of distance**, to avoid implying a ranking at all.
Rejected as fussier than honest: everyone reads the top of a distance-sorted
list as "furthest", and pretending otherwise with alphabetical order would
make the panel harder to use without making it less of a ranking.

## Consequences

- **`README.md`'s bullet gains a qualifier rather than a rewrite.** "No
  leaderboard screen, no tab to check" stays true of ranks; the sentence now
  says what the roster is and why it isn't one. The argument is unchanged.
- **ADR 0003's and ADR 0005's reasoning both stand.** 0005 refused a presence
  counter because "the ghost is this app's whole vocabulary for other people,
  and a counter beside it would say the ghosts weren't enough". The roster is
  not a second vocabulary: every row is a ghost that exists in the scene, at a
  distance you can drive to. It is an index to the archive, not a parallel
  readout.
- **The roster and the scene cannot disagree.** It renders from the same
  `GhostLayer` set the 3D layer draws, pushed through one callback, so a ghost
  in the list is a ghost on the road by construction — no second fetch, no
  second source of truth. It updates live over the existing socket.
- **It is sized to its content and anchored to one corner, never `inset: 0`.**
  This is a direct consequence of the `#ghostLabels` bug fixed in the same
  session: a full-screen child of `#hud` inherits `pointer-events: auto` from
  `#hud > *` and silently swallows clicks on everything beneath it. Any future
  HUD overlay has the same trap waiting, and the roster's CSS says so.
- **Usernames are rendered with `textContent`, never `innerHTML`.** They are
  player-supplied and this is the first place they are drawn as a list of
  markup-capable content rather than as a projected label.
