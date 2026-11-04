# Playtest, 17 October

## Who played

Everyone joined the same crew. Seven accounts drove that day's road, the day
crews landed
([38b43d1](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/38b43d1935a18a738cb34d172c58849061196d01)).
The longest run reached 28,333 m. All seven ghosts are still on the
17 October road today.

## What they said

- Ghosts were a good way of seeing each other's scores.
- They gave players an incentive to get higher scores.

## What changed because of it

After the playtest I wanted the road to be harder, so the next morning I
added two new obstacle kinds: moving barriers and oil
spills
([0459043](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/0459043f2b0b240c39676f4713c89792e76a8c5e),
[ADR 0012](../../doc/adr/0012-moving-and-non-fatal-hazards.md)). The
playtest decided that the road needed to get harder; the concept art
decided what the new obstacles looked like.

Within the hour I slowed the moving barriers twice, halving their sweep speed
and then cutting it again, and replaced pairs of barriers sharing a lane,
which read as one barrier glitching
([d496448](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/d496448a6a363139f7278c87aa9f723a3ecde7b1),
[33739ca](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/33739cae6bee84adf9473c0f15a42da0933101b3)).

## What it broke

The new obstacles went into every day's road, not only days from 18 October
on. In its first 2.4 km the 17 October road now has 18 moving barriers and
8 oil spills that the playtest never faced; none of its original 74 barriers
moved. Every one of its seven ghosts got past the first new barrier, at
about 210 m, so all of them sit on a road they never drove. That breaks
[ADR 0002](../../doc/adr/0002-daily-seeded-archive.md): a ghost means
something only if the road under it is the road it was driven on. ADR 0012
checked that the new obstacles were deterministic, not that past days stayed
the same.

## What it says about the idea

Both things players said about ghosts were about scores. That pulls toward
the race the README argues against, not toward a trace of someone you drive
past.
