# Crit 8 reflection

## What was the breakthrough that moved the work forward?

The breakthrough was realizing multiplayer didn't need real-time sync or a leaderboard to feel shared. The obvious build was WebSocket lobbies and rolling high scores. The brief's actual ask, small spaces where people recognize each other, pointed somewhere else: treat time and space as a deterministically seeded daily archive.

Tying track generation to a shared UTC date seed via `mulberry32`, and keying scores by `(user_id, track_seed)`, turned a crash coordinate into a permanent ghost on that day's road. That cut the technical stack for this crit (no real-time socket infrastructure needed in week one) while doing more for the game's point: you don't look up a handle on a scoreboard, you drive past the wreck of someone who raced this exact road earlier today.

That decision anchored everything after it: ADR 0002's data model, the visual direction where older days degrade like worn tape, and one constraint the agent now has to hold forever, that track geometry can never shift. Framing the mechanic as an archive of traces rather than a speed contest made the choices that came after it obvious.

## What did this work change about who I want to be as a software developer?

Before this project I measured my own skill by how fast I could write syntax and solve edge cases by hand. An agent that generates a working Express endpoint or a custom GLSL shader in seconds makes that measure useless.

What it's replaced with is architectural restraint and verification. The agent will generate plausible code all day and call the project done the moment headless tests pass, with no sense that the road was invisible in WebGL from back-face culling or that the modal's CSS had broken on specificity. It has no taste and no situational awareness, and it won't tell you something's wrong if nothing is failing.

Being useful here means being a director: write the ADR before the code, hold the line against unnecessary dependencies, and check the running app in a real browser instead of trusting a green suite. That's the judgment an agent doesn't supply on its own.
