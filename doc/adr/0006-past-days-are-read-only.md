# 0006. A past day is a read-only archive

Status: accepted

Supersedes the write-path half of
[0002](0002-daily-seeded-archive.md). That record's schema decision —
`best_runs` keyed `(user_id, track_seed)` — is untouched and still in force.

## Context

ADR 0002 made the track seed a free parameter in *both* directions:
`GET /api/ghosts?seed=` to read any day, and `POST /api/run-end {seed}` to
write to any past day. Its stated payoff was that "last Tuesday" is "a
specific thing you can return to and still try to beat", and `README.md`'s
"good means" section promised exactly that.

Playing the archive for real exposed the problem with the write half. A day's
ghosts are supposed to be a record of *that day* — who was driving, how far
they got, on a road everyone shared at the same time. Letting anyone post a
new run against an arbitrary past date makes that record editable forever. A
player with a spare afternoon can walk backwards through the calendar
depositing a personal best on every day in the archive, and nothing in the
data distinguishes those from runs people actually drove that day. The
archive stops being a history and becomes a scoreboard with dates attached,
which is the thing ADR 0002 was trying to avoid in the first place.

The read half has the opposite character and is kept entirely: visiting an old
day, driving its road, and seeing who was there is the whole mechanic.

## Decision

**A run records only against today's track. Past days can be read, visited and
driven, but never written to.**

- `POST /api/run-end` refuses any seed that is not today's UTC date with
  **403**, distinct from the **400** a future or malformed date already got. A
  future date is not a real day to play; a past date is a real day whose
  record is closed. Two refusals, two meanings.
- The client does not send the request at all when the selected day is not
  today, and says so on the crash overlay — "archive run, not recorded" —
  because silently discarding a run the player just finished reads as a bug.

## Alternatives considered and ruled out

**Keep past-day writes, as ADR 0002 had it.** Rejected above: it makes the
archive editable and erases the difference between a trace and a deposit.

**Allow a past-day run only when it improves your own existing best for that
day.** This was genuinely appealing: it keeps the README's "return and beat
it" promise literally true, and no *new* ghost ever appears on a past day
because you must already have one there. Rejected because it still rewrites
history — the ghost a visitor drives past on a day in 2026 would be a run
driven in 2027, sitting at a distance nobody reached at the time — and it
makes "what does this day's archive mean" a rule you have to explain rather
than a thing you can see.

**Let the server silently accept and discard past-day runs.** Rejected
outright. An endpoint that returns 200 and does nothing is a lie, and it is
the kind that surfaces months later as "scores sometimes don't save."

## Consequences

- **`README.md`'s "a day is a real place" bullet was wrong and is rewritten.**
  It promised a past day was "a specific thing you can return to and still try
  to beat." You can still return to it and drive it; you can no longer beat
  it. The argument that bullet was making — that a day is a place rather than
  a label, and that a single rolling high score would have thrown that away —
  survives, and is arguably stronger now that a day's record is fixed.
- **Three specs changed**, because they asserted the behaviour this record
  reverses: two in `spec/days.test.ts` that posted against yesterday and
  two-days-ago expecting 200, and the cross-day isolation test in
  `spec/realtime.test.ts`. They now assert the 403 and the read paths that
  remain open. The 400-on-a-future-date test is unaffected and still passes —
  which is the point of keeping the two refusals distinct.
- **A run spanning UTC midnight is refused.** Start a run at 23:59 and crash
  at 00:01 and the client posts against the day the run started, which the
  server now considers past. The run is lost. This is a real cost, accepted
  rather than designed around: a grace window would mean two different "today"
  values live in the system at once, and the failure it prevents is rarer than
  the confusion it would add. The player sees "archive run, not recorded"
  rather than silence.
- **`/api/days` now only ever grows a "today" entry**, so the day list is a
  genuine record of days that were played when they were current.
- **Nothing about the real-time path changes.** `scoreChanged()` still fires
  only inside `if (improved)`, and since writes are now today-only, every
  broadcast is for today by construction — the per-day socket subscription in
  `lib/live.ts` keeps working unchanged and its cross-day guard is now belt
  and braces rather than load-bearing.
