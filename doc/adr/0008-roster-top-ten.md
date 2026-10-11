# 0008. The roster shows ten, plus your own run

Status: accepted

Supersedes the "list everyone" part of
[0007](0007-day-roster.md). That record's core rule — ordered by distance, no
rank numbers, no positions — is untouched and still in force.

## Context

ADR 0007 shipped a roster listing everyone on the day. Against a real day's
data that is 50 rows (the `/api/ghosts` limit), and in testing it was already
51. A list that long is not a panel, it is a wall: it fills the left of the
screen on a desktop, and on a phone an opened disclosure covers the road
entirely. Nobody reads row 38.

It also failed at the one question a player actually has, which is not "who
are all these people" but "where am I in this". Your own run was somewhere in
the middle of fifty rows with nothing marking it.

## Decision

**Ten rows, then — if your own run for that day isn't among them — a gap and
your row below it.** Your row is marked wherever it appears, inside the ten or
below the gap, so it means the same thing in both places.

The header count stays the **whole day**, not ten. The panel is truncated; the
road is not. Reporting "10" there would make a busy day look empty, and the
ghosts not listed are still out there to drive past.

Distances stay rounded to the nearest whole metre, per ADR 0007.

## The tension this creates, stated plainly

"Your score, below the cut" is the single most leaderboard-shaped thing in
this app. It is the classic *your rank* affordance with the number filed off,
and the pod should push on it.

Two reasons it is still the right call, and one concession:

1. **There is no number and no position.** You learn that you are outside the
   ten, not that you are 23rd. "Outside the ten" is a fact about the day;
   "23rd" is a fact about you relative to strangers, which is the thing
   `README.md` refuses and ADR 0007 kept refusing.
2. **It is your own data.** Every other row is someone else's trace, which is
   what the ghosts already are. Your own row is the app telling you what it
   recorded about you — the same thing the HUD score does.
3. **The concession:** ADR 0007 justified the roster partly by reachability —
   "a day's archive was otherwise mostly unreachable". Showing ten of fifty
   walks most of that back, and it would be dishonest to claim otherwise. What
   survives is the weaker and more truthful version: the roster shows the
   *shape* of a day and where you sit in it, and the archive remains reachable
   the way it always was, by driving the road.

## Alternatives considered and ruled out

**Keep all fifty, add a scrollbar.** This is what shipped in 0007 and the list
already had `overflow-y: auto`. Rejected because scrolling a fifty-row panel
to find yourself is worse than not having the panel.

**Ten rows, no personal row.** Simplest, and the purest reading of the
no-leaderboard argument. Rejected because it leaves a player who has driven
that day with no acknowledgement anywhere that their run was recorded, which
is the complaint that produced the roster in the first place.

**Show the position number next to your row.** Rejected — that is the line.
Everything above survives precisely because no number is printed.

## Consequences

- The roster renders at most eleven rows plus a separator, so the wholesale
  rebuild on every update stays trivially cheap.
- `Roster.setViewer()` is called when the account resolves on load and again
  when a username is first claimed, and re-renders from the last set it was
  given, so claiming a name immediately marks your row without a refetch.
- Your run is matched **by username, not by index**, so two players tying on
  distance cannot swap whose row is highlighted.
- The `/api/ghosts` limit of 50 is now invisible to the UI. If the roster ever
  needs to be honest about days with more than fifty runs, that limit — not
  this panel — is what has to change.
