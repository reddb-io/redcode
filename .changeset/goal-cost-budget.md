---
"@reddb-io/redcode": minor
---

Add opt-in spend budgets for goals and sessions. Nothing is limited unless you set a limit: there is no default cost or token budget, no budget warning without a budget, and the model cannot set one.

Every finished provider step is counted: the turn itself, subagents, compaction, session titles and the goal judge. The running total is stored on the session (`metadata.spend`) and rolls up to parent sessions. Token limits count input, output, reasoning, cache writes and cache reads. An attempt that is aborted or fails before the provider reports usage is not counted, so spend can be slightly under the bill.

- **Goals** accept `max cost: $2` and `max tokens: 500k` in the `/goal` text, `max_cost_usd` and `max_tokens` on `POST /session/:id/goal`, and a spend change through `/goal-budget` (for example `$3`, `500k tokens`, `40 turns $3` or `off`).
  - When a goal reaches its budget, it pauses after the current step with a reason such as `budget: $2.00 of $2.00 spent`.
  - Resuming stays paused while the goal's or the session's budget is reached; the resumed turn is told the budget was hit and asks you before spending past it.
  - A spend line that cannot be read stays in the objective and the response warns about it. A goal made only of spend lines is refused: it needs an objective.
- **Sessions** read `session.budget` (`max_cost_usd`, `max_tokens`, `reset_on_message`) from the global or project configuration. You can override it per session, including `reset_on_message`, with `/budget $5`, `POST /session/:id/budget` or `redcode run --max-cost` / `--max-tokens`.
  - When the budget is reached, the turn finishes its current step and stops; the reason is shown in the transcript as a notice that is never sent to the model.
  - No provider is called again until the budget is raised. With `reset_on_message: true` the budget counts afresh from each message you send instead.
  - `redcode run` exits 1 whenever a budget stopped it, whether the limit came from the flags, the configuration, the session or a goal. A fork starts its own spend and keeps the limits.
- **Amounts:** `2,50` is 2.50, `1,000` is a thousand, and `1,5m` is 1.5 million tokens; mixed separators such as `1.000,50` are refused with a message.
- **Pricing:** a model priced at zero is free. A model with no pricing data makes its cost unknown: a cost limit warns once, the known cost still counts, and a token limit bounds the rest.
- **TUI:** under "$ spent", the sidebar shows spend against a budget, labelled as including subagents, but only when a budget is set. You get one warning at 80% of a limit, and a notice when a budget stops a turn or pauses a goal.
