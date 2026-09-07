---
"@reddb-io/redcode": patch
---

Bound TUI plugin shutdown to two seconds so a stalled disposer cannot indefinitely prevent worker shutdown and return to the parent shell. Preserve normal cleanup and log failures or timeouts.
