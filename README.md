# nightly build

An endless 3D driving game. Drive until you crash; your crash point becomes
your best run of the day. Everyone else's best crash points sit on your
road as translucent ghost cars: not a rank, but things you drive past. You
can go back to any earlier day and race it against the ghosts already there.

## What "good" means here

Robin Sloan calls software made for a few people a [home-cooked
meal](https://www.robinsloan.com/notes/home-cooked-app/): it doesn't need
to scale, it needs to be for *someone*. Clay Shirky's [situated
software](https://web.archive.org/web/20040411202042/http://www.shirky.com/writings/situated_software.html)
makes the same point from the other side: design for a group that already
knows each other, and you can skip what strangers need. I took two games as
models. [Wordle](https://techcrunch.com/2022/01/12/josh-wardle-interview-wordle/)
works, its maker says, because "it's one puzzle, and everybody is solving
it". [Dark Souls](https://en.wikipedia.org/wiki/Dark_Souls_(video_game))
leaves bloodstains that replay another player's last seconds where they
died. A leaderboard ranks strangers; a ghost labelled "ushini, 340m" says *someone else was right here*. Good means:

- **Your trace is something you drive past.** There is a ranked leaderboard
  too; [ADR 0009](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/blob/main/doc/adr/0009-leaderboard.md) argues that reversal, and the
  rank-free roster it replaced is kept as a good argument lost on purpose
  ([0007](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/blob/main/doc/adr/0007-day-roster.md), [0008](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/blob/main/doc/adr/0008-roster-top-ten.md)).
- **A day is a place.** Every day has its own road and ghosts, you can go
  back, and the past is read-only ([0006](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/blob/main/doc/adr/0006-past-days-are-read-only.md),
  [0021](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/blob/main/doc/adr/0021-obstacle-kinds-are-epoch-gated.md)).
- **It's for a crew.** Send a link to four friends and your road's ghosts
  become theirs alone ([0011](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/blob/main/doc/adr/0011-crews.md)).
- **A ghost is never a live car.** A finished run reaches every open session
  within a second, but never in motion: that would make it a race, not a
  place ([0005](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/blob/main/doc/adr/0005-realtime-ghosts.md)).

## What I chose not to build

No chat, no profiles, no following, no live cars, no presence counter. Each
would make the game more social and less like a place you visit. Coins,
trim colours, trick ramps and moving hazards are an ordinary arcade layer
on top. Their ADRs (0010, 0012–0017) argue only that they can't break the
guarantees above. My test: a feature that changes what a crash *means* is
thesis; one that only changes your score isn't.

## Enforced, and judged

Each of these is a test in `spec/` that runs against the app:

- a finished run reaches other open sessions in under a second, and only
  improvements are sent (`realtime.test.ts`)
- a past day refuses new runs but still shows its ghosts (`days.test.ts`)
- a past day's road never regenerates with an obstacle it didn't have when
  it was driven (`past-roads.test.ts`)
- crews see only crew ghosts, live and on reload (`crews.test.ts`)
- every stretch of road has a way through (`track-patterns.test.ts`)
- no ghost is ever the colour of a car you can buy (`ghost-colour.test.ts`)
- older days are never less worn than newer ones (`archive-age.test.ts`)

Judged, and written up rather than guessed at: a [crew playtest](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/blob/main/docs/test/17-oct-playtest.md)
and a [six-person live test](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/blob/main/docs/test/ing/multi-user-test-report.md),
each with what players said and what changed because of it. What's judged
this way: whether a ghost *feels* like a person, and whether the look below
reads as memory.

## Why it looks like this

A ghost is a past run, still present on a road you can still drive. That is
what vaporwave and synthwave are *about*. Mark Fisher's "hauntology" reads
music like it as "a refusal to give up on the desire for the future"
([Horta, CCCB Lab](https://www.cccb.org/en/w/articles/vaporwave-the-musical-wallpaper-of-lost-futures)).
Older days render more worn than today, and ghosts are lavender: not
the player's magenta or the road's cyan
([ADR 0003](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/blob/main/doc/adr/0003-visual-direction.md)).
