---
"@reddb-io/redcode": patch
---

Reject stale plan-exit question dialogs instead of freezing on them

When the tool asking a question is interrupted, the pending request is now
published as `question.rejected` so clients drop the dialog. The TUI question
prompt surfaces reply/reject failures with a toast and removes the stale
request instead of silently swallowing them and leaving a dead dialog.
