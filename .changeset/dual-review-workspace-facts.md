---
"@reddb-io/redcode": minor
---

Dual review is grounded in deterministic workspace facts. Each review gate now declares the facts it reads, the evaluation records the bounded workspace state it judged against — files changed, task counts, active goal — and the evaluations dialog in the TUI and desktop shows that state beside the verdict. Stop-loss steers cite the same workspace facts, so a corrective hint names what the worktree actually shows instead of a generic nudge.
