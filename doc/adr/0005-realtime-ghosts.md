# 0005. A run becomes public when it ends, not while it happens

Status: accepted

## Context

C9 requires the app to be real-time: a change one person makes reaches every
other open session in about a second, with no reload. ADR 0001 planned for
this — it chose Node over Astro specifically to keep a `ws` server available,
and left `scoreChanged()` in `src/server/lib/events.ts` as a no-op seam for
exactly this week.

So *how* the change travels was largely settled a month ago. The decision
this record is actually for is the one above it: **what other people see of
you while you play.** The game has a continuous, interesting, second-by-second
state — where your car is on the road right now — and the honest question is
whether that state belongs to other people.

## Decision

**A run is private while it happens and public the moment it ends — and only
if it beat your own best for that day.** Concretely, the server broadcasts on
exactly the condition it already writes on: `runs.ts` only calls
`scoreChanged()` inside `if (improved)`. Nothing about a run in progress
leaves the browser it is happening in.

A session subscribes to one day. A run posted against a different day reaches
nobody watching today — a trace on last Tuesday's road is not news to someone
driving this morning.

## Alternatives considered and ruled out

**1. Broadcast live car positions — everyone currently driving appears on
everyone else's road.** This is the option with the most obvious "wow" at a
crit, and it is the one the pod should argue for. Rejected on the README's own
terms. The README says a ghost means *"someone else was right here"* — past
tense, a trace of a finished thing. A car moving beside you in real time is
not a trace, it is an opponent, and the README is explicit that this game has
no leaderboard and no racing because presence is supposed to be something you
drive past, not something you beat. Picking this would not be adding a feature
to the app; it would be making it a different app, and ADR 0003 already
refused the same temptation in the visual register.

It also costs real money on a 256MB machine: a position broadcast is ~20
messages/second/player fanned out to every other player, against the current
design's one message per completed run.

**2. Presence only — "4 people are driving right now", no positions.** Cheap,
and genuinely answers "is anyone else here." Rejected because it adds a second
vocabulary for other people — a number in the HUD — alongside the one the game
already has. The ghost is the app's whole language for other people, and a
counter sitting next to it says the ghosts weren't enough.

**3. Keep polling, just make it faster.** A 1-second poll would technically
satisfy the spec line. Rejected because it is strictly worse at the same
visible latency: every open tab asks every second forever, whether or not
anything happened, and the thing being polled for happens a few times an hour.

## What it costs

Named plainly, because the pod will push on these:

- **The road is empty in real time.** Two people driving side by side right
  now see nothing of each other until one of them crashes. The feature is
  invisible for most of any given minute, which is a strange property for the
  headline real-time feature to have.
- **Ghosts can appear mid-run, including behind you.** A ghost that arrives
  while you are at 300m may land at 150m, where you will never see it this
  run. The alternative — holding new ghosts until the next run starts — was
  considered and rejected as worse: it is a reload in everything but name, and
  it is exactly what the spec line forbids.
- **Only your best survives.** Post a worse run and nothing is broadcast,
  because nothing changed. A player who crashes repeatedly at 40m after a
  400m run generates no events at all, and may reasonably conclude the live
  feature is broken.
- **One machine only.** The topic is an in-process `Set`. ADR 0001 fixes the
  app at a single Fly machine, so this reaches every socket; a second machine
  would need a shared broker (Redis, Postgres `LISTEN`/`NOTIFY`). That is a
  deployment change and would be a new record.

## Consequences

- **`scoreChanged()` paid off as designed.** `runs.ts` was not touched to add
  real-time. The seam ADR 0001 described is the entire integration point.
- **There is no write conflict to resolve.** `best_runs` is keyed
  `(user_id, track_seed)` per ADR 0002, so two people finishing at the same
  instant write different rows. "What happens when two people change the same
  thing at once" has no interesting answer here, and that is a property of the
  ADR 0002 data model rather than luck.
- **WebSocket over SSE, for one specific reason.** The feed is one-way, which
  is SSE's exact shape, and SSE would also have given reconnection for free.
  But a client has to say *which day* it is watching, and that changes while
  the page is open (the day selector). Over SSE that is a new `EventSource`
  per day change; over a socket it is one `subscribe` message up a connection
  that stays put. Polling remains in `ghosts.ts` as the fallback while the
  socket is down, so a blocked WebSocket degrades instead of failing.
- **Every subscribe is answered with the full list**, not a delta. That makes
  reconnection correct by construction — a session that dropped and came back
  gets what it missed with no "what did I miss" bookkeeping on either side,
  and a session opened tomorrow sees that day's archive the same way.
- **The spec line is under test.** `spec/realtime.test.ts` opens two sessions,
  posts a run from a third party, and asserts both see it in under a second
  without reconnecting — plus that cross-day runs don't leak, that a late
  joiner is backfilled, and that a non-improvement is silent.
