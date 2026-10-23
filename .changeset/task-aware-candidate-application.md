---
"@reddb-io/redcode": minor
---

Apply accepted integration tasks through `session.todo.applyIntegration`. The host requires current prerequisite acceptance, an exact candidate verification receipt, and unchanged clean source and target revisions. It broadcasts and records admission before changing the target checkout and preserves application provenance separately from the accepted task proof.

Retrying the original request returns the recorded result or observes the original target without replaying Git. Uncertain outcomes remain pending for explicit host reconciliation. Goals cannot complete while applications are pending or accepted candidates have no matching application receipt.
