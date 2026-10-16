---
"@reddb-io/redcode": patch
---

Reserve worker checkouts at the execution host with durable leases and monotonically increasing fences. Competing coordinators cannot dispatch into an occupied checkout; expired or superseded coordinators cannot send Session commands, permissions or forms. Renew control while observing work, retain reservations across partitions and suspended execution, and recover the original assignment after a coordinator restart without replaying its prompt. CLI, desktop and web share the worker protocol and display reservation, release and recovery states. Workers must support checkout fencing before accepting new coordinated tasks.
