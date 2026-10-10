---
"@reddb-io/redcode": minor
---

Add a first distributed worker CLI: register authenticated Redcode servers, dispatch task manifests by capability tags or worker affinity, and run tasks concurrently across independent checkouts. Persist placement and session IDs, collect remote assistant output, and retain checkout reservations when a task is waiting, running or disconnected. Reconnecting observes the original session without automatically replaying an ambiguous prompt.

Record upstream branch heads and review remote execution experiments separately from implemented OpenCode V2 features. Physical Raspberry Pi provisioning remains pending; the Console and desktop provide worker administration and task views.
