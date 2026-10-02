---
"@reddb-io/redcode": patch
---

Repair incomplete tool histories before sending requests and keep system and reasoning-effort updates after pending tool results. This prevents interrupted tool calls or instruction updates from producing invalid provider requests.
