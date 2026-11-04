# Crit 10 reflection

## What was the breakthrough that moved the work forward?

Realizing a ramp's QTE was safe by accident, not by design. ADR 0013 had a ramp
hug "the nearest fatal hazard of any kind", which sounds like a guarantee but
says nothing about *what* the player jumped. A failed trick survived only
because the lead distance happened to be generous. Pairing each ramp with one
barrier row, exempting that barrier for the trick, and snapping the car into
its lane on landing turned "probably survivable" into "always survivable, and
visibly so."

The second breakthrough was looking for the same class of bug where I hadn't
been asked to. The moving-barrier check never considered a sweep closing the
one lane a static row left open. I'd written code that passed every test and
still boxed a player in. The fix was asking "is anything fatal nearby at all,"
not "in the same lane."

I also caught myself reporting a false blocker: `/api/tricks` 404ing, dismissed
as "pre-existing" without checking. It was four of my own leftover `pnpm start`
processes squatting on the test port. An explanation needs to survive one more
question before it's allowed to stop being investigated.

## What did this work change about who I want to be as a software developer?

It sharpened what "verification" means when the agent is fast. A landing-snap
fix looked correct on paper and teleported the car the instant I drove it. The
fix came from playing the game, not reading the diff. "It typechecks and the
tests pass" is the floor, not the finish line, for anything the player
experiences as feel or timing.
