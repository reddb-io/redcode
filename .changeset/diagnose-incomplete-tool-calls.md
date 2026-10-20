---
"@reddb-io/redcode": patch
---

session_history tool-inspection now reports streaming/running/errored tool calls instead of failing with "Completed tool output not found", so diagnosing an incomplete execution no longer dead-ends when the inspected tool call never completed.
