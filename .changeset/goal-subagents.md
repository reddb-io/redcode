---
"@reddb-io/redcode": minor
---

Subagents inherit the goal, and the loop waits for them

When the parent session has an active goal, every `task` call opens the child's prompt with the objective and the contract — not the budget, not the completion tool: the child does one part, and only the parent's turn is judged. A turn that ends with a background subagent still running parks the loop on WAIT instead of spending a turn; the subagent's report re-enters the parent and the judge runs again on that turn.
