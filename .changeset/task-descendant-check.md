---
"@reddb-io/redcode": patch
---

Refuse task_id values that do not descend from the calling session

The task tool now walks the resumed session's parent chain and requires the
calling session to appear in it, so a model can no longer prompt into a sibling
or another project's session by passing its id. The subagent depth cap is
computed on the chain that is actually prompted, and the background cap counts
only background jobs instead of every running task.
