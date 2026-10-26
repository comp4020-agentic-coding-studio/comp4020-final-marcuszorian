# Multi-user test report

Source: `mise exec -- flyctl logs -a comp4020-final-marcuszorian --no-tail`
Window covered: 2026-10-19 03:22:29Z – 03:34:22Z (about 12 minutes, last ~300 log lines)
Machine: `185d9d7a330458`, region `syd`

## Scope

Several people played the deployed app at the same time. The test covered
concurrent play, coin pickup, high-score tracking, skin and trick unlocks,
crew creation, account creation, and two `flyctl` restarts while players were
active.

Players seen in the log: `a`, `tejas`, `Sai`, `Rem`, `test123`, and
`jfewaoihgieahgiuewa` (created during the test). `Rem` was also created
during the test.

## Expected behaviour

| Area | Expectation |
| --- | --- |
| Concurrency | Several players can run at once without their coin or score updates interfering with each other. |
| Coins | Each run logs `[coins] <user> collected N on <date>`. |
| High scores | A run that beats the day's best logs `[runs] ... new highscore X (was Y)`. The first run of a day logs `(first run of the day)`. |
| Skins and tricks | Unlocking spends coins and logs the coins left. Equipping logs the skin. A purchase the player can't afford is refused. |
| Crews | Creating a crew logs its id, max size and expiry. |
| Accounts | A new account logs `[account] <name> created an account`. |
| Restart | The server comes back on `0.0.0.0:8080` with `/live` for the WebSocket. **Before every write the server reads the persisted best-run row for that user/track from SQLite** (`src/server/routes/runs.ts`), so a high score earned before the restart is still the baseline afterwards simply because the SQLite file itself survives the restart on the Fly volume. The `was` value after a restart should equal the best score from before it. |

## Observations

### Concurrent play

All six players produced interleaved coin and run events with no errors,
dropped events or cross-user mixups in the log. Per-user `was` values chain
correctly from one run to the next (for example `Sai`: 389.09 → 389.59 →
542.78 → 642.57 → 817.83 → 1279.37).

### Coins and high scores

- Coin collections ranged from 4 to 77 per run.
- Highest score logged: `a` with 2654.58 (77 coins), followed by `test123` with
  2059.77 and `Sai` with 1279.37.
- First-run-of-the-day messages appeared for `Sai`, `Rem` and the new account
  `jfewaoihgieahgiuewa`, as expected.
- `jfewaoihgieahgiuewa` scored twice within the same second (68.85, then
  108.99). The second correctly reported `was 68.85`.

### Skins and tricks

- `test123` unlocked `cyan` (22 coins left). `a` unlocked `cyan` (3 coins left),
  equipped it, and later re-equipped `default`.
- `a` was refused `tailwhip` with `insufficient` while short of coins, then
  unlocked it successfully later (50 coins left) after collecting more.
- `Rem` unlocked `tailwhip` (43 coins left).

### Crews and accounts

- `a` created crew "ruiquan" (#28), and `test123` created "jfeaf" (#29). Both
  are unlimited size with no expiry.
- New accounts: `Rem` (03:23:25) and `jfewaoihgieahgiuewa` (03:32:44).

### Restarts (direct SQLite read before each write)

Two restarts occurred, at 03:31:42Z and 03:32:56Z. Each was a clean shutdown
(`SIGINT`, `/data` unmounted) followed by a reboot and a start in about 1 s.
`migrate.ts` ran before `index.ts`, and the server was listening again about
2 s after the start.

The post-restart high-score lines show the persisted row being read correctly:

| User | Last score before restart | `was` value after restart |
| --- | --- | --- |
| `tejas` | 1057.69 | 1057.69 (new score 1089.28) |
| `Sai` | 817.83 | 817.83 (new score 1279.37) |

Neither player lost their previous best, so progress carried across the
restart. `Rem` collected coins both before and after the restarts without
trouble, and the account created between the restarts
(`jfewaoihgieahgiuewa`) was saved and played normally afterwards.

Note that this is direct evidence of the SQLite file's durability across a
restart (it is the one and only persistence path, not a fallback for some
other primary store), but the test only observed `tejas` and `Sai`'s scores
surviving, not every player's, and did not directly inspect the database file
on the volume.

### Errors and warnings

- One proxy error appeared after each restart:
  `instance refused connection. is your app listening on 0.0.0.0:8080?`. It
  fires in the ~1–2 s between the machine starting and the app binding the
  port, and it cleared as soon as the `listening on 0.0.0.0:8080` line
  appeared. During that window any request or WebSocket connect would fail.
- No application-level errors appeared.

## Findings and follow-ups

1. **Pass:** concurrent multi-user play, coin accounting, per-user high-score
   chains, unlocks and crew creation all behaved as expected.
2. **Pass:** high scores persist correctly across a `flyctl` restart, because
   the server reads the best-run row from SQLite before every write and the
   SQLite file itself survives the restart on the Fly volume.
3. **Minor:** a ~1–2 s window of proxy connection errors on each restart.
   Clients should retry the WebSocket on `/live`. A health check or
   `min_machines_running` setting could reduce this.
4. **Gap in the evidence:** the log doesn't record connections, disconnects or
   ghost/live-position traffic, so the realtime ghost behaviour (ADR 0005) was
   not verified here. A user whose score was not beaten after the restart
   would also not appear in the sync evidence (only `tejas` and `Sai` did).
5. **Limit of the window:** only the last ~300 log lines were fetched, so
   events before 03:22:29Z (for example earlier runs by `test123`, whose
   previous best of 603.28 was already on record) are not covered.
