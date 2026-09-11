---
"@reddb-io/redcode": patch
---

Keep todo state out of the system prompt so todowrite preserves the provider cache

The session loop rendered the live task list into the system prompt on every
step, so each `todowrite` rewrote the prompt and invalidated the provider's
cached prefix for the request that followed. The task state now rides the last
user message as a reminder, the way the goal already does, with the same text;
the system prompt keeps only the static todo guidance. The list is reviewed
once per step instead of twice.
