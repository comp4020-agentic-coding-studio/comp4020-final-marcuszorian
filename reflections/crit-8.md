# Crit 8 reflection

## What was the breakthrough that moved the work forward?

The breakthrough was realizing that "multiplayer" did not require real-time synchronization or competitive leaderboards to feel profoundly shared. Early on, the temptation was to build what standard multiplayer driving games build: WebSocket lobbies, matchmaking, and rolling high-score tables. But when examining the brief's emphasis on small, intimate web spaces where people recognize each other, the conceptual breakthrough arrived: treating time and space as a deterministically seeded daily archive.

By tying track generation to a shared UTC date seed via `mulberry32` and keying scores by `(user_id, track_seed)`, a player's crash coordinate became a permanent, tangible ghost on that day's road. This fundamentally simplified the technical stack for Crit 8—eliminating the need for complex real-time socket infrastructure in week one—while dramatically elevating the game's emotional resonance. You don't look up an anonymous handle on an abstract scoreboard; you physically drive past the translucent wreck of someone who raced this exact asphalt earlier today or last week.

This breakthrough rippled across the entire project. It anchored the data model in ADR 0002, dictated the hauntological visual language where older days degrade like worn VHS tapes, and gave the agent a clear, inviolable constraint: track geometry is a contract that can never shift. Once the mechanic was framed as an archive of traces rather than a speed contest, every subsequent architectural choice fell into place.

## What did this work change about who I want to be as a software developer?

This project radically altered my perception of competence in an agentic coding environment. Prior to this studio, I measured my skill as a software developer by how quickly I could write syntax, navigate framework APIs, and solve algorithmic edge cases by hand. Working with an LLM that can generate working Express endpoints, Three.js boilerplate, or custom GLSL shaders in seconds completely commoditizes that layer of effort.

What it exposed instead is that the hardest, most consequential parts of software engineering are architectural restraint, conceptual clarity, and sensory verification. The agent will enthusiastically generate thousands of lines of plausible code, but it lacks taste and situational awareness. It was happy to declare the project done when headless API tests passed, completely oblivious to the fact that the road was invisible in WebGL due to back-face culling and that the modal CSS had broken author specificity.

This experience taught me that being a great developer is no longer about being the fastest typist or memorizing documentation; it is about being a rigorous director. It means establishing rigid ADRs before code is written, holding the line against dependency bloat, questioning whether a feature actually serves the user's emotional experience, and personally verifying the running artifact in a real browser. I want to be a developer who provides the taste, judgment, and skepticism that generative tools cannot supply.
