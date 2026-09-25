---
"@reddb-io/redcode": patch
---

Stop waiting out a quota that resets far off, and let a model switch take a pending retry. When a provider or RedRouter says the model's quota or usage limit resets more than two minutes away (a long `Retry-After`, a router retry-at, or an explicit "until <date>"), the turn ends at once with `<provider · model> quota exhausted until <local time>; switch model with /model or wait` and offers an equivalent model on the suggestion card, instead of showing a countdown of up to 15 minutes. Shorter waits still retry, and the retry status now names the model it waits for and, for a quota, when it resets. Selecting another model (with `/model` or from the suggestion card) while a retry waits cancels the wait and sends the same request to the new model right away, with fresh retry attempts; Esc still ends the wait. `PATCH /session/:id` accepts a `model` to select it.
