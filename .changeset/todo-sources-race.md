---
"@reddb-io/redcode": patch
---

Stop failing todo updates with "Task sources changed during evaluation" whenever another tool call in the same step settles while System One reviews the update. Only a task update committed meanwhile, or a new edit that makes the completion's evidence stale, now refuses it, with the specific stale-evidence message. A completion that cites a callID no tool result has is resolved from the files, design ids and `commands` its explanation names, under the same stale-evidence rules; nothing named still refuses it.
