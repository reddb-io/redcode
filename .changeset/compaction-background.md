---
"@reddb-io/redcode": patch
---

Prepare context summaries in the background near the compaction threshold in both runtimes. Reuse validated candidates between provider turns, retain messages added during preparation, discard stale candidates, and cancel auxiliary work when execution ends. Add `compaction.background` to disable preparation independently of automatic compaction.
