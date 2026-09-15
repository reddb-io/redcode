---
"@reddb-io/redcode": minor
---

Add opt-in spend budgets for goals and sessions. Nothing is limited unless you set a limit: there is no default cost or token budget, no budget warning without a budget, and the model cannot set one.

Every provider call is counted as it finishes: the turn itself, subagents, compaction, session titles and the goal judge. The running total is stored on the session (`metadata.spend`) and rolls up to parent sessions.

- **Goals** accept `max cost: $2` and `max tokens: 500k` in the `/goal` text, `max_cost_usd` and `max_tokens` on `POST /session/:id/goal`, and a spend change through `/goal-budget` (for example `$3`, `500k tokens` or `40 turns $3`). When a goal reaches its budget, it pauses after the current step with a reason such as `budget: $2.00 of $2.00 spent`. Resuming stays paused until the budget is raised; the resumed turn is told the budget was hit and asks you before spending past it.
- **Sessions** read `session.budget` (`max_cost_usd`, `max_tokens`, `reset_on_message`) from the global or project configuration, and you can override it per session with `/budget $5`, `POST /session/:id/budget` or `redcode run --max-cost` / `--max-tokens`. When the budget is reached, the turn finishes its current step and stops with a notice. No provider is called again until the budget is raised; `reset_on_message: true` counts the budget afresh from each message you send instead. `redcode run` exits 1 when its budget is reached.
- **Unknown pricing:** token limits work for models without pricing. A cost limit warns once that part of the cost is unknown; the known cost still counts, and a token limit bounds the rest.
- **TUI:** the sidebar shows spend against a budget under "$ spent", but only when one is set. You get one warning at 80% of a limit, and a notice when a budget stops a turn or pauses a goal.
