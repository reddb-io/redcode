---
"@reddb-io/redcode": minor
"@reddb-io/redcode-core": minor
"@reddb-io/redcode-schema": minor
---

Write down every time a guard intervenes, so the thresholds can be argued from evidence

Five guards ship in 0.14.0 — the inactivity watchdog, tool deadlines, the loop guard, the step budget, the bounds on naming and compacting — and every threshold in them was chosen by argument, because there was nothing to measure. Each intervention is now recorded with which guard fired, what it acted on, and what it did, and published as a live `session.next.guard.tripped` event. `redcode debug guards` reads it back: counts per guard and action over the last week, loudest first, plus the most recent trips. An empty report says so in words, because "nothing fired" and "nothing was collected" are different answers.
