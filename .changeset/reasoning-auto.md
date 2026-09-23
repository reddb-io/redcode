---
"@reddb-io/redcode": minor
---

Add an `auto` reasoning variant. Pick it in the variant picker (listed first when the model has two effort levels or more), with `ctrl+t`, with `--variant auto`, or as an agent's `variant`. Each turn then runs at one of the model's own effort levels. The level is chosen where you speak and is held for two turns. It uses System One's reading of your message, including a new judgement of whether you agree with, correct or reject the previous answer, along with the size of the context, the plan agent and an explicit "think hard" or "pense bem". It steps up at most once inside a tool loop that keeps failing or looping. You can bound it with `reasoning.auto.floor` and `reasoning.auto.ceiling`.

Redcode now coordinates effort with RedRouter so that only one side decides. With System One, Redcode decides: it sends `x-red-router-reasoning: off` to direct models and the level to auto or smart combos. Without System One, a RedRouter whose reasoning autopilot accepts `auto` decides. It receives the loop's stall signal and reports its level, which the prompt footer shows. A variant you picked yourself is never overridden (`off`). The footer shows the effective level (for example `auto → high · frustration` or `router: medium`), and each answer shows the level its turn used.
