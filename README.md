# nightly build

An endless 3D driving game. Drive until you crash; your crash point becomes
your best run of the day. Everyone else's best crash points sit on your
road as translucent ghost cars — not a leaderboard, but things you drive
past and notice. You can go back to any earlier day and race it against the
ghosts already there.

## What I think "good" means for this, right now

The brief's notes on good point at the small web: games built for a handful
of friends, not an anonymous crowd. A leaderboard ranks strangers; a ghost
is built for *someone* — "player 'ushini', 340m" reads not as a rank but
"someone else was right here." Good, for now, means:

- **Your trace is something you drive past.** Still the core of the game,
  even though there's now a ranked leaderboard down the side.
  `doc/adr/0009-leaderboard.md` argues that reversal honestly: ghosts are no
  longer the only way to meet other players, only the only way to meet them
  *in space*. The rank-free roster it replaced is kept, not deleted, in
  `doc/adr/0007-day-roster.md`/`0008-roster-top-ten.md` — a good argument,
  lost on purpose.
- **A day is a real place, not a label.** Every day gets its own road and
  ghosts, and you can go back. A past day is read-only
  (`doc/adr/0006-past-days-are-read-only.md`).

On purpose, there's no messaging and no names you recognize going in —
unless someone hands you a link. There are **crews** now: send a link to
four friends and your road's ghosts become your crew's, nobody else's.
`doc/adr/0011-crews.md` argues that openly: the leaderboard stays global
while the road doesn't, so a crew member sees the two disagree.

Ghosts are also live: a finished run reaches every open session within a
second, never as a car in motion — that would make it a race, not a place
(`doc/adr/0005-realtime-ghosts.md`).

## The scoring game sitting on top

Everything above is the argument for what makes this good; everything below
is an ordinary arcade game layered on the same road, and listing it
alongside the thesis would be dishonest about which parts earn their keep.

Top-ten finishes pay coins, spent on car trim colours
(`doc/adr/0010-coin-economy.md`), bounded by the colour grammar in
`doc/adr/0003-visual-direction.md` (not red, obstacle; not lavender, ghost)
— the one mechanic with a real line back to presence. Moving hazards and
oil-slick drift (`doc/adr/0012-moving-and-non-fatal-hazards.md`) earn their
place only defensively: a ghost must replay identically later
(`doc/adr/0002-daily-seeded-archive.md`), so hazard motion is keyed to
distance, not wall-clock time. Trick ramps, coin pickups, and post-trick
invincibility aren't connected to any of that — game-feel, full stop; their
ADRs (`0013`–`0017` in `doc/adr/`) only argue they don't break the
guarantees above, never that they make the game *good*. My test: if a
feature changes what happens when you crash, it's thesis; if it just
changes your score, it isn't.

## Why it looks like this now

The road used to be flat grey, the car a plain box, the ghosts flat
translucent blue: correct, nothing else. The neon, sunset-gradient look it
has now carries the same argument: a ghost is a past run, still present on
a road you can still drive — what vaporwave and its sibling, synthwave, are
*about*. Mark Fisher's "hauntology" reads that aesthetic as refusing to let
a future go, through deliberately worn, degraded media ([CCCB Lab,
"Vaporwave"](https://lab.cccb.org/en/vaporwave-the-musical-wallpaper-of-lost-futures/)).
Older days render visibly more worn than today. The game leans on
synthwave's darker half for legibility at speed, except the ghosts: they
stay lavender, not the player's magenta or the road's cyan — the one thing
not about going fast (`doc/adr/0003-visual-direction.md`).
