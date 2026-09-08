---
"@reddb-io/redcode": patch
---

Finalize Goals only after sibling tools and hooks settle, reject completion when new steering is pending, and retain reported provider and reviewer usage even when execution fails or a verdict is stale or interrupted. Apply bounded termination to owned subprocesses so cancel and timeout do not depend on every caller opting into escalation.
