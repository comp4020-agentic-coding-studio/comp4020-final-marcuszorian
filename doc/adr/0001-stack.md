# 0001. Node/Express/better-sqlite3/Three.js for the final project

Status: accepted

## Context

The final project needs a multi-user, real-time website, starting this week
with "proof of life": an endless 3D driving game, named accounts, and scores
that persist across restarts and redeploys. It runs on one Fly machine
(shared-cpu-1x, 256MB, one volume at `/data`, no separate DB server) for the
whole project, from C8 through submission.

Ghost-score sync (seeing other players' best runs) doesn't need to be
instant — polling every 1–5 minutes is fine for that feature specifically.
But a different feature, due next week (C9, "one decision about several
people at once"), does need a change to reach every open session in about a
second. The stack has to not foreclose that, even though it isn't built yet.

Four options were researched in depth (three parallel research passes,
cross-checked against this exact project, not generic framework comparisons):
Node + Express + SQLite, Astro (the course's own default for most of the
course), Django + Channels, and Phoenix LiveView.

## Decision

**Node.js + Express + better-sqlite3**, with **Three.js** for the 3D client,
REST polling for the ghost sync now, and a single `scoreChanged()` seam in the
server where a `ws` broadcast gets added later without touching anything else.

## Alternatives considered and ruled out

**Astro** (the course default elsewhere). Its Node adapter does run a real,
long-lived process, so SQLite-backed REST polling works fine — but Astro has
**no official WebSocket API**. An adapter-agnostic proposal
(withastro/roadmap#695) has been open, unmerged, since September 2023.
Working around it means hand-writing a custom Node entrypoint that attaches a
raw `ws` server alongside Astro's handler — at which point the "stateful
server" half of the project is plain Node code with Astro bolted on for
page-serving, not Astro doing anything for the half that matters most. It
also idles heavier (~80–150MB just for Astro's SSR runtime) on a 256MB
machine, and its own documentation/training data is overwhelmingly about
content-site rendering, not game/API servers — exactly the part of this
project that needs to be right.

**Phoenix LiveView**. Real-time broadcast is genuinely built in (PubSub,
Channels), which is the strongest "real-time native" story of the four. But
LiveView's whole model is server-rendered HTML, diffed and patched over a
socket — the opposite of a client-side 3D canvas game loop. A real talk on
building a multiplayer browser game in LiveView (AgarEx) confirms this
directly: canvas/WebGL don't work with DOM diffing, so they rendered via
SVG+CSS instead. Using LiveView here would mean not using LiveView for the
game at all — plain Phoenix + Channels, Elixir's actual strength, without its
headline feature. With no prior Elixir experience, an AI-reviewed 2-day
build, and real community-reported OOM kills for Phoenix on this exact
256MB tier, the unfamiliarity and memory risk isn't worth a feature
(LiveView rendering) this project wouldn't even use.

**Django + Channels**. The closest runner-up. Plain Django views + the
built-in SQLite support are arguably no harder than Express for this week's
feature set, with more batteries included (admin, auth, migrations) for free.
The real cost shows up exactly when the real-time feature lands: Channels
mixes Django's sync ORM with async consumers (a documented beginner trap for
AI-reviewed code), and Channels/Daphne have a documented history of memory
leaks under live WebSocket load — a real risk on a 256MB machine, arriving
right when the project needs that machine to hold open connections.

## Consequences

- The server/game-logic code is plain, well-documented Node — the pattern an
  AI agent writes most idiomatically and I can read and debug most reliably.
- SQLite migrations must run at container boot (in the app's own `CMD`), not
  via Fly's `release_command` — `fly.toml`'s own comments confirm
  release-phase machines have no volume attached, so a release-command
  migration would silently run against a throwaway, empty database.
- Real-time for C9 means adding a `ws` server and swapping the no-op
  `scoreChanged()` for an actual broadcast — a scoped, well-understood change
  to one seam, not a rewrite.
- If Astro, Django or Phoenix turn out to fit a *later* part of this project
  better than expected, that's a new decision record superseding this one,
  not an edit to it.
