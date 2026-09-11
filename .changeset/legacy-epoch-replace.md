---
"@reddb-io/redcode": patch
---

After a legacy compaction the context epoch is replaced with `SystemContext.replace` semantics instead of being reset: the request is durable on the epoch row, a source that is temporarily unavailable at the boundary keeps the previous baseline and snapshot in force while the turn proceeds, and the replacement is retried at every later boundary until it succeeds.
