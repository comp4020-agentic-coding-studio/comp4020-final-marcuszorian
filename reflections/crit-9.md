# Crit 9 reflection

## What was the breakthrough that moved the work forward?

Not the WebSocket. That was nearly free: ADR 0001 chose Node over Astro to keep
`ws` available, and left `scoreChanged()` as a no-op seam. Cashing it in didn't
touch `runs.ts`.

The breakthrough was *verifying* it. Two tabs failed, and my diagnosis (a shared
cookie jar) was wrong. Two genuinely separate browsers uncovered three chained
bugs. `setAuthCookie` sets `httpOnly`, so `hasAccount()` always returned false
and **no crash in a real browser had ever saved a run**: every ghost had been
written by the test suite. Fixing that unmasked a negative `dt` from
`requestAnimationFrame` that turned distance into NaN. Behind both, the day
selector gated on recorded runs instead of the calendar.

All three lived in `client/`, the one layer never under test. The suite was
green through every one, because every HTTP spec sends the cookie by hand and
none runs a frame loop.

## What did this work change about who I want to be as a software developer?

A green suite can be evidence of nothing. Mine passed through a game that had
never once saved a score. The tests weren't wrong; they were aimed at a seam
where the bug couldn't live, which buys confidence without earning it.

So the question I want to ask by reflex is "what would these tests still pass
through?" Here the answer was the entire client, and the fix was a different
kind of sensor: two real browsers, one watching the other's ghost arrive.

I also want to keep hearing the agent's objections. It pointed out that the
redesign I asked for first left the crit's headline requirement untouched; I
overrode it, and it cost me time. Next time I'll weigh that before overriding.
