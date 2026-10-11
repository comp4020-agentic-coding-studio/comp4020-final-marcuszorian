# nightly build

An endless 3D driving game. Drive until you crash; your crash point becomes
your best run of the day. Everyone else's best-of-the-day crash points sit on
your road as translucent ghost cars — not as a leaderboard you check, but as
things you drive past and notice. You can also go back to any earlier day and
race it again, against the ghosts that were already there.

## What I think "good" means for this, right now

I read the brief's own notes on good before deciding anything: the small web,
games built for a handful of friends, tools built for one workshop. What
those have in common isn't smallness for its own sake — it's that they're
built for people who'll actually recognize each other's presence, not for an
anonymous crowd. A leaderboard is built for a crowd: it ranks strangers.
A ghost is built for *someone* — you don't read "player 'ushini', 340m" as a
rank, you read it as "someone else was right here."

So, for now, good means:

- **Your trace is something you drive past.** A ghost is a presence at a
  place on a road — someone else's "right here" — and that is still what this
  game is built around.

  This bullet used to go further. It said there was no leaderboard, no tab to
  check, and that the only way to see how you were doing against anyone else
  was to drive through where they'd been. That was true for most of this
  project's life and it isn't any more: there's a ranked leaderboard down the
  side, top ten for the day, with your own position below it if you're not in
  them. The honest reckoning is in `doc/adr/0009-leaderboard.md`, including
  what it costs — ghosts are no longer the only way to meet other players,
  only the only way to meet them *in space*. The earlier argument is kept in
  `doc/adr/0007-day-roster.md` and `0008-roster-top-ten.md` rather than
  quietly deleted, because it was a good argument and losing it was a
  decision, not an accident.
- **A day is a real place, not just a label.** Every day gets its own road
  and its own ghosts, and — deliberately — you can go back. "Last Tuesday" is
  a specific thing you can return to and drive, the same way a specific
  afternoon at a specific game night is a thing you can talk about later. A
  single rolling high score would have thrown that away.

  Going back is *visiting*, not competing: a past day is read-only, and a run
  you drive there isn't recorded. That's deliberate too. If you could post a
  new best to any date, an afternoon with a free calendar would let you
  deposit yourself across the whole archive, and a day's ghosts would stop
  being a record of who was actually driving that day. The record closes at
  midnight. See `doc/adr/0006-past-days-are-read-only.md`.
- **Showing up again is the whole point.** The spec's own test for this is
  "a stranger visits, does the thing, and finds their trace still there when
  they come back" — for this app, the most honest version of that is a
  player finding *their own* ghost from earlier the same day, or from a day
  they'd almost forgotten.

What this doesn't mean, on purpose: there's no social layer — no names you
recognize going in, no following, no messaging.

Ghosts *are* live now: finish a run anywhere and it reaches every open session
on that day's road within a second, no reload. That reverses the "a ghost can
be a few minutes stale and that's fine" this section used to say, but not the
argument under it. The reason that staleness was fine — "the thing you're
reacting to is a place, not a live event" — is exactly why what goes live is a
*finished* run and never a car in motion. Your run is yours while you're
driving it; it becomes a trace the moment you crash, and the trace travels
immediately. Watching someone else drive in real time would have made this a
race, which the section above rules out. See
`doc/adr/0005-realtime-ghosts.md`, which argues that choice against the two
alternatives and says what it costs.

This is a first version. It's rough, and the plan is for it to change as the
rest of the project builds on it — see `plan.md` for what's next and
`doc/adr/` for the decisions behind the stack and the data model.

## Why it looks like this now

The road used to be flat grey, the car a plain green box, the ghosts a flat
translucent blue — correct, and nothing else. The look it has now (neon,
dark, a gradient sunset, a grid horizon) isn't decoration bolted onto that;
it's an argument that the paragraphs above already make, given a visual
language to match.

A ghost here is a past run, still present, on a road you can still drive —
someone else's "right here," not yet gone. That's almost exactly what
vaporwave and its driving-game sibling, synthwave, are *about*: Mark Fisher's
"hauntology" reads the aesthetic as a refusal to let go of a future (or in
this case, a run) that didn't quite arrive, expressed through deliberately
worn, degraded media rather than a clean record of it. See [CCCB Lab,
"Vaporwave: The Musical Wallpaper of Lost
Futures"](https://lab.cccb.org/en/vaporwave-the-musical-wallpaper-of-lost-futures/).
So older days in this archive don't just carry different ghosts now — they
render visibly more worn (more chromatic aberration, more grain, less
saturation) than today does. A day you're revisiting weeks later is supposed
to feel like finding an old tape, not like loading a save file.

The style itself splits into a lighter, pastel half (vaporwave proper) and a
darker, saturated half (synthwave/outrun — literally named after a 1986
racing game). This game leans heavily on the second: a dark base keeps the
score and controls legible at speed, and saturated neon against black gives
motion and depth for free in a way that pastel washes don't. The pastel half
still shows up exactly once, deliberately: the ghosts are lavender, not the
player's magenta or the road's cyan — the one colour in the scene that's
"the other genre," because the ghosts are the one thing here that isn't
about going fast.

This section used to end by saying there was still no leaderboard and there
never would be — that a high-score table is exactly the kind of thing this
aesthetic's reference material is full of, and exactly what the "good means"
section rules out, because a ghost is something you drive past, not a rank you
check. That was the position for most of this project, and it was held on
purpose against a visual language that kept offering the opposite.

It has since been reversed: there is a ranked leaderboard, and
`doc/adr/0009-leaderboard.md` is where that was argued, including what it
costs and what it undermines. The aesthetic argument here is unaffected —
`doc/adr/0003-visual-direction.md` and the build plan (`plan.md`) still have
the full palette, what it's built from, and what was tried and ruled out.
