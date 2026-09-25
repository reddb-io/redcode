---
"@reddb-io/redcode": patch
---

Stop-loss no longer halts large sessions after two steps. Spend since the last progress now counts only the work each step added (generated tokens plus context growth), not the whole context re-read every step, and its thresholds grow with the context size; spend alone ends a turn only after six steps without progress. Polling a read-only status check of an outside job (such as `gh run view` while CI runs) is treated as waiting: the model is pointed at a monitor instead of being stopped, those steps do not count as stalled for 30 minutes, and the user is asked after that. In single reasoning a stall now gets two hints before a stop, and a stop message says what it was waiting for and offers a one-reply way to continue or wait with a monitor.
