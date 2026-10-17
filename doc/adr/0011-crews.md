# 0011. There are crews, which means there is a social layer

Status: accepted

Reverses the "no following" half of `README.md`'s "no social layer" claim, and
continues the walk-back [0009](0009-leaderboard.md) began. Narrows the ghost
scope established by [0002](0002-daily-seeded-archive.md) and pushed live by
[0005](0005-realtime-ghosts.md).

## Context

The round asks for shareable invite links so you can race groups of friends.
That is a small, named, invite-joined group whose members you can tell apart
from strangers on the road. This project has refused exactly that, in writing,
twice.

`README.md`: **"no social layer — no names you recognize going in, no
following, no messaging."** ADR 0005 refused a presence counter and cited the
same line. ADR 0009 already reversed the larger half of it and said so
plainly: *"Ghosts are no longer the only way to meet other players... only the
only way to meet them in space."*

A crew **is** a social layer in the sense that sentence rules out. Shipping it
while leaving the claim standing would leave a false sentence in the README —
the exact failure ADR 0006 and ADR 0009 both went out of their way to avoid.
So this record says what it costs before it says what it does.

## What this costs, stated plainly

- **"No following" stops being true.** A crew is standing membership. It
  survives the session, it is visible on the road, and it changes what you see
  — which is closer to following than anything this app has shipped. The
  README bullet is rewritten, not deleted: "no messaging" is still true, and
  "no names you recognize going in" is still true for anyone who hasn't been
  sent a link. Only the membership half is now false.
- **The panel and the road no longer agree about who is on the day.**
  `main.ts` carried a comment saying the opposite was load-bearing: *"The
  leaderboard reads the same ghost set the scene draws, so the panel and the
  road can never disagree about who is on this day."* For a crew member with
  the panel on its global tab, they now disagree by design. That comment is
  rewritten at the point it stops being true rather than left to go stale.
- **ADR 0005's "a run is public once it ends" gets an asterisk.** It is now
  public *to your crew*, if you have one. The behavioural decision 0005
  made — only finished runs travel, never a car in motion — is untouched; the
  audience for them is not.

## And what it's for

Worth stating as the case *for* this, not only the cost: `README.md`'s "good
means" section argued from the start that the small web is good because it is
"built for people who'll actually recognize each other's presence, not an
anonymous crowd". A crew is the first time this project does that literally.
The global leaderboard that ADR 0009 shipped is, by its own admission, the
thing that ranks strangers. An invite link handed to four friends is not.

## Decision

### One active crew at a time

`users.crew_id`, directly — no join table. Joining a new link overwrites the
old membership. This matches the one-row-per-user shape `users` already has
(one `token`, one `equipped_skin`), and it keeps "which ghosts do I see" a
single value rather than a set that would need a UI to disambiguate.

### An invite link expires on count or on time, whichever comes first

`crews.max_joins` and `crews.expires_at` are both nullable, and both default
to no limit. A join is refused once either is reached. This is a real
server-side permission boundary, not a cosmetic one: a client that knows the
token still cannot join a closed crew.

### `join_count` counts joins ever, not current membership

If five people join and three later leave for another crew, live membership is
two and the invite has still been "used 5 times". The link's expiry is a
property of the link's own history, not a live headcount. The other question —
how many people are in this crew right now — is `SELECT COUNT(*) FROM users
WHERE crew_id = ?`, and both numbers are used: the first gates the invite, the
second is what the crew panel shows. They look interchangeable and are not,
which is why the schema says so in a comment.

### Road ghosts become crew-only, unconditionally, the moment you join

Not a preference, not a toggle. Crew-less behaviour is exactly as before —
everyone on the day. Joining narrows both `GET /api/ghosts?seed=` and the live
feed's per-connection set to `users.crew_id = you.crew_id`, with no opt-out.

This is the sharpest version of "the ghost is for someone," not a softened
one. A crew's road is the crew's road; if you want the whole day back, you
leave the crew by joining another, or you read the panel.

### The leaderboard panel stays switchable, global ↔ crew

The tabs appear only once you are in a crew. This is deliberately the one
place the narrowing does not apply, and it is what creates the disagreement
named above — which is the point: the road is the private thing, the
leaderboard is the public one, and being in a crew should not cost you the
ability to see where you stand on the day.

### Coins stay global

`settleDue()` reads the plain, unfiltered `best_runs` for the day — never the
crew-scoped view. A crew of two would otherwise be a 200-coin-a-day machine:
both members take ranks 1 and 2 of a leaderboard with two people on it. The
query site carries a comment saying so, because "fixing" it to respect crews
is exactly the kind of change a later edit makes in good faith.

### The live socket learns who is asking, from the cookie it already has

The WebSocket handshake carries the same `token` cookie an HTTP request would;
`request.headers.cookie` is right there on the upgrade request. Rather than
growing a second definition of "who does this cookie belong to," `auth.ts`'s
cookie-parsing half is generalized to take a raw header string, and
`requireAuth` and the live handshake share it. A signed-out connection has no
crew and sees the global feed, same as today.

The crew is resolved **on every `subscribe` message**, not once at connection
time. Joining a crew mid-session has to narrow the road without a reload —
that is the one thing ADR 0005 promised never to require — and re-reading one
indexed row per subscribe is cheaper than any way of pushing the change out to
a socket that is already open.

### A link is a path, not a query parameter

`/crew/<token>`, served the same index.html as `/`, handled client-side:
`main.ts` reads `location.pathname` on load, queues the join until an account
exists (the same deferred-until-signed-in shape `postRunEnd` already uses),
then `history.replaceState`s back to `/` so a refresh cannot double-join.

## Alternatives considered and ruled out

**An opt-in "show only my crew" toggle on the road.** The softer version, and
the one most apps would ship. Rejected because it makes the crew a filter
rather than a place. If the road is still the whole day by default, a crew is
a saved search; the decision is that it should be where you drive.

**Multiple crews per user.** More flexible, and immediately ambiguous: with
two crews, "whose ghosts are on my road" has no answer that does not need its
own UI. One crew keeps the question answerable by a single column.

**Crew-scoped coin payouts.** Rejected above. Small crews would mint coins,
and the fix — scaling the curve by crew size — is a second economy with its
own rules, for a feature whose point is who you see on the road.

**A presence/member-online indicator.** Still refused, on ADR 0005's original
grounds. A crew tells you who shares your road; it does not tell you who is
driving right now.

## Consequences

- `migrations/0003_crews.sql` adds the `crews` table and `users.crew_id`.
  `invite_token` is `randomUUID()`, the precedent `auth.ts`'s `issueToken()`
  already set — no new dependency for a random string.
- The duplicated ghost query in `routes/ghosts.ts` and `lib/live.ts` is
  extracted to `lib/ghost-rows.ts` as `ghostsFor(seed, crewId)`. Two copies of
  a query that now takes a scope argument is two places for the scope to be
  forgotten.
- **The broadcast rule is "does this client's scope include the author", not
  "do these two crews match".** The build plan wrote the latter — *only sends
  to a client whose crew matches the run's author's crew (or both have none)*
  — which would stop a crew-less viewer from seeing a crew member's run live,
  while `GET /api/ghosts` happily hands that same run to that same viewer. The
  socket has to agree with the backfill, or reconnecting silently changes what
  you can see. Recorded as a deliberate departure, not an oversight.
- `GET /api/ghosts` grows `?scope=global`, which is what lets the leaderboard
  panel fetch the whole day while the road stays narrowed. Without it a crew
  member has no way to ask for the global standings at all.
- `README.md`'s "no social layer" bullet and `main.ts`'s "panel and road can
  never disagree" comment are both rewritten as part of this change, not after
  it.
- Crew creation and every join — accepted or refused, with the reason — are
  logged by username on stdout.
