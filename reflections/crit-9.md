# Crit 9 reflection

## What was the breakthrough that moved the work forward?

The breakthrough was not the WebSocket. That part was nearly free, and
deliberately so: ADR 0001 chose Node over Astro a month ago specifically to
keep `ws` available, and left `scoreChanged()` in the server as a no-op seam.
Cashing it in this week did not require touching `runs.ts` at all. A decision
made before any code existed paid for itself in a single commit.

The breakthrough was what happened when I tried to *verify* it. Two browser
tabs failed, and the diagnosis (shared cookie jar, so both tabs were the same
player) was wrong twice over. Driving two genuinely separate browsers
uncovered three bugs chained behind one another. `setAuthCookie` sets
`httpOnly`, so `document.cookie` could never contain the token, so
`hasAccount()` always returned false, so `if (hasAccount()) postRunEnd(...)`
never fired: **no crash in a real browser had ever saved a run.** Every ghost
in the database had been written by the test suite. Fixing that unmasked a
second bug: `requestAnimationFrame` reports the timestamp of the frame already
in flight, which can predate `lastTime`, giving a negative `dt` that drove
distance below zero until `sqrt` turned it to NaN. The always-visible username
modal had been hiding it by pausing the loop until the clock caught up. Then
the day selector turned out to gate navigation on which days had recorded runs
rather than on the calendar, so a fresh database let you step back exactly one
day before the button greyed out.

Three bugs, all in `client/`, the one layer ADR 0003 admits was never under
test. The suite was green through every one of them, because every HTTP spec
sends the cookie by hand and none of them runs a frame loop.

## What did this work change about who I want to be as a software developer?

Crit 8 taught me to verify the running artifact in a real browser. Crit 9
taught me something sharper and less comfortable: a green test suite can be
evidence of nothing. Mine passed through a game that had never once saved a
score. The tests were not wrong, they were aimed at a seam where the bug
could not live, which is worse, because it buys confidence without earning it.

So the question I now want to ask by reflex is not "do the tests pass" but
"what would these tests still pass through?" For this project the answer was
embarrassing: the entire client. The fix was not more tests but a different
*kind* of sensor: a script that drives two real browsers and watches one see
the other's ghost arrive. That found in one run what four files of HTTP specs
could not reach.

The other thing I want to keep is the agent's willingness to tell me I was
wrong about sequencing. I asked it to implement the game redesign first; it
pointed out that the crit's headline requirement was untouched and that the
redesign moved none of it, then did what I asked when I chose that anyway. It
cost me time I did not need to spend. Being a good director means hearing that
kind of objection as information rather than friction, and, next time,
weighing it before overriding it.
