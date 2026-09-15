---
"@reddb-io/redcode": patch
---

Fix the TUI starting without agents or commands behind repeated HTTP 499s: a cancelled request no longer poisons the per-instance cache, bootstrap re-runs are coalesced instead of cancelling each other, and client cancels are logged at debug.
