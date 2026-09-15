---
"@reddb-io/redcode": patch
---

todowrite no longer refuses a task update because a requirement or scope-change quote does not match a user message: a matching quote links its message, anything else is linked to the latest user request with the model's wording kept, and the tool result says so. Completion still requires real verification, and cancellation still requires a scope change and a concrete reason. New `redcode debug todos [sessionID]` prints a session's tasks with their source, criterion, evidence, revision and refused attempts, plus the latest todowrite errors (`--json` for machine output).
