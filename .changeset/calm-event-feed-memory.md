---
"@reddb-io/redcode": patch
---

Bound the memory retained by slow live-event clients, encode each public event once for every connected surface, expose exact feed diagnostics, reuse RPC framing buffers, release inactive renderer location catalogs, sweep idle project graphs, cap decoded media and provider discovery caches, and avoid idle harness-recovery polling while preserving automatic reconnect and durable session recovery.
