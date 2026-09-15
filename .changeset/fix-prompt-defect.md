---
"@reddb-io/redcode": patch
---

Fix every prompt in a session failing with "Unexpected server error" once a completed task's quoted user message was no longer in the session history (for example after compaction). The task review that runs before each provider step re-validated the task's stored request and failed the whole prompt. A stored request is now trusted, and a task review the store refuses is logged and keeps the stored list instead of failing the turn.
