---
"@reddb-io/redcode": minor
---

Design mode: craft that is checked

A prototype that only shows the populated state decides nothing, so `design_preview` now reports which of the five states — loading, empty, error, populated, edge — the prototype does not render, and writes each as a question into `design.json`, where `design_exit` carries it into the plan. `design.json` gains a `kind` (screen, flow, comparison, deck), each with its own checks. The craft notes grow the second set: uppercase without tracking, images loaded from a network the prototype does not have, raw hex outside the token block, the accent used everywhere.
