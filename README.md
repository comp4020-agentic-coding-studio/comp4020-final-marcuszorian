# drift archive

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

- **Your trace is something you drive past, not something you look up.**
  No leaderboard screen, no tab to check. The only way to see how you're
  doing against everyone else is to literally drive through where they were.
- **A day is a real place, not just a label.** Every day gets its own road
  and its own ghosts, and — deliberately — you can go back. "Last Tuesday" is
  a specific thing you can return to and still try to beat, the same way a
  specific afternoon at a specific game night is a thing you can talk about
  later. A single rolling high score would have thrown that away.
- **Showing up again is the whole point.** The spec's own test for this is
  "a stranger visits, does the thing, and finds their trace still there when
  they come back" — for this app, the most honest version of that is a
  player finding *their own* ghost from earlier the same day, or from a day
  they'd almost forgotten.

What this doesn't mean yet, on purpose: there's no social layer (no names you
recognize going in, no following, no messaging), no real-time — a ghost can
be a few minutes stale and that's fine, because the thing you're reacting to
is a place, not a live event — and no polish on the driving itself. Proof of
life, this week, is: the road exists, you can crash on it, and it remembers
you did.

This is a first version. It's rough, and the plan is for it to change as the
rest of the project builds on it — see `plan.md` for what's next and
`doc/adr/` for the decisions behind the stack and the data model.
