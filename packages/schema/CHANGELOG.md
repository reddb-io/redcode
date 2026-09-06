# @reddb-io/redcode-schema

## 1.20.1

### Patch Changes

- d9dcc88: Latency and output speed on the panel

  Every assistant message now records when its first streamed chunk arrived (`time.first`). The TUI footer shows the last reply's latency and its output rate next to context and cost — `1.2s · 84 tk/s` — and the app shows both in the context tooltip and the context tab. Speed counts output plus reasoning tokens from the first chunk to completion; latency is the wait from the request to that first chunk. Messages from before this release show neither rather than a guess.

## 1.20.0

### Minor Changes

- 68c96b4: Write down every time a guard intervenes, so the thresholds can be argued from evidence

  Five guards ship in 0.14.0 — the inactivity watchdog, tool deadlines, the loop guard, the step budget, the bounds on naming and compacting — and every threshold in them was chosen by argument, because there was nothing to measure. Each intervention is now recorded with which guard fired, what it acted on, and what it did, and published as a live `session.next.guard.tripped` event. `redcode debug guards` reads it back: counts per guard and action over the last week, loudest first, plus the most recent trips. An empty report says so in words, because "nothing fired" and "nothing was collected" are different answers.

## 1.19.0

### Minor Changes

- 82bb18a: Say what a busy session is actually doing

  `session.status` reported `busy` as a bare tag, so the TUI had to reverse-engineer the phase from message parts and every other client got nothing at all. `busy` now carries an optional phase (preparing, thinking, writing, tool, compacting), the tool being run, the step number, and when the phase started. The fields are additive: readers that discriminate on `type` alone are unaffected. The TUI uses them for the window the parts cannot describe — before the first byte arrives — and shows the step number, so a turn on its eighth step no longer looks the same as one that just started.
