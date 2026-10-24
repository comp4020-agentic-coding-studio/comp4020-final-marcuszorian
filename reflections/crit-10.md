# Crit 10 reflection

## What was the breakthrough that moved the work forward?

The breakthrough was realizing a ramp's QTE was unsafe by accident, not by
design. ADR 0013 had a ramp hug "the nearest fatal hazard of any kind," which
sounds like a guarantee, but it says nothing about *what* the player jumped.
A failed trick survived only because the lead distance happened to be
generous, not because the game promised it would. Pairing each ramp with one
specific barrier row, exempting that exact barrier for the trick's duration,
and snapping the car into its lane when the trick settles turned "probably
survivable" into "always survivable, and visibly so."

The second breakthrough was adversarial: looking for the same class of bug
where I hadn't been asked to look. A static row blocking two lanes
(`clamp-outer`) leaves one lane open. The moving-barrier placement check only
confirmed a sweep wasn't centred on a lane a static row *also* blocked; it
never considered the sweep closing the one lane the static row left standing.
I'd written code that passed every existing test and still boxed a player in.
The fix wasn't a bigger constant; it was asking "is anything fatal nearby at
all," not "in the same lane."

I also caught myself reporting a false blocker: `/api/tricks` 404ing locally,
dismissed as "pre-existing and unrelated" without checking why. It wasn't:
four of my own leftover `pnpm start` processes were squatting on the port the
suite expected the real app on. The lesson wasn't "trust the test output," it
was that an explanation needs to survive one more question before it's
allowed to stop being investigated.

## What did this work change about who I want to be as a software developer?

It sharpened what "verification" means when the agent is fast. A landing-snap
fix looked correct on paper and teleported the car the instant I actually
drove it, internally consistent, just wrong to watch. The fix came from
playing the game, not reading the diff. I want to keep treating "it
typechecks and the tests pass" as the floor, not the finish line, especially
for anything the player experiences as feel or timing rather than a return
value.
