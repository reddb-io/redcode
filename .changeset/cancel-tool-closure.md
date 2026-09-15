---
"@reddb-io/redcode": patch
---

Close tool calls left without a result by a cancelled or interrupted turn:

- **Synthetic result:** every call without a result is sent as failed, with a message saying it was cancelled or interrupted and its outcome is unknown. Up to 2,000 characters of the output it produced before stopping are included. Partial output is no longer passed off as a successful result.
- **Crash repair:** when a session is loaded after the process died, tool calls it left running or pending are marked interrupted, not only the open message.
- **Failed steps:** a step that failed after one of its tools ran stays in history, so the model does not repeat that side effect.
- **Cancel note:** the turn after a cancel gets a single trailing reminder saying so. It asks the model to check state before repeating side effects and not to redo completed work, and it keeps the cached prefix stable.
- **v2 runner:** the same result text and note apply there, and a history loaded without repair still pairs every call with a result.
