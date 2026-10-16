---
"@reddb-io/redcode": patch
---

Coordinate provider cooldowns across sessions using the same server and authenticated account, including HTTP and WebSocket requests, with one recovery probe after overload. Preserve the existing retry status in CLI, Desktop and web.

Bound MCP startup concurrency and crash recovery, stop retries after repeated failures, reuse skill watches and avoid recursive scans of dependency directories. Suppress repeated failed watcher acquisitions and avoid loading unused provider catalogs from background events.

Persist local session execution ownership so another server process sharing the database cannot execute, interrupt, move, compact, revert or delete an owned session. Recover abandoned local ownership after process exit, preserve restart claims and return typed conflicts with CORS headers intact. Add jitter to client reconnection attempts.
